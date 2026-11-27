/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.util.Locale;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

import org.nuxeo.agentic.assets.rights.Watermark.Placement;
import org.nuxeo.agentic.assets.share.Watermarker;
import org.nuxeo.agentic.assets.share.Watermarker.WatermarkException;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.impl.blob.ByteArrayBlob;
import org.nuxeo.runtime.api.Framework;

/**
 * A file marked as a rights policy's watermark says, since 0.5.0.
 *
 * <ul>
 * <li><strong>A picture,</strong> a JPEG or a PNG, is drawn on the server, in Java, by the share
 * links' {@link Watermarker}, held to its limits on bytes, pixels, sides and memory, and written as
 * a new JPEG with nothing of the file but its pixels: the platform's own picture views, which
 * ImageMagick makes, are JPEGs, so a view is always one it marks. Made on demand, never kept.</li>
 * <li><strong>A video</strong> is marked by the {@link VideoMarker} service, the platform's video
 * tools on a server ({@link PlatformVideoMarker}), which run ffmpeg's {@code overlay} on every frame,
 * the mark drawn in Java so that the text never reaches a command line. A server without the
 * service, or whose service says ffmpeg is not available, refuses. Since 0.6.0 a long video is
 * marked in the background and kept ({@link MarkedVideos}), through {@link #markInBackground}; a
 * short one in the request, as before.</li>
 * <li><strong>Anything else,</strong> and a file over the limits, cannot be marked, and is refused:
 * {@link Unavailable}. The unmarked file is never answered in its place.</li>
 * </ul>
 *
 * At most two pictures, and one video, are marked at once in the requests of a node, apart, each
 * waiting its turn up to {@value #WAIT_SECONDS} seconds, then refused. A video marked in the
 * background takes no turn of the requests': the work manager's queue bounds those, one at a time on
 * a node unless an administrator says otherwise.
 */
public final class AssetWatermarks {

    /** How long a file waits for its turn to be marked. */
    static final int WAIT_SECONDS = 10;

    /** Pictures' turns: two at once on a node. */
    private static final Semaphore PICTURES = new Semaphore(2, true);

    /**
     * Videos' turn in the requests: one at a time on a node, apart from the pictures', so that a
     * video holds up no picture.
     */
    private static final Semaphore VIDEOS = new Semaphore(1, true);

    /** Why a file was not marked: it is to be refused, never served unmarked. */
    public static final class Unavailable extends Exception {

        private static final long serialVersionUID = 1L;

        public Unavailable(String message) {
            super(message);
        }

        public Unavailable(String message, Throwable cause) {
            super(message, cause);
        }
    }

    private AssetWatermarks() {
    }

    /** {@code file} marked with {@code text} at {@code placement}, in the request, taking its turn. */
    public static Blob mark(Blob file, String text, Placement placement) throws Unavailable {
        return mark(file, null, text, placement);
    }

    /**
     * As {@link #mark(Blob, String, Placement)}, given a video's {@code probe} when the caller has read
     * it already, so that ffprobe runs once.
     */
    public static Blob mark(Blob file, VideoMarker.Probe probe, String text, Placement placement)
            throws Unavailable {
        check(file, text);
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
            return video ? video(marker(), file, probe, text, placement) : picture(file, text, placement);
        } finally {
            turns.release();
        }
    }

    /**
     * A video marked in the background, since 0.6.0, by a job in the work manager's queue, which
     * bounds how many run at once: it takes no turn of the requests'.
     */
    static Blob markInBackground(Blob file, String text, Placement placement) throws Unavailable {
        check(file, text);
        if (!isVideo(file)) {
            throw new Unavailable("only a video is marked in the background");
        }
        return video(marker(), file, null, text, placement);
    }

    private static void check(Blob file, String text) throws Unavailable {
        if (file == null) {
            throw new Unavailable("there is no file to mark");
        }
        if (text == null || text.isBlank()) {
            throw new Unavailable("the watermark's text is empty");
        }
    }

    /** The video marker in force, or {@code null} for none, which refuses. */
    static VideoMarker marker() {
        try {
            return Framework.getService(VideoMarker.class);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** Whether the file says it is a video. Anything else is tried as a picture, which refuses all but a JPEG or a PNG. */
    public static boolean isVideo(Blob file) {
        String type = file == null ? null : file.getMimeType();
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

    /**
     * A video marked by {@code marker}: refused when there is none, when it says it cannot run, when
     * the video's size cannot be read or is over the watermark's limits, and when it answers nothing.
     * The new video keeps the original's container and file name, {@code -watermarked} added.
     */
    static Blob video(VideoMarker marker, Blob file, VideoMarker.Probe probe, String text, Placement placement)
            throws Unavailable {
        if (marker == null || !marker.available()) {
            throw new Unavailable("the server's video tools, which need ffmpeg, are not available");
        }
        VideoMarker.Probe size = probe == null ? marker.probe(file) : probe;
        if (size == null || size.width() <= 0 || size.height() <= 0 || size.width() > Watermarker.MAX_SIDE
                || size.height() > Watermarker.MAX_SIDE) {
            throw new Unavailable("the video's size could not be read, or is over the watermark's limits");
        }
        Blob marked;
        try {
            marked = marker.mark(file, size, text, placement);
        } catch (RuntimeException e) {
            throw new Unavailable("the video could not be marked", e);
        }
        if (marked == null || marked.getLength() == 0) {
            throw new Unavailable("the video tools answered no video");
        }
        String extension = extension(file.getFilename());
        marked.setFilename(base(file.getFilename()) + "-watermarked" + (extension.isEmpty() ? "" : "." + extension));
        marked.setMimeType(file.getMimeType());
        return marked;
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
