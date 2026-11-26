/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.capture.Captures.text;
import static org.nuxeo.agentic.capture.Mailroom.ALICE;
import static org.nuxeo.agentic.capture.Mailroom.CAROL;
import static org.nuxeo.agentic.capture.Mailroom.INBOX;
import static org.nuxeo.agentic.capture.Mailroom.NOTES_INBOX;

import java.io.Serializable;
import java.util.List;
import java.util.Map;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.agentic.capture.CaptureProvider.Classification;
import org.nuxeo.agentic.capture.CaptureProvider.ExtractedField;
import org.nuxeo.agentic.capture.CaptureProvider.Extraction;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.query.sql.model.OrderByExprs;
import org.nuxeo.ecm.core.query.sql.model.Predicates;
import org.nuxeo.ecm.core.query.sql.model.QueryBuilder;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Classify, extract, match and file with the stand-in; and every way an item waits for a person
 * instead: a confidence below the threshold, a key missing or not of its form, no record, two, one
 * outside the profile's place, a record that keeps no attachments, no provider, a provider that
 * fails. Each in the background, as the system, once the upload has committed.
 */
@RunWith(FeaturesRunner.class)
@Features(CaptureFeature.class)
public class CaptureTest {

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

    // ------------------------------------------------------------------ filed by itself

    @Test
    public void aLetterIsClassifiedItsFieldsExtractedMatchedAndFiledOnItsClaim() {
        String claim = claim("pc-24001");
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter-1", Mailroom.letter("PC-24001", 3));

        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.FILED, text(item, Captures.STATUS));
        assertNull(text(item, Captures.REASON));
        assertEquals(Captures.AUTOMATIC, text(item, Captures.OUTCOME));
        assertEquals(Captures.SYSTEM, text(item, Captures.DECIDED_BY));
        assertNotNull(item.getPropertyValue(Captures.DECIDED_AT));
        assertEquals("test-mail", text(item, Captures.PROFILE));
        assertEquals("standin", text(item, Captures.PROVIDER));
        assertNotNull(item.getPropertyValue(Captures.RECEIVED_AT));
        assertNotNull(item.getPropertyValue(Captures.CLASSIFIED_AT));
        assertNotNull(text(item, Captures.DIGEST));
        // The classification and its confidence, kept.
        assertEquals("claimLetter", text(item, Captures.PROPOSED_CLASS));
        assertEquals("claimLetter", text(item, Captures.CLASS));
        assertEquals(1.0, (Double) item.getPropertyValue(Captures.CLASS_CONFIDENCE), 0);
        assertEquals(0.97, (Double) item.getPropertyValue(Captures.CONFIDENCE), 0);
        // The fields extracted into the profile's schema, each with its confidence.
        assertEquals("PC-24001", Mailroom.value(item, Captures.EXTRACTED, "claimNumber"));
        assertEquals("POL-PC-1001", Mailroom.value(item, Captures.EXTRACTED, "policyNumber"));
        assertEquals("2026-10-02", Mailroom.value(item, Captures.EXTRACTED, "lossDate"));
        assertEquals(Mailroom.SENDER, Mailroom.value(item, Captures.EXTRACTED, "sender"));
        assertEquals("PC-24001", Mailroom.value(item, Captures.FIELDS, "claimNumber"));
        for (Map<String, Serializable> field : Captures.entries(item, Captures.EXTRACTED)) {
            assertEquals(String.valueOf(field.get("name")), 0.97, (Double) field.get("confidence"), 0);
        }
        // Matched, and filed on the claim as an attachment.
        assertEquals(claim, text(item, Captures.PROPOSED_RECORD));
        assertEquals(claim, text(item, Captures.RECORD));
        assertEquals("letter-1.txt", text(item, Captures.ATTACHMENT));
        List<Map<String, Serializable>> attachments = Mailroom.attachments(repository, claim);
        assertEquals(1, attachments.size());
        Blob filed = (Blob) attachments.get(0).get("file");
        assertEquals("letter-1.txt", filed.getFilename());
        assertEquals(text(item, Captures.DIGEST), filed.getDigest());
        // Nothing on any other claim.
        assertTrue(Mailroom.attachments(repository, claim("pc-24002")).isEmpty());
    }

    @Test
    public void theFilingIsAuditedOnTheItemAndOnTheClaimWithItsClassAndConfidence() {
        String claim = claim("pc-24001");
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter-1", Mailroom.letter("PC-24001", 3));
        audited();
        for (String docId : List.of(id, claim)) {
            List<LogEntry> entries = entries(CaptureAudit.FILED, docId);
            assertEquals(docId, 1, entries.size());
            LogEntry entry = entries.get(0);
            assertEquals(CaptureAudit.CATEGORY, entry.getCategory());
            Map<String, Object> extended = AuditAccess.extended(entry);
            assertEquals("claimLetter", extended.get(CaptureAudit.CLASS));
            assertEquals(0.97, ((Number) extended.get(CaptureAudit.CONFIDENCE)).doubleValue(), 0);
            assertEquals(Captures.AUTOMATIC, extended.get(CaptureAudit.OUTCOME));
            assertEquals(id, extended.get(CaptureAudit.ITEM));
            assertEquals(claim, extended.get(CaptureAudit.RECORD));
            assertTrue(entry.getComment(), entry.getComment().contains("97%"));
            assertTrue(entry.getComment(), !entry.getComment().contains("Kitchen fire"));
        }
    }

    @Test
    public void theSameFileFiledTwiceOnOneClaimIsOneAttachment() {
        String claim = claim("pc-24001");
        String text = Mailroom.letter("PC-24001", 3);
        Mailroom.mail(repository, CAROL, INBOX, "letter", text);
        String second = inTransactionAsCarolSameName(text);
        assertEquals(Captures.FILED, text(Mailroom.stored(repository, second), Captures.STATUS));
        assertEquals(1, Mailroom.attachments(repository, claim).size());
    }

    private String inTransactionAsCarolSameName(String text) {
        String id = Mailroom.inTransactionAs(repository, CAROL, s -> s.createDocument(
                Mailroom.model(s, INBOX, "letter-again", Mailroom.file(text, "letter.txt"))).getId());
        Mailroom.settle();
        return id;
    }

    // ------------------------------------------------------------------ waiting for a person

    @Test
    public void aConfidenceBelowTheThresholdWaitsWithItsClaimProposedAndNothingFiled() {
        String claim = claim("pc-24001");
        // Two of the class's three keywords: 0.67, under 0.85.
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter", Mailroom.letter("PC-24001", 2));
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.REVIEW, text(item, Captures.STATUS));
        assertEquals(Captures.LOW_CONFIDENCE, text(item, Captures.REASON));
        assertEquals(0.67, (Double) item.getPropertyValue(Captures.CLASS_CONFIDENCE), 0);
        assertEquals(0.67, (Double) item.getPropertyValue(Captures.CONFIDENCE), 0);
        assertEquals(claim, text(item, Captures.PROPOSED_RECORD));
        assertEquals(claim, text(item, Captures.RECORD));
        assertNull(text(item, Captures.OUTCOME));
        assertTrue(Mailroom.attachments(repository, claim).isEmpty());
        audited();
        List<LogEntry> queued = entries(CaptureAudit.QUEUED, id);
        assertEquals(1, queued.size());
        assertEquals(Captures.LOW_CONFIDENCE, AuditAccess.extended(queued.get(0)).get(CaptureAudit.REASON));
        assertTrue(entries(CaptureAudit.FILED, claim).isEmpty());
    }

    @Test
    public void exactlyTheThresholdFilesAndJustBelowItDoesNot() {
        String claim = claim("pc-24001");
        Mailroom.settings("scripted", null);
        ScriptedProvider.classification = new Classification("claimLetter", 0.85);
        ScriptedProvider.extraction = new Extraction(List.of(new ExtractedField("claimNumber", "PC-24001", 0.85)));
        String at = Mailroom.mail(repository, CAROL, INBOX, "at", "anything");
        assertEquals(Captures.FILED, text(Mailroom.stored(repository, at), Captures.STATUS));

        ScriptedProvider.classification = new Classification("claimLetter", 0.95);
        ScriptedProvider.extraction = new Extraction(List.of(new ExtractedField("claimNumber", "PC-24001", 0.8499)));
        String below = Mailroom.mail(repository, CAROL, INBOX, "below", "anything else");
        DocumentModel item = Mailroom.stored(repository, below);
        assertEquals(Captures.REVIEW, text(item, Captures.STATUS));
        assertEquals(Captures.LOW_CONFIDENCE, text(item, Captures.REASON));
        assertEquals(1, Mailroom.attachments(repository, claim).size());
    }

    @Test
    public void noClaimWithTheNumberWaitsUnmatched() {
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter", Mailroom.letter("PC-29999", 3));
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.REVIEW, text(item, Captures.STATUS));
        assertEquals(Captures.UNMATCHED, text(item, Captures.REASON));
        assertNull(text(item, Captures.PROPOSED_RECORD));
        assertEquals(0.97, (Double) item.getPropertyValue(Captures.CONFIDENCE), 0);
    }

    @Test
    public void aClaimOutsideTheProfilesPlaceIsNotMatched() {
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter", Mailroom.letter("PC-24009", 3));
        assertEquals(Captures.UNMATCHED, text(Mailroom.stored(repository, id), Captures.REASON));
        assertTrue(Mailroom.attachments(repository, claim("pc-24009")).isEmpty());
    }

    @Test
    public void twoClaimsWithTheNumberWaitForAPersonToChoose() {
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter", Mailroom.letter("PC-24005", 3));
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.AMBIGUOUS, text(item, Captures.REASON));
        assertNull(text(item, Captures.PROPOSED_RECORD));
        assertTrue(Mailroom.attachments(repository, claim("pc-24005-a")).isEmpty());
        assertTrue(Mailroom.attachments(repository, claim("pc-24005-b")).isEmpty());
    }

    @Test
    public void noClaimNumberOrOneNotOfItsFormWaitsForAPerson() {
        String none = Mailroom.mail(repository, CAROL, INBOX, "none", Mailroom.letter(null, 3));
        assertEquals(Captures.MISSING_KEY, text(Mailroom.stored(repository, none), Captures.REASON));
        // A value the format refuses is no key at all: confidence 0, and no claim looked for.
        String odd = Mailroom.mail(repository, CAROL, INBOX, "odd", Mailroom.letter("24001", 3));
        DocumentModel item = Mailroom.stored(repository, odd);
        assertEquals(Captures.LOW_CONFIDENCE, text(item, Captures.REASON));
        assertEquals(0.0, (Double) item.getPropertyValue(Captures.CONFIDENCE), 0);
        assertNull(text(item, Captures.PROPOSED_RECORD));
    }

    @Test
    public void aLetterOfNoKnownClassWaitsForAPerson() {
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter", "A postcard from the seaside.");
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.UNKNOWN_CLASS, text(item, Captures.REASON));
        assertNull(text(item, Captures.PROPOSED_CLASS));
        assertNull(text(item, Captures.CLASS));
    }

    @Test
    public void aClassWithNoKeyIsNeverFiledByItself() {
        String id = Mailroom.mail(repository, CAROL, INBOX, "invoice",
                "Invoice number: INV-1\nAmount due: 120.00\n");
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals("invoice", text(item, Captures.PROPOSED_CLASS));
        assertEquals(1.0, (Double) item.getPropertyValue(Captures.CLASS_CONFIDENCE), 0);
        assertEquals(Captures.MISSING_KEY, text(item, Captures.REASON));
    }

    @Test
    public void aRecordThatKeepsNoAttachmentsIsNotFiledOn() {
        String id = Mailroom.mail(repository, CAROL, NOTES_INBOX, "letter", Mailroom.letter("PC-24001", 3));
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.REVIEW, text(item, Captures.STATUS));
        assertEquals(Captures.NOT_FILED, text(item, Captures.REASON));
    }

    @Test
    public void withNoProviderNothingIsClassifiedAndEverythingWaits() {
        Mailroom.settings(null, null);
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter", Mailroom.letter("PC-24001", 3));
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.NO_PROVIDER, text(item, Captures.REASON));
        assertNull(text(item, Captures.PROVIDER));
        assertTrue(Mailroom.attachments(repository, claim("pc-24001")).isEmpty());
        // A provider the server names and has not registered is none.
        Mailroom.settings("nonesuch", null);
        String other = Mailroom.mail(repository, CAROL, INBOX, "other", Mailroom.letter("PC-24001", 3));
        assertEquals(Captures.NO_PROVIDER, text(Mailroom.stored(repository, other), Captures.REASON));
    }

    @Test
    public void aProviderThatFailsLeavesTheItemWaitingAndNothingFiled() {
        Mailroom.settings("scripted", null);
        ScriptedProvider.failure = CaptureProviderException.Kind.FAILED;
        String failed = Mailroom.mail(repository, CAROL, INBOX, "failed", "anything");
        assertEquals(Captures.PROVIDER_FAILED, text(Mailroom.stored(repository, failed), Captures.REASON));
        ScriptedProvider.failure = null;
        ScriptedProvider.crash = new IllegalStateException("boom");
        String crashed = Mailroom.mail(repository, CAROL, INBOX, "crashed", "anything");
        assertEquals(Captures.PROVIDER_FAILED, text(Mailroom.stored(repository, crashed), Captures.REASON));
        assertTrue(Mailroom.attachments(repository, claim("pc-24001")).isEmpty());
    }

    @Test
    public void whateverTheProviderAnswersIsCheckedBeforeItIsKept() {
        Mailroom.settings("scripted", null);
        ScriptedProvider.classification = new Classification("claimLetter", Double.NaN);
        ScriptedProvider.extraction = new Extraction(List.of(
                new ExtractedField("claimNumber", "PC-24001", 7.0),
                new ExtractedField("claimNumber", "PC-24002", 0.99),
                new ExtractedField("notAField", "x", 0.99),
                new ExtractedField("sender", "Rowan\u0007 Vale", -1)));
        String id = Mailroom.mail(repository, CAROL, INBOX, "odd", "anything");
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.LOW_CONFIDENCE, text(item, Captures.REASON));
        assertEquals(0.0, (Double) item.getPropertyValue(Captures.CLASS_CONFIDENCE), 0);
        assertEquals(2, Captures.entries(item, Captures.EXTRACTED).size());
        assertEquals("PC-24001", Mailroom.value(item, Captures.EXTRACTED, "claimNumber"));
        assertEquals("Rowan Vale", Mailroom.value(item, Captures.EXTRACTED, "sender"));
        for (Map<String, Serializable> field : Captures.entries(item, Captures.EXTRACTED)) {
            assertEquals(0.0, (Double) field.get("confidence"), 0);
        }
        // A class the profile does not have is none.
        ScriptedProvider.classification = new Classification("ransomNote", 0.99);
        String unknown = Mailroom.mail(repository, CAROL, INBOX, "unknown", "anything at all");
        assertEquals(Captures.UNKNOWN_CLASS, text(Mailroom.stored(repository, unknown), Captures.REASON));
    }

    @Test
    public void anItemIsCapturedOnceAndAFilingClaimedIsNotFiledAgain() {
        String claim = claim("pc-24001");
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter", Mailroom.letter("PC-24001", 3));
        // Run again, as a redelivery would: the item is no longer received, and nothing changes.
        Mailroom.inTransaction(() -> {
            org.nuxeo.ecm.core.api.CoreInstance.doPrivileged(repository,
                    (CoreSession s) -> Capture.run(s, id));
            return null;
        });
        assertEquals(1, Mailroom.attachments(repository, claim).size());
        assertEquals(Captures.FILED, text(Mailroom.stored(repository, id), Captures.STATUS));
    }

    // ------------------------------------------------------------------ helpers

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

    static List<LogEntry> entries(String event, String docId) {
        QueryBuilder query = new QueryBuilder();
        query.predicate(Predicates.eq("eventId", event));
        query.and(Predicates.eq("docUUID", docId));
        query.order(OrderByExprs.asc("id"));
        return Mailroom.inTransaction(() -> {
            List<LogEntry> entries = new java.util.ArrayList<>();
            for (Object entry : AuditAccess.reader().queryLogs(query)) {
                entries.add((LogEntry) entry);
            }
            return entries;
        });
    }
}
