package org.nuxeo.agentic.records;

import static org.nuxeo.agentic.records.Physical.*;

import java.io.Serializable;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentModelList;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.core.api.security.impl.ACLImpl;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * A physical record's chain of custody: a move, a check-out or a return, asked for by a person who
 * files a {@code CustodyRequest} in the repository's {@code CustodyDesk}, and recorded on the server.
 *
 * <h2>Who</h2>
 * The filer holds {@code RecordCustody} on the desk, which blocks every permission it would
 * inherit, as the disposition runs folder does, and may read the record and the location it names.
 * A record or a location they may not read is answered as one that does not exist.
 *
 * <h2>What</h2>
 * <ul>
 * <li><b>move</b>, to {@code creq:location}: a record in its location, to another.</li>
 * <li><b>check-out</b>, to {@code creq:borrower}, the filer when none is named, due back by
 * {@code creq:dueBack}: a record in its location. <b>A record checked out is not checked out
 * again, nor moved, until it is returned.</b></li>
 * <li><b>return</b>, to {@code creq:location}, or where it was kept when none is named: a record
 * checked out.</li>
 * </ul>
 * Each names its record by its barcode, its check digit checked, or its id, and says why,
 * {@code creq:reason}. A record disposed of takes none.
 *
 * <h2>Recorded</h2>
 * Each adds one entry to the record's custody, after the others, with who, from where to where,
 * when and why; changes where the record is, and whether it is checked out; and writes an entry of
 * its own kind to the platform's audit, {@code custody}, which the audit export carries. No one
 * changes or removes an entry afterwards: the record's custody is the server's alone
 * ({@link PhysicalRecords#modified}).
 *
 * <h2>One at a time</h2>
 * Inside the disposition review's lock, the server's and the cluster's, and in a transaction of its
 * own, as a disposition request is ({@link Dispositions}): so two check-outs of one record at once
 * are taken one after the other, and the second is refused; and a run never disposes of a record
 * while it is being moved or checked out. The request document is then written by the person's own
 * transaction, with what came of it, and made readable by its filer alone.
 */
final class Custody {

    private static final Logger log = LogManager.getLogger(Custody.class);

    /** A Nuxeo document id, as a client names a record by it rather than by its barcode. */
    static final Pattern UUID = Pattern.compile("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}");

    /** What a request came to. */
    record Outcome(String itemId, String barcode, String outcome, String locationId, String fromPath, String toPath,
            String borrower) {
    }

    private final Clock clock;

    private final Dispositions.Lock lock;

    Custody(Clock clock, Dispositions.Lock lock) {
        this.clock = clock;
        this.lock = lock;
    }

    // --- The desk -----------------------------------------------------------------------------------

    /** A new desk: an administrator's, at the repository's root, one per repository, as the disposition runs folder. */
    static void deskCreated(CoreSession session, DocumentModel desk) {
        if (!session.getPrincipal().isAdministrator()) {
            throw new DispositionRefusal(403, "administrators-only", "Only an administrator makes the repository's custody desk.");
        }
        CoreInstance.doPrivileged(session, (CoreSession privileged) -> {
            if (!Dispositions.atRoot(privileged, desk.getParentRef())) {
                throw new DispositionRefusal(400, "not-at-root",
                        "The custody desk is made at the repository's root, where no one but an administrator removes or copies what holds it.");
            }
            if (Dispositions.count(privileged, DESK_TYPE) > 0) {
                throw new DispositionRefusal(409, "desk-exists", "The repository has its custody desk already: there is one.");
            }
        });
    }

    /** The repository's desk at {@code parent}, checked: the one, at the root, out of the trash, blocking what it would inherit. */
    static DocumentModel deskOf(CoreSession privileged, DocumentRef parent) {
        DocumentModel desk = parent == null || !privileged.exists(parent) ? null : privileged.getDocument(parent);
        if (desk == null || !DESK_TYPE.equals(desk.getType()) || desk.isProxy() || desk.isVersion()) {
            throw new DispositionRefusal(400, "not-in-desk",
                    "A custody request is filed in the repository's custody desk, a " + DESK_TYPE + ".");
        }
        if (!Dispositions.atRoot(privileged, desk.getParentRef()) || Dispositions.count(privileged, DESK_TYPE) != 1
                || desk.isTrashed()) {
            throw new DispositionRefusal(409, "desk-misplaced",
                    "The repository's custody desk must be its one, at the repository's root, out of the trash; until an "
                            + "administrator puts it back, no request is taken.");
        }
        if (!Dispositions.blocksInheritance(privileged.getACP(desk.getRef()))) {
            throw new DispositionRefusal(409, "desk-inherits",
                    "The custody desk must block the permissions it would inherit, so that only its own grants count; until an "
                            + "administrator blocks them, no request is taken.");
        }
        return desk;
    }

    // --- A request filed ----------------------------------------------------------------------------

    /** Handles {@code request}, filed by the person of {@code session}, and fills in what came of it; or refuses it. */
    void file(CoreSession session, DocumentModel request) {
        NuxeoPrincipal person = Dispositions.person(session, "A custody request");
        String action = PhysicalRecords.text(request, REQUEST_ACTION);
        String item = PhysicalRecords.text(request, REQUEST_ITEM);
        String location = PhysicalRecords.text(request, REQUEST_LOCATION);
        String borrower = PhysicalRecords.text(request, REQUEST_BORROWER);
        Calendar dueBack = request.getPropertyValue(REQUEST_DUE_BACK) instanceof Calendar calendar ? calendar : null;
        String reason = PhysicalRecords.text(request, REQUEST_REASON);
        if (!MOVE.equals(action) && !CHECK_OUT.equals(action) && !RETURN.equals(action)) {
            throw bad("A custody request's action, creq:action, is \"move\", \"check-out\" or \"return\".");
        }
        if (item.isEmpty() || item.length() > 128) {
            throw bad("A custody request names its physical record, creq:item, by its barcode or its id.");
        }
        if (reason.isEmpty() || reason.length() > MAX_REASON) {
            throw bad("A custody request says why, creq:reason, in up to " + MAX_REASON + " characters.");
        }
        if (MOVE.equals(action) && location.isEmpty()) {
            throw bad("A move names where to, creq:location, a location's id.");
        }
        if (CHECK_OUT.equals(action)) {
            if (!location.isEmpty()) {
                throw bad("A check-out names no location: the record goes to its borrower, and comes back with a return.");
            }
            if (dueBack == null) {
                throw bad("A check-out says when the record is due back, creq:dueBack.");
            }
            if (borrower.length() > MAX_NAME || PhysicalRecords.hasControl(borrower)) {
                throw bad("A check-out's borrower, creq:borrower, is a name of up to " + MAX_NAME + " characters on one line.");
            }
        } else if (!borrower.isEmpty() || dueBack != null) {
            throw bad("Only a check-out names a borrower and a due date.");
        }
        String to = CHECK_OUT.equals(action) ? (borrower.isEmpty() ? person.getName() : borrower) : null;
        DocumentRef deskRef = request.getParentRef();
        String repository = session.getRepositoryName();
        Outcome[] outcome = new Outcome[1];
        RuntimeException[] failed = new RuntimeException[1];
        lock.run(() -> {
            try {
                outcome[0] = TransactionHelper.runInNewTransaction(
                        () -> CoreInstance.doPrivileged(repository, (CoreSession privileged) -> {
                            CoreSession as = CoreInstance.getCoreSession(repository, person);
                            DocumentModel desk = deskOf(privileged, deskRef);
                            if (!as.hasPermission(desk.getRef(), CUSTODY_PERMISSION)) {
                                throw new DispositionRefusal(403, "permission",
                                        "A custody request needs the RecordCustody permission on the custody desk.");
                            }
                            DocumentModel record = record(as, privileged, item);
                            return act(as, privileged, record, person, action, location, to, dueBack, reason, clock.instant());
                        }));
            } catch (RuntimeException e) {
                failed[0] = e;
            }
        });
        if (failed[0] != null) {
            throw failed[0];
        }
        Outcome done = outcome[0];
        request.setPropertyValue("dc:title", switch (action) {
        case MOVE -> "Move of ";
        case CHECK_OUT -> "Check-out of ";
        default -> "Return of ";
        } + done.barcode() + " by " + person.getName());
        request.setPropertyValue(REQUEST_ACTION, action);
        request.setPropertyValue(REQUEST_ITEM, done.itemId());
        request.setPropertyValue(REQUEST_LOCATION, done.locationId());
        request.setPropertyValue(REQUEST_BORROWER, done.borrower());
        request.setPropertyValue(REQUEST_DUE_BACK, CHECK_OUT.equals(action) ? dueBack : null);
        request.setPropertyValue(REQUEST_REASON, reason);
        request.setPropertyValue(REQUEST_BY, person.getName());
        request.setPropertyValue(REQUEST_AT, Dispositions.calendar(clock.instant()));
        request.setPropertyValue(REQUEST_BARCODE, done.barcode());
        request.setPropertyValue(REQUEST_FROM_PATH, done.fromPath());
        request.setPropertyValue(REQUEST_TO_PATH, done.toPath());
        request.setPropertyValue(REQUEST_OUTCOME, done.outcome());
    }

    /**
     * The physical record {@code named}, by its barcode or its id, read with {@code as}'s
     * permissions: one they may not read is answered as one that does not exist.
     */
    static DocumentModel record(CoreSession as, CoreSession privileged, String named) {
        String barcode = Barcodes.normal(named);
        DocumentModel found = null;
        if (!UUID.matcher(named).matches() && Barcodes.looksLike(barcode)) {
            if (!Barcodes.valid(barcode)) {
                throw new DispositionRefusal(400, "bad-barcode",
                        "The barcode's check digit does not match the rest of it: it was mistyped or misread.");
            }
            // The barcode is capital letters and digits alone: nothing of it can change the query.
            DocumentModelList matches = as.query("SELECT * FROM " + RECORD_TYPE + " WHERE " + BARCODE + " = '" + barcode
                    + "' AND ecm:isProxy = 0 AND ecm:isVersion = 0", null, 2, 0, false);
            found = matches.size() == 1 ? matches.get(0) : null;
        } else if (DueRecords.ID.matcher(named).matches()) {
            IdRef ref = new IdRef(named);
            if (privileged.exists(ref) && as.hasPermission(ref, SecurityConstants.READ)) {
                found = privileged.getDocument(ref);
            }
        } else {
            throw bad("A custody request names its physical record, creq:item, by its barcode or its id.");
        }
        if (found == null || !RECORD_TYPE.equals(found.getType()) || found.isProxy() || found.isVersion()) {
            throw new DispositionRefusal(404, "no-item", "The request names no physical record you may read.");
        }
        return privileged.getDocument(found.getRef());
    }

    /** What the request does to {@code record}, in the request's own transaction, inside the lock; or a refusal. */
    private static Outcome act(CoreSession as, CoreSession privileged, DocumentModel record, NuxeoPrincipal person,
            String action, String location, String borrower, Calendar dueBack, String reason, Instant now) {
        String state = PhysicalRecords.text(record, STATE);
        String barcode = PhysicalRecords.text(record, BARCODE);
        if (DESTROYED.equals(state) || TRANSFERRED.equals(state)) {
            throw new DispositionRefusal(409, "disposed", "The record has been " + state + ": it is in no one's custody now.");
        }
        if (record.isTrashed()) {
            throw new DispositionRefusal(409, "trashed", "The record is in the trash: take it out first.");
        }
        PhysicalRecords.Place from = PhysicalRecords.current(record);
        List<Map<String, Serializable>> custody = Dispositions.copyList(record, CUSTODY);
        Map<String, Serializable> extended = new HashMap<>();
        extended.put(RecordsAudit.BARCODE, barcode);
        String event;
        String outcome;
        String fromPath;
        String toPath;
        String locationId = null;
        String lent = null;
        switch (action) {
        case CHECK_OUT -> {
            if (OUT.equals(state)) {
                throw new DispositionRefusal(409, "checked-out", "The record is checked out already, to "
                        + PhysicalRecords.text(record, BORROWER) + ": it is returned before it is checked out again.");
            }
            requireIn(state);
            Instant due = dueBack.toInstant();
            if (!due.isAfter(now) || due.isAfter(now.plus(Duration.ofDays(MAX_LOAN_DAYS)))) {
                throw bad("A check-out's due date, creq:dueBack, is after now and within " + MAX_LOAN_DAYS + " days.");
            }
            Calendar dueAt = Dispositions.calendar(due);
            custody.add(PhysicalRecords.entry(CHECKED_OUT, now, person.getName(), from, null, borrower, dueAt, null, reason));
            record.setPropertyValue(STATE, OUT);
            record.setPropertyValue(BORROWER, borrower);
            record.setPropertyValue(CHECKED_OUT_BY, person.getName());
            record.setPropertyValue(CHECKED_OUT_AT, Dispositions.calendar(now));
            record.setPropertyValue(DUE_BACK, dueAt);
            event = RecordsAudit.CUSTODY_CHECKED_OUT;
            outcome = CHECKED_OUT;
            fromPath = from == null ? null : from.path();
            toPath = null;
            lent = borrower;
            extended.put(RecordsAudit.BORROWER, borrower);
            extended.put(RecordsAudit.DUE_BACK, due.toString());
        }
        case RETURN -> {
            if (!OUT.equals(state)) {
                throw new DispositionRefusal(409, "not-checked-out", "The record is not checked out: there is nothing to return.");
            }
            String where = location.isEmpty() ? PhysicalRecords.text(record, LOCATION) : location;
            PhysicalRecords.Place to;
            try {
                to = PhysicalRecords.place(as, privileged, where);
            } catch (DispositionRefusal refusal) {
                if (!location.isEmpty()) {
                    throw refusal;
                }
                throw new DispositionRefusal(409, "no-home",
                        "Where the record was kept is no longer a location you may put it in: the return names one, creq:location.");
            }
            lent = PhysicalRecords.text(record, BORROWER);
            custody.add(PhysicalRecords.entry(RETURNED, now, person.getName(), null, to, lent, null, null, reason));
            record.setPropertyValue(STATE, IN);
            for (String xpath : List.of(BORROWER, CHECKED_OUT_BY, CHECKED_OUT_AT, DUE_BACK)) {
                record.setPropertyValue(xpath, null);
            }
            PhysicalRecords.at(record, to);
            event = RecordsAudit.CUSTODY_RETURNED;
            outcome = RETURNED;
            fromPath = null;
            toPath = to.path();
            locationId = to.id();
            extended.put(RecordsAudit.BORROWER, lent);
            extended.put(RecordsAudit.TO_LOCATION, to.id());
            extended.put(RecordsAudit.TO_PATH, to.path());
        }
        default -> {
            if (OUT.equals(state)) {
                throw new DispositionRefusal(409, "checked-out", "The record is checked out, to "
                        + PhysicalRecords.text(record, BORROWER) + ": it is returned before it is moved.");
            }
            requireIn(state);
            PhysicalRecords.Place to = PhysicalRecords.place(as, privileged, location);
            if (from != null && from.id().equals(to.id())) {
                throw new DispositionRefusal(409, "already-there", "The record is at that location already.");
            }
            custody.add(PhysicalRecords.entry(MOVED, now, person.getName(), from, to, null, null, null, reason));
            PhysicalRecords.at(record, to);
            event = RecordsAudit.CUSTODY_MOVED;
            outcome = MOVED;
            fromPath = from == null ? null : from.path();
            toPath = to.path();
            locationId = to.id();
            extended.put(RecordsAudit.TO_LOCATION, to.id());
            extended.put(RecordsAudit.TO_PATH, to.path());
        }
        }
        if (fromPath != null) {
            extended.put(RecordsAudit.FROM_LOCATION, from.id());
            extended.put(RecordsAudit.FROM_PATH, fromPath);
        }
        record.setPropertyValue(CUSTODY, (Serializable) custody);
        DocumentModel saved = ServiceWrites.run(() -> privileged.saveDocument(record));
        RecordsAudit.fire(event, privileged, person, saved, reason, extended);
        log.info("Physical record {}: {} by {}", barcode, outcome, Dispositions.printable(person.getName()));
        return new Outcome(saved.getId(), barcode, outcome, locationId, fromPath, toPath, lent);
    }

    private static void requireIn(String state) {
        if (!IN.equals(state)) {
            throw new DispositionRefusal(409, "not-in-location", "The record is not in its location.");
        }
    }

    private static DispositionRefusal bad(String message) {
        return new DispositionRefusal(400, "bad-request", message);
    }

    /** Once filed, a request is readable by its filer alone, and the server's administrators. */
    static void restrict(CoreSession session, DocumentModel request) {
        String by = String.valueOf(request.getPropertyValue(REQUEST_BY));
        CoreInstance.doPrivileged(session, (CoreSession privileged) -> {
            ACP acp = new ACPImpl();
            ACL acl = new ACLImpl(ACL.LOCAL_ACL);
            acl.add(new ACE(by, SecurityConstants.READ, true));
            acl.add(ACE.BLOCK);
            acp.addACL(acl);
            privileged.setACP(request.getRef(), acp, true);
        });
    }
}
