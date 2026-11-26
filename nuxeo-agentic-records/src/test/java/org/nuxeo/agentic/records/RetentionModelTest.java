package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;

import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * What the add-on reads of the platform's retention module, held to the module's own files, as its
 * published jar for LTS 2025 holds them (unpacked by the pom into nuxeo-retention/). Should a
 * version of the module rename what the add-on reads, this fails before a server does.
 */
public class RetentionModelTest {

    private static Document xml(String resource) throws Exception {
        try (InputStream in = RetentionModelTest.class.getClassLoader().getResourceAsStream(resource)) {
            assertNotNull(resource + " is on the test classpath", in);
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setExpandEntityReferences(false);
            factory.setNamespaceAware(true);
            return factory.newDocumentBuilder().parse(in);
        }
    }

    private static String text(String resource) throws IOException {
        try (InputStream in = RetentionModelTest.class.getClassLoader().getResourceAsStream(resource)) {
            assertNotNull(resource + " is on the test classpath", in);
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    /** The top-level element names an XSD declares. */
    private static Set<String> elements(String xsd) throws Exception {
        Set<String> names = new TreeSet<>();
        NodeList all = xml(xsd).getDocumentElement().getChildNodes();
        for (int index = 0; index < all.getLength(); index++) {
            if (all.item(index) instanceof Element element && "element".equals(element.getLocalName())) {
                names.add(element.getAttribute("name"));
            }
        }
        return names;
    }

    /** Each facet's schemas, and each schema's prefix, in a types component. */
    private static Map<String, List<String>> facets(Document component) {
        Map<String, List<String>> facets = new LinkedHashMap<>();
        NodeList all = component.getElementsByTagName("facet");
        for (int index = 0; index < all.getLength(); index++) {
            Element facet = (Element) all.item(index);
            NodeList schemas = facet.getElementsByTagName("schema");
            if (schemas.getLength() == 0) {
                continue;
            }
            List<String> names = new ArrayList<>();
            for (int at = 0; at < schemas.getLength(); at++) {
                names.add(((Element) schemas.item(at)).getAttribute("name"));
            }
            facets.put(facet.getAttribute("name"), names);
        }
        return facets;
    }

    private static Map<String, String> prefixes(Document component) {
        Map<String, String> prefixes = new LinkedHashMap<>();
        NodeList all = component.getElementsByTagName("schema");
        for (int index = 0; index < all.getLength(); index++) {
            Element schema = (Element) all.item(index);
            if (schema.hasAttribute("prefix")) {
                prefixes.put(schema.getAttribute("name"), schema.getAttribute("prefix"));
            }
        }
        return prefixes;
    }

    @Test
    public void theModuleRecordsWhatTheAddOnReads() throws Exception {
        Set<String> record = elements("nuxeo-retention/schemas/record.xsd");
        assertTrue(record.toString(), record.contains("ruleIds"));
        assertTrue(record.toString(), record.contains("retainUntil"));
        assertTrue(elements("nuxeo-retention/schemas/retention_definition.xsd").contains("endActions"));

        Document module = xml("nuxeo-retention/OSGI-INF/retention-core-types.xml");
        assertEquals("org.nuxeo.retention.types", module.getDocumentElement().getAttribute("name"));
        Map<String, List<String>> facets = facets(module);
        assertEquals(List.of("record"), facets.get(Disposition.RECORD_FACET));
        assertEquals(List.of("retention_rule", "retention_definition"), facets.get(Disposition.RULE_FACET));
        Map<String, String> prefixes = prefixes(module);
        assertEquals("record", prefixes.get("record"));
        assertEquals("retention_def", prefixes.get("retention_definition"));
        assertTrue(Disposition.RECORD_RULE_IDS.equals(prefixes.get("record") + ":ruleIds"));
        assertTrue(Disposition.RECORD_RETAIN_UNTIL.equals(prefixes.get("record") + ":retainUntil"));
        assertTrue(Disposition.RULE_END_ACTIONS.equals(prefixes.get("retention_definition") + ":endActions"));
    }

    @Test
    public void theTestsRegisterTheModulesFacetsAsTheModuleDoes() throws Exception {
        Document module = xml("nuxeo-retention/OSGI-INF/retention-core-types.xml");
        Document tests = xml("OSGI-INF/test-retention-types.xml");
        assertEquals(module.getDocumentElement().getAttribute("name"), tests.getDocumentElement().getAttribute("name"));
        Map<String, List<String>> moduleFacets = facets(module);
        Map<String, List<String>> testFacets = facets(tests);
        assertEquals(moduleFacets.get(Disposition.RECORD_FACET), testFacets.get(Disposition.RECORD_FACET));
        assertEquals(moduleFacets.get(Disposition.RULE_FACET), testFacets.get(Disposition.RULE_FACET));
        Map<String, String> modulePrefixes = prefixes(module);
        prefixes(tests).forEach((schema, prefix) -> assertEquals(schema, modulePrefixes.get(schema), prefix));
    }

    @Test
    public void aRulesEndActionsAreDeleteOrTrash() throws Exception {
        // A rule with either disposes of its records itself when their retention ends, with no review.
        String csv = text("nuxeo-retention/directories/retention_end.csv");
        assertTrue(csv, csv.contains("Document.Delete,"));
        assertTrue(csv, csv.contains("Document.Trash,"));
    }

    @Test
    public void theAddOnsTypesWaitForTheModules() throws Exception {
        NodeList requires = xml("OSGI-INF/records-types.xml").getElementsByTagName("require");
        List<String> names = new ArrayList<>();
        for (int index = 0; index < requires.getLength(); index++) {
            names.add(requires.item(index).getTextContent().trim());
        }
        assertTrue(names.toString(), names.contains("org.nuxeo.retention.types"));
    }
}
