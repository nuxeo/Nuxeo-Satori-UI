package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.nuxeo.agentic.records.Fixtures.commit;
import static org.nuxeo.agentic.records.Fixtures.refused;
import static org.nuxeo.agentic.records.Physicals.CLERK;

import java.time.Duration;

import org.junit.Before;
import org.junit.Test;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.core.api.security.impl.ACLImpl;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;

/**
 * Who may move, check out and return a physical record: a person with RecordCustody on the
 * repository's one custody desk, which blocks what it would inherit, and who may read the record and
 * the location; a record or a location they may not read is answered as one that does not exist.
 * And who makes the desk: an administrator, at the root, once.
 */
public class PhysicalPermissionTest extends PhysicalTestCase {

    private DocumentModel box;

    @Before
    public void setUpBox() {
        box = Physicals.item(session, "Box 1", a1);
        commit(session);
    }

    @Test
    public void aRequestNeedsRecordCustodyOnTheDesk() {
        // dave may read the desk and file in it, but holds no RecordCustody.
        assertEquals("permission", refused(() -> Physicals.move(session, "dave", box, b1, "Not mine to move")));
        assertEquals("permission", refused(() -> Physicals.checkOut(session, "dave", box, null, Duration.ofDays(1), "Nor this")));
        assertEquals(1, Physicals.custody(session, box).size());
    }

    @Test
    public void aRecordOrALocationTheFilerMayNotReadIsAnsweredAsNone() {
        Physicals.hide(session, box);
        Physicals.hide(session, b1);
        DocumentModel other = Physicals.item(session, "Box 2", a1);
        commit(session);
        String hidden = (String) Physicals.value(session, box, Physical.BARCODE);
        assertEquals("no-item", refused(() -> Physicals.move(session, CLERK, box, a1, "Hidden by id")));
        assertEquals("no-item", refused(() -> Physicals.file(session, CLERK, Physical.MOVE, hidden, b1.getId(), null, null,
                "Hidden by barcode")));
        // The same answer as for a record that does not exist.
        String none = Barcodes.format("PR", 99_999_999L);
        assertEquals("no-item", refused(() -> Physicals.file(session, CLERK, Physical.MOVE, none, b1.getId(), null, null,
                "No such barcode")));
        assertEquals("no-item", refused(() -> Physicals.file(session, CLERK, Physical.MOVE, rule.getId(), b1.getId(), null,
                null, "Not a physical record")));
        // A location the filer may not read, the same.
        assertEquals("no-location", refused(() -> Physicals.move(session, CLERK, other, b1, "Hidden location")));
        Physicals.move(session, CLERK, other, shelfA, "A shelf they may read");
        assertEquals(shelfA.getId(), Physicals.value(session, other, Physical.LOCATION));
    }

    @Test
    public void aRequestIsFiledInTheDeskAloneByAPerson() {
        DocumentModel elsewhere = Fixtures.as(session, "alice").createDocumentModel(Fixtures.RECORDS, "request",
                Physical.REQUEST_TYPE);
        elsewhere.setPropertyValue(Physical.REQUEST_ACTION, Physical.MOVE);
        elsewhere.setPropertyValue(Physical.REQUEST_ITEM, box.getId());
        elsewhere.setPropertyValue(Physical.REQUEST_LOCATION, b1.getId());
        elsewhere.setPropertyValue(Physical.REQUEST_REASON, "Filed where requests are not");
        ACP records = session.getACP(new PathRef(Fixtures.RECORDS));
        records.getACL("local").add(new ACE("alice", SecurityConstants.ADD_CHILDREN, true));
        session.setACP(new PathRef(Fixtures.RECORDS), records, true);
        commit(session);
        assertEquals("not-in-desk", refused(() -> Fixtures.as(session, "alice").createDocument(elsewhere)));

        // The server's own session files nothing: a request is a person's.
        CoreSession system = CoreInstance.getCoreSessionSystem(session.getRepositoryName());
        assertEquals("not-a-person", refused(() -> {
            DocumentModel request = system.createDocumentModel(Physicals.DESK, "system", Physical.REQUEST_TYPE);
            request.setPropertyValue(Physical.REQUEST_ACTION, Physical.MOVE);
            request.setPropertyValue(Physical.REQUEST_ITEM, box.getId());
            request.setPropertyValue(Physical.REQUEST_LOCATION, b1.getId());
            request.setPropertyValue(Physical.REQUEST_REASON, "No one's");
            return system.createDocument(request);
        }));
        assertEquals(a1.getId(), Physicals.value(session, box, Physical.LOCATION));
    }

    @Test
    public void aDeskThatInheritsTakesNoRequest() {
        // Unblocked, so that whoever inherits Everything there would hold RecordCustody.
        ACP acp = new ACPImpl();
        ACL acl = new ACLImpl(ACL.LOCAL_ACL);
        acl.add(new ACE(CLERK, Physical.CUSTODY_PERMISSION, true));
        acp.addACL(acl);
        session.setACP(desk.getRef(), acp, true);
        commit(session);
        assertEquals("desk-inherits", refused(() -> Physicals.move(session, CLERK, box, b1, "Through an open desk")));
    }

    @Test
    public void anAdministratorMakesTheDeskAtTheRootOnce() {
        // alice may make documents at the root, and is no administrator.
        ACP before = session.getACP(session.getRootDocument().getRef());
        ACP root = session.getACP(session.getRootDocument().getRef());
        ACL local = root.getOrCreateACL(ACL.LOCAL_ACL);
        local.add(new ACE("alice", SecurityConstants.ADD_CHILDREN, true));
        session.setACP(session.getRootDocument().getRef(), root, true);
        commit(session);
        try {
            CoreSession alice = Fixtures.as(session, "alice");
            assertEquals("administrators-only", refused(() -> alice.createDocument(
                    alice.createDocumentModel("/", "my-desk", Physical.DESK_TYPE))));
            assertEquals("desk-exists", refused(() -> session.createDocument(
                    session.createDocumentModel("/", "second-desk", Physical.DESK_TYPE))));
            assertEquals("not-at-root", refused(() -> session.createDocument(
                    session.createDocumentModel(Fixtures.RECORDS, "desk", Physical.DESK_TYPE))));
        } finally {
            session.setACP(session.getRootDocument().getRef(), before, true);
            commit(session);
        }
    }

    @Test
    public void aDeskMovedOrInTheTrashTakesNoRequest() {
        DocumentModel folder = session.createDocument(session.createDocumentModel("/", "elsewhere", "Folder"));
        session.move(desk.getRef(), folder.getRef(), null);
        commit(session);
        DocumentModel request = Fixtures.as(session, CLERK).createDocumentModel("/elsewhere/custody", "move",
                Physical.REQUEST_TYPE);
        request.setPropertyValue(Physical.REQUEST_ACTION, Physical.MOVE);
        request.setPropertyValue(Physical.REQUEST_ITEM, box.getId());
        request.setPropertyValue(Physical.REQUEST_LOCATION, b1.getId());
        request.setPropertyValue(Physical.REQUEST_REASON, "Through a moved desk");
        assertEquals("desk-misplaced", refused(() -> Fixtures.as(session, CLERK).createDocument(request)));
    }
}
