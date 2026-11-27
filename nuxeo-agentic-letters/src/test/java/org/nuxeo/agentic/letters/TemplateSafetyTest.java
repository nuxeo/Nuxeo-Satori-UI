/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.Serializable;
import java.util.function.Consumer;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.event.EventServiceAdmin;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.template.api.TemplateProcessor;
import org.nuxeo.template.api.TemplateProcessorService;
import org.nuxeo.template.api.adapters.TemplateBasedDocument;

/**
 * A template holds no script that runs, and reaches nothing but its record, the documents its
 * record names one hop away, and the letter's own values. Refused when an administrator saves it,
 * refused again when a letter is written from one that got past the save, and the add-on's
 * processor renders nothing but the letter being written.
 */
@RunWith(FeaturesRunner.class)
@Features(LettersFeature.class)
public class TemplateSafetyTest {

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
        claim = Office.claim(repository, "CLM-4001", "denied", member, "en");
    }

    /** The refusal the administrator gets saving a template of {@code text}, changed by {@code change}. */
    private NuxeoException refusedTemplate(String text, Consumer<DocumentModel> change) {
        NuxeoException refused = Office.refusedAs(repository, Office.ADMINISTRATOR, s -> {
            DocumentModel doc = Office.templateModel(s, "test-refused", Office.DENIAL, "en", text);
            change.accept(doc);
            return s.createDocument(doc);
        });
        assertEquals(refused.getMessage(), 400, refused.getStatusCode());
        return refused;
    }

    private NuxeoException refusedTemplate(String text) {
        return refusedTemplate(text, doc -> {
        });
    }

    private void assertNoTemplateSaved() {
        Office.asAdministrator(repository, s -> {
            assertEquals(0, s.query("SELECT * FROM LetterTemplate").size());
            return null;
        });
    }

    // ------------------------------------------------------------------ nothing that runs

    @Test
    public void anotherEnginesSyntaxIsRefused() {
        String[] scripts = {
                // FreeMarker: an expression, a directive, an object made and run, the platform's context.
                "<p>${doc.title}</p>",
                "<p><#assign ex=\"freemarker.template.utility.Execute\"?new()>${ex(\"id\")}</p>",
                "<p>[#list 1..9 as i]x[/#list]</p>",
                "<p><@macro/></p>",
                "<p>#{principal.name}</p>",
                // Velocity, as XDocReport runs it: a directive, a reference, a quiet reference.
                "<p>#set($x = 1)</p>", "<p>#foreach ($i in $list)x#end</p>", "<p>$class.forName</p>", "<p>$!x</p>",
                // Velocity's directives with no reference: an include, a parse, an evaluation, a condition.
                "<p>#include(\"/etc/hosts\")</p>", "<p>#parse(\"x.vm\")</p>", "<p>#evaluate(\"x\")</p>",
                "<p>#if (true)x#end</p>",
                // JSP, Jinja and their kind.
                "<p><% out.println(1); %></p>", "<p>{% for x in y %}</p>" };
        for (String script : scripts) {
            NuxeoException refused = refusedTemplate(script);
            assertTrue(script + ": " + refused.getMessage(), refused.getMessage().contains("holds"));
        }
        assertNoTemplateSaved();
    }

    @Test
    public void htmlThatRunsOrFetchesIsRefused() {
        String[] html = { "<script>alert(1)</script>", "<p onclick=\"x()\">a</p>", "<p><a href=\"https://example.com\">x</a></p>",
                "<img src=\"https://example.com/t.png\">", "<iframe></iframe>", "<p style=\"background:url(x)\">a</p>",
                "<style>@import 'x.css';</style>", "<p>javascript:alert(1)</p>", "<!--[if IE]><p>x</p><![endif]-->",
                "<meta http-equiv=\"refresh\" content=\"0\">", "<form></form>", "<object></object>",
                "<svg onload=\"x\"></svg>", "<?xml version=\"1.0\"?>", "<p>a < b</p>", "<p>unclosed <!-- comment</p>" };
        for (String each : html) {
            refusedTemplate(each);
        }
        assertNoTemplateSaved();
    }

    @Test
    public void aPlaceholderInsideATagACommentOrAStyleIsRefused() {
        for (String each : new String[] { "<p class=\"{{tclaim:status}}\">x</p>", "<p title={{tclaim:status}}>x</p>",
                "<style>p { color: {{tclaim:status}} }</style>", "<!-- {{tclaim:number}} -->" }) {
            refusedTemplate(each);
        }
        assertNoTemplateSaved();
    }

    // ------------------------------------------------------------------ nothing it should not reach

    @Test
    public void aPlaceholderThatReachesWhatATemplateMayNotIsRefused() {
        String[] reaches = {
                // The platform's FreeMarker context, the session, the principal, the server.
                "{{doc.coreSession}}", "{{principal.model}}", "{{letter.session}}", "{{env:HOME}}",
                "{{tclaim:number.getClass()}}", "{{tclaim:number?api}}", "{{ tclaim:number | upper }}",
                // Repository fields, files and what holds several fields.
                "{{ecm:acl}}", "{{ecm:path}}", "{{file:content}}", "{{file:content/name}}", "{{tclaim:scan}}",
                "{{tclaim:lines}}", "{{tclaim:member>tmember:address}}",
                // A property the type has not, a schema it has not, a second hop, a hop through a subfield.
                "{{tclaim:unknown}}", "{{tmember:firstName}}",
                "{{tclaim:member>tmember:lastName>dc:title}}", "{{tclaim:member/x>dc:title}}",
                // A hop through a property that holds no id.
                "{{tclaim:billedAmount>dc:title}}",
                // Braces that are no placeholder.
                "{{}}", "{{ {{tclaim:number}} }}", "tclaim:number}}", "{{tclaim:number" };
        for (String reach : reaches) {
            refusedTemplate("<p>" + reach + "</p>");
        }
        assertNoTemplateSaved();
    }

    @Test
    public void aPropertyTheServerDeniesIsRefusedOnSaveAndWhenALetterIsWritten() {
        String text = "<p>{{tclaim:member>tmember:ssn}}</p>";
        Office.withProperty(Letters.DENIED_PROPERTIES_PROPERTY, "tmember:ssn, tclaim:diagnosis", () -> {
            refusedTemplate(text);
            refusedTemplate("<p>{{tclaim:diagnosis}}</p>");
            refusedTemplate("<p>x</p>", doc -> doc.setPropertyValue("ltpl:conditions",
                    new String[] { "tclaim:diagnosis=x" }));
        });
        // Saved while the server denied nothing, it is refused once the server denies it.
        Office.template(repository, "test-ssn-en", "test.ssn", "en", text);
        assertTrue(Office.text(Office.stored(repository,
                Office.generate(repository, Office.ALICE, claim, "test.ssn", null).getId())).contains("000-00-0000"));
        Office.withProperty(Letters.DENIED_PROPERTIES_PROPERTY, "tmember:ssn", () -> {
            NuxeoException refused = Office.refusedGenerate(repository, Office.ALICE, claim, "test.ssn", null);
            assertEquals(409, refused.getStatusCode());
            assertTrue(refused.getMessage(), refused.getMessage().contains("keeps from every letter"));
        });
        assertEquals(1, Office.letters(repository, claim).size());
    }

    // ------------------------------------------------------------------ the platform's ways to render it

    @Test
    public void aTemplateIsRenderedByTheAddOnsProcessorAlone() {
        refusedTemplate("<p>x</p>", doc -> doc.setPropertyValue("tmpl:templateType", "Identity"));
        refusedTemplate("<p>x</p>", doc -> doc.setPropertyValue("tmpl:templateType", "Freemarker"));
        refusedTemplate("<p>x</p>", doc -> doc.setPropertyValue("tmpl:forcedTypes", new String[] { "TestClaim" }));
        refusedTemplate("<p>x</p>", doc -> doc.setPropertyValue("tmpl:useAsMainContent", true));
        refusedTemplate("<p>x</p>", doc -> doc.setPropertyValue("tmpl:targetRenditionName", "letter"));
        refusedTemplate("<p>x</p>", doc -> doc.setPropertyValue("tmpl:outputFormat", "nothing-of-the-platform"));
        NuxeoException all = refusedTemplate("<p>x</p>",
                doc -> doc.setPropertyValue("tmpl:applicableTypes", new String[] { "all" }));
        assertTrue(all.getMessage(), all.getMessage().contains("never all"));
        NuxeoException many = refusedTemplate("<p>x</p>", doc -> {
            String[] types = new String[TemplateRules.MAX_TYPES + 1];
            java.util.Arrays.fill(types, "TestClaim");
            doc.setPropertyValue("tmpl:applicableTypes", types);
        });
        assertTrue(many.getMessage(), many.getMessage().contains("at most"));
        refusedTemplate("<p>x</p>", doc -> doc.setPropertyValue("tmpl:applicableTypes", new String[] { "TestPlain" }));
        refusedTemplate("<p>x</p>", doc -> doc.setPropertyValue("tmpl:applicableTypes", new String[] { "Nothing" }));
        refusedTemplate("<p>x</p>", doc -> doc.setPropertyValue("tmpl:applicableTypes", new String[0]));
        refusedTemplate("x", doc -> doc.setPropertyValue("file:content",
                (Serializable) Blobs.createBlob("x", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", null, "x.docx")));
        refusedTemplate("x", doc -> doc.setPropertyValue("file:content", null));
        refusedTemplate("<p>x</p>", doc -> doc.setPropertyValue("ltpl:language", "Spanish"));
        refusedTemplate("<p>x</p>", doc -> doc.setPropertyValue("ltpl:letter", "a letter"));
        refusedTemplate("<p>x</p>", doc -> doc.setPropertyValue("ltpl:conditions", new String[] { "status is denied" }));
        refusedTemplate("<p>x</p>", doc -> doc.setPropertyValue("ltpl:conditions", new String[] { "tclaim:lines=x" }));
        assertNoTemplateSaved();
        // Saved with no processor named, it is the add-on's.
        String saved = Office.template(repository, "test-auto-en", "test.auto", "en", "<p>x</p>");
        assertEquals(Letters.PROCESSOR, Office.stored(repository, saved).getPropertyValue("tmpl:templateType"));
    }

    @Test
    public void theAddOnsProcessorRendersNothingButTheLetterBeingWritten() {
        String template = Office.template(repository, "test-denial-en", Office.DENIAL, "en", Office.DENIAL_EN);
        TemplateProcessor processor = Framework.getService(TemplateProcessorService.class).getProcessor(Letters.PROCESSOR);
        assertTrue(processor instanceof LetterProcessor);
        // The claim bound to the template by the platform, as its TemplateProcessor.Render operation
        // binds any document, and rendered: refused.
        NuxeoException refused = Office.refusedAs(repository, Office.ADMINISTRATOR, s -> {
            DocumentModel bound = Framework.getService(TemplateProcessorService.class)
                                           .makeTemplateBasedDocument(s.getDocument(new IdRef(claim)),
                                                   s.getDocument(new IdRef(template)), true);
            return bound.getAdapter(TemplateBasedDocument.class).renderWithTemplate("test-denial-en");
        });
        assertEquals(403, refused.getStatusCode());
        // A letter already written, rendered again through the platform: refused too.
        DocumentModel letter = Office.generate(repository, Office.ALICE, claim, Office.DENIAL, null);
        NuxeoException again = Office.refusedAs(repository, Office.ADMINISTRATOR, s -> s.getDocument(
                new IdRef(letter.getId())).getAdapter(TemplateBasedDocument.class).renderWithTemplate("test-denial-en"));
        assertEquals(403, again.getStatusCode());
        String text = Office.text(Office.stored(repository, letter.getId()));
        assertTrue(text, text.contains("Dear Maria Lopez"));
    }

    @Test
    public void aTemplateThatGotPastTheSaveIsRefusedWhenALetterIsWritten() {
        String template = Office.template(repository, "test-denial-en", Office.DENIAL, "en", Office.DENIAL_EN);
        EventServiceAdmin events = Framework.getService(EventServiceAdmin.class);
        // Written while the add-on's guard was off, as by a server without the add-on: a script, and
        // the platform's FreeMarker processor.
        events.setListenerEnabledFlag("letterGuard", false);
        try {
            Office.asAdministrator(repository, s -> {
                DocumentModel doc = s.getDocument(new IdRef(template));
                doc.setPropertyValue("file:content", (Serializable) Office.html("x.html",
                        "<p><#assign ex=\"freemarker.template.utility.Execute\"?new()>${ex(\"id\")}</p>"));
                return s.saveDocument(doc);
            });
        } finally {
            events.setListenerEnabledFlag("letterGuard", true);
        }
        NuxeoException refused = Office.refusedGenerate(repository, Office.ALICE, claim, Office.DENIAL, null);
        assertEquals(409, refused.getStatusCode());
        assertTrue(refused.getMessage(), refused.getMessage().contains("does not pass the add-on's checks"));
        events.setListenerEnabledFlag("letterGuard", false);
        try {
            Office.asAdministrator(repository, s -> {
                DocumentModel doc = s.getDocument(new IdRef(template));
                doc.setPropertyValue("file:content", (Serializable) Office.html("x.html", "<p>{{tclaim:number}}</p>"));
                doc.setPropertyValue("tmpl:templateType", "Identity");
                return s.saveDocument(doc);
            });
        } finally {
            events.setListenerEnabledFlag("letterGuard", true);
        }
        assertEquals(409, Office.refusedGenerate(repository, Office.ALICE, claim, Office.DENIAL, null).getStatusCode());
        assertEquals(0, Office.letters(repository, claim).size());
    }

    @Test
    public void anAdministratorsChangeIsCheckedAsTheCreationIs() {
        String template = Office.template(repository, "test-denial-en", Office.DENIAL, "en", Office.DENIAL_EN);
        NuxeoException refused = Office.refusedAs(repository, Office.ADMINISTRATOR, s -> {
            DocumentModel doc = s.getDocument(new IdRef(template));
            doc.setPropertyValue("file:content", (Serializable) Office.html("x.html", "<script>x</script>"));
            return s.saveDocument(doc);
        });
        assertEquals(400, refused.getStatusCode());
        String text = Office.text(Office.stored(repository, template));
        assertFalse(text, text.contains("<script>"));
        try {
            Office.generate(repository, Office.ALICE, claim, Office.DENIAL, null);
        } catch (NuxeoException e) {
            fail("the template as it was writes the letter: " + e.getMessage());
        }
    }
}
