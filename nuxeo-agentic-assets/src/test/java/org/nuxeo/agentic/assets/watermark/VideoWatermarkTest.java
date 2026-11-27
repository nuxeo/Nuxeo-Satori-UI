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
import org.nuxeo.runtime.test.runner.TransactionalFeature;
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
@Deploy("org.nuxeo.runtime.kv")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-video-marker.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-watermarked-copies-types.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-video-watermark-service.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-video-model-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-watermark-policy-contrib.xml")
public class VideoWatermarkTest {

    private static final NuxeoPrincipal READER = new UserPrincipal("olga", List.of("members"), false, false);

    @Inject
    protected CoreSession session;

    @Inject
    protected TransactionalFeature transactions;

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

        // A frame carries the mark where the policy places it, its bottom right, and is the original's
        // elsewhere, but for the new encoding's noise.
        BufferedImage plain = frame(original);
        BufferedImage drawn = frame(marked);
        int width = plain.getWidth();
        int height = plain.getHeight();
        double atTheMark = difference(plain, drawn, width / 2, height * 2 / 3, width, height);
        double elsewhere = difference(plain, drawn, 0, 0, width / 2, height / 3);
        assertTrue("the mark at the bottom right: " + atTheMark + " against " + elsewhere,
                atTheMark > 3 * elsewhere + 2);
    }

    /**
     * Since 0.6.0, where ffmpeg is: a video over the bytes set, every one here, is marked in the
     * background by the platform's own video tools, its copy kept and then served, the mark over its
     * frames, and the same copy served to the same reader again.
     */
    @Test
    public void whereFfmpegIsALongVideoIsMarkedInTheBackgroundAndItsCopyServed() throws Exception {
        assumeTrue("ffmpeg and ffprobe are not installed here: VideoWatermarkBackgroundTest holds the job's lifecycle",
                ffmpeg());
        Framework.getProperties().setProperty(MarkedVideosComponent.BYTES_PROPERTY, "0");
        try {
            Blob preparing = VideoWatermarks.marked(session.getRepositoryName(), video, READER);
            assertEquals("application/json", preparing.getMimeType());
            assertTrue(preparing.getString(), preparing.getString().contains("\"status\":\"preparing\""));
            transactions.nextTransaction();

            Blob original = VideoWatermarks.kitVideo();
            Blob marked = VideoWatermarks.marked(session.getRepositoryName(), video, READER);
            assertEquals("video/webm", marked.getMimeType());
            assertEquals("ast-511-watermarked.webm", marked.getFilename());
            assertFalse("a new video, not the original", Arrays.equals(original.getByteArray(), marked.getByteArray()));
            VideoInfo before = VideoHelper.getVideoInfo(original);
            VideoInfo after = VideoHelper.getVideoInfo(marked);
            assertEquals(before.getWidth(), after.getWidth());
            assertEquals(before.getHeight(), after.getHeight());
            BufferedImage plain = frame(original);
            BufferedImage drawn = frame(marked);
            int width = plain.getWidth();
            int height = plain.getHeight();
            double atTheMark = difference(plain, drawn, width / 2, height * 2 / 3, width, height);
            double elsewhere = difference(plain, drawn, 0, 0, width / 2, height / 3);
            assertTrue("the mark at the bottom right: " + atTheMark + " against " + elsewhere,
                    atTheMark > 3 * elsewhere + 2);
            Blob again = VideoWatermarks.marked(session.getRepositoryName(), video, READER);
            assertTrue("the kept copy, served again", Arrays.equals(marked.getByteArray(), again.getByteArray()));
        } finally {
            Framework.getProperties().remove(MarkedVideosComponent.BYTES_PROPERTY);
        }
    }

    /** The first frame of {@code video}, taken by the platform's own {@code ffmpeg-screenshot}. */
    private static BufferedImage frame(Blob video) throws Exception {
        org.nuxeo.ecm.platform.commandline.executor.api.CommandLineExecutorService commands = Framework.getService(
                org.nuxeo.ecm.platform.commandline.executor.api.CommandLineExecutorService.class);
        java.io.File out = Framework.createTempFile("agentic-frame-", ".png");
        try (org.nuxeo.ecm.core.api.CloseableFile in = video.getCloseableFile()) {
            org.nuxeo.ecm.platform.commandline.executor.api.CmdParameters parameters = commands.getDefaultCmdParameters();
            parameters.addNamedParameter("inFilePath", in.getFile().getAbsolutePath());
            parameters.addNamedParameter("outFilePath", out.getAbsolutePath());
            parameters.addNamedParameter("position", "0");
            assertTrue(commands.execCommand("ffmpeg-screenshot", parameters).isSuccessful());
            return ImageIO.read(out);
        } finally {
            java.nio.file.Files.deleteIfExists(out.toPath());
        }
    }

    /** The mean difference of the two frames' channels over a region. */
    private static double difference(BufferedImage a, BufferedImage b, int left, int top, int right, int bottom) {
        long sum = 0;
        long count = 0;
        for (int x = left; x < right; x++) {
            for (int y = top; y < bottom; y++) {
                int p = a.getRGB(x, y);
                int q = b.getRGB(x, y);
                for (int shift = 0; shift <= 16; shift += 8) {
                    sum += Math.abs(((p >> shift) & 0xff) - ((q >> shift) & 0xff));
                    count++;
                }
            }
        }
        return count == 0 ? 0 : (double) sum / count;
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
