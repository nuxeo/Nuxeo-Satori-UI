/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.util.Objects;

/**
 * One use of an asset's bytes, as a rights policy names it: its original, a picture view by its
 * title, a rendition by its name, a video's storyboard, another blob by its xpath, or one the
 * download did not let us name, which no policy lists and so is always refused.
 *
 * @param kind what is downloaded
 * @param name the view's title, the rendition's name or the blob's xpath; {@code null} for the
 *            original and the storyboard, and what was seen, if anything, for an unknown use
 */
public record Use(Kind kind, String name) {

    /** What a download is of. The wire names are the enricher's, and the client's. */
    public enum Kind {
        ORIGINAL("original"), VIEW("view"), RENDITION("rendition"), BLOB("blob"), UNKNOWN("unknown"),
        STORYBOARD("storyboard");

        private final String code;

        Kind(String code) {
            this.code = code;
        }

        /** The kind as the {@code assetRights} enricher writes it. */
        public String code() {
            return code;
        }
    }

    public static final Use ORIGINAL = new Use(Kind.ORIGINAL, null);

    /** Every frame of a video's storyboard, {@code vid:storyboard/<n>/content}: one use, whatever the frame. */
    public static final Use STORYBOARD = new Use(Kind.STORYBOARD, null);

    public Use {
        Objects.requireNonNull(kind, "kind");
    }

    public static Use view(String title) {
        return new Use(Kind.VIEW, Objects.requireNonNull(title, "title"));
    }

    public static Use rendition(String name) {
        return new Use(Kind.RENDITION, Objects.requireNonNull(name, "name"));
    }

    public static Use blob(String xpath) {
        return new Use(Kind.BLOB, Objects.requireNonNull(xpath, "xpath"));
    }

    /** A download this add-on could not name, such as a view whose title it could not read. */
    public static Use unknown(String seen) {
        return new Use(Kind.UNKNOWN, seen);
    }

    @Override
    public String toString() {
        return name == null ? kind.code() : kind.code() + " " + name;
    }
}
