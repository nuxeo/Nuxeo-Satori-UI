/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.junit.Test;
import org.nuxeo.agentic.capture.CaptureProvider.Classification;
import org.nuxeo.agentic.capture.CaptureProvider.ExtractedField;
import org.nuxeo.agentic.capture.CaptureProvider.Extraction;
import org.nuxeo.agentic.capture.ConfidenceRule.Verdict;
import org.nuxeo.agentic.capture.Profile.CaptureClass;
import org.nuxeo.agentic.capture.Profile.CaptureField;

/** The confidence rule, alone, with no runtime: each condition, its order, and the threshold's edge. */
public class ConfidenceRuleTest {

    static final CaptureClass LETTER = new CaptureClass("claimLetter", "Claim letter", null, List.of("claim number"),
            List.of(new CaptureField("claimNumber", "Claim number", null, "pclaim:number", Pattern.compile("PC-[0-9]{5}")),
                    new CaptureField("policy", "Policy", null, "pclaim:policyNumber", null),
                    new CaptureField("sender", "From", null, null, null)));

    static final CaptureClass NOTE = new CaptureClass("note", "Note", null, List.of(),
            List.of(new CaptureField("subject", "Subject", null, null, null)));

    static final Profile PROFILE = new Profile("p", "Inbox", "Mail", "Claim", null, 0.85, List.of(LETTER, NOTE));

    private static Verdict judge(Classification c, ExtractedField... fields) {
        return ConfidenceRule.judge(PROFILE, c, new Extraction(List.of(fields)));
    }

    private static ExtractedField f(String name, String value, double confidence) {
        return new ExtractedField(name, value, confidence);
    }

    @Test
    public void everythingAtOrAboveTheThresholdMayBeFiled() {
        Verdict v = judge(new Classification("claimLetter", 0.9), f("claimNumber", "PC-24001", 0.95),
                f("policy", "POL-1", 0.88), f("sender", "R. Vale", 0.1));
        assertTrue(v.mayFile());
        assertEquals(0.88, v.confidence(), 0);
        assertEquals(Map.of("claimNumber", "PC-24001", "policy", "POL-1"), v.keys());
        // A field that is no key decides nothing, however low.
        assertEquals(3, v.fields().size());
    }

    @Test
    public void theThresholdIsTheLeastThatFiles() {
        assertTrue(judge(new Classification("claimLetter", 0.85), f("claimNumber", "PC-24001", 0.85),
                f("policy", "POL-1", 0.85)).mayFile());
        Verdict classBelow = judge(new Classification("claimLetter", 0.8499), f("claimNumber", "PC-24001", 1),
                f("policy", "POL-1", 1));
        assertEquals(Captures.LOW_CONFIDENCE, classBelow.reason());
        // Below it, the keys are still given, so a record may be proposed to a person.
        assertEquals(2, classBelow.keys().size());
        Verdict keyBelow = judge(new Classification("claimLetter", 1), f("claimNumber", "PC-24001", 1),
                f("policy", "POL-1", 0.8499));
        assertEquals(Captures.LOW_CONFIDENCE, keyBelow.reason());
        assertEquals(0.8499, keyBelow.confidence(), 0);
    }

    @Test
    public void aClassNotTheProfilesOrNoneIsUnknown() {
        assertEquals(Captures.UNKNOWN_CLASS, judge(new Classification("ransomNote", 1)).reason());
        assertEquals(Captures.UNKNOWN_CLASS, judge(new Classification(null, 1)).reason());
        assertEquals(Captures.UNKNOWN_CLASS, ConfidenceRule.judge(PROFILE, null, null).reason());
        Verdict v = judge(new Classification("ransomNote", 1), f("claimNumber", "PC-24001", 1));
        assertNull(v.captureClass());
        assertTrue(v.fields().isEmpty());
        assertTrue(v.keys().isEmpty());
    }

    @Test
    public void aKeyMissingOrAClassWithNoKeyIsMissingKey() {
        Verdict missing = judge(new Classification("claimLetter", 1), f("claimNumber", "PC-24001", 1));
        assertEquals(Captures.MISSING_KEY, missing.reason());
        assertTrue(missing.keys().isEmpty());
        assertEquals(0, missing.confidence(), 0);
        assertEquals(Captures.MISSING_KEY, judge(new Classification("note", 1), f("subject", "Hello", 1)).reason());
        // An empty value is none.
        assertEquals(Captures.MISSING_KEY, judge(new Classification("claimLetter", 1), f("claimNumber", "  ", 1),
                f("policy", "POL-1", 1)).reason());
    }

    @Test
    public void aKeyNotOfItsFormCountsAsNothing() {
        Verdict v = judge(new Classification("claimLetter", 1), f("claimNumber", "PC-24001' OR '1'='1", 1),
                f("policy", "POL-1", 1));
        assertEquals(Captures.LOW_CONFIDENCE, v.reason());
        assertEquals(0, v.confidence(), 0);
        assertTrue(v.keys().isEmpty());
    }

    @Test
    public void confidencesOutsideZeroToOneAreZero() {
        for (double odd : new double[] { Double.NaN, -0.1, 1.01, Double.POSITIVE_INFINITY }) {
            Verdict v = judge(new Classification("claimLetter", odd), f("claimNumber", "PC-24001", 1),
                    f("policy", "POL-1", 1));
            assertEquals(String.valueOf(odd), Captures.LOW_CONFIDENCE, v.reason());
            assertEquals(0, v.classConfidence(), 0);
            Verdict field = judge(new Classification("claimLetter", 1), f("claimNumber", "PC-24001", odd),
                    f("policy", "POL-1", 1));
            assertEquals(String.valueOf(odd), Captures.LOW_CONFIDENCE, field.reason());
        }
    }

    @Test
    public void onlyTheClassesFieldsAreKeptEachOnceCleaned() {
        Verdict v = judge(new Classification("claimLetter", 1), f("claimNumber", "PC-24001", 1),
                f("claimNumber", "PC-99999", 1), f("unknown", "x", 1), f(null, "y", 1),
                f("sender", "Rowan\u0007 Vale\n", 1), f("policy", "x".repeat(Captures.MAX_VALUE + 50), 1));
        assertEquals(List.of("claimNumber", "policy", "sender"), v.fields().stream().map(ExtractedField::name).toList());
        assertEquals("PC-24001", v.fields().get(0).value());
        assertEquals(Captures.MAX_VALUE, v.fields().get(1).value().length());
        assertEquals("Rowan Vale", v.fields().get(2).value());
    }
}
