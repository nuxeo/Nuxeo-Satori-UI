/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.documents.ControlledDocuments.CLOSED;
import static org.nuxeo.agentic.documents.ControlledDocuments.COMMENT_FACET;
import static org.nuxeo.agentic.documents.ControlledDocuments.OPEN;
import static org.nuxeo.agentic.documents.ControlledDocuments.RESOLVED;
import static org.nuxeo.agentic.documents.ControlledDocuments.REVIEW_CYCLES;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVWC_CYCLE;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVWC_RESOLUTION;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVWC_RESOLVED_AT;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVWC_RESOLVED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVWC_STATUS;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_CLOSED_AT;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_CLOSED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_COMMENTS;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_DOCUMENT;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_OPENED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_REVIEWERS;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_REVISION;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_STATUS;
import static org.nuxeo.agentic.documents.Library.ADMINISTRATOR;
import static org.nuxeo.agentic.documents.Library.ALICE;
import static org.nuxeo.agentic.documents.Library.BOB;
import static org.nuxeo.agentic.documents.Library.DAVE;
import static org.nuxeo.agentic.documents.Library.DRAWING;
import static org.nuxeo.agentic.documents.Library.DRAWINGS;
import static org.nuxeo.agentic.documents.Library.REVIEWS;
import static org.nuxeo.agentic.documents.Library.text;

import java.io.Serializable;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.kv.KeyValueService;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * A revision is reviewed in a cycle, in Nuxeo's own comments: each thread open until the cycle's
 * opener resolves it, the cycle closed only with none open, and then recorded on the revision.
 *
 * <p>alice opens the cycles: she may write her drawings. bob reviews: he may read the drawings,
 * not write them, and may write the cycles and their comments. dave may write the cycles too, may
 * not read the drawings, and is not a reviewer.
 */
@RunWith(FeaturesRunner.class)
@Features(ControlledDocumentsFeature.class)
public class ReviewCycleTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private String repository;

    /** DWG-00001, revision A, alice's, current. */
    private String a;

    @Before
    public void setUp() {
        repository = core.getRepositoryName();
        Library.create(session);
        Library.createDesks(session);
        Library.resetSeries("DWG");
        a = Library.inTransactionAs(repository, ALICE, s -> Library.first(s, DRAWINGS, DRAWING, "pump", "DWG").getId());
    }

    private String open() {
        return Library.inTransactionAs(repository, ALICE, s -> Library.openCycle(s, "review", a, List.of(BOB)).getId());
    }

    private String comment(String user, String parent, String text) {
        return Library.inTransactionAs(repository, user, s -> Comments.write(s, parent, text).getId());
    }

    @Test
    public void aCycleOpensOnACurrentRevisionWithWhatItReviews() {
        String cycle = open();
        DocumentModel stored = Library.stored(repository, cycle);
        assertEquals(a, text(stored, RVW_DOCUMENT));
        assertEquals("DWG-00001", text(stored, RVW_NUMBER));
        assertEquals("A", text(stored, RVW_REVISION));
        assertEquals(OPEN, text(stored, RVW_STATUS));
        assertEquals(ALICE, text(stored, RVW_OPENED_BY));
        assertEquals("Review of DWG-00001 revision A", text(stored, "dc:title"));
        assertNull(stored.getPropertyValue(RVW_CLOSED_AT));
    }

    @Test
    public void whoMayOpenACycleAndOnWhat() {
        // bob may read the revision and not write it, so it could not record the cycle.
        assertRefused(403, "may write the revision", BOB, s -> Library.openCycle(s, "review", a, List.of(BOB)));
        assertRefused(400, "1 to 50 reviewers", ALICE, s -> Library.openCycle(s, "review", a, List.of()));
        assertRefused(400, "a user name", ALICE, s -> Library.openCycle(s, "review", a, List.of("bob smith")));
        assertRefused(400, "by its id", ALICE, s -> Library.openCycle(s, "review", "DWG-00001'", List.of(BOB)));
        // A superseded revision is not reviewed.
        String b = Library.inTransactionAs(repository, ALICE,
                s -> Library.revise(s, DRAWINGS, DRAWING, "pump-b", a).getId());
        assertRefused(409, "is superseded", ALICE, s -> Library.openCycle(s, "review", a, List.of(BOB)));
        assertNotNull(Library.inTransactionAs(repository, ALICE, s -> Library.openCycle(s, "review", b, List.of(BOB))));
    }

    @Test
    public void oneCycleAtATimeOnARevision() {
        String first = open();
        assertRefused(409, "A review cycle is open on this revision", ALICE,
                s -> Library.openCycle(s, "again", a, List.of(BOB)));
        resolveAllAndClose(first);
        // Its close released the revision: another may open.
        assertNotNull(Library.inTransactionAs(repository, ALICE,
                s -> Library.openCycle(s, "second", a, List.of(BOB)).getId()));
    }

    @Test
    public void aReviewersCommentIsAnOpenThreadAndAReplyIsPartOfIt() {
        String cycle = open();
        String thread = comment(BOB, cycle, "The flange rating is missing");
        String reply = comment(ALICE, thread, "Added in the next revision");

        DocumentModel first = Library.stored(repository, thread);
        assertTrue(first.hasFacet(COMMENT_FACET));
        assertEquals(cycle, text(first, RVWC_CYCLE));
        assertEquals(OPEN, text(first, RVWC_STATUS));
        DocumentModel answer = Library.stored(repository, reply);
        assertTrue(answer.hasFacet(COMMENT_FACET));
        assertEquals(cycle, text(answer, RVWC_CYCLE));
        assertNull(text(answer, RVWC_STATUS));
        // A comment on anything else is Nuxeo's alone.
        DocumentModel elsewhere = Library.stored(repository, comment(BOB, a, "On the drawing itself"));
        assertFalse(elsewhere.hasFacet(COMMENT_FACET));
    }

    @Test
    public void onlyTheReviewersAndTheOpenerCommentInACycle() {
        String cycle = open();
        // dave may write the cycle, and is not one of its reviewers.
        assertRefused(403, "Only the review cycle's reviewers", DAVE, s -> Comments.write(s, cycle, "Me too"));
        assertRefused(403, "Only the review cycle's reviewers", ADMINISTRATOR, s -> Comments.write(s, cycle, "Me"));
        String thread = comment(BOB, cycle, "One");
        assertRefused(403, "Only the review cycle's reviewers", DAVE, s -> Comments.write(s, thread, "A reply"));
        assertNotNull(comment(ALICE, cycle, "The opener's own note"));
    }

    @Test
    public void theOpenerResolvesAThreadAndTheServerSaysWhoAndWhen() {
        String cycle = open();
        String thread = comment(BOB, cycle, "The flange rating is missing");
        Library.inTransactionAs(repository, ALICE, s -> Library.resolve(s, thread, RESOLVED, "Added to note 4"));
        DocumentModel stored = Library.stored(repository, thread);
        assertEquals(RESOLVED, text(stored, RVWC_STATUS));
        assertEquals("Added to note 4", text(stored, RVWC_RESOLUTION));
        assertEquals(ALICE, text(stored, RVWC_RESOLVED_BY));
        assertNotNull(stored.getPropertyValue(RVWC_RESOLVED_AT));
        // Opened again, it says nobody resolved it.
        Library.inTransactionAs(repository, ALICE, s -> Library.resolve(s, thread, OPEN, null));
        stored = Library.stored(repository, thread);
        assertEquals(OPEN, text(stored, RVWC_STATUS));
        assertNull(text(stored, RVWC_RESOLVED_BY));
        assertNull(stored.getPropertyValue(RVWC_RESOLVED_AT));
    }

    @Test
    public void onlyTheOpenerResolvesAndTheServerWritesWho() {
        String cycle = open();
        String thread = comment(BOB, cycle, "One");
        String reply = comment(BOB, thread, "And more");
        // dave and bob may write the comment, as they may write the cycle; bob wrote it; neither
        // opened the cycle.
        assertRefused(403, "Only whoever opened this review cycle, alice, resolves", DAVE,
                s -> Library.resolve(s, thread, RESOLVED, null));
        assertRefused(403, "Only whoever opened this review cycle, alice, resolves", BOB,
                s -> Library.resolve(s, thread, RESOLVED, null));
        assertRefused(403, "Only whoever opened this review cycle", ADMINISTRATOR,
                s -> Library.resolve(s, thread, RESOLVED, null));
        assertRefused(400, "A reply is not resolved", ALICE, s -> Library.resolve(s, reply, RESOLVED, null));
        assertRefused(400, "rvwc:status is open or resolved", ALICE, s -> Library.resolve(s, thread, "done", null));
        assertRefused(400, "rvwc:resolvedBy is given by the server", ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(thread));
            doc.setPropertyValue(RVWC_STATUS, RESOLVED);
            doc.setPropertyValue(RVWC_RESOLVED_BY, BOB);
            return s.saveDocument(doc);
        });
        assertRefused(400, "rvwc:cycle is given by the server", ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(thread));
            doc.setPropertyValue(RVWC_CYCLE, a);
            return s.saveDocument(doc);
        });
        assertEquals(OPEN, text(Library.stored(repository, thread), RVWC_STATUS));
    }

    /** The heart of it: the server, not a form, keeps a cycle with an open thread from closing. */
    @Test
    public void aCycleWithAnOpenCommentDoesNotClose() {
        String cycle = open();
        String resolved = comment(BOB, cycle, "One");
        String open = comment(BOB, cycle, "Two");
        Library.inTransactionAs(repository, ALICE, s -> Library.resolve(s, resolved, RESOLVED, null));

        NuxeoException refused = Library.refusedAs(repository, ALICE, s -> Library.close(s, cycle));
        assertEquals(409, refused.getStatusCode());
        assertTrue(refused.getMessage(), refused.getMessage().contains("1 comment of this review cycle is open"));
        DocumentModel stored = Library.stored(repository, cycle);
        assertEquals(OPEN, text(stored, RVW_STATUS));
        assertNull(stored.getPropertyValue(RVW_CLOSED_BY));
        assertEquals(List.of(), recordOf(a));

        // Its close refused, the cycle takes comments still.
        comment(BOB, open, "A reply, while open");
        Library.inTransactionAs(repository, ALICE, s -> Library.resolve(s, open, RESOLVED, "Fixed"));
        Library.inTransactionAs(repository, ALICE, s -> Library.close(s, cycle));
        assertEquals(CLOSED, text(Library.stored(repository, cycle), RVW_STATUS));
    }

    @Test
    public void onlyTheOpenerClosesACycleAndNothingElseOfItChanges() {
        String cycle = open();
        assertRefused(403, "Only whoever opened this review cycle, alice, closes it", DAVE, s -> Library.close(s, cycle));
        assertRefused(403, "Only whoever opened this review cycle, alice, closes it", BOB, s -> Library.close(s, cycle));
        assertRefused(403, "Only whoever opened this review cycle", ADMINISTRATOR, s -> Library.close(s, cycle));
        assertRefused(400, "rvw:reviewers is given when the cycle opens", ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(cycle));
            doc.setPropertyValue(RVW_REVIEWERS, (Serializable) List.of(BOB, DAVE));
            return s.saveDocument(doc);
        });
        assertRefused(400, "from open to closed", ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(cycle));
            doc.setPropertyValue(RVW_STATUS, "approved");
            return s.saveDocument(doc);
        });
        assertRefused(400, "rvw:closedBy", ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(cycle));
            doc.setPropertyValue(RVW_STATUS, CLOSED);
            doc.setPropertyValue(RVW_CLOSED_BY, BOB);
            return s.saveDocument(doc);
        });
    }

    @Test
    public void aClosedCycleIsRecordedOnTheRevision() {
        String cycle = open();
        comment(BOB, cycle, "One");
        comment(BOB, cycle, "Two");
        resolveAllAndClose(cycle);

        DocumentModel stored = Library.stored(repository, cycle);
        assertEquals(CLOSED, text(stored, RVW_STATUS));
        assertEquals(ALICE, text(stored, RVW_CLOSED_BY));
        assertNotNull(stored.getPropertyValue(RVW_CLOSED_AT));
        assertEquals(2L, stored.getPropertyValue(RVW_COMMENTS));

        List<Map<String, Serializable>> record = recordOf(a);
        assertEquals(1, record.size());
        assertEquals(cycle, record.get(0).get("cycle"));
        assertEquals(ALICE, record.get(0).get("closedBy"));
        assertEquals(2L, record.get(0).get("comments"));
        assertNotNull(record.get(0).get("closedAt"));
    }

    @Test
    public void aClosedCycleAndItsCommentsAreKeptAsTheyWere() {
        String cycle = open();
        String thread = comment(BOB, cycle, "One");
        resolveAllAndClose(cycle);

        assertRefused(409, "closed", BOB, s -> Comments.write(s, cycle, "Late"));
        assertRefused(409, "closed", ALICE, s -> Comments.write(s, thread, "A late reply"));
        assertRefused(409, "closed", ALICE, s -> Library.resolve(s, thread, OPEN, null));
        assertRefused(409, "closed", ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(thread));
            doc.setPropertyValue("comment:text", "Edited after the close");
            return s.saveDocument(doc);
        });
        assertRefused(409, "closed", ALICE, s -> {
            s.removeDocument(new IdRef(thread));
            return null;
        });
        assertRefused(409, "A closed review cycle is not changed", ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(cycle));
            doc.setPropertyValue(RVW_STATUS, OPEN);
            return s.saveDocument(doc);
        });
        assertRefused(403, "only an administrator", ALICE, s -> {
            s.removeDocument(new IdRef(cycle));
            return null;
        });
        assertRefused(400, "is not copied", ALICE, s -> s.copy(new IdRef(cycle), new PathRef(REVIEWS), "copy"));
        // Nor through a privileged session opened on bob's behalf, as Nuxeo's comment manager opens
        // one to delete its author's comment: that session is an administrator's, and bob is not.
        assertRefused(409, "closed", BOB, s -> CoreInstance.doPrivileged(s, (CoreSession privileged) -> {
            privileged.removeDocument(new IdRef(thread));
            return null;
        }));
        assertEquals("One", text(Library.stored(repository, thread), "comment:text"));
    }

    @Test
    public void theRevisionsRecordIsTheServersNotEvenAnAdministrators() {
        for (String user : List.of(ALICE, ADMINISTRATOR)) {
            assertRefused(400, "docrev:cycles is written by the server", user, s -> {
                DocumentModel doc = s.getDocument(new IdRef(a));
                doc.setPropertyValue(REVIEW_CYCLES, (Serializable) List.of(Map.of("cycle", "forged", "closedBy",
                        BOB, "comments", 0L)));
                return s.saveDocument(doc);
            });
        }
        // What a creator writes there is replaced.
        String other = Library.inTransactionAs(repository, ALICE, s -> {
            DocumentModel doc = s.createDocumentModel(DRAWINGS, "forged", DRAWING);
            doc.setPropertyValue(ControlledDocuments.SERIES, "DWG");
            doc.setPropertyValue(REVIEW_CYCLES, (Serializable) List.of(Map.of("cycle", "forged")));
            return s.createDocument(doc).getId();
        });
        assertEquals(List.of(), recordOf(other));
    }

    private List<Map<String, Serializable>> recordOf(String revision) {
        return Stored.entries(Library.stored(repository, revision), ControlledDocuments.REVIEW_SCHEMA, REVIEW_CYCLES);
    }

    @Test
    public void theReviewCommentFacetIsTheServers() {
        String cycle = open();
        String thread = comment(BOB, cycle, "One");
        assertRefused(400, "facet is the server's", ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(thread));
            doc.removeFacet(COMMENT_FACET);
            return s.saveDocument(doc);
        });
        assertThrows(NuxeoException.class, () -> Library.inTransactionAs(repository, ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(a));
            doc.addFacet(COMMENT_FACET);
            return s.saveDocument(doc);
        }));
    }

    /**
     * The key/value store's claim and fence expire, a day by default: past them, the cycles' own
     * status, as the repository holds it, still refuses a second open cycle and anything written
     * in a closed one.
     */
    @Test
    public void onceTheClaimAndTheFenceExpireTheCyclesOwnStatusStillRefuses() {
        String first = open();
        String thread = comment(BOB, first, "One");
        forget(ReviewCycleListener.openKey(a));
        assertRefused(409, "A review cycle is open on this revision already", ALICE,
                s -> Library.openCycle(s, "again", a, List.of(BOB)));

        resolveAllAndClose(first);
        forget(ControlledDocumentComponent.fenceKey(first));
        assertRefused(409, "This review cycle is closed: it takes no more comments", BOB,
                s -> Comments.write(s, first, "Late"));
        assertRefused(409, "This review cycle is closed: its comments are kept as they were", ALICE,
                s -> Library.resolve(s, thread, OPEN, null));
        assertRefused(409, "This review cycle is closed: its comments are kept", BOB, s -> {
            s.removeDocument(new IdRef(thread));
            return null;
        });
    }

    /** What the key/value store holds under {@code key}, gone, as when it expires. */
    private static void forget(String key) {
        Library.inTransaction(() -> {
            Framework.getService(KeyValueService.class)
                     .getKeyValueStore(ControlledDocumentComponent.CLAIMS_STORE)
                     .put(key, (String) null);
            return null;
        });
    }

    private void resolveAllAndClose(String cycle) {
        Library.inTransactionAs(repository, ALICE, s -> {
            for (DocumentModel thread : s.query("SELECT * FROM Document WHERE ecm:mixinType = 'ReviewComment' AND "
                    + "rvwc:cycle = '" + cycle + "' AND rvwc:status = 'open'")) {
                Library.resolve(s, thread.getId(), RESOLVED, null);
            }
            return null;
        });
        Library.inTransactionAs(repository, ALICE, s -> Library.close(s, cycle));
    }

    private void assertRefused(int status, String message, String user, Function<CoreSession, ?> work) {
        NuxeoException refused = Library.refusedAs(repository, user, work);
        assertEquals(refused.getMessage(), status, refused.getStatusCode());
        assertTrue(refused.getMessage(), refused.getMessage().contains(message));
    }
}
