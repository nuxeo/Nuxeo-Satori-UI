/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * The add-on's properties as the repository stores them, compared and read so that one value
 * means one thing.
 *
 * <p>A value is compared as stored, not trimmed: {@code " current "} is a change from
 * {@code "current"}, since a query for the value would no longer find it. Only an empty text, an
 * empty list and none count as the same. A list of texts is compared item by item, a day or a time
 * by its instant, and a complex value by its subfields, those with no value left out.
 */
final class Stored {

    private Stored() {
    }

    /** The properties of {@code schema} whose stored value differs from one document to the other, in order. */
    static List<String> changes(DocumentModel before, DocumentModel after, String schema, List<String> properties) {
        return properties.stream()
                         .filter(p -> !Objects.equals(value(before, schema, p), value(after, schema, p)))
                         .toList();
    }

    /** A property as stored, made comparable; {@code null} for none, or a document without the schema. */
    static Object value(DocumentModel doc, String schema, String xpath) {
        return doc.hasSchema(schema) ? normal(doc.getPropertyValue(xpath)) : null;
    }

    /** {@code value} made comparable: see the class. */
    static Object normal(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof String text) {
            return text.isEmpty() ? null : text;
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

    /** A text property, trimmed, {@code null} when empty or when the document lacks the schema. */
    static String text(DocumentModel doc, String schema, String xpath) {
        return doc.hasSchema(schema) ? ControlledDocuments.text(doc, xpath) : null;
    }

    /** A list of texts, each trimmed, the empty ones left out; empty when there is none. */
    static List<String> texts(DocumentModel doc, String schema, String xpath) {
        if (!doc.hasSchema(schema)) {
            return List.of();
        }
        Serializable value = doc.getPropertyValue(xpath);
        List<?> items = value instanceof Object[] array ? Arrays.asList(array)
                : value instanceof List<?> list ? list : List.of();
        List<String> texts = new ArrayList<>();
        for (Object item : items) {
            String text = item == null ? null : item.toString().trim();
            if (text != null && !text.isEmpty()) {
                texts.add(text);
            }
        }
        return texts;
    }

    /** A complex list as stored: each item a map of its subfields; empty when there is none. */
    @SuppressWarnings("unchecked")
    static List<Map<String, Serializable>> entries(DocumentModel doc, String schema, String xpath) {
        if (!doc.hasSchema(schema)) {
            return List.of();
        }
        Serializable value = doc.getPropertyValue(xpath);
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        List<Map<String, Serializable>> entries = new ArrayList<>();
        for (Object item : list) {
            if (item instanceof Map<?, ?> map) {
                entries.add((Map<String, Serializable>) map);
            }
        }
        return entries;
    }
}
