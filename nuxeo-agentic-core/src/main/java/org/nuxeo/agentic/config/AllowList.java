package org.nuxeo.agentic.config;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * This server's allow-list, as it stands: the operations and chains an app's buttons may run, by
 * their id. Immutable; the component publishes a new one whenever a contribution changes it, so a
 * reader holds one version whole, and a cache keyed by its identity knows when it changed.
 *
 * Empty on a server whose deployment allows nothing, which is the default: no package can reach
 * an operation nobody allowed.
 */
public final class AllowList {

    public static final AllowList EMPTY = new AllowList(Map.of());

    private final Map<String, AllowedOperation> operations;

    AllowList(Map<String, AllowedOperation> operations) {
        this.operations = Collections.unmodifiableMap(new LinkedHashMap<>(operations));
    }

    /** The entry for {@code id}, or {@code null} when this server does not allow it. */
    public AllowedOperation get(String id) {
        return id == null ? null : operations.get(id);
    }

    /** Every entry, by id, in the order they were contributed. */
    public Map<String, AllowedOperation> operations() {
        return operations;
    }
}
