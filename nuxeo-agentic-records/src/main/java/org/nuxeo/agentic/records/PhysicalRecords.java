package org.nuxeo.agentic.records;

import static org.nuxeo.agentic.records.Physical.*;

import java.io.Serializable;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.event.CoreEventConstants;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;

/**
 * A physical record and its location, as they are made and changed: what the server writes of each,
 * and what it refuses.
 *
 * <h2>A physical record made</h2>
 * Its creator gives its kind, {@code box}, {@code file} or {@code volume}, the location it is kept at,
 * which they may read, and what a disposition run is to do with it, {@code destroy} by default or
 * {@code transfer} to someone named. The server writes the rest, over whatever was sent: a barcode,
 * issued last so that a refusal spends none ({@link Barcodes}); the location, its path and every
 * location above it; {@code in}; and the first entry of its custody, registered there, by its creator.
 *
 * <h2>A location made</h2>
 * A site, a room, a shelf or a position, each inside the one before it: a site anywhere but in another
 * location, a room in a site, a shelf in a room, a position on a shelf. Its path, its title after
 * every title above it, is the server's. Its kind, its path and its title do not change afterwards,
 * since every record put there carries the path; nor is it moved or copied, nor deleted or put in the
 * trash while it, or a location in it, holds a record.
 *
 * <h2>What no one else writes</h2>
 * Everything of a physical record's but its disposition action is the server's: no save changes its
 * barcode, its location, whether it is checked out, or its custody, an administrator's included. Its
 * custody is written by a custody request ({@link Custody}) and by a run that disposes of it, each
 * adding an entry after the others: an entry is never changed or removed. Nor is a physical record
 * copied, checked in or restored, so that no other document carries its barcode, and only an
 * administrator deletes one or puts it in the trash.
 */
final class PhysicalRecords {

    private static final Logger log = LogManager.getLogger(PhysicalRecords.class);

    private final Clock clock;

    PhysicalRecords(Clock clock) {
        this.clock = clock;
    }

    // --- A physical record made -----------------------------------------------------------------------

    /** Checks a new physical record, as its creator sent it, and writes what the server does; or refuses it. */
    void creating(CoreSession session, DocumentModel item) {
        NuxeoPrincipal creator = session.getPrincipal();
        String kind = text(item, KIND);
        if (!KINDS.contains(kind)) {
            throw new DispositionRefusal(400, "bad-record", "A physical record's kind, phys:kind, is \"box\", \"file\" or \"volume\".");
        }
        String action = text(item, DISPOSITION_ACTION);
        action = action.isEmpty() ? DESTROY : action;
        String transferTo = disposition(action, text(item, TRANSFER_TO));
        Place place = CoreInstance.doPrivileged(session,
                (CoreSession privileged) -> place(session, privileged, text(item, LOCATION)));
        Instant now = clock.instant();
        String by = creator == null ? SecurityConstants.SYSTEM_USERNAME : creator.getName();

        for (String xpath : SERVER_WRITTEN) {
            item.setPropertyValue(xpath, null);
        }
        item.setPropertyValue(KIND, kind);
        item.setPropertyValue(DISPOSITION_ACTION, action);
        item.setPropertyValue(TRANSFER_TO, transferTo);
        item.setPropertyValue(STATE, IN);
        at(item, place);
        List<Map<String, Serializable>> custody = new ArrayList<>();
        custody.add(entry(REGISTERED, now, by, null, place, null, null, null,
                "Registered at its location when it was made."));
        item.setPropertyValue(CUSTODY, (Serializable) custody);
        // Last, once nothing else can refuse the record, so that a refusal spends no barcode.
        item.setPropertyValue(BARCODE, Barcodes.issue());
    }

    /** Once made, its registration in the audit: who, where, when. */
    static void created(CoreSession session, DocumentModel item) {
        Map<String, Serializable> extended = new HashMap<>();
        extended.put(RecordsAudit.BARCODE, String.valueOf(item.getPropertyValue(BARCODE)));
        extended.put(RecordsAudit.TO_LOCATION, String.valueOf(item.getPropertyValue(LOCATION)));
        extended.put(RecordsAudit.TO_PATH, String.valueOf(item.getPropertyValue(LOCATION_PATH)));
        RecordsAudit.fire(RecordsAudit.CUSTODY_REGISTERED, session, session.getPrincipal(), item,
                "Registered at its location when it was made", extended);
        log.info("Physical record {} registered by {}", item.getPropertyValue(BARCODE),
                Dispositions.printable(session.getPrincipal() == null ? null : session.getPrincipal().getName()));
    }

    /** What a run is to do, checked: {@code destroy}, or {@code transfer} to someone named; the recipient as kept. */
    private static String disposition(String action, String transferTo) {
        if (DESTROY.equals(action)) {
            return null;
        }
        if (!TRANSFER.equals(action)) {
            throw new DispositionRefusal(400, "bad-record",
                    "A physical record's disposition action, phys:dispositionAction, is \"destroy\" or \"transfer\".");
        }
        if (transferTo.isEmpty() || transferTo.length() > MAX_TRANSFER_TO || hasControl(transferTo)) {
            throw new DispositionRefusal(400, "bad-record", "A transfer names who receives the record, phys:transferTo, in up to "
                    + MAX_TRANSFER_TO + " characters on one line.");
        }
        return transferTo;
    }

    // --- A location made ------------------------------------------------------------------------------

    /** Checks a new location's kind and place in the hierarchy, and writes its path; or refuses it. */
    static void locationCreating(CoreSession session, DocumentModel location) {
        String kind = text(location, LOCATION_KIND);
        int level = LOCATION_KINDS.indexOf(kind);
        if (level < 0) {
            throw new DispositionRefusal(400, "bad-location",
                    "A location's kind, ploc:kind, is \"site\", \"room\", \"shelf\" or \"position\".");
        }
        String title = location.getTitle() == null ? "" : location.getTitle().trim();
        if (title.isEmpty() || title.length() > MAX_LOCATION_TITLE || hasControl(title)) {
            throw new DispositionRefusal(400, "bad-location",
                    "A location has a title, on one line, of up to " + MAX_LOCATION_TITLE + " characters: every path carries it.");
        }
        DocumentRef parentRef = location.getParentRef();
        String path = CoreInstance.doPrivileged(session, (CoreSession privileged) -> {
            DocumentModel parent = parentRef == null || !privileged.exists(parentRef) ? null : privileged.getDocument(parentRef);
            boolean inLocation = parent != null && LOCATION_TYPE.equals(parent.getType());
            if (level == 0) {
                if (inLocation) {
                    throw new DispositionRefusal(400, "bad-location", "A site is not inside another location.");
                }
                return title;
            }
            String above = LOCATION_KINDS.get(level - 1);
            if (!inLocation || !above.equals(text(parent, LOCATION_KIND))) {
                throw new DispositionRefusal(400, "bad-location", "A " + kind + " is made inside a " + above + ".");
            }
            return text(parent, LOCATION_PATH_OF) + PATH_SEPARATOR + title;
        });
        location.setPropertyValue("dc:title", title);
        location.setPropertyValue(LOCATION_KIND, kind);
        location.setPropertyValue(LOCATION_PATH_OF, path);
    }

    // --- Where a record is ----------------------------------------------------------------------------

    /** A location, as a record is put there: its id, its own and every location's above it, site first, and its path. */
    record Place(String id, List<String> ids, String path) {
    }

    /**
     * The location {@code id} names, read with {@code reader}'s permissions: refused, the same way,
     * when it does not exist or the reader may not read it, and when it is in the trash.
     */
    static Place place(CoreSession reader, CoreSession privileged, String id) {
        IdRef ref = id == null || !DueRecords.ID.matcher(id).matches() ? null : new IdRef(id);
        DocumentModel location = ref == null || !privileged.exists(ref) ? null : privileged.getDocument(ref);
        if (location == null || !LOCATION_TYPE.equals(location.getType()) || location.isProxy() || location.isVersion()
                || !reader.hasPermission(ref, SecurityConstants.READ)) {
            throw new DispositionRefusal(404, "no-location", "The request names no location you may read, by its id.");
        }
        if (location.isTrashed()) {
            throw new DispositionRefusal(409, "location-trashed", "The location is in the trash: nothing is put there.");
        }
        List<String> ids = new ArrayList<>();
        DocumentModel at = location;
        while (at != null && LOCATION_TYPE.equals(at.getType())) {
            ids.add(at.getId());
            DocumentRef parent = at.getParentRef();
            at = parent == null || !privileged.exists(parent) ? null : privileged.getDocument(parent);
        }
        Collections.reverse(ids);
        return new Place(location.getId(), List.copyOf(ids), text(location, LOCATION_PATH_OF));
    }

    /** Puts {@code item} at {@code place}, or nowhere for {@code null}. */
    static void at(DocumentModel item, Place place) {
        item.setPropertyValue(LOCATION, place == null ? null : place.id());
        item.setPropertyValue(LOCATIONS, place == null ? null : (Serializable) new ArrayList<>(place.ids()));
        item.setPropertyValue(LOCATION_PATH, place == null ? null : place.path());
    }

    /** One custody entry: from a place or a borrower, to a place or a borrower, by whom, when and why. */
    static Map<String, Serializable> entry(String event, Instant at, String by, Place from, Place to, String borrower,
            Calendar dueBack, String transferredTo, String reason) {
        Map<String, Serializable> entry = new LinkedHashMap<>();
        entry.put("event", event);
        entry.put("at", Dispositions.calendar(at));
        entry.put("by", by);
        entry.put("fromLocation", from == null ? null : from.id());
        entry.put("fromPath", from == null ? null : from.path());
        entry.put("toLocation", to == null ? null : to.id());
        entry.put("toPath", to == null ? null : to.path());
        entry.put("borrower", borrower);
        entry.put("dueBack", dueBack);
        entry.put("transferredTo", transferredTo);
        entry.put("reason", reason);
        return entry;
    }

    /** Where a record is now, as its properties say: its location, or {@code null} when it has none. */
    static Place current(DocumentModel item) {
        String id = text(item, LOCATION);
        if (id.isEmpty()) {
            return null;
        }
        List<String> ids = new ArrayList<>();
        if (item.getPropertyValue(LOCATIONS) instanceof Object[] array) {
            for (Object each : array) {
                ids.add(String.valueOf(each));
            }
        } else if (item.getPropertyValue(LOCATIONS) instanceof List<?> list) {
            for (Object each : list) {
                ids.add(String.valueOf(each));
            }
        }
        return new Place(id, List.copyOf(ids), text(item, LOCATION_PATH));
    }

    // --- In a disposition run -------------------------------------------------------------------------

    /** Why a physical record is not due, in a phrase that follows "It", or {@code null}; for any other document, {@code null}. */
    static String whyNotDue(DocumentModel doc) {
        if (!RECORD_TYPE.equals(doc.getType())) {
            return null;
        }
        String state = text(doc, STATE);
        if (doc.getPropertyValue(DISPOSED_AT) != null || DESTROYED.equals(state) || TRANSFERRED.equals(state)) {
            return "has been disposed of already";
        }
        if (OUT.equals(state)) {
            return "is checked out, and is disposed of once it is back";
        }
        if (!IN.equals(state)) {
            return "is not in its location";
        }
        String action = text(doc, DISPOSITION_ACTION);
        if (!DESTROY.equals(action) && !(TRANSFER.equals(action) && !text(doc, TRANSFER_TO).isEmpty())) {
            return "has no disposition action a run can take";
        }
        return null;
    }

    /** A physical record's disposition action, as a run keeps it: {@code destroy} or {@code transfer}. */
    static String disposalOf(DocumentModel doc) {
        return TRANSFER.equals(text(doc, DISPOSITION_ACTION)) ? TRANSFER : DESTROY;
    }

    /**
     * A physical record disposed of by {@code run}: destroyed or transferred, in the disposal's own
     * transaction, written on the record and in its custody, by the approver whose approval disposed
     * of the run; and its audit entry. Nothing is deleted.
     */
    static void disposed(CoreSession privileged, DueRecords.Due record, DocumentModel run, DocumentModel certificate,
            NuxeoPrincipal approver, List<String> approvers, Map<String, Serializable> runInfo, Instant now) {
        DocumentModel item = privileged.getDocument(new IdRef(record.uid()));
        boolean transfer = TRANSFER.equals(record.disposal());
        String method = transfer ? TRANSFERRED : DESTROYED;
        long number = Dispositions.longValue(run.getPropertyValue(Disposition.RUN_NUMBER));
        Place from = current(item);
        String why = "Disposition run " + number + ", approved by " + String.join(" and ", approvers) + "; certificate "
                + certificate.getId() + ".";
        List<Map<String, Serializable>> custody = Dispositions.copyList(item, CUSTODY);
        custody.add(entry(method, now, approver.getName(), from, null, null, null, transfer ? record.transferTo() : null, why));
        item.setPropertyValue(CUSTODY, (Serializable) custody);
        item.setPropertyValue(STATE, method);
        item.setPropertyValue(DISPOSED_AT, Dispositions.calendar(now));
        item.setPropertyValue(DISPOSAL_RUN, run.getId());
        item.setPropertyValue(DISPOSAL_CERTIFICATE, certificate.getId());
        at(item, null);
        DocumentModel saved = ServiceWrites.run(() -> privileged.saveDocument(item));

        Map<String, Serializable> extended = new HashMap<>(runInfo);
        extended.put(RecordsAudit.BARCODE, record.barcode());
        extended.put(RecordsAudit.METHOD, method);
        if (from != null) {
            extended.put(RecordsAudit.FROM_LOCATION, from.id());
            extended.put(RecordsAudit.FROM_PATH, from.path());
        }
        if (transfer) {
            extended.put(RecordsAudit.TRANSFER_TO, record.transferTo());
        }
        RecordsAudit.fire(transfer ? RecordsAudit.RECORD_TRANSFERRED : RecordsAudit.RECORD_DESTROYED, privileged, approver,
                saved, (transfer ? "Transferred to " + record.transferTo() : "Destroyed") + " in disposition run " + number
                        + ", its record kept; approved by " + String.join(" and ", approvers) + "; certificate "
                        + certificate.getId(), extended);
    }

    // --- What no one else writes ----------------------------------------------------------------------

    /**
     * A save of a physical record: refused when it changes anything the server writes, and when it
     * changes its disposition action once it has been disposed of, or to one a run cannot take.
     */
    static void modified(DocumentEventContext context, DocumentModel item) {
        DocumentModel previous = previous(context, item);
        List<String> changed = changes(previous, item, SERVER_WRITTEN);
        if (!changed.isEmpty()) {
            throw new DispositionRefusal(403, "server-only", String.join(", ", changed) + (changed.size() == 1 ? " is" : " are")
                    + " written by the server alone: a physical record is moved, checked out and returned by a custody request.");
        }
        if (changes(previous, item, WRITABLE).isEmpty()) {
            return;
        }
        String state = text(previous, STATE);
        if (DESTROYED.equals(state) || TRANSFERRED.equals(state)) {
            throw new DispositionRefusal(409, "disposed", "The record has been disposed of: what became of it is kept as it was.");
        }
        String action = text(item, DISPOSITION_ACTION);
        String transferTo = disposition(action.isEmpty() ? DESTROY : action, text(item, TRANSFER_TO));
        item.setPropertyValue(DISPOSITION_ACTION, action.isEmpty() ? DESTROY : action);
        item.setPropertyValue(TRANSFER_TO, transferTo);
    }

    /** A save of a location: its kind, its path and its title are kept as they were made. */
    static void locationModified(DocumentEventContext context, DocumentModel location) {
        DocumentModel previous = previous(context, location);
        if (!changes(previous, location, List.of(LOCATION_KIND, LOCATION_PATH_OF, "dc:title")).isEmpty()) {
            throw new DispositionRefusal(403, "kept",
                    "A location's kind, path and title are kept as they were made: every record there carries its path.");
        }
    }

    /** A save of a custody request: nothing of the add-on's changes once it is filed. */
    static void requestModified(DocumentEventContext context, DocumentModel request) {
        DocumentModel previous = previous(context, request);
        List<String> mine = new ArrayList<>(List.of(REQUEST_ACTION, REQUEST_ITEM, REQUEST_LOCATION, REQUEST_BORROWER,
                REQUEST_DUE_BACK, REQUEST_REASON, REQUEST_BY, REQUEST_AT, REQUEST_BARCODE, REQUEST_FROM_PATH,
                REQUEST_TO_PATH, REQUEST_OUTCOME));
        if (!changes(previous, request, mine).isEmpty()) {
            throw new DispositionRefusal(403, "server-only", "A custody request is kept as it was filed.");
        }
    }

    /** Whether a location, or one inside it, holds a record: what its record's locations name. */
    static boolean holdsRecords(CoreSession privileged, String locationId) {
        if (!DueRecords.ID.matcher(locationId).matches()) {
            return true;
        }
        return !privileged.queryProjection("SELECT ecm:uuid FROM " + RECORD_TYPE + " WHERE " + LOCATIONS + " = '" + locationId
                + "' AND ecm:isProxy = 0 AND ecm:isVersion = 0", 1, 0).isEmpty();
    }

    /**
     * What a folder holds that a copy or a deletion of it would take along with no event of its own:
     * {@code true} when anything below it is of {@code types}, read with the add-on's session, since
     * the repository takes the whole tree, what its user may not read included.
     */
    static boolean holds(CoreSession privileged, DocumentModel folder, List<String> types) {
        String id = folder.getId();
        if (id == null || !DueRecords.ID.matcher(id).matches()) {
            return true;
        }
        return !privileged.queryProjection("SELECT ecm:uuid FROM Document WHERE ecm:ancestorId = '" + id
                + "' AND ecm:primaryType IN ('" + String.join("', '", types) + "') AND ecm:isProxy = 0", 1, 0).isEmpty();
    }

    /** Whether a site below {@code folder} holds a record: its deletion would leave the record nowhere. */
    static boolean sitesHoldRecords(CoreSession privileged, DocumentModel folder) {
        String id = folder.getId();
        if (id == null || !DueRecords.ID.matcher(id).matches()) {
            return true;
        }
        String sites = "SELECT ecm:uuid FROM " + LOCATION_TYPE + " WHERE ecm:ancestorId = '" + id + "' AND " + LOCATION_KIND
                + " = 'site' AND ecm:isProxy = 0 ORDER BY ecm:uuid";
        for (long offset = 0;; offset += 100) {
            var page = privileged.queryProjection(sites, 100, offset);
            for (Map<String, Serializable> site : page) {
                if (holdsRecords(privileged, String.valueOf(site.get("ecm:uuid")))) {
                    return true;
                }
            }
            if (page.size() < 100) {
                return false;
            }
        }
    }

    // --- Shared ---------------------------------------------------------------------------------------

    private static DocumentModel previous(DocumentEventContext context, DocumentModel doc) {
        return context.getProperty(CoreEventConstants.PREVIOUS_DOCUMENT_MODEL) instanceof DocumentModel previous ? previous
                : CoreInstance.doPrivileged(context.getCoreSession(),
                        (CoreSession privileged) -> privileged.getDocument(doc.getRef()));
    }

    /** The properties among {@code xpaths} whose stored value differs, in order: a time by its instant, a text as written. */
    static List<String> changes(DocumentModel before, DocumentModel after, List<String> xpaths) {
        List<String> changed = new ArrayList<>();
        for (String xpath : xpaths) {
            if (!Objects.equals(normal(before.getPropertyValue(xpath)), normal(after.getPropertyValue(xpath)))) {
                changed.add(xpath);
            }
        }
        return changed;
    }

    /** A value made comparable: no text, list or value the same; a time its instant; a list item by item; a map by its fields. */
    static Object normal(Object value) {
        if (value instanceof String text) {
            return text.isEmpty() ? null : text;
        }
        if (value instanceof Calendar calendar) {
            return calendar.getTimeInMillis();
        }
        if (value instanceof Date date) {
            return date.getTime();
        }
        if (value instanceof Object[] array) {
            return normal(Arrays.asList(array));
        }
        if (value instanceof List<?> list) {
            if (list.isEmpty()) {
                return null;
            }
            List<Object> items = new ArrayList<>();
            for (Object item : list) {
                items.add(normal(item));
            }
            return items;
        }
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> fields = new java.util.TreeMap<>();
            map.forEach((key, field) -> {
                Object normal = normal(field);
                if (normal != null) {
                    fields.put(String.valueOf(key), normal);
                }
            });
            return fields.isEmpty() ? null : fields;
        }
        return value;
    }

    static String text(DocumentModel doc, String xpath) {
        return doc.getPropertyValue(xpath) instanceof String value ? value.trim() : "";
    }

    /** Whether {@code text} holds a character that would start a line of its own, or worse. */
    static boolean hasControl(String text) {
        return text.codePoints().anyMatch(Character::isISOControl);
    }
}
