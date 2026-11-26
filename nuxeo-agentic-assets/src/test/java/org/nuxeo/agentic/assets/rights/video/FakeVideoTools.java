/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights.video;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.stream.Collectors;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.platform.video.tools.VideoToolsService;
import org.nuxeo.runtime.model.DefaultComponent;

/**
 * The video tools the platform's {@code Video.*} operations call, with no ffmpeg: each answers a
 * text naming what it did, the bytes of each file it was given and every parameter it was handed,
 * so that a test sees which file the platform's operation read, and with what.
 */
public class FakeVideoTools extends DefaultComponent implements VideoToolsService {

    @Override
    public Blob extractClosedCaptions(Blob video, String outFormat, String startAt, String endAt) {
        return Blobs.createBlob("captions of " + text(video) + " as " + outFormat + " from " + startAt + " to " + endAt);
    }

    @Override
    public Blob concat(List<Blob> videos) {
        return Blobs.createBlob("concat of " + videos.stream().map(FakeVideoTools::text).collect(Collectors.joining(" + ")));
    }

    @Override
    public List<Blob> slice(Blob video, String startAt, String duration, boolean encode) {
        return List.of(Blobs.createBlob(
                "slice of " + text(video) + " from " + startAt + " for " + duration + (encode ? " encoded" : " copied")));
    }

    @Override
    public Blob watermark(Blob video, Blob picture, String x, String y) {
        return Blobs.createBlob("watermark of " + text(video) + " with " + text(picture) + " at " + x + "," + y);
    }

    @Override
    public boolean isToolAvailable(String tool) {
        return true;
    }

    static String text(Blob blob) {
        try {
            return blob == null ? "nothing" : blob.getString();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
