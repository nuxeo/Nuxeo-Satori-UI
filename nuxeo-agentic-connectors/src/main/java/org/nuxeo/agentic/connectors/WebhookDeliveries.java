package org.nuxeo.agentic.connectors;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.nuxeo.runtime.kv.KeyValueStore;
import org.nuxeo.runtime.kv.KeyValueStoreProvider;

/**
 * The deliveries, in the platform's key/value store {@value #STORE}: on a server whose key/value
 * stores are in its database (the default SQL configuration keeps them there), they outlive a
 * restart and are shared by the cluster's nodes.
 *
 * <ul>
 * <li>{@code p:<id>}: in flight, pending or being sent, with its payload, for
 * {@link #IN_FLIGHT}.</li>
 * <li>{@code x:<id>}: a dead letter, with its payload, so that it can be sent again, for
 * {@link #DEAD}.</li>
 * <li>{@code d:<id>}: delivered, without its payload, for {@link #DELIVERED}, so that an
 * administrator sees the recent ones.</li>
 * </ul>
 *
 * A delivery is claimed before each attempt by a compare-and-set of its in-flight record, so that
 * two nodes, or a retry and a resend, never send one attempt twice.
 */
final class WebhookDeliveries {

    static final String STORE = "agenticWebhooks";

    static final String IN_FLIGHT_PREFIX = "p:";

    static final String DEAD_PREFIX = "x:";

    static final String DELIVERED_PREFIX = "d:";

    static final Duration IN_FLIGHT = Duration.ofDays(7);

    static final Duration DEAD = Duration.ofDays(30);

    static final Duration DELIVERED = Duration.ofDays(1);

    /** An in-flight record as read, so that the next write can be made only if it has not changed since. */
    record Stored(String json, WebhookDelivery delivery) {
    }

    private final Supplier<KeyValueStore> store;

    WebhookDeliveries(Supplier<KeyValueStore> store) {
        this.store = store;
    }

    void add(WebhookDelivery delivery) {
        store.get().put(IN_FLIGHT_PREFIX + delivery.id(), delivery.toJson(), IN_FLIGHT.toSeconds());
    }

    Stored inFlight(String id) {
        String json = store.get().getString(IN_FLIGHT_PREFIX + id);
        WebhookDelivery delivery = WebhookDelivery.fromJson(json);
        return delivery == null ? null : new Stored(json, delivery);
    }

    /** {@code next} in place of {@code was}, only if no one changed it since it was read. */
    boolean replace(Stored was, WebhookDelivery next) {
        return store.get()
                    .compareAndSet(IN_FLIGHT_PREFIX + next.id(), was.json(), next.toJson(), IN_FLIGHT.toSeconds());
    }

    /** Delivered: kept without its payload, and no longer in flight. */
    void delivered(WebhookDelivery delivery) {
        KeyValueStore kv = store.get();
        kv.put(DELIVERED_PREFIX + delivery.id(), delivery.with(delivery.state(), delivery.attempts(),
                delivery.updated(), delivery.nextAt(), delivery.outcome(), delivery.status(), null).toJson(),
                DELIVERED.toSeconds());
        kv.put(IN_FLIGHT_PREFIX + delivery.id(), (String) null);
    }

    /** A dead letter, with its payload, and no longer in flight. */
    void dead(WebhookDelivery delivery) {
        KeyValueStore kv = store.get();
        kv.put(DEAD_PREFIX + delivery.id(), delivery.toJson(), DEAD.toSeconds());
        kv.put(IN_FLIGHT_PREFIX + delivery.id(), (String) null);
    }

    WebhookDelivery deadLetter(String id) {
        return WebhookDelivery.fromJson(store.get().getString(DEAD_PREFIX + id));
    }

    /**
     * A dead letter sent again: in flight once more, and no longer a dead letter. {@code false} when
     * it is already in flight, by another resend.
     */
    boolean revive(WebhookDelivery dead, WebhookDelivery pending) {
        KeyValueStore kv = store.get();
        if (!kv.compareAndSet(IN_FLIGHT_PREFIX + pending.id(), (String) null, pending.toJson(),
                IN_FLIGHT.toSeconds())) {
            return false;
        }
        kv.put(DEAD_PREFIX + dead.id(), (String) null);
        return true;
    }

    /** Every in-flight delivery's id. */
    List<String> inFlightIds() {
        try (Stream<String> keys = provider().keyStream(IN_FLIGHT_PREFIX)) {
            return keys.map(key -> key.substring(IN_FLIGHT_PREFIX.length())).collect(Collectors.toList());
        }
    }

    /** The most recently changed deliveries under these prefixes, newest first, at most {@code limit}. */
    List<WebhookDelivery> recent(List<String> prefixes, int limit) {
        KeyValueStoreProvider kv = provider();
        List<WebhookDelivery> found = new ArrayList<>();
        for (String prefix : prefixes) {
            List<String> keys;
            try (Stream<String> stream = kv.keyStream(prefix)) {
                keys = stream.collect(Collectors.toList());
            }
            for (int from = 0; from < keys.size(); from += 500) {
                Map<String, String> values = kv.getStrings(keys.subList(from, Math.min(keys.size(), from + 500)));
                values.values().stream().map(WebhookDelivery::fromJson).filter(d -> d != null).forEach(found::add);
            }
        }
        found.sort(Comparator.comparingLong(WebhookDelivery::updated).reversed().thenComparing(WebhookDelivery::id));
        return found.size() > limit ? List.copyOf(found.subList(0, limit)) : List.copyOf(found);
    }

    private KeyValueStoreProvider provider() {
        KeyValueStore kv = store.get();
        if (kv instanceof KeyValueStoreProvider provider) {
            return provider;
        }
        throw new IllegalStateException("The key/value store " + STORE + " cannot list its keys");
    }
}
