/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.IdRef;

/**
 * Nuxeo's own comments, written to the repository as the platform's comment manager writes them,
 * so that the add-on's listener sees in the tests what it sees on the server.
 *
 * <p>Read from {@code TreeCommentManager} in {@code nuxeo-platform-comment} 2025.10.18, the local
 * server's, and 11.5.154, the tests', the same in both: {@code createComment} runs in a privileged
 * session opened on the user's behalf ({@code CoreInstance.doPrivileged}), after checking that the
 * user may read the document commented on; a comment on a document goes in its {@code Comments}
 * folder, a {@code CommentRoot} it creates the first time, and a reply goes below the comment it
 * answers; the comment is a {@code Comment} document with {@code comment:author}, the user,
 * {@code comment:text}, {@code comment:parentId} and {@code comment:ancestorIds}, set before
 * {@code createDocument}; then the document commented on, the thread's top, is saved with the
 * comment's text in its related text. The manager itself needs relations, notifications and the
 * user manager, which the tests do not start.
 */
final class Comments {

    private Comments() {
    }

    /** A comment by the session's user on the document, or a reply to the comment, with that id. */
    static DocumentModel write(CoreSession user, String parentId, String text) {
        if (!user.hasPermission(new IdRef(parentId), "Read")) {
            throw new org.nuxeo.ecm.core.api.DocumentSecurityException("The user " + user.getPrincipal().getName()
                    + " can not create comments on document " + parentId);
        }
        String author = user.getPrincipal().getName();
        return CoreInstance.doPrivileged(user, (CoreSession s) -> {
            DocumentModel parent = s.getDocument(new IdRef(parentId));
            DocumentRef location = parent.hasSchema("comment") ? parent.getRef()
                    : s.getOrCreateDocument(s.createDocumentModel(parent.getPathAsString(), "Comments", "CommentRoot"))
                       .getRef();
            DocumentModel comment = s.createDocumentModel(s.getDocument(location).getPathAsString(), "comment",
                    "Comment");
            comment.setPropertyValue("comment:author", author);
            comment.setPropertyValue("comment:text", text);
            comment.setPropertyValue("comment:creationDate", Calendar.getInstance());
            comment.setPropertyValue("comment:parentId", parentId);
            comment.setPropertyValue("comment:ancestorIds", (Serializable) ancestors(s, parentId));
            comment = s.createDocument(comment);
            DocumentModel top = top(s, parent);
            top.addFacet("HasRelatedText");
            List<Map<String, String>> related = new ArrayList<>();
            related.add(Map.of("relatedtextid", "commentRelatedTextId_" + comment.getId(), "relatedtext", text));
            top.setPropertyValue("relatedtext:relatedtextresources", (Serializable) related);
            top.putContextData("disableDublinCoreListener", Boolean.TRUE);
            s.saveDocument(top);
            return comment;
        });
    }

    /** The comment's ancestors, as the manager computes them: the parent, its parents, up to the top. */
    private static List<String> ancestors(CoreSession s, String parentId) {
        Set<String> ids = new LinkedHashSet<>();
        String id = parentId;
        while (id != null && ids.add(id)) {
            DocumentModel doc = s.getDocument(new IdRef(id));
            id = doc.hasSchema("comment") ? (String) doc.getPropertyValue("comment:parentId") : null;
        }
        return new ArrayList<>(ids);
    }

    private static DocumentModel top(CoreSession s, DocumentModel doc) {
        DocumentModel top = doc;
        while (top.hasSchema("comment")) {
            top = s.getDocument(new IdRef((String) top.getPropertyValue("comment:parentId")));
        }
        return top;
    }
}
