/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import java.util.Map;
import java.util.function.Supplier;

/**
 * The letter this thread is rendering, while {@link LetterGenerator} has the platform render it, and
 * only then: its id, its template's name, the template's text as the add-on checked it, and every
 * placeholder's value, read as its writer. {@link LetterProcessor} renders nothing else. Server-side
 * only: nothing a request carries can set it.
 */
final class LetterRendering {

    record Current(String letterId, String templateName, TemplateText.Parsed text, Map<Placeholder, String> values,
            String fileName) {
    }

    private static final ThreadLocal<Current> CURRENT = new ThreadLocal<>();

    private LetterRendering() {
    }

    static <T> T during(Current current, Supplier<T> work) {
        Current outer = CURRENT.get();
        CURRENT.set(current);
        try {
            return work.get();
        } finally {
            if (outer == null) {
                CURRENT.remove();
            } else {
                CURRENT.set(outer);
            }
        }
    }

    /** The letter being rendered on this thread, or {@code null}. */
    static Current current() {
        return CURRENT.get();
    }
}
