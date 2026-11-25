package org.nuxeo.agentic.config;

import java.util.Map;

/**
 * Where an app's deployment layer is kept: one record per app, its whole layer as JSON, with a
 * stamp that changes on every write.
 *
 * A write names the stamp it read, and is refused when another write has come first, so that two
 * administrators, or two servers of a cluster, cannot each write over the other's change unseen.
 * {@link LayerService} reads again and re-applies the change when that happens, and the change is
 * then refused if the file it was for has itself changed.
 *
 * The server keeps it in the repository ({@link RepositoryLayerStore}).
 */
interface LayerStore {

    /** An app's layer as stored: its JSON and the stamp of the write that made it. */
    record Stored(byte[] json, String stamp) {
    }

    /** The app's layer, or {@code null} when none is stored. */
    Stored read(String app);

    /** Every app's layer, by app id. */
    Map<String, Stored> readAll();

    /**
     * Stores an app's layer, when it is still the one {@code expected} stamps: {@code null} for an
     * app with none stored yet.
     *
     * @return {@code false}, and nothing written, when another write came first
     */
    boolean write(String app, byte[] json, String expected);
}
