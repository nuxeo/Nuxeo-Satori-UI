/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.InputStream;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.List;
import java.util.jar.Attributes;
import java.util.jar.Manifest;

import javax.inject.Inject;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.automation.AutomationService;
import org.nuxeo.ecm.automation.OperationType;
import org.nuxeo.ecm.core.schema.DocumentType;
import org.nuxeo.ecm.core.schema.SchemaManager;
import org.nuxeo.ecm.core.schema.types.CompositeType;
import org.nuxeo.ecm.core.schema.types.Schema;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.template.api.TemplateProcessorService;
import org.nuxeo.template.api.descriptor.TemplateProcessorDescriptor;

/**
 * The bundle as the runtime loads it: its manifest's components; its facets, schemas and types
 * with every property the add-on names; its processor at the platform's template processor service,
 * chosen for no file by itself; its one operation; no contribution to the operation allow-list and no
 * REST binding; and the package's version.
 */
@RunWith(FeaturesRunner.class)
@Features(LettersFeature.class)
public class BundleTest {

    private static final String SYMBOLIC_NAME = "org.nuxeo.agentic.letters";

    @Inject
    protected SchemaManager schemas;

    private static Attributes manifest() throws Exception {
        Enumeration<URL> manifests = BundleTest.class.getClassLoader().getResources("META-INF/MANIFEST.MF");
        while (manifests.hasMoreElements()) {
            try (InputStream in = manifests.nextElement().openStream()) {
                Attributes main = new Manifest(in).getMainAttributes();
                String name = main.getValue("Bundle-SymbolicName");
                if (name != null && name.startsWith(SYMBOLIC_NAME + ";")) {
                    return main;
                }
            }
        }
        throw new AssertionError("no manifest of " + SYMBOLIC_NAME + " on the classpath");
    }

    @Test
    public void theManifestNamesTheFourComponents() throws Exception {
        List<String> components = Arrays.stream(manifest().getValue("Nuxeo-Component").split(","))
                                        .map(String::trim)
                                        .filter(c -> !c.isEmpty())
                                        .toList();
        assertEquals(List.of("OSGI-INF/letters-schema-contrib.xml", "OSGI-INF/letters-processor-contrib.xml",
                "OSGI-INF/letters-operations-contrib.xml", "OSGI-INF/letters-listener-contrib.xml"), components);
    }

    @Test
    public void theRuntimeRegistersTheFacetsSchemasAndTypes() {
        record Expected(String facet, String schema, String prefix, List<String> properties) {
        }
        for (Expected expected : List.of(
                new Expected(Letters.CORRESPONDENCE_FACET, Letters.CORRESPONDENCE_SCHEMA, Letters.CORRESPONDENCE_PREFIX,
                        Letters.CORRESPONDENCE_PROPERTIES),
                new Expected(Letters.TEMPLATE_FACET, Letters.TEMPLATE_SCHEMA, Letters.TEMPLATE_PREFIX,
                        Letters.TEMPLATE_PROPERTIES))) {
            CompositeType facet = schemas.getFacet(expected.facet());
            assertNotNull(expected.facet(), facet);
            assertTrue(expected.facet(), facet.hasSchema(expected.schema()));
            assertSchema(expected.schema(), expected.prefix(), expected.properties());
        }
        assertSchema(Letters.LETTER_SCHEMA, Letters.LETTER_PREFIX, Letters.LETTER_PROPERTIES);

        DocumentType template = schemas.getDocumentType(Letters.TEMPLATE_TYPE);
        assertEquals(Letters.PLATFORM_TEMPLATE_TYPE, template.getSuperType().getName());
        assertTrue(template.hasFacet(Letters.TEMPLATE_FACET));
        assertTrue(template.hasFacet(Letters.PLATFORM_TEMPLATE_FACET));
        assertTrue(template.hasSchema(Letters.PLATFORM_TEMPLATE_SCHEMA));
        assertTrue(template.hasSchema("file"));

        DocumentType letter = schemas.getDocumentType(Letters.LETTER_TYPE);
        assertTrue(letter.hasFacet(Letters.TEMPLATE_BASED_FACET));
        assertTrue(letter.hasSchema(Letters.TEMPLATE_BASED_SCHEMA));
        assertTrue(letter.hasSchema(Letters.LETTER_SCHEMA));
        assertTrue(letter.hasSchema("file"));
        assertFalse(letter.isFolder());
    }

    private void assertSchema(String name, String prefix, List<String> properties) {
        Schema schema = schemas.getSchema(name);
        assertNotNull(name, schema);
        assertEquals(prefix, schema.getNamespace().prefix);
        for (String property : properties) {
            assertNotNull(property, schema.getField(property.substring(prefix.length() + 1)));
        }
        assertEquals(name, properties.size(), schema.getFieldsCount());
    }

    @Test
    public void theProcessorIsRegisteredWithThePlatformAndChosenForNoFileByItself() {
        TemplateProcessorService service = Framework.getService(TemplateProcessorService.class);
        assertTrue(service.getProcessor(Letters.PROCESSOR) instanceof LetterProcessor);
        TemplateProcessorDescriptor descriptor = service.getRegisteredTemplateProcessors()
                                                        .stream()
                                                        .filter(d -> Letters.PROCESSOR.equals(d.getName()))
                                                        .findFirst()
                                                        .orElseThrow();
        assertFalse(descriptor.isDefaultProcessor());
        assertTrue(descriptor.getSupportedMimeTypes().isEmpty());
        assertTrue(descriptor.getSupportedExtensions().isEmpty());
        assertEquals(null, service.findProcessorName(Office.html("letter.html", "<p>{{tclaim:number}}</p>")));
    }

    @Test
    public void theOneOperationIsLetterGenerateAndNothingAllowsItForAButton() throws Exception {
        OperationType operation = Framework.getService(AutomationService.class).getOperation(GenerateLetterOperation.ID);
        assertEquals(GenerateLetterOperation.class, operation.getType());
        try (var components = Files.list(Path.of("src", "main", "resources", "OSGI-INF"))) {
            for (Path component : components.toList()) {
                String xml = Files.readString(component);
                assertFalse(component.toString(), xml.contains("org.nuxeo.agentic.ui.operations"));
                assertFalse(component.toString(), xml.contains("point=\"bindings\""));
                assertFalse(component.toString(), xml.contains("point=\"chains\""));
            }
        }
        try (var classes = Files.walk(Path.of("src", "main", "java"))) {
            long operations = 0;
            for (Path source : classes.filter(p -> p.toString().endsWith(".java")).toList()) {
                if (Files.readString(source).contains("@Operation(")) {
                    operations++;
                }
            }
            assertEquals(1, operations);
        }
    }

    @Test
    public void thePackageVersionIsTheManifestsBundleVersion() throws Exception {
        String version = System.getProperty("letters.package.version");
        assertNotNull("surefire passes letters.package.version from the pom", version);
        assertEquals(version, manifest().getValue("Bundle-Version"));
        String descriptor = Files.readString(Path.of("src", "main", "package", "package.xml"));
        assertTrue(descriptor.contains("name=\"nuxeo-agentic-letters\" version=\"@letters.package.version@\""));
        assertTrue(descriptor.contains("<package>nuxeo-template-rendering:2025.0.0</package>"));
    }
}
