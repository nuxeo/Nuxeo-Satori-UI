package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.records.Fixtures.daysAgo;
import static org.nuxeo.agentic.records.Fixtures.decide;
import static org.nuxeo.agentic.records.Fixtures.start;
import static org.nuxeo.agentic.records.Physicals.CLERK;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.Before;
import org.junit.Test;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.platform.audit.api.LogEntry;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * A physical record's custody in the platform's audit, as entries of the add-on's own kind,
 * {@code custody}: registered, moved, checked out and returned, each with who, from where to where,
 * when and why; and in the audit export, with its columns. A record destroyed by a run is there too,
 * as a disposition, its record kept.
 */
public class CustodyAuditTest extends RecordsAuditTestCase {

    private static final ObjectMapper JSON = new ObjectMapper();

    private DocumentModel a1;

    private DocumentModel b1;

    @Before
    public void setUpRecordsCentre() {
        Physicals.desk(session);
        DocumentModel locations = Physicals.locationsFolder(session);
        DocumentModel site = Physicals.location(session, locations, "Northfield", "site");
        DocumentModel room = Physicals.location(session, site, "Room 1", "room");
        a1 = Physicals.location(session, Physicals.location(session, room, "Shelf A", "shelf"), "Position 1", "position");
        b1 = Physicals.location(session, Physicals.location(session, room, "Shelf B", "shelf"), "Position 1", "position");
        audited();
    }

    @Test
    public void eachMoveCheckOutAndReturnIsAnAuditEntryOfItsOwnKind() {
        DocumentModel box = Physicals.item(session, "Box 1", a1);
        audited();
        String barcode = (String) Physicals.value(session, box, Physical.BARCODE);
        Physicals.move(session, CLERK, box, b1, "Shelf A is full");
        Physicals.checkOut(session, CLERK, box, "grace", Duration.ofDays(7), "For the audit");
        Physicals.giveBack(session, Physicals.OTHER_CLERK, box, null, "The audit is done");
        audited();

        LogEntry registered = only(RecordsAudit.CUSTODY_REGISTERED, box);
        assertEquals(session.getPrincipal().getName(), registered.getPrincipalName());
        assertEquals(RecordsAudit.CATEGORY, registered.getCategory());
        assertEquals(barcode, extended(registered).get(RecordsAudit.BARCODE));
        assertEquals("Northfield / Room 1 / Shelf A / Position 1", extended(registered).get(RecordsAudit.TO_PATH));

        LogEntry moved = only(RecordsAudit.CUSTODY_MOVED, box);
        assertEquals(CLERK, moved.getPrincipalName());
        assertEquals("Shelf A is full", moved.getComment());
        assertEquals("Northfield / Room 1 / Shelf A / Position 1", extended(moved).get(RecordsAudit.FROM_PATH));
        assertEquals("Northfield / Room 1 / Shelf B / Position 1", extended(moved).get(RecordsAudit.TO_PATH));
        assertEquals(a1.getId(), extended(moved).get(RecordsAudit.FROM_LOCATION));
        assertEquals(b1.getId(), extended(moved).get(RecordsAudit.TO_LOCATION));

        LogEntry out = only(RecordsAudit.CUSTODY_CHECKED_OUT, box);
        assertEquals("grace", extended(out).get(RecordsAudit.BORROWER));
        assertTrue(Instant.parse(String.valueOf(extended(out).get(RecordsAudit.DUE_BACK)))
                          .isAfter(Instant.now().plus(Duration.ofDays(6))));
        assertEquals("For the audit", out.getComment());

        LogEntry back = only(RecordsAudit.CUSTODY_RETURNED, box);
        assertEquals(Physicals.OTHER_CLERK, back.getPrincipalName());
        assertEquals("grace", extended(back).get(RecordsAudit.BORROWER));
        assertEquals("Northfield / Room 1 / Shelf B / Position 1", extended(back).get(RecordsAudit.TO_PATH));
        assertEquals(RecordsAudit.KIND_CUSTODY, RecordsAudit.kind(RecordsAudit.CUSTODY_RETURNED));
    }

    @Test
    public void aRefusedRequestRecordsNothing() {
        DocumentModel box = Physicals.item(session, "Box 1", a1);
        audited();
        Fixtures.refused(() -> Physicals.move(session, "dave", box, b1, "Not mine to move"));
        Physicals.checkOut(session, CLERK, box, "grace", Duration.ofDays(7), "For the audit");
        Fixtures.refused(() -> Physicals.checkOut(session, CLERK, box, "erin", Duration.ofDays(7), "Again"));
        audited();
        assertEquals(0, entries(RecordsAudit.CUSTODY_MOVED, box).size());
        assertEquals(1, entries(RecordsAudit.CUSTODY_CHECKED_OUT, box).size());
    }

    @Test
    public void theAuditExportCarriesTheCustodyAndTheDestructionWithTheirColumns() throws IOException, InterruptedException {
        Thread.sleep(5);
        Instant from = Instant.now();
        Thread.sleep(5);
        DocumentModel box = Physicals.ended(session, "Box 1", rule, a1, daysAgo(10));
        audited();
        String barcode = (String) Physicals.value(session, box, Physical.BARCODE);
        Physicals.move(session, CLERK, box, b1, "Shelf A is full");
        Physicals.checkOut(session, CLERK, box, "grace", Duration.ofDays(7), "For the audit");
        Physicals.giveBack(session, CLERK, box, null, "The audit is done");
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);
        decide(session, "carol", run, Disposition.APPROVE);
        audited();
        Thread.sleep(5);
        Instant to = Instant.now();
        Thread.sleep(5);

        DocumentModel export = Fixtures.export(session, "grace", Fixtures.RECORDS, at(from), at(to));
        audited();
        export = session.getDocument(export.getRef());
        assertEquals(Disposition.EXPORT_DONE, export.getPropertyValue(Disposition.EXPORT_STATE));

        List<Map<String, String>> rows = csv(export);
        List<Map<String, String>> custody = new ArrayList<>();
        for (Map<String, String> row : rows) {
            if (box.getId().equals(row.get("record_uid")) && RecordsAudit.KIND_CUSTODY.equals(row.get("kind"))) {
                custody.add(row);
            }
        }
        assertEquals(List.of(RecordsAudit.CUSTODY_REGISTERED, RecordsAudit.CUSTODY_MOVED, RecordsAudit.CUSTODY_CHECKED_OUT,
                RecordsAudit.CUSTODY_RETURNED), custody.stream().map(row -> row.get("event")).toList());
        Map<String, String> moved = custody.get(1);
        assertEquals("Moved", moved.get("what"));
        assertEquals(CLERK, moved.get("user"));
        assertEquals(barcode, moved.get("barcode"));
        assertEquals("Northfield / Room 1 / Shelf A / Position 1", moved.get("custody_from"));
        assertEquals("Northfield / Room 1 / Shelf B / Position 1", moved.get("custody_to"));
        assertEquals("Shelf A is full", moved.get("comment"));
        Map<String, String> out = custody.get(2);
        assertEquals("grace", out.get("borrower"));
        assertTrue(Instant.parse(out.get("due_back")).isAfter(Instant.now().plus(Duration.ofDays(6))));
        assertEquals("", out.get("custody_to"));
        // Ids stay in the rest of the entry's information.
        assertTrue(moved.get("extended"), moved.get("extended").contains(b1.getId()));

        Map<String, String> destroyed = null;
        for (Map<String, String> row : rows) {
            if (RecordsAudit.RECORD_DESTROYED.equals(row.get("event"))) {
                destroyed = row;
            }
        }
        assertTrue("its destruction is in the export", destroyed != null);
        assertEquals(RecordsAudit.KIND_DISPOSITION, destroyed.get("kind"));
        assertEquals("Disposed of: destroyed, its record kept", destroyed.get("what"));
        assertEquals("carol", destroyed.get("user"));
        assertEquals(barcode, destroyed.get("barcode"));
        // From where it was kept when it was destroyed: returned to its place on shelf B.
        assertEquals("Northfield / Room 1 / Shelf B / Position 1", destroyed.get("custody_from"));
        assertEquals(String.valueOf(Physicals.value(session, run, Disposition.RUN_CERTIFICATE)),
                destroyed.get("certificate_uid"));
        assertEquals("yes", destroyed.get("record_exists"));

        // The JSON file says the same, under the format's new version.
        JsonNode json;
        try (InputStream in = ((Blob) export.getPropertyValue(Disposition.FILES + "/0/file")).getStream()) {
            json = JSON.readTree(in);
        }
        assertEquals(2, json.get("export").get("format").asInt());
        boolean found = false;
        for (JsonNode entry : json.get("entries")) {
            if (RecordsAudit.CUSTODY_CHECKED_OUT.equals(entry.get("event").asText())) {
                assertEquals("grace", entry.get("borrower").asText());
                assertEquals(barcode, entry.get("barcode").asText());
                found = true;
            }
        }
        assertTrue(found);
        assertTrue(session.exists(new PathRef(box.getPathAsString())));
    }

    private static LogEntry only(String event, DocumentModel doc) {
        List<LogEntry> found = entries(event, doc);
        assertEquals(event, 1, found.size());
        return found.get(0);
    }

    private static List<Map<String, String>> csv(DocumentModel export) throws IOException {
        Blob blob = (Blob) export.getPropertyValue(Disposition.FILE_CONTENT);
        List<List<String>> table = Fixtures.csvRows(new String(blob.getByteArray(), StandardCharsets.UTF_8));
        List<String> columns = table.get(0);
        assertEquals(AuditExportFiles.COLUMNS, columns);
        List<Map<String, String>> rows = new ArrayList<>();
        for (List<String> fields : table.subList(1, table.size())) {
            Map<String, String> row = new LinkedHashMap<>();
            for (int index = 0; index < columns.size(); index++) {
                row.put(columns.get(index), fields.get(index));
            }
            rows.add(row);
        }
        return rows;
    }
}
