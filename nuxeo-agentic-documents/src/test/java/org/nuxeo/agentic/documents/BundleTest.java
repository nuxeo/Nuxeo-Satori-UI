/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

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
import org.nuxeo.ecm.core.schema.SchemaManager;
import org.nuxeo.ecm.core.schema.types.CompositeType;
import org.nuxeo.ecm.core.schema.types.Schema;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * The bundle as the runtime loads it: its manifest's components, the services and the facet they
 * register, and the package's version.
 */
@RunWith(FeaturesRunner.class)
@Features(ControlledDocumentsFeature.class)
public class BundleTest {

    private static final String SYMBOLIC_NAME = "org.nuxeo.agentic.documents";

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
    public void theManifestNamesTheSixComponents() throws Exception {
        List<String> components = Arrays.stream(manifest().getValue("Nuxeo-Component").split(","))
                                        .map(String::trim)
                                        .filter(c -> !c.isEmpty())
                                        .toList();
        assertEquals(List.of("OSGI-INF/documents-schema-contrib.xml", "OSGI-INF/documents-service.xml",
                "OSGI-INF/documents-listener-contrib.xml", "OSGI-INF/documents-transmittals-contrib.xml",
                "OSGI-INF/documents-reviews-contrib.xml", "OSGI-INF/documents-export-marks-contrib.xml"), components);
    }

    /** Each facet of the add-on, with its schema, its prefix and every property the add-on names. */
    @Test
    public void theRuntimeRegistersEveryFacetWithItsSchema() {
        record Expected(String facet, String schema, String prefix, List<String> properties) {
        }
        for (Expected expected : List.of(
                new Expected(ControlledDocuments.FACET, ControlledDocuments.REVIEW_SCHEMA,
                        ControlledDocuments.REVIEW_PREFIX, List.of(ControlledDocuments.REVIEW_CYCLES)),
                new Expected(ControlledDocuments.FACET, ControlledDocuments.MARK_SCHEMA,
                        ControlledDocuments.MARK_PREFIX, ControlledDocuments.MARK_PROPERTIES),
                new Expected(ControlledDocuments.TRANSMITTAL_FACET, ControlledDocuments.TRANSMITTAL_SCHEMA,
                        ControlledDocuments.TRANSMITTAL_PREFIX, ControlledDocuments.TRANSMITTAL_PROPERTIES),
                new Expected(ControlledDocuments.RECEIPT_FACET, ControlledDocuments.RECEIPT_SCHEMA,
                        ControlledDocuments.RECEIPT_PREFIX, ControlledDocuments.RECEIPT_PROPERTIES),
                new Expected(ControlledDocuments.CYCLE_FACET, ControlledDocuments.CYCLE_SCHEMA,
                        ControlledDocuments.CYCLE_PREFIX, ControlledDocuments.CYCLE_PROPERTIES),
                new Expected(ControlledDocuments.COMMENT_FACET, ControlledDocuments.COMMENT_SCHEMA,
                        ControlledDocuments.COMMENT_PREFIX, ControlledDocuments.COMMENT_PROPERTIES))) {
            CompositeType facet = schemas.getFacet(expected.facet());
            assertNotNull(expected.facet(), facet);
            assertTrue(expected.facet(), facet.hasSchema(expected.schema()));
            Schema schema = schemas.getSchema(expected.schema());
            assertEquals(expected.prefix(), schema.getNamespace().prefix);
            for (String property : expected.properties()) {
                assertNotNull(property, schema.getField(property.substring(expected.prefix().length() + 1)));
            }
            assertEquals(expected.schema(), expected.properties().size(), schema.getFieldsCount());
        }
        assertEquals(List.of("TR"), Framework.getService(ControlledDocumentService.class)
                                             .transmittalSeries()
                                             .stream()
                                             .map(NumberSeries::id)
                                             .toList());
    }

    /** The runtime started what the components declare: the service, the facet and its schema. */
    @Test
    public void theRuntimeRegistersTheServiceTheFacetAndTheSchema() {
        assertNotNull(Framework.getService(ControlledDocumentService.class));
        assertNotNull(Framework.getService(ControlledDocumentService.class).series("DWG"));
        CompositeType facet = schemas.getFacet(ControlledDocuments.FACET);
        assertNotNull(facet);
        assertTrue(facet.hasSchema(ControlledDocuments.SCHEMA));
        Schema schema = schemas.getSchema(ControlledDocuments.SCHEMA);
        assertEquals(ControlledDocuments.PREFIX, schema.getNamespace().prefix);
        for (String property : ControlledDocuments.PROPERTIES) {
            assertNotNull(property, schema.getField(property.substring(ControlledDocuments.PREFIX.length() + 1)));
        }
        assertEquals(ControlledDocuments.PROPERTIES.size(), schema.getFieldsCount());
    }

    /** package.xml's version is the module's property, and the manifest's Bundle-Version repeats it. */
    @Test
    public void thePackageVersionIsTheManifestsBundleVersion() throws Exception {
        String version = System.getProperty("documents.package.version");
        assertNotNull("surefire passes documents.package.version from the pom", version);
        assertFalse(version.isBlank());
        assertEquals(version, manifest().getValue("Bundle-Version"));
        String packageXml = Files.readString(Path.of("src", "main", "package", "package.xml"));
        assertTrue(packageXml, packageXml.contains(
                "name=\"nuxeo-agentic-documents\" version=\"@documents.package.version@\""));
    }
}
