package org.nuxeo.agentic.embedded;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.interfaces.ECPublicKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.List;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.exceptions.JWTDecodeException;
import com.auth0.jwt.exceptions.SignatureVerificationException;
import com.auth0.jwt.interfaces.DecodedJWT;

/**
 * Verifies a host's assertion of a user, a JSON Web Token (RFC 7519) as RFC 7523, section 3, has a
 * client present one: signed with the host's algorithm and key, issued by the host, for this server,
 * for one subject, with an id, and short-lived.
 *
 * The signature is the platform's library's ({@code java-jwt}), and only through what its two
 * versions share: {@link JWT#decode} and {@link Algorithm#verify}. Every claim and time check is
 * here, against the clock given, so that it is the same on both and a test can move the clock.
 */
public final class AssertionVerifier {

    /** An assertion that is not one, or not this host's for this server, now. */
    public static final class AssertionException extends Exception {

        private static final long serialVersionUID = 1L;

        public AssertionException(String reason) {
            super(reason);
        }
    }

    /** What a verified assertion says. */
    public record Assertion(String subject, String id, Instant expiresAt) {
    }

    /** Longer than any assertion a host sends, short enough that a large body is never parsed. */
    static final int MAX_LENGTH = 8192;

    /** How far apart the host's clock and this server's may be. */
    static final Duration SKEW = Duration.ofSeconds(30);

    /** An assertion is for one exchange, now: one that lives longer is refused. */
    static final Duration MAX_LIFETIME = Duration.ofMinutes(5);

    /** An HMAC key shorter than its hash is refused (RFC 7518, section 3.2). */
    static final int MIN_HMAC_KEY_BYTES = 32;

    static final int MIN_RSA_BITS = 2048;

    private AssertionVerifier() {
    }

    /**
     * The platform library's algorithm for a host's key, as the server sets it: the shared secret for
     * HS256, at least 32 bytes; for RS256 and ES256 the public key, X.509 in base64, with or without
     * its PEM armour.
     *
     * @throws IllegalArgumentException when the key is not one for the algorithm; its message names no
     *             part of the key
     */
    public static Algorithm algorithm(Host.Algorithm algorithm, String key) {
        if (key == null) {
            throw new IllegalArgumentException("no key is set");
        }
        switch (algorithm) {
        case HS256: {
            byte[] secret = key.getBytes(StandardCharsets.UTF_8);
            if (secret.length < MIN_HMAC_KEY_BYTES) {
                throw new IllegalArgumentException("an HS256 key must be at least " + MIN_HMAC_KEY_BYTES + " bytes");
            }
            return Algorithm.HMAC256(secret);
        }
        case RS256: {
            PublicKey publicKey = publicKey("RSA", key);
            if (!(publicKey instanceof RSAPublicKey rsa) || rsa.getModulus().bitLength() < MIN_RSA_BITS) {
                throw new IllegalArgumentException("an RS256 key must be an RSA public key of at least "
                        + MIN_RSA_BITS + " bits");
            }
            return Algorithm.RSA256(rsa, null);
        }
        case ES256: {
            PublicKey publicKey = publicKey("EC", key);
            if (!(publicKey instanceof ECPublicKey ec) || ec.getParams().getCurve().getField().getFieldSize() != 256) {
                throw new IllegalArgumentException("an ES256 key must be a P-256 public key");
            }
            return Algorithm.ECDSA256(ec, null);
        }
        default:
            throw new IllegalArgumentException("unknown algorithm");
        }
    }

    private static PublicKey publicKey(String type, String key) {
        String body = key.replaceAll("-----(BEGIN|END) PUBLIC KEY-----", "").replace("\\n", "").replaceAll("\\s",
                "");
        try {
            return KeyFactory.getInstance(type).generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(body)));
        } catch (IllegalArgumentException | java.security.GeneralSecurityException e) {
            throw new IllegalArgumentException("the key is not an X.509 public key in base64");
        }
    }

    /**
     * The assertion's subject, id and end, once every check passes.
     *
     * @param token the assertion, as the host sent it
     * @param host the host that authenticated the request
     * @param algorithm the host's algorithm with its key ({@link #algorithm})
     * @param audience this server's audience ({@link EmbeddedSettings#audience()})
     * @param now this server's time
     * @throws AssertionException naming the first check that failed: what a host may be told, and the
     *             audit records; never the token, nor any of its claims
     */
    public static Assertion verify(String token, Host host, Algorithm algorithm, String audience, Instant now)
            throws AssertionException {
        if (token == null || token.isEmpty() || token.length() > MAX_LENGTH) {
            throw new AssertionException("malformed");
        }
        DecodedJWT jwt;
        try {
            jwt = JWT.decode(token);
        } catch (JWTDecodeException | IllegalArgumentException e) {
            throw new AssertionException("malformed");
        }
        // The header names the algorithm the host is registered with, and no other: never "none", and
        // never an HMAC keyed with a public key.
        if (!host.algorithm().name().equals(jwt.getAlgorithm())) {
            throw new AssertionException("algorithm");
        }
        try {
            algorithm.verify(jwt);
        } catch (SignatureVerificationException | IllegalArgumentException e) {
            // A signature of the wrong length is refused as a wrong one.
            throw new AssertionException("signature");
        }
        if (!host.issuer().equals(jwt.getIssuer())) {
            throw new AssertionException("issuer");
        }
        List<String> audiences = jwt.getAudience();
        if (audience == null || audiences == null || !audiences.contains(audience)) {
            throw new AssertionException("audience");
        }
        String subject = jwt.getSubject();
        if (subject == null || !Host.IDENTIFIER.matcher(subject).matches()) {
            throw new AssertionException("subject");
        }
        String id = jwt.getId();
        if (id == null || !Host.IDENTIFIER.matcher(id).matches()) {
            throw new AssertionException("jti");
        }
        Instant expiresAt = instant(jwt.getExpiresAt());
        Instant issuedAt = instant(jwt.getIssuedAt());
        if (expiresAt == null || issuedAt == null) {
            throw new AssertionException("lifetime");
        }
        if (!now.isBefore(expiresAt.plus(SKEW))) {
            throw new AssertionException("expired");
        }
        if (issuedAt.isAfter(now.plus(SKEW)) || !expiresAt.isAfter(issuedAt)
                || Duration.between(issuedAt, expiresAt).compareTo(MAX_LIFETIME) > 0) {
            throw new AssertionException("lifetime");
        }
        Instant notBefore = instant(jwt.getNotBefore());
        if (notBefore != null && notBefore.isAfter(now.plus(SKEW))) {
            throw new AssertionException("not-yet-valid");
        }
        return new Assertion(subject, id, expiresAt);
    }

    private static Instant instant(Date date) {
        return date == null ? null : date.toInstant();
    }
}
