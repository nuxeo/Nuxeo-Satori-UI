package org.nuxeo.agentic.embedded;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.regex.Pattern;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import com.auth0.jwt.algorithms.Algorithm;

/**
 * The token exchange (OAuth 2.0 Token Exchange, RFC 8693): a registered host, authenticated with its
 * client secret (RFC 6749, section 2.3.1), presents its signed assertion of a user, a JSON Web Token
 * (RFC 7523, section 3), and gets a short-lived token for that user, valid on the REST API only, for
 * the scope its configuration allows.
 *
 * In order, each refusal answered as RFC 6749, section 5.2, says, and each one after the host
 * authenticated audited:
 * <ol>
 * <li>the host: registered, enabled, and its secret the one the server sets, compared in constant
 * time; else {@code invalid_client}, 401, the same answer for an unknown host and a wrong secret;</li>
 * <li>the request: each parameter once; the token exchange grant; a JWT subject token; an access token
 * asked for, if any; no actor token; an audience or resource, if any, that is this server; a scope
 * the host may be given;</li>
 * <li>the assertion ({@link AssertionVerifier}): {@code invalid_grant} when it fails a check;</li>
 * <li>its first use ({@link ReplayGuard}): {@code invalid_grant} for a replay;</li>
 * <li>the user: one the host's configuration maps the subject to, who exists, is neither the system
 * user, the anonymous user nor a transient one, is no administrator unless the host allows them, and
 * when mapped through the host's groups, is in one; else {@code invalid_grant}, with one sentence for
 * every case, so that a host learns nothing of the server's users;</li>
 * <li>the token: signed with the add-on's own key ({@link PanelTokenCodec}).</li>
 * </ol>
 * The answer never holds the assertion, and the log and the audit never hold it or the token.
 */
public final class TokenExchange {

    private static final Logger log = LogManager.getLogger(TokenExchange.class);

    public static final String GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";

    public static final String JWT_TYPE = "urn:ietf:params:oauth:token-type:jwt";

    public static final String ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

    /**
     * A client secret the server may set: long, and of characters that form encoding leaves alone, so
     * that a host's Basic credentials read the same encoded or not (RFC 6749, section 2.3.1).
     */
    static final Pattern CLIENT_SECRET = Pattern.compile("[A-Za-z0-9._~-]{32,512}");

    /** An answer: its status and its JSON body. */
    public record Result(int status, Map<String, Object> body) {

        public boolean issued() {
            return status == 200;
        }

        static Result error(int status, String error, String description) {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("error", error);
            body.put("error_description", description);
            return new Result(status, Collections.unmodifiableMap(body));
        }
    }

    private static final String NOT_FOR_THIS_USER = "the assertion's subject is not one this host may exchange";

    private final Function<String, Host> hosts;

    private final EmbeddedSettings settings;

    private final ReplayGuard replays;

    private final UserDirectory users;

    private final TokenCodec tokens;

    private final ExchangeAudit audit;

    private final Clock clock;

    private final Supplier<String> ids;

    public TokenExchange(Function<String, Host> hosts, EmbeddedSettings settings, ReplayGuard replays,
            UserDirectory users, TokenCodec tokens, ExchangeAudit audit, Clock clock, Supplier<String> ids) {
        this.hosts = hosts;
        this.settings = settings;
        this.replays = replays;
        this.users = users;
        this.tokens = tokens;
        this.audit = audit;
        this.clock = clock;
        this.ids = ids;
    }

    /**
     * @param clientId the host's id, from the request's Basic credentials, or {@code null}
     * @param clientSecret its secret, from the same, or {@code null}
     * @param parameters the form body's parameters, each with every value it was given
     */
    public Result exchange(String clientId, String clientSecret, Map<String, List<String>> parameters) {
        // 1. The host.
        Host host = clientId == null || !Host.ID.matcher(clientId).matches() ? null : hosts.apply(clientId);
        if (host == null) {
            log.warn("Embedded panels: a token exchange named {}, which is no registered host",
                    clientId != null && Host.ID.matcher(clientId).matches() ? clientId : "no valid host id");
            return invalidClient();
        }
        String secret = settings.clientSecret(host);
        if (secret == null || !CLIENT_SECRET.matcher(secret).matches()) {
            log.error("Embedded panels: host {} has no usable client secret: set {} or {} to at least 32 letters, "
                    + "digits, dots, underscores, tildes or dashes", host.id(), host.clientSecretProperty(),
                    host.clientSecretEnv());
            audit.refused(host.id(), "not-configured");
            return invalidClient();
        }
        if (clientSecret == null || !sameSecret(clientSecret, secret)) {
            audit.refused(host.id(), "invalid_client");
            return invalidClient();
        }

        // 2. The request.
        for (Map.Entry<String, List<String>> each : parameters.entrySet()) {
            if (each.getValue().size() > 1) {
                return refused(host, 400, "invalid_request", "duplicate",
                        "each parameter is sent once (RFC 6749, section 3.2)");
            }
        }
        if (!GRANT_TYPE.equals(one(parameters, "grant_type"))) {
            return refused(host, 400, "unsupported_grant_type", "grant_type",
                    "the grant type is " + GRANT_TYPE);
        }
        String subjectToken = one(parameters, "subject_token");
        if (subjectToken == null || !JWT_TYPE.equals(one(parameters, "subject_token_type"))) {
            return refused(host, 400, "invalid_request", "subject_token",
                    "subject_token is required, and subject_token_type is " + JWT_TYPE);
        }
        String requested = one(parameters, "requested_token_type");
        if (requested != null && !ACCESS_TOKEN_TYPE.equals(requested)) {
            return refused(host, 400, "invalid_request", "requested_token_type",
                    "the token issued is an access token, " + ACCESS_TOKEN_TYPE);
        }
        if (parameters.containsKey("actor_token") || parameters.containsKey("actor_token_type")) {
            return refused(host, 400, "invalid_request", "actor_token", "delegation is not supported");
        }
        String audience = settings.audience();
        if (audience == null) {
            log.error("Embedded panels: the server sets no audience: set {} or nuxeo.url", EmbeddedSettings.AUDIENCE);
            audit.refused(host.id(), "not-configured");
            return Result.error(503, "server_error", "the server is not set up for token exchange");
        }
        for (String target : List.of("audience", "resource")) {
            String named = one(parameters, target);
            if (named != null && !audience.equals(named)) {
                return refused(host, 400, "invalid_target", "target", "the only audience is this server");
            }
        }
        String scope = host.grantedScope(one(parameters, "scope"));
        if (scope == null) {
            return refused(host, 400, "invalid_scope", "scope", "the scope is not one this host may be given");
        }

        // 3. The assertion.
        Algorithm algorithm;
        try {
            algorithm = AssertionVerifier.algorithm(host.algorithm(), settings.assertionKey(host));
        } catch (IllegalArgumentException e) {
            log.error("Embedded panels: host {} has no usable assertion key in {} or {}: {}", host.id(),
                    host.assertionKeyProperty(), host.assertionKeyEnv(), e.getMessage());
            audit.refused(host.id(), "not-configured");
            return Result.error(503, "server_error", "the server is not set up for this host");
        }
        Instant now = clock.instant();
        AssertionVerifier.Assertion assertion;
        try {
            assertion = AssertionVerifier.verify(subjectToken, host, algorithm, audience, now);
        } catch (AssertionVerifier.AssertionException e) {
            return refused(host, 400, "invalid_grant", "assertion-" + e.getMessage(),
                    "the assertion is refused: " + e.getMessage());
        }

        // 4. Its first use.
        if (!replays.firstUse(host.id(), assertion.id(), assertion.expiresAt(), now)) {
            return refused(host, 400, "invalid_grant", "replayed", "the assertion has been used");
        }

        // 5. The user.
        Mapping mapping = mappingFor(host, assertion.subject());
        UserDirectory.User user = mapping == null ? null : users.find(mapping.username());
        String refusal = refusal(host, mapping, user);
        if (refusal != null) {
            return refused(host, 400, "invalid_grant", refusal, NOT_FOR_THIS_USER);
        }

        // 6. The token.
        TokenCodec.Grant grant = new TokenCodec.Grant(host.id(), user.username(), scope, ids.get(), now,
                host.tokenLifetime());
        String token;
        try {
            token = tokens.issue(grant);
        } catch (TokenCodec.TokenException e) {
            log.error("Embedded panels: no token could be issued for host {}: {}", host.id(), e.getMessage());
            audit.refused(host.id(), "not-configured");
            return Result.error(503, "server_error", "the server is not set up to sign tokens");
        }
        audit.issued(host.id(), user.username(), assertion.subject(), scope, grant.id(), grant.expiresAt());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("access_token", token);
        body.put("issued_token_type", ACCESS_TOKEN_TYPE);
        body.put("token_type", "Bearer");
        body.put("expires_in", host.tokenLifetime());
        body.put("scope", scope);
        return new Result(200, Collections.unmodifiableMap(body));
    }

    /**
     * The Nuxeo user the host's configuration maps a subject to.
     *
     * @param username the user's name
     * @param throughGroups {@code true} when no {@code user} entry names the subject, and the host's
     *            groups are what may let it in: the subject is then the username itself, and the user
     *            must be in one of them
     */
    record Mapping(String username, boolean throughGroups) {
    }

    /**
     * The mapping of a subject: by the host's {@code user} entries first, then, when it names groups,
     * the subject itself as a username; else {@code null}.
     */
    static Mapping mappingFor(Host host, String subject) {
        String mapped = host.users().get(subject);
        if (mapped != null) {
            return new Mapping(mapped, false);
        }
        return host.groups().isEmpty() ? null : new Mapping(subject, true);
    }

    /** Why the exchange may not be for this user, as the audit records it, or {@code null}. */
    static String refusal(Host host, Mapping mapping, UserDirectory.User user) {
        if (mapping == null) {
            return "unmapped";
        }
        if (user == null) {
            return "unknown-user";
        }
        if (user.special()) {
            return "special-user";
        }
        if (user.administrator() && !host.allowAdministrators()) {
            return "administrator";
        }
        if (mapping.throughGroups() && Collections.disjoint(user.groups(), host.groups())) {
            return "not-in-group";
        }
        return null;
    }

    private Result refused(Host host, int status, String error, String reason, String description) {
        audit.refused(host.id(), reason);
        return Result.error(status, error, description);
    }

    private static Result invalidClient() {
        return Result.error(401, "invalid_client", "the client is not authenticated");
    }

    private static String one(Map<String, List<String>> parameters, String name) {
        List<String> values = parameters.get(name);
        return values == null || values.isEmpty() || values.get(0).isEmpty() ? null : values.get(0);
    }

    /** Whether two secrets are the same, in a time that does not depend on where they differ. */
    static boolean sameSecret(String presented, String expected) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] a = digest.digest(presented.getBytes(StandardCharsets.UTF_8));
            byte[] b = digest.digest(expected.getBytes(StandardCharsets.UTF_8));
            return MessageDigest.isEqual(a, b);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
