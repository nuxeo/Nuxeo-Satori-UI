package org.nuxeo.agentic.embedded;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import com.auth0.jwt.JWT;
import com.auth0.jwt.JWTCreator;
import com.auth0.jwt.algorithms.Algorithm;

/**
 * What the tests share: a host as a server registers it, its secrets, assertions signed as a host
 * would sign them, and stand-ins for the platform's users, signer, key-value store and audit. No
 * Nuxeo runtime.
 */
final class Fixtures {

    static final Instant NOW = Instant.parse("2026-11-26T10:00:00Z");

    static final String AUDIENCE = "https://nuxeo.example.com/nuxeo";

    static final String ISSUER = "https://crm.example.com";

    /** Made up for the tests: 43 characters a server may set. */
    static final String CLIENT_SECRET = "test-client-secret-0123456789-abcdefghijklm";

    /** Made up for the tests: the HS256 key the host and the server share. */
    static final String HMAC_KEY = "test-assertion-key-0123456789-abcdefghijklmnop";

    /** Made up for the tests: the add-on's own key, which a panel's token is signed with. */
    static final String TOKEN_SECRET = "test-panel-token-key-0123456789-abcdefghij";

    /** Made up for the tests: the platform's nuxeo.jwt.secret, which a panel's token is never signed with. */
    static final String PLATFORM_SECRET = "test-platform-jwt-secret-0123456789-klmnop";

    static final KeyPair RSA = keyPair("RSA", 2048);

    static final KeyPair EC = ecKeyPair();

    private Fixtures() {
    }

    static KeyPair keyPair(String algorithm, int size) {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance(algorithm);
            generator.initialize(size);
            return generator.generateKeyPair();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static KeyPair ecKeyPair() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(new ECGenParameterSpec("secp256r1"));
            return generator.generateKeyPair();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static String publicKey(KeyPair pair) {
        return Base64.getEncoder().encodeToString(pair.getPublic().getEncoded());
    }

    static String pem(KeyPair pair) {
        return "-----BEGIN PUBLIC KEY-----\n" + Base64.getMimeEncoder().encodeToString(pair.getPublic().getEncoded())
                + "\n-----END PUBLIC KEY-----\n";
    }

    static Clock clock(Instant instant) {
        return Clock.fixed(instant, ZoneOffset.UTC);
    }

    /** The host every test starts from: HS256, one origin, one user by subject, a group, read only. */
    static HostDescriptor descriptor() {
        HostDescriptor descriptor = new HostDescriptor();
        descriptor.id = "crm";
        descriptor.algorithm = "HS256";
        descriptor.issuer = ISSUER;
        descriptor.origins = new ArrayList<>(List.of("https://crm.example.com"));
        descriptor.users = new ArrayList<>(List.of(user("crm-user-17", "jsmith")));
        descriptor.groups = new ArrayList<>(List.of("crm_panel_users"));
        return descriptor;
    }

    static HostDescriptor.UserDescriptor user(String subject, String username) {
        HostDescriptor.UserDescriptor user = new HostDescriptor.UserDescriptor();
        user.subject = subject;
        user.username = username;
        return user;
    }

    static Host host() {
        return Host.of(descriptor());
    }

    /** The server's settings for the host: its secret and key, and the audience. */
    static Map<String, String> properties(Host host) {
        Map<String, String> properties = new HashMap<>();
        properties.put(host.clientSecretProperty(), CLIENT_SECRET);
        properties.put(host.assertionKeyProperty(), HMAC_KEY);
        properties.put(EmbeddedSettings.AUDIENCE, AUDIENCE);
        properties.put(EmbeddedSettings.TOKEN_SECRET, TOKEN_SECRET);
        return properties;
    }

    static EmbeddedSettings settings(Map<String, String> properties) {
        return new EmbeddedSettings(properties::get, name -> null);
    }

    /** An assertion as the host signs it: valid for two minutes from now, unless the test changes it. */
    static JWTCreator.Builder assertion(String subject, String id) {
        return JWT.create()
                  .withIssuer(ISSUER)
                  .withSubject(subject)
                  .withAudience(AUDIENCE)
                  .withIssuedAt(Date.from(NOW.minusSeconds(10)))
                  .withExpiresAt(Date.from(NOW.plusSeconds(110)))
                  .withJWTId(id);
    }

    static String hs256(JWTCreator.Builder builder) {
        return builder.sign(Algorithm.HMAC256(HMAC_KEY));
    }

    static String rs256(JWTCreator.Builder builder, KeyPair pair) {
        return builder.sign(Algorithm.RSA256((RSAPublicKey) pair.getPublic(), (RSAPrivateKey) pair.getPrivate()));
    }

    static String es256(JWTCreator.Builder builder, KeyPair pair) {
        return builder.sign(Algorithm.ECDSA256((ECPublicKey) pair.getPublic(), (ECPrivateKey) pair.getPrivate()));
    }

    /** The form body's parameters of a token exchange, for an assertion. */
    static Map<String, List<String>> exchangeParameters(String assertion) {
        Map<String, List<String>> parameters = new LinkedHashMap<>();
        parameters.put("grant_type", List.of(TokenExchange.GRANT_TYPE));
        parameters.put("subject_token", List.of(assertion));
        parameters.put("subject_token_type", List.of(TokenExchange.JWT_TYPE));
        return parameters;
    }

    /** The platform's key-value store, as the guard uses it: set if absent, until it expires. */
    static final class MemoryReplayGuard implements ReplayGuard {

        final Map<String, Instant> used = new HashMap<>();

        @Override
        public synchronized boolean firstUse(String host, String assertionId, Instant expiresAt, Instant now) {
            String key = KeyValueReplayGuard.key(host, assertionId);
            Instant until = used.get(key);
            if (until != null && now.isBefore(until)) {
                return false;
            }
            used.put(key, expiresAt.plus(AssertionVerifier.SKEW));
            return true;
        }
    }

    /** The server's users. */
    static final class Users implements UserDirectory {

        final Map<String, User> users = new HashMap<>();

        Users with(String username, boolean administrator, boolean special, String... groups) {
            users.put(username, new User(username, administrator, special, new HashSet<>(List.of(groups))));
            return this;
        }

        @Override
        public User find(String username) {
            return users.get(username);
        }

        static Users standard() {
            return new Users().with("jsmith", false, false, "members")
                              .with("mjones", false, false, "crm_panel_users", "members")
                              .with("akhan", false, false, "members")
                              .with("Administrator", true, false, "administrators")
                              .with("ops-admin", true, false, "crm_panel_users")
                              .with("Guest", false, true, "crm_panel_users");
        }
    }


    /**
     * The add-on's own codec, as the server runs it, with the test's key and audience and a clock the
     * test may move; it records each grant issued, and can be made to sign nothing, as a server with
     * no key.
     */
    static final class RecordingCodec implements TokenCodec {

        final List<Grant> issued = new ArrayList<>();

        final Map<String, String> properties;

        Clock clock;

        boolean broken;

        RecordingCodec(Map<String, String> properties, Clock clock) {
            this.properties = properties;
            this.clock = clock;
        }

        /** The hosts the server registers, whose HS256 keys are no panel's key. */
        java.util.function.Supplier<java.util.Collection<Host>> hosts = () -> List.of(host());

        private PanelTokenCodec codec() {
            return new PanelTokenCodec(settings(properties), clock, hosts);
        }

        @Override
        public String issue(Grant grant) {
            if (broken) {
                throw new TokenException("no key", null);
            }
            String token = codec().issue(grant);
            issued.add(grant);
            return token;
        }

        @Override
        public Map<String, Object> verify(String token) {
            return codec().verify(token);
        }

        /** A token signed with the add-on's key, with the claims the test gives, numbers as numeric dates. */
        String sign(Map<String, Object> claims) {
            return signWith(claims, Algorithm.HMAC256(TOKEN_SECRET));
        }
    }

    /** A token with the claims given, signed by `algorithm`: a numeric claim is written as a number. */
    static String signWith(Map<String, Object> claims, Algorithm algorithm) {
        JWTCreator.Builder builder = JWT.create();
        for (Map.Entry<String, Object> each : claims.entrySet()) {
            if (each.getValue() instanceof Long number) {
                builder.withClaim(each.getKey(), number);
            } else {
                builder.withClaim(each.getKey(), String.valueOf(each.getValue()));
            }
        }
        return builder.sign(algorithm);
    }

    /** The claims of a panel's token as the add-on signs one, for the tests to change. */
    static Map<String, Object> panelClaims(String username, Instant issuedAt, int lifetime) {
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("iss", PanelTokenCodec.ISSUER);
        claims.put("sub", username);
        claims.put("aud", AUDIENCE);
        claims.put("iat", issuedAt.getEpochSecond());
        claims.put("exp", issuedAt.getEpochSecond() + lifetime);
        claims.put("jti", "t-1");
        claims.put(TokenCodec.HOST, "crm");
        claims.put(TokenCodec.SCOPE, "read");
        return claims;
    }

    /** The audit, as the exchange writes to it. */
    static final class RecordingAudit implements ExchangeAudit {

        final List<String> entries = new ArrayList<>();

        @Override
        public void issued(String host, String username, String subject, String scope, String tokenId,
                Instant expiresAt) {
            entries.add(ISSUED + " host=" + host + " user=" + username + " subject=" + subject + " scope=" + scope
                    + " token=" + tokenId + " expires=" + expiresAt);
        }

        @Override
        public void refused(String host, String reason) {
            entries.add(REFUSED + " host=" + host + " reason=" + reason);
        }
    }

    /** A fresh id per token. */
    static java.util.function.Supplier<String> ids() {
        AtomicInteger next = new AtomicInteger();
        return () -> "token-" + next.incrementAndGet();
    }

    static Set<String> set(String... values) {
        return new HashSet<>(List.of(values));
    }
}
