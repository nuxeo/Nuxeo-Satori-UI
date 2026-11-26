package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.records.Fixtures.daysAgo;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import org.junit.Test;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.platform.audit.api.AuditReader;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.transaction.TransactionHelper;

/** An export written once, and an export whose audit fails, which keeps nothing and says so. */
@Deploy("org.nuxeo.agentic.records:OSGI-INF/test-no-export-writer.xml")
public class AuditExportGenerationTest extends RecordsAuditTestCase {

    private DocumentModel pending() {
        DocumentModel export = Fixtures.export(session, "grace", Fixtures.RECORDS, at(daysAgo(1)),
                at(Instant.now().plus(Duration.ofDays(1))));
        audited();
        DocumentModel stored = session.getDocument(export.getRef());
        assertEquals(Disposition.EXPORT_PENDING, stored.getPropertyValue(Disposition.EXPORT_STATE));
        return stored;
    }

    @Test
    public void anExportIsWrittenOnce() {
        retained("Claim 7001", Instant.now().plus(Duration.ofDays(3650)));
        audited();
        DocumentModel export = pending();
        AuditExports exports = new AuditExports(Clock.systemUTC());

        exports.generate(session.getRepositoryName(), export.getId(), Fixtures.person("grace"));
        assertTrue(TransactionHelper.isTransactionActive());
        DocumentModel written = session.getDocument(export.getRef());
        assertEquals(Disposition.EXPORT_DONE, written.getPropertyValue(Disposition.EXPORT_STATE));
        Object sha = written.getPropertyValue(Disposition.EXPORT_CSV_SHA256);
        assertNotNull(sha);

        exports.generate(session.getRepositoryName(), export.getId(), Fixtures.person("grace"));
        DocumentModel again = session.getDocument(export.getRef());
        assertEquals("an export no longer pending is left as it is", sha,
                again.getPropertyValue(Disposition.EXPORT_CSV_SHA256));
        audited();
        assertEquals(1, entries(RecordsAudit.AUDIT_EXPORTED, export).size());
    }

    /**
     * An export waits for its period's end to settle before it reads the audit: an entry the audit
     * writes a moment after its event, as it writes every entry, is in it.
     */
    @Test
    public void anExportWaitsForItsPeriodToSettle() throws InterruptedException, java.io.IOException {
        org.nuxeo.runtime.api.Framework.getProperties().setProperty(AuditExports.SETTLE_PROPERTY, "2");
        DocumentModel export = pending();
        java.util.Date end = ((java.util.Calendar) export.getPropertyValue(Disposition.EXPORT_TO)).getTime();
        Thread late = new Thread(() -> {
            try {
                Thread.sleep(500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            TransactionHelper.runInTransaction(() -> {
                org.nuxeo.ecm.platform.audit.api.AuditLogger logger = AuditAccess.logger();
                org.nuxeo.ecm.platform.audit.api.LogEntry entry = logger.newLogEntry();
                entry.setEventId("documentModified");
                entry.setEventDate(new java.util.Date(end.getTime() - 1));
                entry.setPrincipalName("someone");
                entry.setDocUUID("00000000-0000-0000-0000-000000000001");
                entry.setDocPath(Fixtures.RECORDS + "/written-late");
                entry.setRepositoryId(session.getRepositoryName());
                logger.addLogEntries(List.of(entry));
            });
        });
        late.start();
        new AuditExports(Clock.systemUTC()).generate(session.getRepositoryName(), export.getId(),
                Fixtures.person("grace"));
        late.join();
        DocumentModel written = session.getDocument(export.getRef());
        assertEquals(Disposition.EXPORT_DONE, written.getPropertyValue(Disposition.EXPORT_STATE));
        String csv = new String(((org.nuxeo.ecm.core.api.Blob) written.getPropertyValue(Disposition.FILE_CONTENT))
                .getByteArray(), java.nio.charset.StandardCharsets.UTF_8);
        assertTrue("the entry written after the export was filed is in it", csv.contains("/written-late"));
    }

    /** An export whose filer is not known is marked failed, not left pending. */
    @Test
    public void anExportWithNoFilerIsMarkedFailed() {
        DocumentModel export = pending();
        new AuditExports(Clock.systemUTC()).generate(session.getRepositoryName(), export.getId(), null);
        assertEquals(Disposition.EXPORT_FAILED,
                session.getDocument(export.getRef()).getPropertyValue(Disposition.EXPORT_STATE));
    }

    @Test
    public void anExportWhoseAuditFailsKeepsNothingAndSaysSo() {
        DocumentModel export = pending();
        AuditReader failing = (AuditReader) java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),
                new Class<?>[] { AuditReader.class }, (proxy, method, args) -> {
                    throw new IllegalStateException("The test's audit, failing");
                });
        AuditExports exports = new AuditExports(Clock.systemUTC(), () -> failing);

        exports.generate(session.getRepositoryName(), export.getId(), Fixtures.person("grace"));
        assertTrue(TransactionHelper.isTransactionActive());
        DocumentModel failed = session.getDocument(export.getRef());
        assertEquals(Disposition.EXPORT_FAILED, failed.getPropertyValue(Disposition.EXPORT_STATE));
        assertNotNull(failed.getPropertyValue(Disposition.EXPORT_FAILURE));
        assertNull(failed.getPropertyValue(Disposition.FILE_CONTENT));
        assertEquals(List.of(), failed.getPropertyValue(Disposition.FILES));
        assertNull(failed.getPropertyValue(Disposition.EXPORT_CSV_SHA256));
        assertFalse(failed.isRecord());
        audited();
        assertEquals(List.of(), entries(RecordsAudit.AUDIT_EXPORTED, export));
    }
}
