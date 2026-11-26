package org.nuxeo.agentic.records;

import static org.nuxeo.agentic.records.Fixtures.as;
import static org.nuxeo.agentic.records.Fixtures.calendar;
import static org.nuxeo.agentic.records.Fixtures.commit;

import java.io.Serializable;
import java.time.Duration;
import java.time.Instant;
import java.util.Calendar;
import java.util.List;
import java.util.Map;

import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.core.api.security.impl.ACLImpl;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;

/**
 * The tests' physical records: the custody desk, a records centre's locations, and physical records
 * kept there.
 *
 * <ul>
 * <li><b>frank</b> and <b>heidi</b> are clerks: RecordCustody on the desk.</li>
 * <li><b>dave</b> may read the desk and file in it, and holds no RecordCustody.</li>
 * </ul>
 * Everyone of {@link Fixtures#PEOPLE} reads the locations, as they read the records folder.
 */
final class Physicals {

    static final String DESK = "/custody";

    static final String LOCATIONS = "/locations";

    static final String CLERK = "frank";

    static final String OTHER_CLERK = "heidi";

    private Physicals() {
    }

    /** The custody desk, at the root, its inherited permissions blocked, with the grants above. */
    static DocumentModel desk(CoreSession admin) {
        DocumentModel desk = admin.createDocumentModel("/", DESK.substring(1), Physical.DESK_TYPE);
        desk.setPropertyValue("dc:title", "Custody desk");
        desk = admin.createDocument(desk);
        ACP acp = new ACPImpl();
        ACL acl = new ACLImpl(ACL.LOCAL_ACL);
        acl.add(new ACE(CLERK, Physical.CUSTODY_PERMISSION, true));
        acl.add(new ACE(OTHER_CLERK, Physical.CUSTODY_PERMISSION, true));
        acl.add(new ACE("dave", SecurityConstants.READ, true));
        acl.add(new ACE("dave", SecurityConstants.ADD_CHILDREN, true));
        acl.add(ACE.BLOCK);
        acp.addACL(acl);
        admin.setACP(desk.getRef(), acp, true);
        return admin.getDocument(desk.getRef());
    }

    /** The folder the records centre's sites are in, which everyone reads. */
    static DocumentModel locationsFolder(CoreSession admin) {
        DocumentModel folder = admin.createDocument(admin.createDocumentModel("/", LOCATIONS.substring(1), "Folder"));
        ACP acp = new ACPImpl();
        ACL acl = new ACLImpl(ACL.LOCAL_ACL);
        for (String name : Fixtures.PEOPLE) {
            acl.add(new ACE(name, SecurityConstants.READ, true));
        }
        acp.addACL(acl);
        admin.setACP(folder.getRef(), acp, true);
        return folder;
    }

    /** A location of {@code kind}, titled {@code title}, inside {@code parent}. */
    static DocumentModel location(CoreSession session, DocumentModel parent, String title, String kind) {
        DocumentModel location = session.createDocumentModel(parent.getPathAsString(),
                title.toLowerCase().replace(' ', '-'), Physical.LOCATION_TYPE);
        location.setPropertyValue("dc:title", title);
        location.setPropertyValue(Physical.LOCATION_KIND, kind);
        return session.createDocument(location);
    }

    /** A box in the records folder, made by {@code session}'s person, kept at {@code location}. */
    static DocumentModel item(CoreSession session, String title, DocumentModel location) {
        return item(session, title, "box", location.getId());
    }

    static DocumentModel item(CoreSession session, String title, String kind, String locationId) {
        DocumentModel item = session.createDocumentModel(Fixtures.RECORDS, title.toLowerCase().replace(' ', '-'),
                Physical.RECORD_TYPE);
        item.setPropertyValue("dc:title", title);
        item.setPropertyValue(Physical.KIND, kind);
        item.setPropertyValue(Physical.LOCATION, locationId);
        return session.createDocument(item);
    }

    /**
     * A physical record whose retention has ended, as the module and the platform leave one: as
     * {@link Fixtures#ended}, for a box at {@code location}.
     */
    static DocumentModel ended(CoreSession admin, String title, DocumentModel rule, DocumentModel location, Instant endedAt) {
        DocumentModel doc = item(admin, title, location);
        admin.makeRecord(doc.getRef());
        doc = admin.getDocument(doc.getRef());
        doc.addFacet(Disposition.RECORD_FACET);
        doc.setPropertyValue(Disposition.RECORD_RULE_IDS, new String[] { rule.getId() });
        doc.setPropertyValue(Disposition.RECORD_RETAIN_UNTIL, calendar(endedAt));
        return admin.saveDocument(doc);
    }

    /** Files a custody request as {@code name}, as a REST client's POST of a document would, and commits it: the request, read back. */
    static DocumentModel file(CoreSession admin, String name, String action, String item, String location, String borrower,
            Calendar dueBack, String reason) {
        CoreSession session = as(admin, name);
        DocumentModel request = session.createDocumentModel(DESK, action, Physical.REQUEST_TYPE);
        request.setPropertyValue(Physical.REQUEST_ACTION, action);
        request.setPropertyValue(Physical.REQUEST_ITEM, item);
        request.setPropertyValue(Physical.REQUEST_LOCATION, location);
        request.setPropertyValue(Physical.REQUEST_BORROWER, borrower);
        request.setPropertyValue(Physical.REQUEST_DUE_BACK, dueBack);
        request.setPropertyValue(Physical.REQUEST_REASON, reason);
        request = session.createDocument(request);
        commit(session);
        return admin.getDocument(request.getRef());
    }

    static DocumentModel move(CoreSession admin, String name, DocumentModel item, DocumentModel to, String reason) {
        return file(admin, name, Physical.MOVE, item.getId(), to.getId(), null, null, reason);
    }

    static DocumentModel checkOut(CoreSession admin, String name, DocumentModel item, String borrower, Duration dueIn,
            String reason) {
        return file(admin, name, Physical.CHECK_OUT, item.getId(), null, borrower, calendar(Instant.now().plus(dueIn)),
                reason);
    }

    static DocumentModel giveBack(CoreSession admin, String name, DocumentModel item, DocumentModel to, String reason) {
        return file(admin, name, Physical.RETURN, item.getId(), to == null ? null : to.getId(), null, null, reason);
    }

    /** Blocks what {@code doc} inherits, so that no one but an administrator reads it. */
    static void hide(CoreSession admin, DocumentModel doc) {
        ACP acp = new ACPImpl();
        ACL acl = new ACLImpl(ACL.LOCAL_ACL);
        acl.add(ACE.BLOCK);
        acp.addACL(acl);
        admin.setACP(doc.getRef(), acp, true);
    }

    /** The record's custody as stored, oldest first. */
    static List<Map<String, Serializable>> custody(CoreSession admin, DocumentModel item) {
        return Dispositions.copyList(admin.getDocument(item.getRef()), Physical.CUSTODY);
    }

    static Serializable value(CoreSession admin, DocumentModel doc, String xpath) {
        return admin.getDocument(doc.getRef()).getPropertyValue(xpath);
    }
}
