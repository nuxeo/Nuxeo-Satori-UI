/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import java.util.Objects;

import org.nuxeo.agentic.assets.rights.Use;

/**
 * One thing a share link lists: the asset's original, or one of its picture views by its title. A
 * link serves nothing else: not a rendition of the rendition service, not another blob, not a
 * view by its place.
 *
 * <p>Written {@code original} or {@code view:<title>}, as the operations take and answer them and
 * the download log records them. A title is the view's {@code picture:views/n/title} exactly, of 1
 * to {@value #MAX_TITLE} characters, with no control character and no space at either end; a view
 * with no title cannot be listed.
 *
 * @param id the item as written
 * @param use the use the rights policy decides it as
 */
public record ShareItem(String id, Use use) {

    public static final String ORIGINAL = "original";

    static final String VIEW_PREFIX = "view:";

    static final int MAX_TITLE = 64;

    public ShareItem {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(use, "use");
    }

    /**
     * The item {@code id} names.
     *
     * @throws IllegalArgumentException when it names none
     */
    public static ShareItem parse(String id) {
        if (ORIGINAL.equals(id)) {
            return new ShareItem(id, Use.ORIGINAL);
        }
        if (id != null && id.startsWith(VIEW_PREFIX)) {
            String title = id.substring(VIEW_PREFIX.length());
            if (isTitle(title)) {
                return new ShareItem(id, Use.view(title));
            }
        }
        throw new IllegalArgumentException("not an item a share link lists: " + printable(id));
    }

    /** The view's title, or {@code null} for the original. */
    public String title() {
        return use.name();
    }

    public boolean isOriginal() {
        return use.equals(Use.ORIGINAL);
    }

    static boolean isTitle(String title) {
        if (title == null || title.isEmpty() || title.length() > MAX_TITLE || !title.equals(title.strip())) {
            return false;
        }
        return title.codePoints().noneMatch(c -> Character.isISOControl(c) || Character.getType(c) == Character.FORMAT);
    }

    /** {@code value} for a log line or a message: at most 80 characters, control characters replaced. */
    static String printable(String value) {
        if (value == null) {
            return "null";
        }
        String cut = value.length() > 80 ? value.substring(0, 80) + "…" : value;
        StringBuilder out = new StringBuilder(cut.length());
        cut.codePoints().forEach(c -> out.appendCodePoint(Character.isISOControl(c) ? '?' : c));
        return out.toString();
    }
}
