package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;

import org.junit.Test;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * What access logging costs a read: a person's request for a record under retention, answered and
 * committed, against the same request for a document of the same type that is no record. The
 * difference is what the view's entry costs the reader's request; the entry itself is written to the
 * audit afterwards, in the background, and is not on the reader's time.
 *
 * <p>
 * Measured, not assumed: each read is its own transaction, as a REST request is, with the
 * document read, written as JSON and the transaction committed. The bound is loose on purpose, for
 * a shared build machine; the figures measured are printed, and the README records them.
 */
public class RecordAccessCostTest extends RecordsAuditTestCase {

    static final int READS = 400;

    static final int WARM_UP = 200;

    /** The most a logged view may add to a read, on average. */
    static final Duration BOUND = Duration.ofMillis(2);

    @Test
    public void aLoggedViewCostsAReadLittle() throws IOException {
        DocumentModel record = retained("Claim 3001", Instant.now().plus(Duration.ofDays(3650)));
        DocumentModel plain = session.createDocumentModel(Fixtures.RECORDS, "claim-3002", "File");
        plain.setPropertyValue("dc:title", "Claim 3002");
        plain = session.createDocument(plain);
        audited();

        CoreSession dave = Fixtures.as(session, "dave");
        reads(dave, plain, WARM_UP);
        reads(dave, record, WARM_UP);
        audited();
        RecordsAuditFeature.clear();

        long[] plainNanos = new long[3];
        long[] recordNanos = new long[3];
        for (int round = 0; round < 3; round++) {
            plainNanos[round] = reads(dave, plain, READS);
            recordNanos[round] = reads(dave, record, READS);
        }
        audited();

        long plainBest = Math.min(plainNanos[0], Math.min(plainNanos[1], plainNanos[2]));
        long recordBest = Math.min(recordNanos[0], Math.min(recordNanos[1], recordNanos[2]));
        double plainMicros = plainBest / 1000.0 / READS;
        double recordMicros = recordBest / 1000.0 / READS;
        double addedMicros = recordMicros - plainMicros;
        System.out.println(String.format(Locale.ROOT,
                "RecordAccessCostTest: a read of a document that is no record %.0f µs, of a record under retention %.0f µs, "
                        + "so a logged view adds %.0f µs a read (best of 3 rounds of %d reads each)",
                plainMicros, recordMicros, addedMicros, READS));

        assertEquals("every view of the record was logged", 3 * READS,
                entries(RecordsAudit.RECORD_VIEWED, record).size());
        assertEquals("no view of the other document was", 0, entries(RecordsAudit.RECORD_VIEWED, plain).size());
        assertTrue("a logged view adds " + addedMicros + " µs a read, more than " + BOUND.toNanos() / 1000 + " µs",
                addedMicros * 1000 < BOUND.toNanos());
    }

    /**
     * What a view costs afterwards, off the reader's time: the add-on's writer building the view's
     * entry and adding it to the audit, one transaction's view at a time, as the background work of
     * each read does. On the tests' audit, a JPA store in H2; on a server, the audit's own store.
     */
    @Test
    public void aViewsEntryIsWrittenInTheBackgroundAtAMeasuredCost() {
        DocumentModel record = retained("Claim 3003", Instant.now().plus(Duration.ofDays(3650)));
        audited();
        DocumentModel read = Fixtures.as(session, "dave").getDocument(record.getRef());
        RecordsAuditWriter writer = new RecordsAuditWriter();
        java.util.function.Supplier<org.nuxeo.ecm.core.event.EventBundle> bundle = () -> {
            org.nuxeo.ecm.core.event.impl.EventBundleImpl one = new org.nuxeo.ecm.core.event.impl.EventBundleImpl();
            one.push(RecordsAudit.event(RecordsAudit.RECORD_VIEWED, read.getCoreSession(),
                    read.getCoreSession().getPrincipal(), read, null, new java.util.HashMap<>()));
            return one;
        };
        for (int index = 0; index < WARM_UP; index++) {
            writer.handleEvent(bundle.get());
        }
        long best = Long.MAX_VALUE;
        for (int round = 0; round < 3; round++) {
            long start = System.nanoTime();
            for (int index = 0; index < READS; index++) {
                writer.handleEvent(bundle.get());
            }
            best = Math.min(best, System.nanoTime() - start);
        }
        double micros = best / 1000.0 / READS;
        System.out.println(String.format(Locale.ROOT,
                "RecordAccessCostTest: a view's entry costs the background %.0f µs to build and write (best of 3 rounds of %d)",
                micros, READS));
        audited();
        assertEquals(WARM_UP + 3 * READS, entries(RecordsAudit.RECORD_VIEWED, record).size());
    }

    /** {@code count} reads of {@code doc} by {@code reader}, each in its own transaction: the nanoseconds they took. */
    private static long reads(CoreSession reader, DocumentModel doc, int count) throws IOException {
        if (TransactionHelper.isTransactionActive()) {
            TransactionHelper.commitOrRollbackTransaction();
        }
        long start = System.nanoTime();
        for (int index = 0; index < count; index++) {
            TransactionHelper.startTransaction();
            try {
                answer(reader.getDocument(doc.getRef()));
            } finally {
                TransactionHelper.commitOrRollbackTransaction();
            }
        }
        long took = System.nanoTime() - start;
        TransactionHelper.startTransaction();
        return took;
    }
}
