package org.nuxeo.agentic.config;

/**
 * Who contributed something: the component that declared it, the bundle that ships that component,
 * and the file it was read from ({@code inline} when the JSON was written into the XML).
 */
record Provenance(String component, String bundle, String source) {

    static final String INLINE = "inline";

    /**
     * The bundle our own packaged configuration is contributed from — the {@code
     * Bundle-SymbolicName} of this module, which is what {@code Bundle.getSymbolicName()} returns
     * for every contribution we make ourselves.
     *
     * Held against the manifest by {@code ContributionRegistryTest}, because a rename there and
     * not here would leave {@link #isPackaged} always false and every displacement of our own
     * defaults quietly back at {@code info}.
     */
    static final String PACKAGED_BUNDLE = "org.nuxeo.agentic.core";

    /**
     * Whether this came from Satori itself rather than from a package installed on the server.
     *
     * The bundle rather than the component: the bundle is what "shipped by the product" means, and
     * it keeps holding if we ever split the defaults across more than one component. Decided here,
     * once, because the two places that ask (a replacement and a removal) are the kind of pair
     * that drifts apart.
     *
     * Where it stops: {@code AgenticUiConfigComponent} falls back to the component name when the
     * runtime gives a contribution no bundle, and our component is not named after our bundle, so
     * a contribution of ours registered outside a bundle context reads as a customer's and is
     * reported at {@code info}. That needs an embedded or test runtime — on a server our
     * contributions come from this bundle — so it is stated rather than guarded against, which
     * would mean matching the component name too and giving up the reason above.
     */
    boolean isPackaged() {
        return PACKAGED_BUNDLE.equals(bundle);
    }
}
