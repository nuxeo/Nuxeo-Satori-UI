package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.jar.Manifest;
import java.util.stream.Stream;

import org.junit.Test;

/** The bundle and its Marketplace package, as they ship. */
public class BundleTest {

    private static Manifest manifest() throws IOException {
        try (InputStream in = Files.newInputStream(Path.of("src/main/resources/META-INF/MANIFEST.MF"))) {
            return new Manifest(in);
        }
    }

    @Test
    public void theBundleVersionIsThePackages() throws IOException {
        String version = System.getProperty("records.package.version");
        assertNotNull("surefire passes the pom's records.package.version", version);
        assertEquals(version, manifest().getMainAttributes().getValue("Bundle-Version"));
        assertEquals("org.nuxeo.agentic.records;singleton:=true",
                manifest().getMainAttributes().getValue("Bundle-SymbolicName"));
    }

    @Test
    public void everyComponentTheManifestNamesIsPackaged() throws IOException {
        String components = manifest().getMainAttributes().getValue("Nuxeo-Component");
        List<String> names = new ArrayList<>();
        for (String name : components.split(",")) {
            names.add(name.trim());
            assertTrue(name, Files.isRegularFile(Path.of("src/main/resources", name.trim())));
        }
        assertEquals(List.of("OSGI-INF/records-types.xml", "OSGI-INF/records-security.xml",
                "OSGI-INF/records-listener.xml", "OSGI-INF/records-audit.xml"), names);
    }

    /** No Automation operation and no endpoint: a person reaches the review by filing a document (decision 3). */
    @Test
    public void theAddOnContributesNoOperationAndNoEndpoint() throws IOException {
        try (Stream<Path> files = Files.walk(Path.of("src/main/resources/OSGI-INF"))) {
            for (Path file : files.filter(Files::isRegularFile).toList()) {
                String xml = Files.readString(file, StandardCharsets.UTF_8);
                assertFalse(file.toString(), xml.contains("OperationServiceComponent"));
                assertFalse(file.toString(), xml.contains("webengine"));
                assertFalse(file.toString(), xml.contains("<servlet"));
            }
        }
    }

    @Test
    public void thePackageDependsOnTheRetentionModule() throws IOException {
        String xml = Files.readString(Path.of("src/main/package/package.xml"), StandardCharsets.UTF_8);
        assertTrue(xml.contains("name=\"nuxeo-agentic-records\""));
        assertTrue(xml.contains("version=\"@records.package.version@\""));
        assertTrue(xml.contains("<package>nuxeo-retention:2025.0.0</package>"));
        assertTrue(xml.contains("<version>[2025.0,2026.0)</version>"));
    }
}
