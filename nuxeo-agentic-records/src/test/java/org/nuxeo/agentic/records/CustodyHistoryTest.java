package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.records.Fixtures.commit;
import static org.nuxeo.agentic.records.Fixtures.refused;
import static org.nuxeo.agentic.records.Physicals.CLERK;

import java.io.Serializable;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.Before;
import org.junit.Test;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.core.api.VersioningOption;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.core.api.trash.TrashService;
import org.nuxeo.runtime.api.Framework;

/**
 * A physical record's custody cannot be edited: no save changes an entry, removes one or adds one,
 * nor anything else the server writes of the record, an administrator's included; a custody request
 * is kept as filed; and nothing takes a record's custody away with it, a copy, a version, an import,
 * or a deletion but an administrator's.
 */
public class CustodyHistoryTest extends PhysicalTestCase {

    private DocumentModel box;

    @Before
    public void setUpBoxWithAHistory() {
        box = Physicals.item(session, "Box 1", a1);
        commit(session);
        Physicals.move(session, CLERK, box, b1, "Shelf A is full");
        Physicals.checkOut(session, CLERK, box, "grace", Duration.ofDays(7), "For the audit");
        // erin writes in the records folder, and may delete what is in it.
        ACP records = session.getACP(new PathRef(Fixtures.RECORDS));
        records.getACL("local").add(new ACE("erin", SecurityConstants.EVERYTHING, true));
        session.setACP(new PathRef(Fixtures.RECORDS), records, true);
        commit(session);
    }

    @Test
    public void noSaveChangesAnEntryAnAdministratorsIncluded() {
        List<Map<String, Serializable>> before = Physicals.custody(session, box);
        assertEquals(3, before.size());

        // An entry's reason rewritten.
        assertEquals("server-only", refused(() -> {
            List<Map<String, Serializable>> custody = Physicals.custody(session, box);
            custody.get(1).put("reason", "Nothing happened");
            return save(session, Physical.CUSTODY, (Serializable) custody);
        }));
        // An entry removed.
        assertEquals("server-only", refused(() -> {
            List<Map<String, Serializable>> custody = Physicals.custody(session, box);
            custody.remove(2);
            return save(session, Physical.CUSTODY, (Serializable) custody);
        }));
        // An entry added after the others.
        assertEquals("server-only", refused(() -> {
            List<Map<String, Serializable>> custody = Physicals.custody(session, box);
            Map<String, Serializable> forged = new LinkedHashMap<>(custody.get(2));
            forged.put("event", Physical.RETURNED);
            custody.add(forged);
            return save(session, Physical.CUSTODY, (Serializable) custody);
        }));
        // All of it.
        assertEquals("server-only", refused(() -> save(session, Physical.CUSTODY, (Serializable) new ArrayList<>())));
        // By its writer too.
        CoreSession erin = Fixtures.as(session, "erin");
        assertEquals("server-only", refused(() -> save(erin, Physical.CUSTODY, null)));

        assertEquals(PhysicalRecords.normal(before), PhysicalRecords.normal(Physicals.custody(session, box)));
    }

    @Test
    public void nothingElseTheServerWritesChangesEither() {
        for (Map.Entry<String, Serializable> change : Map.<String, Serializable> of(Physical.BARCODE, "PR000000018",
                Physical.LOCATION, a1.getId(), Physical.LOCATION_PATH, A1_PATH, Physical.STATE, Physical.IN,
                Physical.BORROWER, "mallory", Physical.KIND, "volume", Physical.DUE_BACK,
                Fixtures.calendar(Fixtures.daysAgo(-90)), Physical.DISPOSED_AT, Fixtures.calendar(Fixtures.daysAgo(1)))
                                                         .entrySet()) {
            assertEquals(change.getKey(), "server-only", refused(() -> save(session, change.getKey(), change.getValue())));
        }
        assertEquals(Physical.OUT, Physicals.value(session, box, Physical.STATE));
        assertEquals("grace", Physicals.value(session, box, Physical.BORROWER));
    }

    @Test
    public void whatIsNotTheServersIsTheWritersAndASaveThatChangesNothingOfItsGoesThrough() {
        DocumentModel stored = session.getDocument(box.getRef());
        // Every property sent back as it was, as a client that sends the whole document does.
        stored.setPropertyValue(Physical.CUSTODY, (Serializable) Physicals.custody(session, box));
        stored.setPropertyValue(Physical.BARCODE, stored.getPropertyValue(Physical.BARCODE));
        stored.setPropertyValue("dc:title", "Box 1, invoices 2016");
        stored.setPropertyValue(Physical.DISPOSITION_ACTION, Physical.TRANSFER);
        stored.setPropertyValue(Physical.TRANSFER_TO, "The county archive");
        session.saveDocument(stored);
        commit(session);
        assertEquals("Box 1, invoices 2016", Physicals.value(session, box, "dc:title"));
        assertEquals(Physical.TRANSFER, Physicals.value(session, box, Physical.DISPOSITION_ACTION));
        assertEquals("bad-record", refused(() -> save(session, Physical.TRANSFER_TO, null)));
        assertEquals("bad-record", refused(() -> save(session, Physical.DISPOSITION_ACTION, "shred")));
    }

    @Test
    public void aRequestIsKeptAsFiledAndIsItsFilersAlone() {
        DocumentModel request = session.query("SELECT * FROM " + Physical.REQUEST_TYPE + " WHERE "
                + Physical.REQUEST_OUTCOME + " = '" + Physical.MOVED + "'").get(0);
        request.setPropertyValue(Physical.REQUEST_REASON, "Another reason");
        DocumentModel edited = request;
        assertEquals("server-only", refused(() -> session.saveDocument(edited)));
        // Its filer reads it; another clerk does not.
        assertTrue(Fixtures.as(session, CLERK).hasPermission(request.getRef(), SecurityConstants.READ));
        assertTrue(!Fixtures.as(session, Physicals.OTHER_CLERK).hasPermission(request.getRef(), SecurityConstants.READ));
        // No one but an administrator may delete it: given every permission on it, its filer still may not.
        ACP acp = session.getACP(request.getRef());
        acp.getACL("local").add(0, new ACE(CLERK, SecurityConstants.EVERYTHING, true));
        session.setACP(request.getRef(), acp, true);
        ACP desk = session.getACP(new PathRef(Physicals.DESK));
        desk.getACL("local").add(0, new ACE(CLERK, SecurityConstants.REMOVE_CHILDREN, true));
        session.setACP(new PathRef(Physicals.DESK), desk, true);
        commit(session);
        CoreSession clerk = Fixtures.as(session, CLERK);
        assertEquals("kept", refused(() -> {
            clerk.removeDocument(edited.getRef());
            return null;
        }));
        assertEquals("kept", refused(() -> {
            Framework.getService(TrashService.class).trashDocument(clerk.getDocument(edited.getRef()));
            return null;
        }));
        assertEquals("kept", refused(() -> session.copy(edited.getRef(), new PathRef(Physicals.DESK), "copy")));
        // An administrator deletes one, which is logged.
        session.removeDocument(request.getRef());
        commit(session);
        assertTrue(!session.exists(request.getRef()));
    }

    @Test
    public void noCopyNorVersionCarriesTheBarcodeOrTheCustody() {
        assertEquals("kept", refused(() -> session.copy(box.getRef(), new PathRef(Fixtures.RECORDS), "copy")));
        assertEquals("kept", refused(() -> session.copy(new PathRef(Fixtures.RECORDS), new PathRef("/"), "records-copy")));
        assertEquals("kept", refused(() -> session.checkIn(box.getRef(), VersioningOption.MINOR, "A version")));
        assertEquals(1, session.query("SELECT * FROM " + Physical.RECORD_TYPE).size());
    }

    @Test
    public void onlyAnAdministratorDeletesARecordOrPutsItInTheTrash() {
        CoreSession erin = Fixtures.as(session, "erin");
        assertEquals("kept", refused(() -> {
            erin.removeDocument(box.getRef());
            return null;
        }));
        assertEquals("kept", refused(() -> {
            Framework.getService(TrashService.class).trashDocument(erin.getDocument(box.getRef()));
            return null;
        }));
        // Nor the folder that holds one, which would take it along with no event of its own.
        DocumentModel boxes = session.createDocument(session.createDocumentModel(Fixtures.RECORDS, "boxes", "Folder"));
        DocumentModel inside = Physicals.item(session, "Box 2", "box", a1.getId());
        session.move(inside.getRef(), boxes.getRef(), null);
        commit(session);
        assertEquals("kept", refused(() -> {
            erin.removeDocument(boxes.getRef());
            return null;
        }));
        // Nor puts it in the trash, which would put the record in the trash after it, as erin.
        assertEquals("kept", refused(() -> {
            Framework.getService(TrashService.class).trashDocument(erin.getDocument(boxes.getRef()));
            return null;
        }));
        assertTrue(!session.getDocument(boxes.getRef()).isTrashed());
        assertTrue(session.exists(inside.getRef()));
        assertTrue(session.exists(box.getRef()));
        session.removeDocument(box.getRef());
        commit(session);
        assertTrue(!session.exists(box.getRef()));
    }

    // --- Locations ----------------------------------------------------------------------------------

    @Test
    public void aLocationIsKeptAsItWasMade() {
        DocumentModel shelf = session.getDocument(shelfB.getRef());
        shelf.setPropertyValue("dc:title", "Shelf C");
        assertEquals("kept", refused(() -> session.saveDocument(shelf)));
        DocumentModel path = session.getDocument(shelfB.getRef());
        path.setPropertyValue(Physical.LOCATION_PATH_OF, "Elsewhere");
        assertEquals("kept", refused(() -> session.saveDocument(path)));
        DocumentModel kind = session.getDocument(shelfB.getRef());
        kind.setPropertyValue(Physical.LOCATION_KIND, "room");
        assertEquals("kept", refused(() -> session.saveDocument(kind)));
        assertEquals("kept", refused(() -> session.move(b1.getRef(), shelfA.getRef(), null)));
        assertEquals("kept", refused(() -> session.copy(shelfB.getRef(), room.getRef(), "shelf-copy")));
        assertEquals("kept", refused(() -> session.copy(new PathRef(Physicals.LOCATIONS), new PathRef("/"), "copy")));
    }

    @Test
    public void aLocationHoldingARecordIsNotDeletedNorPutInTheTrash() {
        // The box is checked out, and kept at B1: its shelf, room and site hold it.
        ACP locations = session.getACP(new PathRef(Physicals.LOCATIONS));
        locations.getACL("local").add(new ACE("erin", SecurityConstants.EVERYTHING, true));
        session.setACP(new PathRef(Physicals.LOCATIONS), locations, true);
        commit(session);
        CoreSession erin = Fixtures.as(session, "erin");
        for (DocumentModel location : List.of(b1, shelfB, room, site)) {
            assertEquals(location.getTitle(), "holds-records", refused(() -> {
                erin.removeDocument(location.getRef());
                return null;
            }));
        }
        assertEquals("holds-records", refused(() -> {
            Framework.getService(TrashService.class).trashDocument(erin.getDocument(b1.getRef()));
            return null;
        }));
        // Nor a folder of sites, which would take them along with no event of their own.
        DocumentModel archive = session.createDocument(
                session.createDocumentModel(Physicals.LOCATIONS, "archive", "Folder"));
        DocumentModel far = Physicals.location(session, archive, "Far site", "site");
        DocumentModel farRoom = Physicals.location(session, far, "Basement", "room");
        Physicals.item(session, "Box 3", farRoom);
        commit(session);
        assertEquals("holds-records", refused(() -> {
            erin.removeDocument(archive.getRef());
            return null;
        }));
        assertEquals("holds-records", refused(() -> {
            Framework.getService(TrashService.class).trashDocument(erin.getDocument(archive.getRef()));
            return null;
        }));
        // Nor one with a record, or such a folder, filed inside it rather than kept at it: its
        // deletion would take them along. A record is not moved into a location.
        DocumentModel filed = Physicals.item(session, "Box 4", b1);
        commit(session);
        assertEquals("kept", refused(() -> session.move(filed.getRef(), a1.getRef(), null)));
        DocumentModel model = session.createDocumentModel(a1.getPathAsString(), "box-5", Physical.RECORD_TYPE);
        model.setPropertyValue(Physical.KIND, "box");
        model.setPropertyValue(Physical.LOCATION, b1.getId());
        DocumentModel inside = session.createDocument(model);
        commit(session);
        assertTrue(Physical.RECORD_TYPE.equals(inside.getType()));
        assertEquals("kept", refused(() -> {
            erin.removeDocument(a1.getRef());
            return null;
        }));
        session.removeDocument(inside.getRef());
        session.removeDocument(filed.getRef());
        session.move(archive.getRef(), shelfA.getRef(), null);
        commit(session);
        assertEquals("holds-records", refused(() -> {
            erin.removeDocument(shelfA.getRef());
            return null;
        }));
        session.move(archive.getRef(), new PathRef(Physicals.LOCATIONS), null);
        commit(session);
        // A location that holds none goes, in the trash or for good.
        Framework.getService(TrashService.class).trashDocument(erin.getDocument(a1.getRef()));
        commit(erin);
        erin.removeDocument(a1.getRef());
        commit(erin);
        assertTrue(!session.exists(a1.getRef()));
    }

    private DocumentModel save(CoreSession as, String xpath, Serializable value) {
        DocumentModel doc = as.getDocument(box.getRef());
        doc.setPropertyValue(xpath, value);
        return as.saveDocument(doc);
    }
}
