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
 * The language a letter is written in: the one asked for, when a template is in it, and refused
 * when none is; with none asked for, the record's when a template is in it, else the server's
 * default; and, of the templates in that language, the one whose conditions the record meets.
 */
@RunWith(FeaturesRunner.class)
@Features(LettersFeature.class)
public class LanguageTest {

    @Inject
    protected CoreSession session;

    protected String repository;

    protected String member;

    @Before
    public void setUp() {
        repository = session.getRepositoryName();
        Office.create(session);
        member = Office.member(repository, Office.MEMBERS, "maria", "Maria", "Lopez", "Oakland");
        Office.template(repository, "test-denial-en", Office.DENIAL, "en", Office.DENIAL_EN);
        Office.template(repository, "test-denial-es", Office.DENIAL, "es", Office.DENIAL_ES);
    }

    private DocumentModel written(String claim, String language) {
        DocumentModel letter = Office.generate(repository, Office.ALICE, claim, Office.DENIAL, language);
        return Office.stored(repository, letter.getId());
    }

    @Test
    public void theRecordsLanguageWhenATemplateIsInIt() {
        String claim = Office.claim(repository, "CLM-2001", "denied", member, "es");
        DocumentModel letter = written(claim, null);
        assertEquals("es", letter.getPropertyValue("letter:language"));
        assertEquals("test-denial-es", letter.getPropertyValue("letter:templateName"));
        String text = Office.text(letter);
        assertTrue(text, text.contains("Estimado/a Maria Lopez:"));
        assertTrue(text, text.contains("por USD 1.250,50"));
        assertTrue(text, text.matches("(?s).*<p>\\d{1,2} de [a-z]+ de \\d{4}</p>.*"));
    }

    @Test
    public void aChosenLanguageOverTheRecords() {
        String claim = Office.claim(repository, "CLM-2002", "denied", member, "es");
        DocumentModel letter = written(claim, "en");
        assertEquals("en", letter.getPropertyValue("letter:language"));
        assertTrue(Office.text(letter).contains("Dear Maria Lopez"));
    }

    @Test
    public void aChosenLanguageWithNoTemplateIsRefusedAndWritesNothing() {
        String claim = Office.claim(repository, "CLM-2003", "denied", member, "es");
        NuxeoException refused = Office.refusedGenerate(repository, Office.ALICE, claim, Office.DENIAL, "sv");
        assertEquals(400, refused.getStatusCode());
        assertTrue(refused.getMessage(), refused.getMessage().contains("is in sv"));
        assertEquals(0, Office.letters(repository, claim).size());
    }

    @Test
    public void aChosenLanguageThatIsNoLanguageTagIsRefused() {
        String claim = Office.claim(repository, "CLM-2004", "denied", member, "es");
        for (String language : new String[] { "ES", "english", "e", "es_ES", "es-es", "../en" }) {
            NuxeoException refused = Office.refusedGenerate(repository, Office.ALICE, claim, Office.DENIAL, language);
            assertEquals(language, 400, refused.getStatusCode());
            assertTrue(refused.getMessage(), refused.getMessage().contains("is a language tag"));
        }
    }

    @Test
    public void theDefaultWhenTheRecordsLanguageHasNoTemplate() {
        String swedish = Office.claim(repository, "CLM-2005", "denied", member, "sv");
        assertEquals("en", written(swedish, null).getPropertyValue("letter:language"));
        String none = Office.claim(repository, "CLM-2006", "denied", member, null);
        assertEquals("en", written(none, null).getPropertyValue("letter:language"));
        // A record's language that is no language tag is no language.
        String odd = Office.claim(repository, "CLM-2007", "denied", member, "Spanish");
        assertEquals("en", written(odd, null).getPropertyValue("letter:language"));
    }

    @Test
    public void theServersDefaultLanguage() {
        String swedish = Office.claim(repository, "CLM-2008", "denied", member, "sv");
        Office.withProperty(Letters.DEFAULT_LANGUAGE_PROPERTY, "es",
                () -> assertEquals("es", written(swedish, null).getPropertyValue("letter:language")));
        // A setting that is no language tag is the add-on's own default.
        Office.withProperty(Letters.DEFAULT_LANGUAGE_PROPERTY, "spanish!",
                () -> assertEquals("en", written(swedish, null).getPropertyValue("letter:language")));
    }

    @Test
    public void noTemplateInTheRecordsLanguageNorTheDefaultIs404() {
        String swedish = Office.claim(repository, "CLM-2009", "denied", member, "sv");
        Office.withProperty(Letters.DEFAULT_LANGUAGE_PROPERTY, "fi", () -> {
            NuxeoException refused = Office.refusedGenerate(repository, Office.ALICE, swedish, Office.DENIAL, null);
            assertEquals(404, refused.getStatusCode());
        });
        assertEquals(0, Office.letters(repository, swedish).size());
    }

    @Test
    public void aLetterWithNoTemplateForTheRecordsTypeIs404() {
        String claim = Office.claim(repository, "CLM-2010", "denied", member, "en");
        NuxeoException refused = Office.refusedGenerate(repository, Office.ALICE, claim, "test.unknown", null);
        assertEquals(404, refused.getStatusCode());
    }

    @Test
    public void theTemplateWhoseConditionsTheRecordMeets() {
        Office.template(repository, "test-outcome-upheld-en", "test.outcome", "en",
                "<p>Upheld: {{tclaim:number}}</p>", "tclaim:status=upheld");
        Office.template(repository, "test-outcome-overturned-en", "test.outcome", "en",
                "<p>Overturned: {{tclaim:number}}</p>", "tclaim:status=overturned", "tclaim:codes=A01");
        String upheld = Office.claim(repository, "CLM-2011", "upheld", member, "en");
        String overturned = Office.claim(repository, "CLM-2012", "overturned", member, "en");
        assertEquals("test-outcome-upheld-en",
                Office.stored(repository, Office.generate(repository, Office.ALICE, upheld, "test.outcome", null).getId())
                      .getPropertyValue("letter:templateName"));
        assertEquals("test-outcome-overturned-en",
                Office.stored(repository,
                        Office.generate(repository, Office.ALICE, overturned, "test.outcome", null).getId())
                      .getPropertyValue("letter:templateName"));
        // A record no template's conditions fit: 409, nothing written.
        String open = Office.claim(repository, "CLM-2013", "open", member, "en");
        NuxeoException none = Office.refusedGenerate(repository, Office.ALICE, open, "test.outcome", null);
        assertEquals(409, none.getStatusCode());
        assertEquals(0, Office.letters(repository, open).size());
        // A list's condition is met by any of its values, and not by another.
        Office.set(repository, overturned, "tclaim:codes", new String[] { "C03" });
        assertEquals(409, Office.refusedGenerate(repository, Office.ALICE, overturned, "test.outcome", null)
                                .getStatusCode());
    }

    @Test
    public void twoTemplatesThatBothFitAreRefused() {
        Office.template(repository, "test-denial-en-again", Office.DENIAL, "en", "<p>Again {{tclaim:number}}</p>");
        String claim = Office.claim(repository, "CLM-2014", "denied", member, "en");
        NuxeoException refused = Office.refusedGenerate(repository, Office.ALICE, claim, Office.DENIAL, null);
        assertEquals(409, refused.getStatusCode());
        assertEquals(0, Office.letters(repository, claim).size());
    }

    @Test
    public void aTrashedTemplateIsNoTemplate() {
        String claim = Office.claim(repository, "CLM-2015", "denied", member, "es");
        Office.asAdministrator(repository, s -> {
            org.nuxeo.ecm.core.api.DocumentModel spanish = s.getDocument(
                    new org.nuxeo.ecm.core.api.PathRef(Office.TEMPLATES + "/test-denial-es"));
            org.nuxeo.runtime.api.Framework.getService(org.nuxeo.ecm.core.api.trash.TrashService.class)
                                           .trashDocument(spanish);
            return null;
        });
        assertEquals("en", written(claim, null).getPropertyValue("letter:language"));
    }
}
