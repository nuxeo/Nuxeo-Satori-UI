/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Enumeration;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.inject.Inject;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.template.adapters.source.TemplateSourceDocumentAdapterImpl;

/**
 * Every name the add-on reads or writes of the platform's Template Rendering, held to the platform's
 * own files, in its own jar: its types, facets and schemas, the components the add-on requires, the
 * listener it must run before, and the property names its adapter reads. A version of the platform
 * that renames one fails the build. And the platform's listener runs on a letter template as on any
 * of its templates.
 */
@RunWith(FeaturesRunner.class)
@Features(LettersFeature.class)
public class TemplateRenderingModelTest {

    @Inject
    protected CoreSession session;

    /** A file of the platform's Template Rendering jar, never the add-on's own. */
    private static String platformFile(String name) throws Exception {
        Enumeration<URL> found = TemplateRenderingModelTest.class.getClassLoader().getResources(name);
        while (found.hasMoreElements()) {
            URL url = found.nextElement();
            if (url.toString().contains("nuxeo-template-rendering-core")) {
                try (InputStream in = url.openStream()) {
                    return new String(in.readAllBytes(), StandardCharsets.UTF_8);
                }
            }
        }
        throw new AssertionError(name + " is not in the platform's Template Rendering jar");
    }

    @Test
    public void theTypesFacetsAndSchemasAreThePlatforms() throws Exception {
        String types = platformFile("OSGI-INF/core-types-contrib.xml");
        assertTrue(types.contains("<component name=\"org.nuxeo.platform.TemplateSources.doctypes\">"));
        assertTrue(types.contains("<schema name=\"documenttemplate\" src=\"schemas/documenttemplate.xsd\""));
        assertTrue(types.contains("prefix=\"tmpl\""));
        assertTrue(types.contains("<schema name=\"templatesupport\" src=\"schemas/templatesupport.xsd\""));
        assertTrue(types.contains("prefix=\"nxts\""));
        assertTrue(types.contains("<facet name=\"Template\" />"));
        assertTrue(Pattern.compile("<facet name=\"TemplateBased\">\\s*<schema name=\"templatesupport\" />")
                          .matcher(types).find());
        assertTrue(Pattern.compile("<doctype name=\"TemplateSource\" extends=\"Document\">[\\s\\S]*?<schema name=\"file\"/>"
                + "[\\s\\S]*?<schema name=\"documenttemplate\" />[\\s\\S]*?<facet name=\"Template\" />")
                          .matcher(types).find());
        String template = platformFile("schemas/documenttemplate.xsd");
        for (String property : Letters.PLATFORM_PROPERTIES) {
            if (property.startsWith("tmpl:")) {
                assertTrue(property, template.contains("<xs:element name=\"" + property.substring(5) + "\""));
            }
        }
        String support = platformFile("schemas/templatesupport.xsd");
        assertTrue(support.contains("<xs:element name=\"bindings\""));
        assertTrue(support.contains("<xs:element name=\"templateId\""));
    }

    @Test
    public void theComponentsTheAddOnRequiresAndTheListenerItRunsBefore() throws Exception {
        String listeners = platformFile("OSGI-INF/listener-contrib.xml");
        assertTrue(listeners.contains("<component name=\"org.nuxeo.platform.TemplateSources.listener\">"));
        Matcher init = Pattern.compile("<listener name=\"documenttemplate-init\"[^>]*priority=\"(\\d+)\"")
                              .matcher(listeners);
        assertTrue(init.find());
        assertTrue("the add-on's guard, at 50, runs before the platform's listener",
                Integer.parseInt(init.group(1)) > 50);
        String service = platformFile("OSGI-INF/templateprocessor-service.xml");
        assertTrue(service.contains("<component name=\"org.nuxeo.template.service.TemplateProcessorComponent\">"));
        assertTrue(service.contains("<extension-point name=\"processor\">"));
        assertTrue(service.contains("<provide interface=\"org.nuxeo.template.api.TemplateProcessorService\" />"));
    }

    @Test
    public void theNamesThePlatformsAdapterReads() {
        assertEquals(Letters.TMPL_NAME, TemplateSourceDocumentAdapterImpl.TEMPLATE_NAME_PROP);
        assertEquals(Letters.TMPL_TYPE, TemplateSourceDocumentAdapterImpl.TEMPLATE_TYPE_PROP);
        assertEquals(Letters.PLATFORM_AUTO, TemplateSourceDocumentAdapterImpl.TEMPLATE_TYPE_AUTO);
        assertEquals(Letters.TMPL_APPLICABLE_TYPES, TemplateSourceDocumentAdapterImpl.TEMPLATE_APPLICABLE_TYPES_PROP);
        assertEquals(Letters.PLATFORM_ALL, TemplateSourceDocumentAdapterImpl.TEMPLATE_APPLICABLE_TYPES_ALL);
        assertEquals(Letters.TMPL_FORCED_TYPES, TemplateSourceDocumentAdapterImpl.TEMPLATE_FORCED_TYPES_PROP);
        assertEquals(Letters.PLATFORM_NONE, TemplateSourceDocumentAdapterImpl.TEMPLATE_FORCED_TYPES_NONE);
        assertEquals(Letters.TMPL_OUTPUT_FORMAT, TemplateSourceDocumentAdapterImpl.TEMPLATE_OUTPUT_PROP);
        assertEquals(Letters.TMPL_USE_AS_MAIN_CONTENT, TemplateSourceDocumentAdapterImpl.TEMPLATE_USEASMAIN_PROP);
        assertEquals(Letters.TMPL_TARGET_RENDITION, TemplateSourceDocumentAdapterImpl.TEMPLATE_RENDITION_PROP);
        assertEquals(Letters.PLATFORM_TEMPLATE_FACET, TemplateSourceDocumentAdapterImpl.TEMPLATE_FACET);
    }

    @Test
    public void thePlatformsListenerRunsOnALetterTemplate() {
        Office.create(session);
        String template = Office.template(session.getRepositoryName(), "test-denial-en", Office.DENIAL, "en",
                Office.DENIAL_EN);
        DocumentModel stored = Office.stored(session.getRepositoryName(), template);
        // The platform's own: no forced type is written as none, and the template's parameters, none.
        assertArrayEquals(new Object[] { Letters.PLATFORM_NONE }, (Object[]) stored.getPropertyValue(Letters.TMPL_FORCED_TYPES));
        assertArrayEquals(new Object[] { "TestClaim" }, (Object[]) stored.getPropertyValue(Letters.TMPL_APPLICABLE_TYPES));
        assertEquals(Letters.PROCESSOR, stored.getPropertyValue(Letters.TMPL_TYPE));
        assertEquals(true, stored.getAdapter(org.nuxeo.template.api.adapters.TemplateSourceDocument.class)
                                 .getParams().isEmpty());
    }
}
