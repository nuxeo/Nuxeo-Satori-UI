/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

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
import java.util.Map;
import java.util.jar.Attributes;
import java.util.jar.Manifest;

import javax.inject.Inject;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.agentic.signature.standin.StandInProvider;
import org.nuxeo.ecm.core.schema.SchemaManager;
import org.nuxeo.ecm.core.schema.types.CompositeType;
import org.nuxeo.ecm.core.schema.types.Schema;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * The bundle as the runtime loads it: its manifest's components, its facets and schemas with every
 * property the add-on names, the stand-in provider registered and inert until configured, no
 * Automation operation, and the package's version.
 */
@RunWith(FeaturesRunner.class)
@Features(SignatureFeature.class)
public class BundleTest {

    private static final String SYMBOLIC_NAME = "org.nuxeo.agentic.signature";

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
        assertEquals(List.of("OSGI-INF/signature-schema-contrib.xml", "OSGI-INF/signature-service.xml",
                "OSGI-INF/signature-standin-contrib.xml", "OSGI-INF/signature-listener-contrib.xml"), components);
        // The servlet's mapping is a deployment fragment, read when the server is set up, not a component.
        assertTrue(Files.exists(Path.of("src", "main", "resources", "OSGI-INF", "deployment-fragment.xml")));
    }

    @Test
    public void theRuntimeRegistersBothFacetsWithTheirSchemas() {
        record Expected(String facet, String schema, String prefix, List<String> properties) {
        }
        for (Expected expected : List.of(
                new Expected(Signatures.REQUEST_FACET, Signatures.REQUEST_SCHEMA, Signatures.REQUEST_PREFIX,
                        Signatures.REQUEST_PROPERTIES),
                new Expected(Signatures.SIGNABLE_FACET, Signatures.SIGNABLE_SCHEMA, Signatures.SIGNABLE_PREFIX,
                        Signatures.SIGNABLE_PROPERTIES))) {
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
    }

    @Test
    public void theStandInIsRegisteredAndSendsNothingUntilTheServerConfiguresIt() {
        Desk.use(Map.of());
        SignatureService service = Framework.getService(SignatureService.class);
        SignatureProvider standIn = service.provider("standin");
        assertTrue(standIn instanceof StandInProvider);
        assertFalse(standIn.configured());
        assertNull(service.activeProviderId());
        assertNull(service.provider("another"));
        Desk.use(Map.of(SignatureSettings.PROVIDER_PROPERTY, "another"));
        assertNull(service.activeProviderId());
        Desk.use(Map.of(SignatureSettings.PROVIDER_PROPERTY, "standin"));
        assertEquals("standin", service.activeProviderId());
        assertFalse(service.provider("standin").configured());
    }

    /** No button reaches the step but through the platform's document creation: the add-on has no operation. */
    @Test
    public void theAddOnRegistersNoAutomationOperation() throws Exception {
        try (var components = Files.list(Path.of("src", "main", "resources", "OSGI-INF"))) {
            for (Path component : components.toList()) {
                String xml = Files.readString(component);
                assertFalse(component.toString(), xml.contains("OperationServiceComponent"));
                assertFalse(component.toString(), xml.contains("org.nuxeo.agentic.ui.operations"));
            }
        }
        try (var classes = Files.walk(Path.of("src", "main", "java"))) {
            for (Path source : classes.filter(p -> p.toString().endsWith(".java")).toList()) {
                assertFalse(source.toString(), Files.readString(source).contains("@Operation("));
            }
        }
    }

    @Test
    public void theCallbackWindowIsFiveMinutesUnlessTheServerSetsOneItAllows() {
        SignatureService service = Framework.getService(SignatureService.class);
        Desk.use(Map.of());
        assertEquals(300, service.callbackWindow().toSeconds());
        Desk.use(Map.of("nuxeo.agentic.signature.callback.window", "60"));
        assertEquals(60, service.callbackWindow().toSeconds());
        Desk.use(Map.of("nuxeo.agentic.signature.callback.window", "86400"));
        assertEquals(300, service.callbackWindow().toSeconds());
        Desk.use(Map.of("nuxeo.agentic.signature.callback.window", "soon"));
        assertEquals(300, service.callbackWindow().toSeconds());
    }

    @Test
    public void thePackageVersionIsTheManifestsBundleVersion() throws Exception {
        String version = System.getProperty("signature.package.version");
        assertNotNull("surefire passes signature.package.version from the pom", version);
        assertFalse(version.isBlank());
        assertEquals(version, manifest().getValue("Bundle-Version"));
        String packageXml = Files.readString(Path.of("src", "main", "package", "package.xml"));
        assertTrue(packageXml, packageXml.contains(
                "name=\"nuxeo-agentic-signature\" version=\"@signature.package.version@\""));
    }
}
