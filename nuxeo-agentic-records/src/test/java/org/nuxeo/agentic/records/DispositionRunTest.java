package org.nuxeo.agentic.records;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.records.Fixtures.commit;
import static org.nuxeo.agentic.records.Fixtures.daysAgo;
import static org.nuxeo.agentic.records.Fixtures.decide;
import static org.nuxeo.agentic.records.Fixtures.ended;
import static org.nuxeo.agentic.records.Fixtures.start;

import java.io.IOException;
import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Calendar;
import java.util.List;
import java.util.Map;

import org.junit.Test;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.impl.ACLImpl;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;
import org.nuxeo.ecm.core.api.trash.TrashService;
import org.nuxeo.ecm.core.bulk.BulkService;
import org.nuxeo.ecm.core.event.EventService;
import org.nuxeo.ecm.core.event.impl.EventContextImpl;
import org.nuxeo.runtime.api.Framework;

/** A run from start to certificate: which records it holds, and what two approvals do. */
public class DispositionRunTest extends DispositionTestCase {

    @Test
    public void aRunHoldsTheRecordsDueAndNoOthers() {
        DocumentModel older = ended(session, "Claim 1001", rule, daysAgo(10));
        DocumentModel newer = ended(session, "Claim 1002", rule, daysAgo(5));

        DocumentModel held = ended(session, "Claim 1003", rule, daysAgo(9));
        session.setLegalHold(held.getRef(), true, "A dispute");

        DocumentModel retained = ended(session, "Claim 1004", rule, daysAgo(8));
        Calendar later = Fixtures.calendar(Instant.now().plus(Duration.ofDays(30)));
        session.setRetainUntil(retained.getRef(), later, "Extended");

        ended(session, "Claim 1005", rule, Instant.now().plus(Duration.ofDays(3)));

        DocumentModel deleting = Fixtures.rule(session, "Deletes itself", "Document.Delete");
        ended(session, "Claim 1006", deleting, daysAgo(7));

        DocumentModel notRecord = session.createDocumentModel(Fixtures.RECORDS, "not-a-record", "File");
        notRecord.addFacet(Disposition.RECORD_FACET);
        notRecord.setPropertyValue(Disposition.RECORD_RULE_IDS, new String[] { rule.getId() });
        notRecord.setPropertyValue(Disposition.RECORD_RETAIN_UNTIL, Fixtures.calendar(daysAgo(6)));
        session.createDocument(notRecord);

        DocumentModel hidden = session.createDocument(session.createDocumentModel("/", "hidden", "Folder"));
        ACP blocked = new ACPImpl();
        ACL acl = new ACLImpl(ACL.LOCAL_ACL);
        acl.add(ACE.BLOCK);
        blocked.addACL(acl);
        session.setACP(hidden.getRef(), blocked, true);
        DocumentModel unreadable = session.createDocumentModel("/hidden", "unreadable", "File");
        unreadable.setPropertyValue("dc:title", "Claim 1007");
        unreadable = session.createDocument(unreadable);
        session.makeRecord(unreadable.getRef());
        unreadable = session.getDocument(unreadable.getRef());
        unreadable.addFacet(Disposition.RECORD_FACET);
        unreadable.setPropertyValue(Disposition.RECORD_RULE_IDS, new String[] { rule.getId() });
        unreadable.setPropertyValue(Disposition.RECORD_RETAIN_UNTIL, Fixtures.calendar(daysAgo(11)));
        session.saveDocument(unreadable);
        commit(session);

        DocumentModel run = start(session, "alice");

        assertEquals(Disposition.PENDING, run.getPropertyValue(Disposition.RUN_STATE));
        assertEquals(1L, run.getPropertyValue(Disposition.RUN_NUMBER));
        assertEquals("alice", run.getPropertyValue(Disposition.RUN_STARTED_BY));
        assertEquals("Disposition run 1", run.getTitle());
        assertEquals(2L, run.getPropertyValue(Disposition.RUN_RECORD_COUNT));
        // The oldest retention end first.
        assertEquals(List.of(older.getId(), newer.getId()), uids(run));
        Map<String, Serializable> first = Dispositions.records(run).get(0);
        assertEquals("Claim 1001", first.get("title"));
        assertEquals("/records/claim-1001", first.get("path"));
        assertEquals(rule.getId(), first.get("ruleId"));
        assertEquals("Claims seven years", first.get("ruleTitle"));
        assertEquals(Disposition.AWAITING, first.get("status"));
        assertTrue(approvers(run).isEmpty());
        assertEquals(1L, session.getDocument(folder.getRef()).getPropertyValue(Disposition.SEQUENCE));
        assertEquals(folder.getRef(), run.getParentRef());
    }

    @Test
    public void whatTheFilerWritesBesidesTheRequestIsReplacedByTheServers() {
        DocumentModel record = ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        var alice = Fixtures.as(session, "alice");
        DocumentModel forged = alice.createDocumentModel(Fixtures.RUNS, "start", Disposition.REQUEST_TYPE);
        forged.setPropertyValue(Disposition.REQUEST_ACTION, Disposition.START);
        forged.setPropertyValue(Disposition.REQUEST_OUTCOME, Disposition.DISPOSED);
        forged.setPropertyValue(Disposition.REQUEST_BY, "somebody");
        forged.setPropertyValue(Disposition.REQUEST_RUN_NUMBER, 99L);
        DocumentModel request = alice.createDocument(forged);
        commit(alice);

        request = session.getDocument(request.getRef());
        assertEquals(Disposition.STARTED, request.getPropertyValue(Disposition.REQUEST_OUTCOME));
        assertEquals("alice", request.getPropertyValue(Disposition.REQUEST_BY));
        assertEquals(1L, request.getPropertyValue(Disposition.REQUEST_RUN_NUMBER));
        assertEquals("Start of disposition run 1 by alice", request.getTitle());
        DocumentModel run = session.getDocument(new IdRef((String) request.getPropertyValue(Disposition.REQUEST_RUN)));
        assertEquals(List.of(record.getId()), uids(run));
    }

    @Test
    public void twoApprovalsDisposeOfTheRecordsAndWriteACertificate() throws IOException {
        DocumentModel first = ended(session, "Claim 1001", rule, daysAgo(10));
        DocumentModel second = ended(session, "Claim 1002", rule, daysAgo(5));
        commit(session);
        DocumentModel run = start(session, "alice");

        DocumentModel approval = decide(session, "bob", run, Disposition.APPROVE);
        assertEquals(Disposition.APPROVED, approval.getPropertyValue(Disposition.REQUEST_OUTCOME));
        assertEquals("bob", approval.getPropertyValue(Disposition.REQUEST_BY));
        Fixtures.assertState(session, run, Disposition.PENDING);
        assertTrue(session.exists(first.getRef()));
        assertTrue(session.exists(second.getRef()));

        DocumentModel last = decide(session, "carol", run, Disposition.APPROVE);
        assertEquals(Disposition.DISPOSED, last.getPropertyValue(Disposition.REQUEST_OUTCOME));
        Fixtures.assertState(session, run, Disposition.DISPOSED);
        assertFalse(session.exists(first.getRef()));
        assertFalse(session.exists(second.getRef()));
        assertEquals(List.of("bob", "carol"), approvers(run));
        run = session.getDocument(run.getRef());
        assertEquals("carol", run.getPropertyValue(Disposition.RUN_CLOSED_BY));
        for (Map<String, Serializable> record : Dispositions.records(run)) {
            assertEquals(Disposition.DISPOSED, record.get("status"));
        }

        assertEquals(1, certificates());
        String certificateId = (String) run.getPropertyValue(Disposition.RUN_CERTIFICATE);
        DocumentModel certificate = session.getDocument(new IdRef(certificateId));
        assertEquals(Disposition.CERTIFICATE_TYPE, certificate.getType());
        assertEquals(folder.getRef(), certificate.getParentRef());
        assertEquals(run.getId(), certificate.getPropertyValue(Disposition.CERT_RUN));
        assertEquals(1L, certificate.getPropertyValue(Disposition.CERT_RUN_NUMBER));
        assertEquals("alice", certificate.getPropertyValue(Disposition.CERT_STARTED_BY));
        assertEquals(Disposition.METHOD, certificate.getPropertyValue(Disposition.CERT_METHOD));
        assertEquals(2L, certificate.getPropertyValue(Disposition.CERT_RECORD_COUNT));
        assertNotNull(certificate.getPropertyValue(Disposition.CERT_DISPOSED_AT));
        assertTrue("The certificate is a record: its CSV cannot be replaced", certificate.isRecord());

        Blob csv = (Blob) certificate.getPropertyValue(Disposition.FILE_CONTENT);
        assertEquals("text/csv", csv.getMimeType());
        assertEquals("disposition-certificate-1.csv", csv.getFilename());
        byte[] bytes = csv.getByteArray();
        assertEquals(certificate.getPropertyValue(Disposition.CERT_SHA256), CertificateCsv.sha256(bytes));
        assertEquals(run.getPropertyValue(Disposition.RUN_CERTIFICATE_SHA256), CertificateCsv.sha256(bytes));
        assertArrayEquals(CertificateCsv.BOM, Arrays.copyOf(bytes, 3));
        String[] lines = new String(bytes, 3, bytes.length - 3, StandardCharsets.UTF_8).split("\r\n");
        assertEquals(3, lines.length);
        assertTrue(lines[0].startsWith("\"run_number\",\"run_started_by\""));
        assertTrue(lines[1], lines[1].contains("\"" + first.getId() + "\",\"/records/claim-1001\",\"Claim 1001\",\"File\""));
        assertTrue(lines[1], lines[1].startsWith("\"1\",\"alice\","));
        assertTrue(lines[1], lines[1].contains("\"bob\""));
        assertTrue(lines[1], lines[1].contains("\"carol\""));
        assertTrue(lines[1], lines[1].contains("\"Claims seven years\""));
        assertTrue(lines[2], lines[2].contains("\"" + second.getId() + "\""));

        List<Map<String, Serializable>> listed = Dispositions.copyList(certificate, Disposition.CERT_RECORDS);
        assertEquals(first.getId(), listed.get(0).get("uid"));
        assertEquals(rule.getId(), listed.get(0).get("ruleId"));
        assertNotNull(listed.get(0).get("retentionEnded"));
    }

    /** A certificate is a record, and given the module's facet and a past retention end it would look due: it never is. */
    @Test
    public void noneOfTheReviewsOwnDocumentsIsEverDue() {
        ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);
        decide(session, "carol", run, Disposition.APPROVE);
        DocumentModel certificate = session.getDocument(
                new IdRef((String) session.getDocument(run.getRef()).getPropertyValue(Disposition.RUN_CERTIFICATE)));
        certificate.addFacet(Disposition.RECORD_FACET);
        certificate.setPropertyValue(Disposition.RECORD_RULE_IDS, new String[] { rule.getId() });
        certificate.setPropertyValue(Disposition.RECORD_RETAIN_UNTIL, Fixtures.calendar(daysAgo(1)));
        session.saveDocument(certificate);
        commit(session);
        assertEquals("nothing-due", Fixtures.refused(() -> start(session, "alice")));
        assertTrue(session.exists(certificate.getRef()));
    }

    /** Deleting a folder deletes what it holds, which no run reviewed: a folder is never due. */
    @Test
    public void aFolderIsNeverDue() {
        DocumentModel holder = session.createDocumentModel(Fixtures.RECORDS, "box-17", "Folder");
        holder.setPropertyValue("dc:title", "Box 17");
        holder = session.createDocument(holder);
        session.createDocument(session.createDocumentModel(holder.getPathAsString(), "inside", "File"));
        session.makeRecord(holder.getRef());
        holder = session.getDocument(holder.getRef());
        holder.addFacet(Disposition.RECORD_FACET);
        holder.setPropertyValue(Disposition.RECORD_RULE_IDS, new String[] { rule.getId() });
        holder.setPropertyValue(Disposition.RECORD_RETAIN_UNTIL, Fixtures.calendar(daysAgo(10)));
        session.saveDocument(holder);
        commit(session);
        assertEquals("nothing-due", Fixtures.refused(() -> start(session, "alice")));
    }

    /** The trash is not a disposition: a record in it is due as any other, and is reviewed. */
    @Test
    public void aRecordInTheTrashIsStillDue() {
        DocumentModel record = ended(session, "Claim 1001", rule, daysAgo(10));
        Framework.getService(TrashService.class).trashDocument(record);
        commit(session);
        assertTrue(session.getDocument(record.getRef()).isTrashed());
        DocumentModel run = start(session, "alice");
        assertEquals(List.of(record.getId()), uids(run));
    }

    @Test
    public void aRejectionKeepsTheRecordsForAnotherRun() {
        DocumentModel record = ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");

        DocumentModel rejection = decide(session, "bob", run, Disposition.REJECT);
        assertEquals(Disposition.REJECTED, rejection.getPropertyValue(Disposition.REQUEST_OUTCOME));
        Fixtures.assertState(session, run, Disposition.REJECTED);
        assertTrue(session.exists(record.getRef()));

        DocumentModel next = start(session, "alice");
        assertEquals(2L, next.getPropertyValue(Disposition.RUN_NUMBER));
        assertEquals(List.of(record.getId()), uids(next));
    }

    @Test
    public void theStarterMayWithdrawARunByRejectingIt() {
        ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "alice", run, Disposition.REJECT);
        Fixtures.assertState(session, run, Disposition.REJECTED);
    }

    /**
     * The platform's own path to "retention ended": the repository's hourly check ends a record's
     * retention and clears it, and the module saves the day it ended. The record is then due.
     */
    @Test
    public void aRecordWhoseRetentionThePlatformEndedIsDue() throws InterruptedException {
        DocumentModel record = session.createDocumentModel(Fixtures.RECORDS, "claim-2001", "File");
        record.setPropertyValue("dc:title", "Claim 2001");
        record = session.createDocument(record);
        session.makeRecord(record.getRef());
        record = session.getDocument(record.getRef());
        record.addFacet(Disposition.RECORD_FACET);
        record.setPropertyValue(Disposition.RECORD_RULE_IDS, new String[] { rule.getId() });
        record = session.saveDocument(record);
        Calendar until = Fixtures.calendar(Instant.now().plusMillis(1500));
        session.setRetainUntil(record.getRef(), until, "Seven years, in this test's seconds");
        commit(session);
        assertEquals("nothing-due", Fixtures.refused(() -> start(session, "alice")));

        Thread.sleep(2000);
        Framework.getService(EventService.class).fireEvent("findRetentionExpired", new EventContextImpl());
        coreFeature.waitForAsyncCompletion();
        assertTrue(Framework.getService(BulkService.class).await(Duration.ofSeconds(30)));
        commit(session);
        record = session.getDocument(record.getRef());
        assertNull("The platform ended the retention", record.getRetainUntil());
        assertFalse(record.isUnderRetentionOrLegalHold());

        // What the module's retentionExpired listener does: save the day the retention ended.
        record.setPropertyValue(Disposition.RECORD_RETAIN_UNTIL, until);
        session.saveDocument(record);
        commit(session);

        DocumentModel run = start(session, "alice");
        assertEquals(List.of(record.getId()), uids(run));
    }
}
