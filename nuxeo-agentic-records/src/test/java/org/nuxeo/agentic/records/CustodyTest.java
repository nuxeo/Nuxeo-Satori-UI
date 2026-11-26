package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.records.Fixtures.commit;
import static org.nuxeo.agentic.records.Fixtures.refused;
import static org.nuxeo.agentic.records.Physicals.CLERK;
import static org.nuxeo.agentic.records.Physicals.OTHER_CLERK;

import java.io.Serializable;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.Before;
import org.junit.Test;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * A physical record's chain of custody, recorded on the server: every move, check-out and return,
 * with who, from where to where, when and why; and a record checked out is not checked out again,
 * nor moved, until it is returned, two check-outs at once included.
 */
public class CustodyTest extends PhysicalTestCase {

    private DocumentModel box;

    private String barcode;

    @Before
    public void setUpBox() {
        box = Physicals.item(session, "Box 1", a1);
        commit(session);
        barcode = (String) Physicals.value(session, box, Physical.BARCODE);
    }

    @Test
    public void aMoveIsRecordedWithWhoFromWhereToWhereWhenAndWhy() {
        Instant before = Instant.now();
        DocumentModel request = Physicals.move(session, CLERK, box, b1, "Shelf A is full");
        DocumentModel stored = session.getDocument(box.getRef());
        assertEquals(b1.getId(), stored.getPropertyValue(Physical.LOCATION));
        assertEquals(B1_PATH, stored.getPropertyValue(Physical.LOCATION_PATH));
        assertEquals(Physical.IN, stored.getPropertyValue(Physical.STATE));

        List<Map<String, Serializable>> custody = Physicals.custody(session, box);
        assertEquals(2, custody.size());
        Map<String, Serializable> moved = custody.get(1);
        assertEquals(Physical.MOVED, moved.get("event"));
        assertEquals(CLERK, moved.get("by"));
        assertEquals(a1.getId(), moved.get("fromLocation"));
        assertEquals(A1_PATH, moved.get("fromPath"));
        assertEquals(b1.getId(), moved.get("toLocation"));
        assertEquals(B1_PATH, moved.get("toPath"));
        assertEquals("Shelf A is full", moved.get("reason"));
        assertTrue(!((Calendar) moved.get("at")).toInstant().isBefore(before.minusSeconds(1)));

        // The request says what came of it, in the server's words.
        assertEquals(Physical.MOVED, request.getPropertyValue(Physical.REQUEST_OUTCOME));
        assertEquals(CLERK, request.getPropertyValue(Physical.REQUEST_BY));
        assertEquals(box.getId(), request.getPropertyValue(Physical.REQUEST_ITEM));
        assertEquals(barcode, request.getPropertyValue(Physical.REQUEST_BARCODE));
        assertEquals(A1_PATH, request.getPropertyValue(Physical.REQUEST_FROM_PATH));
        assertEquals(B1_PATH, request.getPropertyValue(Physical.REQUEST_TO_PATH));
        assertEquals("Move of " + barcode + " by " + CLERK, request.getTitle());
    }

    @Test
    public void aRecordIsNamedByItsBarcodeAsScannedOrTypedOrByItsId() {
        String typed = barcode.toLowerCase().substring(0, 4) + " " + barcode.substring(4, 8) + "-" + barcode.substring(8);
        Physicals.file(session, CLERK, Physical.MOVE, typed, b1.getId(), null, null, "Scanned at the desk");
        assertEquals(b1.getId(), Physicals.value(session, box, Physical.LOCATION));
        Physicals.file(session, CLERK, Physical.MOVE, box.getId(), a1.getId(), null, null, "Back by its id");
        assertEquals(a1.getId(), Physicals.value(session, box, Physical.LOCATION));
    }

    @Test
    public void aBarcodeMistypedIsRefused() {
        int check = barcode.charAt(barcode.length() - 1) - '0';
        String typo = barcode.substring(0, barcode.length() - 1) + (char) ('0' + (check + 1) % 10);
        assertEquals("bad-barcode", refused(() -> Physicals.file(session, CLERK, Physical.MOVE, typo, b1.getId(), null,
                null, "A typo")));
        assertEquals(1, Physicals.custody(session, box).size());
    }

    @Test
    public void aCheckOutThenAReturn() {
        DocumentModel out = Physicals.checkOut(session, CLERK, box, "grace", Duration.ofDays(7), "For the audit");
        DocumentModel stored = session.getDocument(box.getRef());
        assertEquals(Physical.OUT, stored.getPropertyValue(Physical.STATE));
        assertEquals("grace", stored.getPropertyValue(Physical.BORROWER));
        assertEquals(CLERK, stored.getPropertyValue(Physical.CHECKED_OUT_BY));
        assertTrue(((Calendar) stored.getPropertyValue(Physical.DUE_BACK)).toInstant()
                                                                         .isAfter(Instant.now().plus(Duration.ofDays(6))));
        // Where it is kept stays, as where it goes back to.
        assertEquals(a1.getId(), stored.getPropertyValue(Physical.LOCATION));
        assertEquals(Physical.CHECKED_OUT, out.getPropertyValue(Physical.REQUEST_OUTCOME));
        assertEquals("grace", out.getPropertyValue(Physical.REQUEST_BORROWER));

        Map<String, Serializable> lent = Physicals.custody(session, box).get(1);
        assertEquals(Physical.CHECKED_OUT, lent.get("event"));
        assertEquals(A1_PATH, lent.get("fromPath"));
        assertNull(lent.get("toLocation"));
        assertEquals("grace", lent.get("borrower"));
        assertEquals("For the audit", lent.get("reason"));
        assertTrue(lent.get("dueBack") instanceof Calendar);

        DocumentModel back = Physicals.giveBack(session, OTHER_CLERK, box, null, "The audit is done");
        stored = session.getDocument(box.getRef());
        assertEquals(Physical.IN, stored.getPropertyValue(Physical.STATE));
        assertEquals(a1.getId(), stored.getPropertyValue(Physical.LOCATION));
        assertNull(stored.getPropertyValue(Physical.BORROWER));
        assertNull(stored.getPropertyValue(Physical.DUE_BACK));
        assertNull(stored.getPropertyValue(Physical.CHECKED_OUT_BY));
        assertEquals(Physical.RETURNED, back.getPropertyValue(Physical.REQUEST_OUTCOME));
        assertEquals(a1.getId(), back.getPropertyValue(Physical.REQUEST_LOCATION));

        Map<String, Serializable> returned = Physicals.custody(session, box).get(2);
        assertEquals(Physical.RETURNED, returned.get("event"));
        assertEquals(OTHER_CLERK, returned.get("by"));
        assertNull(returned.get("fromLocation"));
        assertEquals("grace", returned.get("borrower"));
        assertEquals(A1_PATH, returned.get("toPath"));
        assertEquals("The audit is done", returned.get("reason"));
    }

    @Test
    public void aCheckOutIsToTheFilerWhenItNamesNoBorrower() {
        Physicals.checkOut(session, CLERK, box, null, Duration.ofDays(1), "For my own review");
        assertEquals(CLERK, Physicals.value(session, box, Physical.BORROWER));
    }

    @Test
    public void aReturnMayPutItElsewhere() {
        Physicals.checkOut(session, CLERK, box, "grace", Duration.ofDays(7), "For the audit");
        Physicals.giveBack(session, CLERK, box, b1, "Shelf A is full now");
        assertEquals(b1.getId(), Physicals.value(session, box, Physical.LOCATION));
        assertEquals(B1_PATH, Physicals.custody(session, box).get(2).get("toPath"));
    }

    @Test
    public void aRecordCheckedOutIsNotCheckedOutAgainUntilItIsReturned() {
        Physicals.checkOut(session, CLERK, box, "grace", Duration.ofDays(7), "For the audit");
        assertEquals("checked-out",
                refused(() -> Physicals.checkOut(session, OTHER_CLERK, box, "erin", Duration.ofDays(7), "Mine now")));
        assertEquals("checked-out", refused(() -> Physicals.checkOut(session, CLERK, box, "grace", Duration.ofDays(9),
                "The same borrower")));
        // Nor moved: it is not on its shelf.
        assertEquals("checked-out", refused(() -> Physicals.move(session, CLERK, box, b1, "Tidying")));
        assertEquals(2, Physicals.custody(session, box).size());
        assertEquals("grace", Physicals.value(session, box, Physical.BORROWER));
        // A refused request leaves no request behind.
        assertEquals(1, session.query("SELECT * FROM " + Physical.REQUEST_TYPE).size());

        Physicals.giveBack(session, CLERK, box, null, "Back");
        Physicals.checkOut(session, OTHER_CLERK, box, "erin", Duration.ofDays(7), "Now it is erin's turn");
        assertEquals("erin", Physicals.value(session, box, Physical.BORROWER));
        assertEquals(4, Physicals.custody(session, box).size());
    }

    @Test
    public void aRecordNotCheckedOutIsNotReturned() {
        assertEquals("not-checked-out", refused(() -> Physicals.giveBack(session, CLERK, box, null, "Back?")));
    }

    @Test
    public void twoCheckOutsAtOnceOneIsTakenAndTheOtherRefused() throws Exception {
        // Each request held as it is filed, before the add-on sees it, until the other is filed too.
        TestHooks.filing = new CyclicBarrier(2);
        List<String> outcomes = Collections.synchronizedList(new ArrayList<>());
        Calendar due = Fixtures.calendar(Instant.now().plus(Duration.ofDays(3)));
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<?>> both = new ArrayList<>();
            for (String clerk : List.of(CLERK, OTHER_CLERK)) {
                both.add(pool.submit(() -> {
                    try {
                        TransactionHelper.runInTransaction(() -> {
                            CoreSession person = Fixtures.as(session, clerk);
                            DocumentModel request = person.createDocumentModel(Physicals.DESK, "out", Physical.REQUEST_TYPE);
                            request.setPropertyValue(Physical.REQUEST_ACTION, Physical.CHECK_OUT);
                            request.setPropertyValue(Physical.REQUEST_ITEM, box.getId());
                            request.setPropertyValue(Physical.REQUEST_DUE_BACK, due);
                            request.setPropertyValue(Physical.REQUEST_REASON, "Both at once");
                            person.createDocument(request);
                            person.save();
                        });
                        outcomes.add("taken");
                    } catch (DispositionRefusal refusal) {
                        outcomes.add(refusal.getCode());
                    }
                    return null;
                }));
            }
            for (Future<?> each : both) {
                each.get(60, TimeUnit.SECONDS);
            }
        } finally {
            TestHooks.reset();
            pool.shutdownNow();
        }
        commit(session);
        Collections.sort(outcomes);
        assertEquals(List.of("checked-out", "taken"), outcomes);
        List<Map<String, Serializable>> custody = Physicals.custody(session, box);
        assertEquals("one check-out recorded: " + custody, 2, custody.size());
        assertEquals(Physical.CHECKED_OUT, custody.get(1).get("event"));
        assertEquals(custody.get(1).get("borrower"), Physicals.value(session, box, Physical.BORROWER));
    }

    // --- What a request must say ----------------------------------------------------------------------

    @Test
    public void aRequestSaysWhatWhichWhereAndWhy() {
        assertEquals("bad-request", refused(() -> Physicals.file(session, CLERK, "lend", box.getId(), null, null, null, "Why")));
        assertEquals("bad-request", refused(() -> Physicals.file(session, CLERK, Physical.MOVE, box.getId(), b1.getId(), null,
                null, " ")));
        assertEquals("bad-request", refused(() -> Physicals.file(session, CLERK, Physical.MOVE, box.getId(), b1.getId(), null,
                null, "x".repeat(Physical.MAX_REASON + 1))));
        assertEquals("bad-request", refused(() -> Physicals.file(session, CLERK, Physical.MOVE, box.getId(), null, null, null,
                "Where to?")));
        assertEquals("bad-request", refused(() -> Physicals.file(session, CLERK, Physical.MOVE, "Box 1", b1.getId(), null,
                null, "By its title")));
        assertEquals("bad-request", refused(() -> Physicals.file(session, CLERK, Physical.MOVE, box.getId(), b1.getId(),
                "grace", null, "A move names no borrower")));
        assertEquals("already-there", refused(() -> Physicals.move(session, CLERK, box, a1, "Where it is")));
        assertEquals("no-location", refused(() -> Physicals.file(session, CLERK, Physical.MOVE, box.getId(), rule.getId(),
                null, null, "Not a location")));
        assertEquals(0, session.query("SELECT * FROM " + Physical.REQUEST_TYPE).size());
        assertEquals(1, Physicals.custody(session, box).size());
    }

    @Test
    public void aCheckOutSaysWhenItIsDueBackWithinAYear() {
        assertEquals("bad-request", refused(() -> Physicals.file(session, CLERK, Physical.CHECK_OUT, box.getId(), null, null,
                null, "No due date")));
        assertEquals("bad-request", refused(() -> Physicals.checkOut(session, CLERK, box, null, Duration.ofDays(-1),
                "Due yesterday")));
        assertEquals("bad-request", refused(() -> Physicals.checkOut(session, CLERK, box, null,
                Duration.ofDays(Physical.MAX_LOAN_DAYS + 1), "Due in more than a year")));
        assertEquals("bad-request", refused(() -> Physicals.file(session, CLERK, Physical.CHECK_OUT, box.getId(), b1.getId(),
                null, Fixtures.calendar(Instant.now().plus(Duration.ofDays(2))), "A check-out names no location")));
        assertEquals("bad-request", refused(() -> Physicals.checkOut(session, CLERK, box, "two\nlines", Duration.ofDays(2),
                "A name on one line")));
        assertEquals(Physical.IN, Physicals.value(session, box, Physical.STATE));
    }
}
