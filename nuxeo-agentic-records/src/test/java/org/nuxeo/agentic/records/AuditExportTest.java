package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;
import static org.nuxeo.agentic.records.Fixtures.daysAgo;
import static org.nuxeo.agentic.records.Fixtures.decide;
import static org.nuxeo.agentic.records.Fixtures.ended;
import static org.nuxeo.agentic.records.Fixtures.refused;
import static org.nuxeo.agentic.records.Fixtures.start;

import java.io.IOException;
import java.io.InputStream;
import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.Test;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.core.api.security.impl.ACLImpl;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;
import org.nuxeo.ecm.core.io.download.DownloadService;
import org.nuxeo.ecm.platform.audit.api.AuditLogger;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.runtime.api.Framework;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** The audit export: refused without its permission, what it holds for a seeded period, and its checksums. */
public class AuditExportTest extends RecordsAuditTestCase {

    private static final ObjectMapper JSON = new ObjectMapper();

    // --- Refused ------------------------------------------------------------------------------------

    @Test
    public void anExportIsRefusedWithoutThePermission() {
        Calendar from = at(daysAgo(1));
        Calendar to = at(Instant.now().plus(Duration.ofDays(1)));
        for (String name : List.of("dave", "alice", "bob")) {
            assertEquals(name, "permission", refused(() -> Fixtures.export(session, name, Fixtures.RECORDS, from, to)));
        }
        assertEquals(0, exports());
        // Neither may anyone holding the permission through the folder's inheritance alone, as Everything.
        assertEquals("grace may", Disposition.EXPORT_DONE,
                value(waited(Fixtures.export(session, "grace", Fixtures.RECORDS, from, to)), Disposition.EXPORT_STATE));
    }

    @Test
    public void anExportIsRefusedWhatItCannotCover() {
        Calendar from = at(daysAgo(1));
        Calendar to = at(Instant.now().plus(Duration.ofDays(1)));
        assertEquals("bad-request", refused(() -> Fixtures.export(session, "grace", Fixtures.RECORDS, to, from)));
        assertEquals("bad-request", refused(() -> Fixtures.export(session, "grace", Fixtures.RECORDS, from, null)));
        assertEquals("bad-request", refused(() -> Fixtures.export(session, "grace", "/", from, to)));
        assertEquals("bad-request", refused(() -> Fixtures.export(session, "grace", "records/", from, to)));
        assertEquals("an id that names nothing", "no-folder",
                refused(() -> Fixtures.export(session, "grace", "records", from, to)));
        assertEquals("no-folder", refused(() -> Fixtures.export(session, "grace", "/nowhere", from, to)));

        DocumentModel hidden = session.createDocument(session.createDocumentModel("/", "hidden", "Folder"));
        session.setACP(hidden.getRef(), blocked(), true);
        DocumentModel file = session.createDocument(session.createDocumentModel(Fixtures.RECORDS, "a-file", "File"));
        Fixtures.commit(session);
        assertEquals("a folder grace may not read", "no-folder",
                refused(() -> Fixtures.export(session, "grace", "/hidden", from, to)));
        assertEquals("not-a-folder", refused(() -> Fixtures.export(session, "grace", file.getPathAsString(), from, to)));
        assertEquals(0, exports());
    }

    /** An export is filed in the one disposition runs folder, which blocks what it would inherit. */
    @Test
    public void anExportIsFiledInTheRunsFolderAlone() {
        DocumentModel elsewhere = session.createDocument(session.createDocumentModel("/", "elsewhere", "Folder"));
        ACP acp = new ACPImpl();
        ACL acl = new ACLImpl(ACL.LOCAL_ACL);
        acl.add(new ACE("grace", SecurityConstants.EVERYTHING, true));
        acp.addACL(acl);
        session.setACP(elsewhere.getRef(), acp, true);
        Fixtures.commit(session);
        CoreSession grace = Fixtures.as(session, "grace");
        assertEquals("not-in-runs-folder", refused(() -> {
            DocumentModel export = grace.createDocumentModel("/elsewhere", "export", Disposition.EXPORT_TYPE);
            export.setPropertyValue(Disposition.EXPORT_PATH, Fixtures.RECORDS);
            export.setPropertyValue(Disposition.EXPORT_FROM, at(daysAgo(1)));
            export.setPropertyValue(Disposition.EXPORT_TO, at(Instant.now()));
            return grace.createDocument(export);
        }));
    }

    // --- What it holds, for a seeded period ---------------------------------------------------------

    @Test
    public void anExportHoldsWhatHappenedToTheFoldersRecordsInThePeriod() throws IOException, InterruptedException {
        // Before the period: a record made, which the export leaves out.
        DocumentModel early = ended(session, "Claim 4000", rule, daysAgo(20));
        audited();
        Thread.sleep(5);
        Instant from = Instant.now();
        Thread.sleep(5);

        // In the period, under /records: a rule applied, a hold placed and lifted, a view, a download,
        // and a disposition run, started and approved twice, which deletes its two records.
        DocumentModel kept = retained("Claim 4001", Instant.now().plus(Duration.ofDays(3650)));
        ruleAttached(kept, rule);
        session.setLegalHold(kept.getRef(), true, "A dispute");
        session.setLegalHold(kept.getRef(), false, "Settled");
        session.setLegalHold(kept.getRef(), true, "Another dispute");
        DocumentModel one = ended(session, "Claim 4002", rule, daysAgo(10));
        DocumentModel two = ended(session, "Claim 4003", rule, daysAgo(9));
        audited();
        answer(Fixtures.as(session, "dave").getDocument(kept.getRef()));
        Framework.getService(DownloadService.class).logDownload(null,
                Fixtures.as(session, "dave").getDocument(kept.getRef()), "file:content", "claim-4001.pdf", "download", null);
        audited();
        session.setLegalHold(early.getRef(), true, "Kept from the run");
        audited();
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);
        decide(session, "carol", run, Disposition.APPROVE);
        Fixtures.assertState(session, run, Disposition.DISPOSED);
        String certificate = String.valueOf(value(session.getDocument(run.getRef()), Disposition.RUN_CERTIFICATE));

        // In the period, but not under /records: a document elsewhere, and one under /records-old,
        // whose path only starts like it.
        // Both readable by grace, so that only the scope leaves them out.
        DocumentModel elsewhere = session.createDocument(session.createDocumentModel("/", "elsewhere", "Folder"));
        session.setACP(elsewhere.getRef(), readableBy("grace"), true);
        session.createDocument(session.createDocumentModel("/elsewhere", "other", "File"));
        DocumentModel old = session.createDocument(session.createDocumentModel("/", "records-old", "Folder"));
        session.setACP(old.getRef(), readableBy("grace"), true);
        DocumentModel older = session.createDocument(session.createDocumentModel("/records-old", "older", "File"));
        assertTrue(Fixtures.as(session, "grace").hasPermission(older.getRef(), SecurityConstants.READ));

        // In the period and under /records, but a document grace may not read: left out, and counted.
        DocumentModel restricted = session.createDocument(session.createDocumentModel(Fixtures.RECORDS, "restricted",
                "Folder"));
        session.setACP(restricted.getRef(), blocked(), true);
        DocumentModel secret = session.createDocument(session.createDocumentModel(restricted.getPathAsString(), "secret",
                "File"));
        audited();
        Thread.sleep(5);
        Instant to = Instant.now();
        Thread.sleep(5);

        // After the period: left out.
        session.setLegalHold(kept.getRef(), false, "Settled again");
        audited();

        DocumentModel export = waited(Fixtures.export(session, "grace", Fixtures.RECORDS, at(from), at(to)));
        assertEquals(Disposition.EXPORT_DONE, value(export, Disposition.EXPORT_STATE));
        assertEquals("grace", value(export, Disposition.EXPORT_BY));
        assertEquals(Fixtures.RECORDS, value(export, Disposition.EXPORT_PATH));
        assertNotNull(value(export, Disposition.EXPORT_GENERATED_AT));

        List<Map<String, String>> rows = csv(export);
        JsonNode json = json(export);
        assertEquals(AuditExportFiles.COLUMNS, header(export));
        assertEquals(rows.size(), json.get("entries").size());
        assertEquals((long) rows.size(), value(export, Disposition.EXPORT_ENTRY_COUNT));
        assertEquals(rows.size(), json.get("summary").get("entries").asInt());

        // Nothing outside the folder or the period, and in the audit's order.
        long previous = 0;
        for (Map<String, String> row : rows) {
            String path = row.get("record_path");
            assertTrue(path, path.equals(Fixtures.RECORDS) || path.startsWith(Fixtures.RECORDS + "/"));
            Instant when = Instant.parse(row.get("event_date"));
            assertFalse(row.toString(), when.isBefore(from));
            assertTrue(row.toString(), when.isBefore(to));
            long id = Long.parseLong(row.get("entry_id"));
            assertTrue(id > previous);
            previous = id;
            assertFalse("grace may not read it", secret.getId().equals(row.get("record_uid")));
            assertFalse(row.get("comment"), "Settled again".equals(row.get("comment")));
        }
        assertTrue("the restricted folder's own entries and its document's are left out",
                (long) value(export, Disposition.EXPORT_OMITTED_COUNT) >= 2);
        assertEquals(value(export, Disposition.EXPORT_OMITTED_COUNT), json.get("summary").get("omitted").asLong());
        assertFalse("not the record made before the period", events(rows, early).contains("afterMakeRecord"));

        // The record kept: its retention, its rule, its holds, and its reads, each by whom.
        Map<String, Map<String, String>> keptRows = byEvent(rows, kept);
        assertEquals(Set.of("documentCreated", "afterMakeRecord", "afterSetRetention", "retentionRuleAttached",
                "afterSetLegalHold", "afterRemoveLegalHold", RecordsAudit.RECORD_VIEWED, "download"), keptRows.keySet());
        assertEquals("retention", keptRows.get("afterSetRetention").get("kind"));
        assertEquals("Retention rule applied", keptRows.get("retentionRuleAttached").get("what"));
        assertEquals(rule.getId(), keptRows.get("retentionRuleAttached").get("comment"));
        assertEquals("hold", keptRows.get("afterSetLegalHold").get("kind"));
        assertEquals("Legal hold lifted", keptRows.get("afterRemoveLegalHold").get("what"));
        assertEquals(2, count(rows, kept, "afterSetLegalHold"));
        assertEquals("read", keptRows.get(RecordsAudit.RECORD_VIEWED).get("kind"));
        assertEquals("dave", keptRows.get(RecordsAudit.RECORD_VIEWED).get("user"));
        assertEquals("dave", keptRows.get("download").get("user"));
        assertEquals("download", keptRows.get("download").get("download_reason"));
        assertEquals("file:content", keptRows.get("download").get("blob_xpath"));
        assertEquals("claim-4001.pdf", keptRows.get("download").get("file_name"));
        assertEquals("yes", keptRows.get("download").get("record_exists"));

        // The records disposed of: the run that held them, both approvals, the disposal with its
        // certificate, and the platform's own deletion; neither exists any more.
        for (DocumentModel gone : List.of(one, two)) {
            Map<String, Map<String, String>> goneRows = byEvent(rows, gone);
            assertTrue(goneRows.keySet().toString(), goneRows.keySet().containsAll(Set.of(RecordsAudit.RUN_STARTED,
                    RecordsAudit.RUN_APPROVED, RecordsAudit.RECORD_DISPOSED, "documentRemoved")));
            assertEquals(2, count(rows, gone, RecordsAudit.RUN_APPROVED));
            Map<String, String> disposed = goneRows.get(RecordsAudit.RECORD_DISPOSED);
            assertEquals("disposition", disposed.get("kind"));
            assertEquals("carol", disposed.get("user"));
            assertEquals("1", disposed.get("run_number"));
            assertEquals(run.getId(), disposed.get("run_uid"));
            assertEquals(certificate, disposed.get("certificate_uid"));
            assertEquals(value(session.getDocument(run.getRef()), Disposition.RUN_CERTIFICATE_SHA256),
                    disposed.get("certificate_sha256"));
            assertEquals("no", disposed.get("record_exists"));
            Map<String, Object> rest = JSON.readValue(disposed.get("extended"), Map.class);
            assertEquals("alice", rest.get(RecordsAudit.STARTED_BY));
            assertEquals("bob, carol", rest.get(RecordsAudit.APPROVED_BY));
            assertEquals("alice", goneRows.get(RecordsAudit.RUN_STARTED).get("user"));
            assertEquals("deletion", goneRows.get("documentRemoved").get("kind"));
        }
        assertFalse("the record held is in no run", events(rows, early).contains(RecordsAudit.RUN_STARTED));

        // The JSON says the same, with numbers as numbers and the extended information as an object.
        JsonNode first = json.get("entries").get(0);
        assertEquals(AuditExportFiles.COLUMNS, fieldNames(first));
        assertTrue(first.get("entry_id").isNumber());
        assertTrue(first.get("record_exists").isBoolean());
        assertTrue(first.get("extended").isObject());
        JsonNode header = json.get("export");
        assertEquals(Fixtures.RECORDS, header.get("scope").asText());
        assertEquals("grace", header.get("requested_by").asText());
        assertEquals(from.truncatedTo(java.time.temporal.ChronoUnit.MILLIS).toString(), header.get("from").asText());
        assertEquals(AuditExportFiles.FORMAT, header.get("format").asInt());

        // The export itself is in the audit: who wrote it, when, over what, with both checksums.
        List<LogEntry> exported = entries(RecordsAudit.AUDIT_EXPORTED, export);
        assertEquals(1, exported.size());
        assertEquals("grace", exported.get(0).getPrincipalName());
        Map<String, Object> extended = extended(exported.get(0));
        assertEquals(value(export, Disposition.EXPORT_CSV_SHA256), extended.get("csvSha256"));
        assertEquals(value(export, Disposition.EXPORT_JSON_SHA256), extended.get("jsonSha256"));
        assertEquals(Fixtures.RECORDS, extended.get("scope"));
        assertNotNull(elsewhere);
    }

    /** A period longer than one page of the audit is read a page at a time, every entry once, in order. */
    @Test
    public void aLongPeriodIsReadAPageAtATime() throws IOException {
        int count = AuditExports.PAGE * 2 + 37;
        Instant from = Instant.now().minus(Duration.ofDays(400));
        AuditLogger logger = AuditAccess.logger();
        List<LogEntry> written = new ArrayList<>();
        for (int index = 0; index < count; index++) {
            LogEntry entry = logger.newLogEntry();
            entry.setEventId("documentModified");
            entry.setEventDate(java.util.Date.from(from.plus(Duration.ofHours(index))));
            entry.setPrincipalName("someone");
            entry.setDocUUID("00000000-0000-0000-0000-" + String.format("%012d", index));
            entry.setDocPath(Fixtures.RECORDS + "/gone-" + index);
            entry.setDocType("File");
            entry.setCategory("eventDocumentCategory");
            entry.setRepositoryId(session.getRepositoryName());
            written.add(entry);
        }
        logger.addLogEntries(written);
        audited();

        DocumentModel export = waited(Fixtures.export(session, "grace", Fixtures.RECORDS, at(from),
                at(from.plus(Duration.ofHours(count)))));
        List<Map<String, String>> rows = csv(export);
        assertEquals(count, rows.size());
        assertEquals((long) count, value(export, Disposition.EXPORT_ENTRY_COUNT));
        assertEquals(0L, value(export, Disposition.EXPORT_OMITTED_COUNT));
        Set<String> seen = new HashSet<>();
        long previous = 0;
        for (Map<String, String> row : rows) {
            assertTrue(seen.add(row.get("record_uid")));
            assertEquals("no", row.get("record_exists"));
            long id = Long.parseLong(row.get("entry_id"));
            assertTrue(id > previous);
            previous = id;
        }
    }

    // --- Its checksums, and the record it is kept as ------------------------------------------------

    @Test
    public void theChecksumsAreThoseOfTheFilesKept() throws IOException {
        DocumentModel record = retained("Claim 5001", Instant.now().plus(Duration.ofDays(3650)));
        ruleAttached(record, rule);
        audited();
        DocumentModel export = waited(Fixtures.export(session, "grace", Fixtures.RECORDS, at(daysAgo(1)),
                at(Instant.now().plus(Duration.ofDays(1)))));

        byte[] csv = csvBlob(export).getByteArray();
        byte[] json = jsonBlob(export).getByteArray();
        assertEquals(CertificateCsv.sha256(csv), value(export, Disposition.EXPORT_CSV_SHA256));
        assertEquals(CertificateCsv.sha256(json), value(export, Disposition.EXPORT_JSON_SHA256));
        assertEquals("the JSON vouches for the CSV", CertificateCsv.sha256(csv),
                JSON.readTree(json).get("summary").get("csv_sha256").asText());
        assertEquals("text/csv", csvBlob(export).getMimeType());
        assertEquals("application/json", jsonBlob(export).getMimeType());
        assertTrue(new String(csv, 0, 3, StandardCharsets.ISO_8859_1).equals(new String(CertificateCsv.BOM,
                StandardCharsets.ISO_8859_1)));
        assertTrue("kept as a record", export.isRecord());
    }

    @Test
    public void anExportIsKeptAsItWasWritten() {
        DocumentModel export = waited(Fixtures.export(session, "grace", Fixtures.RECORDS, at(daysAgo(1)),
                at(Instant.now().plus(Duration.ofDays(1)))));

        // Its CSV is a record's main file: the repository refuses to replace it, whoever asks.
        DocumentModel replaced = session.getDocument(export.getRef());
        replaced.setPropertyValue(Disposition.FILE_CONTENT, (Serializable) Blobs.createBlob("forged"));
        assertRefused(() -> session.saveDocument(replaced));

        // Its JSON, its checksums and its counts are the add-on's: refused, an administrator included.
        DocumentModel json = session.getDocument(export.getRef());
        List<Map<String, Serializable>> files = new ArrayList<>();
        Map<String, Serializable> file = new HashMap<>();
        file.put("file", (Serializable) Blobs.createBlob("{}"));
        files.add(file);
        json.setPropertyValue(Disposition.FILES, (Serializable) files);
        assertEquals("server-only", refused(() -> session.saveDocument(json)));
        DocumentModel sha = session.getDocument(export.getRef());
        sha.setPropertyValue(Disposition.EXPORT_CSV_SHA256, "0".repeat(64));
        assertEquals("server-only", refused(() -> session.saveDocument(sha)));
        DocumentModel count = session.getDocument(export.getRef());
        count.setPropertyValue(Disposition.EXPORT_ENTRY_COUNT, 99L);
        assertEquals("server-only", refused(() -> session.saveDocument(count)));

        // Nor is it moved, copied or put in the trash, an administrator's request included.
        assertEquals("kept", refused(() -> session.copy(export.getRef(), session.getRootDocument().getRef(), "copy")));
        assertEquals("kept", refused(() -> session.move(export.getRef(), session.getRootDocument().getRef(), "moved")));
        assertEquals("kept", refused(() -> {
            Framework.getService(org.nuxeo.ecm.core.api.trash.TrashService.class)
                     .trashDocument(session.getDocument(export.getRef()));
            return null;
        }));
        // Its filer may not delete it: she holds no Remove, and the repository refuses before the add-on.
        assertRefused(() -> Fixtures.as(session, "grace").removeDocument(export.getRef()));
        assertTrue(session.exists(export.getRef()));
    }

    /** It lists who read what: its filer reads it, and no one else the folder lets in. */
    @Test
    public void anExportIsItsFilersAlone() {
        DocumentModel export = waited(Fixtures.export(session, "grace", Fixtures.RECORDS, at(daysAgo(1)),
                at(Instant.now().plus(Duration.ofDays(1)))));
        assertTrue(Fixtures.as(session, "grace").exists(export.getRef()));
        for (String name : List.of("alice", "bob", "dave")) {
            assertFalse(name, Fixtures.as(session, name).exists(export.getRef()));
        }
        assertTrue(session.exists(export.getRef()));
    }

    /** A form's document picker names the folder by its id: the server writes its path. */
    @Test
    public void anExportNamesItsFolderByPathOrId() {
        String id = session.getDocument(new org.nuxeo.ecm.core.api.PathRef(Fixtures.RECORDS)).getId();
        DocumentModel export = waited(Fixtures.export(session, "grace", id, at(daysAgo(1)),
                at(Instant.now().plus(Duration.ofDays(1)))));
        assertEquals(Fixtures.RECORDS, value(export, Disposition.EXPORT_PATH));
        assertEquals(Disposition.EXPORT_DONE, value(export, Disposition.EXPORT_STATE));
    }

    /** What the filer sends beyond the scope, the period and the comment is the server's to write. */
    @Test
    public void theServerWritesTheRestOfTheExport() throws IOException {
        CoreSession grace = Fixtures.as(session, "grace");
        DocumentModel export = grace.createDocumentModel(Fixtures.RUNS, "export", Disposition.EXPORT_TYPE);
        export.setPropertyValue(Disposition.EXPORT_PATH, Fixtures.RECORDS + "/");
        export.setPropertyValue(Disposition.EXPORT_FROM, at(daysAgo(1)));
        export.setPropertyValue(Disposition.EXPORT_TO, at(Instant.now().plus(Duration.ofDays(1))));
        export.setPropertyValue(Disposition.EXPORT_BY, "someone else");
        export.setPropertyValue(Disposition.EXPORT_STATE, Disposition.EXPORT_DONE);
        export.setPropertyValue(Disposition.EXPORT_CSV_SHA256, "0".repeat(64));
        export.setPropertyValue(Disposition.EXPORT_ENTRY_COUNT, 99L);
        export.setPropertyValue(Disposition.FILE_CONTENT, (Serializable) Blobs.createBlob("forged"));
        export = grace.createDocument(export);
        Fixtures.commit(grace);
        DocumentModel stored = waited(session.getDocument(export.getRef()));
        assertEquals("grace", value(stored, Disposition.EXPORT_BY));
        assertEquals(Fixtures.RECORDS, value(stored, Disposition.EXPORT_PATH));
        assertEquals(Disposition.EXPORT_DONE, value(stored, Disposition.EXPORT_STATE));
        assertEquals(CertificateCsv.sha256(csvBlob(stored).getByteArray()),
                value(stored, Disposition.EXPORT_CSV_SHA256));
        assertFalse(new String(csvBlob(stored).getByteArray(), StandardCharsets.UTF_8).contains("forged"));
    }

    // --- Helpers ------------------------------------------------------------------------------------

    /** The export once the add-on has written it, in the background. */
    private DocumentModel waited(DocumentModel export) {
        audited();
        return session.getDocument(export.getRef());
    }

    private long exports() {
        return session.query("SELECT * FROM " + Disposition.EXPORT_TYPE).size();
    }

    private static ACP readableBy(String name) {
        ACP acp = new ACPImpl();
        ACL acl = new ACLImpl(ACL.LOCAL_ACL);
        acl.add(new ACE(name, SecurityConstants.READ, true));
        acp.addACL(acl);
        return acp;
    }

    private static ACP blocked() {
        ACP acp = new ACPImpl();
        ACL acl = new ACLImpl(ACL.LOCAL_ACL);
        acl.add(ACE.BLOCK);
        acp.addACL(acl);
        return acp;
    }

    private static void assertRefused(Runnable change) {
        try {
            change.run();
            fail("Not refused");
        } catch (NuxeoException expected) {
            Fixtures.rollback();
        }
    }

    private static Blob csvBlob(DocumentModel export) {
        return (Blob) export.getPropertyValue(Disposition.FILE_CONTENT);
    }

    private static Blob jsonBlob(DocumentModel export) {
        return (Blob) export.getPropertyValue(Disposition.FILES + "/0/file");
    }

    private static JsonNode json(DocumentModel export) throws IOException {
        try (InputStream in = jsonBlob(export).getStream()) {
            return JSON.readTree(in);
        }
    }

    private static List<String> header(DocumentModel export) throws IOException {
        return Fixtures.csvRows(new String(csvBlob(export).getByteArray(), StandardCharsets.UTF_8)).get(0);
    }

    private static List<String> fieldNames(JsonNode node) {
        List<String> names = new ArrayList<>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }

    /** The CSV's rows, by column, its header row taken out. */
    private static List<Map<String, String>> csv(DocumentModel export) throws IOException {
        List<List<String>> table = Fixtures.csvRows(new String(csvBlob(export).getByteArray(), StandardCharsets.UTF_8));
        List<String> columns = table.get(0);
        List<Map<String, String>> rows = new ArrayList<>();
        for (List<String> fields : table.subList(1, table.size())) {
            assertEquals(columns.size(), fields.size());
            Map<String, String> row = new LinkedHashMap<>();
            for (int index = 0; index < columns.size(); index++) {
                row.put(columns.get(index), fields.get(index));
            }
            rows.add(row);
        }
        return rows;
    }

    private static Map<String, Map<String, String>> byEvent(List<Map<String, String>> rows, DocumentModel doc) {
        Map<String, Map<String, String>> byEvent = new LinkedHashMap<>();
        for (Map<String, String> row : rows) {
            if (doc.getId().equals(row.get("record_uid"))) {
                byEvent.putIfAbsent(row.get("event"), row);
            }
        }
        return byEvent;
    }

    private static List<String> events(List<Map<String, String>> rows, DocumentModel doc) {
        return new ArrayList<>(byEvent(rows, doc).keySet());
    }

    private static long count(List<Map<String, String>> rows, DocumentModel doc, String event) {
        return rows.stream().filter(row -> doc.getId().equals(row.get("record_uid")) && event.equals(row.get("event")))
                   .count();
    }

}
