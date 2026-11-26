package org.nuxeo.agentic.records;

import static org.nuxeo.agentic.records.Fixtures.commit;

import org.junit.Before;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * Physical records in Nuxeo's own test framework, as {@link DispositionTestCase}, with a records
 * centre: the custody desk, and one site, with a room, two shelves and a position on each.
 */
public abstract class PhysicalTestCase extends DispositionTestCase {

    protected DocumentModel desk;

    protected DocumentModel site;

    protected DocumentModel room;

    protected DocumentModel shelfA;

    protected DocumentModel shelfB;

    protected DocumentModel a1;

    protected DocumentModel b1;

    @Before
    public void setUpRecordsCentre() {
        desk = Physicals.desk(session);
        DocumentModel locations = Physicals.locationsFolder(session);
        site = Physicals.location(session, locations, "Northfield", "site");
        room = Physicals.location(session, site, "Room 1", "room");
        shelfA = Physicals.location(session, room, "Shelf A", "shelf");
        shelfB = Physicals.location(session, room, "Shelf B", "shelf");
        a1 = Physicals.location(session, shelfA, "Position 1", "position");
        b1 = Physicals.location(session, shelfB, "Position 1", "position");
        commit(session);
    }

    protected static final String A1_PATH = "Northfield / Room 1 / Shelf A / Position 1";

    protected static final String B1_PATH = "Northfield / Room 1 / Shelf B / Position 1";
}
