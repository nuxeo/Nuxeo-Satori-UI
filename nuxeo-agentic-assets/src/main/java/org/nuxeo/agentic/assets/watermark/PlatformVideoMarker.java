/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.rights.Watermark.Placement;
import org.nuxeo.agentic.assets.share.Watermarker;
import org.nuxeo.agentic.assets.share.Watermarker.WatermarkException;
import org.nuxeo.agentic.assets.watermark.AssetWatermarks.Unavailable;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.platform.video.VideoHelper;
import org.nuxeo.ecm.platform.video.VideoInfo;
import org.nuxeo.ecm.platform.video.tools.VideoToolsService;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.model.DefaultComponent;

/**
 * A video marked through the platform's own video tools, {@code VideoToolsService.watermark}, the
 * same the platform's {@code Video.AddWatermark} runs: its {@code videoWatermarkWithPicture} command
 * line draws a picture over every frame with ffmpeg's {@code overlay}. The mark is drawn in Java, on
 * a transparent PNG of the video's size, which the platform's {@code ffmpeg-info} command line,
 * ffprobe, reads; so the policy's text never reaches a command line. Tiled, the mark is drawn on a
 * square as wide as the video's longer side, so that it covers the frame however a rotation flag
 * turns it; at a corner or the centre, it is placed on the frame as ffprobe reports its size.
 */
public class PlatformVideoMarker extends DefaultComponent implements VideoMarker {

    private static final Logger log = LogManager.getLogger(PlatformVideoMarker.class);

    /** The platform's video watermark tool, {@code VideoWatermarker.NAME}, which runs ffmpeg. */
    static final String VIDEO_TOOL = "watermarkerTool";

    @Override
    public boolean available() {
        try {
            VideoToolsService tools = Framework.getService(VideoToolsService.class);
            return tools != null && tools.isToolAvailable(VIDEO_TOOL);
        } catch (RuntimeException e) {
            return false;
        }
    }

    @Override
    public Probe probe(Blob video) throws Unavailable {
        VideoInfo info;
        try {
            info = VideoHelper.getVideoInfo(video);
        } catch (RuntimeException e) {
            throw new Unavailable("the video's size could not be read: is ffmpeg installed?", e);
        }
        if (info == null) {
            throw new Unavailable("the video's size could not be read");
        }
        return new Probe(info.getWidth(), info.getHeight(), info.getDuration());
    }

    @Override
    public Blob mark(Blob video, Probe probe, String text, Placement placement) throws Unavailable {
        VideoToolsService tools = Framework.getService(VideoToolsService.class);
        if (tools == null) {
            throw new Unavailable("the server's video tools, which need ffmpeg, are not available");
        }
        byte[] overlay;
        try {
            int side = (int) Math.max(probe.width(), probe.height());
            overlay = placement == Placement.TILED ? new Watermarker().overlay(side, side, text, placement)
                    : new Watermarker().overlay((int) probe.width(), (int) probe.height(), text, placement);
        } catch (WatermarkException e) {
            throw new Unavailable("the mark could not be drawn: " + e.getMessage(), e);
        }
        File drawn = null;
        try {
            drawn = Framework.createTempFile("agentic-watermark-", ".png");
            Files.write(drawn.toPath(), overlay);
            Blob mark = Blobs.createBlob(drawn, "image/png");
            mark.setFilename("watermark.png");
            Blob marked = tools.watermark(video, mark, "0", "0");
            if (marked == null || marked.getLength() == 0) {
                throw new Unavailable("the video tools answered no video");
            }
            return marked;
        } catch (IOException | RuntimeException e) {
            throw new Unavailable("the video could not be marked", e);
        } finally {
            if (drawn != null) {
                try {
                    Files.deleteIfExists(drawn.toPath());
                } catch (IOException e) {
                    log.warn("Asset rights: a watermark's drawing could not be removed: {}", drawn, e);
                }
            }
        }
    }
}
