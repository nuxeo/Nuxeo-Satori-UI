/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.documents.ControlledDocuments.ACKNOWLEDGED;
import static org.nuxeo.agentic.documents.ControlledDocuments.AWAITING;
import static org.nuxeo.agentic.documents.ControlledDocuments.FOR_CONSTRUCTION;
import static org.nuxeo.agentic.documents.ControlledDocuments.FOR_REVIEW;
import static org.nuxeo.agentic.documents.ControlledDocuments.RETURNED;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_DOCUMENTS;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_ISSUED_AT;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_ISSUED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_ITEMS;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_PURPOSE;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_RECIPIENTS;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_COMMENT;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_DUE_DATE;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_ISSUED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_PURPOSE;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_RECIPIENT;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_RESPONDED_AT;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_STATUS;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_TRANSMITTAL;
import static org.nuxeo.agentic.documents.Library.ADMINISTRATOR;
import static org.nuxeo.agentic.documents.Library.ALICE;
import static org.nuxeo.agentic.documents.Library.BOB;
import static org.nuxeo.agentic.documents.Library.CAROL;
import static org.nuxeo.agentic.documents.Library.DAVE;
import static org.nuxeo.agentic.documents.Library.DRAWING;
import static org.nuxeo.agentic.documents.Library.DRAWINGS;
import static org.nuxeo.agentic.documents.Library.ERIN;
import static org.nuxeo.agentic.documents.Library.TRANSMITTALS;
import static org.nuxeo.agentic.documents.Library.text;

import java.io.Serializable;
import java.util.Arrays;
import java.util.Calendar;
import java.util.List;
import java.util.Map;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.core.api.trash.TrashService;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * A transmittal is issued on creation, with a receipt per recipient beside it; each receipt is
 * answered once, by its recipient alone; and nothing of either changes otherwise.
 */
@RunWith(FeaturesRunner.class)
@Features(ControlledDocumentsFeature.class)
public class TransmittalTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private String repository;

    /** DWG-00001: revision A, superseded by B, which is current. */
    private String a;

    private String b;

    /** DWG-00002, revision A, current. */
    private String valve;

    @Before
    public void setUp() {
        repository = core.getRepositoryName();
        Library.create(session);
        Library.createDesks(session);
        Library.resetSeries("DWG", "TR");
        a = Library.inTransactionAs(repository, ALICE, s -> Library.first(s, DRAWINGS, DRAWING, "pump", "DWG").getId());
        b = Library.inTransactionAs(repository, ALICE, s -> Library.revise(s, DRAWINGS, DRAWING, "pump-b", a).getId());
        valve = Library.inTransactionAs(repository, ALICE,
                s -> Library.first(s, DRAWINGS, DRAWING, "valve", "DWG").getId());
    }

    private String issue(String user, List<String> documents, List<String> recipients) {
        return Library.inTransactionAs(repository, user,
                s -> Library.issue(s, "tr", documents, recipients, FOR_REVIEW, 14).getId());
    }

    @Test
    public void aTransmittalIsNumberedWithEachRevisionAsItWasAndAReceiptPerRecipient() {
        String id = issue(ALICE, List.of("DWG-00001", valve), List.of(BOB, ERIN, BOB));

        DocumentModel transmittal = Library.stored(repository, id);
        assertEquals("TR-00001", text(transmittal, TRM_NUMBER));
        // Named by number, the current revision; by id, that revision: each written back as an id.
        assertEquals(List.of(b, valve), Arrays.asList((String[]) transmittal.getPropertyValue(TRM_DOCUMENTS)));
        @SuppressWarnings("unchecked")
        List<Map<String, Serializable>> items = (List<Map<String, Serializable>>) transmittal.getPropertyValue(
                TRM_ITEMS);
        assertEquals(2, items.size());
        assertEquals(b, items.get(0).get("document"));
        assertEquals("DWG-00001", items.get(0).get("number"));
        assertEquals("B", items.get(0).get("revision"));
        assertEquals("pump-b", items.get(0).get("title"));
        assertEquals("DWG-00002", items.get(1).get("number"));
        assertEquals("A", items.get(1).get("revision"));
        // Each recipient once.
        assertEquals(List.of(BOB, ERIN), Arrays.asList((String[]) transmittal.getPropertyValue(TRM_RECIPIENTS)));
        assertEquals(ALICE, text(transmittal, TRM_ISSUED_BY));
        assertNotNull(transmittal.getPropertyValue(TRM_ISSUED_AT));

        Map<String, DocumentModel> receipts = Library.receipts(repository, id);
        assertEquals(List.of(BOB, ERIN), List.copyOf(receipts.keySet()));
        for (DocumentModel receipt : receipts.values()) {
            assertEquals(TRANSMITTALS, receipt.getPath().removeLastSegments(1).toString());
            assertEquals("TestReceipt", receipt.getType());
            assertEquals(id, text(receipt, TRR_TRANSMITTAL));
            assertEquals("TR-00001", text(receipt, TRR_NUMBER));
            assertEquals(FOR_REVIEW, text(receipt, TRR_PURPOSE));
            assertEquals(ALICE, text(receipt, TRR_ISSUED_BY));
            assertEquals(AWAITING, text(receipt, TRR_STATUS));
            assertNotNull(receipt.getPropertyValue(TRR_DUE_DATE));
            assertNull(receipt.getPropertyValue(TRR_RESPONDED_AT));
            assertEquals("TR-00001 Drawings for review", text(receipt, "dc:title"));
        }
        assertEquals("TR-00002", text(Library.stored(repository, issue(ALICE, List.of(valve), List.of(BOB))),
                TRM_NUMBER));
    }

    @Test
    public void whatTheIssuerWritesInTheServersPropertiesIsReplaced() {
        String id = Library.inTransactionAs(repository, ALICE, s -> {
            DocumentModel doc = s.createDocumentModel(TRANSMITTALS, "tr", Library.TRANSMITTAL);
            doc.setPropertyValue("dc:title", "Forged");
            doc.setPropertyValue(TRM_DOCUMENTS, (Serializable) List.of("DWG-00001"));
            doc.setPropertyValue(TRM_RECIPIENTS, (Serializable) List.of(BOB));
            doc.setPropertyValue(TRM_PURPOSE, FOR_CONSTRUCTION);
            doc.setPropertyValue(ControlledDocuments.TRM_DUE_DATE, Library.day(1));
            doc.setPropertyValue(TRM_NUMBER, "TR-99999");
            doc.setPropertyValue(TRM_ISSUED_BY, BOB);
            doc.setPropertyValue(TRM_ITEMS, (Serializable) List.of(Map.of("document", a, "number", "DWG-00001",
                    "revision", "A", "title", "forged")));
            return s.createDocument(doc).getId();
        });
        DocumentModel stored = Library.stored(repository, id);
        assertEquals("TR-00001", text(stored, TRM_NUMBER));
        assertEquals(ALICE, text(stored, TRM_ISSUED_BY));
        @SuppressWarnings("unchecked")
        List<Map<String, Serializable>> items = (List<Map<String, Serializable>>) stored.getPropertyValue(TRM_ITEMS);
        assertEquals(1, items.size());
        assertEquals(b, items.get(0).get("document"));
    }

    @Test
    public void whatATransmittalMustSayIsCheckedAndNothingIsWrittenOrNumberedWhenRefused() {
        assertRefused(400, "subject", ALICE, s -> {
            DocumentModel doc = Library.issueModel(s, List.of(valve), List.of(BOB), FOR_REVIEW, 1);
            doc.setPropertyValue("dc:title", " ");
            return s.createDocument(doc);
        });
        assertRefused(400, "trm:purpose is one of", ALICE,
                s -> s.createDocument(Library.issueModel(s, List.of(valve), List.of(BOB), "approval", 1)));
        assertRefused(400, "today or later", ALICE,
                s -> s.createDocument(Library.issueModel(s, List.of(valve), List.of(BOB), FOR_REVIEW, -2)));
        assertRefused(400, "1 to 50 recipients", ALICE,
                s -> s.createDocument(Library.issueModel(s, List.of(valve), List.of(), FOR_REVIEW, 1)));
        assertRefused(400, "user name", ALICE,
                s -> s.createDocument(Library.issueModel(s, List.of(valve), List.of("bob smith"), FOR_REVIEW, 1)));
        assertRefused(400, "1 to 100 controlled documents", ALICE,
                s -> s.createDocument(Library.issueModel(s, List.of(), List.of(BOB), FOR_REVIEW, 1)));
        // A superseded revision is not sent, by id; a number with no current revision is not found.
        assertRefused(409, "not its number's current revision", ALICE,
                s -> s.createDocument(Library.issueModel(s, List.of(a), List.of(BOB), FOR_REVIEW, 1)));
        assertRefused(400, "No current revision of DWG-00042", ALICE,
                s -> s.createDocument(Library.issueModel(s, List.of("DWG-00042"), List.of(BOB), FOR_REVIEW, 1)));
        assertRefused(400, "number, such as DWG-00042, or its id", ALICE,
                s -> s.createDocument(Library.issueModel(s, List.of("'; DROP"), List.of(BOB), FOR_REVIEW, 1)));
        // An issuer sends only what they may read: carol may create here, and read none of alice's.
        assertRefused(403, "You may not read the document", CAROL,
                s -> s.createDocument(Library.issueModel(s, List.of(valve), List.of(BOB), FOR_REVIEW, 1)));
        assertRefused(400, "No current revision of DWG-00002 that you may read", CAROL,
                s -> s.createDocument(Library.issueModel(s, List.of("DWG-00002"), List.of(BOB), FOR_REVIEW, 1)));

        assertEquals(0, Library.inTransaction(() -> org.nuxeo.ecm.core.api.CoreInstance.doPrivileged(repository,
                (CoreSession s) -> s.query("SELECT * FROM Document WHERE ecm:mixinType IN ('Transmittal', "
                        + "'TransmittalReceipt')").size())).intValue());
        // No number was taken by a refusal.
        assertEquals("TR-00001", text(Library.stored(repository, issue(ALICE, List.of(valve), List.of(BOB))),
                TRM_NUMBER));
    }

    @Test
    public void aReceiptIsTheServersAlone() {
        assertRefused(403, "written by the server", ALICE, s -> {
            DocumentModel receipt = s.createDocumentModel(TRANSMITTALS, "forged", "TestReceipt");
            receipt.setPropertyValue(TRR_RECIPIENT, BOB);
            receipt.setPropertyValue(TRR_STATUS, ACKNOWLEDGED);
            return s.createDocument(receipt);
        });
    }

    @Test
    public void theRecipientAcknowledgesOnceAndTheServerSaysWhen() {
        String id = issue(ALICE, List.of(valve), List.of(BOB));
        String receipt = Library.receipts(repository, id).get(BOB).getId();
        long before = System.currentTimeMillis();

        Library.inTransactionAs(repository, BOB, s -> Library.answer(s, receipt, ACKNOWLEDGED, "Received"));

        DocumentModel stored = Library.stored(repository, receipt);
        assertEquals(ACKNOWLEDGED, text(stored, TRR_STATUS));
        assertEquals("Received", text(stored, TRR_COMMENT));
        long at = ((Calendar) stored.getPropertyValue(TRR_RESPONDED_AT)).getTimeInMillis();
        assertTrue(at >= before - 1000 && at <= System.currentTimeMillis() + 1000);
        // Once: not again, not otherwise.
        assertRefused(409, "has been answered", BOB, s -> Library.answer(s, receipt, RETURNED, "Changed my mind"));
        assertEquals(ACKNOWLEDGED, text(Library.stored(repository, receipt), TRR_STATUS));
    }

    @Test
    public void aReturnSaysWhy() {
        String id = issue(ALICE, List.of(valve), List.of(BOB));
        String receipt = Library.receipts(repository, id).get(BOB).getId();
        assertRefused(400, "says why", BOB, s -> Library.answer(s, receipt, RETURNED, " "));
        assertRefused(400, "Answer trr:status", BOB, s -> Library.answer(s, receipt, "approved", "Fine"));
        assertRefused(400, "Answer trr:status", BOB, s -> Library.answer(s, receipt, AWAITING, "Only a comment"));
        assertRefused(400, "4000 characters", BOB, s -> Library.answer(s, receipt, RETURNED, "x".repeat(4001)));
        assertEquals(AWAITING, text(Library.stored(repository, receipt), TRR_STATUS));

        Library.inTransactionAs(repository, BOB, s -> Library.answer(s, receipt, RETURNED, "Section 3 is unclear"));
        assertEquals(RETURNED, text(Library.stored(repository, receipt), TRR_STATUS));
        assertEquals("Section 3 is unclear", text(Library.stored(repository, receipt), TRR_COMMENT));
    }

    /** The heart of it: whoever may write a receipt, only its recipient answers it. */
    @Test
    public void anAcknowledgementBySomeoneNotARecipientIsRefused() {
        String id = issue(ALICE, List.of(valve), List.of(BOB, ERIN));
        String bobs = Library.receipts(repository, id).get(BOB).getId();
        // dave may write every receipt in the folder, and is not a recipient.
        assertRefused(403, "Only the recipient this transmittal was sent to, bob", DAVE,
                s -> Library.answer(s, bobs, ACKNOWLEDGED, null));
        // Nor is the issuer one, nor another recipient.
        assertRefused(403, "Only the recipient", ALICE, s -> Library.answer(s, bobs, ACKNOWLEDGED, null));
        // Nor an administrator: an answer is the recipient's own.
        assertRefused(403, "Only the recipient", ADMINISTRATOR, s -> Library.answer(s, bobs, ACKNOWLEDGED, null));
        assertEquals(AWAITING, text(Library.stored(repository, bobs), TRR_STATUS));
    }

    @Test
    public void aRecipientWhoMayNotWriteTheirReceiptIsRefusedByThePlatform() {
        String id = issue(ALICE, List.of(valve), List.of(ERIN));
        String erins = Library.receipts(repository, id).get(ERIN).getId();
        assertThrows(DocumentSecurityException.class,
                () -> Library.inTransactionAs(repository, ERIN, s -> Library.answer(s, erins, ACKNOWLEDGED, null)));
        assertEquals(AWAITING, text(Library.stored(repository, erins), TRR_STATUS));
    }

    @Test
    public void nothingElseOfAReceiptChangesNotEvenWithTheAnswer() {
        String id = issue(ALICE, List.of(valve), List.of(BOB));
        String receipt = Library.receipts(repository, id).get(BOB).getId();
        assertRefused(400, "trr:recipient is given by the server", BOB, s -> {
            DocumentModel doc = s.getDocument(new IdRef(receipt));
            doc.setPropertyValue(TRR_RECIPIENT, DAVE);
            return s.saveDocument(doc);
        });
        assertRefused(400, "trr:dueDate is given by the server", BOB, s -> {
            DocumentModel doc = s.getDocument(new IdRef(receipt));
            doc.setPropertyValue(TRR_STATUS, ACKNOWLEDGED);
            doc.setPropertyValue(TRR_DUE_DATE, Library.day(90));
            return s.saveDocument(doc);
        });
        assertRefused(400, "dc:title", BOB, s -> {
            DocumentModel doc = s.getDocument(new IdRef(receipt));
            doc.setPropertyValue("dc:title", "Mine");
            return s.saveDocument(doc);
        });
        assertRefused(400, "trr:respondedAt is given by the server", BOB, s -> {
            DocumentModel doc = s.getDocument(new IdRef(receipt));
            doc.setPropertyValue(TRR_STATUS, ACKNOWLEDGED);
            doc.setPropertyValue(TRR_RESPONDED_AT, Library.day(-30));
            return s.saveDocument(doc);
        });
    }

    @Test
    public void aTransmittalIsNotChangedOnceIssuedNotEvenByAnAdministrator() {
        String id = issue(ALICE, List.of(valve), List.of(BOB));
        for (String user : List.of(ALICE, ADMINISTRATOR)) {
            assertRefused(400, "trm:recipients", user, s -> {
                DocumentModel doc = s.getDocument(new IdRef(id));
                doc.setPropertyValue(TRM_RECIPIENTS, (Serializable) List.of(BOB, DAVE));
                return s.saveDocument(doc);
            });
            assertRefused(400, "trm:purpose", user, s -> {
                DocumentModel doc = s.getDocument(new IdRef(id));
                doc.setPropertyValue(TRM_PURPOSE, FOR_CONSTRUCTION);
                return s.saveDocument(doc);
            });
            assertRefused(400, "dc:title", user, s -> {
                DocumentModel doc = s.getDocument(new IdRef(id));
                doc.setPropertyValue("dc:title", "Another subject");
                return s.saveDocument(doc);
            });
        }
        // A save that changes none of it, a facet Nuxeo adds included, goes through.
        Library.inTransactionAs(repository, ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(id));
            doc.setPropertyValue("dc:subjects", (Serializable) List.of("pumps"));
            return s.saveDocument(doc);
        });
    }

    @Test
    public void aTransmittalAndItsReceiptsAreKept() {
        String id = issue(ALICE, List.of(valve), List.of(BOB));
        String receipt = Library.receipts(repository, id).get(BOB).getId();
        assertRefused(403, "only an administrator", BOB, s -> {
            s.removeDocument(new IdRef(receipt));
            return null;
        });
        assertRefused(403, "only an administrator", ALICE, s -> {
            s.removeDocument(new IdRef(id));
            return null;
        });
        assertRefused(403, "only an administrator", BOB, s -> {
            Framework.getService(TrashService.class).trashDocument(s.getDocument(new IdRef(receipt)));
            return null;
        });
        assertRefused(400, "is not copied", ALICE, s -> s.copy(new IdRef(id), new PathRef(TRANSMITTALS), "copy"));
        assertRefused(400, "is not copied", BOB, s -> s.copy(new IdRef(receipt), new PathRef(TRANSMITTALS), "copy"));
        assertRefused(400, "This folder holds", ADMINISTRATOR,
                s -> s.copy(new PathRef(TRANSMITTALS), new PathRef("/library"), "copy"));
        // Nor the folder holding them, whose contents the repository deletes with no event of their own.
        assertRefused(403, "which are kept", ALICE, s -> {
            s.removeDocument(new PathRef(TRANSMITTALS));
            return null;
        });
        assertRefused(403, "which are kept", ALICE, s -> {
            Framework.getService(TrashService.class).trashDocument(s.getDocument(new PathRef(TRANSMITTALS)));
            return null;
        });
        assertNotNull(Library.stored(repository, receipt));
        assertNotNull(Library.stored(repository, id));
        // An administrator may.
        Library.inTransactionAs(repository, ADMINISTRATOR, s -> {
            s.removeDocument(new IdRef(receipt));
            return null;
        });
        assertNull(Library.stored(repository, receipt));
    }

    /** A version taken while it awaited is not restored over an answered receipt. */
    @Test
    public void anAnsweredReceiptIsNotMadeToAwaitAgainByARestore() {
        String id = issue(ALICE, List.of(valve), List.of(BOB));
        String receipt = Library.receipts(repository, id).get(BOB).getId();
        String version = Library.inTransactionAs(repository, ADMINISTRATOR,
                s -> s.checkIn(new IdRef(receipt), org.nuxeo.ecm.core.api.VersioningOption.MINOR, null).reference()
                      .toString());
        Library.inTransactionAs(repository, BOB, s -> Library.answer(s, receipt, ACKNOWLEDGED, null));

        assertRefused(409, "Restoring this version would change trr:status", ADMINISTRATOR,
                s -> s.restoreToVersion(new IdRef(receipt), new IdRef(version)));
        assertEquals(ACKNOWLEDGED, text(Library.stored(repository, receipt), TRR_STATUS));
    }

    @Test
    public void aDocumentCannotBeNumberedInTheTransmittalsSeries() {
        assertRefused(400, "numbers transmittals, not documents", ALICE,
                s -> Library.first(s, DRAWINGS, DRAWING, "tr", "TR"));
    }

    private void assertRefused(int status, String message, String user, java.util.function.Function<CoreSession, ?> work) {
        NuxeoException refused = Library.refusedAs(repository, user, work);
        assertEquals(refused.getMessage(), status, refused.getStatusCode());
        assertTrue(refused.getMessage(), refused.getMessage().contains(message));
    }
}
