package org.nuxeo.agentic.connectors;

import java.util.function.UnaryOperator;

/**
 * Where a connector reads what each server sets: its system's address and its credential, from the
 * server's properties ({@code nuxeo.conf}), and a credential also from the environment.
 *
 * These are the only sources. Nothing a connector sends is read from a document, a layout or a
 * request, apart from the record's key, which is one path segment ({@link SystemOfRecordClient}).
 * The lookups are taken as functions so that tests run with no Nuxeo runtime and no environment.
 */
public record ConnectorSettings(UnaryOperator<String> property, UnaryOperator<String> env) {

    /** The value, or {@code null} for one that is unset or blank. */
    String property(String name) {
        return blankToNull(property.apply(name));
    }

    String env(String name) {
        return blankToNull(env.apply(name));
    }

    /**
     * {@code true} where the server lets this connector call a plain http address, by setting
     * {@code nuxeo.agentic.connectors.<id>.http.allowed=true}. Unset, only https is called. It is the
     * server's to set, connector by connector, not a kit's: a contribution cannot lower it.
     */
    boolean httpAllowed(Connector connector) {
        return "true".equals(property(connector.httpAllowedProperty()));
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
