/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.documents.ControlledDocuments.ACKNOWLEDGED;
import static org.nuxeo.agentic.documents.ControlledDocuments.CLOSED;
import static org.nuxeo.agentic.documents.ControlledDocuments.FOR_REVIEW;
import static org.nuxeo.agentic.documents.ControlledDocuments.RETURNED;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_STATUS;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_COMMENT;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_STATUS;
import static org.nuxeo.agentic.documents.Library.ALICE;
import static org.nuxeo.agentic.documents.Library.BOB;
import static org.nuxeo.agentic.documents.Library.DRAWING;
import static org.nuxeo.agentic.documents.Library.DRAWINGS;
import static org.nuxeo.agentic.documents.Library.text;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.core.test.annotations.Granularity;
import org.nuxeo.ecm.core.test.annotations.RepositoryConfig;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Where people acting at once could break a transmittal or a review cycle, each on a thread and in
 * a transaction of its own, started together: many recipients answer at once, and each answer is
 * kept; one receipt is answered many times at once, and one answer is; many cycles open on one
 * revision at once, and one does; and reviewers comment while the opener closes the cycle, and a
 * closed cycle never holds an open comment.
 */
@RunWith(FeaturesRunner.class)
@Features(ControlledDocumentsFeature.class)
@RepositoryConfig(cleanup = Granularity.METHOD)
public class WorkflowConcurrencyTest {

    static final int THREADS = 16;

    /** Rounds of comments racing a close, each on a revision and a cycle of its own. */
    static final int ROUNDS = 8;

    /** Reviewers commenting in each round, beside the one close. */
    static final int COMMENTERS = 6;

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private String repository;

    @Before
    public void setUp() {
        repository = core.getRepositoryName();
        Library.create(session);
        Library.createDesks(session);
        Library.resetSeries("DWG", "TR");
        TransactionHelper.commitOrRollbackTransaction();
    }

    /** What one task came to: what it returned, or how it was refused, {@code HTTP 409} and the like. */
    private record Outcome(Object value, String refused) {

        boolean done() {
            return refused == null;
        }

        String kind() {
            return done() ? "done" : refused;
        }
    }

    /** Each task on a thread of its own, started together: what each came to, in the tasks' order. */
    private static <T> List<Outcome> atOnce(List<Callable<T>> tasks) throws Exception {
        Outcome[] outcomes = new Outcome[tasks.size()];
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(tasks.size());
        try {
            List<Future<?>> workers = new ArrayList<>();
            for (int t = 0; t < tasks.size(); t++) {
                int index = t;
                Callable<T> task = tasks.get(t);
                workers.add(pool.submit(() -> {
                    start.await();
                    try {
                        outcomes[index] = new Outcome(TransactionHelper.runInTransaction(() -> {
                            try {
                                return task.call();
                            } catch (RuntimeException e) {
                                throw e;
                            } catch (Exception e) {
                                throw new IllegalStateException(e);
                            }
                        }), null);
                    } catch (RuntimeException e) {
                        outcomes[index] = new Outcome(null, e instanceof NuxeoException refusal
                                ? "HTTP " + refusal.getStatusCode()
                                : e.getClass().getSimpleName() + ": " + e.getMessage());
                    }
                    return null;
                }));
            }
            start.countDown();
            for (Future<?> worker : workers) {
                worker.get(5, TimeUnit.MINUTES);
            }
        } finally {
            pool.shutdownNow();
        }
        return List.of(outcomes);
    }

    private static Map<String, Integer> tally(List<Outcome> outcomes) {
        Map<String, Integer> counts = new ConcurrentHashMap<>();
        for (Outcome outcome : outcomes) {
            counts.merge(outcome.kind(), 1, Integer::sum);
        }
        return counts;
    }

    /** Recipients each answer their own receipt at once: no answer is lost to another's. */
    @Test
    public void manyRecipientsAnsweringAtOnceAreEachKept() throws Exception {
        List<String> recipients = new ArrayList<>();
        for (int i = 0; i < THREADS; i++) {
            recipients.add("recipient" + i);
        }
        // Any user may write the folder here, so that each may answer.
        Library.inTransactionAs(repository, Library.ADMINISTRATOR, s -> {
            DocumentModel folder = s.getDocument(new org.nuxeo.ecm.core.api.PathRef(Library.TRANSMITTALS));
            org.nuxeo.ecm.core.api.security.ACP acp = folder.getACP();
            for (String recipient : recipients) {
                acp.getOrCreateACL().add(new org.nuxeo.ecm.core.api.security.ACE(recipient, "ReadWrite", true));
            }
            s.setACP(folder.getRef(), acp, true);
            return null;
        });
        String valve = Library.inTransactionAs(repository, ALICE,
                s -> Library.first(s, DRAWINGS, DRAWING, "valve", "DWG").getId());
        String id = Library.inTransactionAs(repository, ALICE,
                s -> Library.issue(s, "tr", List.of(valve), recipients, FOR_REVIEW, 7).getId());
        TransactionHelper.commitOrRollbackTransaction();
        Map<String, DocumentModel> receipts = Library.receipts(repository, id);
        TransactionHelper.commitOrRollbackTransaction();

        List<Callable<String>> tasks = new ArrayList<>();
        for (String recipient : recipients) {
            String receipt = receipts.get(recipient).getId();
            tasks.add(() -> Library.answer(Library.as(repository, recipient), receipt, ACKNOWLEDGED, null).getId());
        }
        List<Outcome> outcomes = atOnce(tasks);

        assertEquals(Map.of("done", THREADS), tally(outcomes));
        for (DocumentModel receipt : Library.receipts(repository, id).values()) {
            assertEquals(ACKNOWLEDGED, text(receipt, TRR_STATUS));
        }
    }

    /** One receipt answered from many windows at once: one answer is taken, every other refused. */
    @Test
    public void oneReceiptAnsweredManyTimesAtOnceTakesOneAnswer() throws Exception {
        String valve = Library.inTransactionAs(repository, ALICE,
                s -> Library.first(s, DRAWINGS, DRAWING, "valve", "DWG").getId());
        String id = Library.inTransactionAs(repository, ALICE,
                s -> Library.issue(s, "tr", List.of(valve), List.of(BOB), FOR_REVIEW, 7).getId());
        String receipt = Library.receipts(repository, id).get(BOB).getId();
        TransactionHelper.commitOrRollbackTransaction();

        List<Callable<String>> tasks = new ArrayList<>();
        for (int i = 0; i < THREADS; i++) {
            String answer = i % 2 == 0 ? ACKNOWLEDGED : RETURNED;
            // Each answer its own comment, so that none writes back what another already wrote,
            // which would change nothing and be no answer of its own.
            String comment = "Answer " + i;
            tasks.add(() -> Library.answer(Library.as(repository, BOB), receipt, answer, comment)
                                   .getPropertyValue(TRR_COMMENT)
                                   .toString());
        }
        List<Outcome> outcomes = atOnce(tasks);

        // One answer, and every other a conflict: by the claim, or by finding it answered.
        assertEquals(Map.of("done", 1, "HTTP 409", THREADS - 1), tally(outcomes));
        String taken = (String) outcomes.stream().filter(Outcome::done).findFirst().get().value();
        DocumentModel stored = Library.stored(repository, receipt);
        assertEquals(taken, text(stored, TRR_COMMENT));
        int index = Integer.parseInt(taken.substring("Answer ".length()));
        assertEquals(index % 2 == 0 ? ACKNOWLEDGED : RETURNED, text(stored, TRR_STATUS));
    }

    /** Many cycles opened on one revision at once: one opens. */
    @Test
    public void ofManyCyclesOpenedOnOneRevisionAtOnceOneOpens() throws Exception {
        String a = Library.inTransactionAs(repository, ALICE,
                s -> Library.first(s, DRAWINGS, DRAWING, "pump", "DWG").getId());
        TransactionHelper.commitOrRollbackTransaction();

        List<Callable<String>> tasks = new ArrayList<>();
        for (int i = 0; i < THREADS; i++) {
            int n = i;
            tasks.add(() -> Library.openCycle(Library.as(repository, ALICE), "review" + n, a, List.of(BOB)).getId());
        }
        List<Outcome> outcomes = atOnce(tasks);

        assertEquals(Map.of("done", 1, "HTTP 409", THREADS - 1), tally(outcomes));
        long open = TransactionHelper.runInTransaction(() -> CoreInstance.doPrivileged(repository,
                (CoreSession s) -> (long) s.query("SELECT * FROM Document WHERE ecm:mixinType = 'ReviewCycle' AND "
                        + "rvw:document = '" + a + "'").size()));
        assertEquals(1L, open);
    }

    /**
     * One write in a cycle at a time, held open on purpose: two comments at once wrote the cycle's
     * own rows at once, as the comment manager saves the cycle with each comment's text, and the
     * database could deadlock them at commit, where the client got a failed commit, not a
     * conflict. So a second comment waits for the first's transaction to end, and is written then;
     * told to wait for nothing, it is refused, 409, "try again", with nothing written.
     */
    @Test
    public void aSecondCommentWaitsForTheFirstToEndAndIsRefusedOnlyAsAConflict() throws Exception {
        String revision = Library.inTransactionAs(repository, ALICE,
                s -> Library.first(s, DRAWINGS, DRAWING, "one-at-a-time", "DWG").getId());
        String cycle = Library.inTransactionAs(repository, ALICE,
                s -> Library.openCycle(s, "one-at-a-time", revision, List.of(BOB)).getId());
        TransactionHelper.commitOrRollbackTransaction();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            // The first comment's transaction, written and held open.
            CountDownLatch written = new CountDownLatch(1);
            CountDownLatch release = new CountDownLatch(1);
            Future<String> first = pool.submit(() -> TransactionHelper.runInTransaction(() -> {
                try {
                    return Comments.write(Library.as(repository, BOB), cycle, "First").getId();
                } finally {
                    written.countDown();
                    await(release);
                }
            }));
            assertTrue(written.await(1, TimeUnit.MINUTES));
            // The second waits for it, and is not refused.
            Future<String> second = pool.submit(() -> TransactionHelper.runInTransaction(
                    () -> Comments.write(Library.as(repository, BOB), cycle, "Second").getId()));
            Thread.sleep(500);
            assertFalse("the second comment waits while the first's transaction is open", second.isDone());
            release.countDown();
            assertTrue(first.get(1, TimeUnit.MINUTES) != null);
            assertTrue(second.get(1, TimeUnit.MINUTES) != null);
            assertEquals(2L, (long) TransactionHelper.runInTransaction(() -> CoreInstance.doPrivileged(repository,
                    (CoreSession s) -> (long) s.query("SELECT * FROM Document WHERE ecm:mixinType = 'ReviewComment' "
                            + "AND rvwc:cycle = '" + cycle + "'").size())));

            // Told to wait for nothing, the second is refused as a conflict while the first holds it.
            org.nuxeo.runtime.api.Framework.getProperties()
                                          .setProperty(ControlledDocumentComponent.CYCLE_WAIT_PROPERTY, "0");
            try {
                CountDownLatch held = new CountDownLatch(1);
                CountDownLatch done = new CountDownLatch(1);
                Future<String> holder = pool.submit(() -> TransactionHelper.runInTransaction(() -> {
                    try {
                        return Comments.write(Library.as(repository, BOB), cycle, "Third").getId();
                    } finally {
                        held.countDown();
                        await(done);
                    }
                }));
                assertTrue(held.await(1, TimeUnit.MINUTES));
                Future<NuxeoException> refused = pool.submit(() -> Library.refusedAs(repository, BOB,
                        s -> Comments.write(s, cycle, "Fourth")));
                NuxeoException conflict = refused.get(1, TimeUnit.MINUTES);
                assertEquals(409, conflict.getStatusCode());
                assertTrue(conflict.getMessage(), conflict.getMessage().contains("try again"));
                done.countDown();
                assertTrue(holder.get(1, TimeUnit.MINUTES) != null);
            } finally {
                org.nuxeo.runtime.api.Framework.getProperties().remove(ControlledDocumentComponent.CYCLE_WAIT_PROPERTY);
            }
            assertEquals(3L, (long) TransactionHelper.runInTransaction(() -> CoreInstance.doPrivileged(repository,
                    (CoreSession s) -> (long) s.query("SELECT * FROM Document WHERE ecm:mixinType = 'ReviewComment' "
                            + "AND rvwc:cycle = '" + cycle + "'").size())));
        } finally {
            pool.shutdownNow();
        }
    }

    /**
     * The fence, held open on purpose: while a comment's transaction is in it, the close is refused;
     * while a close's transaction holds it, the comment is; and once either ends, the other goes
     * through. Each held transaction waits on a latch, on a thread of its own.
     */
    @Test
    public void whileACommentIsInTheFenceTheCloseIsRefusedAndTheOtherWayRound() throws Exception {
        String revision = Library.inTransactionAs(repository, ALICE,
                s -> Library.first(s, DRAWINGS, DRAWING, "fenced", "DWG").getId());
        String cycle = Library.inTransactionAs(repository, ALICE,
                s -> Library.openCycle(s, "fenced", revision, List.of(BOB)).getId());
        TransactionHelper.commitOrRollbackTransaction();
        ControlledDocumentService service = org.nuxeo.runtime.api.Framework.getService(ControlledDocumentService.class);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            // A comment's transaction in the fence, held: the close is refused, and nothing closed.
            CountDownLatch in = new CountDownLatch(1);
            CountDownLatch release = new CountDownLatch(1);
            Future<Boolean> writer = pool.submit(() -> TransactionHelper.runInTransaction(() -> {
                boolean entered = service.enterCycle(cycle);
                in.countDown();
                await(release);
                return entered;
            }));
            assertTrue(in.await(1, TimeUnit.MINUTES));
            NuxeoException refused = Library.refusedAs(repository, ALICE, s -> Library.close(s, cycle));
            assertEquals(409, refused.getStatusCode());
            assertTrue(refused.getMessage(), refused.getMessage().contains("A comment is being written"));
            release.countDown();
            assertTrue(writer.get(1, TimeUnit.MINUTES));
            assertEquals("open", text(Library.stored(repository, cycle), RVW_STATUS));

            // A close's transaction holding the fence: the comment is refused, and nothing written.
            CountDownLatch taken = new CountDownLatch(1);
            CountDownLatch done = new CountDownLatch(1);
            Future<Boolean> closer = pool.submit(() -> {
                try {
                    return TransactionHelper.runInTransaction(() -> {
                        boolean held = service.closeCycle(cycle);
                        taken.countDown();
                        await(done);
                        // Not committed: the fence is open again when it ends.
                        TransactionHelper.setTransactionRollbackOnly();
                        return held;
                    });
                } finally {
                    taken.countDown();
                }
            });
            assertTrue(taken.await(1, TimeUnit.MINUTES));
            NuxeoException late = Library.refusedAs(repository, BOB, s -> Comments.write(s, cycle, "While closing"));
            assertEquals(409, late.getStatusCode());
            assertTrue(late.getMessage(), late.getMessage().contains("closed, or being closed"));
            done.countDown();
            assertTrue(closer.get(1, TimeUnit.MINUTES));

            // Both ended: a comment goes through, and then a close with it open is refused for it.
            Library.inTransactionAs(repository, BOB, s -> Comments.write(s, cycle, "After"));
            NuxeoException open = Library.refusedAs(repository, ALICE, s -> Library.close(s, cycle));
            assertTrue(open.getMessage(), open.getMessage().contains("1 comment of this review cycle is open"));
        } finally {
            pool.shutdownNow();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(1, TimeUnit.MINUTES)) {
                throw new IllegalStateException("the test never let it go");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    /**
     * Reviewers comment while the opener closes the cycle, every comment before resolved. Whoever
     * wins, a closed cycle holds no open comment: a comment written in it is refused, or the
     * close is. Round after round, each on a revision and a cycle of its own.
     */
    @Test
    public void aCommentAndACloseAtOnceNeverLeaveAClosedCycleWithAnOpenComment() throws Exception {
        Map<String, Integer> closes = new ConcurrentHashMap<>();
        Map<String, Integer> comments = new ConcurrentHashMap<>();
        int closed = 0;
        for (int round = 0; round < ROUNDS; round++) {
            int r = round;
            String revision = Library.inTransactionAs(repository, ALICE,
                    s -> Library.first(s, DRAWINGS, DRAWING, "d" + r, "DWG").getId());
            String cycle = Library.inTransactionAs(repository, ALICE,
                    s -> Library.openCycle(s, "c" + r, revision, List.of(BOB)).getId());
            TransactionHelper.commitOrRollbackTransaction();

            List<Callable<String>> tasks = new ArrayList<>();
            // The close first, then the comments: the outcomes come in the tasks' order.
            tasks.add(() -> Library.close(Library.as(repository, ALICE), cycle).getId());
            for (int i = 0; i < COMMENTERS; i++) {
                int n = i;
                tasks.add(() -> Comments.write(Library.as(repository, BOB), cycle, "Remark " + n).getId());
            }
            List<Outcome> outcomes = atOnce(tasks);
            Outcome close = outcomes.get(0);
            closes.merge(close.done() ? "closed" : close.kind(), 1, Integer::sum);
            for (Outcome comment : outcomes.subList(1, outcomes.size())) {
                comments.merge(comment.kind(), 1, Integer::sum);
            }

            DocumentModel stored = Library.stored(repository, cycle);
            long openComments = TransactionHelper.runInTransaction(() -> CoreInstance.doPrivileged(repository,
                    (CoreSession s) -> (long) s.query("SELECT * FROM Document WHERE ecm:mixinType = 'ReviewComment' "
                            + "AND rvwc:cycle = '" + cycle + "' AND rvwc:status = 'open'").size()));
            if (CLOSED.equals(text(stored, RVW_STATUS))) {
                closed++;
                assertEquals("round " + r + ": a closed cycle holds no open comment, " + outcomes, 0L, openComments);
            }
        }
        // A close ends closed, or refused as a conflict, and never by anything else.
        for (String kind : closes.keySet()) {
            assertTrue("a close ends closed or refused as a conflict: " + closes + ", comments " + comments,
                    kind.equals("closed") || kind.equals("HTTP 409"));
        }
        assertEquals(ROUNDS, closes.values().stream().mapToInt(Integer::intValue).sum());
        assertEquals((int) closes.getOrDefault("closed", 0), closed);
        // So does a comment: written, or refused by the fence or the closed cycle.
        for (String kind : comments.keySet()) {
            assertTrue("a comment is written or refused as a conflict: " + comments,
                    kind.equals("done") || kind.equals("HTTP 409"));
        }
    }
}
