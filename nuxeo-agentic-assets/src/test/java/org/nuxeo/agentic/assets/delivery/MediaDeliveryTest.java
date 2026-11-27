/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.delivery;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
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

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.core.api.impl.DocumentModelImpl;
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
import org.nuxeo.ecm.core.api.trash.TrashService;
import org.nuxeo.agentic.assets.rights.Watermark;
import org.nuxeo.agentic.assets.share.Watermarker;
import org.nuxeo.agentic.assets.watermark.WatermarkedFiles;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Media rights in a real Nuxeo runtime and repository: the media kit's own rights policy and
 * schemas, copied from the kit by the build (the pom's {@code kit-media-policy} and
 * {@code kit-media-schemas}), the add-on's delivery listener, and the platform's download service
 * evaluating the add-on's contributed permission through Nashorn.
 *
 * <p>The kit's policy: a localised version's master and subtitles cleared by SVOD, its key art by
 * Marketing; its territories its own, its release windows its film's. A delivery carries all three
 * files. The film's windows, from today, in UTC:
 *
 * <pre>
 * FR  SVOD -30..+150  Marketing -60..+150
 * BE  SVOD -30..+150  Marketing -90..-1    (closed yesterday)
 * DE  SVOD +35..+215  Marketing -10..+215  (SVOD opens in 35 days)
 * CH  SVOD -30..+150  Marketing -30..+150
 * </pre>
 *
 * The French version may go to FR, BE and CH; the German version to DE, AT and CH. No window is
 * open in AT.
 */
@RunWith(FeaturesRunner.class)
@Features(CoreFeature.class)
@RepositoryConfig(cleanup = Granularity.METHOD)
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-rights-service.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-rights-download-permission.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/media-delivery-types.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/media-delivery-listener.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-media-model-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/kit/media-demo-rights.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-media-other-contrib.xml")
public class MediaDeliveryTest {

    private final LocalDate today = LocalDate.now(ZoneOffset.UTC);

    /** The distribution coordinator who files deliveries. */
    private static final String FILER = "dana";

    /** Someone who may file in the deliveries folder, and may read no version. */
    private static final String OUTSIDER = "olga";

    /** Someone who may read the versions, and not the film. */
    private static final String READER = "rita";

    private static final String MASTER = "files:files/0/file";

    private static final String SUBTITLES = "files:files/1/file";

    private static final String KEY_ART = "files:files/2/file";

    /** Since the kit's 0.2.0: a still from the film, a preview, marked for anyone outside the kit's groups. */
    private static final String STILL = "files:files/3/file";

    /** An outside partner: may read the versions, in neither of the kit's groups. */
    private static final String PARTNER = "paula";

    @Inject
    protected CoreSession session;

    @Inject
    protected DownloadService downloads;

    private DocumentModel film;

    private DocumentModel french;

    private DocumentModel german;

    /** How many deliveries this test has filed, to name each one apart. */
    private int filed;

    @Before
    public void seed() {
        folder("/", "films", "Films");
        folder("/", "versions", "Versions");
        DocumentModel deliveries = folder("/", "deliveries", "Deliveries");
        grant(session.getDocument(new PathRef("/films")), FILER, SecurityConstants.READ);
        grant(session.getDocument(new PathRef("/versions")), FILER, SecurityConstants.READ,
                READER, SecurityConstants.READ, PARTNER, SecurityConstants.READ);
        grant(deliveries, FILER, SecurityConstants.READ_WRITE, OUTSIDER, SecurityConstants.READ_WRITE);

        film = session.createDocumentModel("/films", "lighthouse", "Film");
        film.setPropertyValue("dc:title", "The Lighthouse at Saltmere");
        film.setPropertyValue("film:windows", (Serializable) List.of(
                window("FR", "SVOD", -30, 150), window("FR", "Marketing", -60, 150),
                window("BE", "SVOD", -30, 150), window("BE", "Marketing", -90, -1),
                window("DE", "SVOD", 35, 215), window("DE", "Marketing", -10, 215),
                window("CH", "SVOD", -30, 150), window("CH", "Marketing", -30, 150)));
        film = session.createDocument(film);
        french = version("french", "French", 365, List.of("FR", "BE", "CH"), "SVOD", "Marketing");
        german = version("german", "German", 365, List.of("DE", "AT", "CH"), "SVOD", "Marketing");
        commit();
    }

    // ----- Inside a window -----

    /** Inside its windows, the French version is delivered whole, and the server writes the record. */
    @Test
    public void aLocalisedVersionIsDeliveredInsideItsWindow() throws Exception {
        DocumentModel delivery = deliver(FILER, french, "  Acme Distribution France ", " FR ");

        assertEquals("Acme Distribution France", delivery.getPropertyValue("mdlv:distributor"));
        assertEquals("FR", delivery.getPropertyValue("mdlv:territory"));
        assertEquals(french.getId(), delivery.getPropertyValue("mdlv:version"));
        assertEquals(FILER, delivery.getPropertyValue("mdlv:deliveredBy"));
        Calendar at = (Calendar) delivery.getPropertyValue("mdlv:deliveredAt");
        assertEquals(today, at.toInstant().atZone(ZoneOffset.UTC).toLocalDate());

        List<Map<String, Serializable>> files = files(delivery);
        assertEquals(3, files.size());
        assertFile(files.get(0), "original", null, "SVOD", french, MASTER);
        assertFile(files.get(1), "blob", SUBTITLES, "SVOD", french, SUBTITLES);
        assertFile(files.get(2), "blob", KEY_ART, "Marketing", french, KEY_ART);
        assertEquals(1, deliveries());

        // Since 0.5.0, the kit's watermark: the key art marked for the distributor, and held; the
        // master and the subtitles recorded as not marked, and not held.
        assertEquals(Boolean.FALSE, files.get(0).get("watermarked"));
        assertNull(files.get(0).get("watermarkedFor"));
        assertNull(files.get(0).get("watermarkedFile"));
        assertEquals(Boolean.FALSE, files.get(1).get("watermarked"));
        assertEquals(Boolean.TRUE, files.get(2).get("watermarked"));
        assertEquals("Acme Distribution France", files.get(2).get("watermarkedFor"));
        String text = "ACME PICTURES · FOR Acme Distribution France · " + today;
        assertEquals(text, files.get(2).get("watermark"));
        Blob marked = (Blob) files.get(2).get("watermarkedFile");
        Blob keyArt = (Blob) session.getDocument(french.getRef()).getPropertyValue(KEY_ART);
        assertEquals("image/jpeg", marked.getMimeType());
        assertNotEquals(keyArt.getDigest(), marked.getDigest());
        // The text drawn names the distributor: the same picture marked with that text, byte for byte.
        assertArrayEquals(watermarked(keyArt, text), bytes(marked));
        assertFalse(java.util.Arrays.equals(watermarked(keyArt, "ACME PICTURES · FOR Acme Suisse · " + today),
                bytes(marked)));
    }

    /**
     * A delivery's file the watermark marks that cannot be marked, such as key art that is not a
     * picture, refuses the delivery whole: nothing is delivered unmarked.
     */
    @Test
    @SuppressWarnings("unchecked")
    public void aDeliveryWhoseMarkedFileCannotBeMarkedIsRefusedWhole() {
        DocumentModel textual = version("textual", "French", 365, List.of("FR"), "SVOD", "Marketing");
        DocumentModel changed = session.getDocument(textual.getRef());
        List<Map<String, Serializable>> attachments = new ArrayList<>(
                (List<Map<String, Serializable>>) changed.getPropertyValue("files:files"));
        attachments.set(2, attachment("key art, in words"));
        changed.setPropertyValue("files:files", (Serializable) attachments);
        session.saveDocument(changed);
        commit();
        DeliveryRefusal refusal = refused("watermark-unavailable",
                () -> deliver(FILER, textual, "Acme Distribution France", "FR"));
        assertTrue(refusal.getMessage(), refusal.getMessage().contains(KEY_ART));
        assertEquals(0, deliveries());
    }

    /**
     * The still, a preview, is refused unmarked to an outside partner and to an administrator, served
     * as it is to the kit's staff, and served marked for the partner, naming them.
     */
    @Test
    public void theStillIsMarkedForAnOutsidePartnerAndServedAsItIsToStaff() throws Exception {
        assertFalse("outside both groups", downloadAs(new UserPrincipal(PARTNER, List.of(), false, false), french, STILL));
        assertFalse("an administrator is not exempt",
                downloadAs(new UserPrincipal("Administrator", List.of("administrators"), false, true), french, STILL));
        assertTrue("distribution staff", downloadAs(
                new UserPrincipal(FILER, List.of("media-distribution"), false, false), french, STILL));
        assertTrue("rights staff",
                downloadAs(new UserPrincipal(READER, List.of("media-rights"), false, false), french, STILL));
        // The key art is not marked for downloads: the partner is served it, inside its window.
        assertTrue(downloadAs(new UserPrincipal(PARTNER, List.of(), false, false), french, KEY_ART));

        NuxeoPrincipal partner = new UserPrincipal(PARTNER, List.of(), false, false);
        DocumentModel read = CoreInstance.getCoreSession(session.getRepositoryName(), partner)
                                         .getDocument(french.getRef());
        Blob marked = new WatermarkedFiles().serve(read, "blob:" + STILL, partner);
        Blob still = (Blob) read.getPropertyValue(STILL);
        assertEquals("image/jpeg", marked.getMimeType());
        assertArrayEquals(watermarked(still, "ACME PICTURES · FOR " + PARTNER + " · " + today), bytes(marked));
        // What the watermark does not mark, it does not serve.
        assertEquals(404, assertThrows(NuxeoException.class,
                () -> new WatermarkedFiles().serve(read, "blob:" + KEY_ART, partner)).getStatusCode());
    }

    /** A window is open from its first day to the end of its last, in UTC, both included. */
    @Test
    public void aWindowIsOpenFromItsFirstDayToItsLast() {
        windows(window("FR", "SVOD", 0, 0), window("FR", "Marketing", 0, 0));
        deliver(FILER, french, "Acme Distribution France", "FR");

        windows(window("FR", "SVOD", 1, 30), window("FR", "Marketing", 0, 30));
        refused("outside-window", () -> deliver(FILER, french, "Acme Distribution France", "FR"));

        windows(window("FR", "SVOD", -30, -1), window("FR", "Marketing", 0, 30));
        refused("outside-window", () -> deliver(FILER, french, "Acme Distribution France", "FR"));

        // A window with no last day stays open.
        windows(window("FR", "SVOD", -30, null), window("FR", "Marketing", -30, null));
        deliver(FILER, french, "Acme Distribution France", "FR");
        assertEquals(2, deliveries());
    }

    // ----- Outside a window -----

    /** Before the German SVOD window opens, the German version is refused in DE, and nothing is made. */
    @Test
    public void aDeliveryOutsideItsWindowIsRefused() {
        DeliveryRefusal refusal = refused("outside-window", () -> deliver(FILER, german, "Acme Verleih", "DE"));
        assertEquals(403, refusal.getStatusCode());
        assertTrue(refusal.getMessage(), refusal.getMessage().contains("original outside-window for SVOD"));
        assertTrue(refusal.getMessage(), refusal.getMessage().contains(SUBTITLES + " outside-window for SVOD"));
        // The key art's Marketing window is open in DE: it is not named.
        assertFalse(refusal.getMessage(), refusal.getMessage().contains(KEY_ART));
        assertEquals(0, deliveries());
    }

    // ----- A territory -----

    /**
     * The film has windows open in DE, and the French version may not go there: refused for its
     * territory. A territory the version holds and the film has no window in is outside the window.
     */
    @Test
    public void aDeliveryOutsideItsTerritoryIsRefused() {
        refused("territory-not-covered", () -> deliver(FILER, french, "Acme Verleih", "DE"));
        refused("territory-not-covered", () -> deliver(FILER, french, "Acme Distribution", "fr"));
        refused("outside-window", () -> deliver(FILER, german, "Acme Verleih Austria", "AT"));
        assertEquals(0, deliveries());
    }

    // ----- A version's own rights -----

    /**
     * Both versions may go to CH, where the film's windows are open. Each is decided by its own
     * rights: the French version's ended, its German one runs; then the French version's channels
     * lose Marketing, which its key art needs.
     */
    @Test
    public void eachLocalisedVersionIsDecidedByItsOwnRights() {
        french.setPropertyValue("dc:expired", midnightUtc(today.minusDays(1)));
        session.saveDocument(french);
        commit();
        refused("rights-ended", () -> deliver(FILER, french, "Acme Suisse", "CH"));
        deliver(FILER, german, "Acme Suisse", "CH");

        french.setPropertyValue("dc:expired", midnightUtc(today.plusDays(365)));
        french.setPropertyValue("fver:channels", new String[] { "SVOD" });
        session.saveDocument(french);
        commit();
        DeliveryRefusal refusal = refused("channel-not-covered", () -> deliver(FILER, french, "Acme Suisse", "CH"));
        assertTrue(refusal.getMessage(), refusal.getMessage().contains(KEY_ART + " channel-not-covered for Marketing"));
        assertEquals(1, deliveries());
    }

    // ----- A package refused whole -----

    /**
     * In BE the SVOD window is open and the Marketing one closed yesterday: the master and the
     * subtitles would be delivered, and the key art not, so nothing is.
     */
    @Test
    public void aPackageIsRefusedWholeWhenAnyOfItsFilesIsOutside() {
        DeliveryRefusal refusal = refused("outside-window", () -> deliver(FILER, french, "Acme Belgique", "BE"));
        assertTrue(refusal.getMessage(), refusal.getMessage().contains("refused whole"));
        assertTrue(refusal.getMessage(), refusal.getMessage().contains(KEY_ART + " outside-window for Marketing"));
        assertFalse(refusal.getMessage(), refusal.getMessage().contains("original"));
        assertEquals(0, deliveries());

        // A version missing one of its package's files is refused whole too.
        DocumentModel partial = version("partial", "French", 365, List.of("FR"), "SVOD", "Marketing");
        partial.setPropertyValue("files:files", (Serializable) List.of(attachment("master of partial"),
                attachment("subtitles of partial")));
        session.saveDocument(partial);
        commit();
        refused("no-such-file", () -> deliver(FILER, partial, "Acme Distribution France", "FR"));
        assertEquals(0, deliveries());
    }

    // ----- The same windows at the download endpoints -----

    /**
     * A download names no territory: a file is served while a window for its channel is open in any
     * territory the version may go to, and refused otherwise, as the delivery would be.
     */
    @Test
    public void theDownloadEndpointsAreDecidedByTheSameWindows() {
        assertTrue(download(french, MASTER));
        assertTrue(download(french, KEY_ART));
        // The German master: closed in DE, none in AT, open in CH.
        assertTrue(download(german, MASTER));

        DocumentModel germanyOnly = version("germany-only", "German", 365, List.of("DE"), "SVOD", "Marketing");
        assertFalse("SVOD opens in DE in 35 days", download(germanyOnly, MASTER));
        assertFalse(download(germanyOnly, SUBTITLES));
        assertTrue("Marketing is open in DE", download(germanyOnly, KEY_ART));

        DocumentModel nowhere = version("nowhere", "German", 365, List.of(), "SVOD", "Marketing");
        assertFalse("a version that may go nowhere", download(nowhere, MASTER));
        assertTrue("the thumbnail is a preview", downloads.checkPermission(nowhere, null, null, "rendition",
                Map.of("rendition", "thumbnail")));
    }

    /**
     * The film's windows are read with the system's rights: a reader of the version who may not read
     * the film is decided by them all the same. A version that names no film, or one in the trash,
     * is refused: its windows cannot be read.
     */
    @Test
    public void theFilmsWindowsDecideForAReaderWhoMayNotReadTheFilm() {
        CoreSession reader = as(READER);
        assertFalse(reader.hasPermission(film.getRef(), SecurityConstants.READ));
        DocumentModel asRead = reader.getDocument(german.getRef());
        assertTrue(downloads.checkPermission(asRead, MASTER, null, "download", null));

        DocumentModel orphan = version("orphan", "French", 365, List.of("FR"), "SVOD", "Marketing");
        orphan.setPropertyValue("fver:film", null);
        session.saveDocument(orphan);
        commit();
        assertFalse(download(orphan, KEY_ART));
        refused("policy-error", () -> deliver(FILER, orphan, "Acme Distribution France", "FR"));

        Framework.getService(TrashService.class).trashDocument(session.getDocument(film.getRef()));
        commit();
        assertFalse(download(french, MASTER));
        refused("policy-error", () -> deliver(FILER, french, "Acme Distribution France", "FR"));
        assertEquals(0, deliveries());
    }

    // ----- The record -----

    /** What the filer writes beyond the version, the distributor and the territory is the server's. */
    @Test
    public void theServerWritesTheRecordOverWhatTheFilerWrote() {
        CoreSession filer = as(FILER);
        DocumentModel delivery = filer.createDocumentModel("/deliveries", "forged", Deliveries.TYPE);
        delivery.setPropertyValue("mdlv:version", french.getId());
        delivery.setPropertyValue("mdlv:distributor", "Acme Distribution France");
        delivery.setPropertyValue("mdlv:territory", "FR");
        delivery.setPropertyValue("mdlv:deliveredBy", "someone else");
        delivery.setPropertyValue("mdlv:deliveredAt", midnightUtc(today.minusDays(400)));
        Map<String, Serializable> forged = new HashMap<>();
        forged.put("use", "original");
        forged.put("digest", "forged");
        delivery.setPropertyValue("mdlv:files", (Serializable) List.of(forged));
        delivery = filer.createDocument(delivery);
        commit();

        DocumentModel kept = session.getDocument(delivery.getRef());
        assertEquals(FILER, kept.getPropertyValue("mdlv:deliveredBy"));
        assertEquals(today, ((Calendar) kept.getPropertyValue("mdlv:deliveredAt")).toInstant()
                                                                                 .atZone(ZoneOffset.UTC)
                                                                                 .toLocalDate());
        assertEquals(3, files(kept).size());
        assertEquals("Acme Distribution France, FR", kept.getPropertyValue("dc:title"));
    }

    /**
     * Moved and trashed by an administrator only: its filer, who may write the folder, may do
     * neither.
     */
    @Test
    public void aDeliveryIsMovedOrTrashedByAnAdministratorOnly() {
        DocumentModel delivery = deliver(FILER, french, "Acme Distribution France", "FR");
        CoreSession filer = as(FILER);
        DocumentModel archive = folder("/deliveries", "archive", "Archive");
        commit();

        refused("kept", () -> filer.move(delivery.getRef(), archive.getRef(), null));
        refused("kept", () -> Framework.getService(TrashService.class).trashDocument(filer.getDocument(delivery.getRef())));
        assertEquals("/deliveries/" + delivery.getName(), session.getDocument(delivery.getRef()).getPathAsString());
        assertFalse(session.getDocument(delivery.getRef()).isTrashed());

        session.move(delivery.getRef(), archive.getRef(), null);
        commit();
        assertEquals("/deliveries/archive/" + delivery.getName(),
                session.getDocument(delivery.getRef()).getPathAsString());
        Framework.getService(TrashService.class).trashDocument(session.getDocument(delivery.getRef()));
        commit();
        assertTrue(session.getDocument(delivery.getRef()).isTrashed());
    }

    /**
     * A folder holding a delivery is not removed, trashed, moved or copied by anyone but an
     * administrator: the platform does those to the folder's documents with no event of their own.
     * A folder holding none is the folder's permissions' business.
     */
    @Test
    public void aFolderHoldingADeliveryIsKeptWithIt() {
        CoreSession filer = as(FILER);
        DocumentModel batch = filer.createDocument(filer.createDocumentModel("/deliveries", "batch", "Folder"));
        DocumentModel empty = filer.createDocument(filer.createDocumentModel("/deliveries", "empty", "Folder"));
        commit();
        deliver(FILER, "/deliveries/batch", french, "Acme Distribution France", "FR");

        refused("kept", () -> filer.removeDocument(batch.getRef()));
        refused("kept", () -> Framework.getService(TrashService.class).trashDocument(filer.getDocument(batch.getRef())));
        refused("kept", () -> filer.move(batch.getRef(), empty.getRef(), null));
        refused("kept", () -> filer.copy(batch.getRef(), new PathRef("/deliveries"), "batch-copy"));
        assertEquals(1, deliveries());

        filer.removeDocument(empty.getRef());
        commit();
        assertFalse(session.exists(empty.getRef()));

        session.removeDocument(batch.getRef());
        commit();
        assertEquals(0, deliveries());
    }

    /** An import, which writes a document whole, is refused: a delivery is decided when it is filed. */
    @Test
    public void aDeliveryIsNotImported() {
        DocumentModel imported = session.createDocumentModel("/deliveries", "imported", Deliveries.TYPE);
        ((DocumentModelImpl) imported).setId(java.util.UUID.randomUUID().toString());
        imported.setPropertyValue("mdlv:version", french.getId());
        imported.setPropertyValue("mdlv:distributor", "Acme Distribution France");
        imported.setPropertyValue("mdlv:territory", "DE");
        imported.setPropertyValue("mdlv:deliveredBy", FILER);
        refused("server-only", () -> session.importDocuments(List.of(imported)));
        assertEquals(0, deliveries());
    }

    /**
     * The document a version names for its windows must be of the type its policy says, there and
     * live: another type that holds the same windows, a proxy of the film, and an id of nothing
     * refuse, at the download endpoints and for a delivery.
     */
    @Test
    public void aVersionsWindowsAreAFilmsAlone() {
        DocumentModel poster = session.createDocumentModel("/films", "poster", "NotAFilm");
        poster.setPropertyValue("film:windows", session.getDocument(film.getRef()).getPropertyValue("film:windows"));
        poster = session.createDocument(poster);
        DocumentModel proxy = session.createProxy(film.getRef(), new PathRef("/versions"));
        commit();
        for (String named : List.of(poster.getId(), proxy.getId(), java.util.UUID.randomUUID().toString())) {
            DocumentModel version = session.getDocument(french.getRef());
            version.setPropertyValue("fver:film", named);
            session.saveDocument(version);
            commit();
            assertFalse(named, download(french, MASTER));
            refused("policy-error", () -> deliver(FILER, french, "Acme Distribution France", "FR"));
        }
        DocumentModel version = session.getDocument(french.getRef());
        version.setPropertyValue("fver:film", film.getId());
        session.saveDocument(version);
        commit();
        assertTrue(download(french, MASTER));
        assertEquals(0, deliveries());
    }

    /**
     * Once made, a delivery's record is kept: its own properties are not written again, it is not
     * copied, and only an administrator deletes it. Its description may change.
     */
    @Test
    public void aDeliveryIsKept() {
        DocumentModel delivery = deliver(FILER, french, "Acme Distribution France", "FR");
        CoreSession filer = as(FILER);

        DocumentModel changed = filer.getDocument(delivery.getRef());
        changed.setPropertyValue("mdlv:territory", "DE");
        refused("kept", () -> filer.saveDocument(changed));

        DocumentModel described = filer.getDocument(delivery.getRef());
        described.setPropertyValue("dc:description", "Sent on hard drive, tracking 0001.");
        filer.saveDocument(described);
        commit();

        refused("kept", () -> filer.copy(delivery.getRef(), new PathRef("/deliveries"), "copy"));
        refused("kept", () -> filer.removeDocument(delivery.getRef()));
        assertEquals(1, deliveries());
        assertEquals("FR", session.getDocument(delivery.getRef()).getPropertyValue("mdlv:territory"));

        session.removeDocument(delivery.getRef());
        commit();
        assertEquals(0, deliveries());
    }

    /**
     * The version is read with the filer's own session: one they may not read, and one that is not
     * there, are refused alike. A proxy is not a localised version to deliver, nor is a version
     * named by anything but an id.
     */
    @Test
    public void theFilerMustBeAbleToReadALiveVersion() {
        refused("version", () -> deliver(OUTSIDER, french, "Acme Distribution France", "FR"));
        DocumentModel gone = version("gone", "French", 365, List.of("FR"), "SVOD", "Marketing");
        session.removeDocument(gone.getRef());
        commit();
        refused("version", () -> deliver(FILER, gone, "Acme Distribution France", "FR"));

        DocumentModel proxy = session.createProxy(french.getRef(), new PathRef("/films"));
        commit();
        refused("version", () -> deliver(FILER, proxy, "Acme Distribution France", "FR"));

        CoreSession filer = as(FILER);
        DocumentModel byPath = filer.createDocumentModel("/deliveries", "by-path", Deliveries.TYPE);
        byPath.setPropertyValue("mdlv:version", "/versions/french");
        byPath.setPropertyValue("mdlv:distributor", "Acme Distribution France");
        byPath.setPropertyValue("mdlv:territory", "FR");
        refused("request", () -> filer.createDocument(byPath));
        assertEquals(0, deliveries());
    }

    // ----- Helpers -----

    private DocumentModel folder(String parent, String name, String title) {
        DocumentModel folder = session.createDocumentModel(parent, name, "Folder");
        folder.setPropertyValue("dc:title", title);
        return session.createDocument(folder);
    }

    private void grant(DocumentModel document, String... userPermission) {
        ACP acp = new ACPImpl();
        ACL acl = acp.getOrCreateACL();
        for (int i = 0; i < userPermission.length; i += 2) {
            acl.add(new ACE(userPermission[i], userPermission[i + 1], true));
        }
        session.setACP(document.getRef(), acp, true);
    }

    private DocumentModel version(String name, String language, int rightsForDays, List<String> territories,
            String... channels) {
        DocumentModel version = session.createDocumentModel("/versions", name, "FilmVersion");
        version.setPropertyValue("dc:title", "The Lighthouse at Saltmere, " + language);
        version.setPropertyValue("fver:film", film.getId());
        version.setPropertyValue("fver:language", language);
        version.setPropertyValue("fver:territories", territories.toArray(new String[0]));
        version.setPropertyValue("fver:channels", channels);
        version.setPropertyValue("dc:expired", midnightUtc(today.plusDays(rightsForDays)));
        version.setPropertyValue("files:files", (Serializable) List.of(attachment("master of " + name),
                attachment("subtitles of " + name), picture("key-art-" + name, 320, 180),
                picture("still-" + name, 240, 135)));
        DocumentModel created = session.createDocument(version);
        commit();
        return session.getDocument(created.getRef());
    }

    private static Map<String, Serializable> attachment(String content) {
        Map<String, Serializable> entry = new HashMap<>();
        entry.put("file", (Serializable) Blobs.createBlob(content, "text/plain", null, content.replace(' ', '-') + ".txt"));
        return entry;
    }

    /** A drawn picture, a PNG, as the kit's seed draws its key art and still. */
    private static Map<String, Serializable> picture(String name, int width, int height) {
        java.awt.image.BufferedImage image = new java.awt.image.BufferedImage(width, height,
                java.awt.image.BufferedImage.TYPE_INT_RGB);
        java.awt.Graphics2D g = image.createGraphics();
        try {
            g.setPaint(new java.awt.GradientPaint(0, 0, new java.awt.Color(20, 60, 90), width, height,
                    new java.awt.Color(220, 170, 90)));
            g.fillRect(0, 0, width, height);
        } finally {
            g.dispose();
        }
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        try {
            javax.imageio.ImageIO.write(image, "png", out);
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
        Map<String, Serializable> entry = new HashMap<>();
        Blob blob = new org.nuxeo.ecm.core.api.impl.blob.ByteArrayBlob(out.toByteArray(), "image/png");
        blob.setFilename(name + ".png");
        entry.put("file", (Serializable) blob);
        return entry;
    }

    /** {@code file} marked with {@code text} as the kit's watermark places it. */
    private static byte[] watermarked(Blob file, String text) throws Exception {
        Watermarker watermarker = new Watermarker();
        return watermarker.watermark(watermarker.read(file), text, Watermark.Placement.TILED);
    }

    private static byte[] bytes(Blob blob) {
        try {
            return blob.getByteArray();
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    private boolean downloadAs(NuxeoPrincipal person, DocumentModel version, String xpath) {
        org.nuxeo.runtime.api.login.LoginComponent.pushPrincipal(person);
        try {
            return download(version, xpath);
        } finally {
            org.nuxeo.runtime.api.login.LoginComponent.popPrincipal();
        }
    }

    private Map<String, Serializable> window(String territory, String channel, Integer from, Integer until) {
        Map<String, Serializable> window = new HashMap<>();
        window.put("territory", territory);
        window.put("channel", channel);
        window.put("from", midnightUtc(today.plusDays(from)));
        window.put("until", until == null ? null : midnightUtc(today.plusDays(until)));
        return window;
    }

    @SafeVarargs
    private void windows(Map<String, Serializable>... windows) {
        DocumentModel changed = session.getDocument(film.getRef());
        changed.setPropertyValue("film:windows", (Serializable) List.of(windows));
        session.saveDocument(changed);
        commit();
    }

    private DocumentModel deliver(String who, DocumentModel version, String distributor, String territory) {
        return deliver(who, "/deliveries", version, distributor, territory);
    }

    private DocumentModel deliver(String who, String in, DocumentModel version, String distributor,
            String territory) {
        CoreSession as = as(who);
        DocumentModel delivery = as.createDocumentModel(in, "delivery-" + ++filed, Deliveries.TYPE);
        delivery.setPropertyValue("mdlv:version", version.getId());
        delivery.setPropertyValue("mdlv:distributor", distributor);
        delivery.setPropertyValue("mdlv:territory", territory);
        delivery = as.createDocument(delivery);
        commit();
        return session.getDocument(delivery.getRef());
    }

    private boolean download(DocumentModel version, String xpath) {
        DocumentModel read = session.getDocument(version.getRef());
        return downloads.checkPermission(read, xpath, (Blob) read.getPropertyValue(xpath), "download", null);
    }

    private interface Call {
        void run();
    }

    /**
     * The call is refused with {@code code}, the listener having marked the transaction for
     * rollback, as a request's is, which this then rolls back.
     */
    private static DeliveryRefusal refused(String code, Call call) {
        try {
            call.run();
        } catch (DeliveryRefusal refusal) {
            boolean marked = TransactionHelper.isTransactionMarkedRollback();
            rollback();
            assertEquals(refusal.getMessage(), code, refusal.getCode());
            assertTrue("the listener marks the transaction for rollback", marked);
            return refusal;
        }
        fail("not refused: " + code);
        return null;
    }

    private long deliveries() {
        return session.query("SELECT * FROM " + Deliveries.TYPE).size();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Serializable>> files(DocumentModel delivery) {
        return new ArrayList<>((List<Map<String, Serializable>>) delivery.getPropertyValue("mdlv:files"));
    }

    private void assertFile(Map<String, Serializable> file, String use, String name, String channel,
            DocumentModel version, String xpath) {
        Blob blob = (Blob) session.getDocument(version.getRef()).getPropertyValue(xpath);
        assertEquals(use, file.get("use"));
        assertEquals(name, file.get("name"));
        assertEquals(channel, file.get("channel"));
        assertNotNull(blob.getDigest());
        assertEquals(blob.getDigest(), file.get("digest"));
        assertEquals(blob.getFilename(), file.get("filename"));
        assertEquals(blob.getLength(), file.get("length"));
    }

    private CoreSession as(String name) {
        NuxeoPrincipal principal = new UserPrincipal(name, List.of(), false, false);
        return CoreInstance.getCoreSession(session.getRepositoryName(), principal);
    }

    private void commit() {
        session.save();
        TransactionHelper.commitOrRollbackTransaction();
        TransactionHelper.startTransaction();
    }

    private static void rollback() {
        TransactionHelper.setTransactionRollbackOnly();
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
