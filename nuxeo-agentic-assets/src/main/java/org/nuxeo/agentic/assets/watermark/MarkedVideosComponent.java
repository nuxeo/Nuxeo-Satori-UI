/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.io.Serializable;
import java.time.Clock;
import java.time.Duration;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.function.Supplier;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.rights.AssetRightsService;
import org.nuxeo.agentic.assets.rights.RightsPolicy;
import org.nuxeo.agentic.assets.rights.Watermark.Placement;
import org.nuxeo.agentic.assets.watermark.AssetWatermarks.Unavailable;
import org.nuxeo.agentic.assets.watermark.WatermarkedCopies.Copy;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.work.api.WorkManager;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.kv.KeyValueService;
import org.nuxeo.runtime.kv.KeyValueStore;
import org.nuxeo.runtime.model.ComponentContext;
import org.nuxeo.runtime.model.DefaultComponent;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * A video a rights policy's watermark marks, since 0.6.0: short, marked in the request, as before;
 * long, marked by a job in the platform's work manager, and kept for whom it was marked.
 *
 * <ul>
 * <li><strong>Long</strong> is a file over {@value #BYTES_PROPERTY} bytes, or, read by ffprobe, over
 * {@value #SECONDS_PROPERTY} seconds, both in {@code nuxeo.conf}. The request answers that it is
 * being prepared, and holds no thread while it is.</li>
 * <li><strong>Kept</strong> as a document of the add-on's own ({@link WatermarkedCopies}), under a
 * key: the SHA-256 of the document, the place of the file, its digest, the policy's type and its
 * watermark's whole definition, why it was marked, the exact text drawn, and the person and the
 * territory where the text names them. So it is reused for that key alone, never served to someone
 * the text would not name, and never found once the file or the watermark has changed; it is then
 * dropped, by {@link WatermarkedCopiesListener} or the next job's sweep, and after
 * {@value #COPY_DAYS_PROPERTY} days whatever happens.</li>
 * <li><strong>One job per key at a time, across the cluster:</strong> a job runs only while it holds
 * the key's lease in the platform's key/value store {@value #STORE}, taken by compare-and-set and
 * renewed while it runs; a job that finds it taken does nothing. A queued job's marker there keeps a
 * second request from queuing another.</li>
 * <li><strong>A failure</strong> is kept there for {@value #FAILURE_MINUTES_PROPERTY} minutes,
 * audited on the document, and answered to every request for the key until then, with its reason:
 * the unmarked file is never served, while the job runs or after it fails.</li>
 * </ul>
 */
public class MarkedVideosComponent extends DefaultComponent implements MarkedVideos {

    private static final Logger log = LogManager.getLogger(MarkedVideosComponent.class);

    /** The platform's key/value store the jobs' markers, leases and failures are kept in. */
    static final String STORE = "agenticWatermarks";

    /** A queued or running job's marker. */
    static final String JOB_PREFIX = "j:";

    /** The lease of the job that runs. */
    static final String LEASE_PREFIX = "l:";

    /** A failure's reason. */
    static final String FAILED_PREFIX = "f:";

    static final String BYTES_PROPERTY = "nuxeo.agentic.watermark.video.background.bytes";

    static final long DEFAULT_BYTES = 32L * 1024 * 1024;

    static final String SECONDS_PROPERTY = "nuxeo.agentic.watermark.video.background.seconds";

    static final long DEFAULT_SECONDS = 30;

    static final String COPY_DAYS_PROPERTY = "nuxeo.agentic.watermark.video.copy.days";

    static final long DEFAULT_COPY_DAYS = 7;

    static final String FAILURE_MINUTES_PROPERTY = "nuxeo.agentic.watermark.video.failure.minutes";

    static final long DEFAULT_FAILURE_MINUTES = 60;

    /** How long a lease holds unless renewed; it is renewed every third of it. */
    static final long LEASE_SECONDS = 120;

    /** How long a queued job's marker holds before a job runs, or while it runs, renewed. */
    static final long QUEUED_SECONDS = Duration.ofHours(6).toSeconds();

    /**
     * How long a queued job may wait with no job holding its lease before a request queues it again:
     * longer than a queue's usual wait, so that a job is queued twice only when its node stopped.
     */
    static final Duration REQUEUE_AFTER = Duration.ofMinutes(15);

    /** A job's marker: this, then when it was queued, in milliseconds. */
    static final String QUEUED = "queued:";

    /** When the page is told to ask again, in seconds. */
    static final int RETRY_AFTER = 5;

    private final Supplier<KeyValueStore> store;

    private final Supplier<AssetRightsService> rights;

    private final Clock clock;

    private ScheduledExecutorService leases;

    public MarkedVideosComponent() {
        this(() -> Framework.getService(KeyValueService.class).getKeyValueStore(STORE),
                () -> Framework.getService(AssetRightsService.class), Clock.systemUTC());
    }

    MarkedVideosComponent(Supplier<KeyValueStore> store, Supplier<AssetRightsService> rights, Clock clock) {
        this.store = store;
        this.rights = rights;
        this.clock = clock;
    }

    @Override
    public void stop(ComponentContext context) throws InterruptedException {
        ScheduledExecutorService running;
        synchronized (this) {
            running = leases;
            leases = null;
        }
        if (running != null) {
            running.shutdownNow();
        }
    }

    // ------------------------------------------------------------------ the request

    @Override
    public Outcome mark(Order order) {
        try {
            return decide(order);
        } catch (RuntimeException e) {
            log.error("Asset rights: the marked {} of {} could not be prepared, so it is refused", order.use(),
                    order.document(), e);
            return new Refused("the marked video could not be prepared");
        }
    }

    private Outcome decide(Order order) {
        VideoMarker marker = AssetWatermarks.marker();
        if (marker == null || !marker.available()) {
            return new Refused("the server's video tools, which need ffmpeg, are not available");
        }
        Blob file = order.file();
        long length = file.getLength();
        boolean background = length < 0 || length > setting(BYTES_PROPERTY, DEFAULT_BYTES, 0, Long.MAX_VALUE);
        VideoMarker.Probe probe = null;
        if (!background) {
            try {
                probe = marker.probe(file);
            } catch (Unavailable e) {
                return new Refused(e.getMessage());
            }
            background = probe != null
                    && probe.seconds() > setting(SECONDS_PROPERTY, DEFAULT_SECONDS, 0, Duration.ofDays(1).toSeconds());
        }
        if (!background) {
            try {
                return new Marked(AssetWatermarks.mark(file, probe, order.text(), order.placement()), null);
            } catch (Unavailable e) {
                return new Refused(e.getMessage());
            }
        }
        return background(order);
    }

    /** A long video: its kept copy, its failure, or a job, queued once for its key. */
    private Outcome background(Order order) {
        String digest = order.file().getDigest();
        if (order.xpath() == null || digest == null || digest.isBlank()) {
            return new Refused("a long video that is not a stored file of the document cannot be marked");
        }
        String key = key(order);
        Copy copy = inTransaction(() -> CoreInstance.doPrivileged(order.repository(),
                (Function<CoreSession, Copy>) privileged -> WatermarkedCopies.find(privileged, key)));
        if (copy != null && !matches(copy, order)) {
            // Its key is the order's, and it does not say what the order asks: never served.
            log.error("Asset rights: the copy {} kept under {} does not match its order, and is not served", copy.id(),
                    brief(key));
            return new Refused("the kept copy could not be checked");
        }
        if (copy != null && fresh(copy)) {
            return new Marked(copy.file(), copy.id());
        }
        // None, or one past its days, which the job replaces.
        KeyValueStore kv = store.get();
        String failure = kv.getString(FAILED_PREFIX + key);
        if (failure != null) {
            return new Refused(failure);
        }
        String marker = QUEUED + clock.millis();
        String was = null;
        boolean queue = kv.compareAndSet(JOB_PREFIX + key, null, marker, QUEUED_SECONDS);
        if (!queue) {
            // Queued already, and running or waiting its turn: this request is answered by that job.
            // Unless no job holds the lease and it was queued long ago, as when its node stopped
            // before it ran: queued again, once, by whichever request swaps the marker first.
            was = kv.getString(JOB_PREFIX + key);
            queue = was != null && kv.getString(LEASE_PREFIX + key) == null && queuedAt(was) >= 0
                    && clock.millis() - queuedAt(was) > REQUEUE_AFTER.toMillis()
                    && kv.compareAndSet(JOB_PREFIX + key, was, marker, QUEUED_SECONDS);
        }
        if (queue) {
            try {
                schedule(job(order, key, digest));
            } catch (RuntimeException e) {
                kv.compareAndSet(JOB_PREFIX + key, marker, null);
                log.error("Asset rights: the marked {} of {} could not be queued", order.use(), order.document(), e);
                return new Refused("the marked video could not be prepared in the background");
            }
            log.info("Asset rights: queued the marked {} of {} ({}) for {}, {}{}", order.use(), order.document(),
                    order.type(), whom(order.recipient(), order.user()), brief(key), was == null ? "" : ", again");
        }
        return new Preparing(RETRY_AFTER);
    }

    /** When a job's marker says it was queued, or -1 for a marker not of that form. */
    static long queuedAt(String marker) {
        if (marker == null || !marker.startsWith(QUEUED)) {
            return -1;
        }
        try {
            return Long.parseLong(marker.substring(QUEUED.length()));
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /**
     * Whether a copy found under the order's key says what the order asks: a file, the order's digest,
     * watermark, purpose and text, and its person and territory where the text names them. The key
     * says so already; this holds it to what the copy itself records.
     */
    static boolean matches(Copy copy, Order order) {
        if (copy.file() == null || copy.file().getLength() == 0) {
            return false;
        }
        boolean same = copy.digest().equals(order.file().getDigest()) && copy.fingerprint().equals(order.fingerprint())
                && copy.purpose().equals(order.purpose().code()) && copy.watermark().equals(order.text());
        if (names(order.template(), "recipient")) {
            same &= copy.recipient().equals(order.recipient());
        }
        if (names(order.template(), "user")) {
            same &= copy.user().equals(order.user());
        }
        if (names(order.template(), "territory")) {
            same &= copy.territory().equals(order.territory());
        }
        return same;
    }

    /** Whether a copy is within its days. */
    boolean fresh(Copy copy) {
        return copy.made() != null && copy.made().after(before());
    }

    /**
     * The key a copy is kept under: the document, the place of the file and its digest, the policy's
     * watermark, why it is marked, the text drawn, and the person and the territory where the text
     * names them, each written as its length and itself, then hashed.
     */
    static String key(Order order) {
        return MarkedVideos.sha256("agentic-watermarked-copy-1;" + MarkedVideos.field(order.repository())
                + MarkedVideos.field(order.document()) + MarkedVideos.field(order.xpath())
                + MarkedVideos.field(order.file().getDigest()) + MarkedVideos.field(order.fingerprint())
                + MarkedVideos.field(order.purpose().code()) + MarkedVideos.field(order.text())
                + MarkedVideos.field(names(order.template(), "recipient") ? order.recipient() : "")
                + MarkedVideos.field(names(order.template(), "user") ? order.user() : "")
                + MarkedVideos.field(names(order.template(), "territory") ? order.territory() : ""));
    }

    static boolean names(String template, String name) {
        return template != null && template.contains("{" + name + "}");
    }

    private static Job job(Order order, String key, String digest) {
        return new Job(key, order.repository(), order.document(), order.type(), order.xpath(), order.use(), digest,
                order.text(), order.placement().code(), order.fingerprint(), order.recipient(), order.user(),
                order.territory(), order.purpose().code());
    }

    /** Queued now, not after the commit: a refused delivery rolls back, and its file is still to be marked. */
    void schedule(Job job) {
        WorkManager works = Framework.getService(WorkManager.class);
        if (works == null) {
            throw new IllegalStateException("the work manager is not running");
        }
        works.schedule(new VideoWatermarkWork(job), WorkManager.Scheduling.IF_NOT_SCHEDULED, false);
    }

    @Override
    public void taken(CoreSession session, String copy) {
        CoreInstance.doPrivileged(session, (Function<CoreSession, Boolean>) privileged -> WatermarkedCopies.remove(
                privileged, copy));
    }

    // ------------------------------------------------------------------ the job

    /**
     * The job for {@code job}'s key, run by {@link VideoWatermarkWork} with no transaction of its own:
     * this opens short ones, to read the source and to keep the copy, and marks the video between
     * them. It holds the key's lease while it runs, and does nothing when another holds it. Never
     * throws but a virtual machine's error: a failure is recorded, audited and answered.
     */
    void run(Job job) {
        KeyValueStore kv = store.get();
        String lease = LEASE_PREFIX + job.key();
        String token = UUID.randomUUID().toString();
        if (!kv.compareAndSet(lease, null, token, LEASE_SECONDS)) {
            log.info("Asset rights: the marked copy {} is being made by another job", brief(job.key()));
            return;
        }
        ScheduledFuture<?> renewal = renewal(kv, job.key(), token);
        try {
            make(job, kv, token);
        } catch (VirtualMachineError e) {
            throw e;
        } catch (RuntimeException | Error e) {
            log.error("Asset rights: the marked {} of {} could not be made", job.use(), job.document(), e);
            failed(job, "the video could not be marked");
        } finally {
            renewal.cancel(false);
            try {
                kv.compareAndSet(lease, token, null);
                kv.put(JOB_PREFIX + job.key(), (String) null);
            } catch (RuntimeException e) {
                log.warn("Asset rights: the lease of the marked copy {} could not be released; it ends by itself",
                        brief(job.key()), e);
            }
        }
    }

    private void make(Job job, KeyValueStore kv, String token) {
        if (kv.getString(FAILED_PREFIX + job.key()) != null) {
            return;
        }
        boolean kept = inTransaction(() -> CoreInstance.doPrivileged(job.repository(),
                (Function<CoreSession, Boolean>) privileged -> freshCopy(privileged, job.key())));
        if (kept) {
            return;
        }
        Blob source = inTransaction(() -> CoreInstance.doPrivileged(job.repository(),
                (Function<CoreSession, Blob>) privileged -> sourceFile(privileged, job)));
        if (source == null) {
            // The next request names the file the document holds now.
            log.info("Asset rights: the {} of {} changed or went before it was marked; nothing is kept", job.use(),
                    job.document());
            return;
        }
        Placement placement = Placement.of(job.placement());
        Blob marked;
        try {
            if (placement == null) {
                throw new Unavailable("the watermark's placement is not one the add-on knows");
            }
            marked = AssetWatermarks.markInBackground(source, job.text(), placement);
        } catch (Unavailable e) {
            failed(job, e.getMessage());
            return;
        }
        if (!kv.compareAndSet(LEASE_PREFIX + job.key(), token, token, LEASE_SECONDS)) {
            log.warn("Asset rights: the marked copy {} lost its lease while it was made, and is not kept",
                    brief(job.key()));
            return;
        }
        inTransaction(() -> CoreInstance.doPrivileged(job.repository(), (Function<CoreSession, Void>) privileged -> {
            if (sourceFile(privileged, job) == null) {
                log.info("Asset rights: the {} of {} changed while it was marked; nothing is kept", job.use(),
                        job.document());
                return null;
            }
            if (!freshCopy(privileged, job.key())) {
                WatermarkedCopies.keep(privileged, job, marked, clock.millis());
            }
            sweep(privileged, job);
            return null;
        }));
        log.info("Asset rights: kept the marked {} of {} ({}) for {}, {}", job.use(), job.document(), job.type(),
                whom(job.recipient(), job.user()), brief(job.key()));
    }

    /** Whether a copy within its days is kept under {@code key}; one past them is removed. */
    private boolean freshCopy(CoreSession privileged, String key) {
        Copy copy = WatermarkedCopies.find(privileged, key);
        if (copy == null) {
            return false;
        }
        if (fresh(copy)) {
            return true;
        }
        WatermarkedCopies.remove(privileged, copy.id());
        return false;
    }

    /** The file the document holds at the job's place, while it has the job's digest; {@code null} otherwise. */
    static Blob sourceFile(CoreSession privileged, Job job) {
        if (job.document() == null || !WatermarkedCopies.ID_FORM.matcher(job.document()).matches()) {
            return null;
        }
        IdRef ref = new IdRef(job.document());
        if (!privileged.exists(ref)) {
            return null;
        }
        DocumentModel doc = privileged.getDocument(ref);
        if (doc.isTrashed()) {
            return null;
        }
        try {
            Serializable value = doc.getPropertyValue(job.xpath());
            return value instanceof Blob blob && job.digest().equals(blob.getDigest()) ? blob : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** The job's failure kept, audited on its document, and logged. */
    private void failed(Job job, String reason) {
        String said = reason == null || reason.isBlank() ? "the video could not be marked" : reason;
        try {
            store.get()
                 .put(FAILED_PREFIX + job.key(), said,
                         Duration.ofMinutes(setting(FAILURE_MINUTES_PROPERTY, DEFAULT_FAILURE_MINUTES, 1,
                                 Duration.ofDays(7).toMinutes())).toSeconds());
        } catch (RuntimeException e) {
            log.error("Asset rights: the failure of the marked copy {} could not be kept", brief(job.key()), e);
        }
        log.warn("Asset rights: the marked {} of {} ({}) for {} could not be made, and is refused: {}", job.use(),
                job.document(), job.type(), whom(job.recipient(), job.user()), said);
        try {
            inTransaction(() -> CoreInstance.doPrivileged(job.repository(), (Function<CoreSession, Void>) privileged -> {
                WatermarkAudit.failed(privileged, job, said);
                return null;
            }));
        } catch (RuntimeException e) {
            log.error("Asset rights: the failure of the marked copy {} could not be audited", brief(job.key()), e);
        }
    }

    /**
     * The job's source's other copies at its place, of another digest or another watermark; and any
     * copy past its days, or kept under a watermark no policy in force has now.
     */
    void sweep(CoreSession privileged, Job job) {
        int dropped = 0;
        for (DocumentModel other : WatermarkedCopies.of(privileged, job.document(), 1000)) {
            Copy copy = WatermarkedCopies.read(other);
            boolean samePlace = job.xpath().equals(other.getPropertyValue(WatermarkedCopies.XPATH));
            if (samePlace && (!copy.digest().equals(job.digest()) || !copy.fingerprint().equals(job.fingerprint()))
                    && WatermarkedCopies.remove(privileged, copy.id())) {
                dropped++;
            }
        }
        for (String id : WatermarkedCopies.stale(privileged, before(), current())) {
            if (WatermarkedCopies.remove(privileged, id)) {
                dropped++;
            }
        }
        if (dropped > 0) {
            log.info("Asset rights: dropped {} marked cop{} of another file, watermark or day", dropped,
                    dropped == 1 ? "y" : "ies");
        }
    }

    /**
     * The copies of {@code source} that no longer match it: every one when it was removed, else each
     * whose place holds another digest now, or that was kept under another watermark than its type's.
     * Answers how many were dropped.
     */
    int drop(CoreSession privileged, String source, boolean removed) {
        List<DocumentModel> copies = WatermarkedCopies.of(privileged, source, 1000);
        if (copies.isEmpty()) {
            return 0;
        }
        IdRef ref = new IdRef(source);
        DocumentModel doc = removed || !privileged.exists(ref) ? null : privileged.getDocument(ref);
        String fingerprint = doc == null ? null : fingerprint(doc.getType());
        int dropped = 0;
        for (DocumentModel each : copies) {
            Copy copy = WatermarkedCopies.read(each);
            boolean stale = doc == null || !Objects.equals(fingerprint, copy.fingerprint())
                    || !Objects.equals(copy.digest(), digestAt(doc, each.getPropertyValue(WatermarkedCopies.XPATH)));
            if (stale && WatermarkedCopies.remove(privileged, copy.id())) {
                dropped++;
            }
        }
        return dropped;
    }

    private static String digestAt(DocumentModel doc, Serializable xpath) {
        try {
            return xpath instanceof String place && doc.getPropertyValue(place) instanceof Blob blob ? blob.getDigest()
                    : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** Each covered type with a watermark, and its watermark's fingerprint, as the policies are now. */
    Map<String, String> current() {
        AssetRightsService service = rights.get();
        Map<String, String> fingerprints = new HashMap<>();
        if (service != null) {
            for (String type : service.coveredTypes()) {
                String fingerprint = fingerprint(type);
                if (fingerprint != null) {
                    fingerprints.put(type, fingerprint);
                }
            }
        }
        return fingerprints;
    }

    /** The fingerprint of {@code type}'s watermark now, or {@code null} when its policy has none. */
    String fingerprint(String type) {
        AssetRightsService service = rights.get();
        RightsPolicy policy = service == null ? null : service.policyFor(type);
        return policy == null || policy.broken() || policy.watermark() == null ? null
                : MarkedVideos.fingerprint(type, policy.watermark());
    }

    /** The instant before which a copy is past its days. */
    private Calendar before() {
        GregorianCalendar before = new GregorianCalendar(TimeZone.getTimeZone("UTC"));
        before.setTimeInMillis(clock.millis()
                - Duration.ofDays(setting(COPY_DAYS_PROPERTY, DEFAULT_COPY_DAYS, 1, 365)).toMillis());
        return before;
    }

    /** Renews the lease, and the job's marker, every third of the lease, while the job runs. */
    private ScheduledFuture<?> renewal(KeyValueStore kv, String key, String token) {
        long every = LEASE_SECONDS / 3;
        return leases().scheduleAtFixedRate(() -> {
            try {
                if (!kv.compareAndSet(LEASE_PREFIX + key, token, token, LEASE_SECONDS)) {
                    log.warn("Asset rights: the marked copy {} lost its lease", brief(key));
                }
                kv.setTTL(JOB_PREFIX + key, QUEUED_SECONDS);
            } catch (RuntimeException e) {
                log.warn("Asset rights: the lease of the marked copy {} could not be renewed", brief(key), e);
            }
        }, every, every, TimeUnit.SECONDS);
    }

    private synchronized ScheduledExecutorService leases() {
        if (leases == null) {
            leases = Executors.newSingleThreadScheduledExecutor(task -> {
                Thread thread = new Thread(task, "agentic-watermark-leases");
                thread.setDaemon(true);
                return thread;
            });
        }
        return leases;
    }

    // ------------------------------------------------------------------ helpers

    /** A setting from {@code nuxeo.conf}, read at each call; missing, not a whole number or out of range, the default. */
    static long setting(String property, long fallback, long min, long max) {
        String value = Framework.getProperty(property);
        if (value == null || value.isBlank()) {
            return fallback;
        }
        try {
            long parsed = Long.parseLong(value.trim());
            return parsed < min || parsed > max ? fallback : parsed;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static <T> T inTransaction(Supplier<T> work) {
        return TransactionHelper.isTransactionActiveOrMarkedRollback() ? work.get()
                : TransactionHelper.runInTransaction(work);
    }

    /** The first characters of a key, for the log: enough to tell jobs apart. */
    static String brief(String key) {
        return key == null || key.length() < 12 ? String.valueOf(key) : key.substring(0, 12);
    }

    private static String whom(String recipient, String user) {
        return recipient == null || recipient.isEmpty() || recipient.equals(user) ? String.valueOf(user)
                : recipient + " (" + user + ")";
    }
}
