/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.review;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.DefaultComponent;

/**
 * The review policies packages contribute, one per document type, kept in the order Nuxeo
 * registers them: the last enabled policy for a type is the one in force, a later package's
 * replacing an earlier one's whole, and {@code enabled="false"} removing it. A policy's mistakes
 * are logged as errors when it registers ({@link ReviewPolicy}).
 */
public class AssetReviewComponent extends DefaultComponent implements AssetReviewService {

    private static final Logger log = LogManager.getLogger(AssetReviewComponent.class);

    static final String XP_POLICIES = "policies";

    private final List<ReviewPolicyDescriptor> contributions = new ArrayList<>();

    private volatile Map<String, ReviewPolicy> policies = Map.of();

    @Override
    public void registerContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        if (!XP_POLICIES.equals(extensionPoint) || !(contribution instanceof ReviewPolicyDescriptor descriptor)) {
            log.warn("Unknown contribution to {}: {}", extensionPoint, contribution);
            return;
        }
        register(descriptor, contributor == null ? "?" : contributor.getName().getName());
    }

    @Override
    public void unregisterContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        synchronized (contributions) {
            if (contributions.remove(contribution)) {
                rebuild();
            }
        }
    }

    /** Register one policy, as {@link #registerContribution} does, naming who contributed it. */
    void register(ReviewPolicyDescriptor descriptor, String contributor) {
        ReviewPolicy policy = ReviewPolicy.of(descriptor);
        if (policy == null) {
            log.error("Asset review: a policy from {} names no type, and is left out", contributor);
            return;
        }
        if (descriptor.isEnabled()) {
            for (String problem : policy.problems()) {
                log.error("Asset review: the policy for {} from {}: {}", policy.type(), contributor, problem);
            }
        }
        synchronized (contributions) {
            contributions.add(descriptor);
            rebuild();
        }
    }

    private void rebuild() {
        Map<String, ReviewPolicy> built = new HashMap<>();
        for (ReviewPolicyDescriptor descriptor : contributions) {
            ReviewPolicy policy = ReviewPolicy.of(descriptor);
            if (policy == null) {
                continue;
            }
            if (descriptor.isEnabled()) {
                built.put(policy.type(), policy);
            } else {
                built.remove(policy.type());
            }
        }
        policies = Map.copyOf(built);
    }

    @Override
    public ReviewPolicy policyFor(String type) {
        return type == null ? null : policies.get(type);
    }
}
