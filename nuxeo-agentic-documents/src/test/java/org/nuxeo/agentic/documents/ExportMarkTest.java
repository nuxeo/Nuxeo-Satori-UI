/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_CLASSIFICATION;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_GROUPS;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_MARKED_AT;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_MARKED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.REVISION;
import static org.nuxeo.agentic.documents.ControlledDocuments.STATUS;
import static org.nuxeo.agentic.documents.ControlledDocuments.SUPERSEDED;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.FOR_REVIEW;
import static org.nuxeo.agentic.documents.Library.ADMINISTRATOR;
import static org.nuxeo.agentic.documents.Library.ALICE;
import static org.nuxeo.agentic.documents.Library.BOB;
import static org.nuxeo.agentic.documents.Library.CAROL;
import static org.nuxeo.agentic.documents.Library.DAVE;
import static org.nuxeo.agentic.documents.Library.DRAWING;
import static org.nuxeo.agentic.documents.Library.DRAWINGS;
import static org.nuxeo.agentic.documents.Library.ERIN;
import static org.nuxeo.agentic.documents.Library.text;
import static org.nuxeo.agentic.documents.Marks.EC1;
import static org.nuxeo.agentic.documents.Marks.EC2;

import java.io.Serializable;
import java.util.Arrays;
import java.util.Calendar;
import java.util.List;
import java.util.Map;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.core.api.VersioningOption;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.PermissionProvider;
import org.nuxeo.ecm.core.io.registry.MarshallerHelper;
import org.nuxeo.ecm.core.io.registry.context.RenderingContext;
import org.nuxeo.ecm.core.security.SecurityService;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.test.runner.TransactionalFeature;

/**
 * Export-control marks, since 0.3.0: a marked revision's file, its renditions and a transmittal of it
 * refused to anyone in none of its mark's groups, and allowed to a member; the mark carried to the
 * revision that supersedes it; a change of it refused without the add-on's permission; and each
 * change written to the platform's audit.
 *
 * <p>The downloads and renditions are asked of the platform's own download service, which runs the
 * contributed script through Nashorn and refuses with 403 whatever it refuses here, as {@code /nxfile/}
 * and the REST API's {@code @blob}, {@code @rendition} and {@code @preview} ask it. The people and their
 * groups are in the user directory ({@link Marks}).
 */
@RunWith(FeaturesRunner.class)
@Features(ExportMarksFeature.class)
public class ExportMarkTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    @Inject
    protected TransactionalFeature txFeature;

    private String repository;

    /** DWG-00001, revision A, current, with a file: marked EC-2, for ec2-recipients, by alice. */
    private String marked;

    /** DWG-00002, revision A, current, with a file: not marked. */
    private String plain;

    @Before
    public void setUp() {
        repository = core.getRepositoryName();
        Marks.people();
        Library.create(session);
        Library.createDesks(session);
        Marks.grantMarking(session, DRAWINGS, ALICE);
        Library.nextTransaction();
        Library.resetSeries("DWG", "TR");
        marked = Library.inTransactionAs(repository, ALICE,
                s -> Marks.drawing(s, DRAWINGS, "pump", "EC-2", List.of(EC2)).getId());
        plain = Library.inTransactionAs(repository, ALICE,
                s -> Marks.drawing(s, DRAWINGS, "valve", null, null).getId());
    }

    /** The add-on's permission is one the server knows, and offers in its permissions screens. */
    @Test
    public void theAddOnsPermissionIsRegisteredAndShown() {
        PermissionProvider permissions = Framework.getService(SecurityService.class).getPermissionProvider();
        assertTrue(Arrays.asList(permissions.getPermissions()).contains(ExportMarks.PERMISSION));
        assertTrue(permissions.getUserVisiblePermissionDescriptors()
                              .stream()
                              .anyMatch(p -> ExportMarks.PERMISSION.equals(p.getPermission())));
    }

    // ------------------------------------------------------------------ a download and a rendition

    @Test
    public void aMarkedRevisionsFileIsRefusedToAnyoneOutsideItsGroupsAndServedToAMember() {
        assertFalse("bob is in ec1-recipients only", Marks.downloads(repository, marked, "file:content", BOB));
        assertFalse("carol is in no group", Marks.downloads(repository, marked, "file:content", CAROL));
        assertFalse("an administrator is not exempt", Marks.downloads(repository, marked, "file:content",
                ADMINISTRATOR));
        assertTrue("alice is in ec2-recipients", Marks.downloads(repository, marked, "file:content", ALICE));
        assertTrue("so is dave", Marks.downloads(repository, marked, "file:content", DAVE));
        // The blob holder's address of the same file, and the preview's and the viewer's reasons, are
        // decided alike.
        assertFalse(Marks.downloads(repository, marked, "blobholder:0", BOB));
        assertFalse(Marks.downloads(repository, marked, "file:content", BOB, "preview"));
        assertFalse(Marks.downloads(repository, marked, "file:content", BOB, "view"));
        assertTrue(Marks.downloads(repository, marked, "file:content", ALICE, "preview"));
        // An unmarked revision is not this add-on's to refuse.
        assertTrue(Marks.downloads(repository, plain, "file:content", BOB));
        assertTrue(Marks.downloads(repository, plain, "file:content", CAROL));
    }

    @Test
    public void aMarkedRevisionsRenditionsAreRefusedToAnyoneOutsideItsGroupsAndServedToAMember() {
        for (String rendition : List.of("pdf", "xmlExport", "zipExport", "thumbnail", "mainBlob")) {
            assertFalse(rendition, Marks.rendition(repository, marked, rendition, BOB));
            assertFalse(rendition, Marks.rendition(repository, marked, rendition, ADMINISTRATOR));
            assertTrue(rendition, Marks.rendition(repository, marked, rendition, ALICE));
            assertTrue(rendition, Marks.rendition(repository, plain, rendition, BOB));
        }
    }

    /**
     * A folder's renditions zip what it holds, under the folder's own type: refused, but its
     * thumbnail, once it holds a marked revision, and served while it holds none.
     */
    @Test
    public void aFolderHoldingAMarkedRevisionIsRefusedItsRenditionsButItsThumbnail() {
        String drawings = session.getDocument(new PathRef(DRAWINGS)).getId();
        String bobs = session.getDocument(new PathRef("/library/bob")).getId();
        assertFalse(Marks.rendition(repository, drawings, "zipTreeExport", ALICE));
        assertFalse(Marks.rendition(repository, drawings, "xmlExport", BOB));
        assertTrue(Marks.rendition(repository, drawings, "thumbnail", BOB));
        String library = session.getDocument(new PathRef("/library")).getId();
        assertFalse("a folder above it too", Marks.rendition(repository, library, "zipTreeExport", ALICE));
        assertTrue("a folder holding none", Marks.rendition(repository, bobs, "zipTreeExport", BOB));
    }

    /**
     * A version keeps the mark it was made with: one made before the revision was marked is decided
     * by its live document's mark too, as a proxy of it is.
     */
    @Test
    public void aVersionMadeBeforeTheMarkIsDecidedByItsLiveDocument() {
        DocumentRef version = Library.inTransactionAs(repository, ALICE,
                s -> s.checkIn(new IdRef(plain), VersioningOption.MINOR, "before the mark"));
        String versionId = Library.inTransaction(() -> CoreInstance.doPrivileged(repository,
                (CoreSession s) -> s.getDocument(version).getId()));
        assertTrue(Marks.downloads(repository, versionId, "file:content", BOB));

        Library.inTransactionAs(repository, ALICE, s -> Marks.mark(s, plain, "EC-1", List.of(EC1)));
        DocumentModel stored = Library.stored(repository, versionId);
        assertNull("the version keeps the mark it was made with", text(stored, MARK_CLASSIFICATION));
        assertFalse("carol is not in ec1-recipients", Marks.downloads(repository, versionId, "file:content", CAROL));
        assertTrue("bob is", Marks.downloads(repository, versionId, "file:content", BOB));
        assertFalse(Marks.rendition(repository, versionId, "pdf", CAROL));

        String proxy = Library.inTransaction(() -> CoreInstance.doPrivileged(repository,
                (CoreSession s) -> s.createProxy(version, new PathRef("/library/bob")).getId()));
        assertFalse("a proxy of it too", Marks.downloads(repository, proxy, "file:content", CAROL));
        assertTrue(Marks.downloads(repository, proxy, "file:content", BOB));
        // And the folder holding the proxy, whose own mark is the version's, none, is refused its zip,
        // as bob's own session finds the proxy there.
        String bobs = session.getDocument(new PathRef("/library/bob")).getId();
        assertFalse(Marks.rendition(repository, bobs, "zipTreeExport", BOB));
        assertTrue(Marks.rendition(repository, bobs, "thumbnail", BOB));
    }

    /** The enricher says why, with the mark; the download permission is what refuses. */
    @Test
    public void theEnricherSaysWhoMayReceiveItAndWhy() throws Exception {
        String asBob = Library.inTransactionAs(repository, BOB, s -> json(s, marked));
        assertTrue(asBob, asBob.contains("\"exportMark\":{\"classification\":\"EC-2\",\"groups\":[\"" + EC2
                + "\"],\"markedBy\":\"" + ALICE + "\""));
        assertTrue(asBob, asBob.contains("\"receives\":false,\"reason\":\"not-in-groups\"}"));
        // The enricher reads the session's person, who is in no group as the tests' sessions make them:
        // a session as alice, from the user directory, is in ec2-recipients.
        String asAlice = Library.inTransaction(() -> json(CoreInstance.getCoreSession(repository,
                Marks.person(ALICE)), marked));
        assertTrue(asAlice, asAlice.contains("\"receives\":true,\"reason\":null}"));
        String unmarked = Library.inTransactionAs(repository, BOB, s -> json(s, plain));
        assertTrue(unmarked, unmarked.contains("\"exportMark\":{\"classification\":null,\"groups\":[],"
                + "\"markedBy\":null,\"markedAt\":null,\"receives\":true,\"reason\":null}"));
        String folder = Library.inTransactionAs(repository, ALICE,
                s -> json(s, s.getDocument(new PathRef(DRAWINGS)).getId()));
        assertTrue(folder, folder.contains("\"exportMark\":null"));
    }

    private static String json(CoreSession session, String id) {
        try {
            RenderingContext ctx = RenderingContext.CtxBuilder.session(session)
                                                              .enrichDoc(ExportMarkJsonEnricher.NAME)
                                                              .get();
            return MarshallerHelper.objectToJson(session.getDocument(new IdRef(id)), ctx);
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    // ------------------------------------------------------------------ a transmittal

    private String issue(String user, List<String> documents, List<String> recipients) {
        return Library.inTransactionAs(repository, user,
                s -> Library.issue(s, "tr", documents, recipients, FOR_REVIEW, 14).getId());
    }

    @Test
    public void aTransmittalOfAMarkedRevisionToSomeoneOutsideItsGroupsIsRefusedWithTheReason() {
        NuxeoException refused = Library.refusedAs(repository, ALICE,
                s -> Library.issue(s, "tr", List.of("DWG-00001", plain), List.of(DAVE, BOB, CAROL), FOR_REVIEW, 14));
        assertEquals(403, refused.getStatusCode());
        assertEquals("Not sent: export-control marks exclude bob, carol from DWG-00001 at revision A, marked EC-2, "
                + "for ec2-recipients. A marked revision goes only to members of one of its mark's groups",
                refused.getMessage());
        // Nothing written, and no number spent: the next transmittal is TR-00001.
        assertEquals(0, Library.inTransaction(() -> CoreInstance.doPrivileged(repository,
                (CoreSession s) -> s.query("SELECT * FROM Document WHERE ecm:mixinType IN ('Transmittal', "
                        + "'TransmittalReceipt')").size())).intValue());
        // A name no user holds is in no group; nor is an administrator exempt.
        assertEquals(403, Library.refusedAs(repository, ALICE,
                s -> Library.issue(s, "tr", List.of(marked), List.of("nobody"), FOR_REVIEW, 14)).getStatusCode());
        assertEquals(403, Library.refusedAs(repository, ALICE,
                s -> Library.issue(s, "tr", List.of(marked), List.of(ADMINISTRATOR), FOR_REVIEW, 14))
                                 .getStatusCode());

        String id = issue(ALICE, List.of("DWG-00001", plain), List.of(DAVE, ERIN));
        DocumentModel transmittal = Library.stored(repository, id);
        assertEquals("TR-00001", text(transmittal, TRM_NUMBER));
        assertEquals(List.of(DAVE, ERIN), List.copyOf(Library.receipts(repository, id).keySet()));
        // Unmarked, it goes to anyone.
        String other = issue(ALICE, List.of(plain), List.of(BOB, CAROL));
        assertEquals("TR-00002", text(Library.stored(repository, other), TRM_NUMBER));
    }

    // ------------------------------------------------------------------ carried to a new revision

    @Test
    public void aNewRevisionTakesTheMarkOfTheOneItSupersedesWhateverItsCreatorWrote() {
        DocumentModel before = Library.stored(repository, marked);
        String b = Library.inTransactionAs(repository, ALICE, s -> {
            DocumentModel doc = s.createDocumentModel(DRAWINGS, "pump-b", DRAWING);
            doc.setPropertyValue("dc:title", "pump-b");
            doc.setPropertyValue(ControlledDocuments.SUPERSEDES, marked);
            doc.setPropertyValue(MARK_CLASSIFICATION, "EC-1");
            doc.setPropertyValue(MARK_GROUPS, (Serializable) List.of(EC1));
            doc.setPropertyValue(MARK_MARKED_BY, CAROL);
            return s.createDocument(doc).getId();
        });
        DocumentModel revision = Library.stored(repository, b);
        assertEquals("DWG-00001", text(revision, NUMBER));
        assertEquals("B", text(revision, REVISION));
        assertEquals("EC-2", text(revision, MARK_CLASSIFICATION));
        assertEquals(List.of(EC2), Arrays.asList((String[]) revision.getPropertyValue(MARK_GROUPS)));
        assertEquals(ALICE, text(revision, MARK_MARKED_BY));
        assertEquals(((Calendar) before.getPropertyValue(MARK_MARKED_AT)).getTimeInMillis(),
                ((Calendar) revision.getPropertyValue(MARK_MARKED_AT)).getTimeInMillis());
        assertEquals(SUPERSEDED, text(Library.stored(repository, marked), STATUS));
        // And refused as A is.
        assertFalse(Marks.downloads(repository, b, "file:content", BOB));
        assertTrue(Marks.downloads(repository, b, "file:content", DAVE));
        assertEquals(403, Library.refusedAs(repository, ALICE,
                s -> Library.issue(s, "tr", List.of("DWG-00001"), List.of(BOB), FOR_REVIEW, 14)).getStatusCode());

        // An unmarked one's new revision is unmarked, whatever its creator wrote.
        String plainB = Library.inTransactionAs(repository, ALICE, s -> {
            DocumentModel doc = s.createDocumentModel(DRAWINGS, "valve-b", DRAWING);
            doc.setPropertyValue("dc:title", "valve-b");
            doc.setPropertyValue(ControlledDocuments.SUPERSEDES, plain);
            doc.setPropertyValue(MARK_CLASSIFICATION, "EC-1");
            doc.setPropertyValue(MARK_GROUPS, (Serializable) List.of(EC1));
            return s.createDocument(doc).getId();
        });
        assertNull(text(Library.stored(repository, plainB), MARK_CLASSIFICATION));
        assertNull(Library.stored(repository, plainB).getPropertyValue(MARK_MARKED_AT));
    }

    // ------------------------------------------------------------------ who changes a mark

    @Test
    public void aMarkIsChangedOrRemovedOnlyWithTheAddOnsPermission() {
        // bob may write this one revision, and does not hold ChangeExportMark.
        Library.inTransaction(() -> CoreInstance.doPrivileged(repository, (CoreSession s) -> {
            ACP acp = s.getACP(new IdRef(marked));
            acp.getOrCreateACL().add(new ACE(BOB, "ReadWrite", true));
            s.setACP(new IdRef(marked), acp, true);
            return null;
        }));
        NuxeoException changed = Library.refusedAs(repository, BOB, s -> Marks.mark(s, marked, "EC-1", List.of(EC1)));
        assertEquals(403, changed.getStatusCode());
        assertTrue(changed.getMessage(), changed.getMessage().contains("needs the ChangeExportMark permission"));
        NuxeoException removed = Library.refusedAs(repository, BOB, s -> Marks.mark(s, marked, null, null));
        assertEquals(403, removed.getStatusCode());
        assertTrue(removed.getMessage(), removed.getMessage().contains("may not remove"));
        assertEquals(403, Library.refusedAs(repository, BOB, s -> Marks.mark(s, marked, "EC-2", List.of(EC2, EC1)))
                                 .getStatusCode());
        DocumentModel kept = Library.stored(repository, marked);
        assertEquals("EC-2", text(kept, MARK_CLASSIFICATION));
        assertEquals(List.of(EC2), Arrays.asList((String[]) kept.getPropertyValue(MARK_GROUPS)));
        // He may still write the rest of it.
        Library.inTransactionAs(repository, BOB, s -> {
            DocumentModel doc = s.getDocument(new IdRef(marked));
            doc.setPropertyValue("dc:description", "Checked by bob");
            return s.saveDocument(doc);
        });

        // Nor may anyone mark a new revision where they do not hold it.
        NuxeoException created = Library.refusedAs(repository, BOB,
                s -> Marks.drawing(s, "/library/bob", "bobs", "EC-1", List.of(EC1)));
        assertEquals(403, created.getStatusCode());
        assertTrue(created.getMessage(), created.getMessage().contains("on its folder"));
        Library.inTransactionAs(repository, BOB, s -> Marks.drawing(s, "/library/bob", "bobs", null, null));

        // alice holds it on the drawings: she changes the mark, and removes it; the server writes who.
        DocumentModel ec1 = Library.inTransactionAs(repository, ALICE, s -> Marks.mark(s, marked, "EC-1", List.of(EC1)));
        assertEquals("EC-1", text(ec1, MARK_CLASSIFICATION));
        assertEquals(ALICE, text(Library.stored(repository, marked), MARK_MARKED_BY));
        assertTrue(Marks.downloads(repository, marked, "file:content", BOB));
        assertFalse(Marks.downloads(repository, marked, "file:content", ALICE));
        Library.inTransactionAs(repository, ALICE, s -> Marks.mark(s, marked, null, null));
        DocumentModel none = Library.stored(repository, marked);
        assertNull(text(none, MARK_CLASSIFICATION));
        assertNull(none.getPropertyValue(MARK_GROUPS));
        assertEquals("who removed it", ALICE, text(none, MARK_MARKED_BY));
        assertTrue(Marks.downloads(repository, marked, "file:content", CAROL));

        // An administrator holds every permission: they may change it, and it is audited too.
        Library.inTransactionAs(repository, ADMINISTRATOR, s -> Marks.mark(s, marked, "EC-2", List.of(EC2)));
        assertEquals(ADMINISTRATOR, text(Library.stored(repository, marked), MARK_MARKED_BY));
    }

    @Test
    public void aMarkIsCheckedAndWhoAndWhenAreTheServers() {
        for (List<Object> wrong : List.<List<Object>> of(List.of("ec-2", List.of(EC2)), List.of("EC 2", List.of(EC2)),
                List.of("EC-2", List.of()), List.of("EC-2", List.of("Everyone")), List.of("EC-2", List.of("no group")))) {
            @SuppressWarnings("unchecked")
            List<String> groups = (List<String>) wrong.get(1);
            NuxeoException refused = Library.refusedAs(repository, ALICE,
                    s -> Marks.mark(s, marked, (String) wrong.get(0), groups.isEmpty() ? null : groups));
            assertEquals(wrong.toString(), 400, refused.getStatusCode());
        }
        // Everyone is no group of people: refused for that, before the user directory is asked.
        NuxeoException everyone = Library.refusedAs(repository, ALICE,
                s -> Marks.mark(s, marked, "EC-2", List.of(EC2, "Everyone")));
        assertEquals("An export-control mark names groups of people, not Everyone", everyone.getMessage());
        NuxeoException noClassification = Library.refusedAs(repository, ALICE, s -> Marks.mark(s, plain, null,
                List.of(EC1)));
        assertEquals(400, noClassification.getStatusCode());
        NuxeoException missing = Library.refusedAs(repository, ALICE, s -> Marks.mark(s, marked, "EC-2",
                List.of("ec9-recipients")));
        assertEquals(400, missing.getStatusCode());
        assertTrue(missing.getMessage(), missing.getMessage().contains("No group is named ec9-recipients"));

        NuxeoException by = Library.refusedAs(repository, ALICE, s -> {
            DocumentModel doc = s.getDocument(new IdRef(marked));
            doc.setPropertyValue(MARK_MARKED_BY, CAROL);
            return s.saveDocument(doc);
        });
        assertEquals(400, by.getStatusCode());
        assertEquals(400, Library.refusedAs(repository, ADMINISTRATOR, s -> {
            DocumentModel doc = s.getDocument(new IdRef(marked));
            doc.setPropertyValue(MARK_MARKED_AT, Library.day(-3));
            return s.saveDocument(doc);
        }).getStatusCode());

        // The same mark written back with padding, as a REST client may send it, is no change.
        Calendar at = (Calendar) Library.stored(repository, marked).getPropertyValue(MARK_MARKED_AT);
        Library.inTransactionAs(repository, ALICE, s -> Marks.mark(s, marked, " EC-2 ", List.of(" " + EC2)));
        DocumentModel stored = Library.stored(repository, marked);
        assertEquals("EC-2", stored.getPropertyValue(MARK_CLASSIFICATION));
        assertEquals(List.of(EC2), Arrays.asList((String[]) stored.getPropertyValue(MARK_GROUPS)));
        assertEquals(at.getTimeInMillis(), ((Calendar) stored.getPropertyValue(MARK_MARKED_AT)).getTimeInMillis());
    }

    @Test
    public void aMarkIsNotChangedThroughAProxyNorByRestoringAVersion() {
        DocumentRef version = Library.inTransactionAs(repository, ALICE,
                s -> s.checkIn(new IdRef(plain), VersioningOption.MINOR, "before the mark"));
        Library.inTransactionAs(repository, ALICE, s -> Marks.mark(s, plain, "EC-1", List.of(EC1)));
        NuxeoException restored = Library.refusedAs(repository, ALICE,
                s -> s.restoreToVersion(new IdRef(plain), version));
        assertEquals(409, restored.getStatusCode());
        assertTrue(restored.getMessage(), restored.getMessage().contains(MARK_CLASSIFICATION));
        assertEquals("EC-1", text(Library.stored(repository, plain), MARK_CLASSIFICATION));

        String proxy = Library.inTransaction(() -> CoreInstance.doPrivileged(repository,
                (CoreSession s) -> s.createProxy(new IdRef(marked), new PathRef(DRAWINGS)).getId()));
        NuxeoException through = Library.refusedAs(repository, ALICE, s -> Marks.mark(s, proxy, null, null));
        assertEquals(400, through.getStatusCode());
        assertTrue(through.getMessage(), through.getMessage().contains("changed on the revision itself"));
        assertEquals("EC-2", text(Library.stored(repository, marked), MARK_CLASSIFICATION));
    }

    // ------------------------------------------------------------------ where a marked revision is

    /**
     * Who may change a mark is decided by where the revision is: a marked revision, a folder holding
     * one, and the next revision of one created in another folder go only where the person holds
     * {@code ChangeExportMark} on it and on the folder it goes to. Without this, bob, who may write
     * the drawings, would move one into a folder of his own, where he holds every permission, and
     * remove its mark.
     */
    @Test
    public void aMarkedRevisionGoesElsewhereOnlyWithThePermissionOnItAndWhereItGoes() {
        Library.inTransaction(() -> CoreInstance.doPrivileged(repository, (CoreSession s) -> {
            for (String[] grant : new String[][] { { DRAWINGS, BOB, "ReadWrite" },
                    { "/library/bob", BOB, "Everything" } }) {
                ACP acp = s.getACP(new PathRef(grant[0]));
                acp.getOrCreateACL().add(new ACE(grant[1], grant[2], true));
                s.setACP(new PathRef(grant[0]), acp, true);
            }
            s.createDocument(s.createDocumentModel(DRAWINGS, "sub", "Folder"));
            s.createDocument(s.createDocumentModel(DRAWINGS, "empty", "Folder"));
            return null;
        }));
        String inSub = Library.inTransactionAs(repository, ALICE,
                s -> Marks.drawing(s, DRAWINGS + "/sub", "gate", "EC-2", List.of(EC2)).getId());
        DocumentRef bobs = new PathRef("/library/bob");

        NuxeoException moved = Library.refusedAs(repository, BOB, s -> s.move(new IdRef(marked), bobs, null));
        assertEquals(403, moved.getStatusCode());
        assertTrue(moved.getMessage(), moved.getMessage().contains("move this marked revision"));
        NuxeoException folder = Library.refusedAs(repository, BOB,
                s -> s.move(new PathRef(DRAWINGS + "/sub"), bobs, null));
        assertEquals(403, folder.getStatusCode());
        assertTrue(folder.getMessage(), folder.getMessage().contains("You may not move this folder"));
        NuxeoException next = Library.refusedAs(repository, BOB,
                s -> Library.revise(s, "/library/bob", DRAWING, "pump-b", marked));
        assertEquals(403, next.getStatusCode());
        assertTrue(next.getMessage(), next.getMessage().contains("create its next revision in another folder"));
        // alice holds the permission on the drawings, not on bob's folder: refused too.
        assertEquals(403, Library.refusedAs(repository, ALICE, s -> s.move(new IdRef(marked), bobs, null))
                                 .getStatusCode());
        assertEquals(DRAWINGS, Library.stored(repository, marked).getPath().removeLastSegments(1).toString());
        assertEquals(DRAWINGS + "/sub", Library.stored(repository, inSub).getPath().removeLastSegments(1)
                                                                       .toString());

        // A rename in place moves nothing, naming its folder as the trash does, or none, as the platform
        // renames; an unmarked revision and a folder holding none go anywhere; and the next revision
        // beside the marked one carries its mark.
        Library.inTransactionAs(repository, BOB, s -> s.move(new IdRef(marked), new PathRef(DRAWINGS), "pump-renamed"));
        Library.inTransactionAs(repository, BOB, s -> s.move(new IdRef(marked), null, "pump-again"));
        assertEquals("pump-again", Library.stored(repository, marked).getName());
        Library.inTransactionAs(repository, BOB, s -> s.move(new IdRef(plain), bobs, null));
        Library.inTransactionAs(repository, BOB, s -> s.move(new PathRef(DRAWINGS + "/empty"), bobs, null));
        String b = Library.inTransactionAs(repository, BOB,
                s -> Library.revise(s, DRAWINGS, DRAWING, "pump-b", marked).getId());
        assertEquals("EC-2", text(Library.stored(repository, b), MARK_CLASSIFICATION));

        // With the permission where it goes too, alice moves it, and the folder holding one.
        Marks.grantMarking(session, "/library/bob", ALICE);
        Library.nextTransaction();
        Library.inTransactionAs(repository, ALICE, s -> s.move(new IdRef(b), bobs, null));
        assertEquals("/library/bob", Library.stored(repository, b).getPath().removeLastSegments(1).toString());
        Library.inTransactionAs(repository, ALICE, s -> s.move(new PathRef(DRAWINGS + "/sub"), bobs, null));
        assertEquals("/library/bob/sub", Library.stored(repository, inSub).getPath().removeLastSegments(1)
                                                                          .toString());
    }

    // ------------------------------------------------------------------ the audit

    @Test
    public void eachChangeOfAMarkIsAuditedAndARefusedOneIsNot() {
        Library.inTransactionAs(repository, ALICE, s -> Marks.mark(s, marked, "EC-1", List.of(EC1, EC2)));
        Library.refusedAs(repository, BOB, s -> Marks.mark(s, marked, null, null));
        Library.inTransactionAs(repository, ALICE, s -> Marks.mark(s, marked, null, null));
        String b = Library.inTransactionAs(repository, ALICE, s -> {
            Marks.mark(s, plain, "EC-2", List.of(EC2));
            return Library.revise(s, DRAWINGS, DRAWING, "valve-b", plain).getId();
        });
        audited();

        List<LogEntry> entries = Marks.entries(marked);
        assertEquals(List.of(ExportMarkAudit.MARKED, ExportMarkAudit.CHANGED, ExportMarkAudit.REMOVED),
                entries.stream().map(e -> Marks.extended(e).get(ExportMarkAudit.CHANGE)).toList());
        for (LogEntry entry : entries) {
            assertEquals(ALICE, entry.getPrincipalName());
            assertEquals(ExportMarkAudit.CATEGORY, entry.getCategory());
            assertEquals(DRAWING, entry.getDocType());
            assertEquals(ALICE, Marks.extended(entry).get(ExportMarkAudit.BY));
        }
        Map<String, Object> set = Marks.extended(entries.get(0));
        assertEquals("EC-2", set.get(ExportMarkAudit.CLASSIFICATION));
        assertEquals(EC2, set.get(ExportMarkAudit.GROUPS));
        assertNull(set.get(ExportMarkAudit.PREVIOUS_CLASSIFICATION));
        Map<String, Object> change = Marks.extended(entries.get(1));
        assertEquals("EC-1", change.get(ExportMarkAudit.CLASSIFICATION));
        assertEquals(EC1 + "," + EC2, change.get(ExportMarkAudit.GROUPS));
        assertEquals("EC-2", change.get(ExportMarkAudit.PREVIOUS_CLASSIFICATION));
        assertEquals(EC2, change.get(ExportMarkAudit.PREVIOUS_GROUPS));
        assertEquals("Export-control mark changed from EC-2, for ec2-recipients to EC-1, for ec1-recipients, "
                + "ec2-recipients", entries.get(1).getComment());
        Map<String, Object> removal = Marks.extended(entries.get(2));
        assertNull(removal.get(ExportMarkAudit.CLASSIFICATION));
        assertEquals("EC-1", removal.get(ExportMarkAudit.PREVIOUS_CLASSIFICATION));

        // Carried: on the new revision, naming the one superseded.
        List<LogEntry> carried = Marks.entries(b);
        assertEquals(1, carried.size());
        assertEquals(ExportMarkAudit.CARRIED, Marks.extended(carried.get(0)).get(ExportMarkAudit.CHANGE));
        assertEquals(plain, Marks.extended(carried.get(0)).get(ExportMarkAudit.CARRIED_FROM));
        assertEquals("EC-2", Marks.extended(carried.get(0)).get(ExportMarkAudit.CLASSIFICATION));
        // And an unmarked revision's creation, and its saves, write none.
        String c = Library.inTransactionAs(repository, ALICE, s -> Marks.drawing(s, DRAWINGS, "gate", null, null)
                                                                         .getId());
        audited();
        assertTrue(Marks.entries(c).isEmpty());
    }

    private void audited() {
        session.save();
        txFeature.nextTransaction();
    }

    // ------------------------------------------------------------------ a change and a reading cannot cross

    /**
     * The mark fence, held open on purpose: while a new revision's transaction, or a transmittal's,
     * reads a revision's mark, a change of it is refused; while a change holds it, the new revision
     * and the transmittal are; and once either ends, the other goes through. Without the fence, the
     * new revision would take the mark as it was before a change that commits after it read it.
     */
    @Test
    public void whileARevisionIsReadingTheMarkAChangeIsRefusedAndTheOtherWayRound() throws Exception {
        TransactionalHold.run(repository, () -> Library.revise(Library.as(repository, ALICE), DRAWINGS, DRAWING,
                "pump-b", marked).getId(), () -> {
                    NuxeoException refused = Library.refusedAs(repository, ALICE,
                            s -> Marks.mark(s, marked, "EC-1", List.of(EC1)));
                    assertEquals(409, refused.getStatusCode());
                    assertTrue(refused.getMessage(), refused.getMessage().contains("being read by a new revision"));
                });
        assertEquals("EC-2", text(Library.stored(repository, marked), MARK_CLASSIFICATION));

        TransactionalHold.run(repository, () -> Marks.mark(Library.as(repository, ALICE), plain, "EC-1", List.of(EC1)),
                () -> {
                    NuxeoException revision = Library.refusedAs(repository, ALICE,
                            s -> Library.revise(s, DRAWINGS, DRAWING, "valve-b", plain));
                    assertEquals(409, revision.getStatusCode());
                    assertTrue(revision.getMessage(), revision.getMessage().contains("is being changed"));
                    NuxeoException transmittal = Library.refusedAs(repository, ALICE,
                            s -> Library.issue(s, "tr", List.of("DWG-00002"), List.of(BOB), FOR_REVIEW, 14));
                    assertEquals(409, transmittal.getStatusCode());
                });
        // Both ended: the change committed, and the new revision now takes it.
        String plainB = Library.inTransactionAs(repository, ALICE,
                s -> Library.revise(s, DRAWINGS, DRAWING, "valve-b", plain).getId());
        assertEquals("EC-1", text(Library.stored(repository, plainB), MARK_CLASSIFICATION));
        NuxeoException late = Library.refusedAs(repository, ALICE,
                s -> Library.issue(s, "tr", List.of("DWG-00002"), List.of(CAROL), FOR_REVIEW, 14));
        assertEquals(403, late.getStatusCode());
        assertNotNull(Library.stored(repository, plainB));
    }
}
