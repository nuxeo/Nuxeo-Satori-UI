/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.capture.Captures.text;
import static org.nuxeo.agentic.capture.Mailroom.ALICE;
import static org.nuxeo.agentic.capture.Mailroom.CAROL;
import static org.nuxeo.agentic.capture.Mailroom.INBOX;

import java.io.Serializable;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * What no one but the server changes, and how an item comes in: in its inbox, with its file, no
 * larger than the server takes, with nothing of capt: given; its file what came in; the server's
 * properties the server's, an administrator's write included; the facet with the type; and no
 * copy of an item, or of a folder holding one.
 */
@RunWith(FeaturesRunner.class)
@Features(CaptureFeature.class)
public class GuardTest {

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

    private NuxeoException uploadRefused(String user, String inbox, java.util.function.Consumer<DocumentModel> change) {
        return Mailroom.refusedAs(repository, user, s -> {
            DocumentModel item = Mailroom.model(s, inbox, "letter", Mailroom.file("Claim number: PC-24001", "l.txt"));
            change.accept(item);
            return s.createDocument(item);
        });
    }

    @Test
    public void anItemComesInOnlyInItsInboxWithItsFileAndNothingOfTheServers() {
        // Outside an inbox, even one the user may write.
        NuxeoException outside = uploadRefused(ALICE, Mailroom.CLAIMS, item -> {
        });
        assertEquals(400, outside.getStatusCode());
        // No file.
        NuxeoException noFile = uploadRefused(CAROL, INBOX, item -> item.setPropertyValue("file:content", null));
        assertEquals(400, noFile.getStatusCode());
        // Anything of capt: given: the server's, or a person's before it waits.
        for (String property : new String[] { Captures.STATUS, Captures.OUTCOME, Captures.RECORD,
                Captures.DECISION, Captures.CLASS }) {
            NuxeoException given = uploadRefused(CAROL, INBOX, item -> item.setPropertyValue(property, "filed"));
            assertEquals(property, 400, given.getStatusCode());
        }
        NuxeoException confidence = uploadRefused(CAROL, INBOX,
                item -> item.setPropertyValue(Captures.CONFIDENCE, 1.0));
        assertEquals(400, confidence.getStatusCode());
        assertEquals(0, Mailroom.count(repository, "SELECT * FROM TestMail"));
    }

    @Test
    public void aFileLargerThanTheServerTakesIsRefused() {
        Mailroom.set(CaptureSettings.MAX_BYTES_PROPERTY, "1024");
        NuxeoException large = uploadRefused(CAROL, INBOX,
                item -> item.setPropertyValue("file:content", (Serializable) Mailroom.file("x".repeat(1025), "big.txt")));
        assertEquals(400, large.getStatusCode());
        // Within the bound, it comes in.
        Mailroom.mail(repository, CAROL, INBOX, "small", "x".repeat(1024));
        assertEquals(1, Mailroom.count(repository, "SELECT * FROM TestMail"));
    }

    @Test
    public void theServersPropertiesAreTheServersEvenForAnAdministrator() {
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter", Mailroom.letter("PC-24001", 2));
        for (String user : new String[] { ALICE, Mailroom.ADMINISTRATOR }) {
            NuxeoException status = Mailroom.refusedDecision(repository, user, id,
                    item -> item.setPropertyValue(Captures.STATUS, Captures.FILED));
            assertEquals(400, status.getStatusCode());
            NuxeoException confidence = Mailroom.refusedDecision(repository, user, id,
                    item -> item.setPropertyValue(Captures.CONFIDENCE, 0.99));
            assertEquals(400, confidence.getStatusCode());
            NuxeoException proposed = Mailroom.refusedDecision(repository, user, id,
                    item -> item.setPropertyValue(Captures.PROPOSED_RECORD, Mailroom.claimId(session, "pc-24002")));
            assertEquals(400, proposed.getStatusCode());
        }
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.REVIEW, text(item, Captures.STATUS));
        assertEquals(0.67, (Double) item.getPropertyValue(Captures.CONFIDENCE), 0);
    }

    @Test
    public void anItemsFileIsWhatCameInAndDoesNotChange() {
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter", Mailroom.letter("PC-24001", 2));
        NuxeoException changed = Mailroom.refusedDecision(repository, ALICE, id,
                item -> item.setPropertyValue("file:content", (Serializable) Mailroom.file("Another letter", "l.txt")));
        assertEquals(409, changed.getStatusCode());
        NuxeoException removed = Mailroom.refusedDecision(repository, ALICE, id,
                item -> item.setPropertyValue("file:content", null));
        assertEquals(409, removed.getStatusCode());
        // Its title is the person's to change, as any document's.
        Mailroom.decide(repository, ALICE, id, item -> item.setPropertyValue("dc:title", "Letter from the policyholder"));
        assertEquals("Letter from the policyholder", text(Mailroom.stored(repository, id), "dc:title"));
    }

    @Test
    public void theFacetComesWithTheType() {
        // A type's own facet cannot be removed from one of its documents: Nuxeo keeps it, and the
        // item's capt: with it.
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter", Mailroom.letter("PC-24001", 2));
        Mailroom.decide(repository, Mailroom.ADMINISTRATOR, id, item -> assertFalse(item.removeFacet(Captures.FACET)));
        assertEquals(Captures.REVIEW, text(Mailroom.stored(repository, id), Captures.STATUS));
        // A document of another type given the facet, to slip past the inbox: refused when it comes in.
        NuxeoException added = Mailroom.refusedAs(repository, ALICE, s -> {
            DocumentModel claim = s.createDocumentModel(Mailroom.CLAIMS, "sneaky", "TestClaim");
            claim.addFacet(Captures.FACET);
            claim.setPropertyValue(Captures.STATUS, Captures.FILED);
            return s.createDocument(claim);
        });
        assertEquals(400, added.getStatusCode());
        // And on one already there.
        String claim = Mailroom.claimId(session, "pc-24001");
        NuxeoException later = Mailroom.refusedAs(repository, ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(claim));
            doc.addFacet(Captures.FACET);
            return s.saveDocument(doc);
        });
        assertEquals(400, later.getStatusCode());
    }

    @Test
    public void noItemIsCopiedNorAFolderHoldingOne() {
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter", Mailroom.letter("PC-24001", 3));
        NuxeoException item = Mailroom.refusedAs(repository, Mailroom.ADMINISTRATOR,
                s -> s.copy(new IdRef(id), new PathRef(INBOX), "letter-copy"));
        assertEquals(400, item.getStatusCode());
        NuxeoException folder = Mailroom.refusedAs(repository, Mailroom.ADMINISTRATOR,
                s -> s.copy(new PathRef(INBOX), new PathRef("/elsewhere"), "inbox-copy"));
        assertEquals(400, folder.getStatusCode());
        assertEquals(1, Mailroom.count(repository, "SELECT * FROM TestMail"));
        assertFalse(Mailroom.inTransactionAs(repository, Mailroom.ADMINISTRATOR,
                s -> s.exists(new PathRef("/elsewhere/inbox-copy"))));
        // A folder holding none is copied as ever.
        Mailroom.inTransactionAs(repository, Mailroom.ADMINISTRATOR,
                s -> s.copy(new PathRef("/desk/notes"), new PathRef("/elsewhere"), "notes-copy"));
        assertTrue(Mailroom.inTransactionAs(repository, Mailroom.ADMINISTRATOR,
                s -> s.exists(new PathRef("/elsewhere/notes-copy"))));
    }
}
