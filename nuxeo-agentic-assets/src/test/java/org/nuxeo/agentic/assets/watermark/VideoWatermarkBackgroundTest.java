/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayInputStream;
import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.CountDownLatch;
import java.util.function.Function;

import javax.inject.Inject;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.agentic.assets.review.AssetsAuditFeature;
import org.nuxeo.agentic.assets.review.AuditAccess;
import org.nuxeo.agentic.assets.rights.AssetRightsComponent;
import org.nuxeo.agentic.assets.rights.AssetRightsService;
import org.nuxeo.agentic.assets.rights.RightsPolicyDescriptor;
import org.nuxeo.agentic.assets.rights.Watermark;
import org.nuxeo.common.xmap.XMap;
import org.nuxeo.ecm.automation.AutomationService;
import org.nuxeo.ecm.automation.OperationContext;
import org.nuxeo.ecm.automation.OperationException;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.impl.UserPrincipal;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.blob.ManagedBlob;
import org.nuxeo.ecm.core.io.download.DownloadService;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.core.test.annotations.Granularity;
import org.nuxeo.ecm.core.test.annotations.RepositoryConfig;
import org.nuxeo.ecm.core.event.EventService;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.ecm.core.work.api.WorkManager;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.ecm.core.query.sql.model.QueryBuilder;
import org.nuxeo.ecm.core.query.sql.model.Predicates;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.api.login.LoginComponent;
import org.nuxeo.runtime.kv.KeyValueService;
import org.nuxeo.runtime.kv.KeyValueStore;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.test.runner.TransactionalFeature;
import org.nuxeo.runtime.transaction.TransactionHelper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * A long video marked in the background, since 0.6.0, in a real Nuxeo runtime: the work manager, the
 * key/value store, the repository on H2, the download service evaluating the add-on's permission
 * through Nashorn, {@code Asset.GetWatermarked} run through Automation, the platform's audit, and a
 * stand-in for the platform's video tools ({@link StandInVideoMarker}), since ffmpeg is not on every
 * build machine. The policy marks every download of an {@code AcmeVideo}'s original, its text naming
 * the reader ({@code test-watermark-policy-contrib.xml}). What a server with ffmpeg does in the
 * background is {@link VideoWatermarkTest}'s, where it is installed.
 */
@RunWith(FeaturesRunner.class)
@Features({ CoreFeature.class, AssetsAuditFeature.class })
@RepositoryConfig(cleanup = Granularity.METHOD)
@Deploy("org.nuxeo.runtime.kv")
@Deploy("org.nuxeo.ecm.automation.core")
@Deploy("org.nuxeo.ecm.platform.tag:OSGI-INF/faceted-tag-service-core-types.xml")
@Deploy("org.nuxeo.ecm.platform.picture.core:OSGI-INF/picture-schemas-contrib.xml")
@Deploy("org.nuxeo.ecm.platform.video:OSGI-INF/core-types-contrib.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-rights-service.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-rights-download-permission.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-watermark-operations-contrib.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-watermarked-copies-types.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-video-watermark-service.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-video-model-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-video-marker-standin-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-watermark-policy-contrib.xml")
public class VideoWatermarkBackgroundTest {

    private static final NuxeoPrincipal OLGA = new UserPrincipal("olga", List.of("members"), false, false);

    private static final NuxeoPrincipal PABLO = new UserPrincipal("pablo", List.of("members"), false, false);

    private static final NuxeoPrincipal ADMINISTRATOR = new UserPrincipal("Administrator", List.of("administrators"),
            false, true);

    /** The policy's text, for a reader. */
    private static final String TEXT = "ACME OUTDOOR · %s";

    @Inject
    protected CoreSession session;

    @Inject
    protected TransactionalFeature transactions;

    @Inject
    protected AutomationService automation;

    @Inject
    protected DownloadService downloads;

    /** A REST operation context, as the REST API's is: its answer's status, set by the operation. */
    public static class RestContext extends OperationContext {

        int status = 200;

        public RestContext(CoreSession session) {
            super(session);
        }

        public void setHttpStatus(int status) {
            this.status = status;
        }
    }

    /** What the operation answered: its status, and its file, or its JSON while it is being prepared. */
    record Answer(int status, Blob file, JsonNode json) {

        String text() {
            return StandInVideoMarker.text(file);
        }
    }

    @Before
    public void setUp() {
        StandInVideoMarker.reset();
        DocumentModel folder = session.createDocument(session.createDocumentModel("/", "videos", "Folder"));
        ACP acp = folder.getACP();
        ACL local = acp.getOrCreateACL();
        local.add(new ACE("members", "Read", true));
        session.setACP(folder.getRef(), acp, true);
        commit();
    }

    @After
    public void tearDown() throws Exception {
        CountDownLatch held = StandInVideoMarker.gate;
        if (held != null) {
            held.countDown();
        }
        Framework.getProperties().remove(MarkedVideosComponent.BYTES_PROPERTY);
        Framework.getProperties().remove(MarkedVideosComponent.SECONDS_PROPERTY);
        transactions.nextTransaction();
        StandInVideoMarker.reset();
    }

    // ------------------------------------------------------------------ in the request, or in the background

    @Test
    public void aShortVideoIsMarkedInTheRequestAndNotKept() throws Exception {
        String video = video("short", 10, 200);
        Answer answer = ask(video, OLGA);
        assertEquals(200, answer.status());
        assertTrue(answer.text(), answer.text().startsWith(marked("olga")));
        assertEquals("marked in the request's own thread", List.of(Thread.currentThread().getName()),
                StandInVideoMarker.threads);
        awaitJobs();
        assertEquals("no job", 1, StandInVideoMarker.marks.get());
        assertEquals("nothing kept", 0, copies());
    }

    @Test
    public void aLongVideoIsMarkedInTheBackgroundAndItsCopyReused() throws Exception {
        String video = video("long", 600, 200);
        Answer first = ask(video, OLGA);
        assertEquals(202, first.status());
        assertEquals("preparing", first.json().get("status").asText());
        assertEquals("original", first.json().get("use").asText());
        assertEquals(MarkedVideosComponent.RETRY_AFTER, first.json().get("retryAfter").asInt());
        assertFalse("nothing is marked in the request's thread",
                StandInVideoMarker.threads.contains(Thread.currentThread().getName()));

        awaitJobs();
        assertEquals(1, StandInVideoMarker.marks.get());
        assertNotEquals("marked on the work manager's thread", Thread.currentThread().getName(),
                StandInVideoMarker.threads.get(0));
        assertEquals(1, copies());

        Answer second = ask(video, OLGA);
        assertEquals(200, second.status());
        assertTrue(second.text(), second.text().startsWith(marked("olga")));
        assertFalse("handed over as bytes, under no stored file's key", second.file() instanceof ManagedBlob);
        assertEquals("the ready copy is reused: marked once", 1, StandInVideoMarker.marks.get());
    }

    @Test
    public void aVideoOverTheBytesSetIsMarkedInTheBackgroundWithoutAProbe() throws Exception {
        Framework.getProperties().setProperty(MarkedVideosComponent.BYTES_PROPERTY, "1000");
        String video = video("heavy", 5, 5000);
        assertEquals(202, ask(video, OLGA).status());
        assertEquals("over the bytes, ffprobe is not asked in the request", 0, StandInVideoMarker.probes.get());
        awaitJobs();
        assertEquals(200, ask(video, OLGA).status());
    }

    @Test
    public void theSecondsSetDecideWhatIsLong() throws Exception {
        Framework.getProperties().setProperty(MarkedVideosComponent.SECONDS_PROPERTY, "900");
        String video = video("long", 600, 200);
        assertEquals("600 seconds is short when 900 is set", 200, ask(video, OLGA).status());
    }

    // ------------------------------------------------------------------ one job

    @Test
    public void aSecondRequestReusesTheJob() throws Exception {
        CountDownLatch gate = new CountDownLatch(1);
        StandInVideoMarker.gate = gate;
        String video = video("long", 600, 200);
        assertEquals(202, ask(video, OLGA).status());
        assertEquals(202, ask(video, OLGA).status());
        assertEquals(202, ask(video, OLGA).status());
        gate.countDown();
        awaitJobs();
        assertEquals("one job for three requests", 1, StandInVideoMarker.marks.get());
        assertEquals(1, copies());
        assertEquals(200, ask(video, OLGA).status());
        assertEquals(1, StandInVideoMarker.marks.get());
    }

    @Test
    public void aJobWhoseKeyAnotherNodeHoldsMakesNothing() throws Exception {
        String video = video("long", 600, 200);
        String key = key(video, "olga");
        KeyValueStore kv = Framework.getService(KeyValueService.class).getKeyValueStore(MarkedVideosComponent.STORE);
        kv.put(MarkedVideosComponent.LEASE_PREFIX + key, "another node", 120);
        assertEquals(202, ask(video, OLGA).status());
        awaitJobs();
        assertEquals("the other node's job holds the key: this one marks nothing", 0, StandInVideoMarker.marks.get());
        assertEquals(0, copies());
        assertNotNull("and leaves the job's marker to its holder", kv.getString(MarkedVideosComponent.JOB_PREFIX + key));
        assertEquals("still being prepared, and not queued again", 202, ask(video, OLGA).status());
        awaitJobs();
        assertEquals(0, StandInVideoMarker.marks.get());

        // The other node done, its lease and marker gone, with nothing kept: the next request queues it.
        kv.put(MarkedVideosComponent.LEASE_PREFIX + key, (String) null);
        kv.put(MarkedVideosComponent.JOB_PREFIX + key, (String) null);
        assertEquals(202, ask(video, OLGA).status());
        awaitJobs();
        assertEquals(1, StandInVideoMarker.marks.get());
        assertEquals(200, ask(video, OLGA).status());
    }

    @Test
    public void aJobQueuedLongAgoWithNoLeaseIsQueuedAgain() throws Exception {
        String video = video("long", 600, 200);
        String key = key(video, "olga");
        KeyValueStore kv = Framework.getService(KeyValueService.class).getKeyValueStore(MarkedVideosComponent.STORE);
        // A job its node queued, then stopped before running it.
        long longAgo = System.currentTimeMillis() - MarkedVideosComponent.REQUEUE_AFTER.toMillis() - 1000;
        kv.put(MarkedVideosComponent.JOB_PREFIX + key, MarkedVideosComponent.QUEUED + longAgo, 3600);
        assertEquals(202, ask(video, OLGA).status());
        awaitJobs();
        assertEquals(1, StandInVideoMarker.marks.get());
        assertEquals(200, ask(video, OLGA).status());
    }

    /** A job queued a moment ago, waiting its turn on some node: a request queues no other. */
    @Test
    public void aJobQueuedAMomentAgoIsNotQueuedAgain() throws Exception {
        String video = video("long", 600, 200);
        String key = key(video, "olga");
        KeyValueStore kv = Framework.getService(KeyValueService.class).getKeyValueStore(MarkedVideosComponent.STORE);
        kv.put(MarkedVideosComponent.JOB_PREFIX + key, MarkedVideosComponent.QUEUED + System.currentTimeMillis(), 3600);
        assertEquals(202, ask(video, OLGA).status());
        assertEquals(202, ask(video, PABLO).status());
        awaitJobs();
        assertEquals("pablo's job ran, and olga's was left to the one queued", 1, StandInVideoMarker.marks.get());
        assertTrue(StandInVideoMarker.text(copyFile()).startsWith(marked("pablo")));
    }

    /** A job run for a key whose copy is kept already, as a second job queued on another node: it marks nothing. */
    @Test
    public void aJobForAKeptCopyMakesNothing() throws Exception {
        String video = video("long", 600, 200);
        assertEquals(202, ask(video, OLGA).status());
        awaitJobs();
        assertEquals(1, StandInVideoMarker.marks.get());
        schedule(job(video, "olga"));
        awaitJobs();
        assertEquals(1, StandInVideoMarker.marks.get());
        assertEquals(1, copies());
    }

    /** A job run while its key's failure is kept, as one queued before it failed: it marks nothing. */
    @Test
    public void aJobForAKeptFailureMakesNothing() throws Exception {
        StandInVideoMarker.failWith = "the stand-in failed";
        String video = video("long", 600, 200);
        assertEquals(202, ask(video, OLGA).status());
        awaitJobs();
        StandInVideoMarker.failWith = null;
        schedule(job(video, "olga"));
        awaitJobs();
        assertEquals(0, StandInVideoMarker.marks.get());
        assertEquals(0, copies());
    }

    /** A job whose file changed before it ran marks nothing: the next request names the file the document holds. */
    @Test
    public void aJobWhoseSourceChangedMakesNothing() throws Exception {
        String video = video("long", 600, 200);
        MarkedVideos.Job before = job(video, "olga");
        DocumentModel doc = session.getDocument(new IdRef(video));
        doc.setPropertyValue("file:content", (Serializable) StandInVideoMarker.video("recut", 700, 200));
        session.saveDocument(doc);
        commit();
        schedule(before);
        awaitJobs();
        assertEquals(0, StandInVideoMarker.marks.get());
        assertEquals(0, copies());
    }

    // ------------------------------------------------------------------ for whom

    @Test
    public void aCopyKeyedToAnotherRecipientIsNeverServed() throws Exception {
        String video = video("long", 600, 200);
        assertEquals(202, ask(video, OLGA).status());
        awaitJobs();
        assertEquals(1, copies());

        Answer pablos = ask(video, PABLO);
        assertEquals("olga's copy is not pablo's", 202, pablos.status());
        awaitJobs();
        assertEquals(2, StandInVideoMarker.marks.get());
        assertEquals(2, copies());
        assertTrue(ask(video, PABLO).text().startsWith(marked("pablo")));
        assertTrue(ask(video, OLGA).text().startsWith(marked("olga")));
    }

    /**
     * A copy found under someone's key that records another person is never served to them: the key
     * names the person, and the copy's own record is held to it too. It is dropped, and their own made.
     */
    @Test
    public void aCopyUnderTheKeyThatNamesAnotherPersonIsNeverServedAndIsReplaced() throws Exception {
        String video = video("long", 600, 200);
        assertEquals(202, ask(video, OLGA).status());
        awaitJobs();
        // Olga's copy, written under pablo's key.
        String pablos = key(video, "pablo");
        CoreInstance.doPrivileged(session, (Function<CoreSession, Void>) privileged -> {
            DocumentModel copy = privileged.query("SELECT * FROM " + WatermarkedCopies.TYPE).get(0);
            copy.setPropertyValue(WatermarkedCopies.KEY, pablos);
            privileged.saveDocument(copy);
            return null;
        });
        commit();
        // The platform's own work on the edited copy, as its text's extraction, done first.
        awaitJobs();
        assertEquals("not olga's: being made for pablo", 202, ask(video, PABLO).status());
        awaitJobs();
        assertEquals("olga's copy under the wrong key is gone", 1, copies());
        assertTrue(ask(video, PABLO).text().startsWith(marked("pablo")));
    }

    /** A copy whose file is gone is not served: it is dropped, and made again. */
    @Test
    public void aCopyWithNoFileIsReplaced() throws Exception {
        String video = video("long", 600, 200);
        assertEquals(202, ask(video, OLGA).status());
        awaitJobs();
        CoreInstance.doPrivileged(session, (Function<CoreSession, Void>) privileged -> {
            DocumentModel copy = privileged.query("SELECT * FROM " + WatermarkedCopies.TYPE).get(0);
            copy.setPropertyValue(WatermarkedCopies.CONTENT, null);
            privileged.saveDocument(copy);
            return null;
        });
        commit();
        awaitJobs();
        assertEquals(202, ask(video, OLGA).status());
        awaitJobs();
        assertEquals(2, StandInVideoMarker.marks.get());
        assertTrue(ask(video, OLGA).text().startsWith(marked("olga")));
    }

    /** Asked again while it is prepared, and once it is ready, the video is not read by ffprobe again. */
    @Test
    public void aLongVideoAskedAgainIsNotProbedAgain() throws Exception {
        CountDownLatch gate = new CountDownLatch(1);
        StandInVideoMarker.gate = gate;
        String video = video("long", 600, 200);
        assertEquals(202, ask(video, OLGA).status());
        assertEquals(202, ask(video, OLGA).status());
        gate.countDown();
        awaitJobs();
        assertEquals(200, ask(video, OLGA).status());
        assertEquals("by the first request and by its job, and by no request after", 2,
                StandInVideoMarker.probes.get());
    }

    /**
     * The copies past their days, or kept under a watermark no policy has now, are dropped by the
     * sweep every node runs on a timer, whether or not a long video is marked again.
     */
    @Test
    public void theSweepDropsCopiesPastTheirDaysOrTheirWatermark() throws Exception {
        String old = video("old", 600, 200);
        String other = video("other", 600, 200);
        String kept = video("kept", 600, 200);
        for (String video : List.of(old, other, kept)) {
            assertEquals(202, ask(video, OLGA).status());
        }
        awaitJobs();
        assertEquals(3, copies());
        CoreInstance.doPrivileged(session, (Function<CoreSession, Void>) privileged -> {
            for (DocumentModel copy : privileged.query("SELECT * FROM " + WatermarkedCopies.TYPE)) {
                String source = (String) copy.getPropertyValue(WatermarkedCopies.SOURCE);
                if (source.equals(old)) {
                    GregorianCalendar made = new GregorianCalendar(TimeZone.getTimeZone("UTC"));
                    made.add(GregorianCalendar.DAY_OF_MONTH, -30);
                    copy.setPropertyValue(WatermarkedCopies.MADE, made);
                } else if (source.equals(other)) {
                    copy.setPropertyValue(WatermarkedCopies.FINGERPRINT, "a watermark no policy has");
                } else {
                    continue;
                }
                privileged.saveDocument(copy);
            }
            return null;
        });
        commit();
        awaitJobs();
        MarkedVideosComponent videos = (MarkedVideosComponent) Framework.getService(MarkedVideos.class);
        assertEquals(2, videos.sweepEverywhere());
        commit();
        assertEquals(1, copies());
        assertTrue(StandInVideoMarker.text(copyFile()).contains("STAND-IN VIDEO kept"));
    }

    /**
     * A copy the repository will not keep is not the video's failure: it is answered for a few
     * minutes only, with that reason, and the original is not served meanwhile.
     */
    @Test
    public void aCopyThatCannotBeKeptIsRefusedForAFewMinutesOnly() throws Exception {
        StandInVideoMarker.unreadableOutput = true;
        String video = video("long", 600, 200);
        assertEquals(202, ask(video, OLGA).status());
        awaitJobs();
        NuxeoException refusal = refused(video, OLGA);
        assertEquals(409, refusal.getStatusCode());
        assertTrue(refusal.getMessage(), refusal.getMessage().contains(MarkedVideosComponent.TRANSIENT_REASON));
        assertFalse(downloads(video, OLGA));
        assertEquals(0, copies());
    }

    /**
     * The folder the copies are kept in is refused every rendition, as its tree's zip, to an
     * administrator too, holding no copy yet; and a folder holding a copy, the root here, with no
     * asset in the repository, is refused its renditions as one holding an asset is.
     */
    @Test
    public void theCopiesFolderAndAFolderHoldingACopyAreRefusedTheirRenditions() throws Exception {
        Blob zip = new org.nuxeo.ecm.core.api.impl.blob.ByteArrayBlob(new byte[] { 1 }, "application/zip");
        Map<String, java.io.Serializable> export = Map.of("rendition", "zipTreeExport");
        DocumentModel folder = CoreInstance.doPrivileged(session,
                (Function<CoreSession, DocumentModel>) WatermarkedCopies::container);
        commit();
        assertFalse("the copies' folder, empty", check(ADMINISTRATOR, folder, null, zip, export));
        DocumentModel root = session.getRootDocument();
        assertTrue("no asset and no copy below the root yet", check(ADMINISTRATOR, root, null, zip, export));

        MarkedVideos.Job job = new MarkedVideos.Job("0".repeat(64), session.getRepositoryName(), "no-such-document",
                "AcmeVideo", "file:content", "original", "digest", "ACME OUTDOOR · olga", "bottom-right",
                "fingerprint", "olga", "olga", "", "download", MarkedVideosComponent.QUEUED + "0");
        CoreInstance.doPrivileged(session, (Function<CoreSession, DocumentModel>) privileged -> WatermarkedCopies.keep(
                privileged, job, StandInVideoMarker.video("a copy", 600, 200), System.currentTimeMillis()));
        commit();
        assertFalse("the root, which holds a copy", check(ADMINISTRATOR, root, null, zip, export));
        assertFalse(check(ADMINISTRATOR, folder, null, zip, export));
    }

    // ------------------------------------------------------------------ dropped

    @Test
    public void theSourceChangingDropsTheCopy() throws Exception {
        String video = video("long", 600, 200);
        assertEquals(202, ask(video, OLGA).status());
        awaitJobs();
        assertEquals(1, copies());

        DocumentModel doc = session.getDocument(new IdRef(video));
        doc.setPropertyValue("file:content", (Serializable) StandInVideoMarker.video("recut", 700, 200));
        session.saveDocument(doc);
        commit();
        awaitJobs();
        assertEquals("the copy of the file it no longer holds is dropped", 0, copies());

        assertEquals("never the copy of the old file", 202, ask(video, OLGA).status());
        awaitJobs();
        String served = ask(video, OLGA).text();
        assertTrue(served, served.startsWith(marked("olga")));
        assertTrue(served, served.contains("STAND-IN VIDEO recut"));
    }

    @Test
    public void theSourceRemovedDropsItsCopies() throws Exception {
        String video = video("long", 600, 200);
        assertEquals(202, ask(video, OLGA).status());
        awaitJobs();
        assertEquals(1, copies());
        session.removeDocument(new IdRef(video));
        commit();
        awaitJobs();
        assertEquals(0, copies());
    }

    @Test
    public void thePolicyChangingDropsTheCopy() throws Exception {
        String video = video("long", 600, 200);
        assertEquals(202, ask(video, OLGA).status());
        awaitJobs();
        assertEquals(1, copies());

        RightsPolicyDescriptor revised = policy("""
                <policy type="AcmeVideo">
                  <rightsEnd xpath="dc:expired" />
                  <channels xpath="acmeasset:channels" />
                  <original channel="Print" />
                  <rendition name="thumbnail" preview="true" />
                  <watermark text="ACME OUTDOOR · REVISED · {recipient}" placement="bottom-right">
                    <downloads>
                      <original />
                    </downloads>
                  </watermark>
                </policy>""");
        AssetRightsComponent rights = (AssetRightsComponent) Framework.getService(AssetRightsService.class);
        rights.registerContribution(revised, "policies", null);
        try {
            assertEquals("the copy made under the watermark before is not served", 202, ask(video, OLGA).status());
            awaitJobs();
            assertEquals("and the next job's sweep drops it", 1, copies());
            String served = ask(video, OLGA).text();
            assertTrue(served, served.startsWith(StandInVideoMarker.MARKED + "ACME OUTDOOR · REVISED · olga|"));
        } finally {
            rights.unregisterContribution(revised, "policies", null);
        }
    }

    // ------------------------------------------------------------------ never the original

    @Test
    public void aFailedJobRefusesWithItsReasonIsAuditedAndTheOriginalIsNeverServed() throws Exception {
        StandInVideoMarker.failWith = "the stand-in could not encode the video";
        String video = video("long", 600, 200);
        Answer pending = ask(video, OLGA);
        assertEquals(202, pending.status());
        assertFalse("while it is pending, the original is refused", downloads(video, OLGA));
        assertFalse(downloads(video, ADMINISTRATOR));

        awaitJobs();
        NuxeoException refusal = refused(video, OLGA);
        assertEquals(409, refusal.getStatusCode());
        assertTrue(refusal.getMessage(),
                refusal.getMessage().contains("watermark-unavailable: the stand-in could not encode the video"));
        assertFalse("after it failed, the original is refused", downloads(video, OLGA));
        assertFalse(downloads(video, ADMINISTRATOR));
        assertEquals(0, copies());

        // Audited on the video, with who asked and why.
        List<LogEntry> entries = audited(video);
        assertEquals(1, entries.size());
        assertEquals("olga", entries.get(0).getPrincipalName());
        assertEquals("assetRights", entries.get(0).getCategory());
        Map<String, Object> extended = AuditAccess.extended(entries.get(0));
        assertEquals("original", extended.get("use"));
        assertEquals("the stand-in could not encode the video", extended.get("reason"));
        assertEquals("download", extended.get("purpose"));

        // Refused while the failure is kept: no second job.
        StandInVideoMarker.failWith = null;
        refused(video, OLGA);
        awaitJobs();
        assertEquals(0, StandInVideoMarker.marks.get());
        assertEquals(0, copies());
    }

    /** An entry of the failure's name with no boolean mark, as {@code Event.Fire} would fire one, is not audited. */
    @Test
    public void anEntryFiredUnderTheFailuresNameWithoutItsMarkIsNotAudited() {
        String video = video("long", 600, 200);
        DocumentEventContext context = new DocumentEventContext(session, OLGA, session.getDocument(new IdRef(video)));
        context.setProperty(WatermarkAudit.MARK, "true");
        Framework.getService(EventService.class).fireEvent(context.newEvent(WatermarkAudit.EVENT));
        commit();
        awaitJobs();
        assertEquals(0, audited(video).size());
    }

    @Test
    public void withoutTheVideoToolsALongVideoIsRefusedAtOnceAndNoJobIsQueued() throws Exception {
        StandInVideoMarker.available = false;
        String video = video("long", 600, 200);
        NuxeoException refusal = refused(video, OLGA);
        assertEquals(409, refusal.getStatusCode());
        assertTrue(refusal.getMessage(), refusal.getMessage().contains("ffmpeg"));
        awaitJobs();
        assertEquals(0, StandInVideoMarker.marks.get());
        KeyValueStore kv = Framework.getService(KeyValueService.class).getKeyValueStore(MarkedVideosComponent.STORE);
        assertNull(kv.getString(MarkedVideosComponent.JOB_PREFIX + key(video, "olga")));
    }

    /** A kept copy's file, wherever else it is asked for, is refused to everyone, an administrator included. */
    @Test
    public void aKeptCopysFileIsRefusedByItsDocumentAndByItsStoredFile() throws Exception {
        String video = video("long", 600, 200);
        assertEquals(202, ask(video, OLGA).status());
        awaitJobs();
        DocumentModel copy = CoreInstance.doPrivileged(session,
                (Function<CoreSession, DocumentModel>) privileged -> privileged.query(
                        "SELECT * FROM " + WatermarkedCopies.TYPE).get(0));
        Blob stored = (Blob) copy.getPropertyValue(WatermarkedCopies.CONTENT);
        assertTrue(stored instanceof ManagedBlob);
        for (NuxeoPrincipal person : List.of(OLGA, ADMINISTRATOR)) {
            assertFalse("by its document, to " + person.getName(),
                    check(person, copy, WatermarkedCopies.CONTENT, stored));
            assertFalse("by its stored file, with no document, to " + person.getName(),
                    check(person, null, null, stored));
        }
        assertFalse("no one but the system reads its folder",
                CoreInstance.getCoreSession(session.getRepositoryName(), OLGA).exists(copy.getRef()));
    }

    // ------------------------------------------------------------------ helpers

    private String video(String name, long seconds, int bytes) {
        DocumentModel video = session.createDocumentModel("/videos", name, "AcmeVideo");
        video.setPropertyValue("dc:title", name);
        video.setPropertyValue("acmeasset:channels", (Serializable) List.of("Print", "E-commerce"));
        GregorianCalendar end = new GregorianCalendar(TimeZone.getTimeZone("UTC"));
        end.add(GregorianCalendar.DAY_OF_MONTH, 30);
        video.setPropertyValue("dc:expired", end);
        video.setPropertyValue("file:content", (Serializable) StandInVideoMarker.video(name, seconds, bytes));
        String id = session.createDocument(video).getId();
        commit();
        return id;
    }

    private static String marked(String reader) {
        return StandInVideoMarker.MARKED + String.format(TEXT, reader) + "|bottom-right|";
    }

    private Answer ask(String id, NuxeoPrincipal person) throws OperationException {
        CoreSession as = CoreInstance.getCoreSession(session.getRepositoryName(), person);
        try (RestContext ctx = new RestContext(as)) {
            ctx.setInput(as.getDocument(new IdRef(id)));
            Map<String, Object> params = new HashMap<>();
            params.put("use", "original");
            Blob blob = (Blob) automation.run(ctx, GetWatermarkedOperation.ID, params);
            JsonNode json = "application/json".equals(blob.getMimeType())
                    ? new ObjectMapper().readTree(StandInVideoMarker.text(blob)) : null;
            if ((ctx.status == 202) != (json != null)) {
                fail("a 202 is the preparing answer, and only it: " + ctx.status + " " + json);
            }
            return new Answer(ctx.status, blob, json);
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    /** The refusal the operation answers, its transaction rolled back as a request's is. */
    private NuxeoException refused(String id, NuxeoPrincipal person) {
        try {
            Answer answer = ask(id, person);
            fail("served, where it should be refused: " + answer.status() + " "
                    + (answer.json() == null ? answer.text() : answer.json()));
        } catch (OperationException e) {
            rollback();
            for (Throwable cause = e; cause != null; cause = cause.getCause()) {
                if (cause instanceof NuxeoException refusal) {
                    return refusal;
                }
            }
            throw new AssertionError(e);
        } catch (NuxeoException e) {
            rollback();
            return e;
        }
        return null;
    }

    private static void rollback() {
        TransactionHelper.setTransactionRollbackOnly();
        TransactionHelper.commitOrRollbackTransaction();
        TransactionHelper.startTransaction();
    }

    private boolean downloads(String id, NuxeoPrincipal person) {
        DocumentModel doc = session.getDocument(new IdRef(id));
        return check(person, doc, "file:content", (Blob) doc.getPropertyValue("file:content"));
    }

    private boolean check(NuxeoPrincipal person, DocumentModel doc, String xpath, Blob blob) {
        return check(person, doc, xpath, blob, Map.of());
    }

    /** A download asked of the platform's download service as {@code person}; a rendition's name in {@code infos}. */
    private boolean check(NuxeoPrincipal person, DocumentModel doc, String xpath, Blob blob,
            Map<String, java.io.Serializable> infos) {
        LoginComponent.pushPrincipal(person);
        try {
            return downloads.checkPermission(doc, xpath, blob, infos.isEmpty() ? "download" : "rendition", infos);
        } finally {
            LoginComponent.popPrincipal();
        }
    }

    /** The key a copy for {@code reader} of the video's original is kept under. */
    private String key(String id, String reader) {
        DocumentModel doc = session.getDocument(new IdRef(id));
        Watermark watermark = Framework.getService(AssetRightsService.class).policyFor("AcmeVideo").watermark();
        String text = watermark.text(reader, reader, LocalDate.now(ZoneOffset.UTC), "");
        return MarkedVideosComponent.key(MarkedVideos.Order.of(doc, "original", "file:content",
                (Blob) doc.getPropertyValue("file:content"), watermark, text, reader, reader, "",
                MarkedVideos.Purpose.DOWNLOAD));
    }

    /** The job a request for {@code reader}'s copy of the video's original queues. */
    private MarkedVideos.Job job(String id, String reader) {
        DocumentModel doc = session.getDocument(new IdRef(id));
        Watermark watermark = Framework.getService(AssetRightsService.class).policyFor("AcmeVideo").watermark();
        String text = watermark.text(reader, reader, LocalDate.now(ZoneOffset.UTC), "");
        Blob file = (Blob) doc.getPropertyValue("file:content");
        MarkedVideos.Order order = MarkedVideos.Order.of(doc, "original", "file:content", file, watermark, text, reader,
                reader, "", MarkedVideos.Purpose.DOWNLOAD);
        return new MarkedVideos.Job(MarkedVideosComponent.key(order), doc.getRepositoryName(), doc.getId(),
                doc.getType(), "file:content", "original", file.getDigest(), text, watermark.placement().code(),
                order.fingerprint(), reader, reader, "", "download", MarkedVideosComponent.QUEUED + "0");
    }

    private static void schedule(MarkedVideos.Job job) {
        Framework.getService(WorkManager.class).schedule(new VideoWatermarkWork(job), WorkManager.Scheduling.ENQUEUE,
                false);
    }

    /** The one kept copy's file. */
    private Blob copyFile() {
        return CoreInstance.doPrivileged(session, (Function<CoreSession, Blob>) privileged -> (Blob) privileged.query(
                "SELECT * FROM " + WatermarkedCopies.TYPE).get(0).getPropertyValue(WatermarkedCopies.CONTENT));
    }

    private long copies() {
        return CoreInstance.doPrivileged(session, (Function<CoreSession, Long>) privileged -> (long) privileged.query(
                "SELECT * FROM " + WatermarkedCopies.TYPE).size());
    }

    private List<LogEntry> audited(String id) {
        QueryBuilder query = new QueryBuilder();
        query.predicate(Predicates.eq("eventId", WatermarkAudit.EVENT));
        query.and(Predicates.eq("docUUID", id));
        List<LogEntry> entries = new ArrayList<>();
        for (Object entry : TransactionHelper.runInTransaction(() -> AuditAccess.reader().queryLogs(query))) {
            entries.add((LogEntry) entry);
        }
        return entries;
    }

    private static RightsPolicyDescriptor policy(String xml) throws Exception {
        XMap xmap = new XMap();
        xmap.register(RightsPolicyDescriptor.class);
        return (RightsPolicyDescriptor) xmap.load(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
    }

    /** Every job and every listener after the commit, done. */
    private void awaitJobs() {
        transactions.nextTransaction();
    }

    private void commit() {
        session.save();
        TransactionHelper.commitOrRollbackTransaction();
        TransactionHelper.startTransaction();
    }
}
