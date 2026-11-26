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
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.assets.rights.AssetRightsService.DownloadDecision;
import org.nuxeo.agentic.assets.rights.Decision.Reason;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * The brand kit's video policy, read from where the kit keeps it, deciding a video asset's
 * downloads as the platform names them to the download permission: what this add-on enforces of a
 * video, and what it does not tell apart. No code of the add-on is changed for video; these hold
 * what it does with the kit's policy as it is.
 */
class KitVideoPolicyTest {

    static final Path KIT_VIDEO_COMPONENT = Path.of("..", "business-apps", "packages", "brand-assets-demo",
            "bundle", "OSGI-INF", "brand-assets-demo-video-rights.xml");

    private static RightsPolicyDescriptor kitVideoPolicy() throws Exception {
        List<RightsPolicyDescriptor> policies = RightsPolicyTest.contributed(Files.readAllBytes(KIT_VIDEO_COMPONENT));
        assertEquals(1, policies.size());
        return policies.get(0);
    }

    /** A video asset as the kit seeds one: its original, its poster views, on these channels. */
    private static Fakes.Doc video(String rightsEnd, String... channels) {
        Fakes.Doc doc = new Fakes.Doc().rightsEnd(rightsEnd).channels(channels).original("original-digest");
        doc.type = "AcmeVideo";
        doc.schemas.add("video");
        // A Video's picture views are the frames Nuxeo takes from it, Small and StaticPlayerView.
        return doc.views("Small", "StaticPlayerView");
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
    }

    /** The kit's demo: a video with no Print channel, its original refused, its web cut served. */
    @Test
    void withNoPrintChannelTheOriginalIsRefusedAndTheTranscodedVideosServedByName() throws Exception {
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
    }

    @Test
    void onceTheRightsHaveEndedTheTranscodedVideosAreRefusedAndTheStillFramesServed() throws Exception {
        DocumentModel ended = video("2026-11-14", "E-commerce", "Social", "Print").model();

        assertEquals(Reason.RIGHTS_ENDED, download(ended, null, "MP4 480p").decision().reason());
        assertEquals(Reason.RIGHTS_ENDED, download(ended, "file:content", null).decision().reason());
        assertEquals(Decision.allow(Reason.PREVIEW, null), download(ended, "picture:views/1/content", null).decision());
        assertEquals(Decision.allow(Reason.PREVIEW, null), download(ended, null, "thumbnail").decision());
        assertEquals(Decision.allow(Reason.PREVIEW, null), download(ended, "vid:storyboard/8/content", null).decision());
    }

    /**
     * What the add-on does not tell apart, and so refuses: a transcoded video's file at its place in
     * vid:transcodedVideos is named by that place, not by its conversion's name, as a picture view is
     * by its title, so the kit lists none, and every one is refused there, even to an asset cleared
     * on every channel; and a storyboard frame past the nine the kit lists.
     */
    @Test
    void aTranscodedVideoByItsPlaceAndAFramePastTheNinthAreRefusedToEveryone() throws Exception {
        DocumentModel cleared = video("2027-12-31", "E-commerce", "Wholesale", "Social", "Print").model();

        DownloadDecision byPlace = download(cleared, "vid:transcodedVideos/0/content", null);
        assertEquals(Use.blob("vid:transcodedVideos/0/content"), byPlace.use());
        assertEquals(Decision.refuse(Reason.NOT_CLEARED), byPlace.decision());

        assertEquals(Decision.refuse(Reason.NOT_CLEARED), download(cleared, "vid:storyboard/9/content", null).decision());
        // A conversion no policy names, such as the platform's Ogg 480p when it is made, is refused too.
        assertEquals(Decision.refuse(Reason.NOT_CLEARED), download(cleared, null, "Ogg 480p").decision());
        // What the rights cover is served.
        assertTrue(download(cleared, null, "MP4 480p").decision().allowed());
        assertTrue(download(cleared, "file:content", null).decision().allowed());
    }

    /** The enricher explains what the page asks: each transcoded video by its rendition's name. */
    @Test
    void theEnricherListsTheTranscodedVideosByTheirRenditionsNames() throws Exception {
        RightsPolicy policy = RightsPolicy.of(kitVideoPolicy());
        Set<Use> uses = Set.copyOf(AssetRightsJsonEnricher.uses(video("2027-06-30", "Social").model(), policy));
        assertTrue(uses.contains(Use.ORIGINAL));
        assertTrue(uses.contains(Use.rendition("MP4 480p")));
        assertTrue(uses.contains(Use.rendition("WebM 480p")));
        assertTrue(uses.contains(Use.view("StaticPlayerView")));
        assertTrue(uses.contains(Use.blob("vid:storyboard/0/content")));
        assertFalse(uses.contains(Use.blob("vid:transcodedVideos/0/content")));
    }
}
