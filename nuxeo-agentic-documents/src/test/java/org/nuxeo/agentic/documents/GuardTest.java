/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.documents.ControlledDocuments.NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.PROPERTIES;
import static org.nuxeo.agentic.documents.ControlledDocuments.REVISION;
import static org.nuxeo.agentic.documents.ControlledDocuments.SERIES;
import static org.nuxeo.agentic.documents.ControlledDocuments.STATUS;
import static org.nuxeo.agentic.documents.ControlledDocuments.SUPERSEDED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.SUPERSEDES;
import static org.nuxeo.agentic.documents.Library.ADMINISTRATOR;
import static org.nuxeo.agentic.documents.Library.ALICE;
import static org.nuxeo.agentic.documents.Library.DRAWING;
import static org.nuxeo.agentic.documents.Library.DRAWINGS;
import static org.nuxeo.agentic.documents.Library.text;

import java.util.Map;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.core.api.VersioningOption;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * The six properties are the server's: no save changes them, administrators' included, nor does a
 * copy carry them, nor a restore undo a supersession.
 */
@RunWith(FeaturesRunner.class)
@Features(ControlledDocumentsFeature.class)
public class GuardTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private String repository;

    private String a;

    private String b;

    @Before
    public void setUp() {
        repository = core.getRepositoryName();
        Library.create(session);
        Library.resetSeries("DWG");
        a = Library.inTransactionAs(repository, ALICE,
                s -> Library.first(s, DRAWINGS, DRAWING, "pump", "DWG").getId());
        b = Library.inTransactionAs(repository, ALICE,
                s -> Library.revise(s, DRAWINGS, DRAWING, "pump-b", a).getId());
    }

    /** Each property, changed alone on the current revision B, by its author and by an administrator. */
    @Test
    public void noSaveChangesAControlledPropertyNotEvenAnAdministrators() {
        Map<String, String> forged = Map.of(SERIES, "SPEC", NUMBER, "DWG-00999", REVISION, "Z", STATUS,
                "superseded", SUPERSEDES, "0b1c2d3e-0000-4000-8000-000000000000", SUPERSEDED_BY, a);
        for (String property : PROPERTIES) {
            for (String user : new String[] { ALICE, ADMINISTRATOR }) {
                NuxeoException refused = assertThrows(property + " by " + user, NuxeoException.class,
                        () -> Library.inTransactionAs(repository, user, s -> {
                            DocumentModel doc = s.getDocument(new IdRef(b));
                            doc.setPropertyValue(property, forged.get(property));
                            return s.saveDocument(doc);
                        }));
                assertEquals(property + " by " + user, 400, refused.getStatusCode());
                assertTrue(refused.getMessage(), refused.getMessage().contains(property));
            }
        }
        // Clearing one is a change too.
        assertThrows(NuxeoException.class, () -> Library.inTransactionAs(repository, ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(b));
            doc.setPropertyValue(NUMBER, null);
            return s.saveDocument(doc);
        }));
        DocumentModel stored = Library.stored(repository, b);
        assertEquals("DWG-00001", text(stored, NUMBER));
        assertEquals("B", text(stored, REVISION));
        assertEquals("current", text(stored, STATUS));
    }

    /** A superseded revision is not made current again, nor its link moved. */
    @Test
    public void aSupersededRevisionStaysSuperseded() {
        assertThrows(NuxeoException.class, () -> Library.inTransactionAs(repository, ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(a));
            doc.setPropertyValue(STATUS, "current");
            doc.setPropertyValue(SUPERSEDED_BY, null);
            return s.saveDocument(doc);
        }));
        assertEquals(b, text(Library.stored(repository, a), SUPERSEDED_BY));
    }

    /**
     * The one change the add-on lets through, current to superseded by a document, is its own
     * write only: written by hand, it is refused, even naming a real document.
     */
    @Test
    public void aCurrentRevisionIsNotMarkedSupersededByHand() {
        NuxeoException refused = assertThrows(NuxeoException.class,
                () -> Library.inTransactionAs(repository, ALICE, s -> {
                    DocumentModel doc = s.getDocument(new IdRef(b));
                    doc.setPropertyValue(STATUS, "superseded");
                    doc.setPropertyValue(SUPERSEDED_BY, a);
                    return s.saveDocument(doc);
                }));
        assertEquals(400, refused.getStatusCode());
        assertEquals("current", text(Library.stored(repository, b), STATUS));
    }

    /** Through a live proxy, which writes its document, the properties are no more writable. */
    @Test
    public void aLiveProxyDoesNotWriteThemEither() {
        String proxy = Library.inTransactionAs(repository, ADMINISTRATOR,
                s -> s.createProxy(new IdRef(b), new PathRef("/library")).getId());
        assertThrows(NuxeoException.class, () -> Library.inTransactionAs(repository, ADMINISTRATOR, s -> {
            DocumentModel doc = s.getDocument(new IdRef(proxy));
            doc.setPropertyValue(NUMBER, "DWG-00999");
            return s.saveDocument(doc);
        }));
        assertEquals("DWG-00001", text(Library.stored(repository, b), NUMBER));
    }

    @Test
    public void everyOtherPropertyIsTheUsersToChange() {
        Library.inTransactionAs(repository, ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(b));
            doc.setPropertyValue("dc:title", "Pump housing, revision B");
            // Writing a controlled property's own value back is no change.
            doc.setPropertyValue(NUMBER, "DWG-00001");
            return s.saveDocument(doc);
        });
        assertEquals("Pump housing, revision B", Library.stored(repository, b).getTitle());
    }

    @Test
    public void theFacetIsNotAddedToADocument() {
        String plain = Library.inTransactionAs(repository, ALICE,
                s -> s.createDocument(s.createDocumentModel(DRAWINGS, "plain", "File")).getId());
        NuxeoException refused = assertThrows(NuxeoException.class,
                () -> Library.inTransactionAs(repository, ALICE, s -> {
                    DocumentModel doc = s.getDocument(new IdRef(plain));
                    doc.addFacet(ControlledDocuments.FACET);
                    doc.setPropertyValue(NUMBER, "DWG-00001");
                    return s.saveDocument(doc);
                }));
        assertEquals(400, refused.getStatusCode());
        assertTrue(refused.getMessage(), refused.getMessage().contains("facet"));
        assertTrue(!Library.stored(repository, plain).hasFacet(ControlledDocuments.FACET));
    }

    /** A copy would carry the number: a controlled document, or a folder holding one, is not copied. */
    @Test
    public void aControlledDocumentOrAFolderHoldingOneIsNotCopied() {
        assertEquals(400, assertThrows(NuxeoException.class, () -> Library.inTransactionAs(repository, ALICE,
                s -> s.copy(new IdRef(b), new PathRef(DRAWINGS), "copy"))).getStatusCode());
        assertEquals(400, assertThrows(NuxeoException.class, () -> Library.inTransactionAs(repository, ALICE,
                s -> s.copy(new PathRef(DRAWINGS), new PathRef("/library"), "drawings-copy"))).getStatusCode());
        // A folder whose one controlled document alice may not read is refused too: the copy would
        // take it all the same.
        Library.inTransactionAs(repository, ADMINISTRATOR, s -> {
            s.createDocument(s.createDocumentModel("/library", "vault", "Folder"));
            DocumentModel hidden = s.createDocumentModel("/library/vault", "hidden", DRAWING);
            hidden.setPropertyValue(SERIES, "DWG");
            DocumentModel created = s.createDocument(hidden);
            ACP acp = new ACPImpl();
            acp.getOrCreateACL().add(ACE.BLOCK);
            s.setACP(created.getRef(), acp, true);
            return null;
        });
        assertTrue(Library.inTransactionAs(repository, ALICE,
                s -> s.getChildren(new PathRef("/library/vault")).isEmpty()));
        assertEquals(400, assertThrows(NuxeoException.class, () -> Library.inTransactionAs(repository, ALICE,
                s -> s.copy(new PathRef("/library/vault"), new PathRef("/library"), "vault-copy"))).getStatusCode());
        // A folder holding none is copied as ever.
        Library.inTransactionAs(repository, ALICE, s -> {
            s.createDocument(s.createDocumentModel("/library", "empty", "Folder"));
            return s.copy(new PathRef("/library/empty"), new PathRef("/library"), "empty-copy");
        });
        assertTrue(Library.inTransactionAs(repository, ALICE, s -> s.exists(new PathRef("/library/empty-copy"))));
    }

    /**
     * A version of A taken while it was current is not restored over A, superseded since: that
     * would make two revisions of the number current.
     */
    @Test
    public void aVersionFromBeforeTheSupersessionIsNotRestored() {
        String c = Library.inTransactionAs(repository, ALICE, s -> {
            DocumentModel current = Library.first(s, DRAWINGS, DRAWING, "valve", "DWG");
            return current.getId();
        });
        DocumentRef version = Library.inTransactionAs(repository, ALICE,
                s -> s.checkIn(new IdRef(c), VersioningOption.MAJOR, "issued"));
        Library.inTransactionAs(repository, ALICE, s -> Library.revise(s, DRAWINGS, DRAWING, "valve-b", c));

        NuxeoException refused = assertThrows(NuxeoException.class,
                () -> Library.inTransactionAs(repository, ALICE, s -> s.restoreToVersion(new IdRef(c), version)));
        assertEquals(409, refused.getStatusCode());
        assertEquals("superseded", text(Library.stored(repository, c), STATUS));

        // A version whose controlled properties are the live document's is restored as ever.
        String d = Library.inTransactionAs(repository, ALICE,
                s -> Library.first(s, DRAWINGS, DRAWING, "seal", "DWG").getId());
        DocumentRef same = Library.inTransactionAs(repository, ALICE,
                s -> s.checkIn(new IdRef(d), VersioningOption.MAJOR, "issued"));
        Library.inTransactionAs(repository, ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(d));
            doc.setPropertyValue("dc:title", "changed");
            return s.saveDocument(doc);
        });
        Library.inTransactionAs(repository, ALICE, s -> s.restoreToVersion(new IdRef(d), same));
        assertEquals("seal", Library.stored(repository, d).getTitle());
    }

    /** A version keeps the fields it was made with, as Nuxeo keeps every version's. */
    @Test
    public void aVersionKeepsItsNumberAndIsNotRenumbered() {
        DocumentRef version = Library.inTransactionAs(repository, ALICE,
                s -> s.checkIn(new IdRef(b), VersioningOption.MAJOR, "issued"));
        DocumentModel stored = Library.inTransactionAs(repository, ALICE, s -> s.getDocument(version));
        assertEquals("DWG-00001", text(stored, NUMBER));
        assertEquals("B", text(stored, REVISION));
        assertNull(text(stored, SUPERSEDED_BY));
    }
}
