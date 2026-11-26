package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.records.Fixtures.commit;
import static org.nuxeo.agentic.records.Fixtures.daysAgo;
import static org.nuxeo.agentic.records.Fixtures.decide;
import static org.nuxeo.agentic.records.Fixtures.refused;
import static org.nuxeo.agentic.records.Fixtures.start;
import static org.nuxeo.agentic.records.Physicals.CLERK;

import java.io.IOException;
import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import org.junit.Test;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;

/**
 * A physical record under the same retention and holds as an electronic one, disposed of by the same
 * run with the same two approvals: its destruction or its transfer recorded, on it, in its custody and
 * on the certificate, and nothing deleted but the run's electronic records, as before.
 */
public class PhysicalDispositionTest extends PhysicalTestCase {

    @Test
    public void aPhysicalRecordDueIsHeldInARunWithItsBarcodeAndWhatTheRunIsToDo() {
        DocumentModel box = Physicals.ended(session, "Box 1", rule, a1, daysAgo(10));
        DocumentModel file = Fixtures.ended(session, "Claim 1001", rule, daysAgo(9));
        commit(session);
        DocumentModel run = start(session, "alice");
        List<Map<String, Serializable>> records = Dispositions.records(session.getDocument(run.getRef()));
        assertEquals(2, records.size());
        Map<String, Serializable> physical = records.get(0);
        assertEquals(box.getId(), physical.get("uid"));
        assertEquals(Physicals.value(session, box, Physical.BARCODE), physical.get("barcode"));
        assertEquals(Physical.DESTROY, physical.get("disposal"));
        assertEquals(file.getId(), records.get(1).get("uid"));
        assertEquals(Physical.DELETE, records.get(1).get("disposal"));
        assertNull(records.get(1).get("barcode"));
    }

    @Test
    public void twoApprovalsRecordItsDestructionAndDeleteOnlyTheElectronicRecord() throws IOException {
        DocumentModel box = Physicals.ended(session, "Box 1", rule, a1, daysAgo(10));
        DocumentModel file = Fixtures.ended(session, "Claim 1001", rule, daysAgo(9));
        commit(session);
        String barcode = (String) Physicals.value(session, box, Physical.BARCODE);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);
        DocumentModel second = decide(session, "carol", run, Disposition.APPROVE);
        assertEquals(Disposition.DISPOSED, second.getPropertyValue(Disposition.REQUEST_OUTCOME));

        // The electronic record is deleted, as before; the physical one is kept, and says what became of it.
        assertTrue(!session.exists(file.getRef()));
        assertTrue(session.exists(box.getRef()));
        DocumentModel kept = session.getDocument(box.getRef());
        String certificateId = (String) Physicals.value(session, run, Disposition.RUN_CERTIFICATE);
        assertEquals(Physical.DESTROYED, kept.getPropertyValue(Physical.STATE));
        assertNotNull(kept.getPropertyValue(Physical.DISPOSED_AT));
        assertEquals(run.getId(), kept.getPropertyValue(Physical.DISPOSAL_RUN));
        assertEquals(certificateId, kept.getPropertyValue(Physical.DISPOSAL_CERTIFICATE));
        assertNull(kept.getPropertyValue(Physical.LOCATION));
        assertNull(kept.getPropertyValue(Physical.LOCATIONS));
        assertEquals(barcode, kept.getPropertyValue(Physical.BARCODE));

        // Its custody ends with it, by the approver whose approval disposed of the run, from where it was.
        List<Map<String, Serializable>> custody = Physicals.custody(session, box);
        Map<String, Serializable> last = custody.get(custody.size() - 1);
        assertEquals(Physical.DESTROYED, last.get("event"));
        assertEquals("carol", last.get("by"));
        assertEquals(A1_PATH, last.get("fromPath"));
        assertNull(last.get("toLocation"));
        assertTrue(String.valueOf(last.get("reason")).contains("approved by bob and carol"));
        assertTrue(String.valueOf(last.get("reason")).contains(certificateId));

        // The certificate says how each was disposed of, with the physical record's barcode.
        DocumentModel certificate = session.getDocument(new IdRef(certificateId));
        assertEquals("deleted, destroyed", certificate.getPropertyValue(Disposition.CERT_METHOD));
        List<Map<String, Serializable>> rows = Dispositions.copyList(certificate, Disposition.CERT_RECORDS);
        assertEquals(barcode, rows.get(0).get("barcode"));
        assertEquals(Physical.DESTROY, rows.get(0).get("disposal"));
        assertEquals(Physical.DELETE, rows.get(1).get("disposal"));
        String csv = ((Blob) certificate.getPropertyValue(Disposition.FILE_CONTENT)).getString();
        List<List<String>> lines = Fixtures.csvRows(new String(csv.getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8));
        int disposition = CertificateCsv.HEADER.indexOf("disposition");
        int barcodeColumn = CertificateCsv.HEADER.indexOf("barcode");
        assertEquals("destroyed", lines.get(1).get(disposition));
        assertEquals(barcode, lines.get(1).get(barcodeColumn));
        assertEquals("deleted", lines.get(2).get(disposition));
        assertEquals("", lines.get(2).get(barcodeColumn));
    }

    @Test
    public void aTransferIsRecordedWithWhoReceivedIt() {
        DocumentModel box = Physicals.ended(session, "Box 1", rule, a1, daysAgo(10));
        DocumentModel stored = session.getDocument(box.getRef());
        stored.setPropertyValue(Physical.DISPOSITION_ACTION, Physical.TRANSFER);
        stored.setPropertyValue(Physical.TRANSFER_TO, "The county archive");
        session.saveDocument(stored);
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);
        decide(session, "carol", run, Disposition.APPROVE);

        assertEquals(Physical.TRANSFERRED, Physicals.value(session, box, Physical.STATE));
        List<Map<String, Serializable>> custody = Physicals.custody(session, box);
        Map<String, Serializable> last = custody.get(custody.size() - 1);
        assertEquals(Physical.TRANSFERRED, last.get("event"));
        assertEquals("The county archive", last.get("transferredTo"));
        DocumentModel certificate = session.getDocument(
                new IdRef((String) Physicals.value(session, run, Disposition.RUN_CERTIFICATE)));
        assertEquals("transferred", certificate.getPropertyValue(Disposition.CERT_METHOD));
        assertEquals("The county archive",
                Dispositions.copyList(certificate, Disposition.CERT_RECORDS).get(0).get("transferTo"));
    }

    @Test
    public void underAHoldOrCheckedOutItIsNotDue() {
        DocumentModel held = Physicals.ended(session, "Box 1", rule, a1, daysAgo(10));
        session.setLegalHold(held.getRef(), true, "A dispute");
        DocumentModel lent = Physicals.ended(session, "Box 2", rule, b1, daysAgo(10));
        commit(session);
        Physicals.checkOut(session, CLERK, lent, "grace", Duration.ofDays(5), "For the audit");
        assertEquals("nothing-due", refused(() -> start(session, "alice")));
        Physicals.giveBack(session, CLERK, lent, null, "Back on its shelf");
        DocumentModel run = start(session, "alice");
        assertEquals(List.of(lent.getId()), uids(run));
    }

    @Test
    public void checkedOutAfterTheStartItHaltsTheRunAndNothingIsDisposedOf() {
        DocumentModel box = Physicals.ended(session, "Box 1", rule, a1, daysAgo(10));
        DocumentModel file = Fixtures.ended(session, "Claim 1001", rule, daysAgo(9));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);
        Physicals.checkOut(session, CLERK, box, "grace", Duration.ofDays(5), "Needed after all");
        DocumentModel second = decide(session, "carol", run, Disposition.APPROVE);

        assertEquals(Disposition.HALTED, second.getPropertyValue(Disposition.REQUEST_OUTCOME));
        assertTrue(session.exists(file.getRef()));
        assertEquals(Physical.OUT, Physicals.value(session, box, Physical.STATE));
        assertEquals(0, certificates());
        Map<String, Serializable> refusedRow = Dispositions.records(session.getDocument(run.getRef())).get(0);
        assertEquals(Disposition.REFUSED, refusedRow.get("status"));
        assertTrue(String.valueOf(refusedRow.get("reason")).contains("checked out"));
    }

    @Test
    public void anotherDispositionActionSinceTheStartHaltsTheRun() {
        DocumentModel box = Physicals.ended(session, "Box 1", rule, a1, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);
        DocumentModel stored = session.getDocument(box.getRef());
        stored.setPropertyValue(Physical.DISPOSITION_ACTION, Physical.TRANSFER);
        stored.setPropertyValue(Physical.TRANSFER_TO, "The county archive");
        session.saveDocument(stored);
        commit(session);
        DocumentModel second = decide(session, "carol", run, Disposition.APPROVE);
        assertEquals(Disposition.HALTED, second.getPropertyValue(Disposition.REQUEST_OUTCOME));
        assertEquals(Physical.IN, Physicals.value(session, box, Physical.STATE));
        assertTrue(String.valueOf(Dispositions.records(session.getDocument(run.getRef())).get(0).get("reason"))
                         .contains("another disposition action"));
    }

    @Test
    public void disposedOfItIsInNoOtherRunTakesNoCustodyAndKeepsWhatBecameOfIt() {
        DocumentModel box = Physicals.ended(session, "Box 1", rule, a1, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);
        decide(session, "carol", run, Disposition.APPROVE);
        assertEquals(Physical.DESTROYED, Physicals.value(session, box, Physical.STATE));

        assertEquals("nothing-due", refused(() -> start(session, "alice")));
        // Not even a candidate, so that the records disposed of never fill a start's scan; and were it
        // one, the check of each candidate says why it is not due.
        DocumentModel electronic = Fixtures.ended(session, "Claim 1001", rule, daysAgo(20));
        commit(session);
        List<String> candidates = new java.util.ArrayList<>();
        for (DocumentModel candidate : session.query(DueRecords.candidates(java.time.Instant.now()))) {
            candidates.add(candidate.getId());
        }
        assertEquals(List.of(electronic.getId()), candidates);
        assertEquals("has been disposed of already", PhysicalRecords.whyNotDue(session.getDocument(box.getRef())));
        assertEquals("disposed", refused(() -> Physicals.checkOut(session, CLERK, box, null, Duration.ofDays(1), "After")));
        assertEquals("disposed", refused(() -> Physicals.move(session, CLERK, box, b1, "After")));
        DocumentModel stored = session.getDocument(box.getRef());
        stored.setPropertyValue(Physical.DISPOSITION_ACTION, Physical.TRANSFER);
        stored.setPropertyValue(Physical.TRANSFER_TO, "Too late");
        assertEquals("disposed", refused(() -> session.saveDocument(stored)));
        // Its location now holds no record, and can go.
        assertTrue(!PhysicalRecords.holdsRecords(session, a1.getId()));
    }
}
