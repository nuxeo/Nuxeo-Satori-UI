/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * Who may write a letter: someone who may write the record, and add a document beside it, and read
 * the template and every record it prints. Every refusal writes nothing.
 */
@RunWith(FeaturesRunner.class)
@Features(LettersFeature.class)
public class PermissionTest {

    @Inject
    protected CoreSession session;

    protected String repository;

    protected String member;

    protected String claim;

    @Before
    public void setUp() {
        repository = session.getRepositoryName();
        Office.create(session);
        member = Office.member(repository, Office.MEMBERS, "maria", "Maria", "Lopez", "Oakland");
        claim = Office.claim(repository, "CLM-3001", "denied", member, "en");
        Office.template(repository, "test-denial-en", Office.DENIAL, "en", Office.DENIAL_EN);
    }

    @Test
    public void refusedWithoutWriteOnTheRecord() {
        // bob reads the claim and may not change it.
        Office.inTransactionAs(repository, Office.BOB, s -> s.getDocument(new org.nuxeo.ecm.core.api.IdRef(claim)));
        NuxeoException refused = Office.refusedGenerate(repository, Office.BOB, claim, Office.DENIAL, null);
        assertEquals(403, refused.getStatusCode());
        assertTrue(refused.getMessage(), refused.getMessage().contains("needs the Write permission"));
        assertEquals(0, Office.letters(repository, claim).size());
    }

    @Test
    public void refusedWithoutWriteBeforeAnyTemplateIsLookedFor() {
        // A letter with no template at all is refused for its permission first, not 404: a reader
        // learns nothing of which letters there are.
        NuxeoException refused = Office.refusedGenerate(repository, Office.BOB, claim, "test.unknown", "zz");
        assertEquals(403, refused.getStatusCode());
    }

    @Test
    public void refusedWhenTheRecordCannotBeRead() {
        NuxeoException refused = Office.refusedGenerate(repository, Office.CAROL, claim, Office.DENIAL, null);
        assertEquals(403, refused.getStatusCode());
        assertEquals(0, Office.letters(repository, claim).size());
    }

    @Test
    public void refusedWhenTheWriterMayNotAddADocumentBesideTheRecord() {
        // dave may write his claim, and may only read its folder: the platform refuses the letter.
        String his = Office.claim(repository, "CLM-3002", "denied", member, "en");
        Office.grant(repository, his, Office.DAVE, "ReadWrite");
        NuxeoException refused = Office.refusedGenerate(repository, Office.DAVE, his, Office.DENIAL, null);
        assertEquals(403, refused.getStatusCode());
        assertEquals(0, Office.letters(repository, his).size());
    }

    @Test
    public void refusedWhenTheLetterPrintsARecordTheWriterMayNotRead() {
        String sealed = Office.member(repository, Office.SEALED, "sealed", "Sam", "Hidden", "Nowhere");
        String claimOfSealed = Office.claim(repository, "CLM-3003", "denied", sealed, "en");
        NuxeoException refused = Office.refusedGenerate(repository, Office.ALICE, claimOfSealed, Office.DENIAL,
                null);
        assertEquals(403, refused.getStatusCode());
        assertTrue(refused.getMessage(), refused.getMessage().contains("you may not read"));
        assertEquals(0, Office.letters(repository, claimOfSealed).size());
        // The administrator, who may read it, writes the letter.
        DocumentModel letter = Office.generate(repository, Office.ADMINISTRATOR, claimOfSealed, Office.DENIAL, null);
        assertTrue(Office.text(Office.stored(repository, letter.getId())).contains("Dear Sam Hidden"));
    }

    @Test
    public void aTemplateTheWriterMayNotReadIsNoTemplate() {
        String sealedTemplate = Office.asAdministrator(repository, s -> {
            DocumentModel doc = Office.templateModel(s, "test-sealed-en", "test.sealed", "en", "<p>Sealed</p>");
            doc.setPathInfo(Office.SEALED, "test-sealed-en");
            return s.createDocument(doc).getId();
        });
        assertTrue(sealedTemplate != null);
        NuxeoException refused = Office.refusedGenerate(repository, Office.ALICE, claim, "test.sealed", null);
        assertEquals(404, refused.getStatusCode());
        assertEquals(0, Office.letters(repository, claim).size());
    }

    @Test
    public void refusedOnARecordWithoutTheCorrespondenceFacet() {
        String plain = Office.claim(repository, "TestPlain", "CLM-3004", "denied", member, null);
        NuxeoException refused = Office.refusedGenerate(repository, Office.ALICE, plain, Office.DENIAL, null);
        assertEquals(400, refused.getStatusCode());
        assertEquals(0, Office.letters(repository, plain).size());
    }

    @Test
    public void refusedOnARecordInTheTrash() {
        Office.asAdministrator(repository, s -> {
            org.nuxeo.runtime.api.Framework.getService(org.nuxeo.ecm.core.api.trash.TrashService.class)
                                           .trashDocument(s.getDocument(new org.nuxeo.ecm.core.api.IdRef(claim)));
            return null;
        });
        NuxeoException refused = Office.refusedGenerate(repository, Office.ALICE, claim, Office.DENIAL, null);
        assertEquals(409, refused.getStatusCode());
        assertEquals(0, Office.letters(repository, claim).size());
    }
}
