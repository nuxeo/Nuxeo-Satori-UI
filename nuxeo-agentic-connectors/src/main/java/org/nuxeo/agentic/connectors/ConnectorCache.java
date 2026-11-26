package org.nuxeo.agentic.connectors;

import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

/**
 * {@code Connector.Read}'s answers, kept on this server for the time it sets for each connector.
 *
 * <ul>
 * <li><b>On only where the server says so:</b> {@code nuxeo.agentic.connectors.<id>.cache.ttl}, whole
 * seconds from 1 to {@value #MAX_TTL_SECONDS}. Unset, or not such a number, nothing is kept and every
 * card drawn is one call, as before. Nothing a contribution, a layout or a request says changes it.</li>
 * <li><b>What an answer is kept under</b> ({@link Key}): the connector as it is registered, fields
 * and all, the document the answer was read for, and the key read from that document as stored. So
 * an answer is never given for another document, nor for the same one once its key has changed, nor
 * once its connector has been contributed again with other fields.</li>
 * <li><b>Never the reader:</b> the reader is not in the key, because the cache is asked only after
 * {@link ConnectorReader} has held the reader to {@code Read} on that very document, and to the
 * connector's own permission, on every read. An answer kept for one reader is given to another only
 * when that other may read the same document, and would have been given the same answer by the
 * system, which the connector calls with one credential whoever reads. If the connector ever passed
 * the reader's identity on (decision F), the reader would have to join the key.</li>
 * <li><b>What is kept:</b> {@code found} and {@code not-found}, as the system gave them, the
 * allow-list already applied. A failure is never kept, nor {@code no-key}, which asks nothing.</li>
 * <li><b>Bounds:</b> an answer is given until its time to live has passed, read again on every
 * lookup, so a shorter time set on the server applies to what is already kept; at most
 * {@code nuxeo.agentic.connectors.<id>.cache.maxEntries} answers per connector, 1 to
 * {@value #MAX_MAX_ENTRIES}, {@value #DEFAULT_MAX_ENTRIES} unless set, the first kept dropped first.</li>
 * <li><b>How old:</b> an answer is as old as the moment the system was asked for it, not the moment it
 * came back.</li>
 * <li><b>Dropped</b> by a change event for the key ({@link #invalidate}), when the connector is
 * contributed again or removed, and when the server stops. A call already on its way when the event
 * came keeps nothing: what it brings back may predate the change.</li>
 * </ul>
 *
 * Each server node keeps its own answers: an event received by one node drops that node's, and the
 * others' live out their time to live.
 */
final class ConnectorCache {

    private static final Logger log = LogManager.getLogger(ConnectorCache.class);

    /** A day: an answer older than that is the system's to give again. */
    static final int MAX_TTL_SECONDS = 86_400;

    static final int DEFAULT_MAX_ENTRIES = 1_000;

    static final int MAX_MAX_ENTRIES = 100_000;

    /**
     * What an answer is kept under. The connector is the registered one, compared whole, so that one
     * contributed again with another path, pointer or field does not find the old one's answers.
     */
    record Key(Connector connector, String document, String recordKey) {
    }

    /**
     * When a call was asked, or an event came: {@code order}, from one counter, says which came first,
     * whatever the clock does, and {@code at} is the time, for an answer's age and for how long an
     * event is remembered.
     */
    record Ticket(long order, Instant at) {
    }

    /** An answer, and when the system was asked for it. */
    record Entry(ConnectorAnswer answer, Ticket asked) {

        Instant stored() {
            return asked.at();
        }
    }

    /** An answer from the cache, and how old it is. */
    record Hit(ConnectorAnswer answer, Duration age) {
    }

    private final ConnectorSettings settings;

    private volatile InstantSource clock;

    private final java.util.concurrent.atomic.AtomicLong order = new java.util.concurrent.atomic.AtomicLong();

    /** Each connector's answers, by its id. */
    private final Map<String, Shelf> shelves = new ConcurrentHashMap<>();

    /** The value of each setting already warned about, so that a wrong one is logged once, not per read. */
    private final Map<String, String> warned = new ConcurrentHashMap<>();

    ConnectorCache(ConnectorSettings settings, InstantSource clock) {
        this.settings = settings;
        this.clock = clock;
    }

    /** For tests, which move time on rather than wait. */
    void clock(InstantSource clock) {
        this.clock = Objects.requireNonNull(clock);
    }

    Instant now() {
        return clock.instant();
    }

    /** A ticket for a call about to be made, or an event that came: after every one given before. */
    Ticket ticket() {
        return new Ticket(order.incrementAndGet(), now());
    }

    /** The connector's time to live, or {@code null} when the server keeps none of its answers. */
    Duration ttl(Connector connector) {
        Integer seconds = wholeNumber(connector, connector.cacheTtlProperty(), 1, MAX_TTL_SECONDS,
                "so its answers are not kept");
        return seconds == null ? null : Duration.ofSeconds(seconds);
    }

    int maxEntries(Connector connector) {
        Integer max = wholeNumber(connector, connector.cacheMaxEntriesProperty(), 1, MAX_MAX_ENTRIES,
                "so it keeps " + DEFAULT_MAX_ENTRIES);
        return max == null ? DEFAULT_MAX_ENTRIES : max;
    }

    private Integer wholeNumber(Connector connector, String property, int min, int max, String otherwise) {
        String value = settings.property(property);
        if (value == null) {
            warned.remove(property);
            return null;
        }
        try {
            int number = Integer.parseInt(value);
            if (number >= min && number <= max) {
                warned.remove(property);
                return number;
            }
        } catch (NumberFormatException e) {
            // Warned below.
        }
        if (!value.equals(warned.put(property, value))) {
            log.warn("Connector {}: the server property {} is not a whole number from {} to {}, {}", connector.id(),
                    property, min, max, otherwise);
        }
        return null;
    }

    /**
     * The answer kept for this connector, document and key, if one is and its time has not passed;
     * {@code null} otherwise, and always when the server keeps none of the connector's answers.
     */
    Hit get(Connector connector, String document, String recordKey) {
        Duration ttl = ttl(connector);
        Shelf shelf = shelves.get(connector.id());
        if (ttl == null || shelf == null) {
            return null;
        }
        Key key = new Key(connector, document, recordKey);
        Entry entry = shelf.get(key);
        if (entry == null) {
            return null;
        }
        Instant now = now();
        Duration age = Duration.between(entry.stored(), now);
        if (age.compareTo(ttl) >= 0) {
            shelf.remove(key, entry);
            return null;
        }
        return new Hit(entry.answer(), age.isNegative() ? Duration.ZERO : age);
    }

    /**
     * Keeps the system's answer, when the server keeps this connector's and it is one that is kept.
     * {@code asked} is the call's {@link #ticket}, taken before it: the answer is kept as that old, and
     * not at all when a change event named its key since, by the tickets' order and not the clock,
     * since it may predate the change; nor over an answer asked later, which a slower call must not
     * replace. Answers whether it was kept.
     */
    boolean put(Connector connector, String document, String recordKey, ConnectorAnswer answer, Ticket asked) {
        if (answer.status() == ConnectorAnswer.Status.NO_KEY) {
            return false;
        }
        Duration ttl = ttl(connector);
        if (ttl == null) {
            return false;
        }
        return shelves.computeIfAbsent(connector.id(), id -> new Shelf())
                      .put(new Key(connector, document, recordKey), new Entry(answer, asked), maxEntries(connector),
                              now().minus(ttl));
    }

    /**
     * How long a change event is remembered, at least, so that a call that was on its way when it came
     * keeps nothing: longer than the longest call a connector may make, its whole-call deadline.
     */
    static final Duration EVENT_MEMORY = Duration.ofMillis(Connector.MAX_TIMEOUT_MS).plusSeconds(5);

    /**
     * Drops every answer kept for this connector and key, whichever document it was read for, and
     * remembers the drop for at least {@link #EVENT_MEMORY}, so that a call already on its way keeps
     * nothing.
     */
    int invalidate(Connector connector, String recordKey) {
        Ticket now = ticket();
        return shelves.computeIfAbsent(connector.id(), id -> new Shelf())
                      .invalidate(recordKey, now, now.at().minus(EVENT_MEMORY));
    }

    /**
     * Drops every answer of the connector: it was contributed again, or removed. The events it was
     * sent lately are still remembered, so that a call on its way since keeps nothing either.
     */
    void forget(String connectorId) {
        if (connectorId != null) {
            shelves.computeIfPresent(connectorId, (id, shelf) -> shelf.emptied());
        }
    }

    void clear() {
        shelves.clear();
    }

    /** How many answers are kept for the connector, for tests. */
    int size(String connectorId) {
        Shelf shelf = shelves.get(connectorId);
        return shelf == null ? 0 : shelf.size();
    }

    /**
     * One connector's answers, in the order they were kept: an answer kept again moves to the end.
     * Indexed by record key too, so that an event drops its answers without a scan of the shelf, and
     * with the record keys change events named lately.
     */
    private static final class Shelf {

        private final LinkedHashMap<Key, Entry> entries = new LinkedHashMap<>();

        private final Map<String, Set<Key>> byRecord = new HashMap<>();

        /** When an event last named each key, for at least {@link #EVENT_MEMORY}. */
        private final Map<String, Ticket> invalidated = new HashMap<>();

        /** A shelf with no answer, that remembers this one's events. */
        synchronized Shelf emptied() {
            Shelf empty = new Shelf();
            empty.invalidated.putAll(invalidated);
            return empty;
        }

        synchronized Entry get(Key key) {
            return entries.get(key);
        }

        synchronized void remove(Key key, Entry entry) {
            if (entries.remove(key, entry)) {
                unindex(key);
            }
        }

        /**
         * Keeps the entry, unless an event named its key after it was asked or an answer asked later
         * is kept, both by the tickets' order. Then, past the bound, drops what has expired anywhere
         * on the shelf, since a slow call's answer is stamped with when it was asked and may sit behind
         * younger ones; then, from the first kept, what has expired and what is still past the bound.
         */
        synchronized boolean put(Key key, Entry entry, int max, Instant expiredUpTo) {
            Ticket dropped = invalidated.get(key.recordKey());
            if (dropped != null && dropped.order() > entry.asked().order()) {
                return false;
            }
            Entry kept = entries.get(key);
            if (kept != null && kept.asked().order() > entry.asked().order()) {
                return false;
            }
            entries.remove(key);
            entries.put(key, entry);
            byRecord.computeIfAbsent(key.recordKey(), k -> new HashSet<>()).add(key);
            if (entries.size() > max) {
                Iterator<Map.Entry<Key, Entry>> all = entries.entrySet().iterator();
                while (all.hasNext()) {
                    Map.Entry<Key, Entry> next = all.next();
                    if (!next.getValue().stored().isAfter(expiredUpTo)) {
                        all.remove();
                        unindex(next.getKey());
                    }
                }
            }
            Iterator<Map.Entry<Key, Entry>> first = entries.entrySet().iterator();
            while (first.hasNext()) {
                Map.Entry<Key, Entry> next = first.next();
                if (entries.size() <= max && next.getValue().stored().isAfter(expiredUpTo)) {
                    break;
                }
                first.remove();
                unindex(next.getKey());
            }
            return entries.containsKey(key);
        }

        synchronized int invalidate(String recordKey, Ticket now, Instant forgetBefore) {
            if (invalidated.size() > 64) {
                invalidated.values().removeIf(event -> event.at().isBefore(forgetBefore));
            }
            invalidated.put(recordKey, now);
            Set<Key> keys = byRecord.remove(recordKey);
            if (keys == null) {
                return 0;
            }
            keys.forEach(entries::remove);
            return keys.size();
        }

        private void unindex(Key key) {
            Set<Key> keys = byRecord.get(key.recordKey());
            if (keys != null) {
                keys.remove(key);
                if (keys.isEmpty()) {
                    byRecord.remove(key.recordKey());
                }
            }
        }

        synchronized int size() {
            return entries.size();
        }

        synchronized int indexed() {
            return byRecord.values().stream().mapToInt(Set::size).sum();
        }
    }

    /** How many answers the record-key index holds for the connector, for tests: always {@link #size}. */
    int indexed(String connectorId) {
        Shelf shelf = shelves.get(connectorId);
        return shelf == null ? 0 : shelf.indexed();
    }
}
