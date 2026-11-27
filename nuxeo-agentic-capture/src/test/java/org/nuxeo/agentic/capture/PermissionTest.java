/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.capture.Captures.text;
import static org.nuxeo.agentic.capture.Mailroom.ALICE;
import static org.nuxeo.agentic.capture.Mailroom.BOB;
import static org.nuxeo.agentic.capture.Mailroom.CAROL;
import static org.nuxeo.agentic.capture.Mailroom.DAVE;
import static org.nuxeo.agentic.capture.Mailroom.INBOX;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * Who may do what: who uploads, the inbox's permissions; who decides, its items' write; and who
 * files, only on a record they may write, which the server checks as them, and writes as them.
 * The automatic filing is the system's, on the profile's records, whoever uploaded.
 */
@RunWith(FeaturesRunner.class)
@Features(CaptureFeature.class)
public class PermissionTest {

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

    private String waiting(String claimNumber) {
        return Mailroom.mail(repository, CAROL, INBOX, "letter-" + claimNumber, Mailroom.letter(claimNumber, 2));
    }

    @Test
    public void onlyThoseWhoMayAddToTheInboxUpload() {
        NuxeoException refused = Mailroom.refusedAs(repository, DAVE, s -> s.createDocument(
                Mailroom.model(s, INBOX, "letter", Mailroom.file("Claim number: PC-24001", "l.txt"))));
        assertTrue(refused.getClass().getName(), refused instanceof DocumentSecurityException);
        assertEquals(0, Mailroom.count(repository, "SELECT * FROM TestMail"));
    }

    @Test
    public void theScannersAccountUploadsAndTheSystemFilesOnTheProfilesRecords() {
        // Carol may add to the inbox and may not write any claim: the filing is the system's.
        String claim = Mailroom.claimId(session, "pc-24001");
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter", Mailroom.letter("PC-24001", 3));
        assertEquals(Captures.FILED, text(Mailroom.stored(repository, id), Captures.STATUS));
        assertEquals(1, Mailroom.attachments(repository, claim).size());
        // A claim no one but an administrator reads is still the profile's, by its number.
        String hidden = Mailroom.claimId(session, "pc-24007");
        Mailroom.mail(repository, CAROL, INBOX, "hidden", Mailroom.letter("PC-24007", 3));
        assertEquals(1, Mailroom.attachments(repository, hidden).size());
    }

    @Test
    public void onlyThoseWhoMayWriteAnItemDecideOnIt() {
        String id = waiting("PC-24001");
        // Dave reads the inbox, and writes nothing of it.
        NuxeoException refused = Mailroom.refusedDecision(repository, DAVE, id,
                item -> item.setPropertyValue(Captures.DECISION, Captures.REJECT));
        assertTrue(refused.getClass().getName(), refused instanceof DocumentSecurityException);
        assertEquals(Captures.REVIEW, text(Mailroom.stored(repository, id), Captures.STATUS));
    }

    @Test
    public void aPersonWhoMayNotWriteTheClaimDoesNotFileOnIt() {
        String claim = Mailroom.claimId(session, "pc-24001");
        String id = waiting("PC-24001");
        // Bob writes the inbox, and only reads the claims.
        NuxeoException refused = Mailroom.refusedDecision(repository, BOB, id,
                item -> item.setPropertyValue(Captures.DECISION, Captures.CONFIRM));
        assertEquals(403, refused.getStatusCode());
        // The add-on's own refusal, before anything is written; the platform's check on the write backs it.
        assertTrue(refused.getMessage(), refused.getMessage().contains("may not write the record"));
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.REVIEW, text(item, Captures.STATUS));
        assertTrue(Mailroom.attachments(repository, claim).isEmpty());
        // Alice writes it, and files.
        Mailroom.decide(repository, ALICE, id, i -> i.setPropertyValue(Captures.DECISION, Captures.CONFIRM));
        assertEquals(Captures.FILED, text(Mailroom.stored(repository, id), Captures.STATUS));
        assertEquals(1, Mailroom.attachments(repository, claim).size());
    }

    @Test
    public void aClaimThePersonMayNotReadIsRefusedAsUnreadable() {
        String hidden = Mailroom.claimId(session, "pc-24007");
        String id = Mailroom.mail(repository, CAROL, INBOX, "letter", Mailroom.letter("PC-29999", 3));
        assertEquals(Captures.UNMATCHED, text(Mailroom.stored(repository, id), Captures.REASON));
        // By its id, unreadable to Alice: 403, and nothing said of it.
        NuxeoException byId = Mailroom.refusedDecision(repository, ALICE, id, item -> {
            Mailroom.field(item, "claimNumber", null);
            item.setPropertyValue(Captures.RECORD, hidden);
            item.setPropertyValue(Captures.DECISION, Captures.CONFIRM);
        });
        assertEquals(403, byId.getStatusCode());
        assertTrue(byId.getMessage(), byId.getMessage().contains("may not read the record"));
        // By its number: matched as the system, then read as Alice, and refused the same way.
        NuxeoException byNumber = Mailroom.refusedDecision(repository, ALICE, id, item -> {
            Mailroom.field(item, "claimNumber", "PC-24007");
            item.setPropertyValue(Captures.DECISION, Captures.CONFIRM);
        });
        assertEquals(403, byNumber.getStatusCode());
        assertTrue(byNumber.getMessage(), byNumber.getMessage().contains("may not read the record"));
        assertTrue(Mailroom.attachments(repository, hidden).isEmpty());
        // An administrator may.
        Mailroom.decide(repository, Mailroom.ADMINISTRATOR, id, item -> {
            Mailroom.field(item, "claimNumber", "PC-24007");
            item.setPropertyValue(Captures.DECISION, Captures.CONFIRM);
        });
        assertEquals(1, Mailroom.attachments(repository, hidden).size());
    }
}
