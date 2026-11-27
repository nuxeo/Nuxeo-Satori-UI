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
import java.util.function.BooleanSupplier;
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
import org.nuxeo.ecm.core.api.repository.RepositoryManager;
import org.nuxeo.ecm.core.blob.ManagedBlob;
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
 * dropped, by {@link WatermarkedCopiesListener}, the next job's sweep or each node's sweep every
 * {@link #SWEEP_EVERY}, as it is once it is {@value #COPY_DAYS_PROPERTY} days old.</li>
 * <li><strong>One job per key at a time, across the cluster:</strong> a job runs only while it holds
 * the key's lease in the platform's key/value store {@value #STORE}, taken by compare-and-set and
 * renewed while it runs; a job that finds it taken does nothing. A queued job's marker there keeps a
 * second request from queuing another.</li>
 * <li><strong>A failure</strong> of the video's own is kept there for
 * {@value #FAILURE_MINUTES_PROPERTY} minutes, any other for {@value #TRANSIENT_FAILURE}, none for a
 * job the work manager stopped; each is audited on the document, and answered to every request for
 * the key until then, with its reason: the unmarked file is never served, while the job runs or
 * after it fails.</li>
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
     * longer than a queue's usual wait, so that a job is queued twice only when its node stopped, or
     * its queue is an hour long; a second job of a key makes nothing while the first holds its lease,
     * or once its copy is kept.
     */
    static final Duration REQUEUE_AFTER = Duration.ofHours(1);

    /** How long a failure that is not the video's own, such as a repository that refused the copy, is kept. */
    static final long TRANSIENT_FAILURE = 5;

    static final String TRANSIENT_REASON = "the marked video could not be kept, and is tried again in a few minutes";

    /** The transaction a copy is kept in: long enough to store a feature's copy. */
    static final int KEEP_TRANSACTION_SECONDS = (int) Duration.ofHours(1).toSeconds();

    /** How often every node sweeps the copies past their days or their watermark, after a first quarter hour. */
    static final Duration SWEEP_EVERY = Duration.ofHours(6);

    /** A job's marker: this, then when it was queued, in milliseconds. */
    static final String QUEUED = "queued:";

    /** When the page is told to ask again, in seconds. */
    static final int RETRY_AFTER = 5;

    /** A key's first field: raise it when the mark is drawn otherwise. */
    static final String KEY_VERSION = "agentic-watermarked-copy-1;";

    private final Supplier<KeyValueStore> store;

    private final Supplier<AssetRightsService> rights;

    private final Clock clock;

    private ScheduledExecutorService leases;

    private ScheduledExecutorService sweeps;

    public MarkedVideosComponent() {
        this(() -> Framework.getService(KeyValueService.class).getKeyValueStore(STORE),
                () -> Framework.getService(AssetRightsService.class), Clock.systemUTC());
    }

    MarkedVideosComponent(Supplier<KeyValueStore> store, Supplier<AssetRightsService> rights, Clock clock) {
        this.store = store;
        this.rights = rights;
        this.clock = clock;
    }

    /** The sweep, on a thread of its own, apart from the leases' renewals, which a long sweep must not hold up. */
    @Override
    public void start(ComponentContext context) {
        ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(task -> {
            Thread thread = new Thread(task, "agentic-watermark-sweep");
            thread.setDaemon(true);
            return thread;
        });
        timer.scheduleWithFixedDelay(() -> {
            try {
                sweepEverywhere();
            } catch (RuntimeException e) {
                log.warn("Asset rights: the marked copies could not be swept; the next sweep tries again", e);
            }
        }, Duration.ofMinutes(15).toSeconds(), SWEEP_EVERY.toSeconds(), TimeUnit.SECONDS);
        synchronized (this) {
            sweeps = timer;
        }
    }

    @Override
    public void stop(ComponentContext context) throws InterruptedException {
        ScheduledExecutorService running;
        ScheduledExecutorService sweeping;
        synchronized (this) {
            running = leases;
            sweeping = sweeps;
            leases = null;
            sweeps = null;
        }
        if (running != null) {
            running.shutdownNow();
        }
        if (sweeping != null) {
            sweeping.shutdownNow();
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
        String digest = file.getDigest();
        boolean stored = order.xpath() != null && digest != null && !digest.isBlank();
        String key = stored ? key(order) : null;
        if (stored) {
            // A copy, a failure or a job of this key answers first: the video is long, asked before,
            // and ffprobe is not run again at each of the page's asks.
            Copy copy = inTransaction(() -> CoreInstance.doPrivileged(order.repository(),
                    (Function<CoreSession, Copy>) privileged -> WatermarkedCopies.find(privileged, key)));
            if (copy != null && !matches(copy, order)) {
                // Its key is the order's, and it does not say what the order asks: never served, and
                // dropped, so that the job makes the order's.
                log.error("Asset rights: the copy {} kept under {} does not match its order: dropped, not served",
                        copy.id(), brief(key));
                inTransaction(() -> CoreInstance.doPrivileged(order.repository(),
                        (Function<CoreSession, Boolean>) privileged -> WatermarkedCopies.remove(privileged, copy.id())));
                return queue(order, key, digest);
            }
            if (copy != null && fresh(copy)) {
                return new Marked(copy.file(), copy.id());
            }
            String failure = store.get().getString(FAILED_PREFIX + key);
            if (failure != null) {
                return new Refused(failure);
            }
            if (copy != null || store.get().getString(JOB_PREFIX + key) != null) {
                // One past its days, which a job replaces, or a job queued already.
                return queue(order, key, digest);
            }
        }
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
        if (!stored) {
            return new Refused("a long video that is not a stored file of the document cannot be marked");
        }
        return queue(order, key, digest);
    }

    /** A long video with no copy or failure kept for its key: a job queued for it, once, and {@code preparing}. */
    private Outcome queue(Order order, String key, String digest) {
        KeyValueStore kv = store.get();
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
                schedule(job(order, key, digest, marker));
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
        // The key's own version: raised whenever the mark is drawn otherwise, so that no copy drawn
        // the old way is found after an upgrade.
        return MarkedVideos.sha256(KEY_VERSION + MarkedVideos.field(order.repository())
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

    private static Job job(Order order, String key, String digest, String marker) {
        return new Job(key, order.repository(), order.document(), order.type(), order.xpath(), order.use(), digest,
                order.text(), order.placement().code(), order.fingerprint(), order.recipient(), order.user(),
                order.territory(), order.purpose().code(), marker);
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
    public void delivered(CoreSession session, Blob file) {
        if (!(file instanceof ManagedBlob stored) || stored.getKey() == null) {
            return;
        }
        CoreInstance.doPrivileged(session, (Function<CoreSession, Integer>) privileged -> {
            int dropped = 0;
            for (String id : WatermarkedCopies.holding(privileged, stored.getKey(), Purpose.DELIVERY)) {
                if (WatermarkedCopies.remove(privileged, id)) {
                    dropped++;
                }
            }
            return dropped;
        });
    }

    // ------------------------------------------------------------------ the job

    /** As {@link #run(Job, BooleanSupplier)}, never stopping. */
    void run(Job job) {
        run(job, () -> false);
    }

    /**
     * The job for {@code job}'s key, run by {@link VideoWatermarkWork} with no transaction of its own:
     * this opens short ones, to read the source and to keep the copy, and marks the video between
     * them. It holds the key's lease while it runs, and does nothing when another holds it. Never
     * throws but a virtual machine's error. The video's own failure, such as a file the tools cannot
     * mark, is kept for the configured minutes, audited and answered; anything else, such as a
     * repository that refused the copy, for {@link #TRANSIENT_FAILURE} only; and nothing is kept when
     * the work manager was stopping the job, {@code stopping}, so that the next request queues it again.
     */
    void run(Job job, BooleanSupplier stopping) {
        KeyValueStore kv = store.get();
        String lease = LEASE_PREFIX + job.key();
        String token = UUID.randomUUID().toString();
        if (!kv.compareAndSet(lease, null, token, LEASE_SECONDS)) {
            log.info("Asset rights: the marked copy {} is being made by another job", brief(job.key()));
            return;
        }
        ScheduledFuture<?> renewal = renewal(kv, job.key(), token);
        try {
            make(job, kv, token, stopping);
        } catch (VirtualMachineError e) {
            throw e;
        } catch (RuntimeException | Error e) {
            if (stopping.getAsBoolean() || Thread.currentThread().isInterrupted()) {
                log.info("Asset rights: the marked {} of {} was stopped before it was kept; asked again, it is"
                        + " queued again", job.use(), job.document());
            } else {
                log.error("Asset rights: the marked {} of {} could not be kept", job.use(), job.document(), e);
                failed(job, TRANSIENT_REASON, TRANSIENT_FAILURE);
            }
        } finally {
            renewal.cancel(false);
            try {
                kv.compareAndSet(lease, token, null);
                // Its own marker only: a request may have queued the key again since.
                kv.compareAndSet(JOB_PREFIX + job.key(), job.marker(), null);
            } catch (RuntimeException e) {
                log.warn("Asset rights: the lease of the marked copy {} could not be released; it ends by itself",
                        brief(job.key()), e);
            }
        }
    }

    private void make(Job job, KeyValueStore kv, String token, BooleanSupplier stopping) {
        if (kv.getString(FAILED_PREFIX + job.key()) != null) {
            return;
        }
        boolean kept = inTransaction(() -> CoreInstance.doPrivileged(job.repository(),
                (Function<CoreSession, Boolean>) privileged -> freshCopy(privileged, job.key())));
        if (kept) {
            return;
        }
        Source source = inTransaction(() -> CoreInstance.doPrivileged(job.repository(),
                (Function<CoreSession, Source>) privileged -> source(privileged, job)));
        if (source.unreadable()) {
            failed(job, "the video could not be read", failureMinutes());
            return;
        }
        if (source.file() == null) {
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
            marked = AssetWatermarks.markInBackground(source.file(), job.text(), placement);
        } catch (Unavailable e) {
            if (stopping.getAsBoolean() || Thread.currentThread().isInterrupted()) {
                log.info("Asset rights: the marked {} of {} was stopped while it was made; asked again, it is"
                        + " queued again", job.use(), job.document());
            } else {
                failed(job, e.getMessage(), failureMinutes());
            }
            return;
        }
        if (!kv.compareAndSet(LEASE_PREFIX + job.key(), token, token, LEASE_SECONDS)) {
            log.warn("Asset rights: the marked copy {} lost its lease while it was made, and is not kept",
                    brief(job.key()));
            return;
        }
        // A transaction long enough to store a feature's copy in the blob store.
        TransactionHelper.runInTransaction(KEEP_TRANSACTION_SECONDS, () -> CoreInstance.doPrivileged(job.repository(),
                (Function<CoreSession, Void>) privileged -> {
                    if (source(privileged, job).file() == null) {
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

    /**
     * The job's source as read: its file, while the document holds one of the job's digest at the
     * job's place; {@code unreadable} when the document is there and its place could not be read.
     */
    record Source(Blob file, boolean unreadable) {
    }

    /** The file the document holds at the job's place, while it has the job's digest. */
    static Source source(CoreSession privileged, Job job) {
        if (job.document() == null || !WatermarkedCopies.ID_FORM.matcher(job.document()).matches()) {
            return new Source(null, false);
        }
        IdRef ref = new IdRef(job.document());
        if (!privileged.exists(ref)) {
            return new Source(null, false);
        }
        DocumentModel doc = privileged.getDocument(ref);
        Serializable value;
        try {
            value = doc.getPropertyValue(job.xpath());
        } catch (RuntimeException e) {
            log.warn("Asset rights: the {} of {} could not be read at {}", job.use(), job.document(), job.xpath(), e);
            return new Source(null, true);
        }
        return new Source(value instanceof Blob blob && job.digest().equals(blob.getDigest()) ? blob : null, false);
    }

    private static long failureMinutes() {
        return setting(FAILURE_MINUTES_PROPERTY, DEFAULT_FAILURE_MINUTES, 1, Duration.ofDays(7).toMinutes());
    }

    /** The job's failure kept for {@code minutes}, audited on its document, and logged. */
    private void failed(Job job, String reason, long minutes) {
        String said = reason == null || reason.isBlank() ? "the video could not be marked" : reason;
        try {
            store.get().put(FAILED_PREFIX + job.key(), said, Duration.ofMinutes(minutes).toSeconds());
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
     * After a job: its source's other copies at its place, of another digest or another watermark; and
     * up to {@value WatermarkedCopies#SWEEP_LIMIT} copies anywhere past their days, or kept under a
     * watermark no policy in force has now.
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
        dropped += sweepStale(privileged, 1);
        if (dropped > 0) {
            log.info("Asset rights: dropped {} marked cop{} of another file, watermark or day", dropped,
                    dropped == 1 ? "y" : "ies");
        }
    }

    /**
     * Copies past their days, or kept under a watermark no policy in force has now, removed, up to
     * {@code rounds} times {@value WatermarkedCopies#SWEEP_LIMIT}. With the rights service not running,
     * only those past their days: no policy can be read, which is not every policy gone.
     */
    int sweepStale(CoreSession privileged, int rounds) {
        int dropped = 0;
        for (int round = 0; round < rounds; round++) {
            int now = 0;
            for (String id : WatermarkedCopies.stale(privileged, before(), current())) {
                if (WatermarkedCopies.remove(privileged, id)) {
                    now++;
                }
            }
            dropped += now;
            if (now < WatermarkedCopies.SWEEP_LIMIT) {
                break;
            }
        }
        return dropped;
    }

    /**
     * Every repository's stale copies dropped, as the timer does every {@link #SWEEP_EVERY}: so a copy
     * past its days goes whether or not a long video is marked again. Answers how many went.
     */
    int sweepEverywhere() {
        RepositoryManager repositories = Framework.getService(RepositoryManager.class);
        if (repositories == null) {
            return 0;
        }
        int dropped = 0;
        for (String repository : repositories.getRepositoryNames()) {
            try {
                dropped += TransactionHelper.runInTransaction(() -> CoreInstance.doPrivileged(repository,
                        (Function<CoreSession, Integer>) privileged -> sweepStale(privileged, 10)));
            } catch (RuntimeException e) {
                log.warn("Asset rights: the marked copies of {} could not be swept; the next sweep tries again",
                        repository, e);
            }
        }
        if (dropped > 0) {
            log.info("Asset rights: the sweep dropped {} marked cop{} past their days or watermark", dropped,
                    dropped == 1 ? "y" : "ies");
        }
        return dropped;
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
        // With the rights service not running, no watermark can be read: the digests alone decide.
        boolean policies = rights.get() != null;
        int dropped = 0;
        for (DocumentModel each : copies) {
            Copy copy = WatermarkedCopies.read(each);
            boolean stale = doc == null || policies && !Objects.equals(fingerprint, copy.fingerprint())
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

    /**
     * Each covered type with a watermark, and its watermark's fingerprint, as the policies are now;
     * {@code null} when the rights service is not running, so that no copy is taken for stale then.
     */
    Map<String, String> current() {
        AssetRightsService service = rights.get();
        if (service == null) {
            return null;
        }
        Map<String, String> fingerprints = new HashMap<>();
        for (String type : service.coveredTypes()) {
            String fingerprint = fingerprint(type);
            if (fingerprint != null) {
                fingerprints.put(type, fingerprint);
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
