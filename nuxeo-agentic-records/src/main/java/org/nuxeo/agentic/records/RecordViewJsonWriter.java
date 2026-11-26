package org.nuxeo.agentic.records;

import static org.nuxeo.ecm.core.io.registry.reflect.Instantiations.SINGLETON;
import static org.nuxeo.ecm.core.io.registry.reflect.Priorities.OVERRIDE_REFERENCE;

import java.io.IOException;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.io.marshallers.json.document.DocumentModelJsonWriter;
import org.nuxeo.ecm.core.io.registry.reflect.Setup;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.JsonStreamContext;

/**
 * Access logging's view: the platform's own JSON writer for a document, which the REST API answers
 * every request for a document with, and which logs a view of a record under retention or a legal
 * hold ({@link RecordsAudit#viewed}).
 *
 * <ul>
 * <li><b>A view is the document as an answer of its own:</b> the JSON's root, as a request for the
 * document, its path, an update of it or an operation returning it is answered. A document written
 * inside another answer, a page of search results, a folder's children or a document a property
 * names, is listed, not viewed, and is not logged: each list would log every record it shows.</li>
 * <li><b>What it costs:</b> for a document that is no record, a read of what the document already
 * holds; for a record under retention, an event, which the add-on's writer adds to the audit in the
 * background ({@code RecordAccessCostTest} measures it).</li>
 * <li><b>Downloads are the platform's:</b> every file the download service sends, downloaded, shown
 * in a preview or as a rendition, is in the audit already, as its {@code download} event.</li>
 * </ul>
 *
 * It writes exactly what the platform's writer writes: it calls it, then logs.
 */
@Setup(mode = SINGLETON, priority = OVERRIDE_REFERENCE)
public class RecordViewJsonWriter extends DocumentModelJsonWriter {

    private static final Logger log = LogManager.getLogger(RecordViewJsonWriter.class);

    @Override
    protected void writeEntityBody(DocumentModel doc, JsonGenerator jg) throws IOException {
        super.writeEntityBody(doc, jg);
        if (isAnswer(jg)) {
            try {
                RecordsAudit.viewed(doc);
            } catch (RuntimeException e) {
                // The read is the person's: it is answered, and the server's log says the view was not recorded.
                log.error("Access logging: a view of {} could not be recorded", doc.getId(), e);
            }
        }
    }

    /** Whether the object being written is the JSON's root, not an entry of a list or a property's value. */
    static boolean isAnswer(JsonGenerator jg) {
        JsonStreamContext object = jg.getOutputContext();
        JsonStreamContext parent = object == null ? null : object.getParent();
        return object != null && object.inObject() && parent != null && parent.inRoot();
    }
}
