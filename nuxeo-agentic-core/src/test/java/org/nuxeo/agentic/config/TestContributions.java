package org.nuxeo.agentic.config;

import java.nio.charset.StandardCharsets;

/** Builders for contributions as the component would make them, without a running Nuxeo. */
final class TestContributions {

    private TestContributions() {
    }

    static Provenance from(String component) {
        return new Provenance(component, component + ".bundle", "agentic-ui-config/" + component + ".json");
    }

    /**
     * Provenance as the runtime gives it for our own packaged contributions: the component that
     * declares the defaults, inside the bundle that ships them.
     *
     * {@link #from} synthesises the bundle as {@code <component>.bundle}, so a contribution built
     * with it is never recognised as ours however the component is named — which is the point for
     * every other test here, and a trap for the ones about displacing a packaged default
     * (NXSAT-747). Use this builder for those, or the test exercises the customer-on-customer
     * branch and passes for the wrong reason.
     */
    static Provenance packaged() {
        return new Provenance("org.nuxeo.agentic.ui.config.defaults", Provenance.PACKAGED_BUNDLE,
                "agentic-ui-config/bootstrap.defaults.json");
    }

    static Contribution packagedFragment(String layer, String name, String body) {
        return Contribution.fragment(layer, name, true, packaged(), json(body), new Object());
    }

    static Contribution packagedLayout(String type, String mode, String body) {
        return Contribution.layout(type, mode, true, packaged(), json(body), new Object());
    }

    static Contribution.Content json(String body) {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        return () -> bytes;
    }

    static Contribution fragment(String component, String layer, String name, String body) {
        return Contribution.fragment(layer, name, true, from(component), json(body), new Object());
    }

    static Contribution disabledFragment(String component, String layer, String name) {
        return Contribution.fragment(layer, name, false, from(component), null, new Object());
    }

    static Contribution layout(String component, String type, String mode, String body) {
        return Contribution.layout(type, mode, true, from(component), json(body), new Object());
    }

    static Contribution asset(String component, String name, byte[] bytes) {
        return Contribution.asset(name, true, from(component), () -> bytes, new Object());
    }
}
