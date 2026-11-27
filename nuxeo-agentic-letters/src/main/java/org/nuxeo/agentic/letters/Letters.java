/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import org.nuxeo.runtime.api.Framework;

/**
 * The names the add-on writes and reads, its own and the platform's Template Rendering's, and its
 * two server settings.
 */
final class Letters {

    // ------------------------------------------------------------------ the add-on's model

    /** On a kit's record type: letters may be written on a record of the type. */
    static final String CORRESPONDENCE_FACET = "Correspondence";

    static final String CORRESPONDENCE_SCHEMA = "correspondence";

    static final String CORRESPONDENCE_PREFIX = "corr";

    /** The language a record's letters are written in when none is asked for. */
    static final String RECORD_LANGUAGE = "corr:language";

    static final List<String> CORRESPONDENCE_PROPERTIES = List.of(RECORD_LANGUAGE);

    /** A letter template: the platform's TemplateSource with the add-on's facet of the same name. */
    static final String TEMPLATE_TYPE = "LetterTemplate";

    static final String TEMPLATE_FACET = "LetterTemplate";

    static final String TEMPLATE_SCHEMA = "letter_template";

    static final String TEMPLATE_PREFIX = "ltpl";

    static final String TEMPLATE_LETTER = "ltpl:letter";

    static final String TEMPLATE_LANGUAGE = "ltpl:language";

    static final String TEMPLATE_CONDITIONS = "ltpl:conditions";

    static final List<String> TEMPLATE_PROPERTIES = List.of(TEMPLATE_LETTER, TEMPLATE_LANGUAGE, TEMPLATE_CONDITIONS);

    /** A letter, as the add-on files it next to its record. */
    static final String LETTER_TYPE = "Letter";

    static final String LETTER_SCHEMA = "letter";

    static final String LETTER_PREFIX = "letter";

    static final String LETTER_RECORD = "letter:record";

    static final String LETTER_LETTER = "letter:letter";

    static final String LETTER_TEMPLATE = "letter:template";

    static final String LETTER_TEMPLATE_NAME = "letter:templateName";

    static final String LETTER_LANGUAGE = "letter:language";

    static final String LETTER_WRITTEN_BY = "letter:writtenBy";

    static final String LETTER_WRITTEN_AT = "letter:writtenAt";

    static final List<String> LETTER_PROPERTIES = List.of(LETTER_RECORD, LETTER_LETTER, LETTER_TEMPLATE,
            LETTER_TEMPLATE_NAME, LETTER_LANGUAGE, LETTER_WRITTEN_BY, LETTER_WRITTEN_AT);

    /** The add-on's template processor, as the platform's template processor service registers it. */
    static final String PROCESSOR = "agenticLetter";

    // ------------------------------------------------------------------ the platform's Template Rendering

    /** The platform's template document type, and its facet. */
    static final String PLATFORM_TEMPLATE_TYPE = "TemplateSource";

    static final String PLATFORM_TEMPLATE_FACET = "Template";

    /** The platform's facet of a document bound to a template, and its schema. */
    static final String TEMPLATE_BASED_FACET = "TemplateBased";

    static final String TEMPLATE_BASED_SCHEMA = "templatesupport";

    static final String PLATFORM_TEMPLATE_SCHEMA = "documenttemplate";

    static final String TMPL_NAME = "tmpl:templateName";

    static final String TMPL_TYPE = "tmpl:templateType";

    static final String TMPL_APPLICABLE_TYPES = "tmpl:applicableTypes";

    static final String TMPL_FORCED_TYPES = "tmpl:forcedTypes";

    static final String TMPL_USE_AS_MAIN_CONTENT = "tmpl:useAsMainContent";

    static final String TMPL_OUTPUT_FORMAT = "tmpl:outputFormat";

    static final String TMPL_TARGET_RENDITION = "tmpl:targetRenditionName";

    /** What the platform writes for "every type", "no forced type", "no rendition" and "detect". */
    static final String PLATFORM_ALL = "all";

    static final String PLATFORM_NONE = "none";

    static final String PLATFORM_AUTO = "auto";

    static final String TMPL_BINDINGS = "nxts:bindings";

    static final String FILE_CONTENT = "file:content";

    /** Every platform name the add-on reads or writes, which TemplateRenderingModelTest holds to its files. */
    static final List<String> PLATFORM_PROPERTIES = List.of(TMPL_NAME, TMPL_TYPE, TMPL_APPLICABLE_TYPES,
            TMPL_FORCED_TYPES, TMPL_USE_AS_MAIN_CONTENT, TMPL_OUTPUT_FORMAT, TMPL_TARGET_RENDITION, TMPL_BINDINGS);

    // ------------------------------------------------------------------ forms

    /** A letter's id, as a template and a button name it: payers.denial. */
    static final Pattern LETTER_ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,99}");

    /** A template's name, as the platform keeps it in tmpl:templateName: payers-denial-en. */
    static final Pattern TEMPLATE_NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,99}");

    /** A language tag: a language, and a region if any. en, es, pt-BR. */
    static final Pattern LANGUAGE_TAG = Pattern.compile("[a-z]{2,3}(?:-[A-Z]{2})?");

    // ------------------------------------------------------------------ settings

    /** The language a letter falls back to when its record's has no template: en when unset. */
    static final String DEFAULT_LANGUAGE_PROPERTY = "nuxeo.agentic.letters.language.default";

    static final String DEFAULT_LANGUAGE = "en";

    /**
     * Properties no template may name, as {@code prefix:name}, separated by commas: a member's social
     * security number, say. None when unset.
     */
    static final String DENIED_PROPERTIES_PROPERTY = "nuxeo.agentic.letters.properties.denied";

    private Letters() {
    }

    /** The server's default language for letters, when it is a language tag; else {@value #DEFAULT_LANGUAGE}. */
    static String defaultLanguage() {
        String configured = Framework.getProperty(DEFAULT_LANGUAGE_PROPERTY);
        if (configured != null && LANGUAGE_TAG.matcher(configured.strip()).matches()) {
            return configured.strip();
        }
        return DEFAULT_LANGUAGE;
    }

    /** The properties the server keeps from every template, each {@code prefix:name}. */
    static Set<String> deniedProperties() {
        String configured = Framework.getProperty(DENIED_PROPERTIES_PROPERTY);
        Set<String> denied = new LinkedHashSet<>();
        if (configured == null) {
            return denied;
        }
        Arrays.stream(configured.split(",")).map(String::strip).filter(s -> !s.isEmpty()).forEach(denied::add);
        return denied;
    }

    /** Whether {@code xpath}, {@code prefix:name} or a subfield of it, is one the server denies. */
    static boolean denied(String xpath, Set<String> denied) {
        int slash = xpath.indexOf('/');
        String top = slash < 0 ? xpath : xpath.substring(0, slash);
        return denied.contains(top);
    }

    /** {@code text} for a message: on one line, and at most 80 characters. */
    static String quoted(String text) {
        if (text == null) {
            return "\"\"";
        }
        String line = text.replaceAll("[\\p{Cntrl}]", " ");
        return "\"" + (line.length() > 80 ? line.substring(0, 77) + "..." : line) + "\"";
    }
}
