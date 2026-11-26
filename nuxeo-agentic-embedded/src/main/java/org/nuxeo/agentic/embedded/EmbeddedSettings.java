package org.nuxeo.agentic.embedded;

import java.util.function.UnaryOperator;

/**
 * Where the exchange reads what each server sets: a host's client secret and the key its assertions
 * are verified with, from the server's properties ({@code nuxeo.conf}) or the environment, and the
 * server's own audience.
 *
 * These are the only sources. Nothing the exchange checks a request against is read from a
 * contribution, a document or the request. The lookups are taken as functions so that tests run
 * with no Nuxeo runtime and no environment.
 */
public record EmbeddedSettings(UnaryOperator<String> property, UnaryOperator<String> env) {

    /**
     * The audience a host's assertions must name: this server, as the host knows it. Its own
     * setting, else the server's public address, {@code nuxeo.url}.
     */
    public static final String AUDIENCE = "nuxeo.agentic.embedded.audience";

    static final String NUXEO_URL = "nuxeo.url";

    /**
     * The path prefix, below the context path, that a token is valid on: the platform's JWT
     * authenticator signs a request in with a token only on a path that starts with its {@code aud}.
     * The REST API's {@code /api/v1/} forwards to {@code /site/api/v1/}, where the server
     * authenticates it, so that is the default.
     */
    public static final String TOKEN_PATH = "nuxeo.agentic.embedded.token.path";

    static final String DEFAULT_TOKEN_PATH = "site/api/v1";

    /** The audience, or {@code null} when the server sets neither. */
    public String audience() {
        String own = property(AUDIENCE);
        return own != null ? own : property(NUXEO_URL);
    }

    public String tokenPath() {
        String path = property(TOKEN_PATH);
        return path == null ? DEFAULT_TOKEN_PATH : path.replaceAll("^/+|/+$", "");
    }

    /** The host's client secret, from the server's property first, or {@code null}. */
    public String clientSecret(Host host) {
        String value = property(host.clientSecretProperty());
        return value != null ? value : env(host.clientSecretEnv());
    }

    /** The key the host's assertions are verified with, from the server's property first, or {@code null}. */
    public String assertionKey(Host host) {
        String value = property(host.assertionKeyProperty());
        return value != null ? value : env(host.assertionKeyEnv());
    }

    String property(String name) {
        return blankToNull(property.apply(name));
    }

    String env(String name) {
        return blankToNull(env.apply(name));
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
