package org.nuxeo.agentic.embedded;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.nuxeo.ecm.platform.api.login.UserIdentificationInfo;
import org.nuxeo.ecm.platform.ui.web.auth.interfaces.NuxeoAuthenticationPlugin;

import com.auth0.jwt.algorithms.Algorithm;

/**
 * The panel's authenticator: the user of a panel's token in its scope, and no one for anything else,
 * so that the REST API's chain answers 401.
 */
class PanelTokenAuthenticatorTest {

    private PanelTokenAuthenticator authenticator;

    private Fixtures.RecordingCodec tokens;

    private String token;

    @BeforeEach
    void setUp() {
        tokens = new Fixtures.RecordingCodec(Fixtures.properties(Fixtures.host()), Fixtures.clock(Fixtures.NOW));
        token = tokens.issue(new TokenCodec.Grant("crm", "jsmith", "read", "t-1", Fixtures.NOW, 300));
        EmbeddedPanelComponent component = new EmbeddedPanelComponent();
        component.register(Fixtures.descriptor(), "test");
        component.start(Fixtures.settings(Fixtures.properties(Fixtures.host())), new Fixtures.MemoryReplayGuard(),
                Fixtures.Users.standard(), tokens, new Fixtures.RecordingAudit(), Fixtures.clock(Fixtures.NOW));
        authenticator = new PanelTokenAuthenticator();
        authenticator.service = component;
    }

    private static Http.Request rest(String method, String pathInfo, String authorization) {
        Http.Request request = new Http.Request();
        request.method = method;
        request.servletPath = "/site";
        request.pathInfo = pathInfo;
        request.header("Origin", "https://crm.example.com");
        if (authorization != null) {
            request.header("Authorization", authorization);
        }
        return request;
    }

    private UserIdentificationInfo identify(Http.Request request) {
        return authenticator.handleRetrieveIdentity(request.proxy(), new Http.Response().proxy());
    }

    @Test
    void itSignsInTheUserOfAPanelsTokenInItsScope() {
        UserIdentificationInfo identity = identify(rest("GET", "/api/v1/id/abc", "Bearer " + token));
        assertNotNull(identity);
        assertEquals("jsmith", identity.getUserName());
    }

    @Test
    void itSignsNoOneInOutsideTheScopeOrWithABadToken() {
        assertNull(identify(rest("DELETE", "/api/v1/id/abc", "Bearer " + token)));
        assertNull(identify(rest("GET", "/api/v1/token", "Bearer " + token)));
        String platform = Fixtures.signWith(Fixtures.panelClaims("Administrator", Fixtures.NOW, 300),
                Algorithm.HMAC512(Fixtures.PLATFORM_SECRET));
        assertNull(identify(rest("GET", "/api/v1/id/abc", "Bearer " + platform)));
        tokens.clock = Fixtures.clock(Fixtures.NOW.plusSeconds(301));
        assertNull(identify(rest("GET", "/api/v1/id/abc", "Bearer " + token)), "expired");
    }

    @Test
    void itLeavesEveryOtherRequestToThePlatformsPlugins() {
        assertNull(identify(rest("GET", "/api/v1/id/abc", null)));
        assertNull(identify(rest("GET", "/api/v1/id/abc", "Basic dXNlcjpwYXNz")));
        Http.Request query = rest("GET", "/api/v1/id/abc", null);
        query.query = "access_token=" + token;
        assertNull(identify(query), "never from the address");
    }

    @Test
    void itNeverPromptsForASignIn() {
        assertFalse(authenticator.needLoginPrompt(rest("GET", "/api/v1/id/abc", null).proxy()));
        assertFalse(authenticator.handleLoginPrompt(rest("GET", "/api/v1/id/abc", null).proxy(),
                new Http.Response().proxy(), "/nuxeo/"));
        assertNull(authenticator.getUnAuthenticatedURLPrefix());
    }

    /**
     * The compile-time copy of the platform's interface, held to the signatures of LTS 2025.10.18's
     * own, as {@code javap} reads them from {@code nuxeo-platform-web-common-2025.10.18.jar}: a copy
     * that drifted would compile a plugin the server cannot load.
     */
    @Test
    void theInterfaceCopyIsThePlatformsOfLts2025() {
        List<String> expected = List.of(
                "Boolean handleLoginPrompt(jakarta.servlet.http.HttpServletRequest,jakarta.servlet.http.HttpServletResponse,String)",
                "UserIdentificationInfo handleRetrieveIdentity(jakarta.servlet.http.HttpServletRequest,jakarta.servlet.http.HttpServletResponse)",
                "List getUnAuthenticatedURLPrefix()", "Boolean needLoginPrompt(jakarta.servlet.http.HttpServletRequest)",
                "void initPlugin(java.util.Map)");
        List<String> actual = Arrays.stream(NuxeoAuthenticationPlugin.class.getDeclaredMethods())
                                    .map(PanelTokenAuthenticatorTest::signature)
                                    .sorted()
                                    .collect(Collectors.toList());
        assertEquals(expected.stream().sorted().collect(Collectors.toList()), actual);
    }

    private static String signature(Method method) {
        String parameters = Arrays.stream(method.getParameterTypes())
                                  .map(type -> type.getName().startsWith("java.lang.") ? type.getSimpleName()
                                          : type.getName())
                                  .collect(Collectors.joining(","));
        return method.getReturnType().getSimpleName() + " " + method.getName() + "(" + parameters + ")";
    }
}
