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
import java.util.function.BiPredicate;
import java.util.function.Function;
import java.util.function.UnaryOperator;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.rights.Decision.Reason;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.DefaultComponent;

/**
 * The rights policies packages contribute, one per document type, and the decision for a download.
 *
 * <p>Contributions are kept in the order Nuxeo registers them, which is dependency order, and the
 * last enabled policy for a type is the one in force: a later package replaces an earlier one's
 * policy whole, and {@code enabled="false"} removes it. A policy's mistakes are logged as errors
 * when it registers, and each one refuses rather than lets through ({@link RightsPolicy}).
 *
 * <p>Two rules beyond the policy itself:
 * <ul>
 * <li><strong>A version or a proxy has its live document's rights.</strong> A version keeps the
 * fields it had when it was made, so rights narrowed since would not reach it: its rights are read
 * from the live document, with a privileged session, since a reader of a proxy may not read the
 * live document. One with no live document is refused.</li>
 * <li><strong>A container holding a covered asset refuses its renditions,</strong> but its
 * thumbnail: a folder's tree export or a collection's default rendition holds the bytes of each
 * document in it, under the container's own type, which no policy covers.</li>
 * </ul>
 */
public class AssetRightsComponent extends DefaultComponent implements AssetRightsService {

    private static final Logger log = LogManager.getLogger(AssetRightsComponent.class);

    static final String XP_POLICIES = "policies";

    /** The one rendition a container still serves: its thumbnail, a preview. */
    static final String THUMBNAIL_RENDITION = "thumbnail";

    static final String COLLECTION_FACET = "Collection";

    /** What a type or a document id may be, to be written into a query: anything else refuses. */
    private static final Pattern QUERY_SAFE = Pattern.compile("[A-Za-z0-9_.:-]+");

    private final Clock clock;

    /** The document whose fields hold a download's rights: the live one, for a version or a proxy. */
    private final UnaryOperator<DocumentModel> rightsSource;

    /** Whether a container holds a document of one of these types. */
    private final BiPredicate<DocumentModel, Set<String>> holdsAny;

    /** Every contribution, in registration order, so that one removed by a hot reload goes. */
    private final List<RightsPolicyDescriptor> contributions = new ArrayList<>();

    /** The policy in force for each type, rebuilt from {@link #contributions} on any change. */
    private volatile Map<String, RightsPolicy> policies = Map.of();

    public AssetRightsComponent() {
        this(Clock.systemUTC(), AssetRightsComponent::liveDocument, AssetRightsComponent::holdsAnyOf);
    }

    /** For tests, which choose the day, and have no repository to find a live document or a child in. */
    AssetRightsComponent(Clock clock, UnaryOperator<DocumentModel> rightsSource,
            BiPredicate<DocumentModel, Set<String>> holdsAny) {
        this.clock = clock;
        this.rightsSource = rightsSource;
        this.holdsAny = holdsAny;
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
    public AssetFacts facts(DocumentModel document, RightsPolicy policy) {
        return AssetFacts.read(rightsSource.apply(document), policy);
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
            return decideContainer(document, rendition);
        }
        Use use = Use.unknown(xpath);
        try {
            use = DownloadUse.classify(document, policy, xpath, blob, rendition);
            // Read only when the decision needs them: a preview is served without.
            Decision decision = AssetRights.decide(policy, () -> facts(document, policy), use, today());
            return new DownloadDecision(use, decision);
        } catch (RuntimeException e) {
            log.error("Asset rights: the rights of {} ({}) could not be read, so its {} is refused", id(document),
                    type, use, e);
            return new DownloadDecision(use, Decision.refuse(Reason.POLICY_ERROR));
        }
    }

    /**
     * A rendition of a document no policy covers: refused when it is a container's, but its
     * thumbnail, and the container holds a document a policy covers. {@code null}, not decided,
     * otherwise.
     */
    private DownloadDecision decideContainer(DocumentModel document, String rendition) {
        Map<String, RightsPolicy> inForce = policies;
        if (rendition == null || THUMBNAIL_RENDITION.equals(rendition) || inForce.isEmpty()) {
            return null;
        }
        Use use = Use.rendition(rendition);
        try {
            if (!document.isFolder() && !document.hasFacet(COLLECTION_FACET)) {
                return null;
            }
            return holdsAny.test(document, inForce.keySet())
                    ? new DownloadDecision(use, Decision.refuse(Reason.CONTAINS_ASSETS))
                    : null;
        } catch (RuntimeException e) {
            log.error("Asset rights: what {} holds could not be read, so its {} is refused", id(document), use, e);
            return new DownloadDecision(use, Decision.refuse(Reason.POLICY_ERROR));
        }
    }

    /** The live document of a version or a proxy, read with a privileged session; the document itself otherwise. */
    static DocumentModel liveDocument(DocumentModel document) {
        if (!document.isVersion() && !document.isProxy()) {
            return document;
        }
        CoreSession session = document.getCoreSession();
        if (session == null) {
            throw new IllegalStateException("a version or a proxy with no session to find its live document in");
        }
        DocumentRef ref = document.getRef();
        DocumentModel live = CoreInstance.doPrivileged(session,
                (Function<CoreSession, DocumentModel>) privileged -> privileged.getWorkingCopy(ref));
        if (live == null) {
            throw new IllegalStateException("no live document for " + ref);
        }
        return live;
    }

    /**
     * Whether the container holds a document of one of {@code types}: below it in the tree, or, for
     * a collection, among its members. Asked with the reader's own session: a document they may not
     * read is not one a container's rendition would give them.
     */
    static boolean holdsAnyOf(DocumentModel container, Set<String> types) {
        CoreSession session = container.getCoreSession();
        if (session == null) {
            throw new IllegalStateException("a container with no session to query");
        }
        String id = querySafe(container.getId());
        String in = types.stream().map(type -> "'" + querySafe(type) + "'").collect(Collectors.joining(", "));
        String where = "ecm:ancestorId = '" + id + "'";
        if (container.hasFacet(COLLECTION_FACET)) {
            where = "(" + where + " OR collectionMember:collectionIds/* = '" + id + "')";
        }
        return !session.queryProjection("SELECT ecm:uuid FROM Document WHERE ecm:primaryType IN (" + in + ") AND "
                + where, 1, 0).isEmpty();
    }

    private static String querySafe(String value) {
        if (value == null || !QUERY_SAFE.matcher(value).matches()) {
            throw new IllegalStateException("not written into a query: " + value);
        }
        return value;
    }

    static String id(DocumentModel document) {
        try {
            return document.getId();
        } catch (RuntimeException e) {
            return "?";
        }
    }
}
