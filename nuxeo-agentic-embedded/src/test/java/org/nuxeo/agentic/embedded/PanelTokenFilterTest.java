package org.nuxeo.agentic.embedded;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import jakarta.servlet.FilterChain;

/**
 * The filter reads a request as the platform's JWT authenticator would, and holds one with a panel's
 * token to the guard's rule before the REST API sees it.
 */
class PanelTokenFilterTest {

    private PanelTokenFilter filter;

    private String token;

    @BeforeEach
    void setUp() {
        Map<String, Host> hosts = new HashMap<>(Map.of("crm", Fixtures.host()));
        Fixtures.RecordingCodec tokens = new Fixtures.RecordingCodec(Fixtures.properties(Fixtures.host()), Fixtures.clock(Fixtures.NOW));
        token = tokens.issue(new TokenCodec.Grant("crm", "jsmith", "read", "t-1", Fixtures.NOW, 300));
        EmbeddedPanelComponent component = new EmbeddedPanelComponent();
        component.register(Fixtures.descriptor(), "test");
        component.start(Fixtures.settings(Fixtures.properties(Fixtures.host())), new Fixtures.MemoryReplayGuard(),
                Fixtures.Users.standard(), tokens, new Fixtures.RecordingAudit(), Fixtures.clock(Fixtures.NOW));
        filter = new PanelTokenFilter();
        filter.service = component;
    }

    private static Http.Request rest(String method, String servletPath, String pathInfo) {
        Http.Request request = new Http.Request();
        request.method = method;
        request.servletPath = servletPath;
        request.pathInfo = pathInfo;
        request.header("Origin", "https://crm.example.com");
        return request;
    }

    /** Whether the request reached what the filter guards, and what was answered if not. */
    private Http.Response through(Http.Request request, AtomicBoolean reached) throws Exception {
        Http.Response response = new Http.Response();
        FilterChain chain = (req, res) -> reached.set(true);
        filter.doFilter(request.proxy(), response.proxy(), chain);
        return response;
    }

    @Test
    void aReadOfARecordReachesTheRestApiOnBothItsPaths() throws Exception {
        for (Http.Request request : List.of(rest("GET", "/api", "/v1/id/abc"), rest("GET", "/site", "/api/v1/id/abc"))) {
            request.header("Authorization", "Bearer " + token);
            AtomicBoolean reached = new AtomicBoolean();
            through(request, reached);
            assertTrue(reached.get(), request.servletPath);
        }
    }

    @Test
    void aWriteIsRefusedBeforeTheRestApiSeesIt() throws Exception {
        Http.Request request = rest("DELETE", "/api", "/v1/id/abc").header("Authorization", "Bearer " + token);
        AtomicBoolean reached = new AtomicBoolean();
        Http.Response response = through(request, reached);
        assertFalse(reached.get());
        assertEquals(403, response.status);
        assertEquals("Bearer error=\"insufficient_scope\"", response.headers.get("WWW-Authenticate"));
        assertFalse(response.body().contains(token));
    }

    @Test
    void theTokenIsLookedForWhereTheAuthenticatorLooks() throws Exception {
        Http.Request query = rest("GET", "/api", "/v1/id/abc");
        query.query = "properties=*&access_token=" + token;
        AtomicBoolean reached = new AtomicBoolean();
        assertEquals(401, through(query, reached).status);
        assertFalse(reached.get());

        Http.Request form = rest("POST", "/api", "/v1/automation/Document.Delete");
        form.contentType = "application/x-www-form-urlencoded";
        form.parameters.put("access_token", token);
        assertEquals(401, through(form, reached).status);
        assertFalse(reached.get());

        // With an Authorization header the authenticator reads no form, and nor does the filter.
        Http.Request basic = rest("POST", "/api", "/v1/automation/Document.Delete");
        basic.contentType = "application/x-www-form-urlencoded";
        basic.header("Authorization", "Basic dXNlcjpwYXNz");
        basic.parameters.put("access_token", token);
        through(basic, reached);
        assertTrue(reached.get());
        assertFalse(basic.parametersRead, "a body the authenticator does not read is not read here either");
    }

    @Test
    void aMethodOverrideIsRefused() throws Exception {
        for (String header : PanelTokenFilter.METHOD_OVERRIDES) {
            Http.Request request = rest("POST", "/api", "/v1/automation/Connector.Read")
                                       .header("Authorization", "Bearer " + token)
                                       .header(header, "DELETE");
            AtomicBoolean reached = new AtomicBoolean();
            assertEquals(403, through(request, reached).status, header);
            assertFalse(reached.get());
        }
        Http.Request param = rest("POST", "/api", "/v1/automation/Connector.Read").header("Authorization",
                "Bearer " + token);
        param.query = "_method=DELETE";
        assertEquals(403, through(param, new AtomicBoolean()).status);
    }

    @Test
    void aRequestWithNoPanelsTokenPassesUntouched() throws Exception {
        Http.Request request = rest("DELETE", "/api", "/v1/id/abc").header("Authorization", "Basic dXNlcjpwYXNz");
        AtomicBoolean reached = new AtomicBoolean();
        Http.Response response = through(request, reached);
        assertTrue(reached.get());
        assertEquals(200, response.status);
        assertTrue(response.headers.isEmpty());
    }

    @Test
    void anAddressParameterIsReadAsTheServletReadsIt() {
        assertEquals("x", PanelTokenFilter.queryParameter("a=1&access%5Ftoken=x", "access_token"));
        assertEquals("", PanelTokenFilter.queryParameter("access_token", "access_token"));
        assertNull(PanelTokenFilter.queryParameter("a=1", "access_token"));
        assertNull(PanelTokenFilter.queryParameter(null, "access_token"));
    }
}
