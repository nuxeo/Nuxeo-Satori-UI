package org.nuxeo.agentic.embedded;

import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Pattern;

import com.auth0.jwt.JWT;
import com.auth0.jwt.interfaces.DecodedJWT;

/**
 * What the server does with a request that carries a panel's token, before the REST API sees it: the
 * rule {@link PanelTokenFilter} applies. Any token whose claims, read without checking them, name a
 * host ({@link TokenCodec#HOST}) is held to it, whether or not its signature is good, so that one
 * that claims to be a panel's and fails a check is refused here rather than left to another plugin.
 *
 * <ol>
 * <li><b>Never in a URL or a form.</b> A panel's token as an {@code access_token} parameter, which
 * the platform's JWT authenticator would also read, is refused, 401.</li>
 * <li><b>A good token:</b> signed by this server and not expired ({@link TokenCodec#verify}), of a
 * host still registered and enabled, so that removing a host ends its tokens at once, and living no
 * longer than the host allows; else 401.</li>
 * <li><b>From the host's pages:</b> a request with an {@code Origin} must name one of the host's
 * origins; else 403. A browser always sends it on a request from another origin; any other client
 * may leave it out, so this binds a token to its host's pages in a browser, and is not a control
 * against someone who holds the token.</li>
 * <li><b>On the REST API only:</b> a path below {@code api/v1/}, as the request names it and as the
 * server forwards it to {@code site/api/v1/}; with no {@code ;}, encoded dot, slash, backslash or
 * percent, doubled slash or dot segment in the address as sent, so that the path checked is the path
 * served; and no method override header. Else 403.</li>
 * <li><b>In its scope</b> ({@link PanelScope}); else 403.</li>
 * </ol>
 */
public final class PanelTokenGuard {

    /** What a request to the REST API is, as the guard reads it. */
    public record Request(String method, String path, String rawUri, String authorization, String queryToken,
            String formToken, String origin, boolean methodOverride) {
    }

    /**
     * What the guard decides: pass it on, as a request that carries no panel's token or one in its
     * scope; or refuse it, with the status and a reason for the log.
     */
    public record Decision(int status, String reason) {

        static final Decision PASS = new Decision(0, null);

        public boolean passes() {
            return status == 0;
        }
    }

    static final String BEARER = "Bearer ";

    /** What, in the address as sent, could make the path served differ from the path checked. */
    static final Pattern UNSAFE_URI = Pattern.compile(
            "[;\\\\]|%(2[eEfF5]|5[cC]|3[bB])|//|/\\.\\.?(/|$)");

    /** How much later than its lifetime says a token's end may be, for a clock that moved. */
    static final int SKEW_SECONDS = 5;

    private final Function<String, Host> hosts;

    private final TokenCodec tokens;

    private final Clock clock;

    public PanelTokenGuard(Function<String, Host> hosts, TokenCodec tokens, Clock clock) {
        this.hosts = hosts;
        this.tokens = tokens;
        this.clock = clock;
    }

    public Decision check(Request request) {
        if (claimsAHost(request.queryToken()) || claimsAHost(request.formToken())) {
            return new Decision(401, "a panel's token in a URL or a form");
        }
        String bearer = bearer(request.authorization());
        if (!claimsAHost(bearer)) {
            return Decision.PASS;
        }
        Map<String, Object> claims = tokens.verify(bearer);
        if (claims == null) {
            return new Decision(401, "a panel's token that is not valid, or has expired");
        }
        Object hostId = claims.get(TokenCodec.HOST);
        Host host = hostId instanceof String id && Host.ID.matcher(id).matches() ? hosts.apply(id) : null;
        if (host == null) {
            return new Decision(401, "a panel's token of a host that is not registered");
        }
        Long expiresAt = seconds(claims.get("exp"));
        Long issuedAt = seconds(claims.get("iat"));
        long now = clock.instant().getEpochSecond();
        if (expiresAt == null || issuedAt == null || expiresAt <= now
                || expiresAt - issuedAt > host.tokenLifetime() + SKEW_SECONDS) {
            return new Decision(401, "a panel's token that outlives its host's lifetime");
        }
        if (request.origin() != null && !host.origins().contains(request.origin())) {
            return new Decision(403, "a panel's token from an origin its host does not name");
        }
        String path = restPath(request.path());
        if (path == null) {
            return new Decision(403, "a panel's token outside the REST API");
        }
        if (request.rawUri() == null || UNSAFE_URI.matcher(request.rawUri()).find()) {
            return new Decision(403, "a panel's token on an address that is not plain");
        }
        if (request.methodOverride()) {
            return new Decision(403, "a panel's token with a method override");
        }
        Object scope = claims.get(TokenCodec.SCOPE);
        if (!PanelScope.allows(request.method(), path, scope instanceof String s ? s : Host.READ,
                host.operations())) {
            return new Decision(403, "a panel's token outside its scope");
        }
        return Decision.PASS;
    }

    /** The token of an {@code Authorization: Bearer} header, as the platform's JWT authenticator reads it. */
    static String bearer(String authorization) {
        if (authorization == null || !authorization.startsWith(BEARER)) {
            return null;
        }
        String token = authorization.substring(BEARER.length()).trim();
        return token.isEmpty() ? null : token;
    }

    /** Whether a token's claims, unchecked, name a host: whether it claims to be a panel's. */
    static boolean claimsAHost(String token) {
        if (token == null || token.isEmpty()) {
            return false;
        }
        try {
            DecodedJWT jwt = JWT.decode(token.trim());
            // Whatever its type: only the server signs one, and it is then held to every check.
            return jwt.getClaims().containsKey(TokenCodec.HOST);
        } catch (RuntimeException e) {
            return false;
        }
    }

    /**
     * The path below {@code api/v1/}: of {@code api/v1/...}, as the request names it, or
     * {@code site/api/v1/...}, as the server forwards it; {@code null} for any other.
     */
    static String restPath(String path) {
        if (path == null) {
            return null;
        }
        String relative = path.startsWith("/") ? path.substring(1) : path;
        for (String prefix : new String[] { "site/api/v1/", "api/v1/" }) {
            if (relative.startsWith(prefix)) {
                return relative.substring(prefix.length());
            }
        }
        return null;
    }

    private static Long seconds(Object value) {
        if (value instanceof Number number) {
            return number.longValue();
        }
        if (value instanceof java.util.Date date) {
            return date.toInstant().getEpochSecond();
        }
        if (value instanceof Instant instant) {
            return instant.getEpochSecond();
        }
        return null;
    }
}
