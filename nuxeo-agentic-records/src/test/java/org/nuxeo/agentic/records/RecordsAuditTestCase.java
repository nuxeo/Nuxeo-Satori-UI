package org.nuxeo.agentic.records;

import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Map;

import javax.inject.Inject;
import javax.ws.rs.core.MediaType;

import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentModelList;
import org.nuxeo.ecm.core.event.EventService;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.ecm.core.io.marshallers.json.document.DocumentModelListJsonWriter;
import org.nuxeo.ecm.core.io.registry.MarshallerHelper;
import org.nuxeo.ecm.core.io.registry.MarshallerRegistry;
import org.nuxeo.ecm.core.io.registry.Writer;
import org.nuxeo.ecm.core.io.registry.context.RenderingContext;
import org.nuxeo.ecm.core.query.sql.model.OrderByExprs;
import org.nuxeo.ecm.core.query.sql.model.Predicates;
import org.nuxeo.ecm.core.query.sql.model.QueryBuilder;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.TransactionalFeature;

/**
 * The add-on with the platform's audit: what the tests of access logging and of the audit export
 * share. The retention module's own audited event, {@code retentionRuleAttached}, is registered as the
 * module registers it, since its classes, which fire it, are never loaded.
 */
@Features(RecordsAuditFeature.class)
@Deploy("org.nuxeo.agentic.records:OSGI-INF/test-audit-module.xml")
public abstract class RecordsAuditTestCase extends DispositionTestCase {

    @Inject
    protected TransactionalFeature txFeature;

    /** Commits, and waits for the add-on's writer and the platform's audit to have written everything. */
    protected void audited() {
        session.save();
        txFeature.nextTransaction();
    }

    /** The audit's entries of {@code event}, about {@code doc} when it is given, in the audit's order. */
    protected static List<LogEntry> entries(String event, DocumentModel doc) {
        QueryBuilder query = new QueryBuilder();
        query.predicate(Predicates.eq("eventId", event));
        if (doc != null) {
            query.and(Predicates.eq("docUUID", doc.getId()));
        }
        query.order(OrderByExprs.asc("id"));
        List<LogEntry> entries = new ArrayList<>();
        for (Object entry : AuditAccess.reader().queryLogs(query)) {
            entries.add((LogEntry) entry);
        }
        return entries;
    }

    /** What the REST API answers a request for {@code doc} with, as the person whose session read it. */
    protected static String answer(DocumentModel doc) throws IOException {
        RenderingContext ctx = RenderingContext.CtxBuilder.session(doc.getCoreSession()).properties("*").get();
        return MarshallerHelper.objectToJson(doc, ctx);
    }

    /** What it answers a search with: the documents as a list. */
    protected static String list(CoreSession session, DocumentModelList docs) throws IOException {
        RenderingContext ctx = RenderingContext.CtxBuilder.session(session).properties("*").get();
        Writer<DocumentModelList> writer = Framework.getService(MarshallerRegistry.class)
                                                    .getWriter(ctx, DocumentModelList.class, MediaType.APPLICATION_JSON_TYPE);
        assertTrue(DocumentModelListJsonWriter.class.isInstance(writer));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        writer.write(docs, DocumentModelList.class, DocumentModelList.class, MediaType.APPLICATION_JSON_TYPE, out);
        return out.toString(StandardCharsets.UTF_8);
    }

    /** A record under retention until {@code until}, in the records folder. */
    protected DocumentModel retained(String title, Instant until) {
        DocumentModel doc = session.createDocumentModel(Fixtures.RECORDS, title.toLowerCase().replace(' ', '-'), "File");
        doc.setPropertyValue("dc:title", title);
        doc = session.createDocument(doc);
        session.makeRecord(doc.getRef());
        session.setRetainUntil(doc.getRef(), Fixtures.calendar(until), "Kept seven years");
        return session.getDocument(doc.getRef());
    }

    /** The retention module's own entry for a rule attached, as its {@code Retention.AttachRule} fires it. */
    protected void ruleAttached(DocumentModel doc, DocumentModel rule) {
        DocumentEventContext context = new DocumentEventContext(session, session.getPrincipal(), doc);
        context.setProperty("comment", rule.getId());
        Framework.getService(EventService.class).fireEvent(context.newEvent("retentionRuleAttached"));
    }

    /** The extended information of an entry, whichever platform wrote it. */
    protected static Map<String, Object> extended(LogEntry entry) {
        return AuditAccess.extended(entry);
    }

    protected static Calendar at(Instant instant) {
        return Fixtures.calendar(instant);
    }

    protected static Serializable value(DocumentModel doc, String xpath) {
        return doc.getPropertyValue(xpath);
    }
}
