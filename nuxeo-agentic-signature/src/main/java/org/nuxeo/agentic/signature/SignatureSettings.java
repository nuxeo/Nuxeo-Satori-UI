/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import java.util.function.UnaryOperator;

import org.nuxeo.runtime.api.Framework;

/**
 * Where the add-on and its providers read what each server sets: the provider in use, and each
 * provider's address and credentials, from the server's properties ({@code nuxeo.conf}), and a
 * credential also from the environment. These are the only sources: nothing a provider sends or
 * checks is read from a document, a contribution or a request. The lookups are functions, so that
 * tests give their own.
 */
public record SignatureSettings(UnaryOperator<String> property, UnaryOperator<String> env) {

    /** The server property that names the provider requests are sent through. */
    public static final String PROVIDER_PROPERTY = "nuxeo.agentic.signature.provider";

    /** The server's: its properties, and the process's environment. */
    public static SignatureSettings server() {
        return new SignatureSettings(Framework::getProperty, System::getenv);
    }

    /** The value, trimmed, or {@code null} for one unset or blank. */
    public String property(String name) {
        return blankToNull(property.apply(name));
    }

    public String env(String name) {
        return blankToNull(env.apply(name));
    }

    /** A credential: the server property, else the environment variable. */
    public String secret(String propertyName, String envName) {
        String value = property(propertyName);
        return value != null ? value : env(envName);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
