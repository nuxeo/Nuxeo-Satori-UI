package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.jar.Manifest;

import javax.xml.parsers.DocumentBuilderFactory;

import org.junit.jupiter.api.Test;

/**
 * Every component the bundle's manifest names is XML the runtime can read.
 *
 * A component's {@code <documentation>} is parsed as markup, not text, so an address written in it
 * as {@code apps/<id>/<path>} is two unclosed elements, and Nuxeo's strict mode then aborts the
 * whole server's start. That happened once, on the local server, with every other check green: no
 * test here had read the service XML whole. This one reads each component with a plain XML
 * parser, as the runtime does before anything else.
 */
class BundleXmlTest {

    /** The components of this bundle's manifest: the one whose symbolic name is ours, among the classpath's. */
    private static List<String> components() throws Exception {
        java.util.Enumeration<java.net.URL> manifests = BundleXmlTest.class.getClassLoader()
                                                                        .getResources("META-INF/MANIFEST.MF");
        while (manifests.hasMoreElements()) {
            try (InputStream in = manifests.nextElement().openStream()) {
                java.util.jar.Attributes main = new Manifest(in).getMainAttributes();
                String name = main.getValue("Bundle-SymbolicName");
                if (name != null && name.startsWith(Provenance.PACKAGED_BUNDLE + ";")) {
                    String header = main.getValue("Nuxeo-Component");
                    assertNotNull(header, "Nuxeo-Component");
                    return Arrays.stream(header.split(",")).map(String::trim).filter(c -> !c.isEmpty()).toList();
                }
            }
        }
        throw new AssertionError("no manifest of " + Provenance.PACKAGED_BUNDLE + " on the classpath");
    }

    @Test
    void everyComponentTheManifestNamesIsWellFormedXml() throws Exception {
        List<String> components = components();
        assertFalse(components.isEmpty());
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        for (String component : components) {
            try (InputStream in = getClass().getClassLoader().getResourceAsStream(component)) {
                assertNotNull(in, component + " is not in the bundle");
                byte[] xml = in.readAllBytes();
                assertDoesNotThrow(() -> factory.newDocumentBuilder().parse(new java.io.ByteArrayInputStream(xml)),
                        () -> component + " is not well-formed XML:\n" + new String(xml, StandardCharsets.UTF_8));
            }
        }
    }

    @Test
    void theDeploymentFragmentIsWellFormedXml() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        try (InputStream in = getClass().getClassLoader().getResourceAsStream("OSGI-INF/deployment-fragment.xml")) {
            assertNotNull(in);
            assertDoesNotThrow(() -> factory.newDocumentBuilder().parse(in));
        }
    }
}
