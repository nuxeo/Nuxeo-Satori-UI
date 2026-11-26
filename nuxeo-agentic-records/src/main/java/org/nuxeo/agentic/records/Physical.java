package org.nuxeo.agentic.records;

import java.util.List;
import java.util.Set;

/** Physical records' names: their types, permission, states and properties. */
final class Physical {

    // --- The types ----------------------------------------------------------------------------------

    /** A box, a file or a volume: a record of the retention module's, kept at a location. */
    static final String RECORD_TYPE = "PhysicalRecord";

    /** A site, a room, a shelf or a position, nested in that order. */
    static final String LOCATION_TYPE = "PhysicalLocation";

    /** The repository's one custody desk, at its root, where every custody request is filed. */
    static final String DESK_TYPE = "CustodyDesk";

    /** A move, a check-out or a return, asked for by a person. */
    static final String REQUEST_TYPE = "CustodyRequest";

    static final Set<String> TYPES = Set.of(RECORD_TYPE, LOCATION_TYPE, DESK_TYPE, REQUEST_TYPE);

    /** The types no run ever holds: the add-on's own, a physical record's places and requests. */
    static final Set<String> NEVER_DUE = Set.of(LOCATION_TYPE, DESK_TYPE, REQUEST_TYPE);

    static final String RECORD_SCHEMA = "physical_record";

    static final String LOCATION_SCHEMA = "physical_location";

    static final String REQUEST_SCHEMA = "custody_request";

    // --- The permission -----------------------------------------------------------------------------

    /** Filing a custody request in the desk: moving, checking out and returning what the person may read. */
    static final String CUSTODY_PERMISSION = "RecordCustody";

    // --- What a record is, and where it may be --------------------------------------------------------

    static final List<String> KINDS = List.of("box", "file", "volume");

    /** A location's kinds, outermost first: each holds the next. */
    static final List<String> LOCATION_KINDS = List.of("site", "room", "shelf", "position");

    /** How a location's path joins its titles. */
    static final String PATH_SEPARATOR = " / ";

    // --- Its states, and what a run does with it -------------------------------------------------------

    static final String IN = "in";

    static final String OUT = "out";

    static final String DESTROYED = "destroyed";

    static final String TRANSFERRED = "transferred";

    /** What a run does with a physical record once its retention has ended. */
    static final String DESTROY = "destroy";

    static final String TRANSFER = "transfer";

    /** What a run does with an electronic one: the add-on's disposition, a deletion. */
    static final String DELETE = "delete";

    // --- A request's actions, and the custody entries ---------------------------------------------------

    static final String MOVE = "move";

    static final String CHECK_OUT = "check-out";

    static final String RETURN = "return";

    static final String REGISTERED = "registered";

    static final String MOVED = "moved";

    static final String CHECKED_OUT = "checked-out";

    static final String RETURNED = "returned";

    // --- A physical record's properties -------------------------------------------------------------

    static final String KIND = "phys:kind";

    static final String BARCODE = "phys:barcode";

    static final String LOCATION = "phys:location";

    static final String LOCATIONS = "phys:locations";

    static final String LOCATION_PATH = "phys:locationPath";

    static final String STATE = "phys:state";

    static final String BORROWER = "phys:borrower";

    static final String CHECKED_OUT_BY = "phys:checkedOutBy";

    static final String CHECKED_OUT_AT = "phys:checkedOutAt";

    static final String DUE_BACK = "phys:dueBack";

    static final String DISPOSITION_ACTION = "phys:dispositionAction";

    static final String TRANSFER_TO = "phys:transferTo";

    static final String DISPOSED_AT = "phys:disposedAt";

    static final String DISPOSAL_RUN = "phys:disposalRun";

    static final String DISPOSAL_CERTIFICATE = "phys:disposalCertificate";

    static final String CUSTODY = "phys:custody";

    /** The properties a writer of the record may change: what a run is to do with it, until it has. */
    static final List<String> WRITABLE = List.of(DISPOSITION_ACTION, TRANSFER_TO);

    /** The properties written by the server alone, once the record is made. */
    static final List<String> SERVER_WRITTEN = List.of(KIND, BARCODE, LOCATION, LOCATIONS, LOCATION_PATH, STATE, BORROWER,
            CHECKED_OUT_BY, CHECKED_OUT_AT, DUE_BACK, DISPOSED_AT, DISPOSAL_RUN, DISPOSAL_CERTIFICATE, CUSTODY);

    // --- A location's -------------------------------------------------------------------------------

    static final String LOCATION_KIND = "ploc:kind";

    static final String LOCATION_PATH_OF = "ploc:path";

    // --- A custody request's ------------------------------------------------------------------------

    static final String REQUEST_ACTION = "creq:action";

    static final String REQUEST_ITEM = "creq:item";

    static final String REQUEST_LOCATION = "creq:location";

    static final String REQUEST_BORROWER = "creq:borrower";

    static final String REQUEST_DUE_BACK = "creq:dueBack";

    static final String REQUEST_REASON = "creq:reason";

    static final String REQUEST_BY = "creq:by";

    static final String REQUEST_AT = "creq:at";

    static final String REQUEST_BARCODE = "creq:barcode";

    static final String REQUEST_FROM_PATH = "creq:fromPath";

    static final String REQUEST_TO_PATH = "creq:toPath";

    static final String REQUEST_OUTCOME = "creq:outcome";

    // --- Limits -------------------------------------------------------------------------------------

    /** A reason, a transfer's recipient and a borrower's name, at most. */
    static final int MAX_REASON = 2000;

    static final int MAX_NAME = 255;

    static final int MAX_TRANSFER_TO = 500;

    /** A title of a location, at most: every path carries it. */
    static final int MAX_LOCATION_TITLE = 200;

    /** The furthest a check-out's due date may be, in days. */
    static final int MAX_LOAN_DAYS = 366;

    private Physical() {
    }
}
