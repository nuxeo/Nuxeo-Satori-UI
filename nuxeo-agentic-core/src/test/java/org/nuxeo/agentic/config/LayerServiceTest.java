package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.nuxeo.agentic.config.LayerFixtures.ADA;
import static org.nuxeo.agentic.config.LayerFixtures.APP;
import static org.nuxeo.agentic.config.LayerFixtures.BEN;
import static org.nuxeo.agentic.config.LayerFixtures.CLAIM_VIEW;
import static org.nuxeo.agentic.config.LayerFixtures.DANA;
import static org.nuxeo.agentic.config.LayerFixtures.MY_CLAIMS;
import static org.nuxeo.agentic.config.LayerFixtures.ON;
import static org.nuxeo.agentic.config.LayerFixtures.ON_SELF_APPROVAL;
import static org.nuxeo.agentic.config.LayerFixtures.SAM;
import static org.nuxeo.agentic.config.LayerFixtures.change;
import static org.nuxeo.agentic.config.LayerFixtures.claimViewWith;
import static org.nuxeo.agentic.config.LayerFixtures.kitFile;
import static org.nuxeo.agentic.config.LayerFixtures.publish;
import static org.nuxeo.agentic.config.LayerFixtures.save;
import static org.nuxeo.agentic.config.LayerFixtures.service;
import static org.nuxeo.agentic.config.LayerFixtures.text;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The deployment layer's guarantees, each against the real validator the server runs and the
 * Payers kit: who may read and change it, what the validator refuses, what the registry serves and
 * to whom, approval by a second administrator, rollback, concurrent changes and the trail.
 */
class LayerServiceTest {

    private static String body(AppRegistryEndpoint.Response response) {
        return new String(response.body(), StandardCharsets.UTF_8);
    }

    private static String body(ConfigEndpoint.Response response) {
        return response.status() + " " + new String(response.body(), StandardCharsets.UTF_8);
    }

    private static JsonNode json(AppRegistryEndpoint.Response response) throws Exception {
        return ConfigSnapshot.JSON.readTree(response.body());
    }

    // --- Who ----------------------------------------------------------------------------------------

    @Test
    void aNonAdministratorCanNeitherReadNorChangeALayerWhateverTheirGroups() {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        LayerService service = service(ON, store);
        assertEquals(200, publish(service, CLAIM_VIEW, claimViewWith("Published")).status());
        int writes = store.writes;

        for (AppRegistryEndpoint.Viewer viewer : List.of(DANA, SAM)) {
            assertEquals(403, service.act(APP, CLAIM_VIEW, viewer, save(3, claimViewWith("Mine"))).status());
            for (String action : List.of("submit", "approve", "rollback", "discard")) {
                assertEquals(403, service.act(APP, CLAIM_VIEW, viewer, change(action, 3)).status(), action);
            }
            assertEquals(403, service.state(APP, CLAIM_VIEW, viewer).status());
            assertEquals(403, service.summary(APP, viewer).status());
            assertEquals(403, service.export(viewer).status());
            // Refused before anything is looked up: an app the server lacks is 403 too, not 404.
            assertEquals(403, service.state("no-such-app", CLAIM_VIEW, viewer).status());
        }
        assertEquals(writes, store.writes);
    }

    @Test
    void switchedOffEveryAddressIs404AndTheRegistryServesThePackagesFiles() {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        assertEquals(200, publish(service(ON, store), CLAIM_VIEW, claimViewWith("Published")).status());

        LayerService off = service(LayerSettings.OFF, store);
        assertEquals(404, off.state(APP, CLAIM_VIEW, ADA).status());
        // Someone else learns nothing, not even whether the layer is on: 403, as when it is.
        assertEquals(403, off.state(APP, CLAIM_VIEW, DANA).status());
        assertEquals(404, off.act(APP, CLAIM_VIEW, ADA, save(3, claimViewWith("Again"))).status());
        assertEquals(404, off.export(ADA).status());
        assertSame(LayerService.Live.NONE, off.live());
        assertSame(LayerService.Live.NONE, LayerService.SWITCHED_OFF.live());
        assertEquals(404, LayerService.SWITCHED_OFF.act(APP, CLAIM_VIEW, ADA, save(0, claimViewWith("x"))).status());
    }

    @ParameterizedTest
    @ValueSource(strings = { "home.json", "navigation.json", "actions.json", "app.json", "labels/en.json",
            "tasks/PayersClaimReview.determine.layout.json", "layouts/Claim/metadata.layout.json",
            "layouts/../app.json", "queues/../app.json", "layouts/Claim/view.layout.json/x" })
    void aPathNoLayerHoldsIs404(String path) {
        LayerService service = service(ON, new LayerFixtures.MemoryStore());
        assertEquals(404, service.state(APP, path, ADA).status());
        assertEquals(404, service.act(APP, path, ADA, save(0, claimViewWith("x"))).status());
    }

    // --- What the validator refuses -----------------------------------------------------------------

    @Test
    void anInvalidFileIsRefusedOnTheServerWhateverTheClientSays() {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        LayerService service = service(ON, store);
        ObjectNode file = claimViewWith("Mine");
        ((com.fasterxml.jackson.databind.node.ArrayNode) file.get("cards").get(0).get("fields")).add("zz:nope");
        file.put("bogus", true);

        LayerService.Outcome refused = service.act(APP, CLAIM_VIEW, ADA, save(0, file));

        assertEquals(422, refused.status());
        assertEquals("invalid", refused.body().get("error").asText());
        List<String> paths = new ArrayList<>();
        refused.body().get("findings").forEach(finding -> paths.add(finding.get("path").asText()));
        assertTrue(paths.contains("bogus"), paths.toString());
        assertTrue(paths.stream().anyMatch(path -> path.startsWith("cards[0].fields")), paths.toString());
        assertEquals(0, store.writes);
        assertEquals(0, service.state(APP, CLAIM_VIEW, ADA).body().get("revision").asInt());
    }

    @Test
    void aQueueIsHeldToTheAppsOwnActions() {
        LayerService service = service(ON, new LayerFixtures.MemoryStore());
        ObjectNode queue = kitFile(MY_CLAIMS);
        queue.put("label", "My open claims");
        assertEquals(200, service.act(APP, MY_CLAIMS, ADA, save(0, queue)).status());

        ObjectNode unknown = kitFile(MY_CLAIMS);
        unknown.putArray("rowActions").add("acme.unregistered");
        assertEquals(422, service.act(APP, MY_CLAIMS, ADA, save(1, unknown)).status());
    }

    @Test
    void aChangeThatIsNotOneIsRefused() {
        LayerService service = service(ON, new LayerFixtures.MemoryStore());
        assertEquals(400, service.act(APP, CLAIM_VIEW, ADA, null).status());
        assertEquals(400, service.act(APP, CLAIM_VIEW, ADA, change("publish", 0)).status());
        assertEquals(400, service.act(APP, CLAIM_VIEW, ADA, change("save", 0)).status());
        assertEquals(400, service.act(APP, CLAIM_VIEW, ADA, save(-1, claimViewWith("x"))).status());
        ObjectNode array = change("save", 0);
        array.putArray("content");
        assertEquals(400, service.act(APP, CLAIM_VIEW, ADA, array).status());
        ObjectNode noRevision = ConfigSnapshot.JSON.createObjectNode().put("action", "submit");
        assertEquals(400, service.act(APP, CLAIM_VIEW, ADA, noRevision).status());
    }

    // --- Drafts never reach a reader ----------------------------------------------------------------

    @Test
    void aDraftIsNeverServedByTheRegistryOrTheConfigurationToAnyone() throws Exception {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        ConfigSnapshot snapshot = LayerFixtures.snapshot();
        LayerService service = service(ON, store, () -> snapshot, new LayerFixtures.TestClock());
        ConfigEndpoint configuration = new ConfigEndpoint(snapshot);
        List<String> before = new ArrayList<>();
        for (String path : List.of("/bootstrap.json", "/manifest.json", "/layouts.json", "/layouts/Claim/view.layout.json")) {
            before.add(body(configuration.respond(path, null)));
        }

        String marker = "DRAFT-ONLY-7c1f";
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, save(0, claimViewWith(marker))).status());
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, change("submit", 1)).status());
        ObjectNode queue = kitFile(MY_CLAIMS);
        queue.put("label", marker);
        assertEquals(200, service.act(APP, MY_CLAIMS, ADA, save(0, queue)).status());

        AppRegistryEndpoint registry = new AppRegistryEndpoint(snapshot, service.live());
        for (AppRegistryEndpoint.Viewer viewer : List.of(DANA, SAM, ADA, BEN)) {
            for (String path : List.of("/apps.json", "/apps/payers-claims/" + CLAIM_VIEW, "/apps/payers-claims/" + MY_CLAIMS)) {
                assertFalse(body(registry.respond(path, viewer, null)).contains(marker), viewer.name() + " " + path);
            }
        }
        assertEquals(404, registry.respond("/apps/payers-claims/" + CLAIM_VIEW, DANA, null).status());
        assertEquals(text(kitFile(MY_CLAIMS)), text(json(registry.respond("/apps/payers-claims/" + MY_CLAIMS, DANA, null))));

        // The anonymous configuration reads no layer: byte for byte what it served before.
        ConfigEndpoint after = new ConfigEndpoint(snapshot);
        int index = 0;
        for (String path : List.of("/bootstrap.json", "/manifest.json", "/layouts.json", "/layouts/Claim/view.layout.json")) {
            assertEquals(before.get(index++), body(after.respond(path, null)), path);
        }

        // Administrators read the draft through the layer's own address, and no one else does.
        assertTrue(text(service.state(APP, CLAIM_VIEW, BEN).body()).contains(marker));
        assertFalse(text(service.state(APP, CLAIM_VIEW, DANA).body()).contains(marker));
    }

    // --- Approval -----------------------------------------------------------------------------------

    @Test
    void theAdministratorWhoMadeOrSubmittedAChangeMayNotApproveIt() {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        LayerService service = service(ON, store);
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, save(0, claimViewWith("One"))).status());
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, change("submit", 1)).status());

        LayerService.Outcome own = service.act(APP, CLAIM_VIEW, ADA, change("approve", 2));
        assertEquals(403, own.status());
        assertEquals("self-approval", own.body().get("error").asText());
        assertFalse(service.state(APP, CLAIM_VIEW, ADA).body().path("permissions").path("approve").asBoolean());
        assertTrue(service.state(APP, CLAIM_VIEW, BEN).body().path("permissions").path("approve").asBoolean());

        // Ben edits Ada's draft: he wrote part of it, so he may not approve it either.
        assertEquals(200, service.act(APP, CLAIM_VIEW, BEN, save(2, claimViewWith("One, edited"))).status());
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, change("submit", 3)).status());
        assertEquals(403, service.act(APP, CLAIM_VIEW, BEN, change("approve", 4)).status());
        assertEquals(403, service.act(APP, CLAIM_VIEW, ADA, change("approve", 4)).status());
        assertEquals(0, service.state(APP, CLAIM_VIEW, ADA).body().get("versions").size());
    }

    @Test
    void theSubmitterMayNotApproveADraftAnotherWrote() {
        LayerService service = service(ON, new LayerFixtures.MemoryStore());
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, save(0, claimViewWith("One"))).status());
        assertEquals(200, service.act(APP, CLAIM_VIEW, BEN, change("submit", 1)).status());
        assertEquals(403, service.act(APP, CLAIM_VIEW, BEN, change("approve", 2)).status());
    }

    @Test
    void aSecondAdministratorApprovesAndTheRegistryServesTheChangeToTheAppsGroupsOnly() throws Exception {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        ConfigSnapshot snapshot = LayerFixtures.snapshot();
        LayerService service = service(ON, store, () -> snapshot, new LayerFixtures.TestClock());
        ObjectNode file = claimViewWith("Approved by Ben");

        LayerService.Outcome approved = publish(service, CLAIM_VIEW, file);

        assertEquals(200, approved.status());
        JsonNode live = approved.body().get("live");
        assertEquals(1, live.get("version").asInt());
        assertEquals("ben", live.get("approvedBy").asText());
        assertEquals("ada", live.get("submittedBy").asText());
        assertTrue(approved.body().get("draft").isNull());

        AppRegistryEndpoint registry = new AppRegistryEndpoint(snapshot, service.live());
        AppRegistryEndpoint.Response served = registry.respond("/apps/payers-claims/" + CLAIM_VIEW, DANA, null);
        assertEquals(200, served.status());
        assertEquals(text(file), text(json(served)));
        JsonNode listing = json(registry.respond("/apps.json", DANA, null)).get("apps").get(0);
        assertTrue(listing.get("files").toString().contains(CLAIM_VIEW));
        assertEquals(1, listing.get("layer").get(CLAIM_VIEW).asInt());
        // Someone in none of the app's groups is answered as for an app they may not see.
        assertEquals(404, registry.respond("/apps/payers-claims/" + CLAIM_VIEW, SAM, null).status());
    }

    @Test
    void aDeploymentSettingLetsTheSameAdministratorApprove() {
        LayerService service = service(ON_SELF_APPROVAL, new LayerFixtures.MemoryStore());
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, save(0, claimViewWith("Mine"))).status());
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, change("submit", 1)).status());
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, change("approve", 2)).status());
    }

    @Test
    void approvalNeedsASubmittedDraftMadeOnTheLiveVersion() {
        LayerService service = service(ON, new LayerFixtures.MemoryStore());
        assertEquals(409, service.act(APP, CLAIM_VIEW, BEN, change("approve", 0)).status());
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, save(0, claimViewWith("Draft"))).status());
        assertEquals(409, service.act(APP, CLAIM_VIEW, BEN, change("approve", 1)).status());
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, change("submit", 1)).status());
        assertEquals(409, service.act(APP, CLAIM_VIEW, ADA, change("submit", 2)).status());

        // Another change goes live while the draft waits: the draft was made on the package's file.
        LayerService other = service;
        assertEquals(200, other.act(APP, CLAIM_VIEW, BEN, change("discard", 2)).status());
        assertEquals(200, publish(other, CLAIM_VIEW, claimViewWith("First")).status());
        assertEquals(200, other.act(APP, CLAIM_VIEW, ADA, save(6, claimViewWith("Second"))).status());
        assertEquals(200, other.act(APP, CLAIM_VIEW, ADA, change("submit", 7)).status());
        assertEquals(200, other.act(APP, CLAIM_VIEW, BEN, change("rollback", 8)).status());
        LayerService.Outcome stale = other.act(APP, CLAIM_VIEW, BEN, change("approve", 9));
        assertEquals(409, stale.status());
        assertEquals("live-changed", stale.body().get("error").asText());
    }

    @Test
    void approvalChecksTheDraftAgainstTheModelAsItIsThen() {
        AtomicReference<JsonNode> model = new AtomicReference<>(LayerFixtures.kit("model"));
        ConfigSnapshot snapshot = LayerFixtures.snapshot();
        LayerService service = new LayerService(ON, new LayerFixtures.MemoryStore(),
                LayerFixtures.validator(ON, model::get), () -> snapshot, new LayerFixtures.TestClock(),
                LayerService.AppLock.NONE);
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, save(0, claimViewWith("Draft"))).status());
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, change("submit", 1)).status());

        // The Claim type loses its schemas before the approval: the draft names their properties.
        ObjectNode changed = model.get().deepCopy();
        ((ObjectNode) changed.get("doctypes").get("Claim")).putArray("schemas").add("dublincore");
        model.set(changed);

        LayerService.Outcome approval = service.act(APP, CLAIM_VIEW, BEN, change("approve", 2));
        assertEquals(422, approval.status());
        assertTrue(approval.body().get("findings").size() > 0);
    }

    // --- Rollback -----------------------------------------------------------------------------------

    @Test
    void rollbackRestoresWhatWasLiveBeforeAndThenThePackagesFile() throws Exception {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        ConfigSnapshot snapshot = LayerFixtures.snapshot();
        LayerService service = service(ON, store, () -> snapshot, new LayerFixtures.TestClock());
        ObjectNode first = claimViewWith("First");
        ObjectNode second = claimViewWith("Second");
        assertEquals(200, publish(service, CLAIM_VIEW, first).status());
        assertEquals(200, publish(service, CLAIM_VIEW, second).status());

        LayerService.Outcome back = service.act(APP, CLAIM_VIEW, BEN, change("rollback", 6));
        assertEquals(200, back.status());
        JsonNode live = back.body().get("live");
        assertEquals(3, live.get("version").asInt());
        assertEquals("rollback", live.get("kind").asText());
        assertEquals(1, live.get("from").asInt());
        assertEquals(text(first), text(live.get("content")));
        assertEquals(text(first), text(json(new AppRegistryEndpoint(snapshot, service.live())
                .respond("/apps/payers-claims/" + CLAIM_VIEW, DANA, null))));
        // Every version is kept, and none has its content in the history the state lists.
        assertEquals(3, back.body().get("versions").size());
        assertFalse(back.body().get("versions").get(0).has("content"));

        // The rollback approved nothing: the version keeps the makers of the one it restores.
        assertEquals("ben", live.get("approvedBy").asText());
        assertEquals("ada", live.get("submittedBy").asText());
        assertEquals("ben", live.get("restoredBy").asText());
        assertEquals(2, back.body().get("previous").asInt());

        // One administrator puts back only what was live just before, or the package's file.
        ObjectNode older = change("rollback", 7);
        older.put("to", 1);
        LayerService.Outcome refused = service.act(APP, CLAIM_VIEW, ADA, older);
        assertEquals(409, refused.status());
        assertEquals("not-restorable", refused.body().get("error").asText());
        ObjectNode unknown = change("rollback", 7);
        unknown.put("to", 99);
        assertEquals(409, service.act(APP, CLAIM_VIEW, ADA, unknown).status());

        ObjectNode toPackage = change("rollback", 7);
        toPackage.put("to", 0);
        LayerService.Outcome packaged = service.act(APP, CLAIM_VIEW, ADA, toPackage);
        assertEquals(200, packaged.status());
        assertTrue(packaged.body().get("live").isNull());
        assertEquals(404, new AppRegistryEndpoint(snapshot, service.live())
                .respond("/apps/payers-claims/" + CLAIM_VIEW, DANA, null).status());

        // And undoes the rollback to the package: version 3, the first file, goes live again.
        LayerService.Outcome undone = service.act(APP, CLAIM_VIEW, ADA, change("rollback", 8));
        assertEquals(200, undone.status());
        assertEquals(3, undone.body().get("live").get("from").asInt());
        assertEquals(text(first), text(undone.body().get("live").get("content")));
    }

    @Test
    void aLiveFileTheValidatorNoLongerPassesIsNotServedAndThePackagesIs() throws Exception {
        AtomicReference<JsonNode> model = new AtomicReference<>(LayerFixtures.kit("model"));
        AtomicReference<ConfigSnapshot> snapshot = new AtomicReference<>(LayerFixtures.snapshot());
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        LayerService service = new LayerService(ON, store, LayerFixtures.validator(ON, model::get), snapshot::get,
                new LayerFixtures.TestClock(), LayerService.AppLock.NONE);
        assertEquals(200, publish(service, CLAIM_VIEW, claimViewWith("Live")).status());
        assertEquals(1, service.live().of(APP).size());

        // A new configuration, with a model whose Claim type has lost its schemas: the live file
        // names properties the type no longer has.
        ObjectNode changed = model.get().deepCopy();
        ((ObjectNode) changed.get("doctypes").get("Claim")).putArray("schemas").add("dublincore");
        model.set(changed);
        snapshot.set(LayerFixtures.snapshot());

        assertTrue(service.live().of(APP).isEmpty());
        assertEquals(404, new AppRegistryEndpoint(snapshot.get(), service.live())
                .respond("/apps/payers-claims/" + CLAIM_VIEW, DANA, null).status());
    }

    @Test
    void aStoredLayerWrittenAroundTheServiceIsServedOnlyWhereTheValidatorPassesIt() throws Exception {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        LayerService service = service(ON, store);
        assertEquals(200, publish(service, CLAIM_VIEW, claimViewWith("Approved")).status());
        ObjectNode queue = kitFile(MY_CLAIMS);
        queue.put("label", "Approved queue");
        assertEquals(200, publish(service, MY_CLAIMS, queue).status());

        // An administrator rewrites the stored document through the REST API: the record page's
        // live version now names a property no type has, and nobody approved it.
        ObjectNode forged = (ObjectNode) ConfigSnapshot.JSON.readTree(store.stored.get(APP).json());
        ObjectNode version = (ObjectNode) forged.get("files").get(CLAIM_VIEW).get("versions").get(0);
        ((com.fasterxml.jackson.databind.node.ArrayNode) version.get("content").get("cards").get(0).get("fields"))
                .add("zz:forged");
        store.stored.put(APP, new LayerStore.Stored(ConfigSnapshot.JSON.writeValueAsBytes(forged), "forged"));

        LayerService.Live live = service(ON, store).live();
        assertEquals(java.util.Set.of(MY_CLAIMS), live.of(APP).keySet());
    }

    @Test
    void aReadOfTheLiveLayerMadeWhileAChangeIsWrittenIsNotKept() {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        LayerService service = service(ON, store);
        assertTrue(service.live().apps().isEmpty());
        assertEquals(200, publish(service, CLAIM_VIEW, claimViewWith("First")).status());

        store.afterReadAll.set(() -> assertEquals(200, publish(service, CLAIM_VIEW, claimViewWith("Second")).status()));
        LayerService.Live during = service.live();
        assertEquals(1, during.of(APP).get(CLAIM_VIEW).version());
        // Not kept: the next read sees the change at once, not ten seconds later.
        assertEquals(2, service.live().of(APP).get(CLAIM_VIEW).version());
    }

    @Test
    void namesAreComparedWithoutTheirCaseForTheSecondPairOfEyes() {
        LayerService service = service(ON, new LayerFixtures.MemoryStore());
        AppRegistryEndpoint.Viewer shouting = new AppRegistryEndpoint.Viewer("ADA", java.util.Set.of(), true);
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, save(0, claimViewWith("Mine"))).status());
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, change("submit", 1)).status());
        assertEquals(403, service.act(APP, CLAIM_VIEW, shouting, change("approve", 2)).status());
    }

    @Test
    void aLayerHoldsAtMostItsLimitOfFiles() throws Exception {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        ObjectNode layer = ConfigSnapshot.JSON.createObjectNode().put("format", LayerService.FORMAT).put("app", APP);
        ObjectNode files = layer.putObject("files");
        for (int index = 0; index < LayerService.MAX_FILES; index++) {
            files.putObject("queues/q" + index + ".json").put("revision", 1).put("live", 0);
        }
        store.stored.put(APP, new LayerStore.Stored(ConfigSnapshot.JSON.writeValueAsBytes(layer), "full"));
        LayerService.Outcome refused = service(ON, store).act(APP, CLAIM_VIEW, ADA, save(0, claimViewWith("One more")));
        assertEquals(413, refused.status());
        assertEquals("too-many-files", refused.body().get("error").asText());
    }

    @Test
    void aChangeThatFailsInsideTheLockIsAFailureNotABusyServer() {
        ConfigSnapshot snapshot = LayerFixtures.snapshot();
        LayerService service = new LayerService(ON, new LayerFixtures.MemoryStore(), (path, content, app, actions) -> {
            throw new IllegalStateException("broken");
        }, () -> snapshot, new LayerFixtures.TestClock(), LayerService.AppLock.NONE);
        LayerService.Outcome failed = service.act(APP, CLAIM_VIEW, ADA, save(0, claimViewWith("x")));
        assertEquals(500, failed.status());
        assertEquals("failed", failed.body().get("error").asText());
    }

    @Test
    void nothingToRollBackIsRefused() {
        LayerService service = service(ON, new LayerFixtures.MemoryStore());
        assertEquals(409, service.act(APP, CLAIM_VIEW, ADA, change("rollback", 0)).status());
    }

    @Test
    void aVersionNoLongerValidIsNotRolledBackTo() {
        AtomicReference<JsonNode> model = new AtomicReference<>(LayerFixtures.kit("model"));
        ConfigSnapshot snapshot = LayerFixtures.snapshot();
        LayerService service = new LayerService(ON_SELF_APPROVAL, new LayerFixtures.MemoryStore(),
                LayerFixtures.validator(ON_SELF_APPROVAL, model::get), () -> snapshot, new LayerFixtures.TestClock(),
                LayerService.AppLock.NONE);
        assertEquals(200, publish(service, CLAIM_VIEW, claimViewWith("First")).status());
        assertEquals(200, publish(service, CLAIM_VIEW, claimViewWith("Second")).status());
        ObjectNode changed = model.get().deepCopy();
        ((ObjectNode) changed.get("doctypes").get("Claim")).putArray("schemas").add("dublincore");
        model.set(changed);

        assertEquals(422, service.act(APP, CLAIM_VIEW, ADA, change("rollback", 6)).status());
        ObjectNode toPackage = change("rollback", 6);
        toPackage.put("to", 0);
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, toPackage).status());
    }

    @Test
    void theLastFiftyVersionsAreKeptAndTheLiveOneAlways() {
        LayerService service = service(ON_SELF_APPROVAL, new LayerFixtures.MemoryStore());
        for (int index = 0; index < LayerService.MAX_VERSIONS + 3; index++) {
            assertEquals(200, publish(service, CLAIM_VIEW, claimViewWith("Version " + index)).status());
        }
        JsonNode state = service.state(APP, CLAIM_VIEW, ADA).body();
        assertEquals(LayerService.MAX_VERSIONS, state.get("versions").size());
        assertEquals(LayerService.MAX_VERSIONS + 3, state.get("live").get("version").asInt());
        assertEquals(4, state.get("versions").get(0).get("version").asInt());
    }

    // --- Concurrent changes -------------------------------------------------------------------------

    @Test
    void aChangeMadeOnARevisionThatIsNoLongerTheFilesIsRefusedWithTheFileAsItIs() {
        LayerService service = service(ON, new LayerFixtures.MemoryStore());
        int seen = service.state(APP, CLAIM_VIEW, BEN).body().get("revision").asInt();
        assertEquals(200, service.act(APP, CLAIM_VIEW, ADA, save(seen, claimViewWith("Ada's"))).status());

        LayerService.Outcome late = service.act(APP, CLAIM_VIEW, BEN, save(seen, claimViewWith("Ben's")));

        assertEquals(409, late.status());
        assertEquals("stale", late.body().get("error").asText());
        assertTrue(text(late.body().get("state")).contains("Ada's"));
        assertTrue(text(service.state(APP, CLAIM_VIEW, ADA).body()).contains("Ada's"));
    }

    @Test
    void anotherServersWriteIsKeptWhenItWasToAnotherFileAndRefusesThisOneWhenToTheSame() {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        LayerService here = service(ON, store);
        LayerService there = service(ON, store);
        ObjectNode queue = kitFile(MY_CLAIMS);
        queue.put("label", "There");
        store.beforeWrite.set(() -> assertEquals(200, there.act(APP, MY_CLAIMS, BEN, save(0, queue)).status()));

        assertEquals(200, here.act(APP, CLAIM_VIEW, ADA, save(0, claimViewWith("Here"))).status());

        JsonNode summary = here.summary(APP, ADA).body();
        assertEquals(2, summary.get("files").size());
        assertTrue(text(here.state(APP, MY_CLAIMS, ADA).body()).contains("There"));

        store.beforeWrite.set(() -> assertEquals(200,
                there.act(APP, CLAIM_VIEW, BEN, save(1, claimViewWith("There first"))).status()));
        LayerService.Outcome lost = here.act(APP, CLAIM_VIEW, ADA, save(1, claimViewWith("Here again")));
        assertEquals(409, lost.status());
        assertTrue(text(here.state(APP, CLAIM_VIEW, ADA).body()).contains("There first"));
    }

    @Test
    void aClusterLockThatIsNotGivenRefusesTheChangeAndWritesNothing() {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        ConfigSnapshot snapshot = LayerFixtures.snapshot();
        LayerService service = new LayerService(ON, store, LayerFixtures.validator(ON), () -> snapshot,
                new LayerFixtures.TestClock(), (app, work) -> {
                    throw new IllegalStateException("lock not acquired");
                });
        assertEquals(409, service.act(APP, CLAIM_VIEW, ADA, save(0, claimViewWith("x"))).status());
        assertEquals(0, store.writes);
    }

    @Test
    void theRegistrysCopyOfTheLiveLayerIsReadAgainAfterAChangeHereAndAfterTenSecondsForOneElsewhere() {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        ConfigSnapshot snapshot = LayerFixtures.snapshot();
        LayerFixtures.TestClock clock = new LayerFixtures.TestClock();
        LayerService here = service(ON, store, () -> snapshot, clock);
        LayerService there = service(ON, store, () -> snapshot, clock);
        LayerService.Live empty = here.live();
        assertSame(empty, here.live());

        assertEquals(200, publish(there, CLAIM_VIEW, claimViewWith("There")).status());
        assertSame(empty, here.live());
        clock.advance(LayerService.REFRESH_MILLIS);
        LayerService.Live read = here.live();
        assertNotEquals(empty, read);
        assertEquals(1, read.of(APP).get(CLAIM_VIEW).version());
        clock.advance(LayerService.REFRESH_MILLIS);
        assertSame(read, here.live());

        assertEquals(200, publish(here, CLAIM_VIEW, claimViewWith("Here")).status());
        assertEquals(2, here.live().of(APP).get(CLAIM_VIEW).version());
    }

    // --- Audit, precedence, the rest ----------------------------------------------------------------

    @Test
    void everyChangeIsALineInTheTrailWithWhoWhenAndWhat() {
        LayerService service = service(ON, new LayerFixtures.MemoryStore());
        assertEquals(200, publish(service, CLAIM_VIEW, claimViewWith("One")).status());
        assertEquals(200, service.act(APP, CLAIM_VIEW, BEN, change("rollback", 3)).status());

        JsonNode trail = service.state(APP, CLAIM_VIEW, ADA).body().get("trail");
        List<String> lines = new ArrayList<>();
        trail.forEach(line -> lines.add(line.get("by").asText() + " " + line.get("action").asText() + " "
                + line.get("revision").asInt() + (line.has("version") ? " v" + line.get("version").asInt() : "")));
        assertEquals(List.of("ada save 1", "ada submit 2", "ben approve 3 v1", "ben rollback 4 v0"), lines);
        trail.forEach(line -> assertEquals("2026-11-25T22:00:00Z", line.get("at").asText()));
        assertEquals(64, trail.get(0).get("sha256").asText().length());
    }

    @Test
    void theStateSaysWhenThePackagesFileHasChangedUnderTheOverride() {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        assertEquals(200, publish(service(ON, store), CLAIM_VIEW, claimViewWith("Mine")).status());
        assertFalse(service(ON, store).state(APP, CLAIM_VIEW, ADA).body().get("packageChanged").asBoolean());

        ObjectNode upgraded = kitFile(CLAIM_VIEW);
        upgraded.put("columns", 3);
        ConfigSnapshot next = LayerFixtures.snapshot(upgraded, kitFile(MY_CLAIMS));
        JsonNode state = service(ON, store, () -> next, new LayerFixtures.TestClock()).state(APP, CLAIM_VIEW, ADA)
                                                                                   .body();
        assertTrue(state.get("packageChanged").asBoolean());
        assertEquals(text(upgraded), text(state.get("package").get("content")));
    }

    @Test
    void theExportListsTheOverridesInForceAndNoDraft() {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        LayerService service = service(ON, store);
        assertEquals(200, publish(service, CLAIM_VIEW, claimViewWith("Live")).status());
        ObjectNode queue = kitFile(MY_CLAIMS);
        queue.put("label", "Drafted");
        assertEquals(200, service.act(APP, MY_CLAIMS, ADA, save(0, queue)).status());

        JsonNode export = service.export(ADA).body();
        assertEquals(LayerService.FORMAT, export.get("format").asText());
        assertEquals(1, export.get("apps").size());
        JsonNode files = export.get("apps").get(0).get("files");
        assertEquals(1, files.size());
        assertEquals(CLAIM_VIEW, files.get(0).get("path").asText());
        assertEquals(1, files.get(0).get("version").asInt());
        assertFalse(text(export).contains("Drafted"));
    }

    @Test
    void aStoredLayerThatIsNotOneIsNeitherServedNorWrittenOver() {
        LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();
        store.stored.put(APP, new LayerStore.Stored("{\"format\":\"other\"}".getBytes(StandardCharsets.UTF_8), "s"));
        LayerService service = service(ON, store);
        assertTrue(service.live().apps().isEmpty());
        assertEquals(500, service.act(APP, CLAIM_VIEW, ADA, save(0, claimViewWith("x"))).status());
        assertEquals(0, store.writes);
    }
}
