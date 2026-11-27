/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import java.util.List;
import java.util.regex.Pattern;

/**
 * One placeholder of a letter template, {@code {{...}}}: the whole of what a template may reach.
 *
 * <ul>
 * <li>{@code {{prefix:name}}}, or a complex property's subfield, {@code {{prefix:name/sub}}}: a
 * property of the record, a value or a list of values;</li>
 * <li>{@code {{prefix:ref>prefix2:name}}}: one hop, through a property of the record holding a
 * document's id, to a property of that document, read as the person who writes the letter;</li>
 * <li>{@code {{letter.date}}}, {@code {{letter.writer}}} and {@code {{letter.language}}}: the day it
 * is written, in its language, who writes it, and its language.</li>
 * </ul>
 *
 * Nothing else: no expression, no call, no second hop, no other value of the server.
 */
record Placeholder(String text, Kind kind, String property, String target, String letterValue) {

    enum Kind {
        /** A property of the record. */
        PROPERTY,
        /** A property of the document a property of the record names. */
        REFERENCE,
        /** One of the letter's own values. */
        LETTER
    }

    static final String NAME = "[A-Za-z_][A-Za-z0-9_]*";

    /** {@code prefix:name}, and at most three subfields below it. */
    static final Pattern PROPERTY = Pattern.compile(NAME + ":" + NAME + "(?:/" + NAME + "){0,3}");

    static final String LETTER_PREFIX = "letter.";

    static final String DATE = "date";

    static final String WRITER = "writer";

    static final String LANGUAGE = "language";

    static final List<String> LETTER_VALUES = List.of(DATE, WRITER, LANGUAGE);

    /** The longest placeholder, its braces aside. */
    static final int MAX_LENGTH = 200;

    /**
     * The placeholder {@code inner} names, the braces taken off and its surrounding white space too.
     *
     * @throws IllegalArgumentException with the reason, when it names nothing a template may reach
     */
    static Placeholder parse(String inner) {
        String text = inner.strip();
        if (text.isEmpty() || text.length() > MAX_LENGTH) {
            throw new IllegalArgumentException("is empty or too long");
        }
        if (text.startsWith(LETTER_PREFIX)) {
            String value = text.substring(LETTER_PREFIX.length());
            if (!LETTER_VALUES.contains(value)) {
                throw new IllegalArgumentException("names no letter value: there are letter.date, letter.writer and letter.language");
            }
            return new Placeholder(text, Kind.LETTER, null, null, value);
        }
        String[] hops = text.split(">", -1);
        if (hops.length > 2) {
            throw new IllegalArgumentException("goes through more than one reference");
        }
        for (String hop : hops) {
            if (!PROPERTY.matcher(hop).matches()) {
                throw new IllegalArgumentException(
                        "is not a property, prefix:name, a reference, prefix:name>prefix:name, or a letter value");
            }
        }
        if (hops.length == 2) {
            if (hops[0].indexOf('/') >= 0) {
                throw new IllegalArgumentException("goes through a subfield: a reference is a property of the record");
            }
            return new Placeholder(text, Kind.REFERENCE, hops[0], hops[1], null);
        }
        return new Placeholder(text, Kind.PROPERTY, hops[0], null, null);
    }

    /** The property of the record it reads: the value's, or the reference's. */
    String recordProperty() {
        return property;
    }
}
