/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.io.download.DownloadService;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.ecm.core.query.sql.model.OrderByExprs;
import org.nuxeo.ecm.core.query.sql.model.Predicates;
import org.nuxeo.ecm.core.query.sql.model.QueryBuilder;
import org.nuxeo.ecm.platform.usermanager.UserManager;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.api.login.LoginComponent;

/**
 * The people and groups the export-control tests work with, in the user directory, and the calls
 * they make: a mark written, a download and a rendition asked of the platform's download service as
 * a person, and the audit's entries read.
 *
 * <pre>
 * group ec1-recipients: bob, erin
 * group ec2-recipients: alice, dave, erin
 * carol: in neither
 * /library/drawings: alice ChangeExportMark (and ReadWrite, from the library)
 * </pre>
 *
 * The folders are {@link Library}'s: alice writes the drawings, bob reads them, carol does not.
 */
final class Marks {

    static final String EC1 = "ec1-recipients";

    static final String EC2 = "ec2-recipients";

    private Marks() {
    }

    /** The groups and the people, in the user directory, made once. */
    static void people() {
        UserManager users = Framework.getService(UserManager.class);
        Framework.doPrivileged(() -> {
            for (String group : List.of(EC1, EC2)) {
                if (users.getGroup(group) == null) {
                    DocumentModel model = users.getBareGroupModel();
                    model.setProperty(users.getGroupSchemaName(), "groupname", group);
                    users.createGroup(model);
                }
            }
            person(users, Library.ALICE, List.of(EC2));
            person(users, Library.BOB, List.of(EC1));
            person(users, Library.CAROL, List.of());
            person(users, Library.DAVE, List.of(EC2));
            person(users, Library.ERIN, List.of(EC1, EC2));
        });
    }

    private static void person(UserManager users, String name, List<String> groups) {
        DocumentModel existing = users.getUserModel(name);
        if (existing != null) {
            existing.setProperty(users.getUserSchemaName(), "groups", new ArrayList<>(groups));
            users.updateUser(existing);
            return;
        }
        DocumentModel model = users.getBareUserModel();
        model.setProperty(users.getUserSchemaName(), "username", name);
        model.setProperty(users.getUserSchemaName(), "groups", new ArrayList<>(groups));
        users.createUser(model);
    }

    /** {@code user} given the add-on's permission on the document at {@code path}, by the administrator. */
    static void grantMarking(CoreSession admin, String path, String user) {
        DocumentModel doc = admin.getDocument(new PathRef(path));
        ACP acp = doc.getACP();
        acp.getOrCreateACL().add(new ACE(user, ExportMarks.PERMISSION, true));
        admin.setACP(doc.getRef(), acp, true);
        admin.save();
    }

    /** The document's mark written as the session's user: none when {@code classification} is null. */
    static DocumentModel mark(CoreSession session, String id, String classification, List<String> groups) {
        DocumentModel doc = session.getDocument(new IdRef(id));
        doc.setPropertyValue(ControlledDocuments.MARK_CLASSIFICATION, classification);
        doc.setPropertyValue(ControlledDocuments.MARK_GROUPS, groups == null ? null : (Serializable) groups);
        return session.saveDocument(doc);
    }

    /** A new drawing in the folder, with a file, marked as its creator writes it. */
    static DocumentModel drawing(CoreSession session, String folder, String name, String classification,
            List<String> groups) {
        DocumentModel doc = session.createDocumentModel(folder, name, Library.DRAWING);
        doc.setPropertyValue("dc:title", name);
        doc.setPropertyValue(ControlledDocuments.SERIES, "DWG");
        doc.setPropertyValue("file:content", (Serializable) file(name));
        if (classification != null || groups != null) {
            doc.setPropertyValue(ControlledDocuments.MARK_CLASSIFICATION, classification);
            doc.setPropertyValue(ControlledDocuments.MARK_GROUPS, (Serializable) groups);
        }
        return session.createDocument(doc);
    }

    static Blob file(String name) {
        Blob blob = Blobs.createBlob("The drawing " + name + ", in bytes.", "text/plain");
        blob.setFilename(name + ".txt");
        return blob;
    }

    /** The person as the server reads them: from the user directory, with their groups. */
    static NuxeoPrincipal person(String name) {
        UserManager users = Framework.getService(UserManager.class);
        return Framework.doPrivileged(() -> users.getPrincipal(name));
    }

    /**
     * Whether the platform's download service lets {@code user}, signed in, download the file at
     * {@code xpath} of the document as stored, as {@code /nxfile/} and the REST API's {@code @blob}
     * ask it.
     */
    static boolean downloads(String repository, String id, String xpath, String user) {
        return downloads(repository, id, xpath, user, "download");
    }

    /** The same, for the platform's {@code reason}: {@code download}, {@code preview}, {@code view}. */
    static boolean downloads(String repository, String id, String xpath, String user, String reason) {
        DocumentModel doc = readAs(repository, id, user);
        // blobholder:0 is the main file's other address, as the platform hands it over.
        Blob blob = (Blob) doc.getPropertyValue(xpath.startsWith("blobholder:") ? "file:content" : xpath);
        return signedIn(user, () -> download().checkPermission(doc, xpath, blob, reason, Map.of()));
    }

    /**
     * The document as the person reads it, with their own session, as the REST API reads it before
     * it hands it to the download service; as the administrator reads it for one who may not read it,
     * which no endpoint would do, so that the decision is still asked.
     */
    static DocumentModel readAs(String repository, String id, String user) {
        try {
            return Library.inTransactionAs(repository, user, s -> s.getDocument(new IdRef(id)));
        } catch (DocumentSecurityException e) {
            return Library.stored(repository, id);
        }
    }

    /**
     * Whether it lets {@code user} have the document's rendition of that name, as the REST API's
     * {@code @rendition} asks it: no xpath, the rendition's name in its extended information.
     */
    static boolean rendition(String repository, String id, String rendition, String user) {
        DocumentModel doc = readAs(repository, id, user);
        Blob blob = file(rendition);
        return signedIn(user, () -> download().checkPermission(doc, null, blob, "rendition",
                Map.of("rendition", rendition)));
    }

    /** Run something with {@code user} signed in, as the platform's login stack holds them. */
    static <T> T signedIn(String user, java.util.function.Supplier<T> work) {
        LoginComponent.pushPrincipal(person(user));
        try {
            return work.get();
        } finally {
            LoginComponent.popPrincipal();
        }
    }

    private static DownloadService download() {
        return Framework.getService(DownloadService.class);
    }

    /** The audit's entries of a mark's changes on the document, in the audit's order. */
    static List<LogEntry> entries(String id) {
        QueryBuilder query = new QueryBuilder();
        query.predicate(Predicates.eq("eventId", ExportMarkAudit.EVENT));
        query.and(Predicates.eq("docUUID", id));
        query.order(OrderByExprs.asc("id"));
        List<LogEntry> entries = new ArrayList<>();
        for (Object entry : AuditAccess.reader().queryLogs(query)) {
            entries.add((LogEntry) entry);
        }
        return entries;
    }

    static Map<String, Object> extended(LogEntry entry) {
        return AuditAccess.extended(entry);
    }
}
