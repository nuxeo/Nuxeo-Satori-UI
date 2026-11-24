/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.time.LocalDate;

import org.nuxeo.agentic.assets.rights.Decision.Reason;
import org.nuxeo.agentic.assets.rights.RightsPolicy.Rule;

/**
 * The decision itself, from a policy, an asset's rights and a use, with no Nuxeo in it: the one
 * place the download permission and the {@code assetRights} enricher both decide.
 *
 * <p>In this order, the first that applies:
 * <ol>
 * <li>a broken policy refuses: {@code policy-error};</li>
 * <li>a use the policy does not list is refused: {@code not-cleared};</li>
 * <li>a preview is served: {@code preview};</li>
 * <li>rights whose end day has passed refuse: {@code rights-ended};</li>
 * <li>channels that do not hold the use's refuse: {@code channel-not-covered};</li>
 * <li>otherwise the use is served: {@code cleared}.</li>
 * </ol>
 * Nothing here asks who the user is: an administrator is refused as anyone else is.
 */
public final class AssetRights {

    private AssetRights() {
    }

    public static Decision decide(RightsPolicy policy, AssetFacts facts, Use use, LocalDate today) {
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
        if (facts.ended(today)) {
            return Decision.refuse(Reason.RIGHTS_ENDED, rule.channel(), facts.rightsEnd());
        }
        if (!facts.channels().contains(rule.channel())) {
            return Decision.refuse(Reason.CHANNEL_NOT_COVERED, rule.channel(), null);
        }
        return Decision.allow(Reason.CLEARED, rule.channel());
    }
}
