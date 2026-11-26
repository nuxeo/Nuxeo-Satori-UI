/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * How a series writes its revisions: the first one, and the one after a given one.
 *
 * <ul>
 * <li>{@link #LETTERS}: A, B, ... Z, then AA, AB, ... as a spreadsheet names its columns.</li>
 * <li>{@link #NUMBERS}: 1, 2, 3 ...</li>
 * </ul>
 *
 * A revision the scheme does not write, which only an import or an administrator's change could
 * leave, has no next one: superseding it is refused rather than guessed.
 */
public enum RevisionScheme {

    LETTERS(Pattern.compile("[A-Z]{1,6}")) {
        @Override
        public String first() {
            return "A";
        }

        @Override
        long index(String revision) {
            long index = 0;
            for (char c : revision.toCharArray()) {
                index = index * 26 + (c - 'A' + 1);
            }
            return index;
        }

        @Override
        String write(long index) {
            StringBuilder letters = new StringBuilder();
            for (long n = index; n > 0; n = (n - 1) / 26) {
                letters.insert(0, (char) ('A' + (n - 1) % 26));
            }
            return letters.toString();
        }
    },

    NUMBERS(Pattern.compile("[1-9][0-9]{0,8}")) {
        @Override
        public String first() {
            return "1";
        }

        @Override
        long index(String revision) {
            return Long.parseLong(revision);
        }

        @Override
        String write(long index) {
            return Long.toString(index);
        }
    };

    private final Pattern form;

    RevisionScheme(Pattern form) {
        this.form = form;
    }

    /** The revision of a document's first revision. */
    public abstract String first();

    /** The revision's place in the scheme, 1 for the first. */
    abstract long index(String revision);

    /** The revision at a place in the scheme. */
    abstract String write(long index);

    /** Whether the scheme writes this revision. */
    public boolean writes(String revision) {
        return revision != null && form.matcher(revision).matches();
    }

    /**
     * The revision after this one, or {@code null} when the scheme does not write it, or the next
     * would be longer than the scheme writes.
     */
    public String next(String revision) {
        if (!writes(revision)) {
            return null;
        }
        String next = write(index(revision) + 1);
        return writes(next) ? next : null;
    }

    /** The scheme a series names, {@code letters} or {@code numbers}; {@code null} for any other. */
    public static RevisionScheme named(String name) {
        if (name == null || name.isBlank()) {
            return LETTERS;
        }
        return switch (name.trim().toLowerCase(Locale.ROOT)) {
            case "letters" -> LETTERS;
            case "numbers" -> NUMBERS;
            default -> null;
        };
    }
}
