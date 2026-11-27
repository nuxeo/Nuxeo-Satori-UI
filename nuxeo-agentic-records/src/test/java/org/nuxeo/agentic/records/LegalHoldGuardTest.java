package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;
import static org.nuxeo.agentic.records.Fixtures.commit;
import static org.nuxeo.agentic.records.Fixtures.rollback;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import org.junit.Before;
import org.junit.Test;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.PropertyException;
import org.nuxeo.ecm.core.api.VersioningOption;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.core.api.security.impl.ACLImpl;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;
import org.nuxeo.ecm.core.api.trash.TrashService;
import org.nuxeo.runtime.api.Framework;

/**
 * A legal hold on the server: what the platform refuses of a held record, and what the add-on
 * refuses beyond it ({@link HoldListener}). Each refusal is the server's, whoever asks: a records
 * manager holding every permission on the record, and an administrator.
 *
 * <ul>
 * <li><b>rita</b>, a records manager: every permission on the cases' folder, ManageLegalHold among
 * them.</li>
 * <li><b>the administrator</b>, the test's own session.</li>
 * </ul>
 */
public class LegalHoldGuardTest extends DispositionTestCase {

    static final String CASES = "/held-cases";

    static final String MANAGER = "rita";

    /** The platform's switch that lets administrators delete what it keeps. */
    static final String ALLOW_DELETE_UNDELETABLE = "org.nuxeo.core.allowDeleteUndeletableDocuments";

    private DocumentModel record;

    @Before
    public void setUpCases() {
        DocumentModel cases = session.createDocument(session.createDocumentModel("/", CASES.substring(1), "Folder"));
        ACP acp = new ACPImpl();
        ACL acl = new ACLImpl(ACL.LOCAL_ACL);
        acl.add(new ACE(MANAGER, SecurityConstants.EVERYTHING, true));
        acp.addACL(acl);
        session.setACP(cases.getRef(), acp, true);
        record = held(CASES, "dispute-2002", "Dispute 2002");
        settled();
    }

    /**
     * Commits, and waits for the work a commit starts, such as a file's text extracted for the
     * search, which would otherwise update a record a test then deletes.
     */
    private void settled() {
        commit(session);
        coreFeature.waitForAsyncCompletion();
    }

    /** A File with a main file and an attachment, made a record and put under a legal hold. */
    DocumentModel held(String folder, String name, String title) {
        DocumentModel doc = session.createDocumentModel(folder, name, "File");
        doc.setPropertyValue("dc:title", title);
        doc.setPropertyValue("file:content", (Serializable) Blobs.createBlob("The statement.", "text/plain"));
        doc.setPropertyValue("files:files", (Serializable) attachments("The customer's letter."));
        doc = session.createDocument(doc);
        session.makeRecord(doc.getRef());
        session.setLegalHold(doc.getRef(), true, "The customer disputes the charge");
        return session.getDocument(doc.getRef());
    }

    static List<Map<String, Serializable>> attachments(String text) {
        List<Map<String, Serializable>> files = new ArrayList<>();
        Map<String, Serializable> file = new HashMap<>();
        file.put("file", (Serializable) Blobs.createBlob(text, "text/plain"));
        files.add(file);
        return files;
    }

    /** The add-on's refusal, its status and its sentence; fails when it was not refused, or by something else. */
    static DispositionRefusal refusal(Supplier<?> action) {
        return refused(DispositionRefusal.class, action);
    }

    /** The platform's own refusal, its security policy's: a 403 before any event. */
    static DocumentSecurityException platformRefusal(Supplier<?> action) {
        DocumentSecurityException refused = refused(DocumentSecurityException.class, action);
        assertEquals(403, refused.getStatusCode());
        return refused;
    }

    static <T extends RuntimeException> T refused(Class<T> type, Supplier<?> action) {
        try {
            action.get();
        } catch (RuntimeException e) {
            rollback();
            if (type.isInstance(e)) {
                return type.cast(e);
            }
            throw new AssertionError("refused, but not with a " + type.getSimpleName() + ": " + e, e);
        }
        rollback();
        fail("Not refused");
        return null;
    }

    static void assertHeld(DispositionRefusal refusal, String message) {
        assertEquals(LegalHolds.HELD, refusal.getCode());
        assertEquals(409, refusal.getStatusCode());
        assertEquals(message, refusal.getMessage());
    }

    private CoreSession manager() {
        return Fixtures.as(session, MANAGER);
    }

    private static void trash(CoreSession as, DocumentRef ref) {
        Framework.getService(TrashService.class).trashDocument(as.getDocument(ref));
    }

    // --- Deletion and the trash ---------------------------------------------------------------------

    /**
     * Demo step 5: a legal hold blocks a deletion, on the server. A records manager holding every
     * permission is refused by the platform itself, whose security policy takes Remove away on a held
     * document; an administrator, whom that policy does not stop, by the add-on, before the
     * repository's own refusal.
     */
    @Test
    public void aHeldRecordIsNotDeletedByAnyone() {
        DocumentSecurityException person = platformRefusal(() -> {
            manager().removeDocument(record.getRef());
            return null;
        });
        assertTrue(person.getMessage(), person.getMessage().contains("Missing permission 'Remove'"));
        assertTrue(session.exists(record.getRef()));
        assertHeld(refusal(() -> {
            session.removeDocument(record.getRef());
            return null;
        }), LegalHolds.RECORD_HELD);
        assertTrue(session.exists(record.getRef()));
        // Released, it is deleted as any record is.
        session.setLegalHold(record.getRef(), false, "Settled");
        settled();
        manager().removeDocument(record.getRef());
        settled();
        assertFalse(session.exists(record.getRef()));
    }

    /**
     * Nor put in the trash. The platform refuses a person's, as a deletion; an administrator's it lets
     * through, the trash being a property, and the add-on refuses.
     */
    @Test
    public void aHeldRecordIsNotPutInTheTrashByAnyone() {
        platformRefusal(() -> {
            trash(manager(), record.getRef());
            return null;
        });
        assertFalse(session.getDocument(record.getRef()).isTrashed());
        assertHeld(refusal(() -> {
            trash(session, record.getRef());
            return null;
        }), LegalHolds.RECORD_HELD);
        assertFalse(session.getDocument(record.getRef()).isTrashed());
        session.setLegalHold(record.getRef(), false, "Settled");
        settled();
        trash(manager(), record.getRef());
        settled();
        assertTrue(session.getDocument(record.getRef()).isTrashed());
    }

    /** Nor the folder that holds one, at any depth, which would take it along. */
    @Test
    public void aFolderHoldingAHeldRecordIsNotDeletedNorPutInTheTrash() {
        DocumentModel sub = session.createDocument(session.createDocumentModel(CASES, "disputes", "Folder"));
        DocumentModel year = session.createDocument(session.createDocumentModel(sub.getPathAsString(), "2026", "Folder"));
        DocumentModel inside = held(year.getPathAsString(), "dispute-2003", "Dispute 2003");
        session.setLegalHold(record.getRef(), false, "Settled");
        settled();
        for (DocumentModel folder : List.of(year, sub)) {
            for (CoreSession as : List.of(manager(), session)) {
                assertHeld(refusal(() -> {
                    as.removeDocument(folder.getRef());
                    return null;
                }), LegalHolds.FOLDER_HELD);
                trashRefused(as, folder, inside);
            }
        }
        assertTrue(session.exists(inside.getRef()));
        assertFalse(session.getDocument(inside.getRef()).isTrashed());
        // Its hold released, the folder goes.
        session.setLegalHold(inside.getRef(), false, "Settled");
        settled();
        manager().removeDocument(sub.getRef());
        settled();
        assertFalse(session.exists(inside.getRef()));
    }

    /**
     * The trash of a folder refused. Not refused, its background work would put the held record in
     * the trash after it as the person, which the record's own check refuses, again and again: the
     * hold is released first, so that the run ends, and the test fails.
     */
    private void trashRefused(CoreSession as, DocumentModel folder, DocumentModel inside) {
        RuntimeException refused = null;
        try {
            trash(as, folder.getRef());
        } catch (RuntimeException refusal) {
            refused = refusal;
        }
        rollback();
        if (refused == null) {
            session.setLegalHold(inside.getRef(), false, "The test failed");
            settled();
            fail("The trash of " + folder.getPathAsString() + " was not refused");
        }
        if (!(refused instanceof DispositionRefusal refusal)) {
            throw new AssertionError("refused, but not by the add-on: " + refused, refused);
        }
        assertHeld(refusal, LegalHolds.FOLDER_HELD);
        assertFalse(session.getDocument(folder.getRef()).isTrashed());
    }

    // --- Its files, and the rest -------------------------------------------------------------------

    /** Its files are kept: its main file and its attachments, replaced or removed, by anyone. */
    @Test
    public void aHeldRecordsFilesAreNotChanged() {
        for (CoreSession as : List.of(manager(), session)) {
            DocumentModel attachments = as.getDocument(record.getRef());
            attachments.setPropertyValue("files:files", (Serializable) attachments("Another letter."));
            assertHeld(refusal(() -> as.saveDocument(attachments)), LegalHolds.FILES_HELD);

            DocumentModel none = as.getDocument(record.getRef());
            none.setPropertyValue("files:files", (Serializable) List.of());
            assertHeld(refusal(() -> as.saveDocument(none)), LegalHolds.FILES_HELD);

            DocumentModel replaced = as.getDocument(record.getRef());
            replaced.setPropertyValue("file:content", (Serializable) Blobs.createBlob("Another statement."));
            assertHeld(refusal(() -> as.saveDocument(replaced)), LegalHolds.FILES_HELD);

            DocumentModel removed = as.getDocument(record.getRef());
            removed.setPropertyValue("file:content", null);
            assertHeld(refusal(() -> as.saveDocument(removed)), LegalHolds.FILES_HELD);
        }
        DocumentModel stored = session.getDocument(record.getRef());
        assertEquals("The statement.", text((Blob) stored.getPropertyValue("file:content")));
        assertEquals(1, ((List<?>) stored.getPropertyValue("files:files")).size());
    }

    /** Its other properties stay editable, as the platform keeps them: a hold keeps what it holds. */
    @Test
    public void aHeldRecordsOtherPropertiesStayEditable() {
        DocumentModel doc = manager().getDocument(record.getRef());
        doc.setPropertyValue("dc:title", "Dispute 2002, under investigation");
        doc.setPropertyValue("dc:description", "Raised by the customer on 2 March.");
        manager().saveDocument(doc);
        settled();
        DocumentModel stored = session.getDocument(record.getRef());
        assertEquals("Dispute 2002, under investigation", stored.getPropertyValue("dc:title"));
        assertTrue(stored.hasLegalHold());
        assertEquals("The statement.", text((Blob) stored.getPropertyValue("file:content")));
    }

    /** Restoring it to a version, which would write its files over, the platform refuses on any record. */
    @Test
    public void aHeldRecordIsNotRestoredToAVersion() {
        DocumentModel doc = session.createDocumentModel(CASES, "dispute-2004", "File");
        doc.setPropertyValue("dc:title", "Dispute 2004");
        doc.setPropertyValue("file:content", (Serializable) Blobs.createBlob("The first statement."));
        doc = session.createDocument(doc);
        DocumentRef version = session.checkIn(doc.getRef(), VersioningOption.MINOR, "First");
        session.makeRecord(doc.getRef());
        session.setLegalHold(doc.getRef(), true, "The customer disputes the charge");
        settled();
        DocumentModel live = doc;
        PropertyException refused = refused(PropertyException.class,
                () -> session.restoreToVersion(live.getRef(), version));
        assertTrue(refused.getMessage(), refused.getMessage().startsWith("Version cannot be restored on a record"));
        assertTrue(session.getDocument(live.getRef()).hasLegalHold());
    }

    /** A record under no hold is the platform's alone: its files change, and it goes to the trash. */
    @Test
    public void aRecordUnderNoHoldIsNotTheGuards() {
        DocumentModel doc = session.createDocumentModel(CASES, "dispute-2005", "File");
        doc.setPropertyValue("dc:title", "Dispute 2005");
        doc = session.createDocument(doc);
        session.makeRecord(doc.getRef());
        settled();
        DocumentModel edited = manager().getDocument(doc.getRef());
        edited.setPropertyValue("files:files", (Serializable) attachments("A letter."));
        manager().saveDocument(edited);
        settled();
        trash(manager(), doc.getRef());
        settled();
        assertTrue(session.getDocument(doc.getRef()).isTrashed());
    }

    /**
     * Whom the platform lets delete what it keeps, it lets through the add-on's guard too: here, an
     * administrator while the server's org.nuxeo.core.allowDeleteUndeletableDocuments is on, as the
     * test framework turns it on to empty the repository; and the members of NuxeoRecordCleaners
     * outside compliance mode, by the same call. The add-on makes no exception of its own.
     */
    @Test
    public void whomThePlatformLetsDeleteWhatItKeepsPassesTheGuardToo() {
        Framework.getProperties().put(ALLOW_DELETE_UNDELETABLE, "true");
        try {
            session.removeDocument(record.getRef());
            settled();
        } finally {
            Framework.getProperties().remove(ALLOW_DELETE_UNDELETABLE);
        }
        assertFalse(session.exists(record.getRef()));
    }

    /** A proxy of a held record is not the record: it may go. */
    @Test
    public void aProxyOfAHeldRecordMayBeRemoved() {
        DocumentModel published = session.createDocument(session.createDocumentModel(CASES, "published", "Folder"));
        DocumentModel proxy = session.createProxy(record.getRef(), published.getRef());
        settled();
        assertNotNull(proxy);
        assertTrue(proxy.isProxy());
        session.removeDocument(proxy.getRef());
        settled();
        assertFalse(session.exists(proxy.getRef()));
        assertTrue(session.exists(record.getRef()));
    }

    /**
     * A live proxy writes the files of the record it stands for: a change to them through a proxy of
     * a held record is refused as the record's own, and the record keeps its files.
     */
    @Test
    public void aHeldRecordsFilesAreNotChangedThroughALiveProxyOfIt() {
        DocumentModel published = session.createDocument(session.createDocumentModel(CASES, "published", "Folder"));
        DocumentModel proxy = session.createProxy(record.getRef(), published.getRef());
        settled();
        assertTrue(proxy.isProxy());
        assertFalse("a live proxy, which writes its record's files", proxy.isVersion());
        DispositionRefusal refused = refusal(() -> {
            DocumentModel through = session.getDocument(proxy.getRef());
            through.setPropertyValue("files:files", (Serializable) attachments("Another letter."));
            return session.saveDocument(through);
        });
        assertHeld(refused, LegalHolds.FILES_HELD);
        List<?> files = (List<?>) session.getDocument(record.getRef()).getPropertyValue("files:files");
        assertEquals(1, files.size());
    }

    /**
     * Whom the platform lets delete what it keeps is exempt from the guard on a deletion only, as
     * the platform's own exemption is: the trash and the files stay held for them too.
     */
    @Test
    public void whomThePlatformLetsDeleteStillMayNotTrashAHeldRecordNorChangeItsFiles() {
        Framework.getProperties().put(ALLOW_DELETE_UNDELETABLE, "true");
        try {
            assertHeld(refusal(() -> {
                trash(session, record.getRef());
                return null;
            }), LegalHolds.RECORD_HELD);
            assertHeld(refusal(() -> {
                DocumentModel changed = session.getDocument(record.getRef());
                changed.setPropertyValue("files:files", (Serializable) attachments("Another letter."));
                return session.saveDocument(changed);
            }), LegalHolds.FILES_HELD);
        } finally {
            Framework.getProperties().remove(ALLOW_DELETE_UNDELETABLE);
        }
        assertFalse(session.getDocument(record.getRef()).isTrashed());
    }

    static String text(Blob blob) {
        try {
            return blob.getString();
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }
}
