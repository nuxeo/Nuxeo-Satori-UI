package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
        Node mapping = onlyNode(xpath, fragment(), "/fragment/extension/filter-mapping[url-pattern='/agentic-ui/*']");

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
        Node servlet = onlyNode(xpath, fragment,
                "/fragment/extension/servlet[servlet-class='org.nuxeo.agentic.config.AgenticUiConfigServlet']");
        Node mapping = onlyNode(xpath, fragment,
                "/fragment/extension/servlet-mapping[servlet-name='Agentic UI Configuration']");

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

    /**
     * The app registry is read after sign-in: the authentication filter is mapped on its path, and on
     * nothing of the configuration's, which everyone reads before signing in.
     */
    @Test
    void theAppRegistryIsAuthenticatedOnAServletMappingOfItsOwn() throws Exception {
        XPath xpath = XPathFactory.newInstance().newXPath();
        Document fragment = fragment();
        Node servlet = onlyNode(xpath, fragment,
                "/fragment/extension/servlet[servlet-class='org.nuxeo.agentic.config.AgenticUiAppsServlet']");
        Node mapping = onlyNode(xpath, fragment,
                "/fragment/extension/servlet-mapping[servlet-name='" + xpath.evaluate("servlet-name", servlet) + "']");
        Node filter = onlyNode(xpath, fragment,
                "/fragment/extension/filter-mapping[url-pattern='/agentic-ui-apps/*']");

        assertEquals("web#SERVLET", xpath.evaluate("../@target", servlet));
        assertEquals("web#SERVLET-MAPPING", xpath.evaluate("../@target", mapping));
        assertEquals("/agentic-ui-apps/*", xpath.evaluate("url-pattern", mapping));
        assertEquals(1, ((NodeList) xpath.evaluate("url-pattern", mapping, XPathConstants.NODESET)).getLength());
        assertEquals("web#FILTER-MAPPING", xpath.evaluate("../@target", filter));
        assertEquals("NuxeoAuthenticationFilter", xpath.evaluate("filter-name", filter));
        assertEquals(1, ((NodeList) xpath.evaluate("url-pattern", filter, XPathConstants.NODESET)).getLength());
        NodeList dispatchers = (NodeList) xpath.evaluate("dispatcher", filter, XPathConstants.NODESET);
        assertEquals(2, dispatchers.getLength());
        assertEquals("REQUEST", dispatchers.item(0).getTextContent().trim());
        assertEquals("FORWARD", dispatchers.item(1).getTextContent().trim());
        // Every filter mapping is either the application's or the registry's: none reaches the
        // configuration servlet's path, under any spelling of a pattern that would cover it.
        NodeList patterns = (NodeList) xpath.evaluate("/fragment/extension/filter-mapping/url-pattern", fragment,
                XPathConstants.NODESET);
        for (int i = 0; i < patterns.getLength(); i++) {
            String pattern = patterns.item(i).getTextContent().trim();
            assertTrue(pattern.equals("/agentic-ui/*") || pattern.equals("/agentic-ui-apps/*"), pattern);
        }
    }

    /**
     * The registry's path takes the REST API's authentication chain, so a request that does not
     * authenticate is answered 401, not sent the login page, and the chain's URL pattern covers the
     * registry and nothing of the configuration's.
     */
    @Test
    void theAppRegistryAuthenticatesAsTheRestApiDoes() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        Document auth;
        try (InputStream in = getClass().getClassLoader().getResourceAsStream("OSGI-INF/auth-config-agentic.xml")) {
            assertNotNull(in);
            auth = factory.newDocumentBuilder().parse(in);
        }
        XPath xpath = XPathFactory.newInstance().newXPath();
        Node chain = onlyNode(xpath, auth,
                "/component/extension[@point='specificChains']/specificAuthenticationChain");
        assertEquals("org.nuxeo.ecm.platform.ui.web.auth.service.PluggableAuthenticationService",
                xpath.evaluate("../@target", chain));
        String url = xpath.evaluate("urlPatterns/url", chain).trim();
        assertTrue(java.util.regex.Pattern.matches(url, "/nuxeo/agentic-ui-apps/apps.json"), url);
        assertTrue(java.util.regex.Pattern.matches(url, "/nuxeo/agentic-ui-apps/apps/payers-claims/home.json"), url);
        assertFalse(java.util.regex.Pattern.matches(url, "/nuxeo/agentic-ui-config/bootstrap.json"), url);
        assertFalse(java.util.regex.Pattern.matches(url, "/nuxeo/agentic-ui/index.html"), url);
        NodeList plugins = (NodeList) xpath.evaluate("replacementChain/plugin", chain, XPathConstants.NODESET);
        java.util.List<String> names = new java.util.ArrayList<>();
        for (int i = 0; i < plugins.getLength(); i++) {
            names.add(plugins.item(i).getTextContent().trim());
        }
        // nuxeo-rest-api-server 2025.10.18, OSGI-INF/auth-contrib.xml, the RestAPI chain, as read
        // from the server's jar, then the default chain's anonymous plugin, last. No form: that
        // would answer the application with a login page. Measured on the local server without
        // ANONYMOUS_AUTH: a request with no credentials was 401 where the server's own
        // anonymous-config.xml lets /api/v1/me answer Anonymous, and a 401 signs the app out.
        assertEquals(java.util.List.of("AUTOMATION_BASIC_AUTH", "TOKEN_AUTH", "OAUTH2_AUTH", "JWT_AUTH",
                "ANONYMOUS_AUTH"), names);
        assertFalse(names.contains("FORM_AUTH"));
    }
}
