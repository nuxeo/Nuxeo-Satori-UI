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
}
