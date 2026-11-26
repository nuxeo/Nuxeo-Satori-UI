/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicBoolean;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.ConcurrentUpdateException;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.uidgen.UIDGeneratorService;
import org.nuxeo.ecm.core.uidgen.UIDSequencer;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.kv.KeyValueService;
import org.nuxeo.runtime.kv.KeyValueStore;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.DefaultComponent;
import org.nuxeo.runtime.services.config.ConfigurationService;

/**
 * The number series packages contribute, and the sequencer their numbers come from.
 *
 * <p>Contributions are kept in the order Nuxeo registers them, which is dependency order, and the
 * last enabled one for an id is in force: a later package replaces an earlier one's series whole,
 * and {@code enabled="false"} removes it. A series with a mistake is left out, and logged as an
 * error when it registers, so a document in it is refused rather than numbered by a guess.
 */
public class ControlledDocumentComponent extends DefaultComponent implements ControlledDocumentService {

    private static final Logger log = LogManager.getLogger(ControlledDocumentComponent.class);

    static final String XP_SERIES = "series";

    /**
     * The configuration property naming the sequencer numbers come from. Unset, the platform's
     * default sequencer: on Nuxeo LTS 2025, {@code KeyValueStoreUIDSequencer} in the server's
     * key/value store.
     */
    public static final String SEQUENCER_PROPERTY = "nuxeo.agentic.documents.sequencer";

    private final List<NumberSeriesDescriptor> contributions = new ArrayList<>();

    private volatile Map<String, NumberSeries> series = Map.of();

    @Override
    public void registerContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        if (!XP_SERIES.equals(extensionPoint) || !(contribution instanceof NumberSeriesDescriptor descriptor)) {
            log.warn("Unknown contribution to {}: {}", extensionPoint, contribution);
            return;
        }
        register(descriptor, contributor == null ? "?" : contributor.getName().getName());
    }

    @Override
    public void unregisterContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        synchronized (contributions) {
            if (contributions.remove(contribution)) {
                rebuild();
            }
        }
    }

    /** Register one series, as {@link #registerContribution} does, naming who contributed it. */
    void register(NumberSeriesDescriptor descriptor, String contributor) {
        if (descriptor.isEnabled()) {
            for (String problem : NumberSeries.of(descriptor).problems()) {
                log.error("Controlled documents: a series from {} is left out: {}", contributor, problem);
            }
        }
        synchronized (contributions) {
            contributions.add(descriptor);
            rebuild();
        }
    }

    private void rebuild() {
        Map<String, NumberSeries> built = new HashMap<>();
        for (NumberSeriesDescriptor descriptor : contributions) {
            String id = descriptor.getId();
            if (id == null) {
                continue;
            }
            NumberSeries read = descriptor.isEnabled() ? NumberSeries.of(descriptor).series() : null;
            if (read == null) {
                // Disabled, or broken: either way no series of this id is in force, so its
                // documents are refused rather than numbered by an earlier contribution.
                built.remove(id);
            } else {
                built.put(id, read);
            }
        }
        series = Map.copyOf(built);
    }

    @Override
    public NumberSeries series(String id) {
        return id == null ? null : series.get(id);
    }

    /**
     * The platform's SQL key/value store counts with a compare-and-set where the database has no
     * atomic increment, H2 among them, and gives up after five tries under contention, with a
     * {@link ConcurrentUpdateException}. A try that gives up has taken no value, so asking again
     * is safe: up to this many times, after a short random wait.
     */
    static final int SEQUENCER_ATTEMPTS = 20;

    @Override
    public String nextNumber(NumberSeries of) {
        UIDSequencer sequencer = sequencer();
        for (int attempt = 1;; attempt++) {
            try {
                return of.format(sequencer.getNextLong(of.sequenceKey()));
            } catch (ConcurrentUpdateException e) {
                if (attempt >= SEQUENCER_ATTEMPTS) {
                    throw e;
                }
                pause(attempt);
            }
        }
    }

    private static void pause(int attempt) {
        try {
            Thread.sleep(1 + ThreadLocalRandom.current().nextInt(5 * attempt));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new NuxeoException("Controlled documents: interrupted while waiting for the sequencer", e);
        }
    }

    // ------------------------------------------------------------------ supersession claims

    /** The key/value store claims are kept in: the server's default one, unless one of this name is set. */
    static final String CLAIMS_STORE = "agentic-documents";

    /**
     * The configuration property for how long a committed claim is kept, in seconds. It must be
     * longer than twice the longest transaction the server runs, so that a transaction that read
     * the old revision as current before the claim's transaction committed has ended before the
     * claim expires: a day by default. A claim whose transaction does not commit is released at
     * once; one whose server stopped mid-transaction holds until it expires.
     */
    public static final String CLAIM_TTL_PROPERTY = "nuxeo.agentic.documents.claim.ttl";

    static final long CLAIM_TTL_SECONDS = 86_400;

    private static long claimTtl() {
        ConfigurationService configuration = Framework.getService(ConfigurationService.class);
        long ttl = configuration == null ? CLAIM_TTL_SECONDS : configuration.getLong(CLAIM_TTL_PROPERTY, CLAIM_TTL_SECONDS);
        return ttl > 0 ? ttl : CLAIM_TTL_SECONDS;
    }

    static String claimKey(String previousId) {
        return "supersedes." + previousId;
    }

    @Override
    public boolean claimSupersession(String previousId, String revisionId) {
        return claim(claimKey(previousId), revisionId);
    }

    @Override
    public boolean claim(String key, String value) {
        KeyValueStore store = claims();
        long ttl = claimTtl();
        // The release first, then the claim: a claim made where its release could not be
        // registered, in a transaction already marked for rollback for one, would outlive the
        // transaction and block what it claims until it expired. So no release, no claim.
        AtomicBoolean claimed = new AtomicBoolean();
        if (!TransactionSynchronizations.unlessCommitted(() -> {
            if (claimed.get()) {
                store.compareAndSet(key, value, null);
            }
        })) {
            throw noTransaction();
        }
        if (!store.compareAndSet(key, null, value, ttl)) {
            return false;
        }
        claimed.set(true);
        return true;
    }

    @Override
    public void releaseOnCommit(String key, String value) {
        KeyValueStore store = claims();
        if (!TransactionSynchronizations.whenEnded(committed -> {
            if (committed) {
                store.compareAndSet(key, value, null);
            }
        })) {
            throw noTransaction();
        }
    }

    // ------------------------------------------------------------------ a review cycle's fence

    /**
     * How many times entering or leaving a cycle's fence is tried under contention before it
     * gives up: each try that fails lost to another writer, which moved on.
     */
    static final int FENCE_ATTEMPTS = 50;

    /** The fence's value once a cycle's close has committed, kept for the claims' time to live. */
    static final String FENCE_CLOSED = "closed";

    static final String FENCE_CLOSING = "closing:";

    static String fenceKey(String cycleId) {
        return "cycle." + cycleId;
    }

    @Override
    public boolean enterCycle(String cycleId) {
        KeyValueStore store = claims();
        String key = fenceKey(cycleId);
        long ttl = claimTtl();
        AtomicBoolean entered = new AtomicBoolean();
        // As for a claim: the way out is registered before the way in.
        if (!TransactionSynchronizations.whenEnded(committed -> {
            if (entered.get()) {
                leave(store, key, ttl);
            }
        })) {
            throw noTransaction();
        }
        for (int attempt = 1; attempt <= FENCE_ATTEMPTS; attempt++) {
            String value = store.getString(key);
            Long writers = writers(value);
            if (writers == null) {
                // Being closed, or closed: no comment is written in it any more.
                return false;
            }
            if (store.compareAndSet(key, value, Long.toString(writers + 1), ttl)) {
                entered.set(true);
                return true;
            }
            pause(attempt);
        }
        throw new NuxeoException("Controlled documents: too many comments are being written in this review cycle "
                + "at once; try again", 409);
    }

    @Override
    public boolean closeCycle(String cycleId) {
        KeyValueStore store = claims();
        String key = fenceKey(cycleId);
        long ttl = claimTtl();
        String closing = FENCE_CLOSING + UUID.randomUUID();
        AtomicBoolean taken = new AtomicBoolean();
        if (!TransactionSynchronizations.whenEnded(committed -> {
            if (taken.get()) {
                // Committed, it stays closed for as long as a transaction that read the cycle open
                // before the close committed could still be running; after that, the cycle's own
                // status refuses. Not committed, it is open again at once.
                store.compareAndSet(key, closing, committed ? FENCE_CLOSED : null, committed ? ttl : 0);
            }
        })) {
            throw noTransaction();
        }
        // Only from nothing: a comment being written holds a count, and a close its token.
        if (!store.compareAndSet(key, null, closing, ttl)) {
            return false;
        }
        taken.set(true);
        return true;
    }

    /** The number of comments being written, or {@code null} when the cycle is closing or closed. */
    private static Long writers(String value) {
        if (value == null) {
            return 0L;
        }
        try {
            long writers = Long.parseLong(value);
            return writers >= 0 ? writers : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static void leave(KeyValueStore store, String key, long ttl) {
        for (int attempt = 1; attempt <= FENCE_ATTEMPTS; attempt++) {
            String value = store.getString(key);
            Long writers = writers(value);
            if (writers == null || writers < 1) {
                // Gone with its time to live, or not a count: nothing to leave.
                return;
            }
            if (store.compareAndSet(key, value, writers == 1 ? null : Long.toString(writers - 1), ttl)) {
                return;
            }
            pause(attempt);
        }
        log.warn("Controlled documents: could not leave the fence {}; it expires on its own", key);
    }

    // ------------------------------------------------------------------ a revision's mark fence

    static final String MARK_CHANGING = "changing:";

    static final String MARK_READING = "reading";

    /**
     * What this thread's transactions hold of the mark fences: for each transaction, by identity,
     * each fence's key and its change's token or {@link #MARK_READING}. A transaction begun inside
     * another on the same thread holds none of the outer one's, and keeps its own apart.
     */
    private static final ThreadLocal<Map<Object, Map<String, String>>> MARK_FENCES = ThreadLocal.withInitial(
            IdentityHashMap::new);

    static String markFenceKey(String revisionId) {
        return "mark." + revisionId;
    }

    /** What the current transaction holds of the fence: its token, {@link #MARK_READING}, or {@code null}. */
    private static String held(String key) {
        Object transaction = TransactionSynchronizations.current();
        Map<String, String> fences = transaction == null ? null : MARK_FENCES.get().get(transaction);
        return fences == null ? null : fences.get(key);
    }

    private static void hold(Object transaction, String key, String value) {
        MARK_FENCES.get().computeIfAbsent(transaction, t -> new HashMap<>()).put(key, value);
    }

    /** Forget what the transaction held of the fence, if it is still that: whether it was. */
    private static boolean forget(String key, Object transaction, String value) {
        Map<Object, Map<String, String>> byTransaction = MARK_FENCES.get();
        Map<String, String> fences = byTransaction.get(transaction);
        if (fences == null || !value.equals(fences.get(key))) {
            return false;
        }
        fences.remove(key);
        if (fences.isEmpty()) {
            byTransaction.remove(transaction);
        }
        return true;
    }

    /**
     * A transaction that holds the fence already, to read or to change the mark, enters it again at
     * once: it reads the mark as it has it, its own change included.
     */
    @Override
    public boolean enterMark(String revisionId) {
        String key = markFenceKey(revisionId);
        if (held(key) != null) {
            return true;
        }
        Object transaction = TransactionSynchronizations.current();
        KeyValueStore store = claims();
        long ttl = claimTtl();
        AtomicBoolean entered = new AtomicBoolean();
        // As for a claim and a cycle's fence: the way out is registered before the way in.
        if (transaction == null || !TransactionSynchronizations.whenEnded(committed -> {
            // Left only while it still reads: a reading this transaction made a change of has no
            // count left in the store, and the change's own release clears it.
            if (entered.get() && forget(key, transaction, MARK_READING)) {
                leave(store, key, ttl);
            }
        })) {
            throw noTransaction();
        }
        for (int attempt = 1; attempt <= FENCE_ATTEMPTS; attempt++) {
            String value = store.getString(key);
            Long readers = writers(value);
            if (readers == null) {
                // A change of the mark holds it.
                return false;
            }
            if (store.compareAndSet(key, value, Long.toString(readers + 1), ttl)) {
                entered.set(true);
                hold(transaction, key, MARK_READING);
                return true;
            }
            pause(attempt);
        }
        throw new NuxeoException("Controlled documents: too many revisions or transmittals are reading this "
                + "revision's export-control mark at once; try again", 409);
    }

    /**
     * Taken from nothing, or from this transaction's own reading alone: a transaction that read the
     * mark, and changes it after, crosses no one.
     */
    @Override
    public boolean changeMark(String revisionId) {
        String key = markFenceKey(revisionId);
        String held = held(key);
        if (held != null && held.startsWith(MARK_CHANGING)) {
            return true;
        }
        Object transaction = TransactionSynchronizations.current();
        KeyValueStore store = claims();
        long ttl = claimTtl();
        String changing = MARK_CHANGING + UUID.randomUUID();
        AtomicBoolean taken = new AtomicBoolean();
        if (transaction == null || !TransactionSynchronizations.whenEnded(committed -> {
            if (taken.get()) {
                forget(key, transaction, changing);
                // Whichever way it ended: a reader after it reads the mark as it was committed.
                store.compareAndSet(key, changing, null);
            }
        })) {
            throw noTransaction();
        }
        // Only from nothing, or from this transaction's one reading: another reader holds a count, and
        // another change its token.
        if (!store.compareAndSet(key, held == null ? null : "1", changing, ttl)) {
            return false;
        }
        taken.set(true);
        hold(transaction, key, changing);
        return true;
    }

    private static KeyValueStore claims() {
        KeyValueService kv = Framework.getService(KeyValueService.class);
        if (kv == null) {
            throw new NuxeoException("Controlled documents: the key/value service is not running");
        }
        return kv.getKeyValueStore(CLAIMS_STORE);
    }

    private static NuxeoException noTransaction() {
        return new NuxeoException("Controlled documents: this change needs an active transaction to commit it, "
                + "and has none", 409);
    }

    // ------------------------------------------------------------------ transmittals' series

    @Override
    public List<NumberSeries> transmittalSeries() {
        return series.values()
                     .stream()
                     .filter(NumberSeries::transmittals)
                     .sorted(Comparator.comparing(NumberSeries::id))
                     .toList();
    }

    private static UIDSequencer sequencer() {
        UIDGeneratorService generators = Framework.getService(UIDGeneratorService.class);
        if (generators == null) {
            throw new NuxeoException("Controlled documents: the platform's sequencer is not running");
        }
        ConfigurationService configuration = Framework.getService(ConfigurationService.class);
        String name = configuration == null ? null
                : configuration.getString(SEQUENCER_PROPERTY).filter(s -> !s.isBlank()).orElse(null);
        UIDSequencer sequencer = name == null ? generators.getSequencer() : generators.getSequencer(name.trim());
        if (sequencer == null) {
            throw new NuxeoException("Controlled documents: no sequencer "
                    + (name == null ? "is the platform's default" : "is named " + name.trim()));
        }
        return sequencer;
    }
}
