/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.review;

import java.io.Serializable;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.platform.usermanager.UserManager;
import org.nuxeo.runtime.api.Framework;

/**
 * An asset's review decided on the server: who may send a round back, approve or reject it.
 *
 * <p>The review is the asset page's (layout-v2.md, "Review"): Nuxeo's own annotations on the asset,
 * of the origin {@value #ORIGIN}, on {@value #XPATH}. A pin is anyone's whom Nuxeo lets comment on
 * the asset, as before. <strong>Everything else of that origin is a decision,</strong> a round sent
 * back, the review approved or rejected, and needs, all three:
 *
 * <ol>
 * <li>a review policy for the asset's type ({@code org.nuxeo.agentic.assets.review}), naming its
 * reviewer groups;</li>
 * <li>the person in one of those groups, as the user directory has them;</li>
 * <li>the add-on's permission, {@value #PERMISSION}, granted on the asset, its own or inherited,
 * to the person or a group of theirs, and read from the asset's permissions by this class, not by
 * the platform's permission check: so neither an administrator, whom the platform lets do anything,
 * nor a holder of {@code Everything}, which every user has on their own workspace, holds it unless
 * it is granted. A denial of it, or of {@code Everything}, met first in the asset's permissions,
 * refuses.</li>
 * </ol>
 *
 * The groups narrow who may ever decide, at the server's configuration; the permission says on
 * which assets, at each folder's. Neither alone is enough: whoever manages a folder's permissions
 * may grant the permission there, themselves included, and a group alone would let its members
 * decide everywhere.
 */
public final class AssetReviews {

    /** The add-on's permission: deciding an asset's review needs it on the asset. */
    public static final String PERMISSION = "ReviewAsset";

    /** The origin the asset page's review writes on its annotations. */
    public static final String ORIGIN = "nuxeo-satori.review";

    /** The file the review's annotations are on: the picture's views. */
    public static final String XPATH = "picture:views";

    static final String COMMENT_SCHEMA = "comment";

    static final String ANNOTATION_SCHEMA = "annotation";

    static final String EXTERNAL_ENTITY_FACET = "ExternalEntity";

    static final String COMMENT_ROOT = "CommentRoot";

    static final String ORIGIN_PROPERTY = "externalEntity:origin";

    static final String ENTITY_PROPERTY = "externalEntity:entity";

    static final String ENTITY_ID_PROPERTY = "externalEntity:entityId";

    static final String XPATH_PROPERTY = "annotation:xpath";

    static final String PARENT_PROPERTY = "comment:parentId";

    static final String AUTHOR_PROPERTY = "comment:author";

    /** What a document id may be, to be written into a query: anything else refuses. */
    private static final Pattern QUERY_SAFE = Pattern.compile("[A-Za-z0-9_.:-]{1,64}");

    /** How far up from an annotation its asset is looked for: a reply's reply's, and more. */
    private static final int MAX_DEPTH = 64;

    /** Why a person may not decide a review: the codes the enricher writes and a client translates. */
    public enum Refused {
        /** No review policy covers the asset's type. */
        NOT_REVIEWABLE("not-reviewable"),
        /** The person is in none of the policy's groups, or is not granted the permission on the asset. */
        NOT_A_REVIEWER("not-a-reviewer"),
        /** A version, a proxy, or an asset in the trash. */
        NOT_LIVE("not-live");

        private final String code;

        Refused(String code) {
            this.code = code;
        }

        public String code() {
            return code;
        }
    }

    private AssetReviews() {
    }

    // ------------------------------------------------------------------ the review's annotations

    /** Whether {@code doc} is one of Nuxeo's annotations: a comment with the annotation schema. */
    static boolean isAnnotation(DocumentModel doc) {
        return doc != null && doc.hasSchema(ANNOTATION_SCHEMA) && doc.hasSchema(COMMENT_SCHEMA);
    }

    /** Whether {@code doc} is an annotation of the review's origin. */
    static boolean isReview(DocumentModel doc) {
        return isAnnotation(doc) && ORIGIN.equals(text(doc, ORIGIN_PROPERTY));
    }

    /** The payload of a review annotation; {@code null} for one that is none of the review's three. */
    static ReviewPayload payload(DocumentModel doc) {
        return ReviewPayload.read(text(doc, ENTITY_PROPERTY));
    }

    /**
     * Whether the server holds {@code doc} to the permission: an annotation of the review's origin
     * that is not a well-formed pin. A decision, and anything else that is not a pin, so that nothing
     * but a pin is written past the permission, however its payload is spelled.
     */
    static boolean isHeld(DocumentModel doc) {
        if (!isReview(doc)) {
            return false;
        }
        ReviewPayload payload = payload(doc);
        return payload == null || !payload.isPin();
    }

    /** The text at {@code xpath}, or {@code null} when the document has none there or no such field. */
    static String text(DocumentModel doc, String xpath) {
        try {
            if (xpath.startsWith("externalEntity:") && !doc.hasFacet(EXTERNAL_ENTITY_FACET)
                    && !doc.hasSchema("externalEntity")) {
                return null;
            }
            Serializable value = doc.getPropertyValue(xpath);
            return value instanceof String text ? text : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * The document a review annotation is on: the first of its ancestors, from {@code parent} up, that
     * is neither a comment nor a comments folder, as the asset page's review finds its annotations,
     * below the asset. {@code null} when there is none.
     */
    static DocumentModel assetOf(CoreSession privileged, DocumentRef parent) {
        if (parent == null) {
            return null;
        }
        DocumentModel at = privileged.getDocument(parent);
        for (int depth = 0; at != null && depth < MAX_DEPTH; depth++) {
            if (!at.hasSchema(COMMENT_SCHEMA) && !COMMENT_ROOT.equals(at.getType())) {
                return at;
            }
            DocumentRef up = at.getParentRef();
            at = up == null ? null : privileged.getDocument(up);
        }
        return null;
    }

    /**
     * Whether the asset's review is already concluded: an approval or a rejection written on it, as
     * the asset page reads the review, below the asset, naming the asset, on its views, not in the
     * trash. One copied below another asset with its comments folder names the asset it was written
     * on, and is not that one's.
     */
    static boolean concluded(CoreSession privileged, DocumentModel asset) {
        String id = querySafe(asset.getId());
        String query = "SELECT " + ENTITY_PROPERTY + " FROM Document WHERE ecm:mixinType = '" + EXTERNAL_ENTITY_FACET
                + "' AND ecm:ancestorId = '" + id + "' AND " + PARENT_PROPERTY + " = '" + id + "' AND "
                + ORIGIN_PROPERTY + " = '" + ORIGIN + "' AND " + XPATH_PROPERTY + " = '" + XPATH
                + "' AND ecm:isTrashed = 0 AND ecm:isVersion = 0 AND ecm:isProxy = 0";
        for (Map<String, Serializable> row : privileged.queryProjection(query, 0, 0)) {
            Serializable entity = row.get(ENTITY_PROPERTY);
            ReviewPayload payload = ReviewPayload.read(entity instanceof String text ? text : null);
            if (payload != null && payload.kind() == ReviewPayload.Kind.DECISION) {
                return true;
            }
        }
        return false;
    }

    /**
     * Whether a decision, or anything else of the review's origin that is not a pin, is below
     * {@code container}, wherever it was written: what removing, moving or copying the container would
     * take with it.
     */
    static boolean holdsDecision(CoreSession privileged, DocumentModel container) {
        String id = querySafe(container.getId());
        String query = "SELECT " + ENTITY_PROPERTY + " FROM Document WHERE ecm:mixinType = '" + EXTERNAL_ENTITY_FACET
                + "' AND ecm:ancestorId = '" + id + "' AND " + ORIGIN_PROPERTY + " = '" + ORIGIN + "'";
        for (Map<String, Serializable> row : privileged.queryProjection(query, 0, 0)) {
            Serializable entity = row.get(ENTITY_PROPERTY);
            ReviewPayload payload = ReviewPayload.read(entity instanceof String text ? text : null);
            if (payload == null || !payload.isPin()) {
                return true;
            }
        }
        return false;
    }

    private static String querySafe(String id) {
        if (id == null || !QUERY_SAFE.matcher(id).matches()) {
            throw new IllegalStateException("not written into a query: " + id);
        }
        return id;
    }

    // ------------------------------------------------------------------ who may decide

    /**
     * Who is acting: the user signed in, or, for a privileged session server code opened on a user's
     * behalf, as Nuxeo's comment manager opens one to write a comment, that user, read from the user
     * directory with their groups. {@code null} when no one can be named; the system itself, acting
     * for no one, is named, and decides no review.
     */
    static NuxeoPrincipal acting(NuxeoPrincipal principal) {
        if (principal == null) {
            return null;
        }
        String originating = principal.getOriginatingUser();
        if (SecurityConstants.SYSTEM_USERNAME.equals(principal.getName()) && originating != null
                && !originating.isBlank() && !originating.equals(principal.getName())) {
            UserManager users = Framework.getService(UserManager.class);
            if (users == null) {
                return null;
            }
            return Framework.doPrivileged(() -> users.getPrincipal(originating));
        }
        return principal;
    }

    /** The names the asset's permissions are matched against for {@code person}: theirs, their groups', everyone's. */
    static Set<String> principalsOf(NuxeoPrincipal person) {
        Set<String> names = new LinkedHashSet<>();
        names.add(person.getName());
        List<String> groups = person.getAllGroups();
        if (groups != null) {
            names.addAll(groups);
        }
        names.add(SecurityConstants.EVERYONE);
        return names;
    }

    /**
     * Whether the permissions grant {@value #PERMISSION} to one of {@code principals}: the first entry
     * in force, in the order the platform reads them, the document's own then those it inherits, that
     * names one of them and grants the permission, or denies it or {@code Everything}, decides. Neither
     * {@code Everything} granted nor being an administrator counts.
     */
    static boolean holdsPermission(ACP acp, Set<String> principals) {
        if (acp == null) {
            return false;
        }
        for (ACL acl : acp.getACLs()) {
            for (ACE ace : acl.getACEs()) {
                if (!ace.isEffective() || !principals.contains(ace.getUsername())) {
                    continue;
                }
                String permission = ace.getPermission();
                if (ace.isDenied() && (PERMISSION.equals(permission) || SecurityConstants.EVERYTHING.equals(permission))) {
                    return false;
                }
                if (ace.isGranted() && PERMISSION.equals(permission)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Whether {@code person} may decide the review of {@code asset}, whose permissions are
     * {@code acp}, under {@code policy}: {@code null} when they may, else why not.
     */
    static Refused refusal(NuxeoPrincipal person, DocumentModel asset, ReviewPolicy policy, ACP acp) {
        if (policy == null) {
            return Refused.NOT_REVIEWABLE;
        }
        if (asset.isVersion() || asset.isProxy() || asset.isTrashed()) {
            return Refused.NOT_LIVE;
        }
        if (person == null || SecurityConstants.SYSTEM_USERNAME.equals(person.getName())) {
            return Refused.NOT_A_REVIEWER;
        }
        List<String> groups = person.getAllGroups();
        boolean inGroup = groups != null && policy.groups().stream().anyMatch(groups::contains);
        if (!inGroup || !holdsPermission(acp, principalsOf(person))) {
            return Refused.NOT_A_REVIEWER;
        }
        return null;
    }

    /** What the refusal says to the person, naming the policy's groups, which are the server's configuration. */
    static String message(Refused refused, ReviewPolicy policy) {
        return switch (refused) {
        case NOT_REVIEWABLE -> "This document's review is not decided here: no review policy covers its type.";
        case NOT_LIVE -> "A review is decided on the asset itself: not on a version, a proxy or an asset in the trash.";
        case NOT_A_REVIEWER -> "Deciding this review needs the " + PERMISSION
                + " permission on the asset, granted to a member of "
                + (policy.groups().isEmpty() ? "a reviewer group, and its policy names none"
                        : String.join(", ", policy.groups()))
                + ".";
        };
    }
}
