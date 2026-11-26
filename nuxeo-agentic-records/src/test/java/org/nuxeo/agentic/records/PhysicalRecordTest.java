package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.records.Fixtures.commit;
import static org.nuxeo.agentic.records.Fixtures.refused;

import java.io.Serializable;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;

import org.junit.Test;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.SecurityConstants;

/**
 * A physical record as it is made: its barcode, its location and the first entry of its custody,
 * the server's; and a location's place in the hierarchy, and its path.
 */
public class PhysicalRecordTest extends PhysicalTestCase {

    @Test
    public void aRecordIsGivenItsBarcodeItsPlaceAndItsFirstCustodyEntry() {
        DocumentModel box = Physicals.item(session, "Box 1", a1);
        commit(session);
        DocumentModel stored = session.getDocument(box.getRef());
        String barcode = (String) stored.getPropertyValue(Physical.BARCODE);
        assertTrue(barcode, barcode.startsWith("PR") && Barcodes.valid(barcode));
        assertEquals(Physical.IN, stored.getPropertyValue(Physical.STATE));
        assertEquals(a1.getId(), stored.getPropertyValue(Physical.LOCATION));
        assertEquals(List.of(site.getId(), room.getId(), shelfA.getId(), a1.getId()),
                Arrays.asList((Object[]) stored.getPropertyValue(Physical.LOCATIONS)));
        assertEquals(A1_PATH, stored.getPropertyValue(Physical.LOCATION_PATH));
        assertEquals(Physical.DESTROY, stored.getPropertyValue(Physical.DISPOSITION_ACTION));

        List<Map<String, Serializable>> custody = Physicals.custody(session, box);
        assertEquals(1, custody.size());
        assertEquals(Physical.REGISTERED, custody.get(0).get("event"));
        assertEquals(session.getPrincipal().getName(), custody.get(0).get("by"));
        assertNull(custody.get(0).get("fromLocation"));
        assertEquals(a1.getId(), custody.get(0).get("toLocation"));
        assertEquals(A1_PATH, custody.get(0).get("toPath"));
        assertTrue(custody.get(0).get("at") != null);
    }

    @Test
    public void whatTheCreatorSendsOfTheServersIsReplaced() {
        DocumentModel box = session.createDocumentModel(Fixtures.RECORDS, "box", Physical.RECORD_TYPE);
        box.setPropertyValue(Physical.KIND, "box");
        box.setPropertyValue(Physical.LOCATION, a1.getId());
        box.setPropertyValue(Physical.BARCODE, "PR999999999");
        box.setPropertyValue(Physical.STATE, Physical.OUT);
        box.setPropertyValue(Physical.BORROWER, "mallory");
        box.setPropertyValue(Physical.DISPOSED_AT, Fixtures.calendar(Fixtures.daysAgo(1)));
        box.setPropertyValue(Physical.LOCATIONS, new String[] { "elsewhere" });
        box.setPropertyValue(Physical.CUSTODY, (Serializable) List.of(Map.of("event", "moved", "by", "mallory")));
        box = session.createDocument(box);
        commit(session);
        DocumentModel stored = session.getDocument(box.getRef());
        assertFalse("PR999999999".equals(stored.getPropertyValue(Physical.BARCODE)));
        assertEquals(Physical.IN, stored.getPropertyValue(Physical.STATE));
        assertNull(stored.getPropertyValue(Physical.BORROWER));
        assertNull(stored.getPropertyValue(Physical.DISPOSED_AT));
        assertEquals(4, ((Object[]) stored.getPropertyValue(Physical.LOCATIONS)).length);
        List<Map<String, Serializable>> custody = Physicals.custody(session, box);
        assertEquals(1, custody.size());
        assertEquals(Physical.REGISTERED, custody.get(0).get("event"));
    }

    @Test
    public void barcodesAreIssuedInTurnAndARefusalSpendsNone() {
        long first = value(Physicals.item(session, "Box 1", a1));
        commit(session);
        assertEquals("bad-record", refused(() -> Physicals.item(session, "Box 2", "crate", a1.getId())));
        assertEquals("no-location", refused(() -> Physicals.item(session, "Box 2", "box", null)));
        long second = value(Physicals.item(session, "Box 2", a1));
        assertEquals(first + 1, second);
    }

    @Test
    public void aBarcodeHeldAlreadyIsNeverGivenAgainShouldTheSequenceBeSetBack() {
        long first = value(Physicals.item(session, "Box 1", a1));
        long second = value(Physicals.item(session, "Box 2", a1));
        commit(session);
        org.nuxeo.runtime.api.Framework.getService(org.nuxeo.ecm.core.uidgen.UIDGeneratorService.class)
                                       .getSequencer()
                                       .initSequence(Barcodes.SEQUENCE_KEY, first - 1);
        long third = value(Physicals.item(session, "Box 3", a1));
        assertEquals(second + 1, third);
    }

    @Test
    public void aRecordIsKeptAtALocationItsCreatorMayRead() {
        // erin may file records but not read the second shelf.
        ACP records = session.getACP(new org.nuxeo.ecm.core.api.PathRef(Fixtures.RECORDS));
        records.getACL("local").add(new ACE("erin", SecurityConstants.READ_WRITE, true));
        session.setACP(new org.nuxeo.ecm.core.api.PathRef(Fixtures.RECORDS), records, true);
        Physicals.hide(session, shelfB);
        commit(session);
        CoreSession erin = Fixtures.as(session, "erin");
        assertEquals("no-location", refused(() -> Physicals.item(erin, "Box 1", b1)));
        // Named the same way as a location that does not exist, or a document that is not one.
        assertEquals("no-location", refused(() -> Physicals.item(erin, "Box 1", "box", "0b2a7f5e-0000-4000-8000-000000000000")));
        assertEquals("no-location", refused(() -> Physicals.item(erin, "Box 1", "box", rule.getId())));
        DocumentModel box = Physicals.item(erin, "Box 1", a1);
        commit(erin);
        assertEquals("erin", Physicals.custody(session, box).get(0).get("by"));
    }

    @Test
    public void aLocationInTheTrashTakesNoRecord() {
        org.nuxeo.runtime.api.Framework.getService(org.nuxeo.ecm.core.api.trash.TrashService.class).trashDocument(b1);
        commit(session);
        assertEquals("location-trashed", refused(() -> Physicals.item(session, "Box 1", b1)));
    }

    @Test
    public void aTransferNamesItsRecipient() {
        DocumentModel box = session.createDocumentModel(Fixtures.RECORDS, "box", Physical.RECORD_TYPE);
        box.setPropertyValue(Physical.KIND, "volume");
        box.setPropertyValue(Physical.LOCATION, a1.getId());
        box.setPropertyValue(Physical.DISPOSITION_ACTION, Physical.TRANSFER);
        DocumentModel unnamed = box;
        assertEquals("bad-record", refused(() -> session.createDocument(unnamed)));
        box.setPropertyValue(Physical.TRANSFER_TO, "The county archive");
        box = session.createDocument(box);
        commit(session);
        assertEquals("The county archive", Physicals.value(session, box, Physical.TRANSFER_TO));
        assertEquals("bad-record", refused(() -> {
            DocumentModel other = session.createDocumentModel(Fixtures.RECORDS, "other", Physical.RECORD_TYPE);
            other.setPropertyValue(Physical.KIND, "box");
            other.setPropertyValue(Physical.LOCATION, a1.getId());
            other.setPropertyValue(Physical.DISPOSITION_ACTION, "shred");
            return session.createDocument(other);
        }));
    }

    // --- Locations ----------------------------------------------------------------------------------

    @Test
    public void aLocationsPathIsItsTitleAfterEveryTitleAboveIt() {
        assertEquals("Northfield", Physicals.value(session, site, Physical.LOCATION_PATH_OF));
        assertEquals("Northfield / Room 1 / Shelf B", Physicals.value(session, shelfB, Physical.LOCATION_PATH_OF));
        assertEquals(B1_PATH, Physicals.value(session, b1, Physical.LOCATION_PATH_OF));
    }

    @Test
    public void eachKindIsInsideTheOneBeforeIt() {
        DocumentModel locations = session.getDocument(new org.nuxeo.ecm.core.api.PathRef(Physicals.LOCATIONS));
        assertEquals("bad-location", refused(() -> Physicals.location(session, locations, "Room 9", "room")));
        assertEquals("bad-location", refused(() -> Physicals.location(session, site, "Second site", "site")));
        assertEquals("bad-location", refused(() -> Physicals.location(session, site, "Shelf Z", "shelf")));
        assertEquals("bad-location", refused(() -> Physicals.location(session, room, "Position 9", "position")));
        assertEquals("bad-location", refused(() -> Physicals.location(session, shelfA, "Bin 9", "bin")));
        assertEquals("bad-location", refused(() -> Physicals.location(session, shelfA, " ", "position")));
        assertEquals("bad-location", refused(() -> Physicals.location(session, shelfA, "Two\nlines", "position")));
        DocumentModel a2 = Physicals.location(session, shelfA, "Position 2", "position");
        commit(session);
        assertEquals("Northfield / Room 1 / Shelf A / Position 2", Physicals.value(session, a2, Physical.LOCATION_PATH_OF));
    }

    private static long value(DocumentModel item) {
        Matcher matcher = Barcodes.BARCODE.matcher(String.valueOf(item.getPropertyValue(Physical.BARCODE)));
        assertTrue(matcher.matches());
        return Long.parseLong(matcher.group(2));
    }
}
