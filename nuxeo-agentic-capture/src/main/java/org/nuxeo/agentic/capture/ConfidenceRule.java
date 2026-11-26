/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.nuxeo.agentic.capture.CaptureProvider.Classification;
import org.nuxeo.agentic.capture.CaptureProvider.ExtractedField;
import org.nuxeo.agentic.capture.CaptureProvider.Extraction;
import org.nuxeo.agentic.capture.Profile.CaptureClass;
import org.nuxeo.agentic.capture.Profile.CaptureField;

/**
 * The confidence rule: whether a provider's answer is enough to file an item with no person, and if
 * not, why. A pure function of the profile and the answer, so that it is held by tests with no
 * runtime, and nothing else decides it.
 *
 * <p>An item may be filed by itself only when all of these hold; the first that does not is the
 * reason it waits for a person:
 * <ol>
 * <li>the class is one of the profile's ({@value Captures#UNKNOWN_CLASS} otherwise);</li>
 * <li>the class has match keys, and each has a value of its form ({@value Captures#MISSING_KEY});</li>
 * <li>the class's confidence, and each key's, is at least the profile's threshold
 * ({@value Captures#LOW_CONFIDENCE}). A key whose value is not of its form counts as 0.</li>
 * </ol>
 * Then exactly one record must match the keys, which {@link Matcher} answers. The item's confidence
 * is the least of the class's and its keys'; a field that is not a key is kept with its own
 * confidence, and decides nothing.
 */
final class ConfidenceRule {

    /**
     * What the rule found.
     *
     * @param reason why the item waits for a person, or {@code null} when it may be filed once one
     *            record matches
     * @param captureClass the profile's class, or {@code null} when the answer named none of them
     * @param classConfidence the class's confidence, from 0 to 1
     * @param confidence the item's: the least of the class's and its keys'
     * @param fields the values kept, a field of the class once at most, in the class's order
     * @param keys each key's value, when every key has one of its form; otherwise empty, and no
     *            record is looked for
     */
    record Verdict(String reason, CaptureClass captureClass, double classConfidence, double confidence,
            List<ExtractedField> fields, Map<String, String> keys) {

        boolean mayFile() {
            return reason == null;
        }
    }

    private ConfidenceRule() {
    }

    static Verdict judge(Profile profile, Classification classification, Extraction extraction) {
        CaptureClass captureClass = classification == null ? null
                : profile.captureClass(classification.className()).orElse(null);
        if (captureClass == null) {
            return new Verdict(Captures.UNKNOWN_CLASS, null, 0, 0, List.of(), Map.of());
        }
        double classConfidence = Captures.confidence(classification.confidence());
        List<ExtractedField> fields = kept(captureClass, extraction);
        List<CaptureField> keys = captureClass.keys();
        Map<String, String> keyValues = new LinkedHashMap<>();
        double confidence = classConfidence;
        boolean missing = keys.isEmpty();
        for (CaptureField key : keys) {
            ExtractedField found = fields.stream().filter(f -> f.name().equals(key.name())).findFirst().orElse(null);
            if (found == null || found.value() == null) {
                missing = true;
                confidence = 0;
                continue;
            }
            if (!key.fits(found.value())) {
                confidence = 0;
                continue;
            }
            keyValues.put(key.name(), found.value());
            confidence = Math.min(confidence, found.confidence());
        }
        boolean complete = !keys.isEmpty() && keyValues.size() == keys.size();
        Map<String, String> found = complete ? Collections.unmodifiableMap(keyValues) : Map.of();
        String reason = null;
        if (missing) {
            reason = Captures.MISSING_KEY;
        } else if (!complete || !(confidence >= profile.threshold())) {
            reason = Captures.LOW_CONFIDENCE;
        }
        return new Verdict(reason, captureClass, classConfidence, confidence, fields, found);
    }

    /**
     * The provider's values the add-on keeps: only the class's fields, each once, the first given;
     * a value with its control characters dropped, at most {@value Captures#MAX_VALUE} characters,
     * and none when empty; a confidence from 0 to 1, and 0 for anything else.
     */
    static List<ExtractedField> kept(CaptureClass captureClass, Extraction extraction) {
        if (extraction == null || extraction.fields() == null) {
            return List.of();
        }
        Map<String, ExtractedField> byName = new LinkedHashMap<>();
        Set<String> seen = new HashSet<>();
        for (ExtractedField field : extraction.fields()) {
            if (field == null || field.name() == null || !seen.add(field.name())
                    || captureClass.field(field.name()).isEmpty()) {
                continue;
            }
            String value = Captures.clean(field.value(), Captures.MAX_VALUE);
            if (value != null) {
                byName.put(field.name(), new ExtractedField(field.name(), value, Captures.confidence(field.confidence())));
            }
        }
        List<ExtractedField> ordered = new ArrayList<>();
        for (CaptureField field : captureClass.fields()) {
            ExtractedField kept = byName.get(field.name());
            if (kept != null) {
                ordered.add(kept);
            }
        }
        return List.copyOf(ordered);
    }
}
