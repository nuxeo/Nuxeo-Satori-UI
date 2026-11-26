package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;

import java.io.Serializable;
import java.lang.reflect.Proxy;
import java.util.Map;
import java.util.TreeMap;

import org.junit.Test;
import org.nuxeo.ecm.platform.audit.api.AuditReader;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Deploy;

/**
 * How the add-on reaches the audit on both platforms: the 11.5 one the tests run, and LTS 2025's,
 * through stand-ins for what 2025 has and 11.5 does not.
 */
@Deploy("org.nuxeo.agentic.records:OSGI-INF/test-audit-service.xml")
public class AuditAccessTest extends RecordsAuditTestCase {

    /** An LTS 2025 entry: its values in getExtended(), and getExtendedInfos() refused. */
    public interface Entry2025 extends LogEntry {

        Map<String, Object> getExtended();
    }

    @Test
    public void withoutTheAuditServiceThePlatformsLookupIsTheAudit() {
        assertSame(Framework.getService(AuditReader.class),
                AuditAccess.backend("org.nuxeo.audit.service.NoSuchService", AuditReader.class));
        assertSame(Framework.getService(AuditReader.class), AuditAccess.reader());
    }

    @Test
    public void withTheAuditServiceItsDefaultStoreIsTheAudit() {
        TestAuditServiceComponent.asked = null;
        Object backend = AuditAccess.backend(TestAuditService.class.getName(), AuditReader.class);
        assertEquals(AuditAccess.DEFAULT_BACKEND, TestAuditServiceComponent.asked);
        assertSame(Framework.getService(AuditReader.class), backend);
    }

    @Test
    public void anEntrysExtendedInformationIsReadWhicheverPlatformWroteIt() {
        Map<String, Object> values = new TreeMap<>();
        values.put(RecordsAudit.RUN_NUMBER, 7L);
        values.put(RecordsAudit.LEGAL_HOLD, Boolean.TRUE);
        Entry2025 entry = (Entry2025) Proxy.newProxyInstance(getClass().getClassLoader(),
                new Class<?>[] { Entry2025.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getExtended" -> values;
                case "getExtendedInfos" -> throw new UnsupportedOperationException(
                        "ExtendedInfo not supported, use #getExtended instead");
                default -> null;
                });
        assertEquals(values, AuditAccess.extended(entry));

        // An 11.5 entry, written by the audit itself.
        Map<String, Serializable> written = new java.util.HashMap<>();
        written.put(RecordsAudit.RUN_NUMBER, 7L);
        org.nuxeo.ecm.platform.audit.api.AuditLogger logger = AuditAccess.logger();
        LogEntry legacy = logger.newLogEntry();
        legacy.setEventId("test");
        legacy.setEventDate(new java.util.Date());
        legacy.setExtendedInfos(Map.of(RecordsAudit.RUN_NUMBER, logger.newExtendedInfo(7L)));
        assertEquals(Map.of(RecordsAudit.RUN_NUMBER, 7L), AuditAccess.extended(legacy));
        assertEquals(written.get(RecordsAudit.RUN_NUMBER), AuditAccess.extended(legacy).get(RecordsAudit.RUN_NUMBER));
    }
}
