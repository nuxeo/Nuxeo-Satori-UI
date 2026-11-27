/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

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
import org.nuxeo.ecm.core.api.trash.TrashService;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * What no one but the server changes: a letter template is an administrator's to create, change,
 * copy, trash and remove; a letter is written by {@code Letter.Generate} alone, is changed by no one,
 * an administrator included, is not copied, and is trashed or removed by an administrator alone.
 */
@RunWith(FeaturesRunner.class)
@Features(LettersFeature.class)
public class GuardTest {

    @Inject
    protected CoreSession session;

    protected String repository;

    protected String claim;

    protected String template;

    @Before
    public void setUp() {
        repository = session.getRepositoryName();
        Office.create(session);
        // alice may write the templates' folder too, as she may the claims': only the guard stops her.
        String member = Office.member(repository, Office.MEMBERS, "maria", "Maria", "Lopez", "Oakland");
        claim = Office.claim(repository, "CLM-5001", "denied", member, "en");
        template = Office.template(repository, "test-denial-en", Office.DENIAL, "en", Office.DENIAL_EN);
    }

    // ------------------------------------------------------------------ templates

    @Test
    public void onlyAnAdministratorCreatesATemplate() {
        NuxeoException refused = Office.refusedAs(repository, Office.ALICE, s -> s.createDocument(
                Office.templateModel(s, "test-alice-en", "test.alice", "en", "<p>{{tclaim:number}}</p>")));
        assertEquals(403, refused.getStatusCode());
        Office.asAdministrator(repository, s -> {
            assertEquals(1, s.query("SELECT * FROM LetterTemplate").size());
            return null;
        });
    }

    @Test
    public void onlyAnAdministratorChangesATemplate() {
        NuxeoException refused = Office.refusedAs(repository, Office.ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(template));
            doc.setPropertyValue("dc:description", "mine now");
            return s.saveDocument(doc);
        });
        assertEquals(403, refused.getStatusCode());
        Office.asAdministrator(repository, s -> {
            DocumentModel doc = s.getDocument(new IdRef(template));
            doc.setPropertyValue("dc:description", "reviewed");
            return s.saveDocument(doc);
        });
        assertEquals("reviewed", Office.stored(repository, template).getPropertyValue("dc:description"));
    }

    @Test
    public void onlyAnAdministratorCopiesTrashesOrRemovesATemplate() {
        assertEquals(403, Office.refusedAs(repository, Office.ALICE,
                s -> s.copy(new IdRef(template), new PathRef(Office.TEMPLATES), "copy")).getStatusCode());
        assertEquals(403, Office.refusedAs(repository, Office.ALICE, s -> {
            Framework.getService(TrashService.class).trashDocument(s.getDocument(new IdRef(template)));
            return null;
        }).getStatusCode());
        assertEquals(403, Office.refusedAs(repository, Office.ALICE, s -> {
            s.removeDocument(new IdRef(template));
            return null;
        }).getStatusCode());
        assertTrue(!Office.stored(repository, template).isTrashed());
        Office.asAdministrator(repository, s -> {
            s.removeDocument(new IdRef(template));
            return null;
        });
    }

    // ------------------------------------------------------------------ letters

    @Test
    public void aLetterIsWrittenByLetterGenerateAlone() {
        for (String user : new String[] { Office.ALICE, Office.ADMINISTRATOR }) {
            NuxeoException refused = Office.refusedAs(repository, user, s -> {
                DocumentModel forged = s.createDocumentModel(Office.CLAIMS, "forged", "Letter");
                forged.setPropertyValue("dc:title", "Claim denial, CLM-5001");
                forged.setPropertyValue("letter:record", claim);
                forged.setPropertyValue("letter:template", template);
                forged.setPropertyValue("file:content", (Serializable) Office.html("x.html", "<p>We approve.</p>"));
                return s.createDocument(forged);
            });
            assertEquals(user, 403, refused.getStatusCode());
        }
        assertEquals(0, Office.letters(repository, claim).size());
    }

    @Test
    public void aLetterIsChangedByNoOneAnAdministratorIncluded() {
        DocumentModel letter = Office.generate(repository, Office.ALICE, claim, Office.DENIAL, null);
        String written = Office.text(Office.stored(repository, letter.getId()));
        for (String user : new String[] { Office.ALICE, Office.ADMINISTRATOR }) {
            assertEquals(403, Office.refusedAs(repository, user, s -> {
                DocumentModel doc = s.getDocument(new IdRef(letter.getId()));
                doc.setPropertyValue("file:content", (Serializable) Office.html("x.html", "<p>We approve.</p>"));
                return s.saveDocument(doc);
            }).getStatusCode());
            assertEquals(403, Office.refusedAs(repository, user, s -> {
                DocumentModel doc = s.getDocument(new IdRef(letter.getId()));
                doc.setPropertyValue("letter:record", "another");
                return s.saveDocument(doc);
            }).getStatusCode());
            assertEquals(403, Office.refusedAs(repository, user, s -> {
                DocumentModel doc = s.getDocument(new IdRef(letter.getId()));
                doc.setPropertyValue("dc:title", "Claim approval");
                return s.saveDocument(doc);
            }).getStatusCode());
            assertEquals(403, Office.refusedAs(repository, user, s -> {
                DocumentModel doc = s.getDocument(new IdRef(letter.getId()));
                doc.setPropertyValue("nxts:bindings", null);
                return s.saveDocument(doc);
            }).getStatusCode());
        }
        DocumentModel stored = Office.stored(repository, letter.getId());
        assertEquals(written, Office.text(stored));
        assertEquals(claim, stored.getPropertyValue("letter:record"));
        // What is not the letter's own may change: a description.
        Office.inTransactionAs(repository, Office.ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(letter.getId()));
            doc.setPropertyValue("dc:description", "sent by post");
            return s.saveDocument(doc);
        });
    }

    @Test
    public void aLetterIsNotCopied() {
        DocumentModel letter = Office.generate(repository, Office.ALICE, claim, Office.DENIAL, null);
        for (String user : new String[] { Office.ALICE, Office.ADMINISTRATOR }) {
            assertEquals(403, Office.refusedAs(repository, user,
                    s -> s.copy(new IdRef(letter.getId()), new PathRef(Office.CLAIMS), "copy")).getStatusCode());
        }
        assertEquals(1, Office.letters(repository, claim).size());
    }

    @Test
    public void onlyAnAdministratorTrashesOrRemovesALetter() {
        DocumentModel letter = Office.generate(repository, Office.ALICE, claim, Office.DENIAL, null);
        assertEquals(403, Office.refusedAs(repository, Office.ALICE, s -> {
            Framework.getService(TrashService.class).trashDocument(s.getDocument(new IdRef(letter.getId())));
            return null;
        }).getStatusCode());
        assertEquals(403, Office.refusedAs(repository, Office.ALICE, s -> {
            s.removeDocument(new IdRef(letter.getId()));
            return null;
        }).getStatusCode());
        assertEquals(1, Office.letters(repository, claim).size());
        Office.asAdministrator(repository, s -> {
            Framework.getService(TrashService.class).trashDocument(s.getDocument(new IdRef(letter.getId())));
            return null;
        });
        assertEquals(0, Office.letters(repository, claim).size());
    }
}
