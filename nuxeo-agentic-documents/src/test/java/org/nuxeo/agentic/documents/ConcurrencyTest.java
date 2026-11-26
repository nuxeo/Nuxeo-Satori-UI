/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.documents.ControlledDocuments.NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.STATUS;
import static org.nuxeo.agentic.documents.ControlledDocuments.SUPERSEDED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.SUPERSEDES;
import static org.nuxeo.agentic.documents.Library.ALICE;
import static org.nuxeo.agentic.documents.Library.DRAWING;
import static org.nuxeo.agentic.documents.Library.DRAWINGS;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Many people at once, each creation in a transaction of its own, on its own thread: numbers stay
 * unique, and the only gaps are the numbers the sequencer documents it gives up, those of the
 * transactions that rolled back. And of many revisions superseding one at once, one wins.
 */
@RunWith(FeaturesRunner.class)
@Features(ControlledDocumentsFeature.class)
public class ConcurrencyTest {

    /** Threads at once, the server's request threads in miniature. */
    static final int THREADS = 16;

    /** Creations per thread, each in its own transaction. */
    static final int PER_THREAD = 25;

    /** Every so many creations a thread rolls its transaction back, after the number was taken. */
    static final int ROLL_BACK_EVERY = 7;

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private String repository;

    @Before
    public void setUp() {
        repository = core.getRepositoryName();
        Library.create(session);
        Library.resetSeries("DWG");
        // The test's own transaction is not the workers', and holds nothing they wait on.
        TransactionHelper.commitOrRollbackTransaction();
    }

    @Test
    public void numbersStayUniqueAndTheOnlyGapsAreTheRolledBackCreations() throws Exception {
        Set<String> committed = ConcurrentHashMap.newKeySet();
        Set<String> rolledBack = ConcurrentHashMap.newKeySet();
        List<Throwable> failures = Collections.synchronizedList(new ArrayList<>());
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(THREADS);
        try {
            List<Future<?>> workers = new ArrayList<>();
            for (int t = 0; t < THREADS; t++) {
                int thread = t;
                workers.add(pool.submit(() -> {
                    start.await();
                    for (int i = 0; i < PER_THREAD; i++) {
                        int n = i;
                        boolean rollBack = (thread * PER_THREAD + i) % ROLL_BACK_EVERY == 0;
                        String[] number = new String[1];
                        try {
                            TransactionHelper.runInTransaction(() -> {
                                CoreSession alice = Library.as(repository, ALICE);
                                DocumentModel doc = Library.first(alice, DRAWINGS, DRAWING,
                                        "t" + thread + "-" + n, "DWG");
                                number[0] = Library.text(doc, NUMBER);
                                if (rollBack) {
                                    throw new RolledBack();
                                }
                                return null;
                            });
                            committed.add(number[0]);
                        } catch (RolledBack e) {
                            rolledBack.add(number[0]);
                        } catch (Throwable e) {
                            failures.add(e);
                        }
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

        assertEquals("no creation failed but those rolled back on purpose: " + failures, List.of(), failures);
        int total = THREADS * PER_THREAD;
        assertEquals(total, committed.size() + rolledBack.size());
        assertTrue("some were rolled back", !rolledBack.isEmpty());

        // What the repository holds: every committed number once, and none of the rolled back.
        List<String> stored = storedNumbers();
        assertEquals("no number is held by two documents", stored.size(), new TreeSet<>(stored).size());
        assertEquals(new TreeSet<>(committed), new TreeSet<>(stored));
        for (String number : rolledBack) {
            assertTrue(number + " was rolled back and is not stored", !stored.contains(number));
        }

        // The numbers given, committed or not, are 1 to total, each once: no gap, and a rolled
        // back number is never given again.
        Set<String> given = new TreeSet<>(committed);
        given.addAll(rolledBack);
        Set<String> expected = new TreeSet<>();
        for (int i = 1; i <= total; i++) {
            expected.add(String.format("DWG-%05d", i));
        }
        assertEquals(expected, given);

        // And the next number follows them: none is given back.
        String next = Library.inTransactionAs(repository, ALICE,
                s -> Library.text(Library.first(s, DRAWINGS, DRAWING, "after", "DWG"), NUMBER));
        assertEquals(String.format("DWG-%05d", total + 1), next);
    }

    /**
     * Many people supersede revision A at once, each in a transaction of its own. One wins: A is
     * superseded by it alone, it is the only current revision of the number, and every other
     * creation was rolled back whole, by the add-on's check or by the repository refusing a write
     * to A that another transaction changed since it was read.
     */
    @Test
    public void ofManyRevisionsSupersedingOneAtOnceOneWins() throws Exception {
        String a = Library.inTransactionAs(repository, ALICE,
                s -> Library.first(s, DRAWINGS, DRAWING, "pump", "DWG").getId());
        TransactionHelper.commitOrRollbackTransaction();

        List<String> won = Collections.synchronizedList(new ArrayList<>());
        Map<String, Integer> refusals = new ConcurrentHashMap<>();
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(THREADS);
        try {
            List<Future<?>> workers = new ArrayList<>();
            for (int t = 0; t < THREADS; t++) {
                int thread = t;
                workers.add(pool.submit(() -> {
                    start.await();
                    try {
                        String b = TransactionHelper.runInTransaction(() -> Library
                                                                                 .revise(Library.as(repository, ALICE),
                                                                                         DRAWINGS, DRAWING, "b" + thread, a)
                                                                                 .getId());
                        won.add(b);
                    } catch (RuntimeException e) {
                        String kind = e instanceof NuxeoException refusal ? "HTTP " + refusal.getStatusCode()
                                : e.getClass().getSimpleName();
                        refusals.merge(kind, 1, Integer::sum);
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

        assertEquals("one revision won, the others were refused: " + refusals, 1, won.size());
        // Each loser refused as a conflict, by the claim or by finding A already superseded, and none
        // by anything else, such as a lock timeout or a concurrent update the repository detected.
        assertEquals(Map.of("HTTP 409", THREADS - 1), refusals);
        String b = won.get(0);
        DocumentModel stored = Library.stored(repository, a);
        assertEquals("superseded", Library.text(stored, STATUS));
        assertEquals(b, Library.text(stored, SUPERSEDED_BY));

        List<Map<String, String>> revisions = TransactionHelper.runInTransaction(() -> CoreInstance.doPrivileged(
                repository,
                (CoreSession s) -> s.queryProjection("SELECT ecm:uuid, docctl:status FROM Document WHERE "
                        + "docctl:supersedes = '" + a + "' AND ecm:isVersion = 0", 0, 0)
                                    .stream()
                                    .map(row -> Map.of("id", (String) row.get("ecm:uuid"), "status",
                                            (String) row.get("docctl:status")))
                                    .collect(Collectors.toList())));
        assertEquals("only the winner names A as the revision it supersedes", List.of(Map.of("id", b, "status",
                "current")), revisions);
        assertNull(Library.text(Library.stored(repository, b), SUPERSEDED_BY));
        assertEquals(a, Library.text(Library.stored(repository, b), SUPERSEDES));
    }

    private List<String> storedNumbers() {
        return TransactionHelper.runInTransaction(() -> CoreInstance.doPrivileged(repository,
                (CoreSession s) -> s.queryProjection("SELECT docctl:number FROM Document WHERE "
                        + "ecm:mixinType = 'ControlledDocument' AND ecm:isVersion = 0 AND ecm:isProxy = 0", 0, 0)
                                    .stream()
                                    .map(row -> (String) row.get("docctl:number"))
                                    .collect(Collectors.toList())));
    }

    /** A worker's own failure, after its number was taken, so that its transaction rolls back. */
    private static final class RolledBack extends RuntimeException {
        private static final long serialVersionUID = 1L;
    }
}
