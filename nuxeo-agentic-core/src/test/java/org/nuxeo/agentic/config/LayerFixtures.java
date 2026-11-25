package org.nuxeo.agentic.config;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The Payers kit as a server would have it, for the deployment layer's tests: its app for
 * {@code claims-adjusters}, with its {@code actions.json} and {@code my-claims} queue, and its Claim
 * record page contributed as a layout; the people who ask; a store in memory; and the real
 * validator, the script the server runs, held to the kit's content model.
 *
 * The kit's files and model are read from the parity corpus, which
 * {@code server-validator-build.mjs} writes from {@code business-apps/packages/payers-claims-demo}.
 */
final class LayerFixtures {

    static final String APP = "payers-claims";

    static final String KIT = "payers-claims-demo";

    static final String CLAIM_VIEW = "layouts/Claim/view.layout.json";

    static final String MY_CLAIMS = "queues/my-claims.json";

    static final AppRegistryEndpoint.Viewer ADA = new AppRegistryEndpoint.Viewer("ada", Set.of("administrators"), true);

    static final AppRegistryEndpoint.Viewer BEN = new AppRegistryEndpoint.Viewer("ben", Set.of("administrators"), true);

    /** In the app's group, and no administrator. */
    static final AppRegistryEndpoint.Viewer DANA = new AppRegistryEndpoint.Viewer("dana",
            Set.of("members", "claims-adjusters"), false);

    /** In none of the app's groups. */
    static final AppRegistryEndpoint.Viewer SAM = new AppRegistryEndpoint.Viewer("sam", Set.of("members"), false);

    static final LayerSettings ON = new LayerSettings(true, false, List.of(), List.of(), List.of());

    /**
     * The allow-list the Payers demo deployment contributes: its Request medical records operation,
     * which the kit's {@code my-claims} queue names as a row action.
     */
    static final AllowList PAYERS_OPERATIONS = ActionFixtures.allowList(ActionFixtures.requestRecords());

    static final LayerSettings ON_SELF_APPROVAL = new LayerSettings(true, true, List.of(), List.of(), List.of());

    private static JsonNode corpus;

    private LayerFixtures() {
    }

    static synchronized JsonNode corpus() {
        if (corpus == null) {
            try (InputStream in = LayerFixtures.class.getClassLoader()
                                                     .getResourceAsStream("agentic-ui-validator/parity.json")) {
                corpus = ConfigSnapshot.JSON.readTree(in);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
        return corpus;
    }

    static JsonNode kit(String key) {
        return corpus().path("kits").path(KIT).path(key);
    }

    /** A file of the kit, as the corpus's case for it holds it. */
    static ObjectNode kitFile(String path) {
        for (JsonNode each : corpus().path("cases")) {
            if (each.path("name").asText().equals(KIT + ": " + path)) {
                return (ObjectNode) each.get("content").deepCopy();
            }
        }
        throw new IllegalArgumentException(path + " is not in the corpus");
    }

    static String text(JsonNode node) {
        try {
            return ConfigSnapshot.JSON.writeValueAsString(node);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** The configuration in force: the kit's app and its Claim record page. */
    static ConfigSnapshot snapshot() {
        return snapshot(kitFile(CLAIM_VIEW), kitFile(MY_CLAIMS));
    }

    static ConfigSnapshot snapshot(JsonNode claimView, JsonNode myClaims) {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(TestContributions.layout("payers", "Claim", "view", text(claimView)));
        Map<String, String> files = new LinkedHashMap<>();
        files.put("actions.json", text(kit("actions")));
        files.put(MY_CLAIMS, text(myClaims));
        registry.add(TestContributions.app("payers", APP, TestContributions.appJson(APP, "claims-adjusters"), files));
        return ConfigSnapshot.build(registry.resolve());
    }

    /** The validator the server runs, held to the kit's model, or to the one {@code model} gives. */
    static DeploymentValidator validator(LayerSettings settings, Supplier<JsonNode> model) {
        return new NashornDeploymentValidator(model, settings);
    }

    private static final Map<LayerSettings, DeploymentValidator> VALIDATORS = new java.util.HashMap<>();

    /** One per settings, kept across tests: each starts an engine and reads the script once. */
    static synchronized DeploymentValidator validator(LayerSettings settings) {
        JsonNode model = kit("model");
        return VALIDATORS.computeIfAbsent(settings, key -> validator(key, () -> model));
    }

    /** A clock that moves only when it is told to. */
    static final class TestClock extends Clock {

        private Instant now = Instant.parse("2026-11-25T22:00:00Z");

        void advance(long millis) {
            now = now.plusMillis(millis);
        }

        @Override
        public java.time.ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    /**
     * The store, in memory: a stamp that counts the writes, and a hook run before each write, which
     * may write itself, as another server would between this one's read and its write.
     */
    static final class MemoryStore implements LayerStore {

        final Map<String, Stored> stored = new LinkedHashMap<>();

        int writes;

        int reads;

        final AtomicReference<Runnable> beforeWrite = new AtomicReference<>();

        @Override
        public synchronized Stored read(String app) {
            reads++;
            return stored.get(app);
        }

        /** Run after a read of every layer, before it is answered: a change made while it is read. */
        final AtomicReference<Runnable> afterReadAll = new AtomicReference<>();

        @Override
        public synchronized Map<String, Stored> readAll() {
            reads++;
            Map<String, Stored> read = new LinkedHashMap<>(stored);
            Runnable hook = afterReadAll.getAndSet(null);
            if (hook != null) {
                hook.run();
            }
            return read;
        }

        int stampReads;

        @Override
        public synchronized Map<String, String> stamps() {
            stampReads++;
            Map<String, String> stamps = new LinkedHashMap<>();
            stored.forEach((app, each) -> stamps.put(app, each.stamp()));
            return stamps;
        }

        @Override
        public synchronized boolean write(String app, byte[] json, String expected) {
            Runnable hook = beforeWrite.getAndSet(null);
            if (hook != null) {
                hook.run();
            }
            Stored current = stored.get(app);
            String stamp = current == null ? null : current.stamp();
            if (expected == null ? stamp != null : !expected.equals(stamp)) {
                return false;
            }
            writes++;
            stored.put(app, new Stored(json.clone(), "stamp-" + writes));
            return true;
        }
    }

    static LayerService service(LayerSettings settings, MemoryStore store, Supplier<ConfigSnapshot> snapshot,
            Clock clock) {
        return new LayerService(settings, store, validator(settings), snapshot, () -> PAYERS_OPERATIONS, clock,
                LayerService.AppLock.NONE);
    }

    static LayerService service(LayerSettings settings, MemoryStore store) {
        ConfigSnapshot snapshot = snapshot();
        return service(settings, store, () -> snapshot, new TestClock());
    }

    /** A change, as the designer sends one. */
    static ObjectNode change(String action, int revision) {
        return ConfigSnapshot.JSON.createObjectNode().put("action", action).put("revision", revision);
    }

    static ObjectNode save(int revision, JsonNode content) {
        ObjectNode change = change("save", revision);
        change.set("content", content);
        return change;
    }

    /** The kit's Claim record page with a card of its own, headed {@code heading}. */
    static ObjectNode claimViewWith(String heading) {
        ObjectNode file = kitFile(CLAIM_VIEW);
        ObjectNode card = ConfigSnapshot.JSON.createObjectNode().put("id", "designer-added").put("label", heading);
        card.putArray("fields").add("dc:title");
        ((com.fasterxml.jackson.databind.node.ArrayNode) file.get("cards")).add(card);
        return file;
    }

    /** Drafts, submits and approves {@code content}: ada writes it and submits it, ben approves it. */
    static LayerService.Outcome publish(LayerService service, String path, JsonNode content) {
        int revision = service.state(APP, path, ADA).body().path("revision").asInt();
        LayerService.Outcome saved = service.act(APP, path, ADA, save(revision, content));
        if (saved.status() != 200) {
            return saved;
        }
        LayerService.Outcome submitted = service.act(APP, path, ADA, change("submit", revision + 1));
        if (submitted.status() != 200) {
            return submitted;
        }
        return service.act(APP, path, BEN, change("approve", revision + 2));
    }
}
