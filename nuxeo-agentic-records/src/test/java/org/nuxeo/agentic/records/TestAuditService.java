package org.nuxeo.agentic.records;

/**
 * A stand-in for LTS 2025's {@code org.nuxeo.audit.service.AuditService}, which the tests' platform
 * does not have: a service whose {@code getAuditBackend(String)} names the audit's store, so that
 * {@link AuditAccess} is seen reaching the audit the way it does on a 2025 server
 * ({@link TestAuditServiceComponent}).
 */
public interface TestAuditService {

    Object getAuditBackend(String name);
}
