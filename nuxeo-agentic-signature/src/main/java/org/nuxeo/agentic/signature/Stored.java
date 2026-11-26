/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import java.io.Serializable;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Date;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.PropertyException;

/**
 * Properties as the repository stores them, compared so that one value means one thing, and the
 * digests the add-on keeps.
 *
 * <p>Only an empty text, an empty list and none count as the same. A day or a time is compared by
 * its instant, a complex value by its subfields, and a file by its digest and length: a file with
 * no digest yet, one just given, is never taken for one stored.
 */
final class Stored {

    private Stored() {
    }

    /** The properties whose stored value differs from one document to the other, in order. */
    static List<String> changes(DocumentModel before, DocumentModel after, String schema, List<String> properties) {
        return properties.stream()
                         .filter(p -> !Objects.equals(value(before, schema, p), value(after, schema, p)))
                         .toList();
    }

    static Object value(DocumentModel doc, String schema, String xpath) {
        return doc.hasSchema(schema) ? normal(doc.getPropertyValue(xpath)) : null;
    }

    static Object normal(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof String text) {
            return text.isEmpty() ? null : text;
        }
        if (value instanceof Blob blob) {
            return "file:" + blob.getDigest() + ":" + blob.getLength() + ":" + blob.getFilename();
        }
        if (value instanceof Calendar calendar) {
            return calendar.getTimeInMillis();
        }
        if (value instanceof Date date) {
            return date.getTime();
        }
        if (value instanceof Object[] array) {
            return normal(Arrays.asList(array));
        }
        if (value instanceof List<?> list) {
            if (list.isEmpty()) {
                return null;
            }
            List<Object> items = new ArrayList<>(list.size());
            for (Object item : list) {
                items.add(normal(item));
            }
            return items;
        }
        if (value instanceof Map<?, ?> map) {
            Map<Object, Object> fields = new LinkedHashMap<>();
            map.entrySet()
               .stream()
               .sorted((a, b) -> String.valueOf(a.getKey()).compareTo(String.valueOf(b.getKey())))
               .forEach(e -> {
                   Object field = normal(e.getValue());
                   if (field != null) {
                       fields.put(e.getKey(), field);
                   }
               });
            return fields.isEmpty() ? null : fields;
        }
        return value;
    }

    /** A complex list as stored, each item a map of its subfields; empty when there is none. */
    @SuppressWarnings("unchecked")
    static List<Map<String, Serializable>> entries(DocumentModel doc, String xpath) {
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

    /** The file at {@code xpath}, {@code file:content} or an attachment's; {@code null} when there is none there. */
    static Blob blobAt(DocumentModel doc, String xpath) {
        if (xpath == null) {
            return null;
        }
        try {
            return doc.getPropertyValue(xpath) instanceof Blob blob ? blob : null;
        } catch (PropertyException | IndexOutOfBoundsException e) {
            return null;
        }
    }

    /** The SHA-256 of {@code bytes}, in lower-case hexadecimal. */
    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is missing from the JDK", e);
        }
    }
}
