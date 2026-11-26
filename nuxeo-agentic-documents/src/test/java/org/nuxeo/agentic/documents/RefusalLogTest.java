/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.nuxeo.agentic.documents.Library.ALICE;
import static org.nuxeo.agentic.documents.Library.DRAWING;
import static org.nuxeo.agentic.documents.Library.DRAWINGS;

import java.util.List;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.event.impl.EventServiceImpl;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.test.runner.LogCaptureFeature;

/**
 * A refusal is the user's to read, not the server's error log's: the event service logs a
 * synchronous listener's exception at ERROR, with its stack, unless it is a
 * {@code RecoverableClientException}, so a user who may create or write could otherwise fill the
 * log. An unforeseen failure is still logged as the error it is, which shows the capture works.
 */
@RunWith(FeaturesRunner.class)
@Features({ ControlledDocumentsFeature.class, LogCaptureFeature.class })
@Deploy("org.nuxeo.agentic.documents.test:OSGI-INF/test-failing-write-contrib.xml")
@LogCaptureFeature.FilterOn(loggerClass = EventServiceImpl.class, logLevel = "ERROR")
public class RefusalLogTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    @Inject
    protected LogCaptureFeature.Result logs;

    private String repository;

    @Before
    public void setUp() {
        repository = core.getRepositoryName();
        Library.create(session);
        Library.resetSeries("DWG");
        logs.clear();
    }

    @Test
    public void aRefusalIsNotLoggedAsAnError() {
        NuxeoException unknown = assertThrows(NuxeoException.class, () -> Library.inTransactionAs(repository,
                ALICE, s -> Library.first(s, DRAWINGS, DRAWING, "unknown", "NOPE")));
        assertEquals(400, unknown.getStatusCode());
        String a = Library.inTransactionAs(repository, ALICE,
                s -> Library.first(s, DRAWINGS, DRAWING, "pump", "DWG").getId());
        Library.inTransactionAs(repository, ALICE, s -> Library.revise(s, DRAWINGS, DRAWING, "pump-b", a));
        NuxeoException again = assertThrows(NuxeoException.class, () -> Library.inTransactionAs(repository,
                ALICE, s -> Library.revise(s, DRAWINGS, DRAWING, "pump-b2", a)));
        assertEquals(409, again.getStatusCode());
        assertEquals(List.of(), logs.getCaughtEventMessages());
    }

    @Test
    public void anUnforeseenFailureIsStillLoggedAsAnError() {
        String a = Library.inTransactionAs(repository, ALICE,
                s -> Library.first(s, DRAWINGS, DRAWING, "pump", "DWG").getId());
        FailingWrite.failNext(a);
        try {
            assertThrows(NuxeoException.class, () -> Library.inTransactionAs(repository, ALICE,
                    s -> Library.revise(s, DRAWINGS, DRAWING, "pump-b", a)));
        } finally {
            FailingWrite.reset();
        }
        assertFalse(logs.getCaughtEventMessages().isEmpty());
    }
}
