package org.nuxeo.agentic.config;

import java.io.IOException;
import java.util.List;

/**
 * One contribution to the configuration extension point, with where it came from.
 *
 * Kept free of runtime types so the ordering and replacement rules can be tested without starting
 * Nuxeo: the component turns a descriptor plus its contributor into one of these.
 *
 * @param name a fragment's or an asset's name, or an app's id
 * @param content the body: a fragment's, a layout's or an asset's, or an app's {@code app.json}
 * @param files an app's other files, as paths below its root; empty for every other kind
 * @param reader reads one of an app's {@code files}; {@code null} for every other kind
 * @param descriptor the contributed object, compared by identity when a contribution is withdrawn
 */
record Contribution(Kind kind, String layer, String name, String type, String mode, boolean enabled,
        Provenance provenance, Content content, List<String> files, Files reader, Object descriptor) {

    enum Kind {
        FRAGMENT, LAYOUT, ASSET, APP
    }

    /** Reads a contribution's body. Throws when the source cannot be read. */
    @FunctionalInterface
    interface Content {
        byte[] read() throws IOException;
    }

    /** Where one of an app's files is read from, and the file it is, for its diagnostics. */
    interface Files {

        /** The body of the file at {@code path}, below the app's root. */
        Content file(String path);

        /** What a diagnostic names as the file's source: its path in the contributing bundle. */
        String source(String path);
    }

    Contribution {
        files = files == null ? List.of() : List.copyOf(files);
    }

    static Contribution fragment(String layer, String name, boolean enabled, Provenance provenance, Content content,
            Object descriptor) {
        return new Contribution(Kind.FRAGMENT, layer, name, null, null, enabled, provenance, content, null, null,
                descriptor);
    }

    static Contribution layout(String type, String mode, boolean enabled, Provenance provenance, Content content,
            Object descriptor) {
        return new Contribution(Kind.LAYOUT, null, null, type, mode, enabled, provenance, content, null, null,
                descriptor);
    }

    static Contribution asset(String name, boolean enabled, Provenance provenance, Content content,
            Object descriptor) {
        return new Contribution(Kind.ASSET, null, name, null, null, enabled, provenance, content, null, null,
                descriptor);
    }

    static Contribution app(String id, boolean enabled, Provenance provenance, Content appJson, List<String> files,
            Files reader, Object descriptor) {
        return new Contribution(Kind.APP, null, id, null, null, enabled, provenance, appJson, files, reader,
                descriptor);
    }

    /** What a later contribution must match to replace or remove this one. */
    String key() {
        return switch (kind) {
            case FRAGMENT -> "fragment " + layer + "/" + name;
            case LAYOUT -> "layout " + type + "/" + mode;
            case ASSET -> "asset " + name;
            case APP -> "app " + name;
        };
    }

    /**
     * The response this contribution's diagnostics belong in. A fragment whose layer is missing or
     * unknown is reported in bootstrap, the response every client reads first, rather than under a
     * layer no response serves.
     *
     * An app's are reported by the app registry alone, after sign-in, and only to those who may
     * see the app ({@link ConfigScope#app}): an app's diagnostics name its groups and files, and
     * the configuration's own responses are read by everyone, before sign-in.
     */
    String scope() {
        return switch (kind) {
            case FRAGMENT -> ConfigScope.isFragmentLayer(layer) ? layer : ConfigScope.BOOTSTRAP;
            case LAYOUT -> ConfigScope.LAYOUTS;
            case ASSET -> ConfigScope.BOOTSTRAP;
            case APP -> ConfigScope.app(name);
        };
    }
}
