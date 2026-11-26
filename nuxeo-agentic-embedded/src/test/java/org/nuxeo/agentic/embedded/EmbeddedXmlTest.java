package org.nuxeo.agentic.embedded;

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
import java.util.List;
import java.util.jar.Manifest;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;
import org.nuxeo.common.xmap.XMap;

/**
 * The bundle as the runtime reads it: its manifest's components, the example its extension point
 * documents, read by the same XMap and held to {@link Host#of}, and where its deployment fragment puts
 * the servlet and the filter.
 */
class EmbeddedXmlTest {

    private static String resource(String name) throws Exception {
        try (InputStream in = EmbeddedXmlTest.class.getClassLoader().getResourceAsStream(name)) {
            assertNotNull(in, name + " is not in the bundle");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    /** The bundle's own manifest, which the jar is built with: the classpath holds every dependency's too. */
    private static Manifest manifest() throws Exception {
        try (InputStream in = Files.newInputStream(Path.of("src/main/resources/META-INF/MANIFEST.MF"))) {
            return new Manifest(in);
        }
    }

    private static List<String> components() throws Exception {
        String value = manifest().getMainAttributes().getValue("Nuxeo-Component");
        List<String> components = new ArrayList<>();
        for (String each : value.split(",")) {
            components.add(each.trim());
        }
        return components;
    }

    @Test
    void theManifestNamesTheComponentsTheBundleHolds() throws Exception {
        assertEquals("org.nuxeo.agentic.embedded;singleton:=true",
                manifest().getMainAttributes().getValue("Bundle-SymbolicName"));
        assertEquals(List.of("OSGI-INF/embedded-panels-service.xml", "OSGI-INF/embedded-panels-auth-contrib.xml"),
                components());
        for (String component : components()) {
            assertTrue(resource(component).contains("<component name=\"org.nuxeo.agentic.embedded"), component);
        }
    }

    @Test
    void theDocumentedExampleRegisters() throws Exception {
        String xml = resource("OSGI-INF/embedded-panels-service.xml");
        Matcher code = Pattern.compile("<code>(.*?)</code>", Pattern.DOTALL).matcher(xml);
        assertTrue(code.find());
        XMap xmap = new XMap();
        xmap.register(HostDescriptor.class);
        Object[] loaded = xmap.loadAll(new ByteArrayInputStream(code.group(1).getBytes(StandardCharsets.UTF_8)));
        assertEquals(1, loaded.length);
        Host host = Host.of((HostDescriptor) loaded[0]);
        assertEquals("crm", host.id());
        assertEquals(Host.Algorithm.RS256, host.algorithm());
        assertEquals("jsmith", host.users().get("u-1042"));
        assertEquals(List.of("crm_panel_users"), List.copyOf(host.groups()));
        assertFalse(host.allowAdministrators());
        assertEquals(List.of("read"), List.copyOf(host.scopes()));
        assertEquals(300, host.tokenLifetime());
        assertTrue(xml.contains("<object class=\"org.nuxeo.agentic.embedded.HostDescriptor\" />"));
        assertTrue(xml.contains("<implementation class=\"org.nuxeo.agentic.embedded.EmbeddedPanelComponent\" />"));
    }

    @Test
    void theFilterGuardsEveryPathTheRestApiIsAuthenticatedOn() throws Exception {
        String fragment = resource("OSGI-INF/deployment-fragment.xml").replaceAll("(?s)<!--.*?-->", "");
        assertTrue(fragment.contains("<filter-class>org.nuxeo.agentic.embedded.PanelTokenFilter</filter-class>"));
        String compact = fragment.replaceAll("\\s+", "");
        assertTrue(compact.contains("<filter-name>AgenticEmbeddedPanelTokenFilter</filter-name><url-pattern>/api/*"
                + "</url-pattern><dispatcher>REQUEST</dispatcher>"));
        assertTrue(compact.contains("<filter-name>AgenticEmbeddedPanelTokenFilter</filter-name><url-pattern>/site/*"
                + "</url-pattern><dispatcher>REQUEST</dispatcher><dispatcher>FORWARD</dispatcher>"));
        assertTrue(compact.contains("<servlet-name>AgenticEmbeddedPanels</servlet-name><url-pattern>"
                + "/agentic-embedded/*</url-pattern>"));
        assertFalse(fragment.contains("NuxeoAuthenticationFilter"),
                "no authentication filter: the host's server is not a Nuxeo user");
    }

    /**
     * The REST API's two chains as LTS 2025.10.18 resolves them: nuxeo-platform-login-token's
     * OSGI-INF/token-authentication-contrib.xml sets both, after nuxeo-automation-server's and
     * nuxeo-rest-api-server's, with the same plugins.
     */
    static final List<String> REST_API_CHAINS_2025 = List.of("AUTOMATION_BASIC_AUTH", "TOKEN_AUTH", "OAUTH2_AUTH",
            "JWT_AUTH");

    @Test
    void thePanelsAuthenticatorIsInTheRestApisChainsAloneAndKeepsNoSession() throws Exception {
        String auth = resource("OSGI-INF/embedded-panels-auth-contrib.xml").replaceAll("(?s)<!--.*?-->", "");
        String compact = auth.replaceAll("\\s+", " ");
        for (String required : List.of("org.nuxeo.ecm.automation.server.auth.config",
                "org.nuxeo.ecm.restapi.server.auth.config", "org.nuxeo.ecm.login.token.authentication.contrib")) {
            assertTrue(compact.contains("<require>" + required + "</require>"),
                    "after " + required + ", which sets the chains it replaces");
        }
        assertTrue(compact.contains("<authenticationPlugin name=\"" + PanelTokenAuthenticator.NAME
                + "\" enabled=\"true\" class=\"" + PanelTokenAuthenticator.class.getName() + "\">"));
        assertTrue(compact.contains("<stateful>false</stateful>"), "stateless: no session for a panel's token");
        assertTrue(compact.contains("<needStartingURLSaving>false</needStartingURLSaving>"));

        // Exactly the two chains the REST API's addresses match, by their patterns, with the platform's
        // plugins in their order and the panel's last.
        Matcher chains = Pattern.compile("<specificAuthenticationChain name=\"([^\"]+)\">(.*?)</specificAuthenticationChain>",
                Pattern.DOTALL).matcher(auth);
        java.util.Map<String, String> patterns = new java.util.LinkedHashMap<>();
        List<String> expected = new ArrayList<>(REST_API_CHAINS_2025);
        expected.add(PanelTokenAuthenticator.NAME);
        while (chains.find()) {
            Matcher url = Pattern.compile("<url>([^<]+)</url>").matcher(chains.group(2));
            assertTrue(url.find());
            patterns.put(chains.group(1), url.group(1));
            List<String> plugins = new ArrayList<>();
            Matcher plugin = Pattern.compile("<plugin>([^<]+)</plugin>").matcher(chains.group(2));
            while (plugin.find()) {
                plugins.add(plugin.group(1));
            }
            assertEquals(expected, plugins, chains.group(1));
        }
        assertEquals(java.util.Map.of("RestAPI", "(.*)/api/v.*", "Automation", "(.*)/automation.*"), patterns);
        assertEquals(List.copyOf(patterns.keySet()).stream().sorted().toList(),
                AuthenticationChains.CHAINS.stream().sorted().toList(), "the start-up check reads the same chains");
        // Both match the REST API's operation address, the reason both are contributed.
        String operation = "/nuxeo/api/v1/automation/Connector.Read";
        assertTrue(operation.matches(patterns.get("RestAPI")) && operation.matches(patterns.get("Automation")));
        assertFalse(resource("OSGI-INF/embedded-panels-service.xml").contains("JWTService"),
                "the panel's token is not the platform's JWT");
    }

    @Test
    void theCompiledInterfaceCopyIsKeptOutOfTheJar() throws Exception {
        String pom = Files.readString(Path.of("pom.xml")).replaceAll("(?s)<!--.*?-->", "").replaceAll("\\s+", "");
        assertTrue(pom.contains("<excludes><exclude>org/nuxeo/ecm/**</exclude></excludes>"), pom);
    }

    @Test
    void thePanelsFilesAreOpenAndNothingElse() throws Exception {
        String auth = resource("OSGI-INF/embedded-panels-auth-contrib.xml").replaceAll("(?s)<!--.*?-->", "");
        Matcher grants = Pattern.compile("<grantPattern>(.*?)</grantPattern>").matcher(auth);
        List<String> patterns = new ArrayList<>();
        while (grants.find()) {
            patterns.add(grants.group(1));
        }
        assertEquals(List.of("${org.nuxeo.ecm.contextPath}/agentic-ui/embedded/.*"), patterns);
    }
}
