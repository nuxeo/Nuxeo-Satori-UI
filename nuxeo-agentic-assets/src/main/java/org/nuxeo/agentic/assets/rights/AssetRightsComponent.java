/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.rights.Decision.Reason;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.DefaultComponent;

/**
 * The rights policies packages contribute, one per document type, and the decision for a download.
 *
 * <p>Contributions are kept in the order Nuxeo registers them, which is dependency order, and the
 * last enabled policy for a type is the one in force: a later package replaces an earlier one's
 * policy whole, and {@code enabled="false"} removes it. A policy's mistakes are logged as errors
 * when it registers, and each one refuses rather than lets through ({@link RightsPolicy}).
 */
public class AssetRightsComponent extends DefaultComponent implements AssetRightsService {

    private static final Logger log = LogManager.getLogger(AssetRightsComponent.class);

    static final String XP_POLICIES = "policies";

    private final Clock clock;

    /** Every contribution, in registration order, so that one removed by a hot reload goes. */
    private final List<RightsPolicyDescriptor> contributions = new ArrayList<>();

    /** The policy in force for each type, rebuilt from {@link #contributions} on any change. */
    private volatile Map<String, RightsPolicy> policies = Map.of();

    public AssetRightsComponent() {
        this(Clock.systemUTC());
    }

    /** For tests, which choose the day. */
    AssetRightsComponent(Clock clock) {
        this.clock = clock;
    }

    @Override
    public void registerContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        if (!XP_POLICIES.equals(extensionPoint) || !(contribution instanceof RightsPolicyDescriptor descriptor)) {
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
    void register(RightsPolicyDescriptor descriptor, String contributor) {
        String type = descriptor.getType() == null ? null : descriptor.getType().trim();
        if (type == null || type.isEmpty()) {
            log.error("Asset rights: a policy from {} names no type, and is left out", contributor);
            return;
        }
        if (descriptor.isEnabled()) {
            RightsPolicy policy = RightsPolicy.of(descriptor);
            for (String problem : policy.problems()) {
                log.error("Asset rights: the policy for {} from {}: {}", type, contributor, problem);
            }
        }
        synchronized (contributions) {
            contributions.add(descriptor);
            rebuild();
        }
    }

    private void rebuild() {
        Map<String, RightsPolicy> built = new HashMap<>();
        for (RightsPolicyDescriptor descriptor : contributions) {
            String type = descriptor.getType() == null ? "" : descriptor.getType().trim();
            if (type.isEmpty()) {
                continue;
            }
            if (descriptor.isEnabled()) {
                built.put(type, RightsPolicy.of(descriptor));
            } else {
                built.remove(type);
            }
        }
        policies = Map.copyOf(built);
    }

    @Override
    public RightsPolicy policyFor(String type) {
        return type == null ? null : policies.get(type);
    }

    @Override
    public LocalDate today() {
        return LocalDate.now(clock.withZone(ZoneOffset.UTC));
    }

    @Override
    public DownloadDecision decideDownload(DocumentModel document, String xpath, Blob blob, String rendition) {
        if (document == null) {
            return null;
        }
        String type;
        try {
            type = document.getType();
        } catch (RuntimeException e) {
            log.error("Asset rights: a download's document has no readable type, so it is refused", e);
            return new DownloadDecision(Use.unknown(null), Decision.refuse(Reason.POLICY_ERROR));
        }
        RightsPolicy policy = policyFor(type);
        if (policy == null) {
            return null;
        }
        Use use = Use.unknown(xpath);
        try {
            use = DownloadUse.classify(document, policy, xpath, blob, rendition);
            AssetFacts facts = policy.broken() ? new AssetFacts(null, Set.of())
                    : AssetFacts.read(document, policy);
            return new DownloadDecision(use, AssetRights.decide(policy, facts, use, today()));
        } catch (RuntimeException e) {
            log.error("Asset rights: the rights of {} ({}) could not be read, so its {} is refused", id(document),
                    type, use, e);
            return new DownloadDecision(use, Decision.refuse(Reason.POLICY_ERROR));
        }
    }

    static String id(DocumentModel document) {
        try {
            return document.getId();
        } catch (RuntimeException e) {
            return "?";
        }
    }
}
