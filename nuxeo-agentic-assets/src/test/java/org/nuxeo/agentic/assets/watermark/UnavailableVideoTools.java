/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.util.List;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.platform.video.tools.VideoToolsService;
import org.nuxeo.runtime.model.DefaultComponent;

/**
 * The video tools of a server without ffmpeg: no tool is available, and a tool asked for all the
 * same fails, as the platform's does when its command line cannot run.
 */
public class UnavailableVideoTools extends DefaultComponent implements VideoToolsService {

    /** How many times a video was given to a tool: none should be, since none is available. */
    static volatile int calls;

    @Override
    public Blob extractClosedCaptions(Blob video, String outFormat, String startAt, String endAt) {
        throw unavailable();
    }

    @Override
    public Blob concat(List<Blob> videos) {
        throw unavailable();
    }

    @Override
    public List<Blob> slice(Blob video, String startAt, String duration, boolean encode) {
        throw unavailable();
    }

    @Override
    public Blob watermark(Blob video, Blob picture, String x, String y) {
        throw unavailable();
    }

    @Override
    public boolean isToolAvailable(String tool) {
        return false;
    }

    private static IllegalStateException unavailable() {
        calls++;
        return new IllegalStateException("The video tool is not available.");
    }
}
