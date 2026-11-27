/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import java.io.Serializable;
import java.util.List;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.event.DocumentEventTypes;
import org.nuxeo.ecm.core.api.model.DocumentPart;
import org.nuxeo.ecm.core.api.model.Property;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;

/**
 * The letters' guards, in the transaction of the change, before the platform's own template
 * listener:
 *
 * <ul>
 * <li><b>A letter template</b> is created, changed, copied, trashed, restored or removed by an
 * administrator alone (403). Created or changed, its processor is set to the add-on's when it names
 * none, and it is checked ({@link TemplateRules}): one that does not pass is not saved (400).</li>
 * <li><b>A letter</b> is created by {@code Letter.Generate} alone (403); its properties, its file, its
 * title and its binding to its template are changed by no one after, an administrator included
 * (403); it is not copied, and it is trashed, restored or removed by an administrator alone
 * (403).</li>
 * </ul>
 */
public class LetterGuardListener implements EventListener {

    private static final Logger log = LogManager.getLogger(LetterGuardListener.class);

    static final String TRASHED = "documentTrashed";

    static final String UNTRASHED = "documentUntrashed";

    /** What only the server writes on a letter: its own schema, its file, its title and its binding. */
    static final List<String> LETTER_PARTS = List.of(Letters.LETTER_SCHEMA, "file", Letters.TEMPLATE_BASED_SCHEMA);

    @Override
    public void handleEvent(Event event) {
        if (!(event.getContext() instanceof DocumentEventContext context)) {
            return;
        }
        DocumentModel doc = context.getSourceDocument();
        if (doc == null) {
            return;
        }
        try {
            if (doc.hasFacet(Letters.TEMPLATE_FACET)) {
                guardTemplate(event.getName(), context.getPrincipal(), doc);
            } else if (Letters.LETTER_TYPE.equals(doc.getType())) {
                guardLetter(event.getName(), context.getPrincipal(), doc);
            }
        } catch (NuxeoException refusal) {
            throw Refusal.refuse(log, event, context, doc, refusal);
        }
    }

    private static void guardTemplate(String event, NuxeoPrincipal principal, DocumentModel doc) {
        if (doc.isVersion() && !DocumentEventTypes.ABOUT_TO_REMOVE_VERSION.equals(event)) {
            return;
        }
        switch (event) {
        case DocumentEventTypes.ABOUT_TO_CREATE, DocumentEventTypes.BEFORE_DOC_UPDATE -> {
            administrator(principal, "Letter templates are kept by administrators");
            Serializable processor = doc.getPropertyValue(Letters.TMPL_TYPE);
            if (processor == null || processor instanceof String text
                    && (text.isBlank() || text.strip().equals(Letters.PLATFORM_AUTO))) {
                doc.setPropertyValue(Letters.TMPL_TYPE, Letters.PROCESSOR);
            }
            TemplateRules.check(doc);
        }
        case DocumentEventTypes.DOCUMENT_CREATED_BY_COPY, DocumentEventTypes.ABOUT_TO_REMOVE,
                DocumentEventTypes.ABOUT_TO_REMOVE_VERSION, TRASHED, UNTRASHED,
                DocumentEventTypes.BEFORE_DOC_RESTORE ->
            administrator(principal, "Letter templates are kept by administrators");
        default -> {
            // Nothing else of a template's is guarded.
        }
        }
    }

    private static void guardLetter(String event, NuxeoPrincipal principal, DocumentModel doc) {
        switch (event) {
        case DocumentEventTypes.ABOUT_TO_CREATE -> {
            if (!ServerWrite.CREATE.consumes(doc)) {
                throw Refusal.forbidden("A letter is written by Letter.Generate, from its template, and by nothing else");
            }
        }
        case DocumentEventTypes.BEFORE_DOC_UPDATE -> {
            if (ServerWrite.FILE.consumes(doc)) {
                return;
            }
            if (serverPartChanged(doc)) {
                throw Refusal.forbidden("A letter is kept as it was written: no one changes it");
            }
        }
        case DocumentEventTypes.DOCUMENT_CREATED_BY_COPY ->
            throw Refusal.forbidden("A letter is not copied: a copy would be a letter no one wrote");
        case DocumentEventTypes.ABOUT_TO_REMOVE, TRASHED, UNTRASHED, DocumentEventTypes.BEFORE_DOC_RESTORE ->
            administrator(principal, "A letter is kept: an administrator alone trashes, restores or removes one");
        default -> {
            // Nothing else of a letter's is guarded.
        }
        }
    }

    /** Whether any of a letter's server parts, or its title, is changed in this write. */
    private static boolean serverPartChanged(DocumentModel doc) {
        for (String schema : LETTER_PARTS) {
            if (doc.hasSchema(schema)) {
                DocumentPart part = doc.getPart(schema);
                if (part != null && part.isDirty()) {
                    return true;
                }
            }
        }
        Property title = doc.getProperty("dc:title");
        return title != null && title.isDirty();
    }

    private static void administrator(NuxeoPrincipal principal, String message) {
        if (!Refusal.isAdministrator(principal)) {
            throw Refusal.forbidden(message);
        }
    }
}
