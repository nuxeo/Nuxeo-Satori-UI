/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.schema.DocumentType;
import org.nuxeo.ecm.core.schema.SchemaManager;
import org.nuxeo.ecm.core.schema.TypeConstants;
import org.nuxeo.ecm.core.schema.types.ComplexType;
import org.nuxeo.ecm.core.schema.types.Field;
import org.nuxeo.ecm.core.schema.types.ListType;
import org.nuxeo.ecm.core.schema.types.Schema;
import org.nuxeo.ecm.core.schema.types.SimpleType;
import org.nuxeo.ecm.core.schema.types.Type;
import org.nuxeo.ecm.core.schema.types.primitives.BinaryType;
import org.nuxeo.ecm.core.schema.types.primitives.StringType;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.template.api.TemplateProcessorService;

/**
 * A letter template, as the add-on takes it from an administrator: when it is saved, and again each
 * time a letter is written from it.
 *
 * <ul>
 * <li><b>Its letter and language:</b> {@code ltpl:letter} a letter's id, {@code ltpl:language} a
 * language tag; {@code tmpl:templateName} a name of its own.</li>
 * <li><b>The record types it is for,</b> the platform's {@code tmpl:applicableTypes}: named one by
 * one, never {@code all}, each a type of the server that carries {@code Correspondence}.</li>
 * <li><b>The add-on's processor,</b> {@code tmpl:templateType} {@value Letters#PROCESSOR}, and none of
 * the platform's bindings that would render it otherwise: no forced type, which binds every new
 * record of a type to it; not its file as the bound document's main content, which would make the
 * letter's file its template; no rendition. An output format only of the platform's.</li>
 * <li><b>Its conditions,</b> {@code ltpl:conditions}, each {@code prefix:name=value}, a value of each
 * of its types.</li>
 * <li><b>Its file,</b> read by {@link TemplateText}, and each placeholder a property each of its types
 * has, or one hop through a property holding an id to a schema the server has: a value, a list of
 * values or a subfield, never a file. None the server denies
 * ({@value Letters#DENIED_PROPERTIES_PROPERTY}).</li>
 * </ul>
 */
final class TemplateRules {

    static final int MAX_TYPES = 20;

    static final int MAX_CONDITIONS = 20;

    static final Pattern CONDITION = Pattern.compile(
            "(" + Placeholder.NAME + ":" + Placeholder.NAME + ")=([^\\p{Cntrl}]{1,200})");

    /** A template, checked: what a letter is written from. */
    record Checked(String name, String letter, String language, List<String> types, Map<String, String> conditions,
            TemplateText.Parsed text) {
    }

    private TemplateRules() {
    }

    /** {@code template} checked, its file read: refused, 400, with the first reason. */
    static Checked check(DocumentModel template) {
        if (!template.hasFacet(Letters.TEMPLATE_FACET)) {
            throw Refusal.invalid("A letter template is a document of the LetterTemplate type");
        }
        String name = text(template, Letters.TMPL_NAME);
        if (name == null || !Letters.TEMPLATE_NAME.matcher(name).matches()) {
            throw Refusal.invalid("A letter template's tmpl:templateName is a name of letters, digits, dots, hyphens "
                    + "and underscores, 100 at most");
        }
        String letter = text(template, Letters.TEMPLATE_LETTER);
        if (letter == null || !Letters.LETTER_ID.matcher(letter).matches()) {
            throw Refusal.invalid("A letter template's ltpl:letter names its letter: letters, digits, dots, hyphens "
                    + "and underscores, 100 at most");
        }
        String language = text(template, Letters.TEMPLATE_LANGUAGE);
        if (language == null || !Letters.LANGUAGE_TAG.matcher(language).matches()) {
            throw Refusal.invalid("A letter template's ltpl:language is a language tag, such as en or es");
        }
        String processor = text(template, Letters.TMPL_TYPE);
        if (!Letters.PROCESSOR.equals(processor)) {
            throw Refusal.invalid("A letter template is rendered by the add-on's processor, " + Letters.PROCESSOR
                    + ", and this one names " + Letters.quoted(processor));
        }
        List<String> forced = list(template, Letters.TMPL_FORCED_TYPES);
        if (!forced.isEmpty() && !forced.equals(List.of(Letters.PLATFORM_NONE))) {
            throw Refusal.invalid("A letter template is bound to no type by itself: tmpl:forcedTypes stays empty");
        }
        if (Boolean.TRUE.equals(template.getPropertyValue(Letters.TMPL_USE_AS_MAIN_CONTENT))) {
            throw Refusal.invalid("A letter template's file is never a letter's main content: "
                    + "tmpl:useAsMainContent stays false");
        }
        String rendition = text(template, Letters.TMPL_TARGET_RENDITION);
        if (rendition != null && !rendition.equals(Letters.PLATFORM_NONE)) {
            throw Refusal.invalid("A letter template is bound to no rendition: tmpl:targetRenditionName stays empty");
        }
        String output = text(template, Letters.TMPL_OUTPUT_FORMAT);
        if (output != null && Framework.getService(TemplateProcessorService.class).getOutputFormatDescriptor(output) == null) {
            throw Refusal.invalid("A letter template's tmpl:outputFormat is one of the platform's output formats");
        }
        List<String> types = list(template, Letters.TMPL_APPLICABLE_TYPES);
        if (types.isEmpty() || types.contains(Letters.PLATFORM_ALL) || types.size() > MAX_TYPES) {
            throw Refusal.invalid("A letter template names the record types it is for in tmpl:applicableTypes, one "
                    + "by one, " + MAX_TYPES + " at most, and never all");
        }
        SchemaManager schemas = Framework.getService(SchemaManager.class);
        List<DocumentType> documentTypes = new ArrayList<>();
        for (String type : types) {
            DocumentType documentType = schemas.getDocumentType(type);
            if (documentType == null || !documentType.hasFacet(Letters.CORRESPONDENCE_FACET)) {
                throw Refusal.invalid("A letter template is for record types that carry the Correspondence facet, "
                        + "and " + Letters.quoted(type) + " is not one");
            }
            documentTypes.add(documentType);
        }
        Set<String> denied = Letters.deniedProperties();
        Map<String, String> conditions = new LinkedHashMap<>();
        List<String> written = list(template, Letters.TEMPLATE_CONDITIONS);
        if (written.size() > MAX_CONDITIONS) {
            throw Refusal.invalid("A letter template has at most " + MAX_CONDITIONS + " conditions");
        }
        for (String condition : written) {
            Matcher matcher = CONDITION.matcher(condition);
            if (!matcher.matches()) {
                throw Refusal.invalid("A letter template's condition is prefix:name=value, and "
                        + Letters.quoted(condition) + " is not");
            }
            String property = matcher.group(1);
            for (DocumentType documentType : documentTypes) {
                scalar(schemas, documentType, property, denied, "condition");
            }
            if (conditions.putIfAbsent(property, matcher.group(2)) != null) {
                throw Refusal.invalid("A letter template's conditions name " + property + " once");
            }
        }
        Blob file = (Blob) template.getPropertyValue(Letters.FILE_CONTENT);
        TemplateText.Parsed text = TemplateText.parse(file);
        for (Placeholder placeholder : text.placeholders()) {
            switch (placeholder.kind()) {
            case PROPERTY -> {
                for (DocumentType documentType : documentTypes) {
                    scalar(schemas, documentType, placeholder.property(), denied, "placeholder");
                }
            }
            case REFERENCE -> {
                for (DocumentType documentType : documentTypes) {
                    Type held = scalar(schemas, documentType, placeholder.property(), denied, "placeholder");
                    if (!(held instanceof SimpleType simple) || !(simple.getPrimitiveType() instanceof StringType)) {
                        throw Refusal.invalid("A letter template's reference " + Letters.quoted(placeholder.text())
                                + " goes through a property that holds a document's id, a text");
                    }
                }
                scalar(schemas, null, placeholder.target(), denied, "placeholder");
            }
            case LETTER -> {
                // The letter's own values: nothing of the record.
            }
            }
        }
        return new Checked(name, letter, language, List.copyOf(types), conditions, text);
    }

    /**
     * The type of {@code xpath}, {@code prefix:name} and its subfields, on {@code type}, or on any
     * document whose schema has that prefix when {@code type} is {@code null}: a value or a list of
     * values, never a file nor what holds several fields, and none the server denies.
     */
    static Type scalar(SchemaManager schemas, DocumentType type, String xpath, Set<String> denied, String what) {
        if (Letters.denied(xpath, denied)) {
            throw Refusal.invalid("A letter template's " + what + " names " + xpath
                    + ", which this server keeps from every letter");
        }
        String[] segments = xpath.split("/");
        int colon = segments[0].indexOf(':');
        String prefix = segments[0].substring(0, colon);
        Schema schema = schemas.getSchemaFromPrefix(prefix);
        String on = type == null ? "this server" : "the type " + type.getName();
        if (schema == null || type != null && !type.hasSchema(schema.getName())) {
            throw Refusal.invalid("A letter template's " + what + " names " + xpath + ", and " + on
                    + " has no schema of the prefix " + prefix);
        }
        Field field = schema.getField(segments[0].substring(colon + 1));
        for (int i = 1; field != null && i < segments.length; i++) {
            if (!(field.getType() instanceof ComplexType complex) || TypeConstants.isContentType(field.getType())) {
                field = null;
                break;
            }
            field = complex.getField(segments[i]);
        }
        if (field == null) {
            throw Refusal.invalid("A letter template's " + what + " names " + xpath + ", which " + on + " does not have");
        }
        Type held = field.getType();
        if (held instanceof ListType list && !list.getFieldType().isComplexType()) {
            held = list.getFieldType();
        }
        if (!(held instanceof SimpleType simple) || simple.getPrimitiveType() instanceof BinaryType) {
            throw Refusal.invalid("A letter template's " + what + " names " + xpath
                    + ", which holds no value a letter prints: a file, or several fields");
        }
        return field.getType();
    }

    private static String text(DocumentModel doc, String xpath) {
        Serializable value = doc.getPropertyValue(xpath);
        if (!(value instanceof String text) || text.isBlank()) {
            return null;
        }
        return text.strip();
    }

    private static List<String> list(DocumentModel doc, String xpath) {
        Serializable value = doc.getPropertyValue(xpath);
        List<String> values = new ArrayList<>();
        if (value instanceof Object[] array) {
            Arrays.stream(array).filter(String.class::isInstance).map(o -> ((String) o).strip())
                  .filter(s -> !s.isEmpty()).forEach(values::add);
        } else if (value instanceof List<?> items) {
            items.stream().filter(String.class::isInstance).map(o -> ((String) o).strip())
                 .filter(s -> !s.isEmpty()).forEach(values::add);
        }
        return values;
    }
}
