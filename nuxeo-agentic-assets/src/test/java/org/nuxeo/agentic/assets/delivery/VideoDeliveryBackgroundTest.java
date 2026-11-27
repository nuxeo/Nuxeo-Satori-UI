/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.delivery;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.Serializable;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import java.util.function.Function;

import javax.inject.Inject;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.agentic.assets.watermark.StandInVideoMarker;
import org.nuxeo.agentic.assets.watermark.WatermarkedCopies;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.core.api.impl.UserPrincipal;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;
import org.nuxeo.ecm.core.io.download.DownloadService;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.core.test.annotations.Granularity;
import org.nuxeo.ecm.core.test.annotations.RepositoryConfig;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.test.runner.TransactionalFeature;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Since 0.6.0, a delivery whose package holds a long video the watermark marks, in a real Nuxeo
 * runtime, on the media kit's model and its policy, its delivery marking the master too
 * ({@code test-media-video-delivery-contrib.xml}), and a stand-in for the platform's video tools. The
 * delivery is refused, {@code watermark-pending}, while the master is marked in the background for
 * its distributor; filed again once it is ready, it is delivered with it, and its record says what was
 * marked, for whom, and holds it. A job that fails refuses the delivery with its reason.
 */
@RunWith(FeaturesRunner.class)
@Features(CoreFeature.class)
@RepositoryConfig(cleanup = Granularity.METHOD)
@Deploy("org.nuxeo.runtime.kv")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-rights-service.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-rights-download-permission.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/media-delivery-types.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/media-delivery-listener.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-watermarked-copies-types.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-video-watermark-service.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-media-model-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/kit/media-demo-rights.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-media-other-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-media-video-delivery-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-video-marker-standin-contrib.xml")
public class VideoDeliveryBackgroundTest {

    private static final String FILER = "dana";

    private static final String MASTER = "files:files/0/file";

    private static final String FRANCE = "Acme Distribution France";

    private final LocalDate today = LocalDate.now(ZoneOffset.UTC);

    @Inject
    protected CoreSession session;

    @Inject
    protected TransactionalFeature transactions;

    @Inject
    protected DownloadService downloads;

    private DocumentModel version;

    private int filed;

    @Before
    public void seed() {
        StandInVideoMarker.reset();
        folder("/", "films");
        folder("/", "versions");
        DocumentModel deliveries = folder("/", "deliveries");
        grant(session.getDocument(new PathRef("/films")), FILER, SecurityConstants.READ);
        grant(session.getDocument(new PathRef("/versions")), FILER, SecurityConstants.READ);
        grant(deliveries, FILER, SecurityConstants.READ_WRITE);
        DocumentModel film = session.createDocumentModel("/films", "lighthouse", "Film");
        film.setPropertyValue("dc:title", "The Lighthouse at Saltmere");
        film.setPropertyValue("film:windows",
                (Serializable) List.of(window("FR", "SVOD"), window("FR", "Marketing"), window("BE", "SVOD"),
                        window("BE", "Marketing")));
        film = session.createDocument(film);
        DocumentModel french = session.createDocumentModel("/versions", "french", "FilmVersion");
        french.setPropertyValue("dc:title", "The Lighthouse at Saltmere, French");
        french.setPropertyValue("fver:film", film.getId());
        french.setPropertyValue("fver:language", "French");
        french.setPropertyValue("fver:territories", new String[] { "FR", "BE" });
        french.setPropertyValue("fver:channels", new String[] { "SVOD", "Marketing" });
        french.setPropertyValue("dc:expired", midnightUtc(today.plusDays(365)));
        french.setPropertyValue("files:files", (Serializable) List.of(
                file(StandInVideoMarker.video("master-french", 5400, 200)), file(text("subtitles of french")),
                file(picture("key-art-french")), file(picture("still-french"))));
        version = session.createDocument(french);
        commit();
    }

    @After
    public void tearDown() {
        transactions.nextTransaction();
        StandInVideoMarker.reset();
    }

    @Test
    public void aDeliveryWithALongVideoWaitsForItsMarkedCopyThenHoldsIt() {
        DeliveryRefusal waiting = refused(Deliveries.WATERMARK_PENDING, () -> deliver(FRANCE, "FR"));
        assertEquals(409, waiting.getStatusCode());
        assertTrue(waiting.getMessage(), waiting.getMessage().contains("original"));
        assertTrue(waiting.getMessage(), waiting.getMessage().contains("File it again once they are ready"));
        assertEquals("nothing is made while it waits", 0, deliveries());

        transactions.nextTransaction();
        assertEquals(1, StandInVideoMarker.marks.get());
        assertEquals(1, copies());

        DocumentModel delivery = deliver(FRANCE, "FR");
        List<Map<String, Serializable>> files = files(delivery);
        assertEquals(3, files.size());
        Map<String, Serializable> master = files.get(0);
        assertEquals("original", master.get("use"));
        assertEquals(Boolean.TRUE, master.get("watermarked"));
        assertEquals(FRANCE, master.get("watermarkedFor"));
        String text = "ACME PICTURES · FOR " + FRANCE + " · " + FILER + " · " + today;
        assertEquals(text, master.get("watermark"));
        Blob marked = (Blob) master.get("watermarkedFile");
        assertNotNull(marked);
        String bytes = StandInVideoMarker.text(marked);
        assertTrue(bytes, bytes.startsWith(StandInVideoMarker.MARKED + text + "|tiled|"));
        assertTrue(bytes, bytes.contains("STAND-IN VIDEO master-french"));
        assertEquals("the key art marked in the filer's transaction, as before", Boolean.TRUE,
                files.get(2).get("watermarked"));
        assertEquals("the job ran once", 1, StandInVideoMarker.marks.get());
        assertEquals("the delivery holds the marked master now, and the copy is taken", 0, copies());
        assertTrue("whoever may read the delivery downloads its marked master", downloads.checkPermission(
                delivery, "mdlv:files/0/watermarkedFile", marked, "download", null));
    }

    @Test
    public void aCopyMarkedForAnotherDistributorIsNotDelivered() {
        refused(Deliveries.WATERMARK_PENDING, () -> deliver(FRANCE, "FR"));
        transactions.nextTransaction();
        assertEquals(1, copies());
        refused(Deliveries.WATERMARK_PENDING, () -> deliver("Acme Benelux", "BE"));
        transactions.nextTransaction();
        assertEquals("one copy per distributor", 2, copies());
        DocumentModel belgian = deliver("Acme Benelux", "BE");
        String bytes = StandInVideoMarker.text((Blob) files(belgian).get(0).get("watermarkedFile"));
        assertTrue(bytes, bytes.contains("FOR Acme Benelux"));
        assertFalse(bytes, bytes.contains(FRANCE));
    }

    @Test
    public void aDeliveryWhoseJobFailedIsRefusedWithTheReason() {
        StandInVideoMarker.failWith = "the stand-in could not encode the master";
        refused(Deliveries.WATERMARK_PENDING, () -> deliver(FRANCE, "FR"));
        transactions.nextTransaction();
        DeliveryRefusal refusal = refused("watermark-unavailable", () -> deliver(FRANCE, "FR"));
        assertEquals(403, refusal.getStatusCode());
        assertTrue(refusal.getMessage(), refusal.getMessage().contains("the stand-in could not encode the master"));
        assertEquals(0, deliveries());
        assertEquals(0, copies());
    }

    // ------------------------------------------------------------------ helpers

    private DocumentModel deliver(String distributor, String territory) {
        CoreSession as = CoreInstance.getCoreSession(session.getRepositoryName(),
                (NuxeoPrincipal) new UserPrincipal(FILER, List.of(), false, false));
        DocumentModel delivery = as.createDocumentModel("/deliveries", "delivery-" + ++filed, Deliveries.TYPE);
        delivery.setPropertyValue("mdlv:version", version.getId());
        delivery.setPropertyValue("mdlv:distributor", distributor);
        delivery.setPropertyValue("mdlv:territory", territory);
        delivery = as.createDocument(delivery);
        commit();
        return session.getDocument(delivery.getRef());
    }

    private interface Call {
        void run();
    }

    private static DeliveryRefusal refused(String code, Call call) {
        try {
            call.run();
        } catch (DeliveryRefusal refusal) {
            TransactionHelper.setTransactionRollbackOnly();
            TransactionHelper.commitOrRollbackTransaction();
            TransactionHelper.startTransaction();
            assertEquals(refusal.getMessage(), code, refusal.getCode());
            return refusal;
        }
        fail("not refused: " + code);
        return null;
    }

    private long deliveries() {
        return session.query("SELECT * FROM " + Deliveries.TYPE).size();
    }

    private long copies() {
        return CoreInstance.doPrivileged(session, (Function<CoreSession, Long>) privileged -> (long) privileged.query(
                "SELECT * FROM " + WatermarkedCopies.TYPE).size());
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Serializable>> files(DocumentModel delivery) {
        return new ArrayList<>((List<Map<String, Serializable>>) delivery.getPropertyValue("mdlv:files"));
    }

    private DocumentModel folder(String parent, String name) {
        DocumentModel folder = session.createDocumentModel(parent, name, "Folder");
        folder.setPropertyValue("dc:title", name);
        return session.createDocument(folder);
    }

    private void grant(DocumentModel document, String user, String permission) {
        ACP acp = new ACPImpl();
        ACL acl = acp.getOrCreateACL();
        acl.add(new ACE(user, permission, true));
        session.setACP(document.getRef(), acp, true);
    }

    private Map<String, Serializable> window(String territory, String channel) {
        Map<String, Serializable> window = new HashMap<>();
        window.put("territory", territory);
        window.put("channel", channel);
        window.put("from", midnightUtc(today.minusDays(30)));
        window.put("until", midnightUtc(today.plusDays(150)));
        return window;
    }

    private static Map<String, Serializable> file(Blob blob) {
        Map<String, Serializable> entry = new HashMap<>();
        entry.put("file", (Serializable) blob);
        return entry;
    }

    private static Blob text(String content) {
        return Blobs.createBlob(content, "text/plain", null, content.replace(' ', '-') + ".txt");
    }

    private static Blob picture(String name) {
        java.awt.image.BufferedImage image = new java.awt.image.BufferedImage(320, 180,
                java.awt.image.BufferedImage.TYPE_INT_RGB);
        java.awt.Graphics2D g = image.createGraphics();
        try {
            g.setPaint(new java.awt.Color(20, 60, 90));
            g.fillRect(0, 0, 320, 180);
        } finally {
            g.dispose();
        }
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        try {
            javax.imageio.ImageIO.write(image, "png", out);
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
        Blob blob = new org.nuxeo.ecm.core.api.impl.blob.ByteArrayBlob(out.toByteArray(), "image/png");
        blob.setFilename(name + ".png");
        return blob;
    }

    private void commit() {
        session.save();
        TransactionHelper.commitOrRollbackTransaction();
        TransactionHelper.startTransaction();
    }

    private static Calendar midnightUtc(LocalDate day) {
        GregorianCalendar calendar = new GregorianCalendar(TimeZone.getTimeZone("UTC"));
        calendar.clear();
        calendar.set(day.getYear(), day.getMonthValue() - 1, day.getDayOfMonth());
        return calendar;
    }
}
