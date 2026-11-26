/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.nuxeo.agentic.documents.ControlledDocuments.FACET;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_CLASSIFICATION;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_GROUPS;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_SCHEMA;
import static org.nuxeo.agentic.documents.ControlledDocuments.isDocumentId;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.function.Function;
import java.util.regex.Pattern;

import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.platform.usermanager.UserManager;
import org.nuxeo.runtime.api.Framework;

/**
 * A controlled document's export-control mark, since 0.3.0: a classification, such as
 * {@code EC-2}, and the groups that may receive the revision.
 *
 * <ul>
 * <li><strong>Who receives it.</strong> A member of any one of the mark's groups, as the server reads
 * their groups: the person signed in for a download or a rendition, and each recipient, looked up in
 * the user directory, for a transmittal. Nobody is exempt, an administrator included: one who must
 * receive a marked revision is put in a group, or changes the mark, which is audited.</li>
 * <li><strong>Who marks it.</strong> A holder of {@value #PERMISSION} on the revision, or, for a
 * new one, on the folder it is created in: setting, changing and removing a mark alike. The server
 * writes who and when, and audits each change ({@link ExportMarkAudit}).</li>
 * <li><strong>Carried on.</strong> A new revision takes the mark of the one it supersedes, whatever
 * its creator wrote, and a version restored over a revision must carry its mark.</li>
 * </ul>
 *
 * <p>A revision is marked when it has a classification. A mark is read as stored: its classification
 * trimmed, its groups each trimmed, the empty ones left out. A classification with no group is not
 * one the server writes; met on a document, written past the add-on as an import writes, it refuses
 * everyone, as a mark no one is in does. Groups with no classification are no mark, and the server
 * writes none.
 */
public final class ExportMarks {

    /** The add-on's permission: setting, changing or removing a revision's mark needs it. */
    public static final String PERMISSION = "ChangeExportMark";

    /** The renditions a container still serves when it holds a marked revision: its thumbnail. */
    static final String THUMBNAIL_RENDITION = "thumbnail";

    static final String COLLECTION_FACET = "Collection";

    /** At most this many groups on one mark. */
    static final int MAX_GROUPS = 20;

    /** A classification: capitals and digits, in parts joined by single hyphens, 32 characters at most. */
    static final Pattern CLASSIFICATION = Pattern.compile("(?=.{1,32}$)[A-Z0-9]+(?:-[A-Z0-9]+)*");

    /** A group's name, as Nuxeo's group directory writes one: letters, digits and {@code @ . _ + -}. */
    static final Pattern GROUP = Pattern.compile("[A-Za-z0-9@._+-]{1,128}");

    /** Why a use of a marked revision is refused: the codes the enricher writes and a client translates. */
    enum Reason {
        /** The person is in none of the mark's groups. */
        NOT_IN_GROUPS("not-in-groups"),
        /** The mark has a classification and no group. */
        INCOMPLETE("mark-incomplete"),
        /** A container's rendition, which would hold a marked revision's bytes. */
        HOLDS_MARKED("holds-marked"),
        /** The mark, or the live document's, could not be read. */
        UNREADABLE("mark-unreadable");

        final String code;

        Reason(String code) {
            this.code = code;
        }
    }

    /** A mark as stored: {@link #NONE} when the revision is not marked. */
    record Mark(String classification, List<String> groups) {

        static final Mark NONE = new Mark(null, List.of());

        boolean isMarked() {
            return classification != null;
        }

        boolean isComplete() {
            return classification != null && !groups.isEmpty();
        }

        /** How a refusal names it: {@code EC-2, for ec2-recipients}. */
        String describe() {
            return classification + ", for " + (groups.isEmpty() ? "no group" : String.join(", ", groups));
        }
    }

    /** A decision on one use: allowed, or refused for a reason, with the mark that refused it. */
    record Decision(boolean allowed, Reason reason, Mark mark) {

        static final Decision ALLOWED = new Decision(true, null, Mark.NONE);

        static Decision refuse(Reason reason, Mark mark) {
            return new Decision(false, reason, mark);
        }
    }

    private ExportMarks() {
    }

    // ------------------------------------------------------------------ reading a mark

    /** The document's own mark, as stored; {@link Mark#NONE} for one without the schema. */
    static Mark read(DocumentModel doc) {
        if (doc == null || !doc.hasSchema(MARK_SCHEMA)) {
            return Mark.NONE;
        }
        String classification = Stored.text(doc, MARK_SCHEMA, MARK_CLASSIFICATION);
        List<String> groups = List.copyOf(new LinkedHashSet<>(Stored.texts(doc, MARK_SCHEMA, MARK_GROUPS)));
        return classification == null && groups.isEmpty() ? Mark.NONE : new Mark(classification, groups);
    }

    /**
     * What is wrong with a mark a person writes, or {@code null} when nothing is: a classification
     * of its form and 1 to {@value #MAX_GROUPS} groups of a name's form, or neither, for no mark.
     * Whether each group exists is {@link #missingGroup}'s.
     */
    static String problem(Mark mark) {
        if (mark.classification() == null) {
            return mark.groups().isEmpty() ? null
                    : "An export-control mark needs a classification, in " + MARK_CLASSIFICATION
                            + ", with its groups: remove both to remove the mark";
        }
        if (!CLASSIFICATION.matcher(mark.classification()).matches()) {
            return "A classification is capitals and digits, in parts joined by hyphens, such as EC-2, 32 "
                    + "characters at most";
        }
        if (mark.groups().isEmpty()) {
            return "An export-control mark names, in " + MARK_GROUPS + ", 1 to " + MAX_GROUPS
                    + " groups that may receive the revision";
        }
        if (mark.groups().size() > MAX_GROUPS) {
            return "An export-control mark names " + MAX_GROUPS + " groups at most";
        }
        for (String group : mark.groups()) {
            if (!GROUP.matcher(group).matches()) {
                return "A group is named by its group name: letters, digits and @ . _ + -";
            }
            if (SecurityConstants.EVERYONE.equalsIgnoreCase(group)
                    || SecurityConstants.SYSTEM_USERNAME.equalsIgnoreCase(group)) {
                return "An export-control mark names groups of people, not " + group;
            }
        }
        return null;
    }

    /** The first of the mark's groups the user directory does not have, or {@code null}. */
    static String missingGroup(Mark mark) {
        UserManager users = users();
        for (String group : mark.groups()) {
            if (Framework.doPrivileged(() -> users.getGroup(group)) == null) {
                return group;
            }
        }
        return null;
    }

    // ------------------------------------------------------------------ who receives it

    /** Whether the person is in one of the mark's groups. A mark that is not whole has no one in it. */
    static boolean receives(NuxeoPrincipal person, Mark mark) {
        if (!mark.isMarked()) {
            return true;
        }
        if (!mark.isComplete() || person == null) {
            return false;
        }
        NuxeoPrincipal who = person;
        String originating = person.getOriginatingUser();
        if (SecurityConstants.SYSTEM_USERNAME.equals(person.getName()) && originating != null && !originating.isBlank()
                && !originating.equals(person.getName())) {
            // Server code acting for someone, in a privileged session: their groups, not the system's.
            who = person(originating);
            if (who == null) {
                return false;
            }
        }
        List<String> groups = who.getAllGroups();
        if (groups == null) {
            return false;
        }
        for (String group : mark.groups()) {
            if (groups.contains(group)) {
                return true;
            }
        }
        return false;
    }

    /** The user of that name, with their groups, as the user directory has them; {@code null} for none. */
    static NuxeoPrincipal person(String username) {
        UserManager users = users();
        return Framework.doPrivileged(() -> users.getPrincipal(username));
    }

    private static UserManager users() {
        UserManager users = Framework.getService(UserManager.class);
        if (users == null) {
            throw new IllegalStateException("Controlled documents: the user manager is not running");
        }
        return users;
    }

    // ------------------------------------------------------------------ deciding a download

    /**
     * Whether {@code person} may have the document's file or its rendition, {@code rendition} its
     * name or {@code null} for a file.
     *
     * <ul>
     * <li>A controlled document, live, a version or a proxy: refused when its own mark, or its live
     * document's, read with a privileged session, has none of the person's groups. A version keeps
     * the mark it had when it was made; its live document's is the one in force now.</li>
     * <li>A folder's or a collection's rendition, but its thumbnail: refused when the person's own
     * session finds below it, or among its members, a marked controlled document, a proxy or a
     * version of any, a collection, or, for a collection, a folder, since the platform's container
     * renditions zip what they hold.</li>
     * <li>Anything else is not this add-on's.</li>
     * </ul>
     *
     * Throws when a mark, or what a container holds, cannot be read: the caller refuses then.
     */
    static Decision decide(DocumentModel doc, String rendition, NuxeoPrincipal person) {
        if (doc == null) {
            return Decision.ALLOWED;
        }
        if (doc.hasFacet(FACET)) {
            List<Mark> marks = new ArrayList<>();
            marks.add(read(doc));
            if (doc.isVersion() || doc.isProxy()) {
                marks.add(read(liveDocument(doc)));
            }
            for (Mark mark : marks) {
                if (!mark.isMarked()) {
                    continue;
                }
                if (!mark.isComplete()) {
                    return Decision.refuse(Reason.INCOMPLETE, mark);
                }
                if (!receives(person, mark)) {
                    return Decision.refuse(Reason.NOT_IN_GROUPS, mark);
                }
            }
            return Decision.ALLOWED;
        }
        if (rendition == null || THUMBNAIL_RENDITION.equals(rendition)) {
            return Decision.ALLOWED;
        }
        if ((doc.isFolder() || doc.hasFacet(COLLECTION_FACET)) && holdsMarked(doc)) {
            return Decision.refuse(Reason.HOLDS_MARKED, Mark.NONE);
        }
        return Decision.ALLOWED;
    }

    /** The live document of a version or a proxy, read with a privileged session. */
    static DocumentModel liveDocument(DocumentModel document) {
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
     * Whether the container holds a marked controlled document, or another container a container's
     * rendition would go into: below it, or, for a collection, among its members, as the person's own
     * session finds them. That refuses more than it must, never less: a folder holding a collection
     * refuses its renditions, whatever the collection holds.
     */
    static boolean holdsMarked(DocumentModel container) {
        CoreSession session = container.getCoreSession();
        if (session == null) {
            throw new IllegalStateException("a container with no session to query");
        }
        return !session.queryProjection(containerQuery(container), 1, 0).isEmpty();
    }

    /** The query {@link #holdsMarked} asks: one document is enough. */
    static String containerQuery(DocumentModel container) {
        String id = container.getId();
        if (!isDocumentId(id)) {
            throw new IllegalStateException("not written into a query: " + id);
        }
        // A proxy or a version is decided by its live document's mark too, which the query cannot
        // read: any of a controlled document counts, which refuses more than it must, never less.
        String marked = "(ecm:mixinType = '" + FACET + "' AND (" + MARK_CLASSIFICATION
                + " IS NOT NULL OR ecm:isProxy = 1 OR ecm:isVersion = 1))";
        String below = "ecm:ancestorId = '" + id + "'";
        if (!container.hasFacet(COLLECTION_FACET)) {
            return "SELECT ecm:uuid FROM Document WHERE " + below + " AND (" + marked + " OR ecm:mixinType = '"
                    + COLLECTION_FACET + "')";
        }
        String members = "collectionMember:collectionIds/* = '" + id + "'";
        return "SELECT ecm:uuid FROM Document WHERE (" + below + " OR " + members + ") AND (" + marked
                + " OR ecm:mixinType IN ('" + COLLECTION_FACET + "', 'Folderish'))";
    }
}
