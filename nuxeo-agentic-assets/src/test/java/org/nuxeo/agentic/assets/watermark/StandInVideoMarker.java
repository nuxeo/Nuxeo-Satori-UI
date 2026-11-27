/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.nuxeo.agentic.assets.rights.Watermark.Placement;
import org.nuxeo.agentic.assets.watermark.AssetWatermarks.Unavailable;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.impl.blob.AbstractBlob;
import org.nuxeo.ecm.core.api.impl.blob.ByteArrayBlob;
import org.nuxeo.runtime.model.DefaultComponent;

/**
 * A stand-in for the platform's video tools, for a test runtime without ffmpeg: a "video" is text,
 * {@code STAND-IN VIDEO <name> seconds=<n>}, with a video's MIME type; ffprobe's part reads its
 * length from it, and the mark is the text drawn, the placement and the original's bytes, so that a
 * test reads who a marked copy names. It counts what it is asked, and on which thread, holds a mark
 * until a test opens its gate, and fails when told to.
 */
public class StandInVideoMarker extends DefaultComponent implements VideoMarker {

    private static final Pattern SECONDS = Pattern.compile("seconds=([0-9]+)");

    /** The first bytes of every marked video it answers. */
    public static final String MARKED = "MARKED|";

    static volatile boolean available = true;

    /** When set, every mark fails with this reason. */
    public static volatile String failWith;

    /** When set, a mark waits for it to open, up to 30 seconds. */
    static volatile CountDownLatch gate;

    /** When set, a mark answers a file that cannot be read, so that keeping it fails. */
    static volatile boolean unreadableOutput;

    static final AtomicInteger probes = new AtomicInteger();

    public static final AtomicInteger marks = new AtomicInteger();

    /** The thread each mark ran on. */
    static final List<String> threads = new CopyOnWriteArrayList<>();

    public static void reset() {
        available = true;
        failWith = null;
        gate = null;
        unreadableOutput = false;
        probes.set(0);
        marks.set(0);
        threads.clear();
    }

    @Override
    public boolean available() {
        return available;
    }

    @Override
    public Probe probe(Blob video) throws Unavailable {
        probes.incrementAndGet();
        Matcher seconds = SECONDS.matcher(text(video));
        if (!seconds.find()) {
            throw new Unavailable("the stand-in reads no length");
        }
        return new Probe(320, 180, Double.parseDouble(seconds.group(1)));
    }

    @Override
    public Blob mark(Blob video, Probe probe, String text, Placement placement) throws Unavailable {
        CountDownLatch held = gate;
        if (held != null) {
            try {
                if (!held.await(30, TimeUnit.SECONDS)) {
                    throw new Unavailable("the stand-in's gate was never opened");
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new Unavailable("interrupted", e);
            }
        }
        if (failWith != null) {
            throw new Unavailable(failWith);
        }
        marks.incrementAndGet();
        threads.add(Thread.currentThread().getName());
        if (unreadableOutput) {
            return new Unreadable(video.getMimeType());
        }
        String marked = MARKED + text + "|" + placement.code() + "|" + probe.width() + "x" + probe.height() + "\n"
                + text(video);
        return new ByteArrayBlob(marked.getBytes(StandardCharsets.UTF_8), video.getMimeType());
    }

    /** A marked file the repository cannot read when it keeps it, as a disk that failed would give. */
    static final class Unreadable extends AbstractBlob {

        private static final long serialVersionUID = 1L;

        Unreadable(String mimeType) {
            setMimeType(mimeType);
        }

        @Override
        public InputStream getStream() throws IOException {
            throw new IOException("the stand-in's output cannot be read");
        }

        @Override
        public long getLength() {
            return 42;
        }
    }

    /** A stand-in video, {@code length} bytes at least. */
    public static Blob video(String name, long seconds, int length) {
        StringBuilder content = new StringBuilder("STAND-IN VIDEO " + name + " seconds=" + seconds + " ");
        while (content.length() < length) {
            content.append('.');
        }
        Blob blob = new ByteArrayBlob(content.toString().getBytes(StandardCharsets.UTF_8), "video/mp4");
        blob.setFilename(name + ".mp4");
        return blob;
    }

    public static String text(Blob blob) {
        try {
            return new String(blob.getByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
