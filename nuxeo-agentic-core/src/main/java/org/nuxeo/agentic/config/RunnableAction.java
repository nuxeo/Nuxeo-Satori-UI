package org.nuxeo.agentic.config;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * An action of an app's {@code actions.json} that runs an operation, as the app registry serves it:
 * the operation was on the allow-list, and every parameter one it allows, when the registry was
 * built. The run checks both again ({@link AppActionRunner}).
 *
 * @param placements where it shows: {@code record}, {@code row}, {@code card} or {@code bulk}
 * @param parameters where each parameter's value comes from, by the parameter's name
 */
record RunnableAction(String id, String operation, Set<String> placements, Map<String, Source> parameters) {

    RunnableAction {
        placements = Set.copyOf(placements);
        parameters = Collections.unmodifiableMap(new LinkedHashMap<>(parameters));
    }

    /** Where a parameter's value comes from. Never the request, but for {@link Input}. */
    sealed interface Source {
    }

    /** A value the app's file writes. */
    record Literal(JsonNode value) implements Source {
    }

    /** A property of the record, {@code <prefix>:<name>}, read from the repository when the action runs. */
    record Field(String xpath) implements Source {
    }

    /** What the person entered in the action's form, its field {@code var:<name>}. */
    record Input(String name) implements Source {
    }

    /**
     * Whether it runs on one record, the record page's, a row's, or that of a card of the record page
     * that names it, such as the holds card: the only runs there are.
     */
    boolean runsOnOneRecord() {
        return placements.contains("record") || placements.contains("row") || placements.contains("card");
    }
}
