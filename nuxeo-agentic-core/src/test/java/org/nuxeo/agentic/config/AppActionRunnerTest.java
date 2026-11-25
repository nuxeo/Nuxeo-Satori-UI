package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.nuxeo.agentic.config.ActionFixtures.ACTIONS;
import static org.nuxeo.agentic.config.ActionFixtures.APP;
import static org.nuxeo.agentic.config.ActionFixtures.REF;
import static org.nuxeo.agentic.config.ActionFixtures.REQUEST_RECORDS;
import static org.nuxeo.agentic.config.ActionFixtures.allowList;
import static org.nuxeo.agentic.config.ActionFixtures.principal;
import static org.nuxeo.agentic.config.ActionFixtures.record;
import static org.nuxeo.agentic.config.ActionFixtures.registry;
import static org.nuxeo.agentic.config.ActionFixtures.requestRecords;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.config.AppActionException.Kind;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.NuxeoException;

/**
 * {@code AgenticUi.RunAction}: what it runs, with what, and everything it refuses first. A refusal
 * runs nothing, which each test checks, so that a check moved after the run would fail here.
 */
class AppActionRunnerTest {

    private static final String REQUEST = "payers.claim.requestRecords";

    private final ActionFixtures.Session reader = new ActionFixtures.Session(
            principal("dana.lee", "members", "claims-adjusters"), "Read", "Write");

    private final ActionFixtures.Automation automation = new ActionFixtures.Automation();

    /** The record as the request gave it: Automation applies a JSON entity's properties to it in memory. */
    private final DocumentModel asRequested = record(REF, Map.of("claim:provider", "someone-else"));

    private AllowList allowed = allowList(requestRecords());

    private AppActionRunner runner() {
        return new AppActionRunner(registry(ACTIONS, allowList(requestRecords())), () -> allowed, automation);
    }

    private AppActionRunner.Result run(String action, String values) {
        return runner().run(reader.session(), asRequested, APP, action, values);
    }

    private Kind refusal(String action, String values) {
        Kind kind = assertThrows(AppActionException.class, () -> run(action, values)).getKind();
        assertEquals(List.of(), automation.runs, "a refusal runs nothing");
        return kind;
    }

    @Test
    void runsTheOperationOnTheStoredRecordWithTheAppsParametersThenRecordsIt() {
        AppActionRunner.Result result = run(REQUEST, "{\"urgent\":true,\"note\":\"Before Friday\"}");

        assertEquals("{\"app\":\"payers-claims\",\"action\":\"payers.claim.requestRecords\",\"status\":\"done\"}",
                result.toJson());
        assertEquals(2, automation.runs.size());
        ActionFixtures.Automation.Run ran = automation.runs.get(0);
        assertEquals(REQUEST_RECORDS, ran.operation());
        // The stored record, never the one the request gave, nor its in-memory properties.
        assertSame(reader.storedRecord, ran.input());
        assertEquals(Map.of("provider", "provider-0042", "urgent", true, "note", "Before Friday", "channel",
                "portal"), ran.parameters());
        assertEquals(List.of("Read", "Write", "getDocument"), reader.asked);

        ActionFixtures.Automation.Run audit = automation.runs.get(1);
        assertEquals("Audit.LogEvent", audit.operation());
        assertSame(reader.storedRecord, audit.input());
        assertEquals("App action run", audit.parameters().get("event"));
        assertEquals("Agentic UI", audit.parameters().get("category"));
        assertEquals("dana.lee ran the action payers.claim.requestRecords of the app payers-claims, which runs "
                + "Payers.RequestMedicalRecords.", audit.parameters().get("comment"));
        assertFalse(audit.parameters().toString().contains("Before Friday"), "no value is in the history");
    }

    @Test
    void aFormFieldLeftEmptyGivesTheOperationNothing() {
        run(REQUEST, "{\"urgent\":null}");
        assertEquals(Map.of("provider", "provider-0042", "channel", "portal"), automation.runs.get(0).parameters());
        automation.runs.clear();
        run(REQUEST, null);
        assertEquals(Map.of("provider", "provider-0042", "channel", "portal"), automation.runs.get(0).parameters());
    }

    @Test
    void readIsCheckedFirstSoNothingAboutAppsLeaks() {
        ActionFixtures.Session stranger = new ActionFixtures.Session(principal("eve", "claims-adjusters"));
        assertThrows(DocumentSecurityException.class,
                () -> runner().run(stranger.session(), asRequested, APP, "no.such.action", null));
        assertEquals(List.of("Read"), stranger.asked);
        assertEquals(List.of(), automation.runs);
    }

    @Test
    void anActionNoAppOfTheReadersServesIsUnknown() {
        assertEquals(Kind.UNKNOWN_ACTION, refusal("payers.claim.referToInvestigations", null));
        assertEquals(Kind.UNKNOWN_ACTION, refusal("payers.claim.pay", null));
        assertEquals(Kind.UNKNOWN_ACTION, refusal("Payers.RequestMedicalRecords", null));
        ActionFixtures.Session clerk = new ActionFixtures.Session(principal("sam", "members"), "Read", "Write");
        assertEquals(Kind.UNKNOWN_ACTION, assertThrows(AppActionException.class,
                () -> runner().run(clerk.session(), asRequested, APP, REQUEST, null)).getKind());
    }

    @Test
    void theAllowListIsCheckedAgainAsItStandsNow() {
        // The registry was built with the operation allowed; it has since been removed.
        allowed = AllowList.EMPTY;
        assertEquals(Kind.NOT_ALLOWED, refusal(REQUEST, null));

        // Or narrowed, so that a parameter the app gives is no longer one it allows.
        AllowedOperationDescriptor narrower = requestRecords();
        narrower.parameters.removeIf(parameter -> parameter.name.equals("channel"));
        allowed = allowList(narrower);
        assertEquals(Kind.NOT_ALLOWED, refusal(REQUEST, null));
    }

    @Test
    void theAllowListsGroupsAndPermissionAreTheReadersToHold() {
        AllowedOperationDescriptor supervisors = requestRecords();
        supervisors.groups = new ArrayList<>(List.of("claims-supervisors"));
        allowed = allowList(supervisors);
        assertEquals(Kind.NOT_IN_GROUP, refusal(REQUEST, null));

        AllowedOperationDescriptor everything = requestRecords();
        everything.permission = "Everything";
        allowed = allowList(everything);
        assertThrows(DocumentSecurityException.class, () -> run(REQUEST, null));
        assertEquals(List.of(), automation.runs);
        assertTrue(reader.asked.contains("Everything"));
    }

    @Test
    void aValueForAFieldTheActionDoesNotSendIsRefused() {
        // "channel" is a literal of the app's: a request cannot replace it, nor give "provider".
        assertEquals(Kind.UNKNOWN_VALUE, refusal(REQUEST, "{\"channel\":\"fax\"}"));
        assertEquals(Kind.UNKNOWN_VALUE, refusal(REQUEST, "{\"provider\":\"provider-9999\"}"));
        assertEquals(Kind.UNKNOWN_VALUE, refusal(REQUEST, "{\"operation\":\"Document.Delete\"}"));
    }

    @Test
    void valuesThatAreNotAnObjectOfScalarsOrAreTooLargeAreRefused() {
        assertEquals(Kind.UNREADABLE_VALUES, refusal(REQUEST, "[true]"));
        assertEquals(Kind.UNREADABLE_VALUES, refusal(REQUEST, "{\"note\":"));
        assertEquals(Kind.UNREADABLE_VALUES, refusal(REQUEST, "{\"note\":\"a\",\"note\":\"b\"}"));
        assertEquals(Kind.UNREADABLE_VALUES, refusal(REQUEST, "{\"note\":{\"$ne\":null}}"));
        assertEquals(Kind.UNREADABLE_VALUES,
                refusal(REQUEST, "{\"note\":\"" + "x".repeat(AppActionRunner.MAX_VALUES_BYTES) + "\"}"));
    }

    @Test
    void aValueOfTheWrongTypeIsRefused() {
        assertEquals(Kind.INVALID_VALUE, refusal(REQUEST, "{\"urgent\":\"yes\"}"));
        assertEquals(Kind.INVALID_VALUE, refusal(REQUEST, "{\"note\":\"" + "n".repeat(21) + "\"}"));
        assertEquals(Kind.INVALID_VALUE, refusal(REQUEST, "{\"note\":\"expr:Document.delete()\\u0007\"}"));
    }

    @Test
    void aFieldTheStoredRecordHoldsOfAnotherTypeOrNotAtAllIsRefused() {
        reader.stored.put("claim:provider", (Serializable) 42L);
        assertEquals(Kind.INVALID_VALUE, refusal(REQUEST, null));
        reader.stored.remove("claim:provider");
        assertEquals(Kind.INVALID_VALUE, refusal(REQUEST, null));
    }

    @Test
    void anExpressionIsPassedAsTextNeverEvaluated() {
        run(REQUEST, "{\"note\":\"expr:Document\"}");
        assertEquals("expr:Document", automation.runs.get(0).parameters().get("note"));
    }

    @Test
    void aRequestWithNoRecordIsRefused() {
        assertEquals(Kind.NO_RECORD,
                assertThrows(AppActionException.class,
                        () -> runner().run(reader.session(), null, APP, REQUEST, null)).getKind());
    }

    @Test
    void aBulkOnlyActionDoesNotRunOnOneRecord() {
        String bulk = ACTIONS.replace("\"on\": [\"record\", \"row\"]", "\"on\": [\"bulk\"]")
                             .replace("\"provider\": { \"field\": \"claim:provider\" },", "")
                             .replace("\"urgent\": { \"field\": \"var:urgent\" },", "")
                             .replace("\"note\": { \"field\": \"var:note\" },", "");
        AppActionRunner bulkRunner = new AppActionRunner(registry(bulk, allowed), () -> allowed, automation);
        assertEquals(Kind.NOT_ON_A_RECORD, assertThrows(AppActionException.class,
                () -> bulkRunner.run(reader.session(), asRequested, APP, REQUEST, null)).getKind());
        assertEquals(List.of(), automation.runs);
    }

    @Test
    void anOperationThatFailsLeavesNoHistoryAndFailsTheRun() {
        automation.failing = REQUEST_RECORDS;
        assertThrows(NuxeoException.class, () -> run(REQUEST, null));
        assertEquals(List.of(), automation.runs);
    }

    @Test
    void aHistoryThatCannotBeWrittenFailsTheRunForTheTransactionToUndo() {
        automation.failing = AppActionRunner.AUDIT_OPERATION;
        assertThrows(NuxeoException.class, () -> run(REQUEST, null));
        // The operation ran; the exception rolls the request's transaction back.
        assertEquals(1, automation.runs.size());
    }

    @Test
    void aNameTheLogCannotHoldIsNotWrittenToIt() {
        assertEquals("payers.claim.requestRecords", AppActionRunner.loggable("payers.claim.requestRecords"));
        assertEquals("(not a name)", AppActionRunner.loggable("x\nAgentic UI action run: admin"));
        assertEquals("(none)", AppActionRunner.loggable(null));
    }
}
