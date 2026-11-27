/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.util.function.UnaryOperator;

import org.nuxeo.runtime.api.Framework;

/**
 * Where the add-on and its providers read what each server sets, from the server's properties
 * ({@code nuxeo.conf}): the provider in use, the AI provider's switch and operations, and the
 * largest file taken. Read at each use, never kept, so a setting changed and the server restarted
 * is the one in force. Nothing a provider does is read from a document, a contribution or a request.
 */
public record CaptureSettings(UnaryOperator<String> property) {

    /** The provider items are classified through: none, and nothing is classified. */
    public static final String PROVIDER_PROPERTY = "nuxeo.agentic.capture.provider";

    /** The largest file an inbox takes, in bytes. */
    public static final String MAX_BYTES_PROPERTY = "nuxeo.agentic.capture.maxBytes";

    public static final long DEFAULT_MAX_BYTES = 20L * 1024 * 1024;

    public static final long LOWEST_MAX_BYTES = 1024;

    public static final long HIGHEST_MAX_BYTES = 100L * 1024 * 1024;

    /** The server's properties. */
    public static CaptureSettings server() {
        return new CaptureSettings(Framework::getProperty);
    }

    /** The value, trimmed, or {@code null} for one unset or blank. */
    public String property(String name) {
        String value = property.apply(name);
        return value == null || value.isBlank() ? null : value.trim();
    }

    /** Whether the property is {@code true}, in any letter case; anything else is not. */
    public boolean isTrue(String name) {
        return "true".equalsIgnoreCase(property(name));
    }

    public long maxBytes() {
        String value = property(MAX_BYTES_PROPERTY);
        if (value == null) {
            return DEFAULT_MAX_BYTES;
        }
        try {
            long bytes = Long.parseLong(value);
            return bytes >= LOWEST_MAX_BYTES && bytes <= HIGHEST_MAX_BYTES ? bytes : DEFAULT_MAX_BYTES;
        } catch (NumberFormatException e) {
            return DEFAULT_MAX_BYTES;
        }
    }
}
