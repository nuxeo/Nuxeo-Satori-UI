/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import java.util.Locale;
import java.util.Map;

/**
 * A callback as it arrived, before anything of it is believed: its headers, by lower-case name,
 * the first value of each, and its body, whole, within the add-on's bound.
 */
public record Callback(Map<String, String> headers, byte[] body) {

    /** A header's value, by its name in any case; {@code null} when it has none. */
    public String header(String name) {
        return headers.get(name.toLowerCase(Locale.ROOT));
    }

    /** Never the body, nor a header: either may hold the signature. */
    @Override
    public String toString() {
        return "Callback[" + body.length + " bytes]";
    }
}
