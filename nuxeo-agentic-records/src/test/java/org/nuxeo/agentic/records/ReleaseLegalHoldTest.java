package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;
import static org.nuxeo.agentic.records.Fixtures.commit;
import static org.nuxeo.agentic.records.Fixtures.rollback;

import java.util.List;
import java.util.Map;

import org.junit.Before;
import org.junit.Test;
import org.nuxeo.ecm.automation.AutomationService;
import org.nuxeo.ecm.automation.OperationContext;
import org.nuxeo.ecm.automation.OperationException;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.core.api.security.impl.ACLImpl;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Deploy;

/**
 * {@code Records.ReleaseLegalHold} run by the Automation service, as an operation button's run
 * reaches it: the reason kept as the platform's audit comment, and every refusal the server's.
 *
 * <ul>
 * <li><b>rita</b>, a records manager: ReadWrite and ManageLegalHold on the cases' folder.</li>
 * <li><b>sam</b>, a dispute analyst: ReadWrite there, and no ManageLegalHold.</li>
 * </ul>
 */
@Deploy("org.nuxeo.ecm.automation.core")
public class ReleaseLegalHoldTest extends RecordsAuditTestCase {

    private DocumentModel record;

    @Before
    public void setUpCase() {
        DocumentModel cases = session.createDocument(session.createDocumentModel("/", "held-cases", "Folder"));
        ACP acp = new ACPImpl();
        ACL acl = new ACLImpl(ACL.LOCAL_ACL);
        acl.add(new ACE("rita", SecurityConstants.READ_WRITE, true));
        acl.add(new ACE("rita", "ManageLegalHold", true));
        acl.add(new ACE("sam", SecurityConstants.READ_WRITE, true));
        acp.addACL(acl);
        session.setACP(cases.getRef(), acp, true);
        DocumentModel doc = session.createDocumentModel("/held-cases", "dispute-2002", "File");
        doc.setPropertyValue("dc:title", "Dispute 2002");
        doc = session.createDocument(doc);
        session.makeRecord(doc.getRef());
        session.setLegalHold(doc.getRef(), true, "The customer disputes the charge");
        record = session.getDocument(doc.getRef());
        commit(session);
    }

    /** The operation run by the Automation service as {@code user}, on the record as they read it. */
    private DocumentModel release(String user, Object reason) throws Exception {
        CoreSession as = Fixtures.as(session, user);
        OperationContext context = new OperationContext(as);
        context.setInput(as.getDocument(record.getRef()));
        Map<String, Object> params = reason == null ? Map.of() : Map.of("reason", reason);
        return (DocumentModel) Framework.getService(AutomationService.class)
                                        .run(context, ReleaseLegalHoldOperation.ID, params);
    }

    /** What a run threw: the first refusal of {@code type} in its causes, or a failure when there is none. */
    private <T extends Throwable> T refused(Class<T> type, String user, Object reason) {
        try {
            release(user, reason);
        } catch (Exception e) {
            rollback();
            for (Throwable cause = e; cause != null; cause = cause.getCause()) {
                if (type.isInstance(cause)) {
                    return type.cast(cause);
                }
            }
            throw new AssertionError("refused, but not with a " + type.getSimpleName(), e);
        }
        rollback();
        fail("Not refused");
        return null;
    }

    @Test
    public void aRecordsManagerReleasesAHoldSayingWhyAndTheAuditKeepsTheReason() throws Exception {
        DocumentModel released = release("rita", "  The dispute is settled in the customer's favour.  ");
        commit(session);
        assertFalse(released.hasLegalHold());
        assertFalse(session.getDocument(record.getRef()).hasLegalHold());
        audited();
        List<LogEntry> releases = entries("afterRemoveLegalHold", record);
        assertEquals(1, releases.size());
        assertEquals("The dispute is settled in the customer's favour.", releases.get(0).getComment());
        assertEquals("rita", releases.get(0).getPrincipalName());
        // The hold it released kept its own description, from when it was placed.
        assertEquals("The customer disputes the charge", entries("afterSetLegalHold", record).get(0).getComment());
    }

    @Test
    public void aReleaseWithNoReasonIsRefused() {
        for (String reason : List.of("", "   ", "\n\t")) {
            DispositionRefusal refusal = refused(DispositionRefusal.class, "rita", reason);
            assertEquals(400, refusal.getStatusCode());
            assertEquals("reason", refusal.getCode());
        }
        DispositionRefusal control = refused(DispositionRefusal.class, "rita", "Settled\u0007");
        assertEquals(400, control.getStatusCode());
        DispositionRefusal tooLong = refused(DispositionRefusal.class, "rita", "x".repeat(1001));
        assertEquals(400, tooLong.getStatusCode());
        // Automation refuses a run with no reason at all, before the operation is reached.
        refused(OperationException.class, "rita", null);
        assertTrue(session.getDocument(record.getRef()).hasLegalHold());
    }

    @Test
    public void aRecordUnderNoHoldIsRefused() throws Exception {
        release("rita", "Settled");
        commit(session);
        DispositionRefusal refusal = refused(DispositionRefusal.class, "rita", "Settled again");
        assertEquals(409, refusal.getStatusCode());
        assertEquals("not-held", refusal.getCode());
    }

    /** The platform checks the person's ManageLegalHold: the operation runs as them, never as the add-on. */
    @Test
    public void someoneWithoutManageLegalHoldIsRefusedAndTheHoldStays() {
        DocumentSecurityException refusal = refused(DocumentSecurityException.class, "sam", "I settled it");
        assertEquals(403, refusal.getStatusCode());
        assertTrue(session.getDocument(record.getRef()).hasLegalHold());
        audited();
        assertTrue(entries("afterRemoveLegalHold", record).isEmpty());
    }
}
