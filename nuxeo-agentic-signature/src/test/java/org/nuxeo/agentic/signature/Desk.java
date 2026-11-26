/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import java.io.IOException;
import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Supplier;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.impl.UserPrincipal;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * The repository the tests work in, the people who work in it, and the stand-in provider's settings.
 *
 * <pre>
 * /desk            inheritance blocked: alice ReadWrite, bob Read, carol nothing
 *   /desk/cases    the records
 *   /desk/requests bob ReadWrite too: where bob may create a request
 * </pre>
 *
 * So alice may send a case; bob may read it and create a request, and may not send it, since he may
 * not write the case; carol may read nothing.
 */
final class Desk {

    static final String ALICE = "alice";

    static final String BOB = "bob";

    static final String CAROL = "carol";

    static final String ADMINISTRATOR = "Administrator";

    static final String CASES = "/desk/cases";

    static final String REQUESTS = "/desk/requests";

    /** A small PDF, as the stand-in takes. */
    static final byte[] PDF = ("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n")
            .getBytes(StandardCharsets.US_ASCII);

    private Desk() {
    }

    static void create(CoreSession admin) {
        // The repository is emptied between tests, and the store is not: every claim goes with it.
        ((org.nuxeo.runtime.kv.MemKeyValueStore) Framework.getService(org.nuxeo.runtime.kv.KeyValueService.class)
                                                          .getKeyValueStore(SignatureComponent.STORE)).clear();
        DocumentModel desk = admin.createDocument(admin.createDocumentModel("/", "desk", "Workspace"));
        ACP acp = new ACPImpl();
        ACL acl = acp.getOrCreateACL();
        acl.add(new ACE(ALICE, "ReadWrite", true));
        acl.add(new ACE(BOB, "Read", true));
        acl.add(ACE.BLOCK);
        admin.setACP(desk.getRef(), acp, true);
        admin.createDocument(admin.createDocumentModel("/desk", "cases", "Folder"));
        DocumentModel requests = admin.createDocument(admin.createDocumentModel("/desk", "requests", "Folder"));
        ACP requestsAcp = new ACPImpl();
        requestsAcp.getOrCreateACL().add(new ACE(BOB, "ReadWrite", true));
        admin.setACP(requests.getRef(), requestsAcp, true);
        admin.save();
        TransactionHelper.commitOrRollbackTransaction();
        TransactionHelper.startTransaction();
    }

    /** The stand-in provider, in use, talking to the stub with its key and secret. */
    static Map<String, String> configure(StandInStub stub) {
        Map<String, String> properties = new HashMap<>();
        properties.put(SignatureSettings.PROVIDER_PROPERTY, "standin");
        properties.put("nuxeo.agentic.signature.standin.address", stub.address());
        properties.put("nuxeo.agentic.signature.standin.http.allowed", "true");
        properties.put("nuxeo.agentic.signature.standin.apiKey", StandInStub.API_KEY);
        properties.put("nuxeo.agentic.signature.standin.callbackSecret", StandInStub.SECRET);
        use(properties);
        return properties;
    }

    /** The settings every provider reads from now on: these properties, and no environment. */
    static void use(Map<String, String> properties) {
        component().useSettings(new SignatureSettings(properties::get, name -> null));
    }

    static SignatureComponent component() {
        return (SignatureComponent) Framework.getRuntime()
                                             .getComponent("org.nuxeo.agentic.signature");
    }

    // ------------------------------------------------------------------ records and requests

    /** A case with attachments, created as the administrator, whose permissions alice and bob have from /desk. */
    static String newCase(String repository, String name, String... attachments) {
        return inTransaction(() -> CoreInstance.doPrivileged(repository, (CoreSession s) -> {
            DocumentModel doc = s.createDocumentModel(CASES, name, "TestCase");
            doc.setPropertyValue("dc:title", name);
            List<Map<String, Serializable>> files = new ArrayList<>();
            for (String attachment : attachments) {
                Map<String, Serializable> entry = new HashMap<>();
                entry.put("file", (Serializable) pdf(attachment, PDF));
                files.add(entry);
            }
            doc.setPropertyValue("files:files", (Serializable) files);
            return s.createDocument(doc).getId();
        }));
    }

    /** A record of another type, its main file the given bytes and type. */
    static String newRecord(String repository, String type, String name, byte[] content, String mimeType) {
        return inTransaction(() -> CoreInstance.doPrivileged(repository, (CoreSession s) -> {
            DocumentModel doc = s.createDocumentModel(CASES, name, type);
            doc.setPropertyValue("dc:title", name);
            if (content != null && doc.hasSchema("file")) {
                doc.setPropertyValue("file:content", (Serializable) blob(name + ".pdf", content, mimeType));
            }
            if (content != null && !doc.hasSchema("file") && doc.hasSchema("files")) {
                Map<String, Serializable> entry = new HashMap<>();
                entry.put("file", (Serializable) blob(name + ".pdf", content, mimeType));
                doc.setPropertyValue("files:files", (Serializable) List.of(entry));
            }
            return s.createDocument(doc).getId();
        }));
    }

    static Blob pdf(String name, byte[] content) {
        return blob(name, content, "application/pdf");
    }

    static Blob blob(String name, byte[] content, String mimeType) {
        try {
            Blob blob = Blobs.createBlob(content, mimeType);
            blob.setFilename(name);
            return blob;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    static Map<String, Serializable> signer(String name, String email) {
        Map<String, Serializable> signer = new HashMap<>();
        signer.put("name", name);
        signer.put("email", email);
        return signer;
    }

    /** A request not yet created, in the requests folder: its title, record, attachment and signers. */
    static DocumentModel requestModel(CoreSession session, String recordId, String fileName,
            List<Map<String, Serializable>> signers) {
        DocumentModel doc = session.createDocumentModel(REQUESTS, "request", "TestRequest");
        doc.setPropertyValue("dc:title", "Account agreement");
        doc.setPropertyValue(Signatures.DOCUMENT, recordId);
        doc.setPropertyValue(Signatures.FILE_NAME, fileName);
        doc.setPropertyValue(Signatures.SIGNERS, (Serializable) signers);
        doc.setPropertyValue(Signatures.MESSAGE, "Please sign your account agreement.");
        return doc;
    }

    static final List<Map<String, Serializable>> ONE_SIGNER = List.of(signer("Rowan Vale", "rowan.vale@example.com"));

    /** A request sent as the user: the record's attachment, to one signer. */
    static String send(String repository, String user, String recordId, String fileName) {
        return inTransactionAs(repository, user,
                s -> s.createDocument(requestModel(s, recordId, fileName, ONE_SIGNER)).getId());
    }

    // ------------------------------------------------------------------ callbacks

    /** A callback as the stand-in service signs it, answered by the endpoint, as the servlet would. */
    static CallbackEndpoint.Response callback(String repository, String eventId, String type, String envelope,
            String reason) {
        byte[] body = StandInStub.callbackBody(eventId, type, envelope, reason);
        return post(repository, StandInStub.signedHeaders(StandInStub.SECRET, Clock.systemUTC().instant().getEpochSecond(),
                body), body);
    }

    /** A callback with the given headers and body, answered by the endpoint outside the test's transaction. */
    static CallbackEndpoint.Response post(String repository, Map<String, String> headers, byte[] body) {
        return answer(repository, "POST", "/callback/standin", headers, body);
    }

    /** A callback answered by an endpoint whose "now" is the clock's: a test of the window sets it exactly. */
    static CallbackEndpoint.Response post(String repository, Map<String, String> headers, byte[] body, Clock clock) {
        return answer(repository, "POST", "/callback/standin", headers, body, clock);
    }

    static CallbackEndpoint.Response answer(String repository, String method, String path,
            Map<String, String> headers, byte[] body) {
        return answer(repository, method, path, headers, body, Clock.systemUTC());
    }

    static CallbackEndpoint.Response answer(String repository, String method, String path,
            Map<String, String> headers, byte[] body, Clock clock) {
        if (TransactionHelper.isTransactionActiveOrMarkedRollback()) {
            TransactionHelper.commitOrRollbackTransaction();
        }
        try {
            return new CallbackEndpoint(Framework.getService(SignatureService.class), clock, repository)
                    .respond(method, path, headers, body);
        } finally {
            TransactionHelper.startTransaction();
        }
    }

    // ------------------------------------------------------------------ sessions and transactions

    static NuxeoPrincipal principal(String user) {
        return ADMINISTRATOR.equals(user) ? new UserPrincipal(user, List.of("administrators"), false, true)
                : new UserPrincipal(user, List.of("members"), false, false);
    }

    static CoreSession as(String repository, String user) {
        return CoreInstance.getCoreSession(repository, principal(user));
    }

    static <T> T inTransactionAs(String repository, String user, Function<CoreSession, T> work) {
        return inTransaction(() -> work.apply(as(repository, user)));
    }

    /** The refusal a piece of work as the user gets, in a transaction of its own, rolled back. */
    static NuxeoException refusedAs(String repository, String user, Function<CoreSession, ?> work) {
        try {
            inTransactionAs(repository, user, work);
        } catch (NuxeoException e) {
            return e;
        }
        throw new AssertionError("not refused");
    }

    /**
     * Run something in a transaction of its own, committed unless it throws, and rolled back if it
     * does. The test's own transaction is committed first and another started after.
     */
    static <T> T inTransaction(Supplier<T> work) {
        if (TransactionHelper.isTransactionActiveOrMarkedRollback()) {
            TransactionHelper.commitOrRollbackTransaction();
        }
        try {
            return TransactionHelper.runInTransaction(work);
        } finally {
            TransactionHelper.startTransaction();
        }
    }

    /** The document as stored, read by the administrator in a transaction of its own. */
    static DocumentModel stored(String repository, String id) {
        return inTransaction(() -> CoreInstance.doPrivileged(repository, (CoreSession s) -> {
            DocumentModel doc = s.getDocument(new IdRef(id));
            doc.detach(true);
            return doc;
        }));
    }

    /** The versions of a document, oldest first, read by the administrator. */
    static List<DocumentModel> versions(String repository, String id) {
        return inTransaction(() -> CoreInstance.doPrivileged(repository, (CoreSession s) -> {
            List<DocumentModel> versions = new ArrayList<>(s.getVersions(new IdRef(id)));
            for (DocumentModel version : versions) {
                version.detach(true);
            }
            return versions;
        }));
    }

    /** How many requests the repository holds. */
    static long requestCount(String repository) {
        return inTransaction(() -> CoreInstance.doPrivileged(repository,
                (CoreSession s) -> (long) s.query("SELECT * FROM TestRequest WHERE ecm:isVersion = 0").size()));
    }

    static byte[] bytes(Blob blob) {
        try {
            return blob.getByteArray();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
