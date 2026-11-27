/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * The add-on's names: the facet, the schema and its properties, the states and the reasons, the
 * bounds; and the few helpers every class here reads an item with.
 */
public final class Captures {

    public static final String FACET = "CaptureItem";

    public static final String SCHEMA = "capture_item";

    public static final String PREFIX = "capt";

    // The server's.
    public static final String STATUS = "capt:status";

    public static final String REASON = "capt:reason";

    public static final String PROFILE = "capt:profile";

    public static final String PROVIDER = "capt:provider";

    public static final String RECEIVED_AT = "capt:receivedAt";

    public static final String CLASSIFIED_AT = "capt:classifiedAt";

    public static final String DIGEST = "capt:digest";

    public static final String PROPOSED_CLASS = "capt:proposedClass";

    public static final String CLASS_CONFIDENCE = "capt:classConfidence";

    public static final String CONFIDENCE = "capt:confidence";

    public static final String EXTRACTED = "capt:extracted";

    public static final String PROPOSED_RECORD = "capt:proposedRecord";

    public static final String OUTCOME = "capt:outcome";

    public static final String DECIDED_BY = "capt:decidedBy";

    public static final String DECIDED_AT = "capt:decidedAt";

    public static final String ATTACHMENT = "capt:attachment";

    // A person's, while the item waits.
    public static final String CLASS = "capt:class";

    public static final String FIELDS = "capt:fields";

    public static final String RECORD = "capt:record";

    public static final String NOTE = "capt:note";

    public static final String DECISION = "capt:decision";

    /** Every property the server alone writes. */
    public static final List<String> SERVER_PROPERTIES = List.of(STATUS, REASON, PROFILE, PROVIDER, RECEIVED_AT,
            CLASSIFIED_AT, DIGEST, PROPOSED_CLASS, CLASS_CONFIDENCE, CONFIDENCE, EXTRACTED, PROPOSED_RECORD, OUTCOME,
            DECIDED_BY, DECIDED_AT, ATTACHMENT);

    /** What a person may set while an item waits for them. */
    public static final List<String> PERSON_PROPERTIES = List.of(CLASS, FIELDS, RECORD, NOTE, DECISION);

    /** Every property of the schema, in its order. */
    public static final List<String> PROPERTIES;

    static {
        List<String> all = new ArrayList<>(SERVER_PROPERTIES);
        all.addAll(PERSON_PROPERTIES);
        PROPERTIES = List.copyOf(all);
    }

    /** The item's own file: what came in, and what is filed. */
    public static final String FILE = "file:content";

    // Statuses.
    public static final String RECEIVED = "received";

    public static final String REVIEW = "review";

    public static final String FILED = "filed";

    public static final String REJECTED = "rejected";

    // Why an item waits for a person.
    public static final String LOW_CONFIDENCE = "lowConfidence";

    public static final String UNKNOWN_CLASS = "unknownClass";

    public static final String MISSING_KEY = "missingKey";

    public static final String UNMATCHED = "unmatched";

    public static final String AMBIGUOUS = "ambiguous";

    public static final String NO_PROVIDER = "noProvider";

    public static final String PROVIDER_FAILED = "providerFailed";

    public static final String NOT_FILED = "notFiled";

    // Outcomes.
    public static final String AUTOMATIC = "automatic";

    public static final String CONFIRMED = "confirmed";

    public static final String CORRECTED = "corrected";

    // A person's decisions.
    public static final String CONFIRM = "confirm";

    public static final String REJECT = "reject";

    /** Who decided an automatic filing. */
    public static final String SYSTEM = "system";

    /** The record's attachments, where a filed item's file goes. */
    public static final String ATTACHMENTS_SCHEMA = "files";

    public static final String ATTACHMENTS = "files:files";

    // Bounds.
    public static final int MAX_VALUE = 1000;

    public static final int MAX_NOTE = 1000;

    public static final int MAX_FIELDS = 30;

    public static final Pattern PROVIDER_ID = Pattern.compile("[a-z][a-z0-9-]{0,31}");

    public static final Pattern PROFILE_ID = Pattern.compile("[a-z][a-z0-9-]{0,63}");

    public static final Pattern TYPE_NAME = Pattern.compile("[A-Za-z][A-Za-z0-9_]{0,99}");

    public static final Pattern NAME = Pattern.compile("[A-Za-z][A-Za-z0-9_-]{0,63}");

    public static final Pattern XPATH = Pattern.compile("[A-Za-z][A-Za-z0-9_-]{0,63}:[A-Za-z][A-Za-z0-9_]{0,63}");

    /** A document id, as the repository makes them: letters, digits and '-'. */
    public static final Pattern DOCUMENT_ID = Pattern.compile("[A-Za-z0-9-]{1,64}");

    private Captures() {
    }

    /** The text at {@code xpath}, or {@code null} for none or an empty one. */
    public static String text(DocumentModel doc, String xpath) {
        Serializable value = doc.getPropertyValue(xpath);
        return value instanceof String s && !s.isEmpty() ? s : null;
    }

    /** Whether {@code text} holds a control character: tabs and line ends included. */
    public static boolean hasControl(String text) {
        return text != null && text.chars().anyMatch(Character::isISOControl);
    }

    /** {@code text} with its control characters dropped, trimmed, at most {@code max} characters. */
    public static String clean(String text, int max) {
        if (text == null) {
            return null;
        }
        StringBuilder kept = new StringBuilder();
        text.codePoints().filter(c -> !Character.isISOControl(c)).forEach(kept::appendCodePoint);
        String trimmed = kept.toString().trim();
        if (trimmed.length() > max) {
            trimmed = trimmed.substring(0, max).trim();
        }
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** A confidence as the add-on keeps one: a number from 0 to 1, and 0 for anything else. */
    public static double confidence(Object value) {
        double number;
        if (value instanceof Number n) {
            number = n.doubleValue();
        } else {
            return 0;
        }
        if (Double.isNaN(number) || number < 0 || number > 1) {
            return 0;
        }
        return number;
    }

    /** A complex list as stored, each item a map of its subfields; empty when there is none. */
    @SuppressWarnings("unchecked")
    public static List<Map<String, Serializable>> entries(DocumentModel doc, String xpath) {
        Serializable value = doc.getPropertyValue(xpath);
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        List<Map<String, Serializable>> entries = new ArrayList<>();
        for (Object item : list) {
            entries.add(item instanceof Map<?, ?> map ? (Map<String, Serializable>) map : Map.of());
        }
        return entries;
    }

    /** Whether the document is a live one: not a version, a proxy, or in the trash. */
    public static boolean isLive(DocumentModel doc) {
        return !doc.isVersion() && !doc.isProxy() && !doc.isTrashed();
    }
}
