/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.time.LocalDate;
import java.util.function.Supplier;

import org.nuxeo.agentic.assets.rights.Decision.Reason;
import org.nuxeo.agentic.assets.rights.RightsPolicy.Rule;

/**
 * The decision itself, from a policy, an asset's rights and a use, with no Nuxeo in it: the one
 * place the download permission, the {@code assetRights} enricher, share links and deliveries all
 * decide.
 *
 * <p>In this order, the first that applies:
 * <ol>
 * <li>a broken policy refuses: {@code policy-error};</li>
 * <li>a use the policy does not list is refused: {@code not-cleared};</li>
 * <li>a preview is served: {@code preview};</li>
 * <li>rights that cannot be read refuse: {@code policy-error}, from the caller, since only from
 * here on are they read;</li>
 * <li>rights whose end day has passed refuse: {@code rights-ended};</li>
 * <li>channels that do not hold the use's refuse: {@code channel-not-covered};</li>
 * <li>under a policy with territories, a territory the asset may not be delivered to refuses:
 * {@code territory-not-covered}. A delivery names its territory; a download names none, and is
 * refused when the asset may be delivered nowhere;</li>
 * <li>under a policy with territories, no release window for the use's channel open today refuses:
 * {@code outside-window}. A delivery's window is its territory's; a download's, a window in any
 * territory the asset may be delivered to;</li>
 * <li>otherwise the use is served: {@code cleared}.</li>
 * </ol>
 * Nothing here asks who the user is: an administrator is refused as anyone else is.
 */
public final class AssetRights {

    private AssetRights() {
    }

    public static Decision decide(RightsPolicy policy, AssetFacts facts, Use use, LocalDate today) {
        return decide(policy, () -> facts, use, today, null);
    }

    /**
     * As {@link #decide(RightsPolicy, AssetFacts, Use, LocalDate)}, reading the asset's rights only
     * when the decision needs them: never for a broken policy, a use not listed or a preview.
     */
    public static Decision decide(RightsPolicy policy, Supplier<AssetFacts> rights, Use use, LocalDate today) {
        return decide(policy, rights, use, today, null);
    }

    /**
     * As {@link #decide(RightsPolicy, Supplier, Use, LocalDate)}, for a delivery to
     * {@code territory}, or a download when it is {@code null}.
     */
    public static Decision decide(RightsPolicy policy, Supplier<AssetFacts> rights, Use use, LocalDate today,
            String territory) {
        if (policy.broken()) {
            return Decision.refuse(Reason.POLICY_ERROR);
        }
        Rule rule = policy.rule(use);
        if (rule == null) {
            return Decision.refuse(Reason.NOT_CLEARED);
        }
        if (rule.preview()) {
            return Decision.allow(Reason.PREVIEW, null);
        }
        AssetFacts facts = rights.get();
        if (facts.ended(today)) {
            return Decision.refuse(Reason.RIGHTS_ENDED, rule.channel(), facts.rightsEnd());
        }
        if (!facts.channels().contains(rule.channel())) {
            return Decision.refuse(Reason.CHANNEL_NOT_COVERED, rule.channel(), null);
        }
        if (policy.territorial()) {
            if (territory == null) {
                if (facts.territories().isEmpty()) {
                    return Decision.refuseIn(Reason.TERRITORY_NOT_COVERED, rule.channel(), null);
                }
                boolean open = facts.territories()
                                    .stream()
                                    .anyMatch(held -> facts.windowOpen(held, rule.channel(), today));
                if (!open) {
                    return Decision.refuseIn(Reason.OUTSIDE_WINDOW, rule.channel(), null);
                }
            } else {
                if (!facts.territories().contains(territory)) {
                    return Decision.refuseIn(Reason.TERRITORY_NOT_COVERED, rule.channel(), territory);
                }
                if (!facts.windowOpen(territory, rule.channel(), today)) {
                    return Decision.refuseIn(Reason.OUTSIDE_WINDOW, rule.channel(), territory);
                }
            }
        }
        return Decision.allow(Reason.CLEARED, rule.channel());
    }
}
