package org.nuxeo.agentic.embedded;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Instant;
import java.util.Date;

import org.junit.jupiter.api.Test;

import com.auth0.jwt.JWTCreator;
import com.auth0.jwt.algorithms.Algorithm;

/** Each check of a host's assertion, one at a time, on an assertion that passes every other. */
class AssertionVerifierTest {

    private static final Host HOST = Fixtures.host();

    private static final Algorithm KEY = AssertionVerifier.algorithm(Host.Algorithm.HS256, Fixtures.HMAC_KEY);

    private static String reason(String token, Instant now) {
        return assertThrows(AssertionVerifier.AssertionException.class,
                () -> AssertionVerifier.verify(token, HOST, KEY, Fixtures.AUDIENCE, now)).getMessage();
    }

    private static String reason(JWTCreator.Builder builder) {
        return reason(Fixtures.hs256(builder), Fixtures.NOW);
    }

    private static JWTCreator.Builder base() {
        return Fixtures.assertion("crm-user-17", "a-1");
    }

    @Test
    void aValidAssertionGivesItsSubjectIdAndEnd() throws Exception {
        AssertionVerifier.Assertion assertion = AssertionVerifier.verify(Fixtures.hs256(base()), HOST, KEY,
                Fixtures.AUDIENCE, Fixtures.NOW);
        assertEquals("crm-user-17", assertion.subject());
        assertEquals("a-1", assertion.id());
        assertEquals(Fixtures.NOW.plusSeconds(110), assertion.expiresAt());
    }

    @Test
    void itsTimeIsCheckedAgainstTheServersClockWithASkewOf30Seconds() throws Exception {
        String token = Fixtures.hs256(base());
        // 110 s left, plus 30 s of skew: valid at 139 s, refused at 140 s.
        AssertionVerifier.verify(token, HOST, KEY, Fixtures.AUDIENCE, Fixtures.NOW.plusSeconds(139));
        assertEquals("expired", reason(token, Fixtures.NOW.plusSeconds(140)));

        assertEquals("lifetime", reason(base().withIssuedAt(Date.from(Fixtures.NOW.plusSeconds(31)))
                                              .withExpiresAt(Date.from(Fixtures.NOW.plusSeconds(60)))));
        assertEquals("not-yet-valid", reason(base().withNotBefore(Date.from(Fixtures.NOW.plusSeconds(31)))));
    }

    @Test
    void anAssertionThatLivesLongerThanFiveMinutesIsRefused() {
        assertEquals("lifetime", reason(base().withIssuedAt(Date.from(Fixtures.NOW.minusSeconds(10)))
                                              .withExpiresAt(Date.from(Fixtures.NOW.plusSeconds(291)))));
        assertEquals("lifetime", reason(base().withIssuedAt(Date.from(Fixtures.NOW))
                                              .withExpiresAt(Date.from(Fixtures.NOW))));
    }

    @Test
    void everyClaimIsRequired() {
        assertEquals("subject", reason(Fixtures.assertion(null, "a-1")));
        assertEquals("subject", reason(Fixtures.assertion("has space", "a-1")));
        assertEquals("jti", reason(Fixtures.assertion("crm-user-17", null)));
        assertEquals("issuer", reason(base().withIssuer(null)));
        assertEquals("audience", reason(base().withAudience((String[]) null)));
        assertEquals("lifetime", reason(base().withExpiresAt(null)));
        assertEquals("lifetime", reason(base().withIssuedAt(null)));
    }

    @Test
    void theAudienceMayBeOneOfSeveral() throws Exception {
        AssertionVerifier.verify(Fixtures.hs256(base().withAudience("https://other.example", Fixtures.AUDIENCE)),
                HOST, KEY, Fixtures.AUDIENCE, Fixtures.NOW);
        assertEquals("audience", reason(base().withAudience("https://other.example")));
    }

    @Test
    void aMalformedAssertionIsRefused() {
        assertEquals("malformed", reason("not.a.jwt", Fixtures.NOW));
        assertEquals("malformed", reason("", Fixtures.NOW));
        assertEquals("malformed", reason("a".repeat(AssertionVerifier.MAX_LENGTH + 1), Fixtures.NOW));
    }

    @Test
    void theKeyIsHeldToItsAlgorithm() {
        assertThrows(IllegalArgumentException.class, () -> AssertionVerifier.algorithm(Host.Algorithm.HS256, null));
        assertThrows(IllegalArgumentException.class,
                () -> AssertionVerifier.algorithm(Host.Algorithm.HS256, "only-thirty-one-bytes-long-key!"));
        assertThrows(IllegalArgumentException.class,
                () -> AssertionVerifier.algorithm(Host.Algorithm.RS256, Fixtures.HMAC_KEY));
        assertThrows(IllegalArgumentException.class,
                () -> AssertionVerifier.algorithm(Host.Algorithm.RS256, Fixtures.publicKey(Fixtures.keyPair("RSA", 1024))));
        assertThrows(IllegalArgumentException.class,
                () -> AssertionVerifier.algorithm(Host.Algorithm.ES256, Fixtures.publicKey(Fixtures.RSA)));
        assertThrows(IllegalArgumentException.class,
                () -> AssertionVerifier.algorithm(Host.Algorithm.RS256, Fixtures.publicKey(Fixtures.EC)));
        // A PEM, with its armour and newlines, as nuxeo.conf may hold it with literal \n.
        AssertionVerifier.algorithm(Host.Algorithm.RS256, Fixtures.pem(Fixtures.RSA).replace("\n", "\\n"));
    }
}
