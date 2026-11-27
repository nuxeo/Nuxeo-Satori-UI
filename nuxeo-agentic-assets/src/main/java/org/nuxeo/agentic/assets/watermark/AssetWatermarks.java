/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Locale;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.rights.Watermark.Placement;
import org.nuxeo.agentic.assets.share.Watermarker;
import org.nuxeo.agentic.assets.share.Watermarker.WatermarkException;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.impl.blob.ByteArrayBlob;
import org.nuxeo.ecm.platform.video.VideoHelper;
import org.nuxeo.ecm.platform.video.VideoInfo;
import org.nuxeo.ecm.platform.video.tools.VideoToolsService;
import org.nuxeo.runtime.api.Framework;

/**
 * A file marked as a rights policy's watermark says, since 0.5.0: made on demand, never cached, so
 * that a mark naming its reader is never served to another.
 *
 * <ul>
 * <li><strong>A picture,</strong> a JPEG or a PNG, is drawn on the server, in Java, by the share
 * links' {@link Watermarker}, held to its limits on bytes, pixels, sides and memory, and written as
 * a new JPEG with nothing of the file but its pixels: the platform's own picture views, which
 * ImageMagick makes, are JPEGs, so a view is always one it marks.</li>
 * <li><strong>A video</strong> is marked through the platform's video tools,
 * {@code VideoToolsService.watermark}, which runs ffmpeg's {@code overlay} on every frame: the mark
 * is drawn in Java on a transparent picture of the video's size, which the platform's
 * {@code ffmpeg-info} reads, so that the text never reaches a command line. A server without
 * ffmpeg, or whose video tools say the tool is not available, refuses.</li>
 * <li><strong>Anything else,</strong> and a file over the limits, cannot be marked, and is refused:
 * {@link Unavailable}. The unmarked file is never answered in its place.</li>
 * </ul>
 *
 * At most two pictures, and one video, are marked at once on a node, apart, each waiting its turn up
 * to {@value #WAIT_SECONDS} seconds, then refused. A video's mark at a corner or the centre is placed
 * on its frame as ffprobe reports its size, before any rotation flag turns it.
 */
public final class AssetWatermarks {

    private static final Logger log = LogManager.getLogger(AssetWatermarks.class);

    /** The platform's video watermark tool, {@code VideoWatermarker.NAME}, which runs ffmpeg. */
    static final String VIDEO_TOOL = "watermarkerTool";

    /** How long a file waits for its turn to be marked. */
    static final int WAIT_SECONDS = 10;

    /** Pictures' turns: two at once on a node. */
    private static final Semaphore PICTURES = new Semaphore(2, true);

    /**
     * Videos' turn: one at a time on a node, apart from the pictures', so that a long video holds up
     * no picture.
     */
    private static final Semaphore VIDEOS = new Semaphore(1, true);

    /** Why a file was not marked: it is to be refused, never served unmarked. */
    public static final class Unavailable extends Exception {

        private static final long serialVersionUID = 1L;

        public Unavailable(String message) {
            super(message);
        }

        Unavailable(String message, Throwable cause) {
            super(message, cause);
        }
    }

    private AssetWatermarks() {
    }

    /** {@code file} marked with {@code text} at {@code placement}. */
    public static Blob mark(Blob file, String text, Placement placement) throws Unavailable {
        if (file == null) {
            throw new Unavailable("there is no file to mark");
        }
        if (text == null || text.isBlank()) {
            throw new Unavailable("the watermark's text is empty");
        }
        boolean video = isVideo(file);
        Semaphore turns = video ? VIDEOS : PICTURES;
        boolean turn;
        try {
            turn = turns.tryAcquire(WAIT_SECONDS, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new Unavailable("interrupted while waiting to mark the file", e);
        }
        if (!turn) {
            throw new Unavailable("the server is marking other files: try again");
        }
        try {
            return video ? video(file, text, placement) : picture(file, text, placement);
        } finally {
            turns.release();
        }
    }

    /** Whether the file says it is a video. Anything else is tried as a picture, which refuses all but a JPEG or a PNG. */
    static boolean isVideo(Blob file) {
        String type = file.getMimeType();
        return type != null && type.toLowerCase(Locale.ROOT).trim().startsWith("video/");
    }

    static Blob picture(Blob file, String text, Placement placement) throws Unavailable {
        Watermarker watermarker = new Watermarker();
        try {
            byte[] marked = watermarker.watermark(watermarker.read(file), text, placement);
            Blob blob = new ByteArrayBlob(marked, "image/jpeg");
            blob.setFilename(base(file.getFilename()) + "-watermarked.jpg");
            return blob;
        } catch (WatermarkException e) {
            throw new Unavailable("the file cannot be marked: " + e.getMessage(), e);
        }
    }

    static Blob video(Blob file, String text, Placement placement) throws Unavailable {
        VideoToolsService tools = Framework.getService(VideoToolsService.class);
        if (tools == null || !available(tools)) {
            throw new Unavailable("the server's video tools, which need ffmpeg, are not available");
        }
        VideoInfo info;
        try {
            info = VideoHelper.getVideoInfo(file);
        } catch (RuntimeException e) {
            throw new Unavailable("the video's size could not be read: is ffmpeg installed?", e);
        }
        long width = info == null ? 0 : info.getWidth();
        long height = info == null ? 0 : info.getHeight();
        if (width <= 0 || height <= 0 || width > Watermarker.MAX_SIDE || height > Watermarker.MAX_SIDE) {
            throw new Unavailable("the video's size could not be read, or is over the watermark's limits");
        }
        byte[] overlay;
        try {
            // Tiled, the mark is drawn on a square as wide as the video's longer side, so that it covers
            // the frame however a rotation flag turns it when ffmpeg decodes it.
            int side = (int) Math.max(width, height);
            overlay = placement == Placement.TILED ? new Watermarker().overlay(side, side, text, placement)
                    : new Watermarker().overlay((int) width, (int) height, text, placement);
        } catch (WatermarkException e) {
            throw new Unavailable("the mark could not be drawn: " + e.getMessage(), e);
        }
        File drawn = null;
        try {
            drawn = Framework.createTempFile("agentic-watermark-", ".png");
            Files.write(drawn.toPath(), overlay);
            Blob mark = Blobs.createBlob(drawn, "image/png");
            mark.setFilename("watermark.png");
            Blob marked = tools.watermark(file, mark, "0", "0");
            if (marked == null || marked.getLength() == 0) {
                throw new Unavailable("the video tools answered no video");
            }
            String extension = extension(file.getFilename());
            marked.setFilename(base(file.getFilename()) + "-watermarked" + (extension.isEmpty() ? "" : "." + extension));
            marked.setMimeType(file.getMimeType());
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

    private static boolean available(VideoToolsService tools) {
        try {
            return tools.isToolAvailable(VIDEO_TOOL);
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** A file name without its extension or any path, or {@code file} for none. */
    static String base(String name) {
        if (name == null || name.isBlank()) {
            return "file";
        }
        String last = name.replace('\\', '/');
        last = last.substring(last.lastIndexOf('/') + 1);
        int dot = last.lastIndexOf('.');
        String base = dot > 0 ? last.substring(0, dot) : last;
        return base.isBlank() ? "file" : base;
    }

    /** A file name's extension, letters and digits only, or empty. */
    static String extension(String name) {
        if (name == null) {
            return "";
        }
        int dot = name.lastIndexOf('.');
        String extension = dot < 0 ? "" : name.substring(dot + 1);
        return extension.matches("[A-Za-z0-9]{1,8}") ? extension.toLowerCase(Locale.ROOT) : "";
    }
}
