package org.nuxeo.agentic.embedded;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.exceptions.SignatureVerificationException;
import com.auth0.jwt.interfaces.DecodedJWT;

/**
 * The token exchange, end to end but for the platform: a host's server authenticates, presents its
 * user's assertion, and gets a token for that user, or a refusal as RFC 6749, section 5.2, words it.
 */
class TokenExchangeTest {

    private HostDescriptor descriptor;

    private Map<String, String> properties;

    private Fixtures.MemoryReplayGuard replays;

    private Fixtures.Users users;

    private Fixtures.RecordingCodec tokens;

    private Fixtures.RecordingAudit audit;

    private Clock clock;

    @BeforeEach
    void setUp() {
        descriptor = Fixtures.descriptor();
        properties = Fixtures.properties(Fixtures.host());
        replays = new Fixtures.MemoryReplayGuard();
        users = Fixtures.Users.standard();
        clock = Fixtures.clock(Fixtures.NOW);
        tokens = new Fixtures.RecordingCodec(properties, clock);
        audit = new Fixtures.RecordingAudit();
    }

    private TokenExchange exchange() {
        Host host = Host.of(descriptor);
        return new TokenExchange(id -> host.id().equals(id) ? host : null, Fixtures.settings(properties), replays,
                users, tokens, audit, clock, Fixtures.ids());
    }

    private TokenExchange.Result exchange(String assertion) {
        return exchange().exchange("crm", Fixtures.CLIENT_SECRET, Fixtures.exchangeParameters(assertion));
    }

    private static String valid(String subject, String id) {
        return Fixtures.hs256(Fixtures.assertion(subject, id));
    }

    private static void assertRefused(TokenExchange.Result result, int status, String error) {
        assertEquals(status, result.status(), () -> "the answer: " + result.body());
        assertEquals(error, result.body().get("error"));
        assertFalse(result.body().containsKey("access_token"));
    }

    @Test
    void aValidExchangeIssuesAShortLivedTokenForTheMappedUser() {
        TokenExchange.Result result = exchange(valid("crm-user-17", "a-1"));

        assertTrue(result.issued(), () -> "the answer: " + result.body());
        assertEquals("Bearer", result.body().get("token_type"));
        assertEquals(TokenExchange.ACCESS_TOKEN_TYPE, result.body().get("issued_token_type"));
        assertEquals(300, result.body().get("expires_in"));
        assertEquals("read", result.body().get("scope"));
        String token = (String) result.body().get("access_token");
        assertNotNull(token);

        // What the panel's authenticator reads: the user, this server, the host and the scope.
        DecodedJWT jwt = JWT.decode(token);
        assertEquals("jsmith", jwt.getSubject());
        assertEquals(PanelTokenCodec.ISSUER, jwt.getIssuer());
        assertEquals(List.of(Fixtures.AUDIENCE), jwt.getAudience());
        assertEquals("crm", jwt.getClaim(TokenCodec.HOST).asString());
        assertEquals("read", jwt.getClaim(TokenCodec.SCOPE).asString());
        assertEquals(Fixtures.NOW.getEpochSecond() + 300, jwt.getClaim("exp").asLong());
        assertEquals(Fixtures.NOW.getEpochSecond(), jwt.getClaim("iat").asLong());
        // The add-on's own key signs it: not the host's, and not the platform's nuxeo.jwt.secret, so that
        // neither the platform's JWT authenticator nor its OAuth 2.0 JWT bearer grant can verify it.
        Algorithm.HMAC256(Fixtures.TOKEN_SECRET).verify(jwt);
        assertEquals("HS256", jwt.getAlgorithm());
        assertThrows(SignatureVerificationException.class,
                () -> Algorithm.HMAC256(Fixtures.PLATFORM_SECRET).verify(jwt));
        assertThrows(SignatureVerificationException.class, () -> Algorithm.HMAC256(Fixtures.HMAC_KEY).verify(jwt));

        assertEquals(List.of(ExchangeAudit.ISSUED + " host=crm user=jsmith subject=crm-user-17 scope=read "
                + "token=token-1 expires=2026-11-26T10:05:00Z"), audit.entries);
    }

    @Test
    void theTokenLivesAsLongAsTheHostAllows() {
        descriptor.tokenLifetime = "60";
        TokenExchange.Result result = exchange(valid("crm-user-17", "a-1"));

        assertEquals(60, result.body().get("expires_in"));
        DecodedJWT jwt = JWT.decode((String) result.body().get("access_token"));
        assertEquals(Fixtures.NOW.getEpochSecond() + 60, jwt.getClaim("exp").asLong());
    }

    @Test
    void anRs256AndAnEs256HostAreVerifiedWithTheirPublicKeys() {
        descriptor.algorithm = "RS256";
        properties.put(Fixtures.host().assertionKeyProperty(), Fixtures.pem(Fixtures.RSA));
        assertTrue(exchange(Fixtures.rs256(Fixtures.assertion("crm-user-17", "r-1"), Fixtures.RSA)).issued());

        descriptor.algorithm = "ES256";
        properties.put(Fixtures.host().assertionKeyProperty(), Fixtures.publicKey(Fixtures.EC));
        assertTrue(exchange(Fixtures.es256(Fixtures.assertion("crm-user-17", "e-1"), Fixtures.EC)).issued());
    }

    // The host.

    @Test
    void anUnknownHostIsRefusedAsAWrongSecretIs() {
        TokenExchange.Result unknown = exchange().exchange("erp", Fixtures.CLIENT_SECRET,
                Fixtures.exchangeParameters(valid("crm-user-17", "a-1")));
        assertRefused(unknown, 401, "invalid_client");

        TokenExchange.Result wrong = exchange().exchange("crm", Fixtures.CLIENT_SECRET + "x",
                Fixtures.exchangeParameters(valid("crm-user-17", "a-2")));
        assertRefused(wrong, 401, "invalid_client");
        assertEquals(unknown.body(), wrong.body(), "an unknown host learns nothing a wrong secret does not");

        TokenExchange.Result none = exchange().exchange(null, null,
                Fixtures.exchangeParameters(valid("crm-user-17", "a-3")));
        assertRefused(none, 401, "invalid_client");

        // The wrong secret is audited against the registered host; the unknown host is not audited.
        assertEquals(List.of(ExchangeAudit.REFUSED + " host=crm reason=invalid_client"), audit.entries);
        assertTrue(tokens.issued.isEmpty());
    }

    @Test
    void aHostWithNoUsableSecretIsRefused() {
        properties.remove(Fixtures.host().clientSecretProperty());
        assertRefused(exchange(valid("crm-user-17", "a-1")), 401, "invalid_client");

        properties.put(Fixtures.host().clientSecretProperty(), "short");
        TokenExchange.Result result = exchange().exchange("crm", "short",
                Fixtures.exchangeParameters(valid("crm-user-17", "a-2")));
        assertRefused(result, 401, "invalid_client");
    }

    @Test
    void theSecretMayComeFromTheEnvironment() {
        Host host = Fixtures.host();
        properties.remove(host.clientSecretProperty());
        properties.remove(host.assertionKeyProperty());
        Map<String, String> env = Map.of("NUXEO_EMBEDDED_CRM_CLIENT_SECRET", Fixtures.CLIENT_SECRET,
                "NUXEO_EMBEDDED_CRM_ASSERTION_KEY", Fixtures.HMAC_KEY);
        TokenExchange exchange = new TokenExchange(id -> host, new EmbeddedSettings(properties::get, env::get),
                replays, users, tokens, audit, clock, Fixtures.ids());
        assertTrue(exchange.exchange("crm", Fixtures.CLIENT_SECRET,
                Fixtures.exchangeParameters(valid("crm-user-17", "a-1"))).issued());
    }

    // The assertion.

    @Test
    void anExpiredAssertionIsRefused() {
        String assertion = Fixtures.hs256(Fixtures.assertion("crm-user-17", "a-1")
                                                  .withIssuedAt(java.util.Date.from(Fixtures.NOW.minusSeconds(300)))
                                                  .withExpiresAt(java.util.Date.from(Fixtures.NOW.minusSeconds(31))));
        TokenExchange.Result result = exchange(assertion);
        assertRefused(result, 400, "invalid_grant");
        assertEquals("the assertion is refused: expired", result.body().get("error_description"));
        assertEquals(List.of(ExchangeAudit.REFUSED + " host=crm reason=assertion-expired"), audit.entries);
    }

    @Test
    void aReplayedAssertionIsRefused() {
        String assertion = valid("crm-user-17", "a-1");
        assertTrue(exchange(assertion).issued());

        TokenExchange.Result again = exchange(assertion);
        assertRefused(again, 400, "invalid_grant");
        assertEquals("the assertion has been used", again.body().get("error_description"));
        assertEquals(1, tokens.issued.size());

        // A fresh id is a fresh assertion.
        assertTrue(exchange(valid("crm-user-17", "a-2")).issued());
    }

    @Test
    void aWronglySignedAssertionIsRefused() {
        String otherKey = Fixtures.assertion("crm-user-17", "a-1")
                                  .sign(Algorithm.HMAC256("another-key-of-thirty-two-bytes-or-more!!"));
        assertRefused(exchange(otherKey), 400, "invalid_grant");

        // The right key, a claim changed after signing.
        String[] parts = valid("crm-user-17", "a-2").split("\\.");
        String other = valid("Administrator", "a-2").split("\\.")[1];
        assertRefused(exchange(parts[0] + "." + other + "." + parts[2]), 400, "invalid_grant");

        // No signature at all.
        String unsigned = Fixtures.assertion("crm-user-17", "a-3").sign(Algorithm.none());
        assertRefused(exchange(unsigned), 400, "invalid_grant");

        // An RS256 host given an HMAC keyed with its own public key.
        descriptor.algorithm = "RS256";
        String publicKey = Fixtures.publicKey(Fixtures.RSA);
        properties.put(Fixtures.host().assertionKeyProperty(), publicKey);
        String confused = Fixtures.assertion("crm-user-17", "a-4").sign(Algorithm.HMAC256(publicKey));
        assertRefused(exchange(confused), 400, "invalid_grant");

        assertTrue(tokens.issued.isEmpty());
        assertEquals(List.of(ExchangeAudit.REFUSED + " host=crm reason=assertion-signature",
                ExchangeAudit.REFUSED + " host=crm reason=assertion-signature",
                ExchangeAudit.REFUSED + " host=crm reason=assertion-algorithm",
                ExchangeAudit.REFUSED + " host=crm reason=assertion-algorithm"), audit.entries);
    }

    @Test
    void anAssertionForAnotherAudienceIsRefused() {
        String assertion = Fixtures.hs256(
                Fixtures.assertion("crm-user-17", "a-1").withAudience("https://other-nuxeo.example.com/nuxeo"));
        TokenExchange.Result result = exchange(assertion);
        assertRefused(result, 400, "invalid_grant");
        assertEquals("the assertion is refused: audience", result.body().get("error_description"));
    }

    @Test
    void theServersAudienceDefaultsToItsAddress() {
        properties.remove(EmbeddedSettings.AUDIENCE);
        properties.put("nuxeo.url", Fixtures.AUDIENCE);
        assertTrue(exchange(valid("crm-user-17", "a-1")).issued());

        properties.remove("nuxeo.url");
        TokenExchange.Result result = exchange(valid("crm-user-17", "a-2"));
        assertRefused(result, 503, "server_error");
    }

    @Test
    void anAssertionOfAnotherIssuerIsRefused() {
        String assertion = Fixtures.hs256(Fixtures.assertion("crm-user-17", "a-1").withIssuer("https://erp.example"));
        assertRefused(exchange(assertion), 400, "invalid_grant");
    }

    // The request.

    @Test
    void theRequestIsHeldToRfc8693() {
        String assertion = valid("crm-user-17", "a-1");

        Map<String, List<String>> grant = Fixtures.exchangeParameters(assertion);
        grant.put("grant_type", List.of("client_credentials"));
        assertRefused(exchange().exchange("crm", Fixtures.CLIENT_SECRET, grant), 400, "unsupported_grant_type");

        Map<String, List<String>> type = Fixtures.exchangeParameters(assertion);
        type.put("subject_token_type", List.of(TokenExchange.ACCESS_TOKEN_TYPE));
        assertRefused(exchange().exchange("crm", Fixtures.CLIENT_SECRET, type), 400, "invalid_request");

        Map<String, List<String>> twice = Fixtures.exchangeParameters(assertion);
        twice.put("subject_token", List.of(assertion, valid("Administrator", "a-9")));
        assertRefused(exchange().exchange("crm", Fixtures.CLIENT_SECRET, twice), 400, "invalid_request");

        Map<String, List<String>> actor = Fixtures.exchangeParameters(assertion);
        actor.put("actor_token", List.of(assertion));
        assertRefused(exchange().exchange("crm", Fixtures.CLIENT_SECRET, actor), 400, "invalid_request");

        Map<String, List<String>> requested = Fixtures.exchangeParameters(assertion);
        requested.put("requested_token_type", List.of("urn:ietf:params:oauth:token-type:refresh_token"));
        assertRefused(exchange().exchange("crm", Fixtures.CLIENT_SECRET, requested), 400, "invalid_request");

        Map<String, List<String>> target = Fixtures.exchangeParameters(assertion);
        target.put("audience", List.of("https://elsewhere.example.com"));
        assertRefused(exchange().exchange("crm", Fixtures.CLIENT_SECRET, target), 400, "invalid_target");

        Map<String, List<String>> ours = Fixtures.exchangeParameters(assertion);
        ours.put("audience", List.of(Fixtures.AUDIENCE));
        ours.put("requested_token_type", List.of(TokenExchange.ACCESS_TOKEN_TYPE));
        assertTrue(exchange().exchange("crm", Fixtures.CLIENT_SECRET, ours).issued());
    }

    // The user.

    @Test
    void onlyAUserTheConfigurationMapsIsExchangedFor() {
        // A subject no entry names is a username, of a member of the host's groups only.
        assertTrue(exchange(valid("mjones", "a-1")).issued());
        assertEquals("mjones", tokens.issued.get(0).username());

        TokenExchange.Result notInGroup = exchange(valid("akhan", "a-2"));
        TokenExchange.Result unknown = exchange(valid("nobody", "a-3"));
        TokenExchange.Result special = exchange(valid("Guest", "a-4"));

        descriptor.groups = new ArrayList<>();
        TokenExchange.Result unmapped = exchange(valid("mjones", "a-5"));

        for (TokenExchange.Result result : List.of(notInGroup, unknown, special, unmapped)) {
            assertRefused(result, 400, "invalid_grant");
            // One sentence for every case: a host learns nothing of the server's users.
            assertEquals(notInGroup.body(), result.body());
        }
        assertEquals(List.of(ExchangeAudit.REFUSED + " host=crm reason=not-in-group",
                ExchangeAudit.REFUSED + " host=crm reason=unknown-user",
                ExchangeAudit.REFUSED + " host=crm reason=special-user",
                ExchangeAudit.REFUSED + " host=crm reason=unmapped"), audit.entries.subList(1, 5));
    }

    @Test
    void anAdministratorIsNeverExchangedForUnlessTheHostAllowsIt() {
        descriptor.users = new ArrayList<>(List.of(Fixtures.user("crm-admin", "Administrator")));
        TokenExchange.Result mapped = exchange(valid("crm-admin", "a-1"));
        assertRefused(mapped, 400, "invalid_grant");
        // Through a group too.
        TokenExchange.Result grouped = exchange(valid("ops-admin", "a-2"));
        assertRefused(grouped, 400, "invalid_grant");
        assertEquals(List.of(ExchangeAudit.REFUSED + " host=crm reason=administrator",
                ExchangeAudit.REFUSED + " host=crm reason=administrator"), audit.entries);

        descriptor.allowAdministrators = "true";
        assertTrue(exchange(valid("crm-admin", "a-3")).issued());
        assertEquals("Administrator", tokens.issued.get(0).username());
    }

    // The scope.

    @Test
    void theScopeIsReadUnlessTheHostAllowsWriteAndAsksForIt() {
        Map<String, List<String>> write = Fixtures.exchangeParameters(valid("crm-user-17", "a-1"));
        write.put("scope", List.of("read write"));
        assertRefused(exchange().exchange("crm", Fixtures.CLIENT_SECRET, write), 400, "invalid_scope");

        Map<String, List<String>> unknown = Fixtures.exchangeParameters(valid("crm-user-17", "a-2"));
        unknown.put("scope", List.of("admin"));
        assertRefused(exchange().exchange("crm", Fixtures.CLIENT_SECRET, unknown), 400, "invalid_scope");

        descriptor.scopes = new ArrayList<>(List.of("read", "write"));
        // Allowed, not asked for: read.
        TokenExchange.Result asDefault = exchange(valid("crm-user-17", "a-3"));
        assertEquals("read", asDefault.body().get("scope"));

        Map<String, List<String>> asked = Fixtures.exchangeParameters(valid("crm-user-17", "a-4"));
        asked.put("scope", List.of("write"));
        TokenExchange.Result granted = exchange().exchange("crm", Fixtures.CLIENT_SECRET, asked);
        assertEquals("read write", granted.body().get("scope"));
        assertEquals("read write",
                JWT.decode((String) granted.body().get("access_token")).getClaim(TokenCodec.SCOPE).asString());
    }

    // The signer.

    @Test
    void aServerThatCannotSignIssuesNothing() {
        tokens.broken = true;
        TokenExchange.Result result = exchange(valid("crm-user-17", "a-1"));
        assertRefused(result, 503, "server_error");
        assertEquals(List.of(ExchangeAudit.REFUSED + " host=crm reason=not-configured"), audit.entries);
    }

    @Test
    void aTokenKeyAnotherHolderHasIssuesNothing() {
        // The platform's own JWT key: its JWT authenticator and its OAuth 2.0 provider take what it signs.
        properties.put("nuxeo.jwt.secret", Fixtures.TOKEN_SECRET);
        assertRefused(exchange(valid("crm-user-17", "a-1")), 503, "server_error");
        properties.remove("nuxeo.jwt.secret");
        // A host's HS256 assertion key: that host could sign a token for anyone.
        properties.put(Fixtures.host().assertionKeyProperty(), Fixtures.TOKEN_SECRET);
        String assertion = Fixtures.assertion("crm-user-17", "a-2").sign(Algorithm.HMAC256(Fixtures.TOKEN_SECRET));
        assertRefused(exchange(assertion), 503, "server_error");
        assertTrue(tokens.issued.isEmpty());
    }

    @Test
    void aServerWithNoTokenKeyOrAShortOneIssuesNothing() {
        properties.remove(EmbeddedSettings.TOKEN_SECRET);
        assertRefused(exchange(valid("crm-user-17", "a-1")), 503, "server_error");
        properties.put(EmbeddedSettings.TOKEN_SECRET, "thirty-one-bytes-is-not-enough");
        assertRefused(exchange(valid("crm-user-17", "a-2")), 503, "server_error");
        assertTrue(tokens.issued.isEmpty());
    }

    @Test
    void noAnswerHoldsTheAssertion() {
        String assertion = valid("nobody", "a-1");
        TokenExchange.Result result = exchange(assertion);
        assertFalse(result.body().toString().contains(assertion));
        assertFalse(audit.entries.toString().contains(assertion));
        assertNull(result.body().get("access_token"));
    }
}
