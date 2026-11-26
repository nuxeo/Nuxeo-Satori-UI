package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.records.Fixtures.commit;
import static org.nuxeo.agentic.records.Fixtures.daysAgo;
import static org.nuxeo.agentic.records.Fixtures.decide;
import static org.nuxeo.agentic.records.Fixtures.ended;
import static org.nuxeo.agentic.records.Fixtures.start;

import java.util.List;

import org.junit.Test;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.cluster.ClusterService;
import org.nuxeo.runtime.kv.KeyValueService;
import org.nuxeo.runtime.test.runner.Deploy;

/**
 * The add-on on a server of a cluster: its lock is then the cluster's key-value store's, and the
 * person's transaction is still the request's, rolled back whole on a refusal.
 */
@Deploy("org.nuxeo.agentic.records:OSGI-INF/test-cluster.xml")
public class DispositionClusterTest extends DispositionTestCase {

    @Test
    public void theServerIsInACluster() {
        assertTrue(Framework.getService(ClusterService.class).isEnabled());
    }

    @Test
    public void aRunIsStartedApprovedAndDisposedOf() {
        DocumentModel record = ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);
        DocumentModel last = decide(session, "carol", run, Disposition.APPROVE);
        assertEquals(Disposition.DISPOSED, last.getPropertyValue(Disposition.REQUEST_OUTCOME));
        assertFalse(session.exists(record.getRef()));
        assertEquals(1, certificates());
        assertNull("the lock is given back",
                Framework.getService(KeyValueService.class).getKeyValueStore(Dispositions.CLUSTER_STORE)
                         .getString(Disposition.LOCK_KEY));
    }

    /** What the person wrote before a refused request, in the same transaction, is rolled back with it. */
    @Test
    public void aRefusalRollsBackThePersonsTransactionWhole() {
        DocumentModel mine = session.createDocument(session.createDocumentModel("/", "mine", "Folder"));
        ACP acp = session.getACP(mine.getRef());
        acp.getOrCreateACL(ACL.LOCAL_ACL).add(new ACE("dave", SecurityConstants.EVERYTHING, true));
        session.setACP(mine.getRef(), acp, true);
        ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);

        CoreSession dave = Fixtures.as(session, "dave");
        dave.createDocument(dave.createDocumentModel("/mine", "written-before", "File"));
        DocumentModel request = dave.createDocumentModel(Fixtures.RUNS, "start", Disposition.REQUEST_TYPE);
        request.setPropertyValue(Disposition.REQUEST_ACTION, Disposition.START);
        assertEquals("permission", Fixtures.refused(() -> dave.createDocument(request)));
        assertFalse(session.exists(new PathRef("/mine/written-before")));
    }

    @Test
    public void twoApprovalsAtOnceAreTakenOneAfterTheOther() throws Exception {
        DocumentModel record = ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        assertEquals(List.of("bob", "carol"), DispositionAtomicityTest.together(session, run, "bob", "carol"));
        Fixtures.assertState(session, run, Disposition.DISPOSED);
        assertFalse(session.exists(record.getRef()));
        assertEquals(1, certificates());
    }

    @Test
    public void onePersonsTwoApprovalsAtOnceCountOnce() throws Exception {
        ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        assertEquals(List.of("bob"), DispositionAtomicityTest.together(session, run, "bob", "bob"));
        Fixtures.assertState(session, run, Disposition.PENDING);
    }
}
