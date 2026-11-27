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
 * <li>{@code p:<id>}: in flight, pending or being sent, for {@link #IN_FLIGHT};</li>
 * <li>{@code x:<id>}: a dead letter, for {@link #DEAD};</li>
 * <li>{@code d:<id>}: delivered, for {@link #DELIVERED}, so that an administrator sees the recent
 * ones;</li>
 * <li>{@code b:<id>}: the payload, apart from the record, kept while the delivery is in flight and
 * while it is a dead letter, and dropped once it is delivered. The records, which every node reads
 * to find the due deliveries and an administrator reads in the list, never hold one.</li>
 * </ul>
 *
 * Each move is a compare-and-set of the in-flight record as its owner last wrote it: an attempt is
 * claimed so, and a delivery leaves flight so, delivered or a dead letter. A node whose claim was
 * taken over, after {@link WebhookComponent#CLAIM_TIMEOUT}, changes nothing when it finishes.
 */
final class WebhookDeliveries {

    static final String STORE = "agenticWebhooks";

    static final String IN_FLIGHT_PREFIX = "p:";

    static final String DEAD_PREFIX = "x:";

    static final String DELIVERED_PREFIX = "d:";

    static final String PAYLOAD_PREFIX = "b:";

    static final Duration IN_FLIGHT = Duration.ofDays(7);

    static final Duration DEAD = Duration.ofDays(30);

    static final Duration DELIVERED = Duration.ofDays(1);

    /** An in-flight record as read, so that the next write can be made only if it has not changed since. */
    record Stored(String json, WebhookDelivery delivery) {

        static Stored of(WebhookDelivery delivery) {
            return new Stored(delivery.toJson(), delivery);
        }
    }

    private final Supplier<KeyValueStore> store;

    WebhookDeliveries(Supplier<KeyValueStore> store) {
        this.store = store;
    }

    /** A new delivery in flight, and its payload. */
    void add(WebhookDelivery delivery, String payload) {
        KeyValueStore kv = store.get();
        kv.put(PAYLOAD_PREFIX + delivery.id(), payload, IN_FLIGHT.toSeconds());
        kv.put(IN_FLIGHT_PREFIX + delivery.id(), delivery.toJson(), IN_FLIGHT.toSeconds());
    }

    Stored inFlight(String id) {
        String json = store.get().getString(IN_FLIGHT_PREFIX + id);
        WebhookDelivery delivery = WebhookDelivery.fromJson(json);
        return delivery == null ? null : new Stored(json, delivery);
    }

    /** The payload kept for a delivery, or {@code null}. */
    String payload(String id) {
        return store.get().getString(PAYLOAD_PREFIX + id);
    }

    /** {@code next} in place of {@code was}, only if no one changed it since it was read. */
    boolean replace(Stored was, WebhookDelivery next) {
        return store.get()
                    .compareAndSet(IN_FLIGHT_PREFIX + next.id(), was.json(), next.toJson(), IN_FLIGHT.toSeconds());
    }

    /**
     * Delivered: out of flight, if it is still as {@code mine} left it, then kept without its payload.
     * {@code false}, and nothing written, when another node took it over.
     */
    boolean delivered(Stored mine, WebhookDelivery done) {
        KeyValueStore kv = store.get();
        if (!kv.compareAndSet(IN_FLIGHT_PREFIX + done.id(), mine.json(), (String) null)) {
            return false;
        }
        kv.put(DELIVERED_PREFIX + done.id(), done.with(done.state(), done.attempts(), done.updated(), done.nextAt(),
                done.outcome(), done.status(), false).toJson(), DELIVERED.toSeconds());
        kv.put(PAYLOAD_PREFIX + done.id(), (String) null);
        return true;
    }

    /**
     * A dead letter: out of flight, if it is still as {@code mine} left it, then kept, its payload with
     * it for as long. {@code false}, and nothing written, when another node took it over.
     */
    boolean dead(Stored mine, WebhookDelivery dead) {
        KeyValueStore kv = store.get();
        if (!kv.compareAndSet(IN_FLIGHT_PREFIX + dead.id(), mine.json(), (String) null)) {
            return false;
        }
        boolean kept = kv.setTTL(PAYLOAD_PREFIX + dead.id(), DEAD.toSeconds());
        kv.put(DEAD_PREFIX + dead.id(), dead.with(dead.state(), dead.attempts(), dead.updated(), dead.nextAt(),
                dead.outcome(), dead.status(), kept).toJson(), DEAD.toSeconds());
        return true;
    }

    /** A dead letter that never was in flight: a payload too large to send, kept without it. */
    void deadAtOnce(WebhookDelivery dead) {
        store.get().put(DEAD_PREFIX + dead.id(), dead.toJson(), DEAD.toSeconds());
    }

    WebhookDelivery deadLetter(String id) {
        return WebhookDelivery.fromJson(store.get().getString(DEAD_PREFIX + id));
    }

    /**
     * A dead letter sent again: in flight once more, its payload kept as long, and no longer a dead
     * letter. {@code false} when it is already in flight, by another resend.
     */
    boolean revive(WebhookDelivery dead, WebhookDelivery pending) {
        KeyValueStore kv = store.get();
        if (!kv.compareAndSet(IN_FLIGHT_PREFIX + pending.id(), (String) null, pending.toJson(),
                IN_FLIGHT.toSeconds())) {
            return false;
        }
        kv.setTTL(PAYLOAD_PREFIX + pending.id(), IN_FLIGHT.toSeconds());
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
