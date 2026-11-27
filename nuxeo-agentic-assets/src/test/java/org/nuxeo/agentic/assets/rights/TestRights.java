package org.nuxeo.agentic.assets.rights;

import java.time.Clock;

/**
 * The rights, as the share links' tests decide with them: the brand kit's policy, on documents
 * that are their own rights source, on the day the clock says. Public only so that the tests of
 * another package may use it.
 */
public final class TestRights {

    private TestRights() {
    }

    /** The kit's policy for {@code AcmeAsset}, deciding on the clock's day in UTC. */
    public static AssetRightsComponent kit(Clock clock) {
        AssetRightsComponent component = new AssetRightsComponent(clock, document -> document,
                (container, types) -> false);
        component.register(Fakes.kitPolicy(), "test");
        return component;
    }

    /**
     * The kit's policy for {@code AcmeAsset} with territories and release windows of its own, at
     * {@code acmeasset:territories} and {@code acmeasset:windows}: as a policy for media rights reads
     * them.
     */
    public static AssetRightsComponent territorialKit(Clock clock) {
        RightsPolicyDescriptor policy = Fakes.kitPolicy();
        policy.territoriesXpath = "acmeasset:territories";
        policy.windowsXpath = "acmeasset:windows";
        AssetRightsComponent component = new AssetRightsComponent(clock, document -> document,
                (container, types) -> false);
        component.register(policy, "test");
        return component;
    }
}
