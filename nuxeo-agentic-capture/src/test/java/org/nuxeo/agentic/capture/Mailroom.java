/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;

import org.nuxeo.agentic.capture.ai.AiPackageProvider;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.core.api.impl.UserPrincipal;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.event.EventService;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * The tests' mailroom: the people, the places, the claims, the letters, and how a test acts as
 * someone in a transaction of its own. Every name, number and address is fictional.
 *
 * <ul>
 * <li>{@value #ALICE}, a claims handler: writes the inbox and the claims.</li>
 * <li>{@value #BOB}, a reviewer: writes the inbox, and only reads the claims.</li>
 * <li>{@value #CAROL}, the scanner's account: adds to the inbox, and reads nothing else of it.</li>
 * <li>{@value #DAVE}: reads, and writes nothing.</li>
 * </ul>
 */
final class Mailroom {

    static final String ALICE = "alice";

    static final String BOB = "bob";

    static final String CAROL = "carol";

    static final String DAVE = "dave";

    static final String ADMINISTRATOR = "Administrator";

    static final String INBOX = "/desk/inbox";

    static final String NOTES_INBOX = "/desk/notes-inbox";

    static final String CLAIMS = "/desk/claims";

    static final String PRIVATE = "/desk/private";

    static final String ELSEWHERE = "/elsewhere";

    /** The fictional sender, whose name, address and telephone no log may hold. */
    static final String SENDER = "Rowan Vale";

    static final String SENDER_ADDRESS = "12 Ashgrove Lane, Fernbridge";

    static final String SENDER_PHONE = "555-0142";

    private Mailroom() {
    }

    /** The provider named, and the AI provider's switch, each cleared when {@code null}; every other setting cleared. */
    static void settings(String provider, String aiEnabled) {
        set(CaptureSettings.PROVIDER_PROPERTY, provider);
        set(AiPackageProvider.ENABLED_PROPERTY, aiEnabled);
        set(AiPackageProvider.CLASSIFY_PROPERTY, null);
        set(AiPackageProvider.EXTRACT_PROPERTY, null);
        set(CaptureSettings.MAX_BYTES_PROPERTY, null);
    }

    static void set(String name, String value) {
        if (value == null) {
            Framework.getProperties().remove(name);
        } else {
            Framework.getProperties().setProperty(name, value);
        }
    }

    static void create(CoreSession admin) {
        folder(admin, "/", "desk", "Folder");
        folder(admin, "/desk", "inbox", "TestInbox");
        folder(admin, "/desk", "notes-inbox", "TestNoteInbox");
        folder(admin, "/desk", "claims", "Folder");
        folder(admin, "/desk", "private", "Folder");
        folder(admin, "/desk", "notes", "Folder");
        folder(admin, "/", "elsewhere", "Folder");
        grant(admin, "/desk", false, ALICE, "Read", BOB, "Read", CAROL, "Read", DAVE, "Read");
        grant(admin, INBOX, false, ALICE, "ReadWrite", BOB, "ReadWrite", CAROL, "AddChildren");
        grant(admin, NOTES_INBOX, false, ALICE, "ReadWrite", CAROL, "AddChildren");
        grant(admin, CLAIMS, false, ALICE, "ReadWrite");
        grant(admin, "/desk/notes", false, ALICE, "ReadWrite");
        grant(admin, PRIVATE, true);
        grant(admin, ELSEWHERE, false, ALICE, "ReadWrite");
        claim(admin, CLAIMS, "pc-24001", "PC-24001", "Kitchen fire");
        claim(admin, CLAIMS, "pc-24002", "PC-24002", "Burst pipe");
        claim(admin, CLAIMS, "pc-24005-a", "PC-24005", "Hail damage");
        claim(admin, CLAIMS, "pc-24005-b", "PC-24005", "Hail damage, again");
        claim(admin, PRIVATE, "pc-24007", "PC-24007", "Theft");
        claim(admin, ELSEWHERE, "pc-24009", "PC-24009", "Wind");
        DocumentModel note = admin.createDocumentModel("/desk/notes", "note-24001", "TestNote");
        note.setPropertyValue("dc:title", "A note");
        note.setPropertyValue("tclaim:number", "PC-24001");
        admin.createDocument(note);
        admin.save();
    }

    private static void folder(CoreSession admin, String parent, String name, String type) {
        DocumentModel folder = admin.createDocumentModel(parent, name, type);
        folder.setPropertyValue("dc:title", name);
        admin.createDocument(folder);
    }

    /** Grants, by user and permission in pairs; {@code block} keeps everything above out. */
    private static void grant(CoreSession admin, String path, boolean block, String... grants) {
        ACP acp = admin.getACP(new PathRef(path));
        ACL acl = acp.getOrCreateACL();
        for (int i = 0; i < grants.length; i += 2) {
            acl.add(new ACE(grants[i], grants[i + 1], true));
        }
        if (block) {
            acl.add(ACE.BLOCK);
        }
        admin.setACP(new PathRef(path), acp, true);
    }

    private static void claim(CoreSession admin, String parent, String name, String number, String title) {
        DocumentModel claim = admin.createDocumentModel(parent, name, "TestClaim");
        claim.setPropertyValue("dc:title", title);
        claim.setPropertyValue("tclaim:number", number);
        admin.createDocument(claim);
    }

    static String claimId(CoreSession admin, String name) {
        for (String parent : List.of(CLAIMS, PRIVATE, ELSEWHERE)) {
            if (admin.exists(new PathRef(parent + "/" + name))) {
                return admin.getDocument(new PathRef(parent + "/" + name)).getId();
            }
        }
        throw new AssertionError("no claim " + name);
    }

    /** A claim letter's text; {@code keywords} of its three phrases kept, so 3 is a share of 1, 2 of 0.67. */
    static String letter(String claimNumber, int keywords) {
        StringBuilder text = new StringBuilder("Northgate Mutual, a fictional insurer\n");
        text.append("From: ").append(SENDER).append('\n');
        text.append("Address: ").append(SENDER_ADDRESS).append('\n');
        text.append("Telephone: ").append(SENDER_PHONE).append('\n');
        if (claimNumber != null) {
            text.append("Claim number: ").append(claimNumber).append('\n');
        }
        if (keywords >= 2) {
            text.append("Policy number: POL-PC-1001\n");
        }
        if (keywords >= 3) {
            text.append("Date of loss: 2026-10-02\n");
        }
        text.append("Re: the repairs to the kitchen, after the fire.\n");
        return text.toString();
    }

    static Blob file(String text, String name) {
        Blob blob = Blobs.createBlob(text, "text/plain", StandardCharsets.UTF_8.name(), name);
        return blob;
    }

    static DocumentModel model(CoreSession session, String inbox, String name, Blob file) {
        DocumentModel item = session.createDocumentModel(inbox, name, "TestMail");
        item.setPropertyValue("dc:title", name);
        if (file != null) {
            item.setPropertyValue("file:content", (Serializable) file);
        }
        return item;
    }

    /** A letter put into an inbox by {@code user}, committed, and its capture finished: its id. */
    static String mail(String repository, String user, String inbox, String name, String text) {
        String id = inTransactionAs(repository, user,
                s -> s.createDocument(model(s, inbox, name, file(text, name + ".txt"))).getId());
        settle();
        return id;
    }

    /** Every capture and audit entry in the background, finished. */
    static void settle() {
        boolean active = TransactionHelper.isTransactionActiveOrMarkedRollback();
        if (active) {
            TransactionHelper.commitOrRollbackTransaction();
        }
        try {
            Framework.getService(EventService.class).waitForAsyncCompletion();
        } finally {
            if (active) {
                TransactionHelper.startTransaction();
            }
        }
    }

    /** A person's change to an item, saved as them in a transaction of its own; then the background settles. */
    static void decide(String repository, String user, String itemId, Consumer<DocumentModel> change) {
        inTransactionAs(repository, user, s -> {
            DocumentModel item = s.getDocument(new IdRef(itemId));
            change.accept(item);
            return s.saveDocument(item);
        });
        settle();
    }

    static NuxeoException refusedDecision(String repository, String user, String itemId,
            Consumer<DocumentModel> change) {
        return refusedAs(repository, user, s -> {
            DocumentModel item = s.getDocument(new IdRef(itemId));
            change.accept(item);
            return s.saveDocument(item);
        });
    }

    static void field(DocumentModel item, String name, String value) {
        List<Map<String, Serializable>> fields = new java.util.ArrayList<>(Captures.entries(item, Captures.FIELDS));
        fields.removeIf(f -> name.equals(f.get("name")));
        if (value != null) {
            fields.add(new java.util.HashMap<>(Map.of("name", name, "value", value)));
        }
        item.setPropertyValue(Captures.FIELDS, (Serializable) fields);
    }

    static String value(DocumentModel item, String xpath, String name) {
        for (Map<String, Serializable> field : Captures.entries(item, xpath)) {
            if (name.equals(field.get("name"))) {
                return (String) field.get("value");
            }
        }
        return null;
    }

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
        return inTransactionAs(repository, ADMINISTRATOR, s -> {
            DocumentModel doc = s.getDocument(new IdRef(id));
            doc.detach(true);
            return doc;
        });
    }

    static List<Map<String, Serializable>> attachments(String repository, String recordId) {
        return Captures.entries(stored(repository, recordId), Captures.ATTACHMENTS);
    }

    static long count(String repository, String query) {
        return inTransactionAs(repository, ADMINISTRATOR, s -> (long) s.query(query).size());
    }
}
