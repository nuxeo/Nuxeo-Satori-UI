/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.review;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.function.Function;

import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.IdRef;

/**
 * Nuxeo's own annotations, written to the repository as the platform's comment manager writes them,
 * so that the add-on's listener sees in the tests what it sees on the server.
 *
 * <p>Read from {@code TreeCommentManager} and {@code Comments} in {@code nuxeo-platform-comment}
 * 2025.10.18, the local server's, read only: {@code createComment} checks that the user may read the
 * document annotated, then, in a privileged session opened on the user's behalf
 * ({@code CoreInstance.doPrivileged}), creates an {@code Annotation} in the document's
 * {@code Comments} folder, a {@code CommentRoot} it creates the first time, with
 * {@code comment:author}, the user, {@code comment:text}, {@code comment:parentId},
 * {@code comment:ancestorIds}, {@code annotation:xpath}, and the {@code ExternalEntity} facet's
 * {@code externalEntity:entityId}, {@code origin} and {@code entity}, set before
 * {@code createDocument}. The manager itself needs relations, notifications and more, which the
 * tests do not start; the documents add-on's tests write comments the same way.
 */
final class ReviewAnnotations {

    static final String ORIGIN = AssetReviews.ORIGIN;

    static final String XPATH = AssetReviews.XPATH;

    private ReviewAnnotations() {
    }

    /** An annotation by the session's user on the document with that id. */
    static DocumentModel write(CoreSession user, String documentId, String xpath, String origin, String entity,
            String text) {
        if (!user.hasPermission(new IdRef(documentId), "Read")) {
            throw new DocumentSecurityException(
                    "The user " + user.getPrincipal().getName() + " can not create comments on document " + documentId);
        }
        String author = user.getPrincipal().getName();
        return CoreInstance.doPrivileged(user, (Function<CoreSession, DocumentModel>) s -> {
            DocumentModel parent = s.getDocument(new IdRef(documentId));
            DocumentRef location = s.getOrCreateDocument(
                    s.createDocumentModel(parent.getPathAsString(), "Comments", "CommentRoot")).getRef();
            DocumentModel annotation = s.createDocumentModel(s.getDocument(location).getPathAsString(), "annotation",
                    "Annotation");
            annotation.setPropertyValue("comment:author", author);
            annotation.setPropertyValue("comment:text", text);
            annotation.setPropertyValue("comment:creationDate", Calendar.getInstance());
            annotation.setPropertyValue("comment:parentId", documentId);
            List<String> ancestors = new ArrayList<>(List.of(documentId));
            annotation.setPropertyValue("comment:ancestorIds", (Serializable) ancestors);
            annotation.setPropertyValue("annotation:xpath", xpath);
            if (origin != null) {
                annotation.addFacet("ExternalEntity");
                annotation.setPropertyValue("externalEntity:entityId", "review-" + System.nanoTime());
                annotation.setPropertyValue("externalEntity:origin", origin);
                annotation.setPropertyValue("externalEntity:entity", entity);
            }
            return s.createDocument(annotation);
        });
    }

    /** A review annotation, on the picture's views, of the review's origin. */
    static DocumentModel review(CoreSession user, String documentId, String entity) {
        return write(user, documentId, XPATH, ORIGIN, entity, "note");
    }

    static String pin(int round, double x, double y) {
        return "{\"kind\":\"pin\",\"version\":1,\"round\":" + round + ",\"x\":" + x + ",\"y\":" + y + "}";
    }

    static String sendBack(int round) {
        return "{\"kind\":\"round-closed\",\"version\":1,\"round\":" + round + "}";
    }

    static String decision(int round, String decision) {
        return "{\"kind\":\"decision\",\"version\":1,\"round\":" + round + ",\"decision\":\"" + decision + "\"}";
    }
}
