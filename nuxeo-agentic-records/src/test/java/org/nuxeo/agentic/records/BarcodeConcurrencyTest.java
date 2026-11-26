package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;

import org.junit.Before;
import org.junit.Test;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.impl.UserPrincipal;
import org.nuxeo.ecm.core.uidgen.UIDGeneratorService;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Many people making physical records at once, each creation in a transaction of its own, on its
 * own thread, as the server's request threads: every barcode is unique and valid, and the only gaps
 * are the values of the creations that rolled back, which are never given again. On the SQL
 * key/value store of LTS 2025, on H2, whose compare-and-set gives up under contention.
 */
public class BarcodeConcurrencyTest extends PhysicalTestCase {

    static final int THREADS = 16;

    static final int PER_THREAD = 25;

    /** Every so many creations a thread rolls its transaction back, once the barcode was taken. */
    static final int ROLL_BACK_EVERY = 7;

    private static final class RolledBack extends RuntimeException {
        private static final long serialVersionUID = 1L;
    }

    @Before
    public void resetTheSequence() {
        Framework.getService(UIDGeneratorService.class).getSequencer().initSequence(Barcodes.SEQUENCE_KEY, 0L);
        // The workers' transactions are their own: the test's holds nothing they wait on.
        TransactionHelper.commitOrRollbackTransaction();
    }

    @Test
    public void barcodesStayUniqueAndTheOnlyGapsAreTheRolledBackCreations() throws Exception {
        String repository = session.getRepositoryName();
        String location = a1.getId();
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
                        String[] barcode = new String[1];
                        try {
                            TransactionHelper.runInTransaction(() -> {
                                CoreSession admin = CoreInstance.getCoreSession(repository,
                                        new UserPrincipal("Administrator", List.of("administrators"), false, true));
                                DocumentModel box = Physicals.item(admin, "Box " + thread + "-" + n, "box", location);
                                barcode[0] = (String) box.getPropertyValue(Physical.BARCODE);
                                if (rollBack) {
                                    throw new RolledBack();
                                }
                                return null;
                            });
                            committed.add(barcode[0]);
                        } catch (RolledBack e) {
                            rolledBack.add(barcode[0]);
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
        TransactionHelper.startTransaction();

        assertEquals("no creation failed but those rolled back on purpose: " + failures, List.of(), failures);
        int total = THREADS * PER_THREAD;
        assertEquals(total, committed.size() + rolledBack.size());
        assertFalse("some were rolled back", rolledBack.isEmpty());

        // What the repository holds: every committed barcode once, each valid, and none rolled back.
        List<String> stored = new ArrayList<>();
        for (var row : session.queryProjection("SELECT " + Physical.BARCODE + " FROM " + Physical.RECORD_TYPE, 0, 0)) {
            stored.add(String.valueOf(row.get(Physical.BARCODE)));
        }
        assertEquals("no barcode is held by two records", stored.size(), new TreeSet<>(stored).size());
        assertEquals(new TreeSet<>(committed), new TreeSet<>(stored));
        for (String barcode : stored) {
            assertTrue(barcode, Barcodes.valid(barcode));
        }
        for (String barcode : rolledBack) {
            assertFalse(barcode + " was rolled back and is not stored", stored.contains(barcode));
        }

        // The values given, committed or not, are 1 to total, each once: a rolled back one is never
        // given again.
        Set<Long> given = new TreeSet<>();
        for (String barcode : committed) {
            given.add(value(barcode));
        }
        for (String barcode : rolledBack) {
            given.add(value(barcode));
        }
        Set<Long> expected = new TreeSet<>();
        for (long i = 1; i <= total; i++) {
            expected.add(i);
        }
        assertEquals(expected, given);

        // And the next follows them.
        DocumentModel next = Physicals.item(session, "After", a1);
        assertEquals(total + 1, value((String) next.getPropertyValue(Physical.BARCODE)));
    }

    private static long value(String barcode) {
        Matcher matcher = Barcodes.BARCODE.matcher(barcode);
        assertTrue(barcode, matcher.matches());
        return Long.parseLong(matcher.group(2));
    }
}
