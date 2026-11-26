package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;
import static org.nuxeo.agentic.records.Fixtures.commit;
import static org.nuxeo.agentic.records.Fixtures.daysAgo;
import static org.nuxeo.agentic.records.Fixtures.decide;
import static org.nuxeo.agentic.records.Fixtures.ended;
import static org.nuxeo.agentic.records.Fixtures.start;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.Test;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.runtime.transaction.TransactionHelper;

/** A disposal is whole or nothing, and two decisions at once never count as more than they are. */
public class DispositionAtomicityTest extends DispositionTestCase {

    /** A failure partway through the deletions: the records deleted before it are back, and the run awaits its approval. */
    @Test
    public void aFailurePartwayThroughDisposesOfNothing() {
        DocumentModel first = ended(session, "Claim 1001", rule, daysAgo(10));
        DocumentModel second = ended(session, "Claim 1002", rule, daysAgo(9));
        DocumentModel third = ended(session, "Claim 1003", rule, daysAgo(8));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);

        // The first record is deleted, then the second's deletion fails.
        TestHooks.failOnRemove = "Claim 1002";
        try {
            decide(session, "carol", run, Disposition.APPROVE);
            fail("The failure was not thrown");
        } catch (RuntimeException expected) {
            Fixtures.rollback();
        }
        TestHooks.reset();

        assertTrue(session.exists(first.getRef()));
        assertTrue(session.exists(second.getRef()));
        assertTrue(session.exists(third.getRef()));
        Fixtures.assertState(session, run, Disposition.PENDING);
        assertEquals(List.of("bob"), approvers(run));
        assertNull(session.getDocument(run.getRef()).getPropertyValue(Disposition.RUN_CERTIFICATE));
        assertEquals(0, certificates());
        assertEquals("carol's request was not kept either: the start and bob's approval are", 2,
                session.query("SELECT * FROM " + Disposition.REQUEST_TYPE).size());

        // Filed again, once nothing fails, it disposes of all three.
        decide(session, "carol", run, Disposition.APPROVE);
        Fixtures.assertState(session, run, Disposition.DISPOSED);
        assertEquals(1, certificates());
    }

    /**
     * Two approvals at once, by two people: the add-on takes one after the other, so the second sees
     * the first and disposes of the run, once.
     */
    @Test
    public void twoApprovalsAtOnceAreTakenOneAfterTheOther() throws Exception {
        DocumentModel record = ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");

        List<String> kept = together(run, "bob", "carol");
        assertEquals(List.of("bob", "carol"), kept);
        Fixtures.assertState(session, run, Disposition.DISPOSED);
        List<String> approvers = new ArrayList<>(approvers(run));
        Collections.sort(approvers);
        assertEquals(List.of("bob", "carol"), approvers);
        assertTrue(!session.exists(record.getRef()));
        assertEquals(1, certificates());
    }

    /** One person approving twice at once is one approval, and never a disposal. */
    @Test
    public void onePersonsTwoApprovalsAtOnceCountOnce() throws Exception {
        DocumentModel record = ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");

        List<String> kept = together(run, "bob", "bob");
        assertEquals(List.of("bob"), kept);
        assertEquals(List.of("bob"), approvers(run));
        Fixtures.assertState(session, run, Disposition.PENDING);
        assertTrue(session.exists(record.getRef()));
        assertEquals(0, certificates());
    }

    /** Two second approvals at once: the run is disposed of once, with one certificate and two approvers. */
    @Test
    public void twoSecondApprovalsAtOnceDisposeOnce() throws Exception {
        DocumentModel record = ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);

        List<String> kept = together(run, "carol", "erin");
        assertEquals(1, kept.size());
        Fixtures.assertState(session, run, Disposition.DISPOSED);
        assertEquals(List.of("bob", kept.get(0)), approvers(run));
        assertTrue(!session.exists(record.getRef()));
        assertEquals(1, certificates());
    }

    /** Two runs started at once, by the same records: the second sees the first's, and nothing is due. */
    @Test
    public void twoStartsAtOnceHoldNoRecordTwice() throws Exception {
        ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        List<String> kept = together(null, "alice", "alice");
        assertEquals(List.of("alice"), kept);
        assertEquals(1, session.query("SELECT * FROM " + Disposition.RUN_TYPE).size());
        assertEquals(1L, session.getDocument(folder.getRef()).getPropertyValue(Disposition.SEQUENCE));
    }

    /**
     * Files two requests at once, by {@code first} and {@code second}, each in a transaction of its
     * own, held as they are filed until both have been: approvals of {@code run}, or starts when it
     * is {@code null}. The names whose request was kept, sorted.
     */
    private List<String> together(DocumentModel run, String first, String second) throws Exception {
        TestHooks.filing = new CyclicBarrier(2);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        List<Future<?>> filings = new ArrayList<>();
        for (String name : List.of(first, second)) {
            filings.add(pool.submit(() -> TransactionHelper.runInTransaction(() -> {
                CoreSession person = CoreInstance.getCoreSession(session.getRepositoryName(), Fixtures.person(name));
                String action = run == null ? Disposition.START : Disposition.APPROVE;
                DocumentModel request = person.createDocumentModel(Fixtures.RUNS, action, Disposition.REQUEST_TYPE);
                request.setPropertyValue(Disposition.REQUEST_ACTION, action);
                request.setPropertyValue(Disposition.REQUEST_RUN, run == null ? null : run.getId());
                person.createDocument(request);
                person.save();
            })));
        }
        for (Future<?> filing : filings) {
            try {
                filing.get(60, TimeUnit.SECONDS);
            } catch (java.util.concurrent.ExecutionException e) {
                // Refused by the add-on, once the other had been taken.
            }
        }
        pool.shutdown();
        TestHooks.reset();
        commit(session);
        List<String> kept = new ArrayList<>();
        String action = run == null ? Disposition.START : Disposition.APPROVE;
        for (DocumentModel request : session.query("SELECT * FROM " + Disposition.REQUEST_TYPE + " WHERE "
                + Disposition.REQUEST_ACTION + " = '" + action + "' AND " + Disposition.REQUEST_BY + " IN ('" + first
                + "', '" + second + "')")) {
            if (run == null || run.getId().equals(request.getPropertyValue(Disposition.REQUEST_RUN))) {
                kept.add((String) request.getPropertyValue(Disposition.REQUEST_BY));
            }
        }
        Collections.sort(kept);
        return kept;
    }
}
