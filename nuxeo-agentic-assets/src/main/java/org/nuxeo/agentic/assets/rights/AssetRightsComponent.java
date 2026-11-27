/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.io.Serializable;
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
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.agentic.assets.rights.video.VideoOperationRights;
import org.nuxeo.ecm.core.api.PartialList;
import org.nuxeo.ecm.core.api.model.Property;
import org.nuxeo.ecm.core.api.repository.RepositoryManager;
import org.nuxeo.ecm.core.blob.ManagedBlob;
import org.nuxeo.ecm.core.utils.BlobsExtractor;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;
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
 * document in it, under the container's own type, which no policy covers, and goes into the
 * containers it meets, so one holding another container refuses too ({@link #holdsAnyOf}).</li>
 * <li><strong>Release windows may be another document's.</strong> A localised version, an asset of
 * its own with its own rights, may read its film's windows: the policy's {@code <windows document>}
 * names the property holding the film's id, and the film is read with a privileged session, as a
 * version's live document is. A film that is not there, not live or in the trash refuses.</li>
 * </ul>
 */
public class AssetRightsComponent extends DefaultComponent implements AssetRightsService {

    private static final Logger log = LogManager.getLogger(AssetRightsComponent.class);

    static final String XP_POLICIES = "policies";

    /** The one rendition a container still serves: its thumbnail, a preview. */
    static final String THUMBNAIL_RENDITION = "thumbnail";

    static final String COLLECTION_FACET = "Collection";

    /**
     * Since 0.6.0, a long video's marked copy's type ({@code WatermarkedCopies.TYPE}): its file is
     * refused at every download endpoint, and wherever its stored file is handed over with no
     * document, to everyone.
     */
    public static final String COPY_TYPE = "WatermarkedCopy";

    /** What a type or a document id may be, to be written into a query: anything else refuses. */
    private static final Pattern QUERY_SAFE = Pattern.compile("[A-Za-z0-9_.:-]+");

    /** What the id of the document an asset reads its release windows from may be. */
    private static final Pattern DOCUMENT_ID = Pattern.compile("[A-Za-z0-9-]{1,64}");

    /** Where an asset's release windows are read: from it, or from the document its policy names. */
    @FunctionalInterface
    interface WindowsSource {
        /** The value of the policy's {@code <windows>} for {@code asset}, its live document. */
        Serializable windows(DocumentModel asset, RightsPolicy policy);
    }

    private final Clock clock;

    /** The document whose fields hold a download's rights: the live one, for a version or a proxy. */
    private final UnaryOperator<DocumentModel> rightsSource;

    /** Whether a container holds a document of one of these types. */
    private final BiPredicate<DocumentModel, Set<String>> holdsAny;

    private final WindowsSource windowsSource;

    /** Every contribution, in registration order, so that one removed by a hot reload goes. */
    private final List<RightsPolicyDescriptor> contributions = new ArrayList<>();

    /** The policy in force for each type, rebuilt from {@link #contributions} on any change. */
    private volatile Map<String, RightsPolicy> policies = Map.of();

    public AssetRightsComponent() {
        this(Clock.systemUTC(), AssetRightsComponent::liveDocument, AssetRightsComponent::holdsAnyOf,
                AssetRightsComponent::windowsOf);
    }

    /** For tests, which choose the day, and have no repository to find a live document or a child in. */
    AssetRightsComponent(Clock clock, UnaryOperator<DocumentModel> rightsSource,
            BiPredicate<DocumentModel, Set<String>> holdsAny) {
        this(clock, rightsSource, holdsAny, AssetRightsComponent::windowsOf);
    }

    /** For tests, which also choose where another document's release windows are read. */
    AssetRightsComponent(Clock clock, UnaryOperator<DocumentModel> rightsSource,
            BiPredicate<DocumentModel, Set<String>> holdsAny, WindowsSource windowsSource) {
        this.clock = clock;
        this.rightsSource = rightsSource;
        this.holdsAny = holdsAny;
        this.windowsSource = windowsSource;
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
    public Set<String> coveredTypes() {
        return policies.keySet();
    }

    @Override
    public LocalDate today() {
        return LocalDate.now(clock.withZone(ZoneOffset.UTC));
    }

    @Override
    public AssetFacts facts(DocumentModel document, RightsPolicy policy) {
        DocumentModel live = rightsSource.apply(document);
        return AssetFacts.read(live, policy.territorial() ? windowsSource.windows(live, policy) : null, policy);
    }

    @Override
    public DeliveryDecision decideDelivery(DocumentModel document, String territory) {
        if (document == null) {
            return new DeliveryDecision(Decision.refuse(Reason.POLICY_ERROR), List.of());
        }
        RightsPolicy policy;
        try {
            policy = policyFor(document.getType());
        } catch (RuntimeException e) {
            log.error("Asset rights: a delivery's document has no readable type, so it is refused", e);
            return new DeliveryDecision(Decision.refuse(Reason.POLICY_ERROR), List.of());
        }
        if (policy == null || policy.delivery() == null) {
            // No policy, or one with no package: nothing is cleared for delivery.
            return new DeliveryDecision(Decision.refuse(Reason.NOT_CLEARED), List.of());
        }
        if (policy.broken() || policy.deliveryBroken()) {
            return new DeliveryDecision(Decision.refuse(Reason.POLICY_ERROR), List.of());
        }
        if (territory == null || territory.isBlank()) {
            return new DeliveryDecision(Decision.refuseIn(Reason.TERRITORY_NOT_COVERED, null, null), List.of());
        }
        AssetFacts facts;
        try {
            facts = facts(document, policy);
        } catch (RuntimeException e) {
            log.error("Asset rights: the rights of {} ({}) could not be read, so its delivery is refused",
                    id(document), policy.type(), e);
            return new DeliveryDecision(Decision.refuse(Reason.POLICY_ERROR), List.of());
        }
        LocalDate today = today();
        List<PackageFile> files = new ArrayList<>();
        for (Use use : policy.delivery()) {
            Decision decision = AssetRights.decide(policy, () -> facts, use, today, territory);
            Blob blob = null;
            if (decision.allowed()) {
                blob = packageFile(document, policy, use);
                if (blob == null || blob.getDigest() == null || blob.getDigest().isEmpty()) {
                    // Nothing to deliver, or nothing to record what was delivered by.
                    blob = null;
                    decision = Decision.refuse(Reason.NO_SUCH_FILE, decision.channel(), null);
                }
            }
            files.add(new PackageFile(use, decision, blob));
        }
        return new DeliveryDecision(null, files);
    }

    /**
     * The file a delivery's package lists, on the document: its original, the first picture view of
     * that title, or the blob at that xpath. {@code null} when it has none.
     */
    static Blob packageFile(DocumentModel document, RightsPolicy policy, Use use) {
        try {
            switch (use.kind()) {
            case ORIGINAL:
                return document.getPropertyValue(policy.originalXpath()) instanceof Blob blob ? blob : null;
            case BLOB:
                return document.getPropertyValue(use.name()) instanceof Blob blob ? blob : null;
            case VIEW:
                if (!(document.getPropertyValue("picture:views") instanceof List<?> views)) {
                    return null;
                }
                for (int index = 0; index < views.size(); index++) {
                    if (use.name().equals(document.getPropertyValue("picture:views/" + index + "/title"))) {
                        return document.getPropertyValue("picture:views/" + index + "/content") instanceof Blob blob
                                ? blob : null;
                    }
                }
                return null;
            default:
                return null;
            }
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * An asset's release windows: its own, at the policy's {@code <windows>}, or, when that names a
     * {@code document}, the windows of the document whose id the asset holds there, read with a
     * privileged session, since the asset's reader may not read it. That document must be there,
     * live, not in the trash, and of the type the policy's {@code <windows type>} names.
     */
    static Serializable windowsOf(DocumentModel asset, RightsPolicy policy) {
        if (policy.windowsDocumentXpath() == null) {
            return asset.getPropertyValue(policy.windowsXpath());
        }
        Serializable named = asset.getPropertyValue(policy.windowsDocumentXpath());
        String id = named instanceof String text ? text.trim() : null;
        if (id == null || !DOCUMENT_ID.matcher(id).matches()) {
            throw new IllegalStateException("the asset names no document to read its release windows from");
        }
        CoreSession session = asset.getCoreSession();
        if (session == null) {
            throw new IllegalStateException("an asset with no session to read its release windows' document in");
        }
        return CoreInstance.doPrivileged(session, (Function<CoreSession, Serializable>) privileged -> {
            DocumentRef ref = new IdRef(id);
            if (!privileged.exists(ref)) {
                throw new IllegalStateException("the document " + id + " named for the release windows is not there");
            }
            DocumentModel holder = privileged.getDocument(ref);
            if (holder.isVersion() || holder.isProxy() || holder.isTrashed()) {
                throw new IllegalStateException("the document " + id + " named for the release windows is not live");
            }
            if (!holder.getType().equals(policy.windowsDocumentType())) {
                throw new IllegalStateException("the document " + id + " named for the release windows is not a "
                        + policy.windowsDocumentType());
            }
            return holder.getPropertyValue(policy.windowsXpath());
        });
    }

    @Override
    public DownloadDecision decideDownload(DocumentModel document, String xpath, Blob blob, String rendition) {
        return decideDownload(document, xpath, blob, rendition, null);
    }

    @Override
    public DownloadDecision decideDownload(DocumentModel document, String xpath, Blob blob, String rendition,
            NuxeoPrincipal person) {
        DownloadDecision decided = decideHere(document, xpath, blob, rendition, person);
        if (decided == null || !decided.decision().allowed() || !(blob instanceof ManagedBlob stored)
                || stored.getKey() == null) {
            return decided;
        }
        RightsPolicy policy = policyFor(document.getType());
        if (policy == null || policy.watermark() == null) {
            return decided;
        }
        // Since 0.5.0, under a policy with a watermark: the same file is decided wherever a covered
        // document holds it, so that a copy whose view is retitled, or whose files are reordered, serves
        // nothing the asset it was copied from would mark.
        DownloadDecision elsewhere = holders(document.getRepositoryName(), stored, person);
        return elsewhere == null ? decided : new DownloadDecision(decided.use(), elsewhere.decision());
    }

    @Override
    public DownloadDecision decideStored(Blob blob, NuxeoPrincipal person) {
        if (!(blob instanceof ManagedBlob stored) || stored.getKey() == null || policies.isEmpty()) {
            return null;
        }
        RepositoryManager repositories = Framework.getService(RepositoryManager.class);
        String repository = repositories == null ? null : repositories.getDefaultRepositoryName();
        if (repository == null) {
            return new DownloadDecision(Use.unknown(null), Decision.refuse(Reason.POLICY_ERROR));
        }
        return holders(repository, stored, person);
    }

    /**
     * The first refusal any document of a covered type holding {@code blob}'s file gives
     * {@code person}, at each place it holds it, as a download there is decided: read with the
     * system's rights, since an asset's rights do not depend on who reads its file. {@code null} when
     * none refuses. A file held by more than {@value VideoOperationRights#HOLDERS_LIMIT} such documents,
     * or a failure, refuses.
     */
    DownloadDecision holders(String repository, ManagedBlob blob, NuxeoPrincipal person) {
        Use unknown = Use.unknown(null);
        try {
            String query = VideoOperationRights.holdersQuery(VideoOperationRights.withCopies(coveredTypes()),
                    blob.getKey());
            if (query == null) {
                return null;
            }
            java.util.function.Supplier<DownloadDecision> work = () -> CoreInstance.doPrivileged(repository,
                    (Function<CoreSession, DownloadDecision>) privileged -> {
                        PartialList<Map<String, Serializable>> rows = privileged.queryProjection(query,
                                VideoOperationRights.HOLDERS_LIMIT + 1L, 0);
                        if (rows.size() > VideoOperationRights.HOLDERS_LIMIT) {
                            return new DownloadDecision(unknown, Decision.refuse(Reason.POLICY_ERROR));
                        }
                        for (Map<String, Serializable> row : rows) {
                            DocumentModel holder = privileged.getDocument(new IdRef((String) row.get("ecm:uuid")));
                            for (Property property : new BlobsExtractor().getBlobsProperties(holder)) {
                                if (property.getValue() instanceof ManagedBlob held && blob.getKey().equals(held.getKey())) {
                                    DownloadDecision there = decideHere(holder,
                                            VideoOperationRights.canonicalXpath(property), held, null, person);
                                    if (there != null && !there.decision().allowed()) {
                                        return there;
                                    }
                                }
                            }
                        }
                        return null;
                    });
            return TransactionHelper.isTransactionActiveOrMarkedRollback() ? work.get()
                    : TransactionHelper.runInTransaction(work);
        } catch (RuntimeException e) {
            log.error("Asset rights: the documents holding a stored file could not be read, so its download is refused",
                    e);
            return new DownloadDecision(unknown, Decision.refuse(Reason.POLICY_ERROR));
        }
    }

    /** The download decided at its place on its document, as before 0.5.0, then held to the watermark. */
    private DownloadDecision decideHere(DocumentModel document, String xpath, Blob blob, String rendition,
            NuxeoPrincipal person) {
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
        if (COPY_TYPE.equals(type)) {
            // Since 0.6.0: a long video's marked copy, kept for the person it names, is served by
            // Asset.GetWatermarked alone, to that person, once the rights allow it; to everyone else,
            // an administrator included, wherever it is asked for, refused.
            return new DownloadDecision(Use.unknown(xpath), Decision.refuse(Reason.NOT_CLEARED));
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
            return new DownloadDecision(use, AssetRights.watermarked(policy, use, decision, person));
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
     * Whether the container holds a document of one of {@code types}, or another container that a
     * container's export would go into: below it in the tree, or, for a collection, among its
     * members. `Document.GetContainerRendition` zips a folder or a collection met on the way, so
     * a collection below a folder, and a folder or a collection among a collection's members,
     * refuse too, whatever they hold: that refuses more than it must, never less. Asked with the
     * reader's own session: a document they may not read is not one a rendition would give them.
     */
    static boolean holdsAnyOf(DocumentModel container, Set<String> types) {
        CoreSession session = container.getCoreSession();
        if (session == null) {
            throw new IllegalStateException("a container with no session to query");
        }
        return !session.queryProjection(containerQuery(container, types), 1, 0).isEmpty();
    }

    /** The query {@link #holdsAnyOf} asks: one document is enough. */
    static String containerQuery(DocumentModel container, Set<String> types) {
        String id = querySafe(container.getId());
        String covered = "ecm:primaryType IN ("
                + types.stream().sorted().map(type -> "'" + querySafe(type) + "'").collect(Collectors.joining(", "))
                + ")";
        String below = "ecm:ancestorId = '" + id + "'";
        if (!container.hasFacet(COLLECTION_FACET)) {
            // Folders below are in the tree already; a collection below has members elsewhere.
            return "SELECT ecm:uuid FROM Document WHERE " + below + " AND (" + covered + " OR ecm:mixinType = '"
                    + COLLECTION_FACET + "')";
        }
        String members = "collectionMember:collectionIds/* = '" + id + "'";
        return "SELECT ecm:uuid FROM Document WHERE (" + below + " OR " + members + ") AND (" + covered
                + " OR ecm:mixinType IN ('" + COLLECTION_FACET + "', 'Folderish'))";
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
