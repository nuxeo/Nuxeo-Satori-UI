/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

import org.nuxeo.agentic.assets.rights.Watermark;
import org.nuxeo.agentic.assets.rights.Watermark.Placement;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * Since 0.6.0: a video a rights policy's watermark marks, marked in the request when it is short,
 * and in the background when it is long, by the platform's work manager, then kept for whom it was
 * marked ({@link MarkedVideosComponent}).
 *
 * <p>The caller has decided the rights for the person first, as a download of the use is decided;
 * this decides nothing of the rights, and never answers the unmarked file.
 */
public interface MarkedVideos {

    /** Why the video is marked: for the person downloading, or for a delivery's distributor. */
    enum Purpose {
        DOWNLOAD("download"), DELIVERY("delivery");

        private final String code;

        Purpose(String code) {
            this.code = code;
        }

        public String code() {
            return code;
        }
    }

    /**
     * What is asked: the file a document holds at {@code xpath} for {@code use}, marked with
     * {@code text}, drawn from {@code template} at {@code placement}, for {@code recipient},
     * {@code user} and {@code territory}, under the watermark whose {@code fingerprint} this is.
     *
     * @param xpath where the document holds the file, which the background reads it from again;
     *            {@code null} for a file with no place, such as a rendition the rendition service
     *            computes, which is marked in the request or not at all
     */
    record Order(String repository, String document, String type, String xpath, String use, Blob file,
            String text, Placement placement, String template, String fingerprint, String recipient, String user,
            String territory, Purpose purpose) {

        /** The order for {@code document}'s {@code file}, under {@code watermark}, its text filled. */
        public static Order of(DocumentModel document, String use, String xpath, Blob file, Watermark watermark,
                String text, String recipient, String user, String territory, Purpose purpose) {
            return new Order(document.getRepositoryName(), document.getId(), document.getType(), xpath, use, file,
                    text, watermark.placement(), watermark.template(),
                    MarkedVideos.fingerprint(document.getType(), watermark),
                    recipient == null ? "" : recipient, user == null ? "" : user, territory == null ? "" : territory,
                    purpose);
        }
    }

    /** What the request is answered. */
    sealed interface Outcome permits Marked, Preparing, Refused {
    }

    /**
     * The file marked: made in the request, or a kept copy.
     *
     * @param copy the kept copy's document id, or {@code null} for a file made in the request
     */
    record Marked(Blob file, String copy) implements Outcome {
    }

    /** Being marked in the background: ask again, in about {@code retryAfter} seconds. */
    record Preparing(int retryAfter) implements Outcome {
    }

    /** Not marked, and not to be served: why, in a few words a person can read. */
    record Refused(String reason) implements Outcome {
    }

    /** The order marked, being marked, or refused; never the unmarked file. Never throws. */
    Outcome mark(Order order);

    /**
     * The kept copies for deliveries of {@code file}, once a delivery holding it is created: dropped,
     * in {@code session}'s transaction, so that a delivery's file is held by the delivery alone.
     */
    void delivered(CoreSession session, Blob file);

    /**
     * The SHA-256, in hex, of a policy's type and its watermark's whole definition: a copy kept under
     * another is dropped, and never served.
     */
    static String fingerprint(String type, Watermark watermark) {
        return sha256(field(type) + field(watermark.definition()));
    }

    /** A field, as a key is written from it: its length, then itself, so that no two runs of fields read alike. */
    static String field(String value) {
        String written = value == null ? "" : value;
        return written.length() + ":" + written + ";";
    }

    static String sha256(String text) {
        try {
            return HexFormat.of()
                            .formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is missing", e);
        }
    }

    /**
     * What the background job is given, for the work manager to keep: text only, never a file. It
     * reads the file again from its document, at its place, and marks it only while it has the
     * digest it was asked for; {@code marker} is the job's marker as it was queued, which it removes
     * when it ends only if it is still that one.
     */
    record Job(String key, String repository, String document, String type, String xpath, String use, String digest,
            String text, String placement, String fingerprint, String recipient, String user, String territory,
            String purpose, String marker) implements Serializable {
    }
}
