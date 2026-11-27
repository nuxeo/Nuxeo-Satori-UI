package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.nuxeo.agentic.config.ActionFixtures.ACTIONS;
import static org.nuxeo.agentic.config.ActionFixtures.APP;
import static org.nuxeo.agentic.config.ActionFixtures.REFER;
import static org.nuxeo.agentic.config.ActionFixtures.REQUEST_RECORDS;
import static org.nuxeo.agentic.config.ActionFixtures.allowList;
import static org.nuxeo.agentic.config.ActionFixtures.parameter;
import static org.nuxeo.agentic.config.ActionFixtures.registry;
import static org.nuxeo.agentic.config.ActionFixtures.requestRecords;
import static org.nuxeo.agentic.config.ActionFixtures.snapshot;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * The app registry serves an app's {@code actions.json} with only the actions this server's
 * allow-list lets run, says what it left out, and is the only source of what the run endpoint runs.
 */
class AppActionsTest {

    private static final AppRegistryEndpoint.Viewer ADJUSTER = new AppRegistryEndpoint.Viewer("dana",
            Set.of("members", "claims-adjusters"), false);

    private static final AppRegistryEndpoint.Viewer CLERK = new AppRegistryEndpoint.Viewer("sam", Set.of("members"),
            false);

    private static final String FILE = "/apps/" + APP + "/actions.json";

    private static JsonNode served(AppRegistryEndpoint registry) throws Exception {
        AppRegistryEndpoint.Response response = registry.respond(FILE, ADJUSTER, null);
        assertEquals(200, response.status());
        return ConfigSnapshot.JSON.readTree(response.body());
    }

    private static List<String> ids(JsonNode file) {
        List<String> ids = new ArrayList<>();
        file.get("actions").forEach(action -> ids.add(action.get("id").asText()));
        return ids;
    }

    private static List<String> diagnostics(AppRegistryEndpoint registry, AppRegistryEndpoint.Viewer viewer)
            throws Exception {
        JsonNode listing = ConfigSnapshot.JSON.readTree(registry.respond("/apps.json", viewer, null).body());
        List<String> messages = new ArrayList<>();
        listing.get("diagnostics").forEach(d -> {
            if ("action-refused".equals(d.get("code").asText())) {
                messages.add(d.get("message").asText());
            }
        });
        return messages;
    }

    @Test
    void servesOnlyTheActionsWhoseOperationTheAllowListHolds() throws Exception {
        AppRegistryEndpoint registry = registry(ACTIONS, allowList(requestRecords()));

        JsonNode file = served(registry);
        // The lifecycle button is served as it is: the lifecycle gates it, as for any request.
        assertEquals(List.of("payers.claim.pay", "payers.claim.requestRecords"), ids(file));
        assertEquals(2, file.get("version").asInt());
        assertEquals("../actions.schema.json", file.get("$schema").asText());

        List<String> said = diagnostics(registry, ADJUSTER);
        assertEquals(1, said.size(), said.toString());
        assertTrue(said.get(0).contains("\"payers.claim.referToInvestigations\" runs \"" + REFER
                + "\", which this server's allow-list does not hold"), said.get(0));

        assertNotNull(registry.action(APP, "payers.claim.requestRecords", ADJUSTER));
        assertNull(registry.action(APP, "payers.claim.referToInvestigations", ADJUSTER));
        // A lifecycle button runs no operation, so it is not one the endpoint runs.
        assertNull(registry.action(APP, "payers.claim.pay", ADJUSTER));
    }

    @Test
    void withNoAllowListEveryOperationIsLeftOut() throws Exception {
        AppRegistryEndpoint registry = new AppRegistryEndpoint(snapshot(ACTIONS));
        assertEquals(List.of("payers.claim.pay"), ids(served(registry)));
        assertEquals(2, diagnostics(registry, ADJUSTER).size());
        assertNull(registry.action(APP, "payers.claim.requestRecords", ADJUSTER));
    }

    @Test
    void aFileWithNothingLeftOutIsServedByteForByte() throws Exception {
        AppRegistryEndpoint registry = registry(ACTIONS, allowList(requestRecords(), refer()));
        assertArrayEquals(ACTIONS.getBytes(StandardCharsets.UTF_8), registry.respond(FILE, ADJUSTER, null).body());
        assertEquals(List.of(), diagnostics(registry, ADJUSTER));
    }

    @Test
    void theRunnableActionKeepsWhereEachParameterComesFrom() {
        RunnableAction action = registry(ACTIONS, allowList(requestRecords())).action(APP,
                "payers.claim.requestRecords", ADJUSTER);
        assertEquals(REQUEST_RECORDS, action.operation());
        assertEquals(Set.of("record", "row"), action.placements());
        assertEquals(new RunnableAction.Field("claim:provider"), action.parameters().get("provider"));
        assertEquals(new RunnableAction.Input("urgent"), action.parameters().get("urgent"));
        assertEquals(new RunnableAction.Input("note"), action.parameters().get("note"));
        assertEquals("portal", ((RunnableAction.Literal) action.parameters().get("channel")).value().asText());
    }

    @Test
    void anActionGivingAParameterTheAllowListDoesNotIsLeftOut() throws Exception {
        AllowedOperationDescriptor narrower = requestRecords();
        narrower.parameters.removeIf(parameter -> parameter.name.equals("note"));
        AppRegistryEndpoint registry = registry(ACTIONS, allowList(narrower));
        assertEquals(List.of("payers.claim.pay"), ids(served(registry)));
        assertTrue(diagnostics(registry, ADJUSTER).get(0).contains("the parameter \"note\", which this server's"
                + " allow-list does not let it be given"));
    }

    @Test
    void aLiteralOfTheWrongTypeOrTooLongIsLeftOut() throws Exception {
        String tooLong = ACTIONS.replace("\"channel\": \"portal\"", "\"channel\": true");
        AppRegistryEndpoint registry = registry(tooLong, allowList(requestRecords()));
        assertEquals(List.of("payers.claim.pay"), ids(served(registry)));
        assertTrue(diagnostics(registry, ADJUSTER).get(0).contains("is not a text, and the allow-list makes it a string"));

        String twentyOne = ACTIONS.replace("\"note\": { \"field\": \"var:note\" }", "\"note\": \"" + "n".repeat(21)
                + "\"");
        registry = registry(twentyOne, allowList(requestRecords()));
        assertTrue(diagnostics(registry, ADJUSTER).get(0).contains("is longer than 20 characters"));
    }

    @Test
    void aComputedValueIsRefusedRatherThanTrusted() throws Exception {
        String computed = ACTIONS.replace("\"channel\": \"portal\"",
                "\"channel\": { \"computed\": { \"type\": \"core.template\", \"parameters\": [\"x\"] } }");
        AppRegistryEndpoint registry = registry(computed, allowList(requestRecords()));
        assertEquals(List.of("payers.claim.pay"), ids(served(registry)));
        assertTrue(diagnostics(registry, ADJUSTER).get(0).contains("a computation is not run on the server"));
    }

    /**
     * An action on {@code card} shows on a card of the record page that names it, as the holds card
     * names its place and release: one record, so its form's and the record's values are its own.
     */
    @Test
    void anActionOnACardIsServedWithItsFormAndRecordValues() throws Exception {
        String card = ACTIONS.replace("\"on\": [\"record\", \"row\"]", "\"on\": [\"card\"]");
        AppRegistryEndpoint registry = registry(card, allowList(requestRecords()));
        assertEquals(List.of("payers.claim.pay", "payers.claim.requestRecords"), ids(served(registry)));
        RunnableAction action = registry.action(APP, "payers.claim.requestRecords", ADJUSTER);
        assertEquals(Set.of("card"), action.placements());
        assertTrue(action.runsOnOneRecord());
        assertEquals(new RunnableAction.Input("note"), action.parameters().get("note"));
        assertEquals(new RunnableAction.Field("claim:provider"), action.parameters().get("provider"));
    }

    @Test
    void anActionOnAPlaceThatIsNoneIsLeftOut() throws Exception {
        String cards = ACTIONS.replace("\"on\": [\"record\", \"row\"]", "\"on\": [\"cards\"]");
        AppRegistryEndpoint registry = registry(cards, allowList(requestRecords()));
        assertEquals(List.of("payers.claim.pay"), ids(served(registry)));
        assertTrue(diagnostics(registry, ADJUSTER).get(0)
                .contains("has an \"on\" that is not a list of \"record\", \"row\", \"card\" and \"bulk\""));
    }

    @Test
    void aBulkActionGivesLiteralsOnly() throws Exception {
        String bulk = ACTIONS.replace("\"on\": [\"record\", \"row\"]", "\"on\": [\"row\", \"bulk\"]");
        AppRegistryEndpoint registry = registry(bulk, allowList(requestRecords()));
        assertEquals(List.of("payers.claim.pay"), ids(served(registry)));
        assertTrue(diagnostics(registry, ADJUSTER).get(0).contains("runs in bulk, on many records"));
    }

    @Test
    void anActionWithNoIdAPlatformIdOrARepeatedIdIsLeftOut() throws Exception {
        String repeated = ACTIONS.replace("\"payers.claim.referToInvestigations\"", "\"payers.claim.pay\"");
        AppRegistryEndpoint registry = registry(repeated, allowList(requestRecords(), refer()));
        assertEquals(List.of("payers.claim.pay", "payers.claim.requestRecords"), ids(served(registry)));
        assertTrue(diagnostics(registry, ADJUSTER).get(0).contains("has the id of an action before it"));

        String platform = ACTIONS.replace("\"payers.claim.referToInvestigations\"", "\"app.toolbar.delete\"");
        registry = registry(platform, allowList(requestRecords(), refer()));
        assertTrue(diagnostics(registry, ADJUSTER).get(0).contains("has no id an app's action may have"));
        assertNull(registry.action(APP, "app.toolbar.delete", ADJUSTER));
    }

    @Test
    void anOnThatIsNotAListOfPlacesIsLeftOut() throws Exception {
        String on = ACTIONS.replace("\"on\": [\"record\", \"row\"]", "\"on\": [\"record\", \"everywhere\"]");
        AppRegistryEndpoint registry = registry(on, allowList(requestRecords()));
        assertTrue(diagnostics(registry, ADJUSTER).get(0).contains("has an \"on\" that is not a list"));
    }

    @Test
    void anActionIsRunnableOnlyByThoseWhoMaySeeTheApp() throws Exception {
        AppRegistryEndpoint registry = registry(ACTIONS, allowList(requestRecords()));
        assertNull(registry.action(APP, "payers.claim.requestRecords", CLERK));
        assertNull(registry.action("staff-directory", "payers.claim.requestRecords", ADJUSTER));
        // And the diagnostics are the app's: someone who may not see it is not told them.
        assertEquals(List.of(), diagnostics(registry, CLERK));
        assertEquals(404, registry.respond(FILE, CLERK, null).status());
    }

    @Test
    void theRegistryInForceIsBuiltAgainWhenTheAllowListChanges() {
        ConfigSnapshot snapshot = snapshot(ACTIONS);
        AllowList one = allowList(requestRecords());
        AppRegistryEndpoint first = AppRegistryEndpoint.current(snapshot, one);
        assertSame(first, AppRegistryEndpoint.current(snapshot, one));
        AppRegistryEndpoint second = AppRegistryEndpoint.current(snapshot, allowList(requestRecords(), refer()));
        assertTrue(first != second);
        assertNotNull(second.action(APP, "payers.claim.referToInvestigations", ADJUSTER));
        assertNull(first.action(APP, "payers.claim.referToInvestigations", ADJUSTER));
    }

    @Test
    void anEntryForOtherAppsLeavesThisAppsButtonOut() throws Exception {
        AllowedOperationDescriptor elsewhere = ActionFixtures.narrowed();
        elsewhere.apps = new ArrayList<>(List.of("staff-directory"));
        AppRegistryEndpoint registry = registry(ACTIONS, allowList(elsewhere));
        assertEquals(List.of("payers.claim.pay"), ids(served(registry)));
        assertTrue(diagnostics(registry, ADJUSTER).get(0).contains("lets only other apps' buttons run"));
    }

    @Test
    void aParameterFromElsewhereThanTheAllowListSaysIsLeftOut() throws Exception {
        // The deployment reads the provider from the stored claim: a form field for it is refused.
        String typed = ACTIONS.replace("\"provider\": { \"field\": \"claim:provider\" }",
                "\"provider\": { \"field\": \"var:provider\" }");
        AppRegistryEndpoint registry = registry(typed, allowList(ActionFixtures.narrowed()));
        assertEquals(List.of("payers.claim.pay"), ids(served(registry)));
        assertTrue(diagnostics(registry, ADJUSTER).get(0)
                                                  .contains("gives the parameter \"provider\" its value from elsewhere"
                                                          + " than this server's allow-list says: field:claim:provider"));
        // As it is written, it is served.
        assertNotNull(registry(ACTIONS, allowList(ActionFixtures.narrowed())).action(APP, "payers.claim.requestRecords",
                ADJUSTER));
    }

    @Test
    void anActionThatDoesNotGiveARequiredParameterIsLeftOut() throws Exception {
        String noNote = ACTIONS.replace("\"note\": { \"field\": \"var:note\" },", "");
        AppRegistryEndpoint registry = registry(noNote, allowList(ActionFixtures.narrowed()));
        assertEquals(List.of("payers.claim.pay"), ids(served(registry)));
        assertTrue(diagnostics(registry, ADJUSTER).get(0)
                                                  .contains("does not give Payers.RequestMedicalRecords the parameter"
                                                          + " \"note\", which this server's allow-list requires"));
    }

    @Test
    void aNameTheLogCannotHoldIsNotQuotedInADiagnostic() throws Exception {
        String forged = ACTIONS.replace("\"payers.claim.referToInvestigations\"",
                "\"x\\nAgentic UI allow-list: Document.Delete allowed\"")
                               .replace("\"operation\": \"Payers.ReferToInvestigations\"",
                                       "\"operation\": \"Payers.Refer\\nforged\"");
        List<String> said = diagnostics(registry(forged, allowList(requestRecords())), ADJUSTER);
        assertEquals(1, said.size());
        assertFalse(said.get(0).contains("\n"), said.get(0));
        assertTrue(said.get(0).contains("the action with no id an action may have has no id an app's action may have"),
                said.get(0));
        // An id that is one, and an operation that is not: the operation is not quoted either.
        String operation = ACTIONS.replace("\"operation\": \"Payers.ReferToInvestigations\"",
                "\"operation\": \"Payers.Refer\\nforged\"");
        said = diagnostics(registry(operation, allowList(requestRecords())), ADJUSTER);
        assertFalse(said.get(0).contains("\n"), said.get(0));
        assertTrue(said.get(0).contains("\"payers.claim.referToInvestigations\" names no operation"), said.get(0));
    }

    static AllowedOperationDescriptor refer() {
        AllowedOperationDescriptor d = new AllowedOperationDescriptor();
        d.id = REFER;
        d.parameters.add(parameter("reason", "string", null));
        return d;
    }
}
