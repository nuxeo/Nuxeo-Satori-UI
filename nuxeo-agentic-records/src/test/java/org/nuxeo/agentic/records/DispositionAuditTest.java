package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.records.Fixtures.daysAgo;
import static org.nuxeo.agentic.records.Fixtures.decide;
import static org.nuxeo.agentic.records.Fixtures.ended;
import static org.nuxeo.agentic.records.Fixtures.refused;
import static org.nuxeo.agentic.records.Fixtures.start;

import java.util.List;
import java.util.Map;

import org.junit.Test;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.platform.audit.api.LogEntry;

/** A disposition run's decisions in each record's history: which run, who, and what came of it. */
public class DispositionAuditTest extends RecordsAuditTestCase {

    @Test
    public void aRunDisposedOfIsInEachRecordsHistory() {
        DocumentModel one = ended(session, "Claim 6001", rule, daysAgo(10));
        DocumentModel two = ended(session, "Claim 6002", rule, daysAgo(9));
        String onePath = one.getPathAsString();
        Fixtures.commit(session);

        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);
        decide(session, "carol", run, Disposition.APPROVE);
        audited();
        DocumentModel stored = session.getDocument(run.getRef());

        for (DocumentModel record : List.of(one, two)) {
            List<LogEntry> started = entries(RecordsAudit.RUN_STARTED, record);
            assertEquals(1, started.size());
            assertEquals("alice", started.get(0).getPrincipalName());
            assertEquals(RecordsAudit.CATEGORY, started.get(0).getCategory());
            assertEquals(1L, extended(started.get(0)).get(RecordsAudit.RUN_NUMBER));
            assertEquals(run.getId(), extended(started.get(0)).get(RecordsAudit.RUN_UID));

            List<LogEntry> approved = entries(RecordsAudit.RUN_APPROVED, record);
            assertEquals(2, approved.size());
            assertEquals("bob", approved.get(0).getPrincipalName());
            assertEquals(1L, extended(approved.get(0)).get(RecordsAudit.APPROVAL));
            assertEquals("carol", approved.get(1).getPrincipalName());
            assertEquals(2L, extended(approved.get(1)).get(RecordsAudit.APPROVAL));

            List<LogEntry> disposed = entries(RecordsAudit.RECORD_DISPOSED, record);
            assertEquals(1, disposed.size());
            LogEntry entry = disposed.get(0);
            assertEquals("carol", entry.getPrincipalName());
            assertEquals("File", entry.getDocType());
            Map<String, Object> extended = extended(entry);
            assertEquals(stored.getPropertyValue(Disposition.RUN_CERTIFICATE), extended.get(RecordsAudit.CERTIFICATE_UID));
            assertEquals(stored.getPropertyValue(Disposition.RUN_CERTIFICATE_SHA256),
                    extended.get(RecordsAudit.CERTIFICATE_SHA256));
            assertEquals("alice", extended.get(RecordsAudit.STARTED_BY));
            assertEquals("bob, carol", extended.get(RecordsAudit.APPROVED_BY));
            assertTrue(entry.getComment(), entry.getComment().contains("run 1"));

            // The platform's own deletion beside it, by the add-on's session.
            assertEquals(1, entries("documentRemoved", record).size());
        }
        assertEquals("the entry names the record as the run kept it, though it is gone", onePath,
                entries(RecordsAudit.RECORD_DISPOSED, one).get(0).getDocPath());
    }

    @Test
    public void aRunRejectedOrHaltedIsInEachRecordsHistoryAndARefusalIsNot() {
        DocumentModel record = ended(session, "Claim 6003", rule, daysAgo(10));
        Fixtures.commit(session);
        DocumentModel rejected = start(session, "alice");
        decide(session, "bob", rejected, Disposition.APPROVE);
        assertEquals("already-approved", refused(() -> decide(session, "bob", rejected, Disposition.APPROVE)));
        decide(session, "carol", rejected, Disposition.REJECT);
        audited();

        List<LogEntry> entries = entries(RecordsAudit.RUN_REJECTED, record);
        assertEquals(1, entries.size());
        assertEquals("carol", entries.get(0).getPrincipalName());
        assertTrue(entries.get(0).getComment(), entries.get(0).getComment().contains("kept"));
        assertEquals("a refused approval records nothing", 1, entries(RecordsAudit.RUN_APPROVED, record).size());

        DocumentModel halted = start(session, "alice");
        decide(session, "bob", halted, Disposition.APPROVE);
        session.setLegalHold(record.getRef(), true, "A dispute");
        Fixtures.commit(session);
        decide(session, "carol", halted, Disposition.APPROVE);
        Fixtures.assertState(session, halted, Disposition.HALTED);
        audited();

        List<LogEntry> halts = entries(RecordsAudit.RUN_HALTED, record);
        assertEquals(1, halts.size());
        assertEquals("carol", halts.get(0).getPrincipalName());
        assertEquals(Disposition.REFUSED, extended(halts.get(0)).get(RecordsAudit.STATUS));
        assertTrue(String.valueOf(extended(halts.get(0)).get(RecordsAudit.REASON)).contains("legal hold"));
        assertEquals(List.of(), entries(RecordsAudit.RECORD_DISPOSED, record));
        assertEquals(2, entries(RecordsAudit.RUN_STARTED, record).size());
        // A refusal costs the platform's own audit nothing: the hold placed after it, in the same
        // thread, is there.
        assertEquals(1, entries("afterSetLegalHold", record).size());
    }
}
