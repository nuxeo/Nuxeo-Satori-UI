/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import java.io.Serializable;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collection;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentNotFoundException;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.PropertyException;
import org.nuxeo.ecm.core.schema.SchemaManager;
import org.nuxeo.ecm.core.schema.types.Schema;
import org.nuxeo.runtime.api.Framework;

/**
 * The values a letter's placeholders print, read as the person who writes it, in the letter's
 * language: the stored record's properties, the properties of the documents it names one hop away,
 * which the person must be able to read, and the letter's own date, writer and language. Never
 * anything else of the server.
 */
final class LetterValues {

    private LetterValues() {
    }

    /** Each placeholder of {@code text}, to the text it prints. */
    static Map<Placeholder, String> resolve(CoreSession session, DocumentModel record, TemplateText.Parsed text,
            String language) {
        Locale locale = Locale.forLanguageTag(language);
        Set<String> denied = Letters.deniedProperties();
        Map<String, DocumentModel> referenced = new HashMap<>();
        Map<Placeholder, String> values = new LinkedHashMap<>();
        for (Placeholder placeholder : text.placeholders()) {
            String value = switch (placeholder.kind()) {
            case LETTER -> letterValue(placeholder.letterValue(), session.getPrincipal(), language, locale);
            case PROPERTY -> format(read(record, placeholder.property(), denied), locale);
            case REFERENCE -> {
                Serializable id = read(record, placeholder.property(), denied);
                if (!(id instanceof String ref) || ref.isBlank()) {
                    yield "";
                }
                DocumentModel target = referenced.computeIfAbsent(ref.strip(), key -> referenced(session, key));
                yield format(read(target, placeholder.target(), denied), locale);
            }
            };
            values.put(placeholder, clean(value));
        }
        return values;
    }

    /** The document {@code id} names, read as the person: refused when they may not read it, or it is gone. */
    private static DocumentModel referenced(CoreSession session, String id) {
        try {
            return session.getDocument(new IdRef(id));
        } catch (DocumentSecurityException e) {
            throw Refusal.forbidden("The letter prints a property of a record you may not read");
        } catch (DocumentNotFoundException e) {
            throw Refusal.conflict("The letter prints a property of a record that no longer exists");
        }
    }

    /** {@code xpath} of {@code doc}, refused when the server denies it, or {@code doc} has no such property. */
    static Serializable read(DocumentModel doc, String xpath, Set<String> denied) {
        if (Letters.denied(xpath, denied)) {
            throw Refusal.invalid("The letter's template names " + xpath + ", which this server keeps from every letter");
        }
        Schema schema = Framework.getService(SchemaManager.class)
                                 .getSchemaFromPrefix(xpath.substring(0, xpath.indexOf(':')));
        if (schema == null || !doc.hasSchema(schema.getName())) {
            throw Refusal.conflict("The letter's template names " + xpath + ", which a record it prints has not");
        }
        try {
            return doc.getPropertyValue(xpath);
        } catch (PropertyException e) {
            throw Refusal.conflict("The letter's template names " + xpath + ", which a record it prints has not");
        }
    }

    private static String letterValue(String name, NuxeoPrincipal writer, String language, Locale locale) {
        return switch (name) {
        case Placeholder.DATE -> LocalDate.now(ZoneId.systemDefault())
                                          .format(DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale));
        case Placeholder.WRITER -> writerName(writer);
        case Placeholder.LANGUAGE -> language;
        default -> throw new IllegalArgumentException(name);
        };
    }

    /** Who writes the letter, as the letter signs them: their first and last names, or their user name. */
    static String writerName(NuxeoPrincipal writer) {
        String first = writer.getFirstName() == null ? "" : writer.getFirstName().strip();
        String last = writer.getLastName() == null ? "" : writer.getLastName().strip();
        String full = (first + " " + last).strip();
        return full.isEmpty() ? writer.getName() : full;
    }

    /** A property's value as a letter prints it, in {@code locale}. */
    static String format(Object value, Locale locale) {
        if (value == null) {
            return "";
        }
        if (value instanceof String text) {
            return text;
        }
        if (value instanceof Calendar calendar) {
            return date(calendar.toInstant().atZone(ZoneId.systemDefault()).toLocalDate(), locale);
        }
        if (value instanceof Date date) {
            return date(date.toInstant().atZone(ZoneId.systemDefault()).toLocalDate(), locale);
        }
        if (value instanceof Double || value instanceof Float) {
            return String.format(locale, "%,.2f", ((Number) value).doubleValue());
        }
        if (value instanceof Number || value instanceof Boolean) {
            return value.toString();
        }
        if (value instanceof Object[] array) {
            return format(List.of(array), locale);
        }
        if (value instanceof Collection<?> items) {
            List<String> each = new ArrayList<>();
            for (Object item : items) {
                if (item instanceof Map<?, ?> || item instanceof Collection<?>) {
                    throw Refusal.conflict("The letter's template names a property that holds several fields");
                }
                each.add(format(item, locale));
            }
            return String.join(", ", each);
        }
        throw Refusal.conflict("The letter's template names a property that holds no value a letter prints");
    }

    private static String date(LocalDate day, Locale locale) {
        return day.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale));
    }

    /** {@code value} with no control character but tabs and line breaks. */
    private static String clean(String value) {
        StringBuilder out = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (!Character.isISOControl(c) || c == '\t' || c == '\n' || c == '\r') {
                out.append(c);
            }
        }
        return out.toString();
    }
}
