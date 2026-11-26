/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.capture.Captures.text;
import static org.nuxeo.agentic.capture.Mailroom.ALICE;
import static org.nuxeo.agentic.capture.Mailroom.BOB;
import static org.nuxeo.agentic.capture.Mailroom.CAROL;
import static org.nuxeo.agentic.capture.Mailroom.INBOX;

import java.util.List;
import java.util.Map;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * The person's part: an item waiting is confirmed as it was proposed, or corrected, its class, a
 * field or its record, and filed; or rejected. Each decision checked first, and audited.
 */
@RunWith(FeaturesRunner.class)
@Features(CaptureFeature.class)
public class ReviewTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private String repository;

    @Before
    public void setUp() {
        repository = core.getRepositoryName();
        Mailroom.create(session);
        Mailroom.settings("standin", null);
    }

    private String claim(String name) {
        return Mailroom.claimId(session, name);
    }

    /** A letter whose confidence is under the threshold: it waits, its claim proposed. */
    private String waiting(String claimNumber) {
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter-" + claimNumber, Mailroom.letter(claimNumber, 2));
        assertEquals(Captures.REVIEW, text(Mailroom.stored(repository, id), Captures.STATUS));
        return id;
    }

    @Test
    public void confirmedAsProposedItIsFiledOnTheProposedClaim() {
        String claim = claim("pc-24001");
        String id = waiting("PC-24001");
        Mailroom.decide(repository, ALICE, id, item -> item.setPropertyValue(Captures.DECISION, Captures.CONFIRM));

        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.FILED, text(item, Captures.STATUS));
        assertEquals(Captures.CONFIRMED, text(item, Captures.OUTCOME));
        assertEquals(ALICE, text(item, Captures.DECIDED_BY));
        assertNull(text(item, Captures.DECISION));
        assertNull(text(item, Captures.REASON));
        assertEquals(claim, text(item, Captures.RECORD));
        // The provider's proposal and its confidence are kept as they were.
        assertEquals(0.67, (Double) item.getPropertyValue(Captures.CONFIDENCE), 0);
        assertEquals("claimLetter", text(item, Captures.PROPOSED_CLASS));
        assertEquals(1, Mailroom.attachments(repository, claim).size());
        // Filed as the person: the claim's last contributor is the one who confirmed.
        assertEquals(ALICE, text(Mailroom.stored(repository, claim), "dc:lastContributor"));

        audited();
        List<LogEntry> filed = CaptureTest.entries(CaptureAudit.FILED, claim);
        assertEquals(1, filed.size());
        Map<String, Object> extended = AuditAccess.extended(filed.get(0));
        assertEquals(Captures.CONFIRMED, extended.get(CaptureAudit.OUTCOME));
        assertEquals(ALICE, extended.get(CaptureAudit.BY));
        assertEquals(ALICE, filed.get(0).getPrincipalName());
    }

    @Test
    public void aCorrectedClaimNumberIsMatchedAgainAndFiledOnThatClaim() {
        String wrong = claim("pc-24001");
        String right = claim("pc-24002");
        String id = waiting("PC-24001");
        Mailroom.decide(repository, ALICE, id, item -> {
            Mailroom.field(item, "claimNumber", "PC-24002");
            item.setPropertyValue(Captures.RECORD, null);
            item.setPropertyValue(Captures.DECISION, Captures.CONFIRM);
        });
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.FILED, text(item, Captures.STATUS));
        assertEquals(Captures.CORRECTED, text(item, Captures.OUTCOME));
        assertEquals(right, text(item, Captures.RECORD));
        assertEquals("PC-24002", Mailroom.value(item, Captures.FIELDS, "claimNumber"));
        // The provider's own reading stays as it read it.
        assertEquals("PC-24001", Mailroom.value(item, Captures.EXTRACTED, "claimNumber"));
        assertEquals(1, Mailroom.attachments(repository, right).size());
        assertTrue(Mailroom.attachments(repository, wrong).isEmpty());
    }

    @Test
    public void aCorrectedClaimNumberWithTheProposedClaimLeftAsItWasIsMatchedAgain() {
        String wrong = claim("pc-24001");
        String right = claim("pc-24002");
        String id = waiting("PC-24001");
        assertEquals(wrong, text(Mailroom.stored(repository, id), Captures.RECORD));
        // The person corrects the number only, as the Edit form lets them, and confirms.
        Mailroom.decide(repository, ALICE, id, item -> {
            Mailroom.field(item, "claimNumber", "PC-24002");
            item.setPropertyValue(Captures.DECISION, Captures.CONFIRM);
        });
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.CORRECTED, text(item, Captures.OUTCOME));
        assertEquals(right, text(item, Captures.RECORD));
        assertEquals(1, Mailroom.attachments(repository, right).size());
        assertTrue(Mailroom.attachments(repository, wrong).isEmpty());
    }

    @Test
    public void aClaimNamedByThePersonIsFiledOnAndItsNumberFilledFromIt() {
        String right = claim("pc-24005-b");
        // Two claims share the number: the item waits, ambiguous.
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter", Mailroom.letter("PC-24005", 3));
        assertEquals(Captures.AMBIGUOUS, text(Mailroom.stored(repository, id), Captures.REASON));
        // Confirming with no record named is refused: a person must choose.
        NuxeoException refused = Mailroom.refusedDecision(repository, ALICE, id,
                item -> item.setPropertyValue(Captures.DECISION, Captures.CONFIRM));
        assertEquals(409, refused.getStatusCode());
        Mailroom.decide(repository, ALICE, id, item -> {
            Mailroom.field(item, "claimNumber", null);
            item.setPropertyValue(Captures.RECORD, right);
            item.setPropertyValue(Captures.DECISION, Captures.CONFIRM);
        });
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.FILED, text(item, Captures.STATUS));
        assertEquals(Captures.CORRECTED, text(item, Captures.OUTCOME));
        assertEquals("PC-24005", Mailroom.value(item, Captures.FIELDS, "claimNumber"));
        assertEquals(1, Mailroom.attachments(repository, right).size());
        assertTrue(Mailroom.attachments(repository, claim("pc-24005-a")).isEmpty());
    }

    @Test
    public void aClaimWhoseNumberIsNotTheItemsIsRefused() {
        String id = waiting("PC-24001");
        NuxeoException refused = Mailroom.refusedDecision(repository, ALICE, id, item -> {
            item.setPropertyValue(Captures.RECORD, claim("pc-24002"));
            item.setPropertyValue(Captures.DECISION, Captures.CONFIRM);
        });
        assertEquals(400, refused.getStatusCode());
        assertTrue(refused.getMessage(), refused.getMessage().contains("is not the record's"));
        assertEquals(Captures.REVIEW, text(Mailroom.stored(repository, id), Captures.STATUS));
        assertTrue(Mailroom.attachments(repository, claim("pc-24002")).isEmpty());
    }

    @Test
    public void aCorrectionThatMatchesNoClaimIsRefused() {
        String id = waiting("PC-24001");
        NuxeoException refused = Mailroom.refusedDecision(repository, ALICE, id, item -> {
            Mailroom.field(item, "claimNumber", "PC-29999");
            item.setPropertyValue(Captures.RECORD, null);
            item.setPropertyValue(Captures.DECISION, Captures.CONFIRM);
        });
        assertEquals(400, refused.getStatusCode());
        NuxeoException odd = Mailroom.refusedDecision(repository, ALICE, id, item -> {
            Mailroom.field(item, "claimNumber", "24001");
            item.setPropertyValue(Captures.DECISION, Captures.CONFIRM);
        });
        assertEquals(400, odd.getStatusCode());
        assertTrue(odd.getMessage(), odd.getMessage().contains("not of its form"));
        // Out of the profile's place, by its id: refused too.
        NuxeoException elsewhere = Mailroom.refusedDecision(repository, ALICE, id, item -> {
            Mailroom.field(item, "claimNumber", null);
            item.setPropertyValue(Captures.RECORD, claim("pc-24009"));
            item.setPropertyValue(Captures.DECISION, Captures.CONFIRM);
        });
        assertEquals(400, elsewhere.getStatusCode());
        assertEquals(Captures.REVIEW, text(Mailroom.stored(repository, id), Captures.STATUS));
    }

    @Test
    public void aClassCorrectedIsFiledAsCorrected() {
        String claim = claim("pc-24001");
        Mailroom.settings(null, null);
        // No provider: nothing proposed at all, and a person gives everything.
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter", Mailroom.letter("PC-24001", 3));
        assertEquals(Captures.NO_PROVIDER, text(Mailroom.stored(repository, id), Captures.REASON));
        NuxeoException fieldsFirst = Mailroom.refusedDecision(repository, ALICE, id,
                item -> Mailroom.field(item, "claimNumber", "PC-24001"));
        assertEquals(400, fieldsFirst.getStatusCode());
        Mailroom.decide(repository, ALICE, id, item -> {
            item.setPropertyValue(Captures.CLASS, "claimLetter");
            Mailroom.field(item, "claimNumber", "PC-24001");
            item.setPropertyValue(Captures.DECISION, Captures.CONFIRM);
        });
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.CORRECTED, text(item, Captures.OUTCOME));
        assertEquals(claim, text(item, Captures.RECORD));
        assertEquals(1, Mailroom.attachments(repository, claim).size());
    }

    @Test
    public void correctionsAreSavedWhileItWaitsAndCheckedEachTime() {
        String id = waiting("PC-24001");
        Mailroom.decide(repository, BOB, id, item -> {
            Mailroom.field(item, "sender", "R. Vale");
            item.setPropertyValue(Captures.NOTE, "Called the sender.\nThe number is right.");
        });
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.REVIEW, text(item, Captures.STATUS));
        assertEquals("R. Vale", Mailroom.value(item, Captures.FIELDS, "sender"));

        assertEquals(400, Mailroom.refusedDecision(repository, BOB, id,
                i -> i.setPropertyValue(Captures.CLASS, "ransomNote")).getStatusCode());
        assertEquals(400, Mailroom.refusedDecision(repository, BOB, id,
                i -> Mailroom.field(i, "invoiceNumber", "INV-1")).getStatusCode());
        assertEquals(400, Mailroom.refusedDecision(repository, BOB, id,
                i -> Mailroom.field(i, "sender", "x".repeat(Captures.MAX_VALUE + 1))).getStatusCode());
        assertEquals(400, Mailroom.refusedDecision(repository, BOB, id,
                i -> Mailroom.field(i, "sender", "Rowan\tVale")).getStatusCode());
        assertEquals(400, Mailroom.refusedDecision(repository, BOB, id,
                i -> i.setPropertyValue(Captures.RECORD, "../../etc")).getStatusCode());
        assertEquals(400, Mailroom.refusedDecision(repository, BOB, id,
                i -> i.setPropertyValue(Captures.DECISION, "fileItAnyway")).getStatusCode());
        assertEquals(Captures.REVIEW, text(Mailroom.stored(repository, id), Captures.STATUS));
    }

    @Test
    public void anItemBeingFiledAtThisMomentIsNotFiledAgain() {
        String claim = claim("pc-24001");
        String id = waiting("PC-24001");
        // Another filing of the item holds its claim, as one under way on another node would.
        var store = org.nuxeo.runtime.api.Framework.getService(org.nuxeo.runtime.kv.KeyValueService.class)
                                                   .getKeyValueStore(CaptureComponent.STORE);
        store.put(Filing.claimKey(id), "claimed", 60);
        NuxeoException refused = Mailroom.refusedDecision(repository, ALICE, id,
                item -> item.setPropertyValue(Captures.DECISION, Captures.CONFIRM));
        assertEquals(409, refused.getStatusCode());
        assertTrue(Mailroom.attachments(repository, claim).isEmpty());
        // Once it is released, the person files.
        store.put(Filing.claimKey(id), (String) null);
        Mailroom.decide(repository, ALICE, id, item -> item.setPropertyValue(Captures.DECISION, Captures.CONFIRM));
        assertEquals(1, Mailroom.attachments(repository, claim).size());
    }

    @Test
    public void rejectedItIsSetAsideAndNothingIsFiled() {
        String claim = claim("pc-24001");
        String id = waiting("PC-24001");
        Mailroom.decide(repository, BOB, id, item -> {
            item.setPropertyValue(Captures.NOTE, "Not for this inbox.");
            item.setPropertyValue(Captures.DECISION, Captures.REJECT);
        });
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.REJECTED, text(item, Captures.STATUS));
        assertEquals(Captures.REJECTED, text(item, Captures.OUTCOME));
        assertEquals(BOB, text(item, Captures.DECIDED_BY));
        assertNull(text(item, Captures.DECISION));
        assertTrue(Mailroom.attachments(repository, claim).isEmpty());
        audited();
        assertEquals(1, CaptureTest.entries(CaptureAudit.REJECTED, id).size());
        // Decided once: no confirming it now.
        NuxeoException again = Mailroom.refusedDecision(repository, ALICE, id,
                i -> i.setPropertyValue(Captures.DECISION, Captures.CONFIRM));
        assertEquals(409, again.getStatusCode());
    }

    @Test
    public void anItemFiledOrStillReceivedIsNotDecidedOn() {
        String filed = Mailroom.mail(repository, CAROL, INBOX, "filed", Mailroom.letter("PC-24001", 3));
        assertEquals(Captures.FILED, text(Mailroom.stored(repository, filed), Captures.STATUS));
        assertEquals(409, Mailroom.refusedDecision(repository, ALICE, filed,
                i -> i.setPropertyValue(Captures.DECISION, Captures.REJECT)).getStatusCode());
        assertEquals(409, Mailroom.refusedDecision(repository, ALICE, filed,
                i -> i.setPropertyValue(Captures.RECORD, claim("pc-24002"))).getStatusCode());
        // An item not yet captured, as it is before its background capture runs: in the
        // transaction of its upload, before the capture can start.
        NuxeoException early = Mailroom.refusedAs(repository, CAROL, s -> {
            String received = s.createDocument(Mailroom.model(s, INBOX, "fresh", Mailroom.file("anything", "fresh.txt")))
                               .getId();
            CoreSession alice = Mailroom.as(repository, ALICE);
            DocumentModel item = alice.getDocument(new org.nuxeo.ecm.core.api.IdRef(received));
            assertEquals(Captures.RECEIVED, text(item, Captures.STATUS));
            item.setPropertyValue(Captures.DECISION, Captures.CONFIRM);
            return alice.saveDocument(item);
        });
        assertEquals(409, early.getStatusCode());
        Mailroom.settle();
    }

    private void audited() {
        if (TransactionHelper.isTransactionActiveOrMarkedRollback()) {
            TransactionHelper.commitOrRollbackTransaction();
        }
        TransactionHelper.startTransaction();
        try {
            CaptureAuditFeature.awaitAudit(java.time.Duration.ofSeconds(30));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError(e);
        }
    }
}
