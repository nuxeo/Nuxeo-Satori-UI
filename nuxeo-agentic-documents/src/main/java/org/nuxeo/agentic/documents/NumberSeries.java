/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * A number series: its id, how many digits its numbers have at least, and how it writes revisions.
 *
 * <p>A number is the series' id, a hyphen, and the sequencer's value with leading zeros to
 * {@link #digits()}: {@code DWG-00042}. Two series never write the same number. The digits never
 * hold a hyphen, so the last hyphen of a number parts the id from them: {@code A-1-00001} is series
 * {@code A-1}'s first number, and series {@code A} writes only {@code A-} and digits. Within a series
 * the sequencer never gives a value twice, and leading zeros to a width change no value, so a wider
 * number than {@link #digits()} allows is written whole rather than cut.
 */
public record NumberSeries(String id, int digits, RevisionScheme revisions) {

    /** A series id: capitals and digits, in parts joined by single hyphens, 32 characters at most. */
    static final Pattern ID = Pattern.compile("(?=.{1,32}$)[A-Z0-9]+(?:-[A-Z0-9]+)*");

    static final int DEFAULT_DIGITS = 5;

    static final int MAX_DIGITS = 12;

    /** The sequencer's key for this series. No other key the platform counts with starts so. */
    public String sequenceKey() {
        return "org.nuxeo.agentic.documents.series." + id;
    }

    /** The number for the sequencer's value. */
    public String format(long value) {
        if (value < 1) {
            throw new IllegalArgumentException("A sequencer value is 1 or more, not " + value);
        }
        String digitsOf = Long.toString(value);
        return id + "-" + "0".repeat(Math.max(0, digits - digitsOf.length())) + digitsOf;
    }

    /**
     * The series a contribution describes, or the problems that keep it out: an id that is not
     * one, digits that are not 1 to 12, a revision scheme other than {@code letters} or
     * {@code numbers}.
     */
    public static Result of(NumberSeriesDescriptor descriptor) {
        List<String> problems = new ArrayList<>();
        String id = descriptor.getId();
        if (id == null || !ID.matcher(id).matches()) {
            problems.add("the id \"" + id + "\" is not capitals and digits, in parts joined by hyphens, "
                    + "32 characters at most");
        }
        int digits = DEFAULT_DIGITS;
        String written = descriptor.getDigits();
        if (written != null && !written.isBlank()) {
            try {
                digits = Integer.parseInt(written.trim());
            } catch (NumberFormatException e) {
                digits = -1;
            }
            if (digits < 1 || digits > MAX_DIGITS) {
                problems.add("digits is " + written.trim() + ", not 1 to " + MAX_DIGITS);
            }
        }
        RevisionScheme scheme = RevisionScheme.named(descriptor.getRevisions());
        if (scheme == null) {
            problems.add("revisions is \"" + descriptor.getRevisions().trim() + "\", not letters or numbers");
        }
        return problems.isEmpty() ? new Result(new NumberSeries(id, digits, scheme), List.of())
                : new Result(null, List.copyOf(problems));
    }

    /** A series read from its contribution, or why it was left out. */
    public record Result(NumberSeries series, List<String> problems) {
    }
}
