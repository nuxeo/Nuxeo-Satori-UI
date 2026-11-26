/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.documents.ControlledDocuments.NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.REVISION;
import static org.nuxeo.agentic.documents.ControlledDocuments.SERIES;
import static org.nuxeo.agentic.documents.ControlledDocuments.STATUS;
import static org.nuxeo.agentic.documents.ControlledDocuments.SUPERSEDED_BY;
import static org.nuxeo.agentic.documents.Library.ALICE;
import static org.nuxeo.agentic.documents.Library.DRAWING;
import static org.nuxeo.agentic.documents.Library.DRAWINGS;
import static org.nuxeo.agentic.documents.Library.SPEC;
import static org.nuxeo.agentic.documents.Library.text;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * A first revision is numbered from its series on creation, whatever its creator wrote.
 */
@RunWith(FeaturesRunner.class)
@Features(ControlledDocumentsFeature.class)
public class NumberingTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private CoreSession alice;

    @Before
    public void setUp() {
        Library.create(session);
        Library.resetSeries("DWG", "SPEC");
        alice = Library.as(core.getRepositoryName(), ALICE);
    }

    @Test
    public void aFirstRevisionIsGivenItsSeriesNextNumberTheFirstRevisionAndCurrent() {
        DocumentModel first = Library.first(alice, DRAWINGS, DRAWING, "pump", "DWG");
        DocumentModel second = Library.first(alice, DRAWINGS, DRAWING, "valve", "DWG");

        assertEquals("DWG-00001", text(first, NUMBER));
        assertEquals("A", text(first, REVISION));
        assertEquals("current", text(first, STATUS));
        assertNull(text(first, SUPERSEDED_BY));
        assertEquals("DWG-00002", text(second, NUMBER));
        // As stored, not only as the creation answered.
        alice.save();
        assertEquals("DWG-00002", text(alice.getDocument(second.getRef()), NUMBER));
    }

    @Test
    public void eachSeriesCountsAloneAndWritesItsOwnRevisions() {
        DocumentModel drawing = Library.first(alice, DRAWINGS, DRAWING, "pump", "DWG");
        DocumentModel spec = Library.first(alice, DRAWINGS, SPEC, "pump-spec", "SPEC");
        DocumentModel second = Library.first(alice, DRAWINGS, SPEC, "valve-spec", "SPEC");

        assertEquals("DWG-00001", text(drawing, NUMBER));
        assertEquals("SPEC-001", text(spec, NUMBER));
        assertEquals("1", text(spec, REVISION));
        assertEquals("SPEC-002", text(second, NUMBER));
    }

    @Test
    public void whatTheCreatorWritesInTheControlledPropertiesIsReplaced() {
        DocumentModel doc = alice.createDocumentModel(DRAWINGS, "forged", DRAWING);
        doc.setPropertyValue(SERIES, "DWG");
        doc.setPropertyValue(NUMBER, "DWG-99999");
        doc.setPropertyValue(REVISION, "Z");
        doc.setPropertyValue(STATUS, "superseded");
        doc.setPropertyValue(SUPERSEDED_BY, "4f0c1e1a-0000-4000-8000-000000000000");
        DocumentModel created = alice.createDocument(doc);

        assertEquals("DWG-00001", text(created, NUMBER));
        assertEquals("A", text(created, REVISION));
        assertEquals("current", text(created, STATUS));
        assertNull(text(created, SUPERSEDED_BY));
    }

    @Test
    public void aNewDocumentWithNoSeriesOrAnUnregisteredOneIsRefused() {
        NuxeoException none = assertThrows(NuxeoException.class,
                () -> Library.first(alice, DRAWINGS, DRAWING, "none", null));
        assertEquals(400, none.getStatusCode());
        NuxeoException unknown = assertThrows(NuxeoException.class,
                () -> Library.first(alice, DRAWINGS, DRAWING, "unknown", "NOPE"));
        assertEquals(400, unknown.getStatusCode());
        assertTrue(unknown.getMessage(), unknown.getMessage().contains("\"NOPE\" is not registered"));
        // A creator's text that is not a series id is not written back into the message.
        NuxeoException odd = assertThrows(NuxeoException.class,
                () -> Library.first(alice, DRAWINGS, DRAWING, "odd", "dwg\nforged log line"));
        assertTrue(odd.getMessage(), odd.getMessage().contains("that is not a series id"));
    }

    /** A type decides what is controlled: the facet added to one new document is refused. */
    @Test
    public void theFacetAddedToANewDocumentOfAnotherTypeIsRefused() {
        DocumentModel file = alice.createDocumentModel(DRAWINGS, "sneaky", "File");
        file.addFacet(ControlledDocuments.FACET);
        file.setPropertyValue(SERIES, "DWG");
        NuxeoException refused = assertThrows(NuxeoException.class, () -> alice.createDocument(file));
        assertEquals(400, refused.getStatusCode());
        assertTrue(refused.getMessage(), refused.getMessage().contains("facet"));
    }

    @Test
    public void aDocumentWithoutTheFacetIsLeftAlone() {
        DocumentModel file = alice.createDocumentModel(DRAWINGS, "plain", "File");
        file.setPropertyValue("dc:title", "plain");
        DocumentModel created = alice.createDocument(file);
        assertTrue(!created.hasSchema(ControlledDocuments.SCHEMA));
    }
}
