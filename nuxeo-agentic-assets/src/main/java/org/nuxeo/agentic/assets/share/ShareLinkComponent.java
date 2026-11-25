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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

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
 * <li>its creator, as the user directory has them now, still holds {@value ShareLinkService#MANAGE_PERMISSION}
 * on the document;</li>
 * <li>the document is there, live, and not in the trash;</li>
 * <li>a rights policy of {@code nuxeo-agentic-assets} covers its type, the asset's rights have not
 * ended, a preview's use included, and the policy allows the item's use as it allows a download:
 * so an ended right, a channel taken off the asset, or a policy that no longer lists the use ends
 * the link for that item;</li>
 * <li>the document has the item: its view of that title, or its original;</li>
 * <li>the item is a JPEG or a PNG the watermark can be drawn on, within its size: the bytes served
 * are always the marked ones, never the file;</li>
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

    public ShareLinkComponent() {
        this(Clock.systemUTC(), new DirectoryShareLinkStore(), new ShareRepository.Nuxeo(),
                () -> Framework.getService(AssetRightsService.class), new Watermarker(), new SecureRandom(),
                new Semaphore(MARKING_AT_ONCE));
    }

    /** For tests, which choose the time, the store, the repository and the rights. */
    ShareLinkComponent(Clock clock, ShareLinkStore store, ShareRepository repository,
            Supplier<AssetRightsService> rights, Watermarker watermarker, SecureRandom random, Semaphore marking) {
        this.clock = clock;
        this.store = store;
        this.repository = repository;
        this.rights = rights;
        this.watermarker = watermarker;
        this.random = random;
        this.marking = marking;
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
        long open = store.forDocument(document.getId(), MAX_LISTED)
                         .stream()
                         .filter(link -> link.state(now) == ShareLink.State.ACTIVE)
                         .count();
        if (open >= MAX_OPEN_LINKS) {
            throw bad("the document has " + MAX_OPEN_LINKS + " open links already: revoke one first");
        }
        List<Refusal> refused = refusals(document, policy, chosen, service, today);
        if (!refused.isEmpty()) {
            return new NotCreated(refused);
        }
        String token = ShareToken.generate(random);
        String user = session.getPrincipal().getName();
        ShareLink link = new ShareLink(ShareToken.hash(token), document.getRepositoryName(), document.getId(),
                chosen.stream().map(ShareItem::id).toList(), day, now, user, null, null);
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
            } else if (blobOf(document, policy, item) == null) {
                refused.add(new Refusal(item.id(), "no-such-rendition"));
            }
        }
        return refused;
    }

    @Override
    public List<ShareLink> list(CoreSession session, DocumentModel document) {
        requireManage(session, document);
        return store.forDocument(document.getId(), MAX_LISTED);
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

    /** The page when {@code itemId} is {@code null}; the item otherwise. Never throws. */
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
            if (!repository.hasPermission(link.repository(), link.document(), link.createdBy(), MANAGE_PERMISSION)) {
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
        return blobOf(document, policy, item) == null ? Why.NO_SUCH_ITEM : null;
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
        Blob blob = blobOf(document, policy, item);
        byte[] marked;
        try {
            if (!marking.tryAcquire(MARKING_WAIT_MILLIS, TimeUnit.MILLISECONDS)) {
                log.warn("Share links: link {} asked for {} while {} items were being marked; told to try again", label,
                        itemId, MARKING_AT_ONCE);
                return new Busy();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Busy();
        }
        try {
            marked = watermarker.watermark(blob, watermarkText(link));
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
