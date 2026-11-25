/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import java.io.Serializable;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.stream.Collectors;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.rights.AssetFacts;
import org.nuxeo.agentic.assets.rights.AssetRights;
import org.nuxeo.agentic.assets.rights.AssetRightsService;
import org.nuxeo.agentic.assets.rights.Decision;
import org.nuxeo.agentic.assets.rights.RightsPolicy;
import org.nuxeo.agentic.assets.share.ShareLinkStore.Downloads;
import org.nuxeo.agentic.assets.share.Watermarker.WatermarkException;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.model.DefaultComponent;

/**
 * Share links, decided on the server.
 *
 * <p><strong>A link opens,</strong> for one of the items it lists, only while all of these hold, in
 * this order, each refusal ending the request:
 * <ol>
 * <li>the token has a token's form, and a link has its hash, compared in constant time;</li>
 * <li>the link is not revoked, and its last day, in UTC, has not passed;</li>
 * <li>the link lists the item;</li>
 * <li>its creator, as the user directory has them now, with their groups, still holds
 * {@value ShareLinkService#MANAGE_PERMISSION} on the document, and is still an administrator or a
 * member of a group {@value ShareLinkService#SHARING_GROUPS_PROPERTY} names;</li>
 * <li>the document is there, live, and not in the trash;</li>
 * <li>a rights policy of {@code nuxeo-agentic-assets} covers its type, the asset's rights have not
 * ended, a preview's use included, and the policy allows the item's use as it allows a download:
 * so an ended right, a channel taken off the asset, or a policy that no longer lists the use ends
 * the link for that item;</li>
 * <li>the document has the item, and its file is the one the link was made for: its view of that
 * title, or its original, with the digest the link recorded;</li>
 * <li>the bytes read for it have the SHA-256 the link recorded, and are a JPEG or a PNG the watermark
 * can be drawn on, within its limits: the bytes served are always the marked ones, never the file;</li>
 * <li>the download is logged.</li>
 * </ol>
 * Nothing in a request names a document: the document is the link's, read with a system session.
 * Every refusal is the same to the visitor, and logged here with its reason and the link's label,
 * never its token.
 *
 * <p><strong>Nothing is kept in memory:</strong> each request reads the link, the creator's
 * permission, the document and its rights again, so a revocation, a permission taken away or a
 * right ended holds from the next request on.
 */
public class ShareLinkComponent extends DefaultComponent implements ShareLinkService {

    private static final Logger log = LogManager.getLogger(ShareLinkComponent.class);

    /** How many items are marked at once, at most: each holds a decoded picture in memory. */
    static final int MARKING_AT_ONCE = 2;

    /** How long a request waits for its turn to be marked before it is told to try again. */
    static final long MARKING_WAIT_MILLIS = 2000;

    /**
     * How long a request waits for its link's turn: a link's page asks for each of its pictures at
     * once, and they are marked one after the other.
     */
    static final long LINK_WAIT_MILLIS = 10_000;

    /** How many turns links share: a link always takes the same one, so it holds one at a time. */
    static final int LINK_TURNS = 64;

    /** {@code yyyy-MM-dd}, and nothing else. */
    static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("uuuu-MM-dd")
                                                         .withResolverStyle(ResolverStyle.STRICT);

    private final Clock clock;

    private final ShareLinkStore store;

    private final ShareRepository repository;

    private final Supplier<AssetRightsService> rights;

    private final Watermarker watermarker;

    private final SecureRandom random;

    private final Semaphore marking;

    /**
     * The links' turns: a link marks one item at a time, so that it never holds more than one of the
     * {@link #MARKING_AT_ONCE}; two links may share a turn, and then wait for each other.
     */
    private final Semaphore[] linkTurns = new Semaphore[LINK_TURNS];

    private volatile long markingWaitMillis = MARKING_WAIT_MILLIS;

    private volatile long linkWaitMillis = LINK_WAIT_MILLIS;

    private final Supplier<Set<String>> sharingGroups;

    public ShareLinkComponent() {
        this(Clock.systemUTC(), new DirectoryShareLinkStore(), new ShareRepository.Nuxeo(),
                () -> Framework.getService(AssetRightsService.class), new Watermarker(), new SecureRandom(),
                new Semaphore(MARKING_AT_ONCE), () -> groups(Framework.getProperty(SHARING_GROUPS_PROPERTY, "")));
    }

    /** For tests, which choose the time, the store, the repository, the rights and the groups. */
    ShareLinkComponent(Clock clock, ShareLinkStore store, ShareRepository repository,
            Supplier<AssetRightsService> rights, Watermarker watermarker, SecureRandom random, Semaphore marking,
            Supplier<Set<String>> sharingGroups) {
        this.clock = clock;
        this.store = store;
        this.repository = repository;
        this.rights = rights;
        this.watermarker = watermarker;
        this.random = random;
        this.marking = marking;
        this.sharingGroups = sharingGroups;
        for (int i = 0; i < LINK_TURNS; i++) {
            linkTurns[i] = new Semaphore(1);
        }
    }

    /** For tests, which do not wait seconds for a turn. */
    ShareLinkComponent waits(long marking, long link) {
        this.markingWaitMillis = marking;
        this.linkWaitMillis = link;
        return this;
    }

    /** The groups a comma-separated property names, trimmed; none for an empty one. */
    static Set<String> groups(String property) {
        return property == null ? Set.of()
                : Arrays.stream(property.split(","))
                        .map(String::trim)
                        .filter(group -> !group.isEmpty())
                        .collect(Collectors.toUnmodifiableSet());
    }

    /**
     * Whether this user may give someone outside access: an administrator, or a member of one of
     * {@code groups}. {@code false} for no user.
     */
    static boolean isSharer(NuxeoPrincipal principal, Set<String> groups) {
        if (principal == null) {
            return false;
        }
        if (principal.isAdministrator()) {
            return true;
        }
        List<String> all = principal.getAllGroups();
        return all != null && all.stream().anyMatch(groups::contains);
    }

    @Override
    public Instant now() {
        return clock.instant();
    }

    private LocalDate today() {
        return LocalDate.ofInstant(now(), ZoneOffset.UTC);
    }

    // ----- Signed in: the operations -----

    @Override
    public Creation create(CoreSession session, DocumentModel document, List<String> items, String lastDay) {
        requireManage(session, document);
        if (!isSharer(session.getPrincipal(), sharingGroups.get())) {
            throw new DocumentSecurityException("Share links: only an administrator or a member of a group "
                    + SHARING_GROUPS_PROPERTY + " names makes them");
        }
        if (document.isVersion() || document.isProxy()) {
            throw bad("a version or a proxy is not shared: share its live document");
        }
        if (document.isTrashed()) {
            throw bad("a document in the trash is not shared");
        }
        AssetRightsService service = rightsService();
        RightsPolicy policy = service.policyFor(document.getType());
        if (policy == null) {
            throw bad("no rights policy covers the type " + document.getType() + ", so it is not shared");
        }
        List<ShareItem> chosen = parseItems(items);
        LocalDate day = parseDay(lastDay);
        LocalDate today = today();
        if (day.isBefore(today) || day.isAfter(today.plusDays(MAX_DAYS))) {
            throw bad("a link's last day is from today, " + today + ", to " + MAX_DAYS + " days after it, in UTC");
        }
        Instant now = now();
        List<ShareLink> kept = store.forDocument(document.getId(), MAX_KEPT);
        if (kept.size() >= MAX_KEPT) {
            throw bad("the document has " + MAX_KEPT + " links kept already");
        }
        long open = kept.stream().filter(link -> link.state(now) == ShareLink.State.ACTIVE).count();
        if (open >= MAX_OPEN_LINKS) {
            throw bad("the document has " + MAX_OPEN_LINKS + " open links already: revoke one first");
        }
        List<Refusal> refused = refusals(document, policy, chosen, service, today);
        if (!refused.isEmpty()) {
            return new NotCreated(refused);
        }
        // Each item is bound to the file it has now: its digest, which refusals() saw is there, and
        // the SHA-256 of its bytes.
        Map<String, String> digests = new LinkedHashMap<>();
        Map<String, String> sha256 = new LinkedHashMap<>();
        for (ShareItem item : chosen) {
            Blob blob = blobOf(document, policy, item);
            digests.put(item.id(), blob.getDigest());
            sha256.put(item.id(), sha256(blob));
        }
        String token = ShareToken.generate(random);
        String user = session.getPrincipal().getName();
        ShareLink link = new ShareLink(ShareToken.hash(token), document.getRepositoryName(), document.getId(),
                chosen.stream().map(ShareItem::id).toList(), digests, sha256, day, now, user, null, null);
        store.create(link);
        log.info("Share links: {} made link {} to {} for {}, until {} (UTC)", user, link.label(), document.getId(),
                link.items(), day);
        return new Created(link, token);
    }

    /** Each item the rights refuse now, or the document lacks: a link to it would open nothing. */
    private static List<Refusal> refusals(DocumentModel document, RightsPolicy policy, List<ShareItem> items,
            AssetRightsService service, LocalDate today) {
        List<Refusal> refused = new ArrayList<>();
        AssetFacts facts;
        try {
            facts = service.facts(document, policy);
        } catch (RuntimeException e) {
            log.error("Share links: the rights of {} could not be read, so no link is made", document.getId(), e);
            return items.stream().map(item -> new Refusal(item.id(), Decision.Reason.POLICY_ERROR.code())).toList();
        }
        for (ShareItem item : items) {
            if (facts.ended(today)) {
                refused.add(new Refusal(item.id(), Decision.Reason.RIGHTS_ENDED.code()));
                continue;
            }
            Decision decision = AssetRights.decide(policy, facts, item.use(), today);
            if (!decision.allowed()) {
                refused.add(new Refusal(item.id(), decision.reason().code()));
            } else if (!hasDigest(blobOf(document, policy, item))) {
                // No file, or one Nuxeo did not store with a digest: nothing to bind the link to.
                refused.add(new Refusal(item.id(), "no-such-rendition"));
            }
        }
        return refused;
    }

    @Override
    public List<ShareLink> list(CoreSession session, DocumentModel document) {
        requireManage(session, document);
        Instant now = now();
        List<ShareLink> kept = store.forDocument(document.getId(), MAX_KEPT);
        // Every open link, however old, so that none is out of Revoke's reach; then the newest closed
        // ones, up to MAX_LISTED in all.
        List<ShareLink> listed = new ArrayList<>(
                kept.stream().filter(link -> link.state(now) == ShareLink.State.ACTIVE).toList());
        kept.stream()
            .filter(link -> link.state(now) != ShareLink.State.ACTIVE)
            .limit(Math.max(0, MAX_LISTED - listed.size()))
            .forEach(listed::add);
        listed.sort(Comparator.comparing(ShareLink::created).reversed());
        return listed;
    }

    @Override
    public ShareLink revoke(CoreSession session, DocumentModel document, String id) {
        requireManage(session, document);
        if (!ShareToken.isLinkId(id)) {
            throw bad("not a share link's id");
        }
        Optional<ShareLink> found = store.find(id)
                                         .filter(link -> ShareToken.sameHash(link.id(), id)
                                                 && link.document().equals(document.getId()));
        if (found.isEmpty()) {
            throw new NuxeoException("the document has no share link of this id", 404);
        }
        if (found.get().revoked() != null) {
            return found.get();
        }
        String user = session.getPrincipal().getName();
        ShareLink revoked = store.revoke(id, now(), user)
                                 .orElseThrow(() -> new NuxeoException("the document has no share link of this id", 404));
        log.info("Share links: {} revoked link {} to {}", user, revoked.label(), document.getId());
        return revoked;
    }

    @Override
    public Downloads downloads(CoreSession session, DocumentModel document) {
        requireManage(session, document);
        return store.downloads(document.getId(), MAX_DOWNLOADS);
    }

    private static void requireManage(CoreSession session, DocumentModel document) {
        if (!session.hasPermission(document.getRef(), MANAGE_PERMISSION)) {
            throw new DocumentSecurityException("Share links: " + MANAGE_PERMISSION + " on the document is needed");
        }
    }

    private static List<ShareItem> parseItems(List<String> items) {
        if (items == null || items.isEmpty()) {
            throw bad("a link lists at least one item");
        }
        if (items.size() > MAX_ITEMS) {
            throw bad("a link lists at most " + MAX_ITEMS + " items");
        }
        Set<String> seen = new LinkedHashSet<>();
        List<ShareItem> parsed = new ArrayList<>();
        for (String item : items) {
            ShareItem each;
            try {
                each = ShareItem.parse(item);
            } catch (IllegalArgumentException e) {
                throw bad(e.getMessage());
            }
            if (!seen.add(each.id())) {
                throw bad("an item is listed twice: " + ShareItem.printable(item));
            }
            parsed.add(each);
        }
        return parsed;
    }

    private static LocalDate parseDay(String day) {
        try {
            return LocalDate.parse(day == null ? "" : day, DAY);
        } catch (DateTimeParseException e) {
            throw bad("a link's last day is written yyyy-MM-dd");
        }
    }

    private static NuxeoException bad(String message) {
        return new NuxeoException("Share links: " + message, 400);
    }

    private AssetRightsService rightsService() {
        AssetRightsService service = rights.get();
        if (service == null) {
            throw new NuxeoException("Share links: the asset rights service is not running", 503);
        }
        return service;
    }

    // ----- Not signed in: the servlet -----

    @Override
    public Answer page(String token) {
        return open(token, null);
    }

    @Override
    public Answer serve(String token, String item) {
        return open(token, item == null ? "" : item);
    }

    /**
     * The page when {@code itemId} is {@code null}; the item otherwise. Never throws a
     * {@code RuntimeException}: an {@code Error}, such as running out of memory, reaches the servlet,
     * which answers it with the same refusal.
     */
    private Answer open(String token, String itemId) {
        String label = "?";
        try {
            if (!ShareToken.wellFormed(token)) {
                return refused(Why.MALFORMED, label, itemId);
            }
            String hash = ShareToken.hash(token);
            Optional<ShareLink> found = store.find(hash);
            if (found.isEmpty() || !ShareToken.sameHash(found.get().id(), hash)) {
                return refused(Why.UNKNOWN, label, itemId);
            }
            ShareLink link = found.get();
            label = link.label();
            Instant now = now();
            switch (link.state(now)) {
            case REVOKED:
                return refused(Why.REVOKED, label, itemId);
            case EXPIRED:
                return refused(Why.EXPIRED, label, itemId);
            default:
                break;
            }
            if (itemId != null && !link.items().contains(itemId)) {
                return refused(Why.NOT_LISTED, label, itemId);
            }
            if (!repository.mayShare(link.repository(), link.document(), link.createdBy(), MANAGE_PERMISSION,
                    sharingGroups.get())) {
                return refused(Why.CREATOR_MAY_NOT_SHARE, label, itemId);
            }
            String linkLabel = label;
            return repository.withDocument(link.repository(), link.document(),
                    document -> itemId == null ? page(link, document) : serve(link, document, itemId, now, linkLabel));
        } catch (RuntimeException e) {
            log.error("Share links: a request through link {} could not be answered, so it is refused", label, e);
            return new Refused(Why.ERROR);
        }
    }

    /** What the document and its rights say for every item: {@code null} when they let it through. */
    private Why check(ShareLink link, DocumentModel document, ShareItem item, RightsPolicy policy, AssetFacts facts) {
        if (facts.ended(today())) {
            return Why.RIGHTS_ENDED;
        }
        if (!AssetRights.decide(policy, facts, item.use(), today()).allowed()) {
            return Why.RIGHTS_REFUSED;
        }
        if (blobOf(document, policy, item, link.digests().get(item.id())) == null) {
            return blobOf(document, policy, item) == null ? Why.NO_SUCH_ITEM : Why.CHANGED;
        }
        return null;
    }

    /** The document's own refusals, before any item: {@code null} when it may be shared at all. */
    private Why checkDocument(ShareLink link, DocumentModel document) {
        if (document == null || !link.document().equals(document.getId()) || document.isVersion()
                || document.isProxy() || document.isTrashed()) {
            return Why.DOCUMENT_GONE;
        }
        return null;
    }

    private Answer page(ShareLink link, DocumentModel document) {
        Why gone = checkDocument(link, document);
        if (gone != null) {
            return refused(gone, link.label(), null);
        }
        AssetRightsService service = rights.get();
        RightsPolicy policy = service == null ? null : service.policyFor(document.getType());
        if (policy == null) {
            return refused(Why.NOT_COVERED, link.label(), null);
        }
        AssetFacts facts = facts(service, document, policy);
        if (facts == null) {
            return refused(Why.RIGHTS_REFUSED, link.label(), null);
        }
        if (facts.ended(today())) {
            return refused(Why.RIGHTS_ENDED, link.label(), null);
        }
        List<ShareItem> items = new ArrayList<>();
        for (String id : link.items()) {
            ShareItem item = ShareItem.parse(id);
            if (check(link, document, item, policy, facts) == null) {
                items.add(item);
            }
        }
        // A link whose every item is refused opens nothing, not an empty page.
        return items.isEmpty() ? refused(Why.RIGHTS_REFUSED, link.label(), null) : new Page(link, items);
    }

    private Answer serve(ShareLink link, DocumentModel document, String itemId, Instant now, String label) {
        Why gone = checkDocument(link, document);
        if (gone != null) {
            return refused(gone, label, itemId);
        }
        ShareItem item = ShareItem.parse(itemId);
        AssetRightsService service = rights.get();
        RightsPolicy policy = service == null ? null : service.policyFor(document.getType());
        if (policy == null) {
            return refused(Why.NOT_COVERED, label, itemId);
        }
        AssetFacts facts = facts(service, document, policy);
        if (facts == null) {
            return refused(Why.RIGHTS_REFUSED, label, itemId);
        }
        Why why = check(link, document, item, policy, facts);
        if (why != null) {
            return refused(why, label, itemId);
        }
        Blob blob = blobOf(document, policy, item, link.digests().get(item.id()));
        // One item per link at a time, so that one link cannot hold every turn: its page's pictures
        // wait for each other.
        Semaphore turn = linkTurns[Math.floorMod(link.id().hashCode(), LINK_TURNS)];
        try {
            if (!turn.tryAcquire(linkWaitMillis, TimeUnit.MILLISECONDS)) {
                log.warn("Share links: link {} asked for {} while its turn was taken; told to try again", label,
                        itemId);
                return new Busy();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Busy();
        }
        try {
            return mark(link, item, itemId, blob, now, label);
        } finally {
            turn.release();
        }
    }

    private Answer mark(ShareLink link, ShareItem item, String itemId, Blob blob, Instant now, String label) {
        byte[] marked;
        try {
            if (!marking.tryAcquire(markingWaitMillis, TimeUnit.MILLISECONDS)) {
                log.warn("Share links: link {} asked for {} while {} items were being marked; told to try again", label,
                        itemId, MARKING_AT_ONCE);
                return new Busy();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Busy();
        }
        try {
            byte[] file = watermarker.read(blob);
            // The bytes read are the ones the link was made for, whatever digest the store gives.
            if (!sha256(file).equals(link.sha256().get(itemId))) {
                return refused(Why.CHANGED, label, itemId);
            }
            marked = watermarker.watermark(file, watermarkText(link), link.label());
        } catch (WatermarkException e) {
            Why kind = e.kind() == WatermarkException.Kind.TOO_LARGE ? Why.TOO_LARGE : Why.NOT_AN_IMAGE;
            log.info("Share links: the {} of link {} is not marked ({}), so it is not served", itemId, label,
                    e.getMessage());
            return refused(kind, label, itemId);
        } finally {
            marking.release();
        }
        // Logged before a byte is served: a download that cannot be logged is not served.
        store.logDownload(new ShareDownload(now, link.id(), link.document(), itemId));
        return new Served(link, item, marked, "image/jpeg");
    }

    private static AssetFacts facts(AssetRightsService service, DocumentModel document, RightsPolicy policy) {
        try {
            return service.facts(document, policy);
        } catch (RuntimeException e) {
            log.error("Share links: the rights of {} could not be read, so its link opens nothing", document.getId(),
                    e);
            return null;
        }
    }

    /**
     * The item's file on the document: the policy's original, or the first picture view whose
     * title is the item's, exactly. {@code null} when there is none.
     */
    static Blob blobOf(DocumentModel document, RightsPolicy policy, ShareItem item) {
        try {
            if (item.isOriginal()) {
                return document.getPropertyValue(policy.originalXpath()) instanceof Blob blob ? blob : null;
            }
            Serializable views = document.getPropertyValue("picture:views");
            if (!(views instanceof List<?> list)) {
                return null;
            }
            for (int index = 0; index < list.size(); index++) {
                Serializable title = document.getPropertyValue("picture:views/" + index + "/title");
                if (item.title().equals(title)) {
                    return document.getPropertyValue("picture:views/" + index + "/content") instanceof Blob blob ? blob
                            : null;
                }
            }
            return null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * The item's file, only when it has {@code digest}: the policy's original, or the first view of
     * the item's title with it. {@code null} otherwise, and for no digest.
     */
    static Blob blobOf(DocumentModel document, RightsPolicy policy, ShareItem item, String digest) {
        if (digest == null || digest.isEmpty()) {
            return null;
        }
        try {
            if (item.isOriginal()) {
                return document.getPropertyValue(policy.originalXpath()) instanceof Blob blob
                        && digest.equals(blob.getDigest()) ? blob : null;
            }
            Serializable views = document.getPropertyValue("picture:views");
            if (!(views instanceof List<?> list)) {
                return null;
            }
            for (int index = 0; index < list.size(); index++) {
                Serializable title = document.getPropertyValue("picture:views/" + index + "/title");
                if (item.title().equals(title)
                        && document.getPropertyValue("picture:views/" + index + "/content") instanceof Blob blob
                        && digest.equals(blob.getDigest())) {
                    return blob;
                }
            }
            return null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** The SHA-256 of the blob's bytes, read as a stream, in lowercase hexadecimal. */
    static String sha256(Blob blob) {
        try (java.io.InputStream in = blob.getStream()) {
            java.security.MessageDigest sha256 = java.security.MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            for (int read; (read = in.read(buffer)) > 0;) {
                sha256.update(buffer, 0, read);
            }
            return java.util.HexFormat.of().formatHex(sha256.digest());
        } catch (java.io.IOException | java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("a file could not be read to bind a link to it", e);
        }
    }

    static String sha256(byte[] bytes) {
        try {
            return java.util.HexFormat.of()
                                      .formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static boolean hasDigest(Blob blob) {
        return blob != null && blob.getDigest() != null && !blob.getDigest().isEmpty();
    }

    /** What the watermark says: the link's label and last day, so that a copy names the link it came from. */
    static String watermarkText(ShareLink link) {
        return "SHARED " + link.label() + " UNTIL " + link.lastDay() + " UTC";
    }

    private static Refused refused(Why why, String label, String item) {
        if (why == Why.MALFORMED || why == Why.UNKNOWN) {
            // Every scan of the address would write a line: these are debug only.
            log.debug("Share links: refused a request through an unknown link: {}", why);
        } else {
            log.info("Share links: refused {} of link {}: {}", item == null ? "the page" : ShareItem.printable(item),
                    label, why);
        }
        return new Refused(why);
    }
}
