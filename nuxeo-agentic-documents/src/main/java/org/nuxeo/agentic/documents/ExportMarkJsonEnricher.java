/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.nuxeo.agentic.documents.ControlledDocuments.FACET;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_MARKED_AT;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_MARKED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_SCHEMA;
import static org.nuxeo.ecm.core.io.registry.reflect.Instantiations.SINGLETON;
import static org.nuxeo.ecm.core.io.registry.reflect.Priorities.REFERENCE;

import java.io.IOException;
import java.io.Serializable;
import java.util.Calendar;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.io.marshallers.json.enrichers.AbstractJsonEnricher;
import org.nuxeo.ecm.core.io.registry.reflect.Setup;

import com.fasterxml.jackson.core.JsonGenerator;

/**
 * The {@code exportMark} document enricher: a controlled document's export-control mark, and
 * whether the person reading it may receive it, so that a client can say why the server refused a
 * download or a rendition, as the assets add-on's {@code assetRights} says it for rights.
 *
 * <p>Ask for it with {@code enrichers.document: exportMark}. For a document that is not controlled
 * it writes {@code "exportMark": null}. Otherwise:
 *
 * <pre>
 * "exportMark": {
 *   "classification": "EC-2",
 *   "groups": ["ec2-recipients"],
 *   "markedBy": "avega",
 *   "markedAt": "2026-11-26T09:12:00.000Z",
 *   "receives": false,
 *   "reason": "not-in-groups"
 * }
 * </pre>
 *
 * <p>An unmarked revision has a {@code null} classification, no group, and {@code "receives": true}.
 * {@code reason} is a code of {@link ExportMarks.Reason}, for the client to translate, or
 * {@code null}. A version or a proxy is decided with its live document's mark too, as a download of
 * it is; only its own mark is written, since a reader of a proxy may not read the live document. The
 * enricher explains; the download permission is what refuses. Both decide through
 * {@link ExportMarks#decide}.
 */
@Setup(mode = SINGLETON, priority = REFERENCE)
public class ExportMarkJsonEnricher extends AbstractJsonEnricher<DocumentModel> {

    private static final Logger log = LogManager.getLogger(ExportMarkJsonEnricher.class);

    public static final String NAME = "exportMark";

    public ExportMarkJsonEnricher() {
        super(NAME);
    }

    @Override
    public void write(JsonGenerator jg, DocumentModel document) throws IOException {
        if (!document.hasFacet(FACET)) {
            jg.writeNullField(NAME);
            return;
        }
        ExportMarks.Mark mark = ExportMarks.read(document);
        ExportMarks.Decision decided;
        try {
            decided = ExportMarks.decide(document, null, reader(document));
        } catch (RuntimeException e) {
            log.error("Controlled documents: the export-control mark of {} could not be decided", document.getId(), e);
            decided = ExportMarks.Decision.refuse(ExportMarks.Reason.UNREADABLE, mark);
        }
        jg.writeObjectFieldStart(NAME);
        if (mark.isMarked()) {
            jg.writeStringField("classification", mark.classification());
        } else {
            jg.writeNullField("classification");
        }
        jg.writeArrayFieldStart("groups");
        if (mark.isMarked()) {
            for (String group : mark.groups()) {
                jg.writeString(group);
            }
        }
        jg.writeEndArray();
        String by = Stored.text(document, MARK_SCHEMA, MARK_MARKED_BY);
        if (by == null) {
            jg.writeNullField("markedBy");
        } else {
            jg.writeStringField("markedBy", by);
        }
        Serializable at = document.hasSchema(MARK_SCHEMA) ? document.getPropertyValue(MARK_MARKED_AT) : null;
        if (at instanceof Calendar calendar) {
            jg.writeStringField("markedAt", calendar.toInstant().toString());
        } else {
            jg.writeNullField("markedAt");
        }
        jg.writeBooleanField("receives", decided.allowed());
        if (decided.reason() == null) {
            jg.writeNullField("reason");
        } else {
            jg.writeStringField("reason", decided.reason().code);
        }
        jg.writeEndObject();
    }

    /** The person reading: the document's session's, which the REST API opens as the one signed in. */
    private static NuxeoPrincipal reader(DocumentModel document) {
        CoreSession session = document.getCoreSession();
        NuxeoPrincipal principal = session == null ? null : session.getPrincipal();
        return principal != null ? principal : NuxeoPrincipal.getCurrent();
    }
}
