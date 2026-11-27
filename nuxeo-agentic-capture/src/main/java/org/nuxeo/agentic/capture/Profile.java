/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * A capture profile, checked: what a kit's inbox captures, and how. Made by {@link #of} from its
 * contribution, which it refuses with the rule it breaks, so that a profile the add-on holds is
 * always one it can act on.
 *
 * @param id the profile's id
 * @param inboxType the inbox's document type: an item is received only in a folder of it
 * @param itemType the items' document type, which carries {@code CaptureItem} and the file schema
 * @param recordType the type of the records items are filed on, which must have attachments
 * @param recordPath where records are matched, a path, or {@code null} for anywhere
 * @param threshold below which nothing is filed without a person, from 0.5 to 1
 * @param classes what an item may be, each with its fields
 */
public record Profile(String id, String inboxType, String itemType, String recordType, String recordPath,
        double threshold, List<CaptureClass> classes) {

    public static final double DEFAULT_THRESHOLD = 0.85;

    public static final double LOWEST_THRESHOLD = 0.5;

    static final int MAX_CLASSES = 20;

    static final int MAX_KEYWORDS = 20;

    static final int MAX_LABEL = 200;

    static final int MAX_DESCRIPTION = 1000;

    static final int MAX_PATH = 500;

    /** What an item may be: a claim letter, say. */
    public record CaptureClass(String name, String label, String description, List<String> keywords,
            List<CaptureField> fields) {

        public Optional<CaptureField> field(String fieldName) {
            return fields.stream().filter(f -> f.name().equals(fieldName)).findFirst();
        }

        /** The fields whose values must equal a record's properties for the item to match it. */
        public List<CaptureField> keys() {
            return fields.stream().filter(CaptureField::isKey).toList();
        }
    }

    /**
     * One value extracted from an item.
     *
     * @param match the record's property the value must equal, or {@code null}
     * @param format a pattern the whole value must match, or {@code null}
     */
    public record CaptureField(String name, String label, String description, String match, Pattern format) {

        public boolean isKey() {
            return match != null;
        }

        /** Whether {@code value} is of the field's form: any value when it has none. */
        public boolean fits(String value) {
            return value != null && (format == null || format.matcher(value).matches());
        }
    }

    public Optional<CaptureClass> captureClass(String name) {
        return name == null ? Optional.empty() : classes.stream().filter(c -> c.name().equals(name)).findFirst();
    }

    /** A profile refused: the rule it breaks, which the server logs. */
    public static final class InvalidProfileException extends IllegalArgumentException {

        private static final long serialVersionUID = 1L;

        InvalidProfileException(String message) {
            super(message);
        }
    }

    private static InvalidProfileException invalid(String message) {
        return new InvalidProfileException(message);
    }

    /** The profile a contribution describes, or the first rule it breaks. */
    public static Profile of(ProfileDescriptor d) {
        String id = trim(d.id);
        if (id == null || !Captures.PROFILE_ID.matcher(id).matches()) {
            throw invalid("a profile's id must be 1 to 64 lower-case letters, digits and '-', starting with a letter");
        }
        String inboxType = type(d.inboxType, "inboxType");
        String itemType = type(d.itemType, "itemType");
        String recordType = type(d.recordType, "recordType");
        if (inboxType.equals(itemType) || itemType.equals(recordType) || inboxType.equals(recordType)) {
            throw invalid("its inbox, item and record types must be three types");
        }
        String recordPath = trim(d.recordPath);
        if (recordPath != null && (!recordPath.startsWith("/") || recordPath.length() > MAX_PATH
                || recordPath.contains("'") || recordPath.contains("\\") || Captures.hasControl(recordPath))) {
            throw invalid("its recordPath must be a path from the root, without quotes or backslashes");
        }
        double threshold = DEFAULT_THRESHOLD;
        String given = trim(d.threshold);
        if (given != null) {
            try {
                threshold = Double.parseDouble(given);
            } catch (NumberFormatException e) {
                throw invalid("its threshold must be a number");
            }
            if (!(threshold >= LOWEST_THRESHOLD && threshold <= 1)) {
                throw invalid("its threshold must be from " + LOWEST_THRESHOLD + " to 1");
            }
        }
        if (d.classes == null || d.classes.isEmpty() || d.classes.size() > MAX_CLASSES) {
            throw invalid("it must have 1 to " + MAX_CLASSES + " classes");
        }
        List<CaptureClass> classes = new ArrayList<>();
        Set<String> names = new HashSet<>();
        for (ProfileDescriptor.ClassDescriptor c : d.classes) {
            CaptureClass captureClass = captureClass(c);
            if (!names.add(captureClass.name())) {
                throw invalid("its class " + captureClass.name() + " is named twice");
            }
            classes.add(captureClass);
        }
        return new Profile(id, inboxType, itemType, recordType, recordPath, threshold, List.copyOf(classes));
    }

    private static CaptureClass captureClass(ProfileDescriptor.ClassDescriptor c) {
        String name = name(c.name, "a class's name");
        String label = label(c.label, name);
        String description = text(c.description, MAX_DESCRIPTION, "class " + name + "'s description");
        List<String> keywords = new ArrayList<>();
        if (c.keywords != null) {
            for (String keyword : c.keywords) {
                String k = text(keyword, 100, "class " + name + "'s keyword");
                if (k != null) {
                    keywords.add(k);
                }
            }
        }
        if (keywords.size() > MAX_KEYWORDS) {
            throw invalid("class " + name + " has more than " + MAX_KEYWORDS + " keywords");
        }
        if (c.fields == null || c.fields.isEmpty() || c.fields.size() > Captures.MAX_FIELDS) {
            throw invalid("class " + name + " must have 1 to " + Captures.MAX_FIELDS + " fields");
        }
        List<CaptureField> fields = new ArrayList<>();
        Set<String> fieldNames = new HashSet<>();
        for (ProfileDescriptor.FieldDescriptor f : c.fields) {
            String fieldName = name(f.name, "a field's name, in class " + name);
            if (!fieldNames.add(fieldName)) {
                throw invalid("class " + name + " names its field " + fieldName + " twice");
            }
            String match = trim(f.match);
            if (match != null && !Captures.XPATH.matcher(match).matches()) {
                throw invalid("field " + fieldName + "'s match must be a property, prefix:name");
            }
            Pattern format = null;
            String pattern = trim(f.format);
            if (pattern != null) {
                if (pattern.length() > 200) {
                    throw invalid("field " + fieldName + "'s format is longer than 200 characters");
                }
                try {
                    format = Pattern.compile(pattern);
                } catch (PatternSyntaxException e) {
                    throw invalid("field " + fieldName + "'s format is not a pattern");
                }
            }
            fields.add(new CaptureField(fieldName, label(f.label, fieldName),
                    text(f.description, MAX_DESCRIPTION, "field " + fieldName + "'s description"), match, format));
        }
        return new CaptureClass(name, label, description, List.copyOf(keywords), List.copyOf(fields));
    }

    private static String type(String value, String what) {
        String type = trim(value);
        if (type == null || !Captures.TYPE_NAME.matcher(type).matches()) {
            throw invalid("its " + what + " must be a document type's name");
        }
        return type;
    }

    private static String name(String value, String what) {
        String name = trim(value);
        if (name == null || !Captures.NAME.matcher(name).matches()) {
            throw invalid(what + " must be 1 to 64 letters, digits, '_' and '-', starting with a letter");
        }
        return name;
    }

    private static String label(String value, String otherwise) {
        String label = text(value, MAX_LABEL, otherwise + "'s label");
        return label == null ? otherwise : label;
    }

    private static String text(String value, int max, String what) {
        String text = trim(value);
        if (text == null) {
            return null;
        }
        if (text.length() > max || Captures.hasControl(text.replace('\n', ' ').replace('\r', ' ').replace('\t', ' '))) {
            throw invalid(what + " must be at most " + max + " characters, with no control character");
        }
        return text.replaceAll("\\s+", " ");
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
