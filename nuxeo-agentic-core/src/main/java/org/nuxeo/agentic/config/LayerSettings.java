package org.nuxeo.agentic.config;

import java.util.Arrays;
import java.util.List;
import java.util.function.UnaryOperator;

/**
 * The deployment layer's server settings, read once when the component starts.
 *
 * <ul>
 * <li>{@value #ENABLED_PROPERTY}: the switch. Off unless it is {@code true}, as every new part of
 * the business apps work is (decision J, "new code goes in new projects behind switches"). Off, no
 * write is accepted, no state is read, and the registry serves every package's file as before: the
 * layer stored in the repository is kept, and applies again when the switch is turned back on. So
 * the switch is also how a deployment takes every customer change out at once.</li>
 * <li>{@value #SELF_APPROVAL_PROPERTY}: whether the administrator who made a change may approve
 * it. Off unless it is {@code true}: a change goes live when a second administrator approves it.
 * A server with one administrator turns it on, and says so in its own records.</li>
 * <li>{@value #REGISTERED_PREFIX}{@code rules}, {@code rowActions} and {@code bulkActions}: what
 * the deployment registers in Layer 2 code beyond the platform's own, by ID, separated by commas,
 * as the validator's {@code --registered} file says it. A file naming one of them is otherwise
 * refused, as the pipeline refuses it.</li>
 * </ul>
 *
 * Read through a property lookup passed in, rather than from {@code Framework}, so that the
 * default, off, is what the tests hold.
 */
record LayerSettings(boolean enabled, boolean selfApproval, List<String> rules, List<String> rowActions,
        List<String> bulkActions) {

    static final String ENABLED_PROPERTY = "nuxeo.agentic.ui.layer.enabled";

    static final String SELF_APPROVAL_PROPERTY = "nuxeo.agentic.ui.layer.selfApproval";

    static final String REGISTERED_PREFIX = "nuxeo.agentic.ui.layer.registered.";

    /** Off: what a server that has set nothing runs. */
    static final LayerSettings OFF = new LayerSettings(false, false, List.of(), List.of(), List.of());

    LayerSettings {
        rules = List.copyOf(rules);
        rowActions = List.copyOf(rowActions);
        bulkActions = List.copyOf(bulkActions);
    }

    static LayerSettings from(UnaryOperator<String> properties) {
        return new LayerSettings(Boolean.parseBoolean(properties.apply(ENABLED_PROPERTY)),
                Boolean.parseBoolean(properties.apply(SELF_APPROVAL_PROPERTY)),
                ids(properties.apply(REGISTERED_PREFIX + "rules")),
                ids(properties.apply(REGISTERED_PREFIX + "rowActions")),
                ids(properties.apply(REGISTERED_PREFIX + "bulkActions")));
    }

    private static List<String> ids(String value) {
        if (value == null || value.isBlank()) {
            return List.of();
        }
        return Arrays.stream(value.split(",")).map(String::strip).filter(id -> !id.isEmpty()).toList();
    }
}
