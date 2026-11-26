/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.junit.Assert.assertTrue;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * A piece of work held open in a transaction of its own, on a thread of its own: done, but not yet
 * committed, while the test does something else; then committed.
 */
final class TransactionalHold {

    private TransactionalHold() {
    }

    /**
     * Do {@code held} in a transaction on another thread, then, while that transaction is still open,
     * {@code meanwhile} on this one; then let the held transaction commit, and wait for it.
     */
    static void run(String repository, Supplier<?> held, Runnable meanwhile) throws Exception {
        if (TransactionHelper.isTransactionActiveOrMarkedRollback()) {
            TransactionHelper.commitOrRollbackTransaction();
        }
        ExecutorService pool = Executors.newSingleThreadExecutor();
        CountDownLatch done = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try {
            Future<?> holding = pool.submit(() -> TransactionHelper.runInTransaction(() -> {
                try {
                    return held.get();
                } finally {
                    done.countDown();
                    await(release);
                }
            }));
            assertTrue("the held work did not finish", done.await(1, TimeUnit.MINUTES));
            try {
                meanwhile.run();
            } finally {
                release.countDown();
            }
            holding.get(1, TimeUnit.MINUTES);
        } finally {
            pool.shutdownNow();
            if (!TransactionHelper.isTransactionActiveOrMarkedRollback()) {
                TransactionHelper.startTransaction();
            }
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
}
