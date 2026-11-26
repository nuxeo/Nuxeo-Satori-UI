package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.records.Fixtures.daysAgo;
import static org.nuxeo.agentic.records.Fixtures.ended;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import javax.ws.rs.core.MediaType;

import org.junit.Test;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.impl.DocumentModelListImpl;
import org.nuxeo.ecm.core.io.download.DownloadService;
import org.nuxeo.ecm.core.io.marshallers.json.document.DocumentModelJsonWriter;
import org.nuxeo.ecm.core.io.registry.MarshallerRegistry;
import org.nuxeo.ecm.core.io.registry.Writer;
import org.nuxeo.ecm.core.io.registry.context.RenderingContext;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.api.login.NuxeoLoginContext;

/** Access logging: a record's reads in the audit, with who, when and what, and nothing else's. */
public class AccessLogTest extends RecordsAuditTestCase {

    private static final Instant LATER = Instant.now().plus(Duration.ofDays(3650));

    @Test
    public void aViewOfARecordUnderRetentionIsLoggedWithWhoWhenAndWhat() throws IOException {
        DocumentModel record = retained("Claim 2001", LATER);
        audited();
        Instant before = Instant.now();

        CoreSession dave = Fixtures.as(session, "dave");
        String json = answer(dave.getDocument(record.getRef()));
        assertTrue(json.contains("\"uid\":\"" + record.getId() + "\""));
        audited();

        List<LogEntry> views = entries(RecordsAudit.RECORD_VIEWED, record);
        assertEquals(1, views.size());
        LogEntry view = views.get(0);
        assertEquals("dave", view.getPrincipalName());
        assertEquals(record.getId(), view.getDocUUID());
        assertEquals(record.getPathAsString(), view.getDocPath());
        assertEquals("File", view.getDocType());
        assertEquals(RecordsAudit.CATEGORY, view.getCategory());
        assertTrue(!view.getEventDate().toInstant().isBefore(before.minusMillis(1)));
        Map<String, Object> extended = extended(view);
        assertEquals(LATER.truncatedTo(java.time.temporal.ChronoUnit.MILLIS).toString(),
                extended.get(RecordsAudit.RETAIN_UNTIL));
        assertEquals(Boolean.FALSE, extended.get(RecordsAudit.LEGAL_HOLD));
    }

    @Test
    public void aViewOfARecordUnderAHoldIsLogged() throws IOException {
        DocumentModel held = ended(session, "Claim 2002", rule, daysAgo(3));
        session.setLegalHold(held.getRef(), true, "A dispute");
        audited();

        answer(Fixtures.as(session, "dave").getDocument(held.getRef()));
        audited();

        List<LogEntry> views = entries(RecordsAudit.RECORD_VIEWED, held);
        assertEquals(1, views.size());
        assertEquals(Boolean.TRUE, extended(views.get(0)).get(RecordsAudit.LEGAL_HOLD));
    }

    /** Only records under retention or a hold: a document, or a record whose retention has ended, is not logged. */
    @Test
    public void aViewOfAnythingElseIsNotLogged() throws IOException {
        DocumentModel plain = session.createDocument(session.createDocumentModel(Fixtures.RECORDS, "plain", "File"));
        DocumentModel ended = ended(session, "Claim 2003", rule, daysAgo(3));
        audited();

        CoreSession dave = Fixtures.as(session, "dave");
        answer(dave.getDocument(plain.getRef()));
        answer(dave.getDocument(ended.getRef()));
        audited();

        assertEquals(List.of(), entries(RecordsAudit.RECORD_VIEWED, null));
    }

    /** A page of search results lists records, and does not view them: no entry for each. */
    @Test
    public void aRecordListedIsNotViewed() throws IOException {
        DocumentModel record = retained("Claim 2004", LATER);
        audited();

        CoreSession dave = Fixtures.as(session, "dave");
        String json = list(dave, new DocumentModelListImpl(List.of(dave.getDocument(record.getRef()))));
        assertTrue(json.contains(record.getId()));
        audited();

        assertEquals(List.of(), entries(RecordsAudit.RECORD_VIEWED, null));
    }

    /**
     * The server's own reads, in the background and for no one, are not logged. One it makes with its
     * own session for a person, as an operation reading a record privileged and returning it does, is
     * that person's view; an administrator's is logged as any other.
     */
    @Test
    public void theServersOwnReadsAreNotLoggedAndAReadForAPersonIs() throws Exception {
        DocumentModel record = retained("Claim 2005", LATER);
        audited();

        try (NuxeoLoginContext system = Framework.loginSystem()) {
            CoreInstance.doPrivileged(session.getRepositoryName(), (CoreSession privileged) -> {
                try {
                    answer(privileged.getDocument(record.getRef()));
                } catch (IOException e) {
                    throw new IllegalStateException(e);
                }
            });
        }
        audited();
        assertEquals(List.of(), entries(RecordsAudit.RECORD_VIEWED, record));

        // The test runs as an administrator: a privileged read made while answering them is theirs.
        CoreInstance.doPrivileged(session, (CoreSession privileged) -> {
            try {
                answer(privileged.getDocument(record.getRef()));
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        });
        answer(session.getDocument(record.getRef()));
        audited();
        List<LogEntry> views = entries(RecordsAudit.RECORD_VIEWED, record);
        assertEquals(2, views.size());
        for (LogEntry view : views) {
            assertEquals(session.getPrincipal().getName(), view.getPrincipalName());
        }
    }

    /** A view is logged once the read's transaction commits: a rolled-back one logs nothing. */
    @Test
    public void aReadRolledBackLogsNothing() throws IOException {
        DocumentModel record = retained("Claim 2006", LATER);
        audited();

        answer(Fixtures.as(session, "dave").getDocument(record.getRef()));
        Fixtures.rollback();
        audited();

        assertEquals(List.of(), entries(RecordsAudit.RECORD_VIEWED, record));
    }

    /** A download is the platform's own entry, which says who, when and which file, record or not. */
    @Test
    public void aDownloadIsThePlatformsOwnEntry() {
        DocumentModel record = retained("Claim 2007", LATER);
        audited();

        DocumentModel read = Fixtures.as(session, "dave").getDocument(record.getRef());
        Framework.getService(DownloadService.class).logDownload(null, read, "file:content", "claim-2007.pdf", "download",
                null);
        audited();

        List<LogEntry> downloads = entries("download", record);
        assertEquals(1, downloads.size());
        assertEquals("dave", downloads.get(0).getPrincipalName());
        Map<String, Object> extended = extended(downloads.get(0));
        assertEquals("download", extended.get(RecordsAudit.DOWNLOAD_REASON));
        assertEquals("file:content", extended.get(RecordsAudit.BLOB_XPATH));
        assertEquals("claim-2007.pdf", extended.get(RecordsAudit.BLOB_FILENAME));
        assertEquals("No view of it is logged beside it", List.of(), entries(RecordsAudit.RECORD_VIEWED, record));
    }

    /** The REST API's writer for a document is the add-on's, and writes what the platform's writes. */
    @Test
    public void theAddOnsWriterIsTheOneTheRegistryPicksAndWritesThePlatformsJson() throws IOException {
        DocumentModel doc = session.createDocument(session.createDocumentModel(Fixtures.RECORDS, "same", "File"));
        RenderingContext ctx = RenderingContext.CtxBuilder.session(session).properties("*").get();
        Writer<DocumentModel> writer = Framework.getService(MarshallerRegistry.class)
                                                .getWriter(ctx, DocumentModel.class, MediaType.APPLICATION_JSON_TYPE);
        assertNotNull(writer);
        assertEquals(RecordViewJsonWriter.class, writer.getClass());

        String ours = answer(doc);
        DocumentModelJsonWriter platform = Framework.getService(MarshallerRegistry.class)
                                                    .getInstance(ctx, DocumentModelJsonWriter.class);
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        platform.write(doc, DocumentModel.class, DocumentModel.class, MediaType.APPLICATION_JSON_TYPE, out);
        assertEquals(out.toString(java.nio.charset.StandardCharsets.UTF_8), ours);
    }
}
