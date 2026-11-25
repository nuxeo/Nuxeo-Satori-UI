package org.nuxeo.agentic.assets.rights;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.List;
import java.util.jar.Attributes;
import java.util.jar.Manifest;

import javax.xml.parsers.DocumentBuilderFactory;

import org.junit.jupiter.api.Test;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * The bundle as the runtime loads it: every component its manifest names is in it and is XML the
 * runtime can read, its classes are the ones the components name, and the package's version is
 * the manifest's.
 */
class BundleTest {

    private static final String SYMBOLIC_NAME = "org.nuxeo.agentic.assets";

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

    private static List<String> components() throws Exception {
        String header = manifest().getValue("Nuxeo-Component");
        assertNotNull(header, "Nuxeo-Component");
        return Arrays.stream(header.split(",")).map(String::trim).filter(c -> !c.isEmpty()).toList();
    }

    private static org.w3c.dom.Document parse(byte[] xml) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        return factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml));
    }

    private static byte[] resource(String path) throws Exception {
        try (InputStream in = BundleTest.class.getClassLoader().getResourceAsStream(path)) {
            assertNotNull(in, path + " is not in the bundle");
            return in.readAllBytes();
        }
    }

    @Test
    void everyComponentTheManifestNamesIsInTheBundleAndWellFormed() throws Exception {
        List<String> components = components();
        assertEquals(List.of("OSGI-INF/asset-rights-service.xml", "OSGI-INF/asset-rights-download-permission.xml",
                "OSGI-INF/asset-rights-enricher-contrib.xml"), components);
        for (String component : components) {
            byte[] xml = resource(component);
            assertDoesNotThrow(() -> parse(xml),
                    () -> component + " is not well-formed XML:\n" + new String(xml, StandardCharsets.UTF_8));
        }
    }

    /** Every class a component names loads: an implementation, a service, a descriptor, a marshaller. */
    @Test
    void everyClassTheComponentsNameLoads() throws Exception {
        List<String> classes = new ArrayList<>();
        for (String component : components()) {
            org.w3c.dom.Document xml = parse(resource(component));
            collect(xml.getElementsByTagName("implementation"), "class", classes);
            collect(xml.getElementsByTagName("provide"), "interface", classes);
            collect(xml.getElementsByTagName("object"), "class", classes);
            collect(xml.getElementsByTagName("register"), "class", classes);
        }
        assertEquals(4, classes.size(), classes::toString);
        for (String name : classes) {
            assertDoesNotThrow(() -> Class.forName(name), name);
        }
        String script = parse(resource("OSGI-INF/asset-rights-download-permission.xml")).getElementsByTagName("script")
                                                                                       .item(0)
                                                                                       .getTextContent();
        assertTrue(script.contains("\"" + AssetRightsDownloadPermission.class.getName() + "\""), script);
    }

    private static void collect(NodeList elements, String attribute, List<String> into) {
        for (int i = 0; i < elements.getLength(); i++) {
            String value = ((Element) elements.item(i)).getAttribute(attribute);
            if (!value.isEmpty()) {
                into.add(value);
            }
        }
    }

    /** The component that contributes policies is the one the kit requires, and the point is the one it names. */
    @Test
    void theServiceComponentHasTheNameAndPointPackagesContributeTo() throws Exception {
        org.w3c.dom.Document xml = parse(resource("OSGI-INF/asset-rights-service.xml"));
        assertEquals("org.nuxeo.agentic.assets.rights", xml.getDocumentElement().getAttribute("name"));
        NodeList points = xml.getElementsByTagName("extension-point");
        assertEquals(1, points.getLength());
        assertEquals(AssetRightsComponent.XP_POLICIES, ((Element) points.item(0)).getAttribute("name"));
    }

    /** package.xml's version is the module's property, and the manifest's Bundle-Version repeats it. */
    @Test
    void thePackageVersionIsTheManifestsBundleVersion() throws Exception {
        String version = System.getProperty("assets.package.version");
        assertNotNull(version, "surefire passes assets.package.version from the pom");
        assertFalse(version.isBlank());
        assertEquals(version, manifest().getValue("Bundle-Version"));
        String packageXml = Files.readString(Path.of("src", "main", "package", "package.xml"));
        assertTrue(packageXml.contains("name=\"nuxeo-agentic-assets\" version=\"@assets.package.version@\""),
                packageXml);
    }
}
