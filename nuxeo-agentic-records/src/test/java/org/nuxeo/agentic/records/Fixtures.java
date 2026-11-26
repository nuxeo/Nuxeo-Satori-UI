package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.fail;

import java.io.Serializable;
import java.time.Duration;
import java.time.Instant;
import java.util.Calendar;
import java.util.List;
import java.util.function.Supplier;

import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.impl.UserPrincipal;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.core.api.security.impl.ACLImpl;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * The tests' repository: records of the retention module's whose retention has ended, as the module
 * and the platform leave them, a rule, and the disposition runs folder with its grants.
 *
 * <ul>
 * <li><b>alice</b> starts runs: StartDisposition.</li>
 * <li><b>bob</b>, <b>carol</b> and <b>erin</b> approve them: ApproveDisposition.</li>
 * <li><b>dave</b> may read the folder and file in it, and holds neither permission.</li>
 * <li><b>grace</b> files audit exports: ExportRecordsAudit.</li>
 * </ul>
 * Everyone named reads the records folder, but the record {@code unreadable}, which alice cannot.
 */
final class Fixtures {

    static final String RUNS = "/disposition";

    static final String RECORDS = "/records";

    static final List<String> PEOPLE = List.of("alice", "bob", "carol", "dave", "erin", "grace");

    private Fixtures() {
    }

    static NuxeoPrincipal person(String name) {
        return new UserPrincipal(name, List.of(), false, false);
    }

    static CoreSession as(CoreSession admin, String name) {
        return CoreInstance.getCoreSession(admin.getRepositoryName(), person(name));
    }

    /** The disposition runs folder, its inherited permissions blocked, with the grants above. */
    static DocumentModel runsFolder(CoreSession admin) {
        DocumentModel folder = admin.createDocumentModel("/", RUNS.substring(1), Disposition.RUNS_TYPE);
        folder.setPropertyValue("dc:title", "Disposition runs");
        folder = admin.createDocument(folder);
        ACP acp = new ACPImpl();
        ACL acl = new ACLImpl(ACL.LOCAL_ACL);
        acl.add(new ACE("alice", Disposition.START_PERMISSION, true));
        acl.add(new ACE("bob", Disposition.APPROVE_PERMISSION, true));
        acl.add(new ACE("carol", Disposition.APPROVE_PERMISSION, true));
        acl.add(new ACE("erin", Disposition.APPROVE_PERMISSION, true));
        acl.add(new ACE("grace", Disposition.EXPORT_PERMISSION, true));
        acl.add(new ACE("dave", SecurityConstants.READ, true));
        acl.add(new ACE("dave", SecurityConstants.ADD_CHILDREN, true));
        acl.add(ACE.BLOCK);
        acp.addACL(acl);
        admin.setACP(folder.getRef(), acp, true);
        return admin.getDocument(folder.getRef());
    }

    static DocumentModel recordsFolder(CoreSession admin) {
        DocumentModel folder = admin.createDocumentModel("/", RECORDS.substring(1), "Folder");
        folder = admin.createDocument(folder);
        ACP acp = new ACPImpl();
        ACL acl = new ACLImpl(ACL.LOCAL_ACL);
        for (String name : PEOPLE) {
            acl.add(new ACE(name, SecurityConstants.READ, true));
        }
        acp.addACL(acl);
        admin.setACP(folder.getRef(), acp, true);
        return folder;
    }

    /** A retention rule of the module's, with the end actions given: none for a rule under review. */
    static DocumentModel rule(CoreSession admin, String title, String... endActions) {
        DocumentModel rule = admin.createDocumentModel("/", title.toLowerCase().replace(' ', '-'), "RetentionRule");
        rule.setPropertyValue("dc:title", title);
        rule.setPropertyValue("retention_def:durationYears", 7L);
        rule.setPropertyValue("retention_def:startingPointPolicy", "immediate");
        rule.setPropertyValue("retention_def:endActions", endActions);
        return admin.createDocument(rule);
    }

    /**
     * A record as the module and the platform leave it when its retention ends: a record to the
     * repository, with the module's facet and rule, no retention left in the repository, and the
     * day it ended saved in {@code record:retainUntil}.
     */
    static DocumentModel ended(CoreSession admin, String title, DocumentModel rule, Instant endedAt) {
        DocumentModel doc = admin.createDocumentModel(RECORDS, title.toLowerCase().replace(' ', '-'), "File");
        doc.setPropertyValue("dc:title", title);
        doc = admin.createDocument(doc);
        admin.makeRecord(doc.getRef());
        doc = admin.getDocument(doc.getRef());
        doc.addFacet(Disposition.RECORD_FACET);
        doc.setPropertyValue(Disposition.RECORD_RULE_IDS, new String[] { rule.getId() });
        doc.setPropertyValue(Disposition.RECORD_RETAIN_UNTIL, calendar(endedAt));
        return admin.saveDocument(doc);
    }

    static Calendar calendar(Instant instant) {
        return Dispositions.calendar(instant);
    }

    static Instant daysAgo(int days) {
        return Instant.now().minus(Duration.ofDays(days));
    }

    /** Commits what the session wrote and starts a new transaction, as a request's end would. */
    static void commit(CoreSession session) {
        session.save();
        TransactionHelper.commitOrRollbackTransaction();
        TransactionHelper.startTransaction();
    }

    /** Rolls the current transaction back, as a refused request's is, and starts a new one. */
    static void rollback() {
        TransactionHelper.setTransactionRollbackOnly();
        TransactionHelper.commitOrRollbackTransaction();
        TransactionHelper.startTransaction();
    }

    /** Files a request as {@code name}, as a REST client's POST of a document would, and commits it. */
    static DocumentModel file(CoreSession admin, String name, String action, String runId) {
        CoreSession session = as(admin, name);
        DocumentModel request = session.createDocumentModel(RUNS, action, Disposition.REQUEST_TYPE);
        request.setPropertyValue(Disposition.REQUEST_ACTION, action);
        request.setPropertyValue(Disposition.REQUEST_RUN, runId);
        request = session.createDocument(request);
        commit(session);
        return admin.getDocument(request.getRef());
    }

    /** Files an audit export as {@code name}, of the folder at {@code path} over the period, as a REST client would, and commits it. */
    static DocumentModel export(CoreSession admin, String name, String path, Calendar from, Calendar to) {
        CoreSession session = as(admin, name);
        DocumentModel export = session.createDocumentModel(RUNS, "export", Disposition.EXPORT_TYPE);
        export.setPropertyValue(Disposition.EXPORT_PATH, path);
        export.setPropertyValue(Disposition.EXPORT_FROM, from);
        export.setPropertyValue(Disposition.EXPORT_TO, to);
        export = session.createDocument(export);
        commit(session);
        return admin.getDocument(export.getRef());
    }

    /** An RFC 4180 CSV, every field quoted, as rows of fields: its byte order mark taken off. */
    static List<List<String>> csvRows(String csv) {
        String text = !csv.isEmpty() && csv.charAt(0) == 0xFEFF ? csv.substring(1) : csv;
        List<List<String>> rows = new java.util.ArrayList<>();
        List<String> row = new java.util.ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean quoted = false;
        for (int index = 0; index < text.length(); index++) {
            char c = text.charAt(index);
            if (quoted) {
                if (c == '"' && index + 1 < text.length() && text.charAt(index + 1) == '"') {
                    field.append('"');
                    index++;
                } else if (c == '"') {
                    quoted = false;
                } else {
                    field.append(c);
                }
            } else if (c == '"') {
                quoted = true;
            } else if (c == ',') {
                row.add(field.toString());
                field.setLength(0);
            } else if (c == '\r' && index + 1 < text.length() && text.charAt(index + 1) == '\n') {
                row.add(field.toString());
                field.setLength(0);
                rows.add(row);
                row = new java.util.ArrayList<>();
                index++;
            } else {
                field.append(c);
            }
        }
        if (field.length() > 0 || !row.isEmpty()) {
            row.add(field.toString());
            rows.add(row);
        }
        return rows;
    }

    /** Starts a run as {@code name}: the run. */
    static DocumentModel start(CoreSession admin, String name) {
        DocumentModel request = file(admin, name, Disposition.START, null);
        return admin.getDocument(new org.nuxeo.ecm.core.api.IdRef((String) request.getPropertyValue(Disposition.REQUEST_RUN)));
    }

    /** Approves or rejects {@code run} as {@code name}: the request, with what came of it. */
    static DocumentModel decide(CoreSession admin, String name, DocumentModel run, String action) {
        return file(admin, name, action, run.getId());
    }

    /** What {@code action} is refused with: its code. The transaction is rolled back, as a request's is. */
    static String refused(Supplier<?> action) {
        try {
            action.get();
        } catch (DispositionRefusal refusal) {
            rollback();
            return refusal.getCode();
        }
        fail("Not refused");
        return null;
    }

    static void assertState(CoreSession admin, DocumentModel run, String state) {
        DocumentModel stored = admin.getDocument(run.getRef());
        assertEquals(state, stored.getPropertyValue(Disposition.RUN_STATE));
    }

    static Serializable value(CoreSession admin, DocumentModel doc, String xpath) {
        DocumentModel stored = admin.getDocument(doc.getRef());
        assertNotNull(stored);
        return stored.getPropertyValue(xpath);
    }
}
