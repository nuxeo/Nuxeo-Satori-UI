/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.assets.rights.AssetRightsService.DownloadDecision;
import org.nuxeo.agentic.assets.rights.Decision.Reason;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * The brand kit's video policy, read from where the kit keeps it, deciding a video asset's
 * downloads as the platform names them to the download permission. {@code VideoRightsTest} runs the
 * same file in a Nuxeo runtime.
 */
class KitVideoPolicyTest {

    static final Path KIT_VIDEO_COMPONENT = Path.of("..", "business-apps", "packages", "brand-assets-demo",
            "bundle", "OSGI-INF", "brand-assets-demo-video-rights.xml");

    private static RightsPolicyDescriptor kitVideoPolicy() throws Exception {
        List<RightsPolicyDescriptor> policies = RightsPolicyTest.contributed(Files.readAllBytes(KIT_VIDEO_COMPONENT));
        assertEquals(1, policies.size());
        return policies.get(0);
    }

    /**
     * A video asset as the kit seeds one, once the server has transcoded it: its original, its poster
     * views, its two conversions in the order they finished, and a storyboard, on these channels.
     */
    private static Fakes.Doc video(String rightsEnd, String... channels) {
        Fakes.Doc doc = new Fakes.Doc().rightsEnd(rightsEnd).channels(channels).original("original-digest");
        doc.type = "AcmeVideo";
        doc.schemas.add("video");
        // A Video's picture views are the frames Nuxeo takes from it, Small and StaticPlayerView.
        return doc.views("Small", "StaticPlayerView").transcoded("WebM 480p", "MP4 480p").storyboard(12);
    }

    private static DownloadDecision download(DocumentModel document, String xpath, String rendition) throws Exception {
        return Fakes.component(kitVideoPolicy()).decideDownload(document, xpath, null, rendition);
    }

    @Test
    void theKitsVideoPolicyIsReadWholeForItsVideoType() throws Exception {
        assertTrue(Files.isRegularFile(KIT_VIDEO_COMPONENT), KIT_VIDEO_COMPONENT + " is where the kit keeps it");
        RightsPolicy policy = RightsPolicy.of(kitVideoPolicy());
        assertEquals("AcmeVideo", policy.type());
        assertEquals(List.of(), policy.problems());
        assertEquals("dc:expired", policy.rightsEndXpath());
        assertEquals("acmeasset:channels", policy.channelsXpath());
        assertEquals(RightsPolicy.Rule.PREVIEW, policy.rule(Use.STORYBOARD));
    }

    /** The kit's demo: a video with no Print channel, its original refused, its web cut served. */
    @Test
    void withNoPrintChannelTheOriginalIsRefusedAndTheTranscodedVideosServed() throws Exception {
        DocumentModel noPrint = video("2027-06-30", "E-commerce", "Social").model();

        DownloadDecision original = download(noPrint, "file:content", null);
        assertEquals(Use.ORIGINAL, original.use());
        assertFalse(original.decision().allowed());
        assertEquals(Reason.CHANNEL_NOT_COVERED, original.decision().reason());
        assertEquals("Print", original.decision().channel());

        for (String name : new String[] { "MP4 480p", "WebM 480p" }) {
            DownloadDecision web = download(noPrint, null, name);
            assertEquals(Use.rendition(name), web.use());
            assertEquals(Decision.allow(Reason.CLEARED, "E-commerce"), web.decision(), name);
        }
        // At their places, as by their names: WebM 480p finished first.
        assertEquals(Use.rendition("WebM 480p"), download(noPrint, "vid:transcodedVideos/0/content", null).use());
        assertEquals(Use.rendition("MP4 480p"), download(noPrint, "vid:transcodedVideos/1/content", null).use());
        assertEquals(Decision.allow(Reason.CLEARED, "E-commerce"),
                download(noPrint, "vid:transcodedVideos/1/content", null).decision());
    }

    @Test
    void onceTheRightsHaveEndedTheTranscodedVideosAreRefusedAndTheStillFramesServed() throws Exception {
        DocumentModel ended = video("2026-11-14", "E-commerce", "Social", "Print").model();

        assertEquals(Reason.RIGHTS_ENDED, download(ended, null, "MP4 480p").decision().reason());
        assertEquals(Reason.RIGHTS_ENDED, download(ended, "vid:transcodedVideos/0/content", null).decision().reason());
        assertEquals(Reason.RIGHTS_ENDED, download(ended, "file:content", null).decision().reason());
        assertEquals(Decision.allow(Reason.PREVIEW, null), download(ended, "picture:views/1/content", null).decision());
        assertEquals(Decision.allow(Reason.PREVIEW, null), download(ended, null, "thumbnail").decision());
        for (int frame = 0; frame < 12; frame++) {
            DownloadDecision decided = download(ended, "vid:storyboard/" + frame + "/content", null);
            assertEquals(Use.STORYBOARD, decided.use());
            assertEquals(Decision.allow(Reason.PREVIEW, null), decided.decision(), "frame " + frame);
        }
    }

    /**
     * What the kit's policy does not list is refused, even to an asset cleared on every channel: a
     * conversion it does not name, at its place or by name, a frame the video does not have, another
     * file of it.
     */
    @Test
    void whatThePolicyDoesNotListIsRefusedToEveryone() throws Exception {
        Fakes.Doc doc = video("2027-12-31", "E-commerce", "Wholesale", "Social", "Print").transcoded("MP4 480p",
                "WebM 480p", "Ogg 480p");
        doc.properties.put("files:files/0/file", (java.io.Serializable) Fakes.blob("attachment"));
        DocumentModel cleared = doc.model();

        DownloadDecision ogg = download(cleared, "vid:transcodedVideos/2/content", null);
        assertEquals(Use.rendition("Ogg 480p"), ogg.use());
        assertEquals(Decision.refuse(Reason.NOT_CLEARED), ogg.decision());
        assertEquals(Decision.refuse(Reason.NOT_CLEARED), download(cleared, null, "Ogg 480p").decision());
        assertEquals(Decision.refuse(Reason.NOT_CLEARED), download(cleared, "vid:storyboard/12/content", null).decision());
        assertEquals(Decision.refuse(Reason.NOT_CLEARED), download(cleared, "files:files/0/file", null).decision());
        // What the rights cover is served.
        assertTrue(download(cleared, null, "MP4 480p").decision().allowed());
        assertTrue(download(cleared, "vid:transcodedVideos/0/content", null).decision().allowed());
        assertTrue(download(cleared, "file:content", null).decision().allowed());
    }

    /** The enricher explains each transcoded video by its conversion's name, and the storyboard as one use. */
    @Test
    void theEnricherListsTheTranscodedVideosByNameAndTheStoryboard() throws Exception {
        RightsPolicy policy = RightsPolicy.of(kitVideoPolicy());
        List<Use> uses = AssetRightsJsonEnricher.uses(video("2027-06-30", "Social").transcoded("Ogg 480p").model(),
                policy);
        assertEquals(List.of(Use.ORIGINAL, Use.view("Small"), Use.view("StaticPlayerView"), Use.rendition("Ogg 480p"),
                Use.rendition("MP4 480p"), Use.rendition("WebM 480p"), Use.rendition("thumbnail"), Use.STORYBOARD), uses);
    }
}
