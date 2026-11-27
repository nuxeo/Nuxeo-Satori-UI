/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import org.nuxeo.agentic.assets.rights.Watermark.Placement;
import org.nuxeo.agentic.assets.watermark.AssetWatermarks.Unavailable;
import org.nuxeo.ecm.core.api.Blob;

/**
 * What marks a video, since 0.6.0: the platform's video tools on a server
 * ({@link PlatformVideoMarker}, which runs ffmpeg), a service of its own so that a test runtime
 * without ffmpeg stands in for it, as the tests stand in for the platform's {@code VideoToolsService}.
 * Every caller goes through {@link AssetWatermarks}, which refuses when the service is missing, says
 * it is not available, or fails: a video is never served unmarked in its place.
 */
public interface VideoMarker {

    /** A video's frame, as ffprobe reports it, before any rotation flag, and its length in seconds. */
    record Probe(long width, long height, double seconds) {
    }

    /** Whether the tool can run here: on a server without ffmpeg, it cannot. Never throws. */
    boolean available();

    /** The video's frame and length, read from its header. */
    Probe probe(Blob video) throws Unavailable;

    /**
     * {@code video} marked with {@code text} at {@code placement}, over every frame, as a new file:
     * the text is drawn as pixels, and reaches no command line.
     */
    Blob mark(Blob video, Probe probe, String text, Placement placement) throws Unavailable;
}
