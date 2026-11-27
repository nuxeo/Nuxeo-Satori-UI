/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import org.nuxeo.agentic.capture.Profile.CaptureClass;

/** A provider the tests answer for: whatever they set, or a failure of the kind they set. */
public class ScriptedProvider implements CaptureProvider {

    static volatile Classification classification;

    static volatile Extraction extraction = new Extraction(List.of());

    static volatile CaptureProviderException.Kind failure;

    static volatile RuntimeException crash;

    /** Marks the capture's transaction for rollback, and answers as if nothing were wrong. */
    static volatile boolean rollbackOnly;

    static final AtomicInteger CALLS = new AtomicInteger();

    static void reset() {
        classification = null;
        extraction = new Extraction(List.of());
        failure = null;
        crash = null;
        rollbackOnly = false;
        CALLS.set(0);
    }

    @Override
    public void init(String id, CaptureSettings settings) {
    }

    @Override
    public boolean configured() {
        return true;
    }

    @Override
    public Classification classify(Submission submission) throws CaptureProviderException {
        CALLS.incrementAndGet();
        if (crash != null) {
            throw crash;
        }
        if (failure != null) {
            throw new CaptureProviderException(failure);
        }
        if (rollbackOnly) {
            org.nuxeo.runtime.transaction.TransactionHelper.setTransactionRollbackOnly();
        }
        return classification;
    }

    @Override
    public Extraction extract(Submission submission, CaptureClass captureClass) {
        CALLS.incrementAndGet();
        return extraction;
    }
}
