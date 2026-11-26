package org.nuxeo.agentic.embedded;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Collection;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.exceptions.JWTDecodeException;
import com.auth0.jwt.exceptions.SignatureVerificationException;
import com.auth0.jwt.interfaces.DecodedJWT;

/**
 * A panel's token: a JSON Web Token signed with the add-on's own key, HS256, from
 * {@link EmbeddedSettings#tokenKey()}, and verified with it again.
 *
 * <b>Not the platform's JWT service, and not its {@code nuxeo.jwt.secret}.</b> Whatever that service
 * signs, the platform accepts in more places than the REST API: its JWT authenticator, on any path a
 * token's audience allows, and its OAuth 2.0 provider's JWT bearer grant
 * ({@code urn:ietf:params:oauth:grant-type:jwt-bearer} at {@code /oauth2/token}), which exchanges such
 * a token for one of the provider's own access tokens, with no scope and a refresh token. A key that
 * nothing else of the platform verifies keeps a panel's token to the one authenticator that knows it,
 * {@link PanelTokenAuthenticator}, which the REST API's chain alone holds.
 *
 * <p>
 * Its claims: {@code iss}, {@value #ISSUER}; {@code sub}, the user; {@code aud}, the server's
 * audience; {@code iat} and {@code exp}, from one instant and the host's lifetime; {@code jti};
 * {@link TokenCodec#HOST} and {@link TokenCodec#SCOPE}. The signature is the platform's library's,
 * through what its two versions share; the claims are checked here, against the clock given.
 */
public final class PanelTokenCodec implements TokenCodec {

    /** What every panel's token names as its issuer. */
    public static final String ISSUER = "nuxeo-agentic-embedded";

    private static final String ALGORITHM = "HS256";

    /** The platform's own JWT key, which the panel's must never be. */
    static final String PLATFORM_JWT_SECRET = "nuxeo.jwt.secret";

    private final EmbeddedSettings settings;

    private final Clock clock;

    private final Supplier<Collection<Host>> hosts;

    /**
     * @param hosts the registered hosts: a key one of them signs its HS256 assertions with is no
     *            panel's key, or that host could sign a token for anyone
     */
    public PanelTokenCodec(EmbeddedSettings settings, Clock clock, Supplier<Collection<Host>> hosts) {
        this.settings = settings;
        this.clock = clock;
        this.hosts = hosts;
    }

    @Override
    public String issue(Grant grant) {
        Algorithm algorithm = algorithm();
        String audience = settings.audience();
        if (algorithm == null || audience == null) {
            throw new TokenException("no usable token key or no audience is set: set " + EmbeddedSettings.TOKEN_SECRET
                    + ", at least " + AssertionVerifier.MIN_HMAC_KEY_BYTES + " bytes of its own, not "
                    + PLATFORM_JWT_SECRET + "'s value nor a host's assertion key, and " + EmbeddedSettings.AUDIENCE
                    + " or nuxeo.url", null);
        }
        return JWT.create()
                  .withIssuer(ISSUER)
                  .withSubject(grant.username())
                  .withAudience(audience)
                  .withIssuedAt(Date.from(grant.issuedAt()))
                  .withExpiresAt(Date.from(grant.expiresAt()))
                  .withJWTId(grant.id())
                  .withClaim(HOST, grant.host())
                  .withClaim(SCOPE, grant.scope())
                  .sign(algorithm);
    }

    @Override
    public Map<String, Object> verify(String token) {
        Algorithm algorithm = algorithm();
        String audience = settings.audience();
        if (algorithm == null || audience == null || token == null || token.length() > AssertionVerifier.MAX_LENGTH) {
            return null;
        }
        DecodedJWT jwt;
        try {
            jwt = JWT.decode(token);
            if (!ALGORITHM.equals(jwt.getAlgorithm())) {
                return null;
            }
            algorithm.verify(jwt);
        } catch (JWTDecodeException | SignatureVerificationException | IllegalArgumentException e) {
            return null;
        }
        List<String> audiences = jwt.getAudience();
        Date expiresAt = jwt.getExpiresAt();
        Date issuedAt = jwt.getIssuedAt();
        String subject = jwt.getSubject();
        if (!ISSUER.equals(jwt.getIssuer()) || audiences == null || !audiences.contains(audience)
                || expiresAt == null || issuedAt == null || subject == null
                || !clock.instant().isBefore(expiresAt.toInstant())) {
            return null;
        }
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("sub", subject);
        claims.put("iat", issuedAt.toInstant().getEpochSecond());
        claims.put("exp", expiresAt.toInstant().getEpochSecond());
        claims.put("jti", jwt.getId());
        claims.put(HOST, jwt.getClaim(HOST).asString());
        claims.put(SCOPE, jwt.getClaim(SCOPE).asString());
        return claims;
    }

    /**
     * The key's algorithm, or {@code null}, which issues and verifies nothing: for no key, a short
     * one, or one another holder has. The platform's {@code nuxeo.jwt.secret} signs tokens its JWT
     * authenticator and its OAuth 2.0 provider take; a host's HS256 assertion key is the host's too.
     */
    private Algorithm algorithm() {
        String key = settings.tokenKey();
        if (key == null || key.getBytes(StandardCharsets.UTF_8).length < AssertionVerifier.MIN_HMAC_KEY_BYTES
                || key.equals(settings.property(PLATFORM_JWT_SECRET))) {
            return null;
        }
        for (Host host : hosts.get()) {
            if (host.algorithm() == Host.Algorithm.HS256 && key.equals(settings.assertionKey(host))) {
                return null;
            }
        }
        return Algorithm.HMAC256(key.getBytes(StandardCharsets.UTF_8));
    }
}
