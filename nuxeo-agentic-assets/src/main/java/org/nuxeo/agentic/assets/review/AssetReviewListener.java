/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.review;

import static org.nuxeo.agentic.assets.review.AssetReviews.AUTHOR_PROPERTY;
import static org.nuxeo.agentic.assets.review.AssetReviews.ENTITY_ID_PROPERTY;
import static org.nuxeo.agentic.assets.review.AssetReviews.ENTITY_PROPERTY;
import static org.nuxeo.agentic.assets.review.AssetReviews.ORIGIN_PROPERTY;
import static org.nuxeo.agentic.assets.review.AssetReviews.PARENT_PROPERTY;
import static org.nuxeo.agentic.assets.review.AssetReviews.XPATH;
import static org.nuxeo.agentic.assets.review.AssetReviews.XPATH_PROPERTY;

import java.util.List;
import java.util.Objects;
import java.util.function.Function;
import java.util.function.Supplier;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.event.CoreEventConstants;
import org.nuxeo.ecm.core.api.event.DocumentEventTypes;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * An asset's review decisions, held on the server: synchronous, in the transaction of the change
 * that fires it, as the user who makes it, or the one a privileged session acts for, as Nuxeo's
 * comment manager opens one to write an annotation. Every refusal marks that transaction for
 * rollback, and is answered with its status and its reason.
 *
 * <ul>
 * <li><strong>An annotation of the review's origin, created,</strong> that is not a well-formed pin
 * ({@link AssetReviews#isHeld}): a round sent back, the review approved or rejected. Refused, 403
 * {@code not-a-reviewer}, unless the person may decide the asset's review ({@link AssetReviews});
 * 403 {@code not-reviewable} when no review policy covers the asset's type; 409 {@code not-live} on a
 * version, a proxy or an asset in the trash; 400 {@code invalid} for anything but a decision of the
 * review's form, on the picture's views, on the asset itself; 409 {@code concluded} once an approval
 * or a rejection has been written. Allowed, the server writes the person as its author, and, once it
 * is created, its entry in the platform's audit, on the asset ({@link ReviewAudit}).</li>
 * <li><strong>A decision changed,</strong> or a pin changed into one, or anything else of the
 * review's origin changed into what is not a pin: its payload, origin, file, the asset it is on or its
 * author. Refused, 403 {@code kept}, whoever asks. Its note, the comment's text, is Nuxeo's to
 * allow.</li>
 * <li><strong>A decision deleted, trashed, moved or copied:</strong> refused, 403 {@code kept}, but
 * an administrator's; imported, refused, 403 {@code server-only}, whoever asks: a decision is made
 * only by writing one.</li>
 * </ul>
 */
public class AssetReviewListener implements EventListener {

    private static final Logger log = LogManager.getLogger(AssetReviewListener.class);

    static final String DOCUMENT_TRASHED = "documentTrashed";

    /**
     * The properties a decision keeps as it was written: among them when it was written, which the
     * page reads the review's order by.
     */
    static final List<String> KEPT = List.of(ENTITY_PROPERTY, ORIGIN_PROPERTY, ENTITY_ID_PROPERTY, XPATH_PROPERTY,
            PARENT_PROPERTY, AUTHOR_PROPERTY, "dc:created", "comment:creationDate");

    /** What a comments folder's documents undergo with it, with no event of their own. */
    static final java.util.Set<String> CONTAINER_EVENTS = java.util.Set.of(DocumentEventTypes.ABOUT_TO_REMOVE,
            DOCUMENT_TRASHED, DocumentEventTypes.ABOUT_TO_MOVE, DocumentEventTypes.ABOUT_TO_COPY);

    private final Supplier<AssetReviewService> reviews;

    public AssetReviewListener() {
        this(() -> Framework.getService(AssetReviewService.class));
    }

    AssetReviewListener(Supplier<AssetReviewService> reviews) {
        this.reviews = reviews;
    }

    @Override
    public void handleEvent(Event event) {
        if (!(event.getContext() instanceof DocumentEventContext context)) {
            return;
        }
        DocumentModel doc = context.getSourceDocument();
        if (doc == null) {
            return;
        }
        String name = event.getName();
        NuxeoPrincipal principal = context.getPrincipal();
        boolean annotation = AssetReviews.isAnnotation(doc);
        boolean commentsFolder = !annotation && AssetReviews.COMMENT_ROOT.equals(doc.getType())
                && CONTAINER_EVENTS.contains(name);
        if (!annotation && !commentsFolder) {
            return;
        }
        DocumentModel previous = DocumentEventTypes.BEFORE_DOC_UPDATE.equals(name)
                && context.getProperty(CoreEventConstants.PREVIOUS_DOCUMENT_MODEL) instanceof DocumentModel p ? p : null;
        boolean held = annotation
                && (AssetReviews.isHeld(doc) || previous != null && AssetReviews.isHeld(previous));
        try {
            if (commentsFolder) {
                commentsFolder(context, doc, name);
                return;
            }
            if (!held) {
                if (DocumentEventTypes.ABOUT_TO_CREATE.equals(name) && AssetReviews.isReview(doc)) {
                    // A pin, anyone's who may comment: its author is the server's too.
                    author(context, doc);
                }
                return;
            }
            switch (name) {
            case DocumentEventTypes.ABOUT_TO_CREATE -> aboutToCreate(context, doc);
            case DocumentEventTypes.DOCUMENT_CREATED -> documentCreated(context, doc);
            case DocumentEventTypes.BEFORE_DOC_UPDATE -> {
                if (!belowAVersion(context, doc)) {
                    kept(previous, doc);
                }
            }
            case DocumentEventTypes.ABOUT_TO_REMOVE, DOCUMENT_TRASHED, DocumentEventTypes.ABOUT_TO_MOVE,
                    DocumentEventTypes.ABOUT_TO_COPY -> {
                if (!administrator(principal) && !(DOCUMENT_TRASHED.equals(name) && assetTrashed(context, doc))) {
                    throw new ReviewRefusal(403, "kept",
                            "A review's decision is kept: only an administrator removes, moves or copies one.");
                }
                if (administrator(principal)) {
                    log.warn("Asset review: {} by {} of the decision {}", name, who(principal), doc.getId());
                }
            }
            case DocumentEventTypes.ABOUT_TO_IMPORT -> {
                if (!administrator(principal)) {
                    throw new ReviewRefusal(403, "server-only",
                            "A review's decision is made by writing it, not imported.");
                }
            }
            default -> {
                // Not an event this listener is contributed for.
            }
            }
        } catch (ReviewRefusal refusal) {
            log.info("Asset review: {} of {} by {} refused, {}: {}", name, describe(doc), who(principal),
                    refusal.getStatusCode(), refusal.getCode());
            fail(event);
            throw refusal;
        } catch (RuntimeException e) {
            log.error("Asset review: {} of {} by {} failed; nothing of it is kept", name, describe(doc),
                    who(principal), e);
            fail(event);
            throw e;
        }
    }

    private static void fail(Event event) {
        TransactionHelper.setTransactionRollbackOnly();
        event.markBubbleException();
    }

    /**
     * An asset's comments folder removed, trashed, moved or copied: the platform does that to its
     * annotations with no event of their own, so it is refused, but an administrator's, while a
     * decision is below it; trashed with its asset, it is allowed, as the platform trashes an asset's
     * documents with it.
     */
    private static void commentsFolder(DocumentEventContext context, DocumentModel folder, String name) {
        NuxeoPrincipal principal = context.getPrincipal();
        if (administrator(principal)) {
            return;
        }
        boolean holds = CoreInstance.doPrivileged(context.getCoreSession(),
                (Function<CoreSession, Boolean>) privileged -> {
                    if (DOCUMENT_TRASHED.equals(name)) {
                        DocumentModel asset = AssetReviews.assetOf(privileged, folder.getParentRef());
                        if (asset != null && asset.isTrashed()) {
                            return false;
                        }
                    }
                    return AssetReviews.holdsDecision(privileged, folder);
                });
        if (holds) {
            throw new ReviewRefusal(403, "kept",
                    "A review's comments folder holding its decisions is kept: only an administrator removes, moves or"
                            + " copies one.");
        }
    }

    /** The person acting written as the annotation's author, whatever the request said. */
    private static void author(DocumentEventContext context, DocumentModel doc) {
        NuxeoPrincipal person = AssetReviews.acting(context.getPrincipal());
        if (person == null) {
            throw new ReviewRefusal(403, "invalid", "A review's annotation is written by a person signed in.");
        }
        doc.setPropertyValue(AUTHOR_PROPERTY, person.getName());
    }

    /**
     * Whether the annotation is below a version of its asset: the platform copies an asset's comments
     * into a version it checks in, then points each copy at the version, which is not a decision
     * changed.
     */
    private static boolean belowAVersion(DocumentEventContext context, DocumentModel doc) {
        return CoreInstance.doPrivileged(context.getCoreSession(), (Function<CoreSession, Boolean>) privileged -> {
            DocumentModel asset = AssetReviews.assetOf(privileged, doc.getParentRef());
            return asset != null && asset.isVersion();
        });
    }

    /** Whether the annotation's asset is in the trash: the platform trashes an asset's documents with it. */
    private static boolean assetTrashed(DocumentEventContext context, DocumentModel doc) {
        return CoreInstance.doPrivileged(context.getCoreSession(), (Function<CoreSession, Boolean>) privileged -> {
            DocumentModel asset = AssetReviews.assetOf(privileged, doc.getParentRef());
            return asset != null && asset.isTrashed();
        });
    }

    /** A decision about to be written: the person, the asset, the policy, the form, the review not concluded. */
    private void aboutToCreate(DocumentEventContext context, DocumentModel doc) {
        NuxeoPrincipal person = AssetReviews.acting(context.getPrincipal());
        if (person == null) {
            throw new ReviewRefusal(403, "not-a-reviewer", "A review is decided by a person signed in.");
        }
        CoreSession session = context.getCoreSession();
        DocumentRef parent = context.getProperty(CoreEventConstants.DESTINATION_REF) instanceof DocumentRef ref ? ref
                : doc.getParentRef();
        Decided decided = CoreInstance.doPrivileged(session, (Function<CoreSession, Decided>) privileged -> {
            DocumentModel asset = AssetReviews.assetOf(privileged, parent);
            if (asset == null) {
                throw new ReviewRefusal(400, "invalid", "A review's decision is written on the asset it decides.");
            }
            ReviewPolicy policy = reviews.get() == null ? null : reviews.get().policyFor(asset.getType());
            ACP acp = privileged.getACP(asset.getRef());
            AssetReviews.Refused refused = AssetReviews.refusal(person, asset, policy, acp);
            if (refused != null) {
                int status = refused == AssetReviews.Refused.NOT_LIVE ? 409 : 403;
                throw new ReviewRefusal(status, refused.code(), AssetReviews.message(refused, policy));
            }
            ReviewPayload payload = AssetReviews.payload(doc);
            if (payload == null || payload.isPin()) {
                throw new ReviewRefusal(400, "invalid",
                        "A review's annotation is a pin, a round sent back, or the review approved or rejected, in"
                                + " the review's form.");
            }
            // On the asset's own comments folder, below the asset, naming the asset: as the page reads it.
            DocumentModel folder = parent == null ? null : privileged.getDocument(parent);
            if (!XPATH.equals(AssetReviews.text(doc, XPATH_PROPERTY))
                    || !Objects.equals(asset.getId(), AssetReviews.text(doc, PARENT_PROPERTY)) || folder == null
                    || !AssetReviews.COMMENT_ROOT.equals(folder.getType())
                    || !new org.nuxeo.ecm.core.api.IdRef(asset.getId()).equals(
                            privileged.getParentDocumentRef(folder.getRef()))) {
                throw new ReviewRefusal(400, "invalid",
                        "A review's decision is written on the asset itself, on its picture's views.");
            }
            if (AssetReviews.concluded(privileged, asset)) {
                throw new ReviewRefusal(409, "concluded", "This review is concluded: it was approved or rejected.");
            }
            return new Decided(asset.getId(), payload);
        });
        // The server's: whoever wrote it, whatever the request said.
        doc.setPropertyValue(AUTHOR_PROPERTY, person.getName());
        log.info("Asset review: {} {} round {} of {}", person.getName(), decided.payload().code(),
                decided.payload().round(), decided.asset());
    }

    /** A decision written: its entry in the platform's audit, on the asset, in this transaction. */
    private void documentCreated(DocumentEventContext context, DocumentModel doc) {
        NuxeoPrincipal person = AssetReviews.acting(context.getPrincipal());
        ReviewPayload payload = AssetReviews.payload(doc);
        if (payload == null || payload.isPin()) {
            return;
        }
        CoreSession session = context.getCoreSession();
        DocumentRef parent = doc.getParentRef();
        CoreInstance.doPrivileged(session, (Function<CoreSession, Void>) privileged -> {
            DocumentModel asset = AssetReviews.assetOf(privileged, parent);
            if (asset == null) {
                throw new IllegalStateException("a review's decision with no asset above it");
            }
            ReviewAudit.fire(privileged, person, asset, payload, doc.getId());
            return null;
        });
    }

    /** A change to an annotation that is, or would become, a decision: only its note may change. */
    private static void kept(DocumentModel previous, DocumentModel doc) {
        if (previous == null) {
            throw new ReviewRefusal(403, "kept", "A review's decision is kept as it was written.");
        }
        for (String xpath : KEPT) {
            if (!Objects.equals(AssetReviews.text(previous, xpath), AssetReviews.text(doc, xpath))) {
                throw new ReviewRefusal(403, "kept", "A review's decision is kept as it was written.");
            }
        }
    }

    /**
     * An administrator acting: one signed in, one a privileged session acts for, as Nuxeo's comment
     * manager opens one to delete a comment, or server code acting for no one. Not a privileged
     * session acting for someone else, which the platform makes an administrator's.
     */
    private static boolean administrator(NuxeoPrincipal principal) {
        NuxeoPrincipal person = AssetReviews.acting(principal);
        return person != null && person.isAdministrator();
    }

    private static String who(NuxeoPrincipal principal) {
        NuxeoPrincipal person;
        try {
            person = AssetReviews.acting(principal);
        } catch (RuntimeException e) {
            person = principal;
        }
        return person == null ? "nobody" : person.getName();
    }

    private static String describe(DocumentModel doc) {
        String id = doc.getId();
        return "an annotation" + (id == null ? "" : " " + id);
    }

    /** What a decision about to be written was decided on. */
    private record Decided(String asset, ReviewPayload payload) {
    }
}
