package org.nuxeo.agentic.records;

import org.nuxeo.ecm.platform.audit.api.AuditReader;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.model.DefaultComponent;

/** {@link TestAuditService}: the audit's store, and the name it was asked for. */
public class TestAuditServiceComponent extends DefaultComponent implements TestAuditService {

    static volatile String asked;

    @Override
    public Object getAuditBackend(String name) {
        asked = name;
        return Framework.getService(AuditReader.class);
    }
}
