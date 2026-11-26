package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.records.Fixtures.commit;
import static org.nuxeo.agentic.records.Fixtures.daysAgo;
import static org.nuxeo.agentic.records.Fixtures.decide;
import static org.nuxeo.agentic.records.Fixtures.ended;
import static org.nuxeo.agentic.records.Fixtures.refused;
import static org.nuxeo.agentic.records.Fixtures.start;

import java.io.Serializable;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.junit.Test;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACP;

/**
 * Every refusal, on the server: each names its code, and nothing of the refused filing is written.
 * The checks these tests prove were each removed in turn, and each test was seen failing without its
 * check (the add-on's README, "Tests").
 */
public class DispositionRefusalTest extends DispositionTestCase {

    // --- Starting ----------------------------------------------------------------------------------

    @Test
    public void startingNeedsThePermission() {
        ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        assertEquals("permission", refused(() -> start(session, "dave")));
        assertEquals(0, session.query("SELECT * FROM " + Disposition.RUN_TYPE).size());
    }

    @Test
    public void aRunWithNothingDueIsRefused() {
        assertEquals("nothing-due", refused(() -> start(session, "alice")));
    }

    @Test
    public void aRecordIsInOneRunAtATime() {
        ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        start(session, "alice");
        assertEquals("nothing-due", refused(() -> start(session, "alice")));
        assertEquals(1, session.query("SELECT * FROM " + Disposition.RUN_TYPE).size());
    }

    // --- Approving ----------------------------------------------------------------------------------

    @Test
    public void theStarterMayNotApprove() {
        DocumentModel record = ended(session, "Claim 1001", rule, daysAgo(10));
        // alice holds both permissions: the two-person rule, not the permission, refuses her.
        ACP acp = session.getACP(folder.getRef());
        acp.getACL("local").add(0, new ACE("alice", Disposition.APPROVE_PERMISSION, true));
        session.setACP(folder.getRef(), acp, true);
        commit(session);
        DocumentModel run = start(session, "alice");

        assertEquals("self-approval", refused(() -> decide(session, "alice", run, Disposition.APPROVE)));
        assertTrue(approvers(run).isEmpty());

        decide(session, "bob", run, Disposition.APPROVE);
        assertEquals("self-approval", refused(() -> decide(session, "alice", run, Disposition.APPROVE)));
        assertEquals(List.of("bob"), approvers(run));
        Fixtures.assertState(session, run, Disposition.PENDING);
        assertTrue(session.exists(record.getRef()));
    }

    @Test
    public void theStarterIsRefusedWhateverTheCaseOfTheirName() {
        ended(session, "Claim 1001", rule, daysAgo(10));
        ACP acp = session.getACP(folder.getRef());
        acp.getACL("local").add(0, new ACE("Alice", Disposition.APPROVE_PERMISSION, true));
        session.setACP(folder.getRef(), acp, true);
        commit(session);
        DocumentModel run = start(session, "alice");
        assertEquals("self-approval", refused(() -> decide(session, "Alice", run, Disposition.APPROVE)));
    }

    @Test
    public void aSecondApprovalBySamePersonIsRefused() {
        DocumentModel record = ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);

        assertEquals("already-approved", refused(() -> decide(session, "bob", run, Disposition.APPROVE)));
        assertEquals(List.of("bob"), approvers(run));
        Fixtures.assertState(session, run, Disposition.PENDING);
        assertTrue("One person's two approvals are not two", session.exists(record.getRef()));
    }

    @Test
    public void approvingNeedsThePermission() {
        DocumentModel record = ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);

        // dave may read the folder and file in it, but holds no ApproveDisposition.
        assertEquals("permission", refused(() -> decide(session, "dave", run, Disposition.APPROVE)));
        assertEquals(List.of("bob"), approvers(run));
        assertTrue(session.exists(record.getRef()));
    }

    @Test
    public void rejectingNeedsAPermissionToo() {
        ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        assertEquals("permission", refused(() -> decide(session, "dave", run, Disposition.REJECT)));
        Fixtures.assertState(session, run, Disposition.PENDING);
    }

    /** StartDisposition lets a starter withdraw their own run, and no one else's. */
    @Test
    public void onlyItsStarterWithdrawsARunWithoutApproveDisposition() {
        ended(session, "Claim 1001", rule, daysAgo(10));
        ACP acp = session.getACP(folder.getRef());
        acp.getACL("local").add(0, new ACE("sam", Disposition.START_PERMISSION, true));
        session.setACP(folder.getRef(), acp, true);
        commit(session);
        DocumentModel run = start(session, "alice");
        assertEquals("permission", refused(() -> decide(session, "sam", run, Disposition.REJECT)));
        Fixtures.assertState(session, run, Disposition.PENDING);
    }

    @Test
    public void aClosedRunTakesNoDecision() {
        ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);
        decide(session, "carol", run, Disposition.APPROVE);
        assertEquals("not-pending", refused(() -> decide(session, "erin", run, Disposition.APPROVE)));
        assertEquals(List.of("bob", "carol"), approvers(run));
    }

    @Test
    public void aDecisionNamesARunOfTheFolder() {
        ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        assertEquals("no-run", refused(() -> decide(session, "bob", rule, Disposition.APPROVE)));
        assertEquals("bad-request", refused(() -> decide(session, "bob", run, "approve-twice")));
        assertTrue(approvers(run).isEmpty());
    }

    // --- Disposing ----------------------------------------------------------------------------------

    /**
     * A hold put on a record after its run started is seen at disposal: the run is halted and
     * nothing is disposed of, the held record named.
     */
    @Test
    public void aHoldPutOnAfterTheStartHaltsTheRunAndDisposesOfNothing() {
        DocumentModel free = ended(session, "Claim 1001", rule, daysAgo(10));
        DocumentModel later = ended(session, "Claim 1002", rule, daysAgo(5));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);

        session.setLegalHold(later.getRef(), true, "A dispute, after the run started");
        commit(session);

        DocumentModel last = decide(session, "carol", run, Disposition.APPROVE);
        assertEquals(Disposition.HALTED, last.getPropertyValue(Disposition.REQUEST_OUTCOME));
        Fixtures.assertState(session, run, Disposition.HALTED);
        assertTrue(session.exists(free.getRef()));
        assertTrue(session.exists(later.getRef()));
        assertEquals(0, certificates());

        DocumentModel stored = session.getDocument(run.getRef());
        assertNull(stored.getPropertyValue(Disposition.RUN_CERTIFICATE));
        List<Map<String, Serializable>> records = Dispositions.records(stored);
        assertEquals(Disposition.KEPT, records.get(0).get("status"));
        assertEquals(Disposition.REFUSED, records.get(1).get("status"));
        assertEquals("It is under a legal hold.", records.get(1).get("reason"));
        assertTrue(String.valueOf(stored.getPropertyValue(Disposition.RUN_HALT_REASON)).contains("nothing was disposed of"));

        // The record free of the hold is due again, in a run of its own.
        DocumentModel next = start(session, "alice");
        assertEquals(List.of(free.getId()), uids(next));
    }

    @Test
    public void aRetentionExtendedAfterTheStartHaltsTheRun() {
        DocumentModel record = ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);

        session.setRetainUntil(record.getRef(), Fixtures.calendar(Instant.now().plus(Duration.ofDays(365))), "Extended");
        commit(session);

        decide(session, "carol", run, Disposition.APPROVE);
        Fixtures.assertState(session, run, Disposition.HALTED);
        assertTrue(session.exists(record.getRef()));
        assertEquals("It is under retention.", Dispositions.records(session.getDocument(run.getRef())).get(0).get("reason"));
    }

    /** The day the module says the retention ended, moved later after the start: no query sees it, the re-check does. */
    @Test
    public void aRetentionEndMovedLaterAfterTheStartHaltsTheRun() {
        DocumentModel record = ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);

        DocumentModel moved = session.getDocument(record.getRef());
        moved.setPropertyValue(Disposition.RECORD_RETAIN_UNTIL, Fixtures.calendar(Instant.now().plus(Duration.ofDays(30))));
        session.saveDocument(moved);
        commit(session);

        decide(session, "carol", run, Disposition.APPROVE);
        Fixtures.assertState(session, run, Disposition.HALTED);
        assertTrue(session.exists(record.getRef()));
        assertEquals("It has no retention that has ended.",
                Dispositions.records(session.getDocument(run.getRef())).get(0).get("reason"));
    }

    @Test
    public void aRecordGoneSinceTheStartHaltsTheRun() {
        DocumentModel gone = ended(session, "Claim 1001", rule, daysAgo(10));
        DocumentModel kept = ended(session, "Claim 1002", rule, daysAgo(5));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);
        session.removeDocument(gone.getRef());
        commit(session);

        decide(session, "carol", run, Disposition.APPROVE);
        Fixtures.assertState(session, run, Disposition.HALTED);
        assertTrue(session.exists(kept.getRef()));
        assertEquals("It no longer exists.", Dispositions.records(session.getDocument(run.getRef())).get(0).get("reason"));
    }
}
