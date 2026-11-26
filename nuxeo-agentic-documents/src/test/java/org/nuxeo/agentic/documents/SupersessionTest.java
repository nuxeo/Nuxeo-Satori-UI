/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.documents.ControlledDocuments.NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.REVISION;
import static org.nuxeo.agentic.documents.ControlledDocuments.SERIES;
import static org.nuxeo.agentic.documents.ControlledDocuments.STATUS;
import static org.nuxeo.agentic.documents.ControlledDocuments.SUPERSEDED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.SUPERSEDES;
import static org.nuxeo.agentic.documents.Library.ALICE;
import static org.nuxeo.agentic.documents.Library.BOB;
import static org.nuxeo.agentic.documents.Library.CAROL;
import static org.nuxeo.agentic.documents.Library.DRAWING;
import static org.nuxeo.agentic.documents.Library.DRAWINGS;
import static org.nuxeo.agentic.documents.Library.SPEC;
import static org.nuxeo.agentic.documents.Library.text;

import java.util.List;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.VersioningOption;
import org.nuxeo.ecm.core.api.trash.TrashService;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * A new revision names the one it supersedes; the old one is marked and linked back, in the same
 * transaction, or neither is written.
 */
@RunWith(FeaturesRunner.class)
@Features(ControlledDocumentsFeature.class)
@Deploy("org.nuxeo.agentic.documents.test:OSGI-INF/test-failing-write-contrib.xml")
public class SupersessionTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private String repository;

    /** Revision A of DWG-00001, alice's, committed. */
    private String a;

    @Before
    public void setUp() {
        repository = core.getRepositoryName();
        Library.create(session);
        Library.resetSeries("DWG", "SPEC");
        a = Library.inTransactionAs(repository, ALICE,
                s -> Library.first(s, DRAWINGS, DRAWING, "pump", "DWG").getId());
    }

    @Test
    public void aNewRevisionTakesTheNumberAndTheNextRevisionAndTheOldOneIsSupersededBothWays() {
        String b = Library.inTransactionAs(repository, ALICE,
                s -> Library.revise(s, DRAWINGS, DRAWING, "pump-b", a).getId());

        DocumentModel revisionA = Library.stored(repository, a);
        DocumentModel revisionB = Library.stored(repository, b);
        assertEquals("DWG-00001", text(revisionB, NUMBER));
        assertEquals("DWG", text(revisionB, SERIES));
        assertEquals("B", text(revisionB, REVISION));
        assertEquals("current", text(revisionB, STATUS));
        assertEquals(a, text(revisionB, SUPERSEDES));
        assertNull(text(revisionB, SUPERSEDED_BY));
        assertEquals("superseded", text(revisionA, STATUS));
        assertEquals(b, text(revisionA, SUPERSEDED_BY));
        // The revision keeps its own place in the series: superseding takes no new number.
        assertEquals("DWG-00002", Library.inTransactionAs(repository, ALICE,
                s -> text(Library.first(s, DRAWINGS, DRAWING, "valve", "DWG"), NUMBER)));
    }

    @Test
    public void revisionsFollowEachOtherAndANumberedSeriesCountsInNumbers() {
        String b = Library.inTransactionAs(repository, ALICE,
                s -> Library.revise(s, DRAWINGS, DRAWING, "pump-b", a).getId());
        String c = Library.inTransactionAs(repository, ALICE,
                s -> Library.revise(s, DRAWINGS, DRAWING, "pump-c", b).getId());
        assertEquals("C", text(Library.stored(repository, c), REVISION));
        assertEquals(c, text(Library.stored(repository, b), SUPERSEDED_BY));

        String spec1 = Library.inTransactionAs(repository, ALICE,
                s -> Library.first(s, DRAWINGS, SPEC, "spec", "SPEC").getId());
        String spec2 = Library.inTransactionAs(repository, ALICE,
                s -> Library.revise(s, DRAWINGS, SPEC, "spec-2", spec1).getId());
        assertEquals("SPEC-001", text(Library.stored(repository, spec2), NUMBER));
        assertEquals("2", text(Library.stored(repository, spec2), REVISION));
    }

    @Test
    public void aRevisionAlreadySupersededIsNotSupersededAgain() {
        Library.inTransactionAs(repository, ALICE, s -> Library.revise(s, DRAWINGS, DRAWING, "pump-b", a));

        NuxeoException refused = refusedAs(ALICE, DRAWINGS, DRAWING, a);
        assertEquals(409, refused.getStatusCode());
        assertTrue(refused.getMessage(), refused.getMessage().contains("is not current"));
    }

    @Test
    public void onlyALiveControlledDocumentOfTheSameTypeThatExistsIsSuperseded() {
        String plain = Library.inTransactionAs(repository, ALICE, s -> {
            DocumentModel file = s.createDocumentModel(DRAWINGS, "plain", "File");
            return s.createDocument(file).getId();
        });
        assertEquals(400, refusedAs(ALICE, DRAWINGS, DRAWING, plain).getStatusCode());
        assertEquals(400, refusedAs(ALICE, DRAWINGS, SPEC, a).getStatusCode());
        assertEquals(400, refusedAs(ALICE, DRAWINGS, DRAWING, "0b1c2d3e-0000-4000-8000-000000000000")
                .getStatusCode());
        assertEquals(400, refusedAs(ALICE, DRAWINGS, DRAWING, "../library").getStatusCode());
        // A version of A is not A.
        String version = Library.inTransactionAs(repository, ALICE,
                s -> s.checkIn(new IdRef(a), VersioningOption.MAJOR, "v1").reference().toString());
        assertEquals(400, refusedAs(ALICE, DRAWINGS, DRAWING, version).getStatusCode());
        assertCurrent(a);
    }

    @Test
    public void aRevisionInTheTrashIsNotSuperseded() {
        Library.inTransactionAs(repository, ALICE, s -> {
            Framework.getService(TrashService.class).trashDocument(s.getDocument(new IdRef(a)));
            return null;
        });
        assertEquals(409, refusedAs(ALICE, DRAWINGS, DRAWING, a).getStatusCode());
    }

    /**
     * Bob may read A, and create in his own folder, but not write A: his revision is refused, and
     * nothing of it is written, neither the revision nor a change to A.
     */
    @Test
    public void aUserWhoMayNotWriteTheOldRevisionIsRefusedAndNothingIsWritten() {
        assertTrue(Library.inTransactionAs(repository, BOB,
                s -> s.hasPermission(new IdRef(a), "Read")));

        NuxeoException refused = refusedAs(BOB, "/library/bob", DRAWING, a);
        assertEquals(403, refused.getStatusCode());
        assertTrue(refused.getMessage(), refused.getMessage().contains("You may not write the revision"));

        assertCurrent(a);
        assertEquals(List.of(), revisionsOf(a));
    }

    /** Carol may not read A at all: the platform's own refusal, and nothing written. */
    @Test
    public void aUserWhoMayNotReadTheOldRevisionIsRefused() {
        NuxeoException refused = refusedAs(CAROL, "/library/carol", DRAWING, a);
        assertEquals(403, refused.getStatusCode());
        assertCurrent(a);
        assertEquals(List.of(), revisionsOf(a));
    }

    /**
     * The supersession's second write, A marked superseded, fails after B was created: the
     * transaction rolls back whole, so B does not exist and A is still current.
     */
    @Test
    public void whenMarkingTheOldRevisionFailsTheNewOneIsNotCreatedEither() {
        FailingWrite.failNext(a);
        try {
            NuxeoException refused = refusedAs(ALICE, DRAWINGS, DRAWING, a);
            assertTrue(refused.getMessage(), refused.getMessage().contains(FailingWrite.MESSAGE));
        } finally {
            FailingWrite.reset();
        }
        assertTrue("the failing write ran after B was created", FailingWrite.sawCreatedRevision());
        assertCurrent(a);
        assertEquals(List.of(), revisionsOf(a));
        // The failed attempt's claim on A went with its transaction: A is superseded at once.
        String b = Library.inTransactionAs(repository, ALICE,
                s -> Library.revise(s, DRAWINGS, DRAWING, "pump-b", a).getId());
        assertEquals(b, text(Library.stored(repository, a), SUPERSEDED_BY));
    }

    /**
     * A caller that catches the refusal and goes on cannot commit the half: the refusal marked the
     * transaction for rollback, so the new revision, created before the old one's write failed,
     * goes with it.
     */
    @Test
    public void aCallerThatCatchesTheRefusalCannotCommitTheNewRevisionAlone() {
        FailingWrite.failNext(a);
        try {
            Library.inTransactionAs(repository, ALICE, s -> {
                try {
                    Library.revise(s, DRAWINGS, DRAWING, "pump-b", a);
                } catch (NuxeoException expected) {
                    // Carry on, as a careless caller would, and let the transaction end normally.
                }
                return null;
            });
        } finally {
            FailingWrite.reset();
        }
        assertTrue(FailingWrite.sawCreatedRevision());
        assertCurrent(a);
        assertEquals(List.of(), revisionsOf(a));
    }

    /**
     * A transaction already marked for rollback could never release a claim when it rolls back,
     * so it is given none: the supersession is refused, and A stays free to be superseded at
     * once by a transaction that can commit. The session is used first, as a caller that carries
     * on after a failure has: a session first used after the mark is refused by the platform,
     * before any listener.
     */
    @Test
    public void aTransactionMarkedForRollbackClaimsNothing() {
        NuxeoException refused = assertThrows(NuxeoException.class, () -> Library.inTransactionAs(repository,
                ALICE, s -> {
                    s.getDocument(new IdRef(a));
                    TransactionHelper.setTransactionRollbackOnly();
                    return Library.revise(s, DRAWINGS, DRAWING, "doomed", a);
                }));
        assertEquals(refused.toString(), 409, refused.getStatusCode());
        assertTrue(refused.getMessage(), refused.getMessage().contains("needs an active transaction"));
        assertCurrent(a);
        String b = Library.inTransactionAs(repository, ALICE,
                s -> Library.revise(s, DRAWINGS, DRAWING, "pump-b", a).getId());
        assertEquals(b, text(Library.stored(repository, a), SUPERSEDED_BY));
    }

    /** Whatever fails later in the same transaction takes both writes back with it. */
    @Test
    public void aFailureLaterInTheTransactionTakesBothWritesBack() {
        assertThrows(IllegalStateException.class, () -> Library.inTransaction(() -> {
            CoreSession alice = Library.as(repository, ALICE);
            DocumentModel b = Library.revise(alice, DRAWINGS, DRAWING, "pump-b", a);
            assertEquals("superseded", text(alice.getDocument(new IdRef(a)), STATUS));
            assertNotNull(b.getId());
            throw new IllegalStateException("the caller's own failure");
        }));
        assertCurrent(a);
        assertEquals(List.of(), revisionsOf(a));
        String b = Library.inTransactionAs(repository, ALICE,
                s -> Library.revise(s, DRAWINGS, DRAWING, "pump-b", a).getId());
        assertEquals(b, text(Library.stored(repository, a), SUPERSEDED_BY));
    }

    // ------------------------------------------------------------------ helpers

    private NuxeoException refusedAs(String user, String folder, String type, String supersedes) {
        return assertThrows(NuxeoException.class, () -> Library.inTransactionAs(repository, user,
                s -> Library.revise(s, folder, type, "refused", supersedes)));
    }

    private void assertCurrent(String id) {
        DocumentModel doc = Library.stored(repository, id);
        assertEquals("current", text(doc, STATUS));
        assertNull(text(doc, SUPERSEDED_BY));
    }

    /** The ids of the live documents that name this one in docctl:supersedes, as stored. */
    private List<String> revisionsOf(String id) {
        return Library.inTransaction(() -> CoreInstance.doPrivileged(repository,
                (CoreSession s) -> s.queryProjection("SELECT ecm:uuid FROM Document WHERE docctl:supersedes = '" + id
                        + "' AND ecm:isVersion = 0", 0, 0)
                                    .stream()
                                    .map(row -> (String) row.get("ecm:uuid"))
                                    .toList()));
    }
}
