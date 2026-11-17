package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.io.InputStream;

import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.xpath.XPath;
import javax.xml.xpath.XPathConstants;
import javax.xml.xpath.XPathFactory;

import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/**
 * Checks the shipped deployment fragment's template-marker contract. Live-server validation
 * separately checks that Nuxeo inserts these contributions into its generated web.xml.
 */
class DeploymentFragmentTest {

    private static Document fragment() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        try (InputStream in = DeploymentFragmentTest.class.getClassLoader()
                                                    .getResourceAsStream("OSGI-INF/deployment-fragment.xml")) {
            assertNotNull(in, "The deployment fragment must ship on the bundle's classpath");
            return factory.newDocumentBuilder().parse(in);
        }
    }

    private static Node onlyNode(XPath xpath, Node context, String expression) throws Exception {
        NodeList nodes = (NodeList) xpath.evaluate(expression, context, XPathConstants.NODESET);
        assertEquals(1, nodes.getLength(), expression);
        return nodes.item(0);
    }

    @Test
    void authenticationMappingTargetsTheFilterMappingMarker() throws Exception {
        XPath xpath = XPathFactory.newInstance().newXPath();
        Node mapping = onlyNode(xpath, fragment(), "/fragment/extension/filter-mapping");

        assertEquals("web#FILTER-MAPPING", xpath.evaluate("../@target", mapping),
                "A web.xml file path is not a deployment template marker (NXSAT-681)");
        assertEquals("NuxeoAuthenticationFilter", xpath.evaluate("filter-name", mapping));
        assertEquals("/agentic-ui/*", xpath.evaluate("url-pattern", mapping));
        assertEquals(1, ((NodeList) xpath.evaluate("url-pattern", mapping, XPathConstants.NODESET)).getLength());
        NodeList dispatchers = (NodeList) xpath.evaluate("dispatcher", mapping, XPathConstants.NODESET);
        assertEquals(2, dispatchers.getLength());
        assertEquals("REQUEST", dispatchers.item(0).getTextContent().trim());
        assertEquals("FORWARD", dispatchers.item(1).getTextContent().trim());
    }

    @Test
    void configurationRemainsOnItsSeparateServletMapping() throws Exception {
        XPath xpath = XPathFactory.newInstance().newXPath();
        Document fragment = fragment();
        Node servlet = onlyNode(xpath, fragment, "/fragment/extension/servlet");
        Node mapping = onlyNode(xpath, fragment, "/fragment/extension/servlet-mapping");

        assertEquals("web#SERVLET", xpath.evaluate("../@target", servlet));
        assertEquals("Agentic UI Configuration", xpath.evaluate("servlet-name", servlet));
        assertEquals("org.nuxeo.agentic.config.AgenticUiConfigServlet", xpath.evaluate("servlet-class", servlet));
        assertEquals("web#SERVLET-MAPPING", xpath.evaluate("../@target", mapping));
        assertEquals(xpath.evaluate("servlet-name", servlet), xpath.evaluate("servlet-name", mapping));
        assertEquals("/agentic-ui-config/*", xpath.evaluate("url-pattern", mapping));
        assertEquals(0, ((NodeList) xpath.evaluate(
                "/fragment/extension/filter-mapping[url-pattern='/agentic-ui-config/*']",
                fragment, XPathConstants.NODESET)).getLength());
    }
}
