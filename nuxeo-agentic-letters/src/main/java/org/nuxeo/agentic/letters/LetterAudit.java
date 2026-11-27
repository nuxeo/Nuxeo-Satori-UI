/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import java.io.Serializable;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import org.nuxeo.common.utils.Path;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.event.EventService;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.ecm.core.event.impl.ShallowDocumentModel;
import org.nuxeo.runtime.api.Framework;

/**
 * What the add-on adds to the platform's audit: one entry, event {@value #EVENT}, category
 * {@value #CATEGORY}, each time a letter is written, on its record, in the record's history.
 *
 * <p>Fired in the transaction that writes the letter, so that a refused or failed letter records
 * nothing; {@link LetterAuditWriter} writes it to the audit once that transaction has committed, as
 * the documents and records add-ons write their own. The platform builds the entry from the event:
 * who, when, the record's id, path and type, the comment, and the extended information below. The
 * platform's own entry for the letter's creation is on the letter.
 */
final class LetterAudit {

    static final String EVENT = "letterGenerated";

    static final String CATEGORY = "Letters";

    static final String LETTER = "letter";

    static final String LETTER_ID = "letterId";

    static final String TEMPLATE = "template";

    static final String TEMPLATE_NAME = "templateName";

    static final String LANGUAGE = "language";

    /** Why that language: {@value #CHOSEN}, {@value #RECORDS} or {@value #DEFAULT}. */
    static final String LANGUAGE_FROM = "languageFrom";

    static final String CHOSEN = "chosen";

    static final String RECORDS = "record";

    static final String DEFAULT = "default";

    static final String BY = "by";

    static final String EXTENDED_INFOS = "extendedInfos";

    static final String SKIP_REFETCH = "skipRefetchDocument";

    private LetterAudit() {
    }

    /** Fire the entry for the letter written on {@code record}, as {@code by}, in the current transaction. */
    static void fire(CoreSession session, NuxeoPrincipal by, DocumentModel record, DocumentModel letter,
            TemplateRules.Checked template, String templateId, String languageFrom) {
        String acting = Refusal.actingUser(by, by == null ? "?" : by.getName());
        Map<String, Serializable> extended = new HashMap<>();
        extended.put(LETTER, template.letter());
        extended.put(LETTER_ID, letter.getId());
        extended.put(TEMPLATE, templateId);
        extended.put(TEMPLATE_NAME, template.name());
        extended.put(LANGUAGE, template.language());
        extended.put(LANGUAGE_FROM, languageFrom);
        extended.put(BY, acting);
        DocumentEventContext context = new DocumentEventContext(session, by, snapshot(record));
        context.setProperty("category", CATEGORY);
        context.setProperty("comment", comment(acting, template, letter.getId(), languageFrom));
        context.setProperty(EXTENDED_INFOS, new HashMap<>(extended));
        Framework.getService(EventService.class).fireEvent(context.newEvent(EVENT));
    }

    /** "dana wrote the letter payers.denial, 1234-..., from the template payers-denial-es, in es, the record's language". */
    static String comment(String acting, TemplateRules.Checked template, String letterId, String languageFrom) {
        String why = switch (languageFrom) {
        case CHOSEN -> "as chosen";
        case RECORDS -> "the record's language";
        default -> "the default, with no template in the record's language";
        };
        return acting + " wrote the letter " + template.letter() + ", " + letterId + ", from the template "
                + template.name() + ", in " + template.language() + ", " + why;
    }

    /** What the audit reads of a document, kept as it is now: never read again in the background. */
    private static ShallowDocumentModel snapshot(DocumentModel doc) {
        Map<String, Serializable> context = new HashMap<>();
        context.put(SKIP_REFETCH, Boolean.TRUE);
        Path where = new Path(doc.getPathAsString());
        Set<String> facets = new HashSet<>(doc.getFacets());
        return new ShallowDocumentModel(doc.getId(), doc.getRepositoryName(), where.lastSegment(), where,
                doc.getType(), doc.isFolder(), doc.isVersion(), doc.isProxy(), doc.isImmutable(), context, facets,
                doc.isLifeCycleLoaded() ? doc.getCurrentLifeCycleState() : null);
    }
}
