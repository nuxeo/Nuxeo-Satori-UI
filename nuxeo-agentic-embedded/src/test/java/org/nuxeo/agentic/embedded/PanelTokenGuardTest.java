package org.nuxeo.agentic.embedded;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;

/**
 * What the server does with a request to the REST API that carries a panel's token: the token's
 * lifetime, its host, its origins, the REST API only, and its scope, enforced before the request is
 * served.
 */
class PanelTokenGuardTest {

    private static final String DOCUMENT = "api/v1/id/5f1c0e2a-0000-4000-8000-000000000001";

    private static final String ORIGIN = "https://crm.example.com";

    private final Map<String, Host> hosts = new HashMap<>();

    private Fixtures.RecordingCodec tokens;

    private PanelTokenGuard guard;

    private String token;

    @BeforeEach
    void setUp() {
        hosts.put("crm", Fixtures.host());
        tokens = new Fixtures.RecordingCodec(Fixtures.properties(Fixtures.host()), Fixtures.clock(Fixtures.NOW));
        guard = new PanelTokenGuard(hosts::get, tokens, Fixtures.clock(Fixtures.NOW));
        token = issue("read", Fixtures.NOW, 300);
    }

    private String issue(String scope, Instant issuedAt, int lifetime) {
        return tokens.issue(new TokenCodec.Grant("crm", "jsmith", scope, "t-1", issuedAt, lifetime));
    }

    @Test
    void aTokenInItsScopeNamesTheUserItSignsIn() {
        PanelTokenGuard.Decision decision = check("GET", DOCUMENT);
        assertTrue(decision.passes());
        assertEquals("jsmith", decision.username());
        assertEquals(null, guard.check(request("GET", DOCUMENT, null, ORIGIN)).username(),
                "no panel's token, no user: the platform's plugins decide");
    }

    @Test
    void aTokenSignedWithThePlatformsJwtSecretIsNotAPanelsToken() {
        // The claims of a panel's token, signed as the platform's JWT service signs, with nuxeo.jwt.secret:
        // whatever the platform would make of it, the panel's rule refuses it.
        Map<String, Object> claims = Fixtures.panelClaims("jsmith", Fixtures.NOW, 300);
        String platform = Fixtures.signWith(claims, Algorithm.HMAC512(Fixtures.PLATFORM_SECRET));
        assertRefused(guard.check(request("GET", DOCUMENT, platform, ORIGIN)), 401);
        String platform256 = Fixtures.signWith(claims, Algorithm.HMAC256(Fixtures.PLATFORM_SECRET));
        assertRefused(guard.check(request("GET", DOCUMENT, platform256, ORIGIN)), 401);
        // The same claims with the add-on's key: a panel's token.
        assertTrue(guard.check(request("GET", DOCUMENT, tokens.sign(claims), ORIGIN)).passes());
    }

    @Test
    void aTokenWhoseHeaderNamesAnotherAlgorithmIsRefusedWhateverItsSignature() {
        // An HS256 signature with the add-on's key, under a header that says HS512: only the header tells.
        Base64.Encoder url = Base64.getUrlEncoder().withoutPadding();
        String header = url.encodeToString("{\"alg\":\"HS512\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
        String payload = tokens.sign(Fixtures.panelClaims("jsmith", Fixtures.NOW, 300)).split("\\.")[1];
        byte[] signature = Algorithm.HMAC256(Fixtures.TOKEN_SECRET)
                                    .sign(header.getBytes(StandardCharsets.UTF_8),
                                            payload.getBytes(StandardCharsets.UTF_8));
        String relabelled = header + "." + payload + "." + url.encodeToString(signature);
        assertRefused(guard.check(request("GET", DOCUMENT, relabelled, ORIGIN)), 401);
    }

    @Test
    void aTokenOfTheAddOnsKeyForAnotherServerOrIssuerIsRefused() {
        Map<String, Object> claims = Fixtures.panelClaims("jsmith", Fixtures.NOW, 300);
        claims.put("aud", "https://other-nuxeo.example.com/nuxeo");
        assertRefused(guard.check(request("GET", DOCUMENT, tokens.sign(claims), ORIGIN)), 401);
        claims = Fixtures.panelClaims("jsmith", Fixtures.NOW, 300);
        claims.put("iss", "nuxeo");
        assertRefused(guard.check(request("GET", DOCUMENT, tokens.sign(claims), ORIGIN)), 401);
    }

    private static PanelTokenGuard.Request request(String method, String path, String token, String origin) {
        return new PanelTokenGuard.Request(method, path, "/nuxeo/" + path, token == null ? null : "Bearer " + token,
                null, null, origin, false);
    }

    private PanelTokenGuard.Decision check(String method, String path) {
        return guard.check(request(method, path, token, ORIGIN));
    }

    private static void assertRefused(PanelTokenGuard.Decision decision, int status) {
        assertEquals(status, decision.status(), decision::reason);
    }

    @Test
    void aReadTokenFromItsHostsPageReadsARecord() {
        assertTrue(check("GET", DOCUMENT).passes());
        // As the server forwards it, and as it authenticates it.
        assertTrue(check("GET", "site/" + DOCUMENT).passes());
        assertTrue(check("POST", "api/v1/automation/Connector.Read").passes());
        // A client that sends no Origin: not a browser on another page.
        assertTrue(guard.check(request("GET", DOCUMENT, token, null)).passes());
    }

    @Test
    void aRequestWithNoPanelsTokenPassesUntouched() {
        assertTrue(guard.check(request("DELETE", DOCUMENT, null, "https://elsewhere.example")).passes());
        String platformToken = JWT.create().withSubject("jsmith").withClaim("aud", "site/api/v1")
                                  .sign(Algorithm.HMAC512(Fixtures.PLATFORM_SECRET));
        // Not a panel's, not this rule's: the platform's own plugins decide what it may do.
        assertTrue(guard.check(request("DELETE", DOCUMENT, platformToken, null)).passes(),
                "a JWT of the platform's that is not a panel's is the platform's business");
        assertTrue(guard.check(new PanelTokenGuard.Request("DELETE", DOCUMENT, "/nuxeo/" + DOCUMENT,
                "Basic dXNlcjpwYXNz", null, null, null, false)).passes());
    }

    @Test
    void theScopeIsEnforced() {
        assertRefused(check("PUT", DOCUMENT), 403);
        assertRefused(check("DELETE", DOCUMENT), 403);
        assertRefused(check("POST", "api/v1/automation/Document.Delete"), 403);
        assertRefused(check("GET", "api/v1/token"), 403);

        token = issue("read write", Fixtures.NOW, 300);
        hosts.put("crm", writeHost());
        assertTrue(check("PUT", DOCUMENT).passes());
        assertRefused(check("POST", "api/v1/automation/Document.Delete"), 403);
        assertRefused(check("POST", "api/v1/token"), 403);
    }

    private static Host writeHost() {
        HostDescriptor descriptor = Fixtures.descriptor();
        descriptor.scopes = new java.util.ArrayList<>(List.of("write"));
        return Host.of(descriptor);
    }

    @Test
    void theLifetimeIsEnforced() {
        // Expired: one second after its end.
        guard = new PanelTokenGuard(hosts::get, tokens, Fixtures.clock(Fixtures.NOW.plusSeconds(301)));
        tokens.clock = Fixtures.clock(Fixtures.NOW.plusSeconds(301));
        assertRefused(check("GET", DOCUMENT), 401);

        // Signed by this server, and longer-lived than its host allows, as after the host's lifetime is lowered.
        tokens.clock = Fixtures.clock(Fixtures.NOW);
        guard = new PanelTokenGuard(hosts::get, tokens, Fixtures.clock(Fixtures.NOW));
        token = issue("read", Fixtures.NOW, 3600);
        assertRefused(check("GET", DOCUMENT), 401);

        // No issue time.
        Map<String, Object> claims = Fixtures.panelClaims("jsmith", Fixtures.NOW, 60);
        claims.remove("iat");
        token = tokens.sign(claims);
        assertRefused(check("GET", DOCUMENT), 401);
    }

    @Test
    void aTokenThatClaimsToBeAPanelsAndIsNotIsRefusedHere() {
        String forged = Fixtures.signWith(Fixtures.panelClaims("Administrator", Fixtures.NOW, 60),
                Algorithm.HMAC256("not-the-servers-key-at-all-0123456789"));
        assertRefused(guard.check(request("GET", DOCUMENT, forged, ORIGIN)), 401);
        String unsigned = JWT.create().withClaim(TokenCodec.HOST, "crm").sign(Algorithm.none());
        assertRefused(guard.check(request("GET", DOCUMENT, unsigned, ORIGIN)), 401);
    }

    @Test
    void removingTheHostEndsItsTokensAtOnce() {
        hosts.remove("crm");
        assertRefused(check("GET", DOCUMENT), 401);
    }

    @Test
    void aTokenIsBoundToItsHostsOrigins() {
        assertRefused(guard.check(request("GET", DOCUMENT, token, "https://elsewhere.example")), 403);
        assertRefused(guard.check(request("GET", DOCUMENT, token, "null")), 403);
        assertRefused(guard.check(request("GET", DOCUMENT, token, "http://crm.example.com")), 403);
    }

    @Test
    void aPanelsTokenIsNeverTakenFromAUrlOrAForm() {
        PanelTokenGuard.Request query = new PanelTokenGuard.Request("GET", DOCUMENT, "/nuxeo/" + DOCUMENT, null, token,
                null, ORIGIN, false);
        assertRefused(guard.check(query), 401);
        PanelTokenGuard.Request form = new PanelTokenGuard.Request("POST", "api/v1/automation/Document.Delete",
                "/nuxeo/api/v1/automation/Document.Delete", null, null, token, ORIGIN, false);
        assertRefused(guard.check(form), 401);
        // Even beside a good header.
        PanelTokenGuard.Request both = new PanelTokenGuard.Request("GET", DOCUMENT, "/nuxeo/" + DOCUMENT,
                "Bearer " + token, token, null, ORIGIN, false);
        assertRefused(guard.check(both), 401);
    }

    @Test
    void aTokenIsHeldToTheRestApiAndToAPlainAddress() {
        assertRefused(check("GET", "site/automation/Document.Fetch"), 403);
        assertRefused(check("GET", "nxfile/default/x/file:content"), 403);
        assertRefused(check("GET", "agentic-ui-apps/payers/home.json"), 403);

        for (String raw : List.of("/nuxeo/api/v1/automation/Document.Delete;/../Connector.Read",
                "/nuxeo/api/v1/id/x/%2e%2e/y", "/nuxeo/api/v1/id/x%2Fy", "/nuxeo/api/v1//id/x",
                "/nuxeo/api/v1/id/./x", "/nuxeo/api/v1/id/x/..", "/nuxeo/api/v1/id\\x", "/nuxeo/api/v1/id/x%25")) {
            PanelTokenGuard.Request request = new PanelTokenGuard.Request("GET", DOCUMENT, raw, "Bearer " + token, null,
                    null, ORIGIN, false);
            assertRefused(guard.check(request), 403);
        }
        PanelTokenGuard.Request override = new PanelTokenGuard.Request("POST", "api/v1/automation/Connector.Read",
                "/nuxeo/api/v1/automation/Connector.Read", "Bearer " + token, null, null, ORIGIN, true);
        assertRefused(guard.check(override), 403);
    }
}
