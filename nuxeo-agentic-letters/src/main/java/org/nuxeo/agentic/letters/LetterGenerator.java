/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.PropertyException;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;
import org.nuxeo.template.api.TemplateProcessorService;
import org.nuxeo.template.api.adapters.TemplateBasedDocument;
import org.nuxeo.template.api.adapters.TemplateSourceDocument;

/**
 * A letter written on a record, as the person who asks, in this order, so that nothing is read or
 * written before it may be:
 *
 * <ol>
 * <li><b>The record,</b> read as the person: one they may not read is the platform's refusal. It is
 * the live record, not a version or a proxy (400), its type carries {@code Correspondence} (400),
 * and it is not in the trash (409).</li>
 * <li><b>The person may write it</b> ({@code Write}): 403 otherwise, before any template is read.</li>
 * <li><b>The letter's templates,</b> the live {@code LetterTemplate} documents of that letter for the
 * record's type, as the person may read them: none is 404.</li>
 * <li><b>Its language:</b> the one asked for, refused, 400, when no template is in it; with none asked
 * for, the record's {@code corr:language} when a template is in it, else the server's default
 * language, else 404.</li>
 * <li><b>The one template</b> of that language whose conditions the stored record meets: none, or more
 * than one, is 409.</li>
 * <li><b>Checked again</b> ({@link TemplateRules}), as when it was saved, and refused, 409, when it no
 * longer passes; its placeholders' values read as the person ({@link LetterValues}).</li>
 * <li><b>Written:</b> a {@code Letter} created next to the record, as the person, who needs to be able
 * to add a document there; bound to its template, the platform's binding; rendered through the
 * platform's template processor service, by the add-on's processor, and converted to the template's
 * output format when it names one; its file saved; and its audit entry fired on the record.</li>
 * </ol>
 */
final class LetterGenerator {

    private static final Logger log = LogManager.getLogger(LetterGenerator.class);

    /** The most templates a letter's search reads. */
    static final int MAX_TEMPLATES = 200;

    private LetterGenerator() {
    }

    static DocumentModel generate(CoreSession session, DocumentModel input, String letterId, String language) {
        NuxeoPrincipal writer = session.getPrincipal();
        DocumentRef ref = input == null ? null : input.getRef();
        if (ref == null) {
            throw Refusal.invalid("A letter is written on a record");
        }
        DocumentModel record = session.getDocument(ref);
        if (record.isVersion() || record.isProxy()) {
            throw Refusal.invalid("A letter is written on the record itself, not on a version or a proxy of it");
        }
        if (!record.hasFacet(Letters.CORRESPONDENCE_FACET)) {
            throw Refusal.invalid("Letters are written on a record whose type carries the Correspondence facet");
        }
        if (!session.hasPermission(record.getRef(), SecurityConstants.WRITE)) {
            log.info("Letters: {} refused a letter on {}: no Write permission",
                    Refusal.actingUser(writer, "?"), record.getId());
            throw Refusal.forbidden("Writing a letter on a record needs the Write permission on it");
        }
        if (record.isTrashed()) {
            throw Refusal.conflict("No letter is written on a record in the trash");
        }
        String letter = letterId == null ? null : letterId.strip();
        if (letter == null || !Letters.LETTER_ID.matcher(letter).matches()) {
            throw Refusal.invalid("A letter is named by its id: letters, digits, dots, hyphens and underscores");
        }
        String chosen = language == null || language.isBlank() ? null : language.strip();
        if (chosen != null && !Letters.LANGUAGE_TAG.matcher(chosen).matches()) {
            throw Refusal.invalid("A letter's language is a language tag, such as en or es");
        }

        Map<String, List<DocumentModel>> byLanguage = templates(session, letter, record.getType());
        if (byLanguage.isEmpty()) {
            throw Refusal.notFound("No template of the letter " + letter + " is for a record of this type");
        }
        String in;
        String languageFrom;
        if (chosen != null) {
            if (!byLanguage.containsKey(chosen)) {
                throw Refusal.invalid("No template of the letter " + letter + " is in " + chosen);
            }
            in = chosen;
            languageFrom = LetterAudit.CHOSEN;
        } else {
            String recordLanguage = recordLanguage(record);
            String fallback = Letters.defaultLanguage();
            if (recordLanguage != null && byLanguage.containsKey(recordLanguage)) {
                in = recordLanguage;
                languageFrom = LetterAudit.RECORDS;
            } else if (byLanguage.containsKey(fallback)) {
                in = fallback;
                languageFrom = LetterAudit.DEFAULT;
            } else {
                throw Refusal.notFound("No template of the letter " + letter
                        + " is in the record's language or in the default, " + fallback);
            }
        }
        List<DocumentModel> fitting = new ArrayList<>();
        for (DocumentModel candidate : byLanguage.get(in)) {
            if (fits(record, candidate)) {
                fitting.add(candidate);
            }
        }
        if (fitting.isEmpty()) {
            throw Refusal.conflict("No template of the letter " + letter + " in " + in
                    + " fits the record as it stands");
        }
        if (fitting.size() > 1) {
            throw Refusal.conflict("More than one template of the letter " + letter + " in " + in
                    + " fits the record: an administrator gives them conditions that tell them apart");
        }
        DocumentModel template = fitting.get(0);
        TemplateRules.Checked checked;
        try {
            checked = TemplateRules.check(template);
        } catch (NuxeoException e) {
            log.warn("Letters: the template {} ({}) does not pass the add-on's checks: {}", template.getId(),
                    template.getPropertyValue(Letters.TMPL_NAME), e.getMessage());
            throw Refusal.conflict("The letter's template does not pass the add-on's checks, and no letter is "
                    + "written from it: " + e.getMessage());
        }
        if (!checked.types().contains(record.getType())) {
            throw Refusal.notFound("No template of the letter " + letter + " is for a record of this type");
        }
        Map<Placeholder, String> values = LetterValues.resolve(session, record, checked.text(), checked.language());
        try {
            return write(session, writer, record, template, checked, values, languageFrom);
        } catch (RuntimeException e) {
            TransactionHelper.setTransactionRollbackOnly();
            throw e;
        }
    }

    private static DocumentModel write(CoreSession session, NuxeoPrincipal writer, DocumentModel record,
            DocumentModel template, TemplateRules.Checked checked, Map<Placeholder, String> values,
            String languageFrom) {
        String templateTitle = template.getTitle() == null || template.getTitle().isBlank() ? checked.name()
                : template.getTitle().strip();
        String title = templateTitle + ", " + (record.getTitle() == null ? record.getName() : record.getTitle());
        String parent = record.getPath().removeLastSegments(1).toString();
        DocumentModel model = session.createDocumentModel(parent, checked.letter().replace('.', '-'),
                Letters.LETTER_TYPE);
        model.setPropertyValue("dc:title", title);
        model.setPropertyValue(Letters.LETTER_RECORD, record.getId());
        model.setPropertyValue(Letters.LETTER_LETTER, checked.letter());
        model.setPropertyValue(Letters.LETTER_TEMPLATE, template.getId());
        model.setPropertyValue(Letters.LETTER_TEMPLATE_NAME, checked.name());
        model.setPropertyValue(Letters.LETTER_LANGUAGE, checked.language());
        model.setPropertyValue(Letters.LETTER_WRITTEN_BY, writer.getName());
        model.setPropertyValue(Letters.LETTER_WRITTEN_AT, Calendar.getInstance());
        ServerWrite.CREATE.mark(model);
        DocumentModel created = session.createDocument(model);

        TemplateProcessorService templates = Framework.getService(TemplateProcessorService.class);
        DocumentModel bound = templates.makeTemplateBasedDocument(created, template, false);
        TemplateBasedDocument based = bound.getAdapter(TemplateBasedDocument.class);
        String binding = template.getAdapter(TemplateSourceDocument.class).getName();
        LetterRendering.Current current = new LetterRendering.Current(created.getId(), binding, checked.text(),
                values, fileName(title, checked.text().format()));
        Blob file = LetterRendering.during(current, () -> based.renderWithTemplate(binding));
        DocumentModel letter = based.getAdaptedDoc();
        letter.setPropertyValue(Letters.FILE_CONTENT, (Serializable) file);
        ServerWrite.FILE.mark(letter);
        letter = session.saveDocument(letter);
        LetterAudit.fire(session, writer, record, letter, checked, template.getId(), languageFrom);
        log.info("Letters: {} wrote the letter {} on {} from the template {}, in {}", Refusal.actingUser(writer, "?"),
                letter.getId(), record.getId(), checked.name(), checked.language());
        return letter;
    }

    /** The letter's templates for {@code type}, as the person may read them, by language. */
    private static Map<String, List<DocumentModel>> templates(CoreSession session, String letter, String type) {
        String query = "SELECT * FROM " + Letters.TEMPLATE_TYPE + " WHERE " + Letters.TEMPLATE_LETTER + " = '"
                + escape(letter) + "' AND " + Letters.TMPL_APPLICABLE_TYPES + " IN ('" + escape(type)
                + "') AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:isTrashed = 0 ORDER BY ecm:uuid";
        Map<String, List<DocumentModel>> byLanguage = new LinkedHashMap<>();
        for (DocumentModel template : session.query(query, MAX_TEMPLATES)) {
            if (!template.hasFacet(Letters.TEMPLATE_FACET) || !letter.equals(template.getPropertyValue(Letters.TEMPLATE_LETTER))
                    || !types(template).contains(type)) {
                continue;
            }
            Serializable language = template.getPropertyValue(Letters.TEMPLATE_LANGUAGE);
            if (language instanceof String tag && Letters.LANGUAGE_TAG.matcher(tag.strip()).matches()) {
                byLanguage.computeIfAbsent(tag.strip(), key -> new ArrayList<>()).add(template);
            }
        }
        return byLanguage;
    }

    private static List<String> types(DocumentModel template) {
        Serializable value = template.getPropertyValue(Letters.TMPL_APPLICABLE_TYPES);
        if (value instanceof Object[] array) {
            return Arrays.stream(array).map(String::valueOf).map(String::strip).toList();
        }
        return List.of();
    }

    /** The record's own language, when it is a language tag. */
    private static String recordLanguage(DocumentModel record) {
        Serializable value = record.getPropertyValue(Letters.RECORD_LANGUAGE);
        if (value instanceof String tag && Letters.LANGUAGE_TAG.matcher(tag.strip()).matches()) {
            return tag.strip();
        }
        return null;
    }

    /** Whether the stored record meets every condition of {@code template}; a condition it cannot read, it does not. */
    static boolean fits(DocumentModel record, DocumentModel template) {
        Serializable conditions = template.getPropertyValue(Letters.TEMPLATE_CONDITIONS);
        List<String> each = conditions instanceof Object[] array ? Arrays.stream(array).map(String::valueOf).toList()
                : List.of();
        for (String condition : each) {
            Matcher matcher = TemplateRules.CONDITION.matcher(condition.strip());
            if (!matcher.matches()) {
                return false;
            }
            Serializable value;
            try {
                value = record.getPropertyValue(matcher.group(1));
            } catch (PropertyException e) {
                return false;
            }
            String expected = matcher.group(2);
            boolean met;
            if (value instanceof Object[] array) {
                met = Arrays.stream(array).anyMatch(item -> item != null && expected.equals(String.valueOf(item)));
            } else if (value instanceof List<?> list) {
                met = list.stream().anyMatch(item -> item != null && expected.equals(String.valueOf(item)));
            } else {
                met = value != null && expected.equals(String.valueOf(value));
            }
            if (!met) {
                return false;
            }
        }
        return true;
    }

    /** The letter's file name: its title, of characters any file system keeps, and the format's extension. */
    static String fileName(String title, TemplateText.Format format) {
        String safe = title.replaceAll("[^\\p{L}\\p{N} ,._-]", "-").strip();
        if (safe.length() > 120) {
            safe = safe.substring(0, 120).strip();
        }
        return (safe.isEmpty() ? "letter" : safe) + format.extension;
    }

    private static String escape(String text) {
        return text.replace("\\", "\\\\").replace("'", "\\'");
    }
}
