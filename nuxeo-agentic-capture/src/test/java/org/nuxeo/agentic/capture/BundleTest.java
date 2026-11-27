/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
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
import org.nuxeo.agentic.capture.ai.AiPackageProvider;
import org.nuxeo.agentic.capture.standin.StandInProvider;
import org.nuxeo.ecm.core.schema.SchemaManager;
import org.nuxeo.ecm.core.schema.types.CompositeType;
import org.nuxeo.ecm.core.schema.types.Schema;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * The bundle as the runtime loads it: its manifest's components, its facet and schema with every
 * property the add-on names, both providers registered and only the stand-in usable unless the
 * server turns the AI one on, the test profiles registered, no Automation operation, and the
 * package's version.
 */
@RunWith(FeaturesRunner.class)
@Features(CaptureFeature.class)
public class BundleTest {

    private static final String SYMBOLIC_NAME = "org.nuxeo.agentic.capture";

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
        assertEquals(List.of("OSGI-INF/capture-schema-contrib.xml", "OSGI-INF/capture-service.xml",
                "OSGI-INF/capture-providers-contrib.xml", "OSGI-INF/capture-listener-contrib.xml"), components);
    }

    @Test
    public void theRuntimeRegistersTheFacetWithEveryPropertyTheAddOnNames() {
        CompositeType facet = schemas.getFacet(Captures.FACET);
        assertNotNull(facet);
        assertTrue(facet.hasSchema(Captures.SCHEMA));
        Schema schema = schemas.getSchema(Captures.SCHEMA);
        assertEquals(Captures.PREFIX, schema.getNamespace().prefix);
        for (String property : Captures.PROPERTIES) {
            assertNotNull(property, schema.getField(property.substring(Captures.PREFIX.length() + 1)));
        }
        assertEquals(Captures.PROPERTIES.size(), schema.getFieldsCount());
    }

    @Test
    public void bothProvidersAreRegisteredAndTheAiOneIsUnusedUntilTheServerTurnsItOn() {
        CaptureService service = Framework.getService(CaptureService.class);
        assertTrue(service.provider("standin") instanceof StandInProvider);
        assertTrue(service.provider("ai") instanceof AiPackageProvider);
        assertNull(service.provider("another"));
        Mailroom.settings(null, null);
        assertNull(service.activeProviderId());
        Mailroom.settings("ai", null);
        assertFalse(service.provider("ai").configured());
        assertNull(service.activeProviderId());
        Mailroom.settings("ai", "true");
        assertTrue(service.provider("ai").configured());
        assertEquals("ai", service.activeProviderId());
        Mailroom.settings("standin", null);
        assertEquals("standin", service.activeProviderId());
        Mailroom.settings(null, null);
    }

    @Test
    public void theTestProfilesAreRegisteredAndFoundByTheirTypes() {
        CaptureService service = Framework.getService(CaptureService.class);
        Profile profile = service.profileFor("TestInbox", "TestMail");
        assertEquals("test-mail", profile.id());
        assertEquals(0.85, profile.threshold(), 0);
        assertEquals("test-notes", service.profileFor("TestNoteInbox", "TestMail").id());
        assertNull(service.profileFor("Folder", "TestMail"));
        assertTrue(service.isItemType("TestMail"));
        assertFalse(service.isItemType("TestClaim"));
    }

    /** No button reaches the add-on but through the platform's document creation and update: it has no operation. */
    @Test
    public void theAddOnRegistersNoAutomationOperation() throws Exception {
        try (var components = Files.list(Path.of("src", "main", "resources", "OSGI-INF"))) {
            for (Path component : components.toList()) {
                String xml = Files.readString(component);
                assertFalse(component.toString(), xml.contains("OperationServiceComponent"));
            }
        }
        try (var classes = Files.walk(Path.of("src", "main", "java"))) {
            for (Path source : classes.filter(p -> p.toString().endsWith(".java")).toList()) {
                assertFalse(source.toString(), Files.readString(source).contains("@Operation("));
            }
        }
    }

    @Test
    public void thePackageVersionIsTheManifestsBundleVersion() throws Exception {
        String version = System.getProperty("capture.package.version");
        assertNotNull("surefire passes capture.package.version from the pom", version);
        assertEquals(version, manifest().getValue("Bundle-Version"));
    }
}
