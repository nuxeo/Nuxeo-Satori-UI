package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Who may read the diagnostics page's report, and how: administrators alone, decided on the server,
 * by {@code GET} alone. The servlet here runs with no Nuxeo: the configuration service, the
 * package manager's directory and every other thing the report reads are not there, so a refusal
 * that answers is one that read none of them, and a report built for someone it should not be
 * would fail the test on the first thing it asked for.
 */
class DiagnosticsAccessTest {

    private static final String PATH = "/diagnostics.json";

    private static HttpServletRequest request(String method, Principal principal) {
        return (HttpServletRequest) Proxy.newProxyInstance(HttpServletRequest.class.getClassLoader(),
                new Class<?>[] { HttpServletRequest.class }, (proxy, m, args) -> switch (m.getName()) {
                case "getMethod" -> method;
                case "getUserPrincipal" -> principal;
                case "getPathInfo" -> PATH;
                default -> throw new UnsupportedOperationException(m.getName());
                });
    }

    /** Records what the servlet answers: status, headers, content type and the bytes of the body. */
    private static HttpServletResponse response(Map<String, Object> recorded, ByteArrayOutputStream body) {
        ServletOutputStream out = new ServletOutputStream() {
            @Override
            public boolean isReady() {
                return true;
            }

            @Override
            public void setWriteListener(WriteListener listener) {
                throw new UnsupportedOperationException();
            }

            @Override
            public void write(int b) {
                body.write(b);
            }
        };
        return (HttpServletResponse) Proxy.newProxyInstance(HttpServletResponse.class.getClassLoader(),
                new Class<?>[] { HttpServletResponse.class }, (proxy, m, args) -> {
                    switch (m.getName()) {
                    case "setStatus" -> recorded.put("status", args[0]);
                    case "setHeader" -> recorded.put((String) args[0], args[1]);
                    case "setContentType" -> recorded.put("Content-Type", args[0]);
                    case "setContentLength" -> recorded.put("length", args[0]);
                    case "getOutputStream" -> {
                        return out;
                    }
                    default -> throw new UnsupportedOperationException(m.getName());
                    }
                    return null;
                });
    }

    private static NuxeoPrincipal principal(String name, List<String> groups, boolean administrator) {
        return (NuxeoPrincipal) Proxy.newProxyInstance(NuxeoPrincipal.class.getClassLoader(),
                new Class<?>[] { NuxeoPrincipal.class }, (proxy, m, args) -> switch (m.getName()) {
                case "getName" -> name;
                case "getAllGroups" -> groups;
                case "isAdministrator" -> administrator;
                default -> throw new UnsupportedOperationException(m.getName());
                });
    }

    /**
     * A non-administrator is refused 403, and nothing of the server is read: with no Nuxeo running,
     * building the report would throw on its first read. Every one of them, whatever their groups:
     * being in {@code administrators} by name is not what decides, {@code isAdministrator} is.
     */
    @Test
    void aNonAdministratorIsRefusedAndNothingOfTheServerIsRead() throws Exception {
        for (NuxeoPrincipal someone : List.of(principal("dana", List.of("members", "claims-adjusters"), false),
                principal("sam", List.of("members", "administrators", "powerusers"), false),
                principal("Anonymous", List.of(), false))) {
            Map<String, Object> recorded = new HashMap<>();
            ByteArrayOutputStream body = new ByteArrayOutputStream();

            new AgenticUiAppsServlet().service(request("GET", someone), response(recorded, body));

            assertEquals(HttpServletResponse.SC_FORBIDDEN, recorded.get("status"), someone.getName());
            assertEquals("no-store", recorded.get("Cache-Control"));
            JsonNode answer = ConfigSnapshot.JSON.readTree(body.toByteArray());
            assertEquals("forbidden", answer.path("error").asText());
            String text = body.toString(StandardCharsets.UTF_8);
            assertFalse(text.contains("packages"), text);
            assertFalse(text.contains("checks"), text);
        }
    }

    @Test
    void aRequestWithNoNuxeoPrincipalIsUnauthorizedAndReadsNothing() throws Exception {
        Principal stranger = () -> "dana";
        for (Principal principal : java.util.Arrays.asList(null, stranger)) {
            Map<String, Object> recorded = new HashMap<>();
            ByteArrayOutputStream body = new ByteArrayOutputStream();

            new AgenticUiAppsServlet().service(request("GET", principal), response(recorded, body));

            assertEquals(HttpServletResponse.SC_UNAUTHORIZED, recorded.get("status"));
            assertEquals(0, recorded.get("length"));
            assertEquals(0, body.size());
        }
    }

    /** GET alone: every other method is 405, an administrator's included, before anyone is looked at. */
    @ParameterizedTest
    @ValueSource(strings = { "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "TRACE" })
    void everyMethodButGetIsRefusedBeforeThePersonIsLookedAt(String method) throws Exception {
        Principal refusesToBeRead = (Principal) Proxy.newProxyInstance(NuxeoPrincipal.class.getClassLoader(),
                new Class<?>[] { NuxeoPrincipal.class }, (proxy, m, args) -> {
                    throw new AssertionError("the principal was read for " + method);
                });
        for (Principal principal : java.util.Arrays.asList(null, refusesToBeRead)) {
            Map<String, Object> recorded = new HashMap<>();
            ByteArrayOutputStream body = new ByteArrayOutputStream();

            new AgenticUiAppsServlet().service(request(method, principal), response(recorded, body));

            assertEquals(HttpServletResponse.SC_METHOD_NOT_ALLOWED, recorded.get("status"), method);
            assertEquals("GET", recorded.get("Allow"));
            assertEquals(0, recorded.get("length"));
            assertFalse(recorded.containsKey("Access-Control-Allow-Origin"));
        }
    }

    /** The endpoint asks for the report for an administrator, and only then. */
    @Test
    void theReportIsBuiltForAnAdministratorAloneAndIsNeverCached() throws Exception {
        AtomicInteger built = new AtomicInteger();
        java.util.function.Supplier<com.fasterxml.jackson.databind.node.ObjectNode> report = () -> {
            built.incrementAndGet();
            return ConfigSnapshot.JSON.createObjectNode().put("format", DiagnosticsReport.FORMAT);
        };

        for (AppRegistryEndpoint.Viewer someone : List.of(
                new AppRegistryEndpoint.Viewer("dana", Set.of("members", "claims-adjusters"), false),
                new AppRegistryEndpoint.Viewer("sam", Set.of("administrators"), false))) {
            AppRegistryEndpoint.Response refused = DiagnosticsEndpoint.respond(someone, report);
            assertEquals(403, refused.status());
            assertEquals("no-store", refused.headers().get("Cache-Control"));
        }
        assertEquals(403, DiagnosticsEndpoint.respond(null, report).status());
        assertEquals(0, built.get(), "no report is built for anyone but an administrator");

        AppRegistryEndpoint.Response answered = DiagnosticsEndpoint.respond(
                new AppRegistryEndpoint.Viewer("Administrator", Set.of("administrators"), true), report);
        assertEquals(200, answered.status());
        assertEquals(1, built.get());
        assertEquals("no-store", answered.headers().get("Cache-Control"));
        assertEquals("nosniff", answered.headers().get("X-Content-Type-Options"));
        assertTrue(answered.headers().get("Content-Type").startsWith("application/json"));
        assertEquals(DiagnosticsReport.FORMAT,
                ConfigSnapshot.JSON.readTree(answered.body()).path("format").asText());
    }

    @Test
    void onlyItsOwnPathIsAnswered() {
        assertTrue(DiagnosticsEndpoint.answers("/diagnostics.json"));
        for (String other : java.util.Arrays.asList(null, "/apps.json", "/diagnostics.json/", "/apps/x/diagnostics.json",
                "/Diagnostics.json", "/layer.json")) {
            assertFalse(DiagnosticsEndpoint.answers(other), String.valueOf(other));
        }
    }
}
