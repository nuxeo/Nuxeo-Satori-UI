package org.nuxeo.agentic.embedded;

import java.util.function.UnaryOperator;

/**
 * Where the exchange reads what each server sets: a host's client secret and the key its assertions
 * are verified with, the key the panels' tokens are signed with, from the server's properties
 * ({@code nuxeo.conf}) or the environment, and the server's own audience.
 *
 * These are the only sources. Nothing the exchange checks a request against is read from a
 * contribution, a document or the request. The lookups are taken as functions so that tests run
 * with no Nuxeo runtime and no environment.
 */
public record EmbeddedSettings(UnaryOperator<String> property, UnaryOperator<String> env) {

    /**
     * The audience a host's assertions must name, and that a panel's token names: this server, as the
     * host knows it. Its own setting, else the server's public address, {@code nuxeo.url}.
     */
    public static final String AUDIENCE = "nuxeo.agentic.embedded.audience";

    static final String NUXEO_URL = "nuxeo.url";

    /**
     * The key a panel's token is signed with, the add-on's own and no other setting's: at least 32
     * bytes, the same on every node of a cluster. Never the platform's {@code nuxeo.jwt.secret}
     * ({@link PanelTokenCodec}).
     */
    public static final String TOKEN_SECRET = "nuxeo.agentic.embedded.tokenSecret";

    static final String TOKEN_SECRET_ENV = "NUXEO_EMBEDDED_TOKEN_SECRET";

    /** The audience, or {@code null} when the server sets neither. */
    public String audience() {
        String own = property(AUDIENCE);
        return own != null ? own : property(NUXEO_URL);
    }

    /** The key a panel's token is signed with, from the server's property first, or {@code null}. */
    public String tokenKey() {
        String value = property(TOKEN_SECRET);
        return value != null ? value : env(TOKEN_SECRET_ENV);
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
