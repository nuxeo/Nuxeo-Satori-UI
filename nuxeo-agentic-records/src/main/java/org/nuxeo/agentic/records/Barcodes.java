package org.nuxeo.agentic.records;

import java.util.Locale;
import java.util.concurrent.ThreadLocalRandom;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.nuxeo.ecm.core.api.ConcurrentUpdateException;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.uidgen.UIDGeneratorService;
import org.nuxeo.ecm.core.uidgen.UIDSequencer;
import org.nuxeo.runtime.api.Framework;

/**
 * A physical record's barcode: issued by the server when the record is made, as the document
 * control add-on numbers a controlled document, from the platform's own sequencer.
 *
 * <ul>
 * <li><b>Its form:</b> a prefix of one to four capital letters, {@value #DEFAULT_PREFIX} unless
 * {@value #PREFIX_PROPERTY} says another; the sequencer's value, with leading zeros to
 * {@value #DIGITS} digits, or more when it is wider, never cut; and a check digit, the Luhn
 * algorithm's over those digits, so that a barcode mistyped by one digit, or with two neighbouring
 * digits swapped, is not one. {@code PR000000428}: a code-128 or code-39 label prints it as it is.</li>
 * <li><b>Unique, and never given twice:</b> the sequencer gives each value once, for the whole
 * cluster, from its key/value store, which does not take part in the caller's transaction. A
 * creation rolled back leaves a gap, never a value given again. Every prefix counts in the same
 * sequence, so a deployment that changes its prefix gives no number a second time.</li>
 * <li><b>Under contention, asked again:</b> the SQL key/value store gives up after five tries of
 * its compare-and-set, with a {@link ConcurrentUpdateException}, having taken no value; so the
 * add-on asks again, up to {@value #SEQUENCER_ATTEMPTS} times, as the document control add-on
 * does.</li>
 * </ul>
 */
final class Barcodes {

    /** The sequencer's key: no other key the platform counts with starts so. */
    static final String SEQUENCE_KEY = "org.nuxeo.agentic.records.barcode";

    /** The prefix, in {@code nuxeo.conf}: one to four capital letters. */
    static final String PREFIX_PROPERTY = "nuxeo.agentic.records.barcode.prefix";

    static final String DEFAULT_PREFIX = "PR";

    static final Pattern PREFIX = Pattern.compile("[A-Z]{1,4}");

    /** The fewest digits a barcode's value is written with. */
    static final int DIGITS = 8;

    /** A barcode: its prefix, its value, and its check digit. */
    static final Pattern BARCODE = Pattern.compile("([A-Z]{1,4})([0-9]{" + DIGITS + ",18})([0-9])");

    static final int SEQUENCER_ATTEMPTS = 20;

    private Barcodes() {
    }

    /** The next barcode, from the platform's sequencer. */
    static String issue() {
        UIDGeneratorService generators = Framework.getService(UIDGeneratorService.class);
        UIDSequencer sequencer = generators == null ? null : generators.getSequencer();
        if (sequencer == null) {
            throw new NuxeoException("Physical records: the platform's sequencer is not running, so no barcode is issued");
        }
        for (int attempt = 1;; attempt++) {
            try {
                return format(prefix(), sequencer.getNextLong(SEQUENCE_KEY));
            } catch (ConcurrentUpdateException e) {
                if (attempt >= SEQUENCER_ATTEMPTS) {
                    throw e;
                }
                pause(attempt);
            }
        }
    }

    /** The prefix in force: {@value #PREFIX_PROPERTY}, when it is one to four capital letters. */
    static String prefix() {
        String value = Framework.getProperty(PREFIX_PROPERTY);
        return value != null && PREFIX.matcher(value.trim()).matches() ? value.trim() : DEFAULT_PREFIX;
    }

    /** {@code value} as a barcode with {@code prefix}: its digits padded, and its check digit. */
    static String format(String prefix, long value) {
        if (value < 1) {
            throw new IllegalArgumentException("A barcode's value is 1 or more: " + value);
        }
        String digits = String.format(Locale.ROOT, "%0" + DIGITS + "d", value);
        return prefix + digits + check(digits);
    }

    /** The Luhn check digit of {@code digits}. */
    static int check(String digits) {
        int sum = 0;
        boolean twice = true;
        for (int index = digits.length() - 1; index >= 0; index--) {
            int digit = digits.charAt(index) - '0';
            if (twice) {
                digit *= 2;
                if (digit > 9) {
                    digit -= 9;
                }
            }
            sum += digit;
            twice = !twice;
        }
        return (10 - sum % 10) % 10;
    }

    /**
     * A barcode as typed or scanned, made the one the server issued: spaces and hyphens taken out,
     * letters in capitals. Anything else is left as it is, to be refused.
     */
    static String normal(String typed) {
        return typed == null ? "" : typed.replaceAll("[\\s-]", "").toUpperCase(Locale.ROOT);
    }

    /** Whether {@code text}, as {@link #normal} leaves it, has a barcode's form. */
    static boolean looksLike(String text) {
        return BARCODE.matcher(text).matches();
    }

    /** Whether {@code barcode} has a barcode's form and its check digit is right. */
    static boolean valid(String barcode) {
        Matcher matcher = BARCODE.matcher(barcode == null ? "" : barcode);
        return matcher.matches() && check(matcher.group(2)) == matcher.group(3).charAt(0) - '0';
    }

    private static void pause(int attempt) {
        try {
            Thread.sleep(1 + ThreadLocalRandom.current().nextInt(5 * attempt));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new NuxeoException("Physical records: interrupted while waiting for the sequencer", e);
        }
    }
}
