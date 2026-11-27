package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.nuxeo.agentic.config.LayerFixtures.APP;
import static org.nuxeo.agentic.config.LayerFixtures.CLAIM_VIEW;
import static org.nuxeo.agentic.config.LayerFixtures.ON;
import static org.nuxeo.agentic.config.TestContributions.app;
import static org.nuxeo.agentic.config.TestContributions.appJson;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** What the diagnostics page's report holds, and what it leaves out. */
class DiagnosticsReportTest {

    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-11-27T09:00:00Z"), ZoneOffset.UTC);

    /** The server, as the report sees it, recording every property it is asked for. */
    private static final class Probe implements ServerProbe {

        final Map<String, String> properties = new LinkedHashMap<>();

        final Set<String> facets;

        final Set<String> operations;

        final Path packages;

        final List<String> asked = new ArrayList<>();

        boolean intact = true;

        Probe(Set<String> facets, Set<String> operations, Path packages) {
            this.facets = facets;
            this.operations = operations;
            this.packages = packages;
            properties.put(PRODUCT_NAME_PROPERTY, "Nuxeo Platform");
            properties.put(PRODUCT_VERSION_PROPERTY, "2025.10.18");
        }

        @Override
        public String property(String name) {
            asked.add(name);
            return properties.get(name);
        }

        @Override
        public boolean hasFacet(String name) {
            return facets.contains(name);
        }

        @Override
        public Set<String> operations() {
            return operations;
        }

        @Override
        public Path packagesDirectory() {
            return packages;
        }

        @Override
        public String coreVersion() {
            return "2026.0.2-SNAPSHOT";
        }

        @Override
        public boolean allowListIntact() {
            return intact;
        }

        @Override
        public int allowListSize() {
            return 2;
        }
    }

    private static void write(Path file, String text) throws IOException {
        Files.createDirectories(file.getParent());
        Files.writeString(file, text, StandardCharsets.UTF_8);
    }

    /** A package manager's directory, as Nuxeo writes it: its list and each package's descriptor. */
    private static Path packages(Path root) throws IOException {
        write(root.resolve(".packages"), String.join("\n", "nuxeo-agentic-ui-2026.0.2=started",
                "payers-claims-demo-0.7.0=started", "payers-claims-demo-0.6.1=downloaded",
                "nuxeo-agentic-assets-0.3.0=installed", "nuxeo-web-ui-2025.21.0=started"));
        write(root.resolve("store/nuxeo-agentic-ui-2026.0.2/package.xml"),
                "<package type=\"addon\" name=\"nuxeo-agentic-ui\" version=\"2026.0.2\"/>");
        write(root.resolve("store/payers-claims-demo-0.7.0/package.xml"),
                "<package type=\"addon\" name=\"payers-claims-demo\" version=\"0.7.0\"><dependencies>"
                        + "<package>nuxeo-agentic-ui:2026.0.2</package></dependencies></package>");
        write(root.resolve("store/nuxeo-agentic-assets-0.3.0/package.xml"),
                "<package type=\"addon\" name=\"nuxeo-agentic-assets\" version=\"0.3.0\"/>");
        write(root.resolve("store/nuxeo-web-ui-2025.21.0/package.xml"),
                "<package type=\"addon\" name=\"nuxeo-web-ui\" version=\"2025.21.0\"/>");
        return root;
    }

    /** Made at run time, so that no key-shaped string is committed: 30 characters, letters and digits. */
    private static String tokenShaped() {
        return "q7".repeat(15);
    }

    private static String someonesAddress() {
        return "dana.reyes" + "@" + "claims.example.invalid";
    }

    /**
     * The Payers kit's app with its Claim page, a second app whose queue does not parse, and a
     * manifest fragment from a package: the configuration in force, with one error logged.
     */
    private static ConfigSnapshot snapshot() {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(TestContributions.packagedFragment("bootstrap", "defaults", "{\"applicationTitle\":\"Nuxeo\"}"));
        registry.add(TestContributions.fragment("acme", "manifest", "acme", "{\"labels\":{}}"));
        registry.add(TestContributions.layout("payers", "Claim", "view",
                LayerFixtures.text(LayerFixtures.kitFile(CLAIM_VIEW))));
        Map<String, String> files = new LinkedHashMap<>();
        files.put("actions.json", LayerFixtures.text(LayerFixtures.kit("actions")));
        files.put(LayerFixtures.MY_CLAIMS, LayerFixtures.text(LayerFixtures.kitFile(LayerFixtures.MY_CLAIMS)));
        registry.add(app("payers", APP, appJson(APP, "claims-adjusters"), files));
        Map<String, String> broken = new LinkedHashMap<>();
        broken.put("home.json", "{\"version\":2,\"cards\":[]}");
        broken.put("queues/open.json", "{ not json");
        registry.add(app("facilities", "facilities", appJson("facilities", "members"), broken));
        return ConfigSnapshot.build(registry.resolve());
    }

    private static Map<String, JsonNode> checks(JsonNode report) {
        Map<String, JsonNode> byId = new TreeMap<>();
        report.path("checks").forEach(check -> byId.put(check.path("id").asText(), check));
        return byId;
    }

    private static JsonNode appIn(JsonNode report, String id) {
        for (JsonNode each : report.path("apps")) {
            if (each.path("id").asText().equals(id)) {
                return each;
            }
        }
        throw new AssertionError("no app " + id);
    }

    @Test
    void itNamesThePlatformTheAppAndEachInstalledPackageWithItsVersionAndNoSignatureItCannotBack(
            @TempDir Path root) throws IOException {
        ConfigSnapshot snapshot = snapshot();
        Probe probe = new Probe(Set.of(), Set.of(), packages(root));

        ObjectNode report = DiagnosticsReport.build(snapshot, snapshot.diagnostics(), LayerService.SWITCHED_OFF, false,
                probe, CLOCK);

        assertEquals(DiagnosticsReport.FORMAT, report.path("format").asText());
        assertEquals("2026-11-27T09:00:00Z", report.path("generatedAt").asText());
        assertEquals("Nuxeo Platform", report.path("platform").path("product").asText());
        assertEquals("2025.10.18", report.path("platform").path("version").asText());
        assertEquals("2026.0.2", report.path("app").path("version").asText());
        assertEquals("2026.0.2-SNAPSHOT", report.path("app").path("core").asText());

        JsonNode packages = report.path("packages");
        assertTrue(packages.path("recorded").asBoolean());
        List<String> listed = new ArrayList<>();
        for (JsonNode entry : packages.path("entries")) {
            listed.add(entry.path("name").asText() + " " + entry.path("version").asText() + " "
                    + entry.path("state").asText() + " " + entry.path("role").asText());
            assertEquals(InstalledPackages.SIGNATURE_NOT_RECORDED, entry.path("signature").asText());
        }
        // Installed only, so not the downloaded 0.6.1; sorted by name; the kit known by its dependency.
        assertEquals(List.of("nuxeo-agentic-assets 0.3.0 installed add-on", "nuxeo-agentic-ui 2026.0.2 started app",
                "nuxeo-web-ui 2025.21.0 started add-on", "payers-claims-demo 0.7.0 started kit"), listed);
    }

    /** The exact build is what support needs most: a timestamped version is shown whole, not cleaned. */
    @Test
    void aTimestampedBuildVersionIsShownWhole(@TempDir Path root) throws IOException {
        String build = "2026.0.2-" + "20261126114747" + "-BUILD-local";
        write(root.resolve(".packages"), "nuxeo-agentic-ui-" + build + "=started\n");
        write(root.resolve("store/nuxeo-agentic-ui-" + build + "/package.xml"),
                "<package type=\"addon\" name=\"nuxeo-agentic-ui\" version=\"" + build + "\"/>");
        ConfigSnapshot snapshot = snapshot();

        ObjectNode report = DiagnosticsReport.build(snapshot, snapshot.diagnostics(), LayerService.SWITCHED_OFF, false,
                new Probe(Set.of(), Set.of(), root), CLOCK);

        assertEquals(build, report.path("app").path("version").asText());
        assertEquals(build, report.path("packages").path("entries").get(0).path("version").asText());
    }

    @Test
    void eachCheckSaysWhatTheServerHas(@TempDir Path root) throws IOException {
        ConfigSnapshot snapshot = snapshot();
        Probe none = new Probe(Set.of(), Set.of("Document.Create", "AgenticUi.RunAction"), packages(root));
        Map<String, JsonNode> absent = checks(DiagnosticsReport.build(snapshot, snapshot.diagnostics(),
                LayerService.SWITCHED_OFF, false, none, CLOCK));
        assertEquals("absent", absent.get("retention").path("status").asText());
        assertEquals("absent", absent.get("template-rendering").path("status").asText());
        assertEquals("absent", absent.get("ai").path("status").asText());
        assertEquals("off", absent.get("deployment-layer").path("status").asText());
        assertEquals("off", absent.get("development-overrides").path("status").asText());
        assertEquals("intact", absent.get("operation-allow-list").path("status").asText());
        assertEquals(2, absent.get("operation-allow-list").path("operations").asInt());

        Probe all = new Probe(Set.of(DiagnosticsReport.RETENTION_FACET, DiagnosticsReport.TEMPLATE_FACET),
                Set.of("AI.Summarize", "AI.Chat", "Document.Create"), packages(root));
        all.intact = false;
        LayerService layer = LayerFixtures.service(LayerFixtures.ON_SELF_APPROVAL, new LayerFixtures.MemoryStore());
        Map<String, JsonNode> present = checks(DiagnosticsReport.build(snapshot, snapshot.diagnostics(), layer, true,
                all, CLOCK));
        assertEquals("present", present.get("retention").path("status").asText());
        assertEquals("present", present.get("template-rendering").path("status").asText());
        assertEquals("present", present.get("ai").path("status").asText());
        assertEquals(2, present.get("ai").path("operations").asInt());
        assertEquals("on", present.get("deployment-layer").path("status").asText());
        assertTrue(present.get("deployment-layer").path("selfApproval").asBoolean());
        assertEquals("on", present.get("development-overrides").path("status").asText());
        assertEquals("replaced", present.get("operation-allow-list").path("status").asText());
        assertEquals(0, present.get("operation-allow-list").path("operations").asInt());
    }

    @Test
    void itShowsTheLayersInForceForEachAppAndServerWide(@TempDir Path root) throws IOException {
        ConfigSnapshot snapshot = LayerFixtures.snapshot();
        LayerService layer = LayerFixtures.service(ON, new LayerFixtures.MemoryStore(), () -> snapshot,
                new LayerFixtures.TestClock());
        assertEquals(200, LayerFixtures.publish(layer, CLAIM_VIEW, LayerFixtures.claimViewWith("Live")).status());

        ObjectNode report = DiagnosticsReport.build(snapshot, snapshot.diagnostics(), layer, false,
                new Probe(Set.of(), Set.of(), root), CLOCK);

        JsonNode payers = appIn(report, APP);
        assertEquals("1.0.0", payers.path("packageVersion").asText());
        JsonNode packaged = payers.path("layers").get(0);
        assertEquals("package", packaged.path("layer").asText());
        assertEquals("payers.bundle", packaged.path("bundle").asText());
        assertEquals(List.of("app.json", "actions.json", LayerFixtures.MY_CLAIMS),
                ConfigSnapshot.JSON.convertValue(packaged.path("files"), List.class));
        JsonNode deployment = payers.path("layers").get(1);
        assertEquals("deployment", deployment.path("layer").asText());
        assertTrue(deployment.path("enabled").asBoolean());
        assertEquals(CLAIM_VIEW, deployment.path("files").get(0).path("path").asText());
        assertEquals(1, deployment.path("files").get(0).path("version").asInt());

        // Server-wide: the Claim layout, from its package.
        JsonNode layouts = report.path("configuration").path("layers").get(2);
        assertEquals("layouts", layouts.path("layer").asText());
        assertEquals("Claim", layouts.path("layouts").get(0).path("type").asText());
        assertEquals("payers.bundle", layouts.path("layouts").get(0).path("bundle").asText());
        assertFalse(report.path("configuration").path("builtAt").asText().isEmpty());

        // Who wrote, submitted and approved the live version is not the page's to say.
        String text = report.toString();
        assertFalse(text.contains("\"ada\""), text);
        assertFalse(text.contains("\"ben\""), text);
        assertFalse(text.contains("trail"), text);
        assertFalse(text.contains("claims-adjusters"), "an app's groups are not listed: " + text);
    }

    @Test
    void itListsTheConfigurationsErrorsAndWarningsByAppAndCountsTheRest(@TempDir Path root) throws IOException {
        ConfigSnapshot snapshot = snapshot();
        List<Diagnostic> logged = new ArrayList<>(snapshot.diagnostics());
        logged.add(Diagnostic.info("replaced", "manifest", TestContributions.from("acme"), "acme replaced x."));

        ObjectNode report = DiagnosticsReport.build(snapshot, logged, LayerService.SWITCHED_OFF, false,
                new Probe(Set.of(), Set.of(), root), CLOCK);

        JsonNode diagnostics = report.path("diagnostics");
        assertTrue(diagnostics.size() >= 1, report.toString());
        JsonNode invalid = null;
        for (JsonNode each : diagnostics) {
            assertFalse("info".equals(each.path("level").asText()), "an info is counted, not listed");
            if ("invalid-json".equals(each.path("code").asText())) {
                invalid = each;
            }
        }
        assertTrue(invalid != null, report.toString());
        assertEquals("error", invalid.path("level").asText());
        assertEquals("facilities", invalid.path("app").asText());
        assertEquals("apps/facilities", invalid.path("scope").asText());
        assertTrue(invalid.path("message").asText().contains("queues/open.json"));
        assertEquals("facilities.bundle", invalid.path("bundle").asText());
        assertEquals(1, report.path("diagnosticsOmitted").path("info").asInt());
        assertEquals(0, report.path("diagnosticsOmitted").path("beyondLimit").asInt());
    }

    @Test
    void atMostTheLimitIsListed(@TempDir Path root) {
        ConfigSnapshot snapshot = ConfigSnapshot.build(new ContributionRegistry().resolve());
        List<Diagnostic> many = new ArrayList<>();
        for (int i = 0; i < DiagnosticsReport.MAX_DIAGNOSTICS + 7; i++) {
            many.add(Diagnostic.warning("w", "manifest", TestContributions.from("acme"), "warning " + i));
        }

        ObjectNode report = DiagnosticsReport.build(snapshot, many, LayerService.SWITCHED_OFF, false,
                new Probe(Set.of(), Set.of(), root), CLOCK);

        assertEquals(DiagnosticsReport.MAX_DIAGNOSTICS, report.path("diagnostics").size());
        assertEquals(7, report.path("diagnosticsOmitted").path("beyondLimit").asInt());
    }

    /**
     * No secret and no personal data: a message that quotes an address, a key-shaped string, a URL
     * with a password and a home directory is cleaned before it is written; and no property is read
     * but the ones the report names, so no credential a property holds can reach it.
     */
    @Test
    void noSecretAndNoPersonalDataReachesTheReport(@TempDir Path root) throws IOException {
        ConfigSnapshot snapshot = snapshot();
        Probe probe = new Probe(Set.of(), Set.of(), packages(root));
        probe.properties.put("nuxeo.agentic.connectors.core.credential", tokenShaped());
        String quoted = "could not be read from /home/dreyes/acme.json for " + someonesAddress() + " at https://ops:"
                + tokenShaped() + "@core.example.invalid/api?key=" + tokenShaped() + " with " + tokenShaped();
        List<Diagnostic> logged = new ArrayList<>(snapshot.diagnostics());
        logged.add(Diagnostic.error("unreadable", "apps/facilities", TestContributions.from("facilities"), quoted));

        ObjectNode report = DiagnosticsReport.build(snapshot, logged, LayerService.SWITCHED_OFF, false, probe, CLOCK);

        String text = report.toString();
        assertFalse(text.contains(tokenShaped()), text);
        assertFalse(text.contains(someonesAddress()), text);
        assertFalse(text.contains("dreyes"), text);
        assertFalse(text.contains("ops:"), text);
        assertFalse(text.contains("key="), text);
        assertTrue(text.contains("https://core.example.invalid/api"), text);
        assertTrue(text.contains("/home/[user]/acme.json"), text);
        assertEquals(Set.of(ServerProbe.PRODUCT_NAME_PROPERTY, ServerProbe.PRODUCT_VERSION_PROPERTY),
                Set.copyOf(probe.asked));
    }

    @Test
    void aServerWithNoPackageListSaysSoRatherThanListingNothing(@TempDir Path root) {
        ConfigSnapshot snapshot = snapshot();
        ObjectNode report = DiagnosticsReport.build(snapshot, snapshot.diagnostics(), LayerService.SWITCHED_OFF, false,
                new Probe(Set.of(), Set.of(), null), CLOCK);

        assertFalse(report.path("packages").path("recorded").asBoolean());
        assertEquals("no-directory", report.path("packages").path("problem").asText());
        assertTrue(report.path("app").path("version").isNull());

        ObjectNode empty = DiagnosticsReport.build(snapshot, snapshot.diagnostics(), LayerService.SWITCHED_OFF, false,
                new Probe(Set.of(), Set.of(), root), CLOCK);
        assertEquals("no-list", empty.path("packages").path("problem").asText());
    }
}
