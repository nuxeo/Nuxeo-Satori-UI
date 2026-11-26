package org.nuxeo.agentic.records;

import java.time.Clock;

import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.event.DocumentEventTypes;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventBundle;
import org.nuxeo.ecm.core.event.PostCommitFilteringEventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;

/**
 * Writes an audit export once it has been filed and the filer's transaction has committed, in the
 * background, so that a long period never holds a person's request ({@link AuditExports#generate}).
 * As the filer: the export holds only what they may read.
 */
public class AuditExportListener implements PostCommitFilteringEventListener {

    private final AuditExports exports;

    public AuditExportListener() {
        this(new AuditExports(Clock.systemUTC()));
    }

    AuditExportListener(AuditExports exports) {
        this.exports = exports;
    }

    @Override
    public boolean acceptEvent(Event event) {
        return DocumentEventTypes.DOCUMENT_CREATED.equals(event.getName())
                && event.getContext() instanceof DocumentEventContext context && context.getSourceDocument() != null
                && Disposition.EXPORT_TYPE.equals(context.getSourceDocument().getType());
    }

    @Override
    public void handleEvent(EventBundle events) {
        for (Event event : events) {
            if (!acceptEvent(event)) {
                continue;
            }
            DocumentEventContext context = (DocumentEventContext) event.getContext();
            DocumentModel export = context.getSourceDocument();
            NuxeoPrincipal filer = context.getPrincipal();
            if (filer != null) {
                exports.generate(export.getRepositoryName(), export.getId(), filer);
            }
        }
    }
}
