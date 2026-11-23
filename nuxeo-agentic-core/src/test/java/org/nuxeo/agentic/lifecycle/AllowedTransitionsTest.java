package org.nuxeo.agentic.lifecycle;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.nuxeo.ecm.core.api.security.SecurityConstants.READ_LIFE_CYCLE;
import static org.nuxeo.ecm.core.api.security.SecurityConstants.WRITE_LIFE_CYCLE;
import static org.nuxeo.ecm.core.api.security.SecurityConstants.WRITE_PROPERTIES;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * Which transitions {@link AllowedTransitions} lists, held to what the server would do with each:
 * offer none the server refuses, and hide none it accepts.
 */
class AllowedTransitionsTest {

    private static List<AllowedTransition> listed(FakeRepository repository) {
        return AllowedTransitions.of(repository.session(), repository.document(), repository::lifeCycleOfType);
    }

    private static List<String> names(FakeRepository repository) {
        return listed(repository).stream().map(AllowedTransition::name).toList();
    }

    @Test
    void listsWhatTheLifecycleAllowsFromTheCurrentStateWithWhereEachLeads() {
        FakeRepository repository = new FakeRepository().grantEverythingNeeded();

        assertEquals(List.of(new AllowedTransition("approve", "approved"), new AllowedTransition("deny", "denied")),
                listed(repository));

        repository.state = "approved";
        assertEquals(List.of(new AllowedTransition("reopen", "submitted")), listed(repository));
    }

    @Test
    void listsNothingFromAStateWithNoWayOut() {
        FakeRepository repository = new FakeRepository().grantEverythingNeeded();
        repository.state = "paid";

        assertEquals(List.of(), listed(repository));
    }

    @Test
    void listsNothingWithoutWriteLifeCycle() {
        FakeRepository repository = new FakeRepository().grant(READ_LIFE_CYCLE, WRITE_PROPERTIES);

        assertEquals(List.of(), listed(repository));
        assertFalse(repository.followTransition("approve"), "the server refuses it too");
    }

    /**
     * {@code getAllowedStateTransitions} throws without {@code ReadLifeCycle}, and an enricher that
     * throws loses its whole field; asking first keeps the answer an empty list.
     */
    @Test
    void listsNothingWithoutReadLifeCycleAndDoesNotAskForTheTransitions() {
        FakeRepository repository = new FakeRepository().grant(WRITE_LIFE_CYCLE, WRITE_PROPERTIES);

        assertEquals(List.of(), listed(repository));
    }

    /**
     * Following a transition checks a checked-in live document out first, and {@code checkOut}
     * needs {@code WriteProperties}: a user who may change the lifecycle but not the properties is
     * refused on such a document.
     */
    @Test
    void aCheckedInLiveDocumentAlsoNeedsWriteProperties() {
        FakeRepository repository = new FakeRepository().grant(READ_LIFE_CYCLE, WRITE_LIFE_CYCLE);
        repository.checkedOut = false;

        assertEquals(List.of(), listed(repository));
        assertFalse(repository.followTransition("approve"));

        repository.grant(WRITE_PROPERTIES);
        assertEquals(List.of("approve", "deny"), names(repository));
        assertTrue(repository.followTransition("approve"));
    }

    @Test
    void aCheckedOutDocumentAVersionAndAProxyDoNotNeedWriteProperties() {
        FakeRepository live = new FakeRepository().grant(READ_LIFE_CYCLE, WRITE_LIFE_CYCLE);
        assertEquals(List.of("approve", "deny"), names(live));
        assertFalse(live.permissionsAsked.contains(WRITE_PROPERTIES));

        FakeRepository version = new FakeRepository().grant(READ_LIFE_CYCLE, WRITE_LIFE_CYCLE);
        version.version = true;
        version.checkedOut = false;
        assertEquals(List.of("approve", "deny"), names(version));

        FakeRepository proxy = new FakeRepository().grant(READ_LIFE_CYCLE, WRITE_LIFE_CYCLE);
        proxy.proxy = true;
        proxy.checkedOut = false;
        assertEquals(List.of("approve", "deny"), names(proxy));
    }

    /**
     * {@code checkPermission} lets an administrator through before it asks the security policies,
     * which deny {@code WriteLifeCycle} on a document someone else has locked; {@code hasPermission}
     * asks them. Asking only {@code hasPermission} would hide from an administrator transitions the
     * server would follow for them.
     */
    @Test
    void anAdministratorIsOfferedWhatTheServerLetsThemDoEvenWhenThePoliciesSayNo() {
        FakeRepository repository = new FakeRepository();
        repository.administrator = true;
        repository.checkedOut = false;

        assertEquals(List.of("approve", "deny"), names(repository));
        assertTrue(repository.followTransition("approve"));
        assertEquals(List.of(), repository.permissionsAsked);
    }

    @Test
    void aDocumentTheSessionCannotFindHasNoTransitions() {
        FakeRepository repository = new FakeRepository().grantEverythingNeeded();
        repository.exists = false;

        assertEquals(List.of(), listed(repository));
    }

    /** A document model with no reference, such as an empty one for a creation form. */
    @Test
    void aDocumentWithNoReferenceHasNoTransitions() {
        FakeRepository repository = new FakeRepository().grantEverythingNeeded();
        repository.saved = false;

        assertEquals(List.of(), listed(repository));
        assertEquals(List.of(), repository.permissionsAsked);
    }

    /**
     * A state that lists a transition the policy never declares: the service looks its destination
     * up with no null check and fails, so it is not offered.
     */
    @Test
    void aTransitionThePolicyDoesNotDeclareIsNotListed() {
        FakeRepository repository = new FakeRepository().grantEverythingNeeded();
        repository.state = "review";

        assertEquals(List.of(new AllowedTransition("approve", "approved")), listed(repository));
        assertFalse(repository.followTransition("escalate"), "the server fails on it");
    }

    @Test
    void aTransitionWhosePolicyNamesNoDestinationIsNotListed() {
        FakeRepository repository = new FakeRepository().grantEverythingNeeded();
        repository.transitions.put("deny", "");

        assertEquals(List.of("approve"), names(repository));
    }

    /** The service finds a document's lifecycle by its type; with none it refuses every transition. */
    @Test
    void aDocumentWhoseTypeHasNoLifecycleHasNoTransitions() {
        FakeRepository repository = new FakeRepository().grantEverythingNeeded();
        repository.policy = null;

        assertEquals(List.of(), listed(repository));
        assertFalse(repository.followTransition("approve"));
    }

    /** The lifecycle is the one the service applies to the document's type. */
    @Test
    void theLifecycleIsLookedUpByTheDocumentsType() {
        FakeRepository repository = new FakeRepository().grantEverythingNeeded();
        List<String> asked = new ArrayList<>();

        AllowedTransitions.of(repository.session(), repository.document(), type -> {
            asked.add(type);
            return repository.lifeCycleOfType(type);
        });

        assertEquals(List.of("Claim"), asked);
    }

    @Test
    void repeatedAndBlankNamesAreListedOnce() {
        FakeRepository repository = new FakeRepository().grantEverythingNeeded();
        List<String> fromSubmitted = new ArrayList<>(List.of("approve", "", "deny", "approve"));
        fromSubmitted.add(null);
        repository.allowedFrom.put("submitted", fromSubmitted);

        assertEquals(List.of("approve", "deny"), names(repository));
    }

    /**
     * The claim the enricher makes, checked for every combination the server's decision depends
     * on: a transition is listed exactly when the server would follow it.
     */
    @Test
    void listsExactlyTheTransitionsTheServerWouldFollow() {
        List<String> permissions = List.of(READ_LIFE_CYCLE, WRITE_LIFE_CYCLE, WRITE_PROPERTIES);
        int combinations = 0;
        for (int mask = 0; mask < 1 << permissions.size(); mask++) {
            for (boolean administrator : new boolean[] { false, true }) {
                for (String kind : List.of("checked-out", "checked-in", "version", "proxy")) {
                    for (String state : List.of("submitted", "approved", "review", "paid")) {
                        FakeRepository repository = new FakeRepository();
                        for (int bit = 0; bit < permissions.size(); bit++) {
                            if ((mask & 1 << bit) != 0) {
                                repository.grant(permissions.get(bit));
                            }
                        }
                        repository.administrator = administrator;
                        repository.checkedOut = kind.equals("checked-out");
                        repository.version = kind.equals("version");
                        repository.proxy = kind.equals("proxy");
                        repository.state = state;

                        List<String> listed = names(repository);
                        List<String> every = new ArrayList<>(repository.transitions.keySet());
                        every.add("escalate");
                        for (String transition : every) {
                            String where = repository.granted + (administrator ? " as administrator" : "") + ", "
                                    + kind + ", in " + state + ": " + transition;
                            boolean readable = administrator || repository.granted.contains(READ_LIFE_CYCLE);
                            boolean followed = repository.followTransition(transition);
                            // ReadLifeCycle is the one permission the operation does not ask for:
                            // without it the transitions cannot be listed at all, so a user holding
                            // WriteLifeCycle alone is offered nothing rather than offered wrongly.
                            assertEquals(followed && readable, listed.contains(transition), where);
                            if (listed.contains(transition)) {
                                assertTrue(followed, "offered, and refused by the server: " + where);
                            }
                        }
                        combinations++;
                    }
                }
            }
        }
        assertEquals(8 * 2 * 4 * 4, combinations);
    }
}
