/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.util.List;
import java.util.Map;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.template.api.adapters.TemplateBasedDocument;

/**
 * A letter generated and filed: written next to its record, linked to it and to its template, its
 * file the template's text with every placeholder filled from the record, the member it names and
 * the letter's own values, escaped, and bound to its template as the platform binds a document.
 */
@RunWith(FeaturesRunner.class)
@Features(LettersFeature.class)
public class GenerateTest {

    @Inject
    protected CoreSession session;

    protected String repository;

    protected String member;

    protected String claim;

    protected String template;

    @Before
    public void setUp() {
        repository = session.getRepositoryName();
        Office.create(session);
        member = Office.member(repository, Office.MEMBERS, "maria", "Maria", "Lopez", "Oakland");
        claim = Office.claim(repository, "CLM-1001", "denied", member, "en");
        template = Office.template(repository, "test-denial-en", Office.DENIAL, "en", Office.DENIAL_EN);
    }

    @Test
    public void aWriterGeneratesALetterFiledNextToTheRecordAndLinkedToIt() throws Exception {
        DocumentModel letter = Office.generate(repository, Office.ALICE, claim, Office.DENIAL, null);
        DocumentModel stored = Office.stored(repository, letter.getId());
        assertEquals("Letter", stored.getType());
        assertEquals("/office/claims", stored.getPath().removeLastSegments(1).toString());
        assertEquals(claim, stored.getPropertyValue("letter:record"));
        assertEquals(Office.DENIAL, stored.getPropertyValue("letter:letter"));
        assertEquals(template, stored.getPropertyValue("letter:template"));
        assertEquals("test-denial-en", stored.getPropertyValue("letter:templateName"));
        assertEquals("en", stored.getPropertyValue("letter:language"));
        assertEquals(Office.ALICE, stored.getPropertyValue("letter:writtenBy"));
        assertNotNull(stored.getPropertyValue("letter:writtenAt"));
        assertEquals("Claim denial, CLM-1001", stored.getTitle());
        assertEquals(List.of(stored.getId()), Office.letters(repository, claim).stream().map(DocumentModel::getId).toList());

        Blob file = (Blob) stored.getPropertyValue("file:content");
        assertEquals("text/html", file.getMimeType());
        assertEquals("UTF-8", file.getEncoding());
        assertEquals("Claim denial, CLM-1001.html", file.getFilename());
        String text = file.getString();
        assertTrue(text, text.contains("<p>Dear Maria Lopez, of Oakland,</p>"));
        assertTrue(text, text.contains("Your claim CLM-1001, billed USD 1,250.50 for the service of March 4, 2026, "
                + "is denied: not covered by the plan."));
        assertTrue(text, text.contains("Codes: A01, B02. Visits: 3. In en."));
        assertTrue(text, text.contains("<p>alice</p>"));
        assertFalse(text, text.contains("{{"));
        // The template's markup as it was written, around the values.
        assertTrue(text, text.startsWith("<!DOCTYPE html>\n<html lang=\"en\">"));
        assertTrue(text, text.contains("<style>p { margin: 0 0 1em 0; } .small { font-size: 9pt; }</style>"));
    }

    @Test
    public void theLetterIsBoundToItsTemplateAsThePlatformBindsADocument() {
        DocumentModel letter = Office.generate(repository, Office.ALICE, claim, Office.DENIAL, null);
        Office.asAdministrator(repository, s -> {
            DocumentModel stored = s.getDocument(new IdRef(letter.getId()));
            assertTrue(stored.hasFacet("TemplateBased"));
            TemplateBasedDocument based = stored.getAdapter(TemplateBasedDocument.class);
            assertNotNull(based);
            assertEquals(List.of("test-denial-en"), based.getTemplateNames());
            assertEquals(template, based.getSourceTemplateDocRef("test-denial-en").toString());
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> bindings = (List<Map<String, Object>>) stored.getPropertyValue("nxts:bindings");
            assertEquals(1, bindings.size());
            assertEquals(template, bindings.get(0).get("templateId"));
            return null;
        });
    }

    @Test
    public void aRecordsValuesAreEscapedInAnHtmlLetter() throws Exception {
        Office.set(repository, claim, "tclaim:diagnosis", "<script>alert(1)</script> & \"more\"");
        Office.set(repository, member, "tmember:firstName", "<b onclick='x'>Maria</b>");
        DocumentModel letter = Office.generate(repository, Office.ALICE, claim, Office.DENIAL, null);
        String text = Office.text(Office.stored(repository, letter.getId()));
        assertFalse(text, text.contains("<script>"));
        assertFalse(text, text.contains("<b onclick"));
        assertTrue(text, text.contains("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;more&quot;"));
        assertTrue(text, text.contains("Dear &lt;b onclick=&#39;x&#39;&gt;Maria&lt;/b&gt; Lopez"));
    }

    @Test
    public void aTextTemplateWritesATextLetterWithItsValuesAsTheyAre() throws Exception {
        String textTemplate = Office.asAdministrator(repository, s -> {
            DocumentModel doc = Office.templateModel(s, "test-note-en", "test.note", "en",
                    "Claim {{tclaim:number}}: {{tclaim:diagnosis}}\n");
            doc.setPropertyValue("file:content", (java.io.Serializable) org.nuxeo.ecm.core.api.Blobs.createBlob(
                    "Claim {{tclaim:number}}: {{tclaim:diagnosis}}\n", "text/plain", "UTF-8", "note.txt"));
            return s.createDocument(doc).getId();
        });
        assertNotNull(textTemplate);
        Office.set(repository, claim, "tclaim:diagnosis", "a < b & c");
        DocumentModel letter = Office.generate(repository, Office.ALICE, claim, "test.note", null);
        Blob file = (Blob) Office.stored(repository, letter.getId()).getPropertyValue("file:content");
        assertEquals("text/plain", file.getMimeType());
        assertEquals("Claim denial, CLM-1001.txt", file.getFilename());
        assertEquals("Claim CLM-1001: a < b & c\n", file.getString());
    }

    @Test
    public void anEmptyReferenceAndAnEmptyValuePrintNothing() throws Exception {
        Office.set(repository, claim, "tclaim:member", null);
        Office.set(repository, claim, "tclaim:diagnosis", null);
        DocumentModel letter = Office.generate(repository, Office.ALICE, claim, Office.DENIAL, null);
        String text = Office.text(Office.stored(repository, letter.getId()));
        assertTrue(text, text.contains("<p>Dear  , of ,</p>"));
        assertTrue(text, text.contains("is denied: ."));
    }

    @Test
    public void eachLetterIsADocumentOfItsOwn() {
        DocumentModel first = Office.generate(repository, Office.ALICE, claim, Office.DENIAL, null);
        DocumentModel second = Office.generate(repository, Office.ALICE, claim, Office.DENIAL, null);
        assertFalse(first.getId().equals(second.getId()));
        assertEquals(2, Office.letters(repository, claim).size());
    }
}
