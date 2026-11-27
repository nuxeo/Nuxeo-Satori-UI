/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.util.Arrays;
import java.util.List;

import javax.imageio.ImageIO;
import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.agentic.assets.rights.Watermark.Placement;
import org.nuxeo.agentic.assets.share.Watermarker;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.impl.UserPrincipal;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.core.test.annotations.Granularity;
import org.nuxeo.ecm.core.test.annotations.RepositoryConfig;
import org.nuxeo.ecm.platform.commandline.executor.api.CommandLineExecutorService;
import org.nuxeo.ecm.platform.video.VideoHelper;
import org.nuxeo.ecm.platform.video.VideoInfo;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * A video marked through the platform's own video tools, in a real Nuxeo runtime: its
 * {@code VideoToolsService}, its {@code videoWatermarkWithPicture} and {@code ffmpeg-info} command
 * lines, and its command line executor, which run ffmpeg and ffprobe. <strong>Run where ffmpeg is
 * installed;</strong> elsewhere, as on a build machine without it, the marking test is skipped, and
 * {@link VideoWatermarkRefusedTest} holds what a server without ffmpeg does: refuse.
 */
@RunWith(FeaturesRunner.class)
@Features(CoreFeature.class)
@RepositoryConfig(cleanup = Granularity.METHOD)
@Deploy("org.nuxeo.ecm.automation.core")
@Deploy("org.nuxeo.ecm.platform.commandline.executor")
@Deploy("org.nuxeo.ecm.platform.tag:OSGI-INF/faceted-tag-service-core-types.xml")
@Deploy("org.nuxeo.ecm.platform.picture.core:OSGI-INF/picture-schemas-contrib.xml")
@Deploy("org.nuxeo.ecm.platform.video:OSGI-INF/core-types-contrib.xml")
@Deploy("org.nuxeo.ecm.platform.video:OSGI-INF/commandline-contrib.xml")
@Deploy("org.nuxeo.ecm.platform.video:OSGI-INF/video-tools-service.xml")
@Deploy("org.nuxeo.ecm.platform.video:OSGI-INF/video-tools-commandlines-contrib.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-rights-service.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-rights-download-permission.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-watermark-operations-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-video-model-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-watermark-policy-contrib.xml")
public class VideoWatermarkTest {

    private static final NuxeoPrincipal READER = new UserPrincipal("olga", List.of("members"), false, false);

    @Inject
    protected CoreSession session;

    private String video;

    @Before
    public void setUp() {
        video = VideoWatermarks.video(session).getId();
        TransactionHelper.commitOrRollbackTransaction();
        TransactionHelper.startTransaction();
    }

    private static boolean ffmpeg() {
        CommandLineExecutorService commands = Framework.getService(CommandLineExecutorService.class);
        return commands.getCommandAvailability("ffmpeg-info").isAvailable()
                && commands.getCommandAvailability("videoWatermarkWithPicture").isAvailable();
    }

    @Test
    public void theOriginalIsRefusedUnmarkedWhereverFfmpegIs() {
        assertFalse(VideoWatermarks.downloads(session, video, READER));
    }

    @Test
    public void whereFfmpegIsTheVideoIsMarkedThroughThePlatformsVideoTools() throws Exception {
        assumeTrue("ffmpeg and ffprobe are not installed here: VideoWatermarkRefusedTest holds the refusal",
                ffmpeg());
        Blob original = VideoWatermarks.kitVideo();
        VideoInfo before = VideoHelper.getVideoInfo(original);
        assertTrue(before.getWidth() > 0 && before.getHeight() > 0);

        Blob marked = VideoWatermarks.marked(session.getRepositoryName(), video, READER);
        assertEquals("video/webm", marked.getMimeType());
        assertEquals("ast-511-watermarked.webm", marked.getFilename());
        assertFalse("a new video, not the original", Arrays.equals(original.getByteArray(), marked.getByteArray()));
        VideoInfo after = VideoHelper.getVideoInfo(marked);
        assertEquals(before.getWidth(), after.getWidth());
        assertEquals(before.getHeight(), after.getHeight());
        assertTrue(after.getDuration() > 0);
    }

    /**
     * What is drawn over every frame: the text alone, on a transparent picture of the video's size,
     * at the policy's place, its bottom right; so nothing of the policy's text reaches a command line.
     */
    @Test
    public void theMarkDrawnOverTheFramesIsTheTextAloneAtItsPlace() throws Exception {
        byte[] png = new Watermarker().overlay(320, 180, "ACME OUTDOOR · olga", Placement.BOTTOM_RIGHT);
        BufferedImage overlay = ImageIO.read(new ByteArrayInputStream(png));
        assertEquals(320, overlay.getWidth());
        assertEquals(180, overlay.getHeight());
        assertEquals("the top left is clear", 0, overlay.getRGB(4, 4) >>> 24);
        boolean drawn = false;
        for (int x = 160; x < 320 && !drawn; x++) {
            for (int y = 120; y < 180 && !drawn; y++) {
                drawn = (overlay.getRGB(x, y) >>> 24) > 0;
            }
        }
        assertTrue("the text is at the bottom right", drawn);
    }
}
