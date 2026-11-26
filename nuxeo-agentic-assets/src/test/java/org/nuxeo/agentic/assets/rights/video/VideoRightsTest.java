/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights.video;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;

import javax.inject.Inject;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.automation.AutomationService;
import org.nuxeo.ecm.automation.OperationContext;
import org.nuxeo.ecm.automation.core.util.BlobList;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.VersioningOption;
import org.nuxeo.ecm.core.api.impl.DocumentModelListImpl;
import org.nuxeo.ecm.core.blob.ManagedBlob;
import org.nuxeo.ecm.core.io.download.DownloadService;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.core.test.annotations.Granularity;
import org.nuxeo.ecm.core.test.annotations.RepositoryConfig;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * A video asset's rights, in a real Nuxeo runtime and repository: the platform's Video type and
 * {@code Video.*} operations, its download service evaluating the add-on's contributed permission
 * through Nashorn, and the brand assets kit's own video policy, copied from the kit by the build
 * (the pom's {@code kit-video-policy}), on a stand-in for its model. Only the video tools service,
 * which runs ffmpeg, is a fake ({@link FakeVideoTools}).
 *
 * <p>The kit's policy: the original for Print, the {@code MP4 480p} and {@code WebM 480p}
 * conversions for E-commerce, the still frames and the storyboard previews.
 */
@RunWith(FeaturesRunner.class)
@Features(CoreFeature.class)
@RepositoryConfig(cleanup = Granularity.METHOD)
@Deploy("org.nuxeo.ecm.automation.core")
@Deploy("org.nuxeo.ecm.platform.tag:OSGI-INF/faceted-tag-service-core-types.xml")
@Deploy("org.nuxeo.ecm.platform.picture.core:OSGI-INF/picture-schemas-contrib.xml")
@Deploy("org.nuxeo.ecm.platform.video:OSGI-INF/core-types-contrib.xml")
@Deploy("org.nuxeo.ecm.platform.video:OSGI-INF/video-tools-operations-contrib.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-rights-service.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-rights-download-permission.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-rights-video-operations-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-video-model-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-video-tools-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/kit/brand-assets-demo-video-rights.xml")
public class VideoRightsTest {

    private static final String CLEARED_UNTIL = "2099-12-31";

    private static final String ENDED_ON = "2020-01-31";

    @Inject
    protected CoreSession session;

    @Inject
    protected DownloadService downloads;

    @Inject
    protected AutomationService automation;

    /**
     * A transcoded video is decided as the rendition of its conversion's name, at whatever place
     * the conversions ended up, as {@code @rendition/<name>} decides it: the platform appends a
     * conversion when it finishes, so a place names no particular one.
     */
    @Test
    public void aTranscodedVideoIsDecidedByItsConversionsNameWhereverItIsAddressed() {
        // No Print: the original refused, the web cut served. The conversions in the order they
        // finished, and one the policy does not name.
        DocumentModel web = video("web", CLEARED_UNTIL, "E-commerce", "Social");
        transcoded(web, "WebM 480p", "MP4 480p", "Ogg 480p");

        for (int place = 0; place < 3; place++) {
            String name = (String) web.getPropertyValue("vid:transcodedVideos/" + place + "/name");
            Blob file = (Blob) web.getPropertyValue("vid:transcodedVideos/" + place + "/content");
            boolean byName = downloads.checkPermission(web, null, file, "rendition", rendition(name));
            assertEquals(name + " at its place as by its name", byName, atPlace(web, place, file));
            assertEquals(name + " through /nxfile/'s form", byName,
                    downloads.checkPermission(web, "vid;transcodedVideos/" + place + "/content", file, "download", null));
        }
        assertTrue(atPlace(web, 0, null));
        assertTrue(atPlace(web, 1, null));
        assertFalse("a conversion the policy does not name", atPlace(web, 2, null));
        assertFalse("the original is Print's", downloads.checkPermission(web, "file:content", null, "download", null));

        // Made again, MP4 480p moves to the end, and keeps its decision.
        transcoded(web, "WebM 480p", "Ogg 480p", "MP4 480p");
        assertTrue(atPlace(web, 2, null));
        assertFalse(atPlace(web, 1, null));

        // Without E-commerce, no conversion is served, at any place.
        DocumentModel social = video("social", CLEARED_UNTIL, "Social");
        transcoded(social, "MP4 480p", "WebM 480p");
        assertFalse(atPlace(social, 0, null));
        assertFalse(atPlace(social, 1, null));
        assertFalse(downloads.checkPermission(social, null, null, "rendition", rendition("MP4 480p")));

        // A place with no conversion's name, or one the document does not have, is not named.
        DocumentModel unnamed = video("unnamed", CLEARED_UNTIL, "E-commerce", "Print");
        transcoded(unnamed, " ");
        assertFalse(atPlace(unnamed, 0, null));
        assertFalse(atPlace(unnamed, 5, null));
        assertFalse(downloads.checkPermission(web, "vid:transcodedVideos/01/content", null, "download", null));
    }

    /**
     * Every frame of the storyboard is the one use the policy's {@code <storyboard>} decides, however
     * many frames the server is configured to make: here twelve, beyond the platform's default nine.
     */
    @Test
    public void everyStoryboardFrameIsDecidedByThePolicysOneStoryboardRule() {
        DocumentModel ended = video("ended", ENDED_ON, "E-commerce", "Social", "Print");
        storyboard(ended, 12);

        for (int frame = 0; frame < 12; frame++) {
            Blob file = (Blob) ended.getPropertyValue("vid:storyboard/" + frame + "/content");
            assertTrue("frame " + frame + ", a preview once the rights have ended",
                    downloads.checkPermission(ended, "vid:storyboard/" + frame + "/content", file, "download", null));
        }
        assertFalse("the original, once the rights have ended",
                downloads.checkPermission(ended, "file:content", null, "download", null));
        assertFalse("a frame the document does not have",
                downloads.checkPermission(ended, "vid:storyboard/12/content", null, "download", null));
        assertFalse("a frame written another way",
                downloads.checkPermission(ended, "vid:storyboard/01/content", null, "download", null));
    }

    /**
     * The platform's {@code Video.*} operations read a document's file and answer what they made of
     * it, so each is decided as a download of that file: refused, 403, where the rights refuse it,
     * administrators included, and otherwise the platform's own operation runs on it, with every
     * parameter it was given. A stored file, given as the input or read from a document no policy
     * covers, is decided for the covered documents that hold it.
     */
    @Test
    public void theVideoOperationsAreDecidedAsADownloadOfTheFileTheyRead() throws Exception {
        DocumentModel noPrint = video("no-print", CLEARED_UNTIL, "E-commerce", "Social");
        transcoded(noPrint, "MP4 480p");
        DocumentModel cleared = video("cleared", CLEARED_UNTIL, "E-commerce", "Print");
        DocumentModel other = video("other", CLEARED_UNTIL, "Print");

        // Each operation, on the original of an asset without Print, is refused.
        refused(() -> run("Video.Slice", noPrint, Map.of("startAt", "00:01")));
        refused(() -> run("Video.Slice", new DocumentModelListImpl(List.of(cleared, noPrint)), Map.of()));
        refused(() -> run("Video.SliceInParts", noPrint, Map.of("duration", "2")));
        refused(() -> run("Video.ExtractClosedCaptions", noPrint, Map.of()));
        refused(() -> run("Video.ExtractClosedCaptions", new DocumentModelListImpl(List.of(noPrint)), Map.of()));
        refused(() -> run("Video.Concat", new DocumentModelListImpl(List.of(cleared, noPrint)), Map.of()));
        refused(() -> run("Video.AddWatermark", noPrint, Map.of("watermark", cleared)));
        refused(() -> run("Video.AddWatermark", new DocumentModelListImpl(List.of(noPrint)), Map.of("watermark", cleared)));
        // The watermark's file is drawn into the answer: decided as its own download.
        refused(() -> run("Video.AddWatermark", cleared, Map.of("watermark", noPrint)));
        refused(() -> run("Video.AddWatermark", Blobs.createBlob("a blob"), Map.of("watermark", noPrint)));
        // A file at a place written in a form the policy does not name, which the platform would read.
        refused(() -> run("Video.Slice", cleared, Map.of("xpath", "/file:content")));
        refused(() -> run("Video.Slice", noPrint, Map.of("xpath", "video:transcodedVideos/0/content")));

        // The asset's stored files given as the input.
        Blob noPrintOriginal = stored(noPrint, "file:content");
        Blob noPrintWebCut = stored(noPrint, "vid:transcodedVideos/0/content");
        refused(() -> run("Video.Slice", noPrintOriginal, Map.of()));
        refused(() -> run("Video.SliceInParts", noPrintOriginal, Map.of("duration", "2")));
        refused(() -> run("Video.ExtractClosedCaptions", noPrintOriginal, Map.of()));
        refused(() -> run("Video.Concat", new BlobList(List.of(stored(cleared, "file:content"), noPrintOriginal)), Map.of()));
        refused(() -> run("Video.AddWatermark", noPrintOriginal, Map.of("watermark", cleared)));
        refused(() -> run("Video.Slice", new BlobList(List.of(noPrintWebCut, noPrintOriginal)), Map.of()));
        assertEquals("slice of web cut 0 of no-print from 00:00 for null encoded",
                text(run("Video.Slice", noPrintWebCut, Map.of())));
        assertEquals("slice of original of cleared from 00:00 for null encoded",
                text(run("Video.Slice", stored(cleared, "file:content"), Map.of())));

        // What the rights cover runs the platform's operation, on that file, with its parameters.
        assertEquals("slice of web cut 0 of no-print from 00:02 for 3 copied", text(run("Video.Slice", noPrint,
                Map.of("xpath", "vid:transcodedVideos/0/content", "startAt", "00:02", "duration", "3", "encode", false))));
        assertEquals("captions of web cut 0 of no-print as srt from 00:01 to 00:04",
                text(run("Video.ExtractClosedCaptions", noPrint, Map.of("xpath", "vid:transcodedVideos/0/content",
                        "outFormat", "srt", "startAt", "00:01", "endAt", "00:04"))));
        assertEquals("slice of original of cleared from 00:01 for null encoded",
                text(run("Video.Slice", cleared, Map.of("startAt", "00:01"))));
        assertEquals("concat of original of cleared + original of other",
                text(run("Video.Concat", new DocumentModelListImpl(List.of(cleared, other)), Map.of())));
        assertEquals("watermark of original of cleared with original of other at 5,7",
                text(run("Video.AddWatermark", cleared, Map.of("watermark", other, "x", "5", "y", "7"))));
        assertEquals(1, ((BlobList) run("Video.SliceInParts", cleared, Map.of("duration", "2"))).size());

        // A version has its live document's rights: narrowed since, its original is refused.
        DocumentModel version = session.getDocument(session.checkIn(cleared.getRef(), VersioningOption.MAJOR, null));
        session.save();
        assertEquals("slice of original of cleared from 00:00 for null encoded", text(run("Video.Slice", version, Map.of())));
        cleared.setPropertyValue("acmeasset:channels", new String[] { "E-commerce" });
        session.saveDocument(cleared);
        session.save();
        refused(() -> run("Video.Slice", version, Map.of()));
        refused(() -> run("Video.Slice", stored(version, "file:content"), Map.of()));
        assertFalse(downloads.checkPermission(version, "file:content", null, "download", null));

        // A file a facet brought to the asset, which its policy does not list, is refused as a stored input too.
        DocumentModel attached = session.getDocument(cleared.getRef());
        attached.addFacet("TestAttachment");
        attached.setPropertyValue("tatt:file", (Serializable) Blobs.createBlob("attachment of cleared"));
        session.saveDocument(attached);
        session.save();
        refused(() -> run("Video.Slice", stored(attached, "tatt:file"), Map.of()));

        // A document no policy covers that holds the asset's file is decided for the asset, as the watermark.
        DocumentModel copy = session.createDocumentModel("/", "copy", "Video");
        copy.setPropertyValue("file:content", (Serializable) stored(noPrint, "file:content"));
        DocumentModel holder = session.createDocument(copy);
        session.save();
        refused(() -> run("Video.Slice", holder, Map.of()));
        refused(() -> run("Video.Slice", new DocumentModelListImpl(List.of(holder)), Map.of()));
        refused(() -> run("Video.AddWatermark", other, Map.of("watermark", holder)));

        // A document no policy covers, its stored file, and a blob stored for none are not decided here.
        DocumentModel platformVideo = session.createDocumentModel("/", "platform", "Video");
        platformVideo.setPropertyValue("file:content", (Serializable) Blobs.createBlob("original of platform"));
        DocumentModel stock = session.createDocument(platformVideo);
        session.save();
        assertEquals("slice of original of platform from 00:00 for null encoded", text(run("Video.Slice", stock, Map.of())));
        assertEquals("slice of original of platform from 00:00 for null encoded",
                text(run("Video.Slice", stored(stock, "file:content"), Map.of())));
        assertEquals("slice of a blob from 00:00 for null encoded",
                text(run("Video.Slice", Blobs.createBlob("a blob"), Map.of())));
    }

    // ------------------------------------------------------------------------------------------

    /** The file the repository holds at {@code xpath}, as a document read again gives it: a stored blob. */
    private Blob stored(DocumentModel document, String xpath) {
        Blob blob = (Blob) session.getDocument(document.getRef()).getPropertyValue(xpath);
        assertTrue(xpath + " is a stored blob", blob instanceof ManagedBlob);
        return blob;
    }

    private boolean atPlace(DocumentModel video, int place, Blob file) {
        return downloads.checkPermission(video, "vid:transcodedVideos/" + place + "/content", file, "download", null);
    }

    private static Map<String, Serializable> rendition(String name) {
        Map<String, Serializable> infos = new HashMap<>();
        infos.put("rendition", name);
        return infos;
    }

    /** An AcmeVideo, its original and its rights, saved. */
    private DocumentModel video(String name, String rightsEnd, String... channels) {
        DocumentModel video = session.createDocumentModel("/", name, "AcmeVideo");
        video.setPropertyValue("dc:expired", midnightUtc(rightsEnd));
        video.setPropertyValue("acmeasset:channels", channels);
        video.setPropertyValue("file:content", (Serializable) Blobs.createBlob("original of " + name));
        DocumentModel created = session.createDocument(video);
        // Saved, as a request's documents are, so that a query finds them.
        session.save();
        return created;
    }

    /** Its transcoded videos, by these names, in this order, as the platform keeps them. */
    private void transcoded(DocumentModel video, String... names) {
        List<Map<String, Serializable>> entries = new ArrayList<>();
        for (int i = 0; i < names.length; i++) {
            Map<String, Serializable> entry = new HashMap<>();
            entry.put("name", names[i]);
            entry.put("content", (Serializable) Blobs.createBlob("web cut " + i + " of " + video.getName()));
            entries.add(entry);
        }
        video.setPropertyValue("vid:transcodedVideos", (Serializable) entries);
        session.saveDocument(video);
        session.save();
        video.refresh();
    }

    /** A storyboard of this many frames, as the platform writes one. */
    private void storyboard(DocumentModel video, int frames) {
        List<Map<String, Serializable>> entries = new ArrayList<>();
        for (int i = 0; i < frames; i++) {
            Map<String, Serializable> entry = new HashMap<>();
            entry.put("content", (Serializable) Blobs.createBlob("frame " + i));
            entry.put("timecode", (double) i);
            entry.put("comment", "frame " + i);
            entries.add(entry);
        }
        video.setPropertyValue("vid:storyboard", (Serializable) entries);
        session.saveDocument(video);
        session.save();
        video.refresh();
    }

    private Object run(String operation, Object input, Map<String, ?> params) throws Exception {
        try (OperationContext ctx = new OperationContext(session)) {
            ctx.setInput(input);
            return automation.run(ctx, operation, params);
        }
    }

    private interface Call {
        void run() throws Exception;
    }

    /** The call is refused by the rights, with 403, and by nothing else. */
    private static void refused(Call call) {
        try {
            call.run();
        } catch (Exception e) {
            for (Throwable cause = e; cause != null; cause = cause.getCause()) {
                if (cause instanceof DocumentSecurityException refusal) {
                    assertEquals(403, refusal.getStatusCode());
                    assertTrue(refusal.getMessage(), refusal.getMessage().contains("Asset rights"));
                    return;
                }
            }
            throw new AssertionError("refused, but not by the rights", e);
        }
        fail("not refused");
    }

    private static String text(Object blob) throws Exception {
        return ((Blob) blob).getString();
    }

    private static Calendar midnightUtc(String day) {
        GregorianCalendar calendar = new GregorianCalendar(TimeZone.getTimeZone("UTC"));
        calendar.clear();
        String[] parts = day.split("-");
        calendar.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1, Integer.parseInt(parts[2]));
        return calendar;
    }
}
