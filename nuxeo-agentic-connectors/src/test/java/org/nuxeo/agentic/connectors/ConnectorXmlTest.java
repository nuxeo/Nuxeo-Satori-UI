package org.nuxeo.agentic.connectors;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.jar.Manifest;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.xml.parsers.DocumentBuilderFactory;

import org.junit.jupiter.api.Test;
import org.nuxeo.common.xmap.XMap;
import org.nuxeo.ecm.automation.core.annotations.Operation;

/**
 * The bundle's components, read as the runtime reads them, and the contributions this module
 * documents or ships for its demo, read by the same XMap and held to {@link Connector#of}: an
 * example nobody could register is a wrong example.
 */
class ConnectorXmlTest {

    private static final Pattern EXTENSION = Pattern.compile(
            "<extension target=\"org\\.nuxeo\\.agentic\\.connectors\" point=\"connectors\">.*?</extension>",
            Pattern.DOTALL);

    private static final Pattern CODE = Pattern.compile("<code>(.*?)</code>", Pattern.DOTALL);

    private static List<ConnectorDescriptor> load(String xml) throws Exception {
        XMap xmap = new XMap();
        xmap.register(ConnectorDescriptor.class);
        List<ConnectorDescriptor> loaded = new ArrayList<>();
        for (Object each : xmap.loadAll(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)))) {
            loaded.add((ConnectorDescriptor) each);
        }
        return loaded;
    }

    private static String resource(String name) throws Exception {
        try (InputStream in = ConnectorXmlTest.class.getClassLoader().getResourceAsStream(name)) {
            assertNotNull(in, name + " is not in the bundle");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static List<String> components() throws Exception {
        java.util.Enumeration<java.net.URL> manifests = ConnectorXmlTest.class.getClassLoader()
                                                                             .getResources("META-INF/MANIFEST.MF");
        while (manifests.hasMoreElements()) {
            try (InputStream in = manifests.nextElement().openStream()) {
                java.util.jar.Attributes main = new Manifest(in).getMainAttributes();
                String name = main.getValue("Bundle-SymbolicName");
                if (name != null && name.startsWith("org.nuxeo.agentic.connectors;")) {
                    return Arrays.stream(main.getValue("Nuxeo-Component").split(","))
                                 .map(String::trim)
                                 .filter(c -> !c.isEmpty())
                                 .toList();
                }
            }
        }
        throw new AssertionError("no manifest of org.nuxeo.agentic.connectors on the classpath");
    }

    @Test
    void everyComponentTheManifestNamesIsWellFormedXml() throws Exception {
        List<String> components = components();
        assertEquals(List.of("OSGI-INF/connectors-service.xml", "OSGI-INF/connectors-operations-contrib.xml"),
                components);
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        for (String component : components) {
            byte[] xml = resource(component).getBytes(StandardCharsets.UTF_8);
            assertDoesNotThrow(() -> factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml)), component);
        }
    }

    @Test
    void theServiceDeclaresTheExtensionPointAndTheOperationIsContributed() throws Exception {
        String service = resource("OSGI-INF/connectors-service.xml");
        assertTrue(service.contains("<component name=\"org.nuxeo.agentic.connectors\""));
        assertTrue(service.contains("<implementation class=\"" + ConnectorComponent.class.getName() + "\" />"));
        assertTrue(service.contains("<provide interface=\"" + ConnectorService.class.getName() + "\" />"));
        assertTrue(service.contains("<extension-point name=\"" + ConnectorComponent.XP_CONNECTORS + "\">"));
        assertTrue(service.contains("<object class=\"" + ConnectorDescriptor.class.getName() + "\" />"));

        String operations = resource("OSGI-INF/connectors-operations-contrib.xml");
        assertTrue(operations.contains("<operation class=\"" + ReadConnectorOperation.class.getName() + "\" />"));
        assertEquals("Connector.Read", ReadConnectorOperation.class.getAnnotation(Operation.class).id());
    }

    @Test
    void theServicesDocumentedExampleIsAConnectorTheServerRegisters() throws Exception {
        Matcher code = CODE.matcher(resource("OSGI-INF/connectors-service.xml"));
        assertTrue(code.find());
        List<ConnectorDescriptor> loaded = load(
                "<extension target=\"org.nuxeo.agentic.connectors\" point=\"connectors\">" + code.group(1)
                        + "</extension>");
        assertEquals(1, loaded.size());
        Connector connector = Connector.of(loaded.get(0));
        assertEquals("payers.claimPayments", connector.id());
        assertEquals("Bearer ", connector.credential().prefix());
        assertEquals("/payment/amount", connector.fields().get(1).pointer().toString());
    }

    @Test
    void theDemoContributionIsAConnectorTheServerRegisters() throws Exception {
        Path demo = Path.of("demo", "payers-claim-payments-config.xml");
        String xml = Files.readString(demo);
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        assertDoesNotThrow(() -> factory.newDocumentBuilder().parse(demo.toFile()));
        assertTrue(xml.contains("<require>org.nuxeo.agentic.connectors</require>"));

        Matcher extension = EXTENSION.matcher(xml);
        assertTrue(extension.find(), "no contribution to org.nuxeo.agentic.connectors in " + demo);
        List<ConnectorDescriptor> loaded = load(extension.group());
        assertEquals(1, loaded.size());
        Connector connector = Connector.of(loaded.get(0));
        assertEquals("payers.claimPayments", connector.id());
        assertEquals("claim:number", connector.keyXpath());
        // XMap trims what it reads unless told not to: "Bearer" with no space is a header the system refuses.
        assertEquals("Bearer ", connector.credential().prefix());
        assertFalse(xml.contains("http://") || xml.contains("https://"),
                "the demo contribution names its address by a server property, never writes it");
    }

    /**
     * What the demo tells the validator its server registers, and the fields its layout names, are
     * the demo connector's: a field added to one and not the others is a demo that refuses itself.
     */
    @Test
    void theDemosRegisteredFileAndLayoutNameTheDemoConnectorsFields() throws Exception {
        Matcher extension = EXTENSION.matcher(Files.readString(Path.of("demo", "payers-claim-payments-config.xml")));
        assertTrue(extension.find());
        Connector connector = Connector.of(load(extension.group()).get(0));
        List<String> allowed = connector.fields().stream().map(Connector.Field::name).toList();

        com.fasterxml.jackson.databind.JsonNode registered = ConnectorAnswer.JSON.readTree(
                Files.readString(Path.of("demo", "registered.json")));
        List<String> listed = new ArrayList<>();
        registered.at("/connectors/" + connector.id()).forEach(name -> listed.add(name.asText()));
        assertEquals(allowed, listed);

        com.fasterxml.jackson.databind.JsonNode layout = ConnectorAnswer.JSON.readTree(
                Files.readString(Path.of("demo", "Claim.view.layout.json")));
        List<String> shown = new ArrayList<>();
        for (com.fasterxml.jackson.databind.JsonNode card : layout.get("cards")) {
            if (card.has("external")) {
                assertEquals(connector.id(), card.at("/external/connector").asText());
                card.at("/external/fields").forEach(field -> shown.add(field.path("name").asText(field.asText())));
            }
        }
        assertEquals(allowed, shown);
    }
}
