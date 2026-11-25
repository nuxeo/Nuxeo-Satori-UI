package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;
import java.security.Principal;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;

class AgenticUiAppsServletTest {

    private static HttpServletRequest request(String method, Principal principal) {
        return request(method, principal, "/apps.json");
    }

    private static HttpServletRequest request(String method, Principal principal, String path) {
        return (HttpServletRequest) Proxy.newProxyInstance(HttpServletRequest.class.getClassLoader(),
                new Class<?>[] { HttpServletRequest.class }, (proxy, m, args) -> switch (m.getName()) {
                case "getMethod" -> method;
                case "getUserPrincipal" -> principal;
                case "getPathInfo" -> path;
                default -> throw new UnsupportedOperationException(m.getName());
                });
    }

    private static HttpServletResponse response(Map<String, Object> recorded) {
        return (HttpServletResponse) Proxy.newProxyInstance(HttpServletResponse.class.getClassLoader(),
                new Class<?>[] { HttpServletResponse.class }, (proxy, m, args) -> {
                    switch (m.getName()) {
                    case "setStatus" -> recorded.put("status", args[0]);
                    case "setHeader" -> recorded.put((String) args[0], args[1]);
                    case "setContentLength" -> recorded.put("length", args[0]);
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
     * Before the principal is read: a change is only ever a POST to a deployment layer's address,
     * and a preflight, OPTIONS, is answered like any other method, with no CORS header.
     */
    @ParameterizedTest
    @ValueSource(strings = { "OPTIONS", "TRACE", "PUT", "DELETE", "PATCH" })
    void aDeploymentLayersAddressTakesPostAndNoOtherMethodButGetAndHead(String method) throws Exception {
        for (String path : List.of("/apps/payers-claims/layer/layouts/Claim/view.layout.json", "/layer.json")) {
            Map<String, Object> recorded = new HashMap<>();

            new AgenticUiAppsServlet().service(request(method, null, path), response(recorded));

            assertEquals(HttpServletResponse.SC_METHOD_NOT_ALLOWED, recorded.get("status"));
            assertEquals("GET, HEAD, POST", recorded.get("Allow"));
            assertFalse(recorded.containsKey("Access-Control-Allow-Origin"));
        }
    }

    @Test
    void aChangeWithNoNuxeoPrincipalIsUnauthorizedAndReadsNoBody() throws Exception {
        Map<String, Object> recorded = new HashMap<>();

        new AgenticUiAppsServlet().service(request("POST", null, "/apps/payers-claims/layer/queues/my-claims.json"),
                response(recorded));

        assertEquals(HttpServletResponse.SC_UNAUTHORIZED, recorded.get("status"));
    }

    @ParameterizedTest
    @ValueSource(strings = { "OPTIONS", "TRACE", "POST", "PUT", "DELETE", "PATCH" })
    void everyMethodButGetAndHeadIsRefused(String method) throws Exception {
        Map<String, Object> recorded = new HashMap<>();

        new AgenticUiAppsServlet().service(request(method, principal("dana", List.of("members"), false)),
                response(recorded));

        assertEquals(HttpServletResponse.SC_METHOD_NOT_ALLOWED, recorded.get("status"));
        assertEquals("GET, HEAD", recorded.get("Allow"));
        assertEquals(0, recorded.get("length"));
    }

    /**
     * Reached with no Nuxeo principal, which the filter mapping rules out, the servlet answers 401 and
     * reads nothing: the response proxy refuses every call but the three it records, and the
     * configuration service, which a read would need, is not running here.
     */
    @Test
    void aRequestWithNoNuxeoPrincipalIsUnauthorizedAndReadsNothing() throws Exception {
        Principal stranger = () -> "dana";
        for (Principal principal : Arrays.asList(null, stranger)) {
            for (String method : List.of("GET", "HEAD")) {
                Map<String, Object> recorded = new HashMap<>();

                new AgenticUiAppsServlet().service(request(method, principal), response(recorded));

                assertEquals(HttpServletResponse.SC_UNAUTHORIZED, recorded.get("status"), method);
                assertEquals("no-store", recorded.get("Cache-Control"));
                assertEquals(0, recorded.get("length"));
            }
        }
    }

    @Test
    void theViewerIsThePrincipalWithEveryGroupNuxeoCountsThemIn() {
        AppRegistryEndpoint.Viewer viewer = AgenticUiAppsServlet.viewer(
                principal("dana", Arrays.asList("members", "claims-adjusters", null), false));

        assertEquals("dana", viewer.name());
        assertEquals(Set.of("members", "claims-adjusters"), viewer.groups());
        assertFalse(viewer.administrator());

        AppRegistryEndpoint.Viewer administrator = AgenticUiAppsServlet.viewer(principal("Administrator", null, true));
        assertTrue(administrator.groups().isEmpty());
        assertTrue(administrator.administrator());

        assertNull(AgenticUiAppsServlet.viewer(null));
        assertNull(AgenticUiAppsServlet.viewer(() -> "dana"));
    }
}
