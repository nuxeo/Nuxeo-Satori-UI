package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.nuxeo.agentic.config.TestContributions.app;
import static org.nuxeo.agentic.config.TestContributions.appJson;
import static org.nuxeo.agentic.config.TestContributions.disabledApp;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * An app's contribution, as the registry reads it: which apps are in force, in what order, with
 * which files, and what is refused.
 */
class AppContributionTest {

    private static final String HOME = "{\"version\":2,\"cards\":[]}";

    private static ConfigSnapshot build(Contribution... contributions) {
        ContributionRegistry registry = new ContributionRegistry();
        for (Contribution contribution : contributions) {
            registry.add(contribution);
        }
        return ConfigSnapshot.build(registry.resolve());
    }

    private static List<String> codes(ConfigSnapshot snapshot) {
        return snapshot.diagnostics().stream().map(Diagnostic::code).toList();
    }

    private static Map<String, String> files(String... pathsAndBodies) {
        Map<String, String> files = new LinkedHashMap<>();
        for (int i = 0; i < pathsAndBodies.length; i += 2) {
            files.put(pathsAndBodies[i], pathsAndBodies[i + 1]);
        }
        return files;
    }

    @Test
    void readsAnAppWholeWithItsFilesInTheOrderTheContributionNamesThem() {
        ConfigSnapshot snapshot = build(app("acme", "payers-claims", appJson("payers-claims", "claims-adjusters"),
                files("navigation.json", "{\"version\":2,\"entries\":[]}", "home.json", HOME,
                        "queues/unassigned-claims.json", "{\"version\":2}", "labels/pt-BR.json", "{\"version\":2}",
                        "tasks/claimReview.determine.layout.json", "{\"version\":2}", "actions.json",
                        "{\"version\":2}")));

        assertEquals(1, snapshot.apps().size());
        ConfigSnapshot.App app = snapshot.apps().get(0);
        assertEquals("payers-claims", app.id());
        assertEquals(Set.of("claims-adjusters"), app.groups());
        assertEquals(List.of("navigation.json", "home.json", "queues/unassigned-claims.json", "labels/pt-BR.json",
                "tasks/claimReview.determine.layout.json", "actions.json"), List.copyOf(app.files().keySet()));
        assertEquals("agentic-ui-config/home.json", app.files().get("home.json").source());
        assertEquals(HOME, new String(app.files().get("home.json").bytes()));
        assertTrue(snapshot.diagnostics().isEmpty(), snapshot.diagnostics().toString());
    }

    @Test
    void anAppIsNeitherAFragmentNorALayoutNorAnAsset() {
        ConfigSnapshot snapshot = build(app("acme", "payers-claims", appJson("payers-claims", "members"),
                files("home.json", HOME)));

        assertTrue(snapshot.fragments(ConfigScope.BOOTSTRAP).isEmpty());
        assertTrue(snapshot.fragments(ConfigScope.MANIFEST).isEmpty());
        assertTrue(snapshot.layouts().isEmpty());
        assertTrue(snapshot.assets().isEmpty());
    }

    @Test
    void aLaterAppWithTheSameIdReplacesItWholeInPlace() {
        ConfigSnapshot snapshot = build(
                app("ours", "claims", appJson("claims", "members"), files("home.json", HOME, "navigation.json", "{}")),
                app("ours", "cases", appJson("cases", "members"), files()),
                app("acme", "claims", appJson("claims", "claims-adjusters"), files("home.json", HOME)));

        assertEquals(List.of("claims", "cases"), snapshot.apps().stream().map(ConfigSnapshot.App::id).toList());
        ConfigSnapshot.App claims = snapshot.apps().get(0);
        assertEquals("acme", claims.provenance().component());
        assertEquals(Set.of("claims-adjusters"), claims.groups());
        // Whole: the replacement names no menu, so the app has none, rather than the one it replaced.
        assertEquals(Set.of("home.json"), claims.files().keySet());
        assertEquals(List.of("replaced"), codes(snapshot));
        assertEquals("apps/claims", snapshot.diagnostics().get(0).scope());
    }

    @Test
    void aDisabledAppRemovesTheOneInForce() {
        ConfigSnapshot snapshot = build(app("ours", "claims", appJson("claims", "members"), files()),
                disabledApp("acme", "claims"), disabledApp("acme", "never-contributed"));

        assertTrue(snapshot.apps().isEmpty());
        assertEquals(List.of("removed", "disabled-nothing"), codes(snapshot));
        assertTrue(snapshot.diagnostics().get(1).message().contains("no earlier contribution has that id"),
                snapshot.diagnostics().get(1).message());
    }

    @Test
    void anAppJsonThatNamesAnotherAppRefusesItAndTheOneItWouldReplaceStays() {
        ConfigSnapshot snapshot = build(app("ours", "claims", appJson("claims", "members"), files("home.json", HOME)),
                app("acme", "claims", appJson("cases", "members"), files()));

        assertEquals(1, snapshot.apps().size());
        assertEquals("ours", snapshot.apps().get(0).provenance().component());
        assertEquals(List.of("app-id-mismatch", "kept"), codes(snapshot));
        assertTrue(snapshot.diagnostics().get(0).message().contains("\"cases\""));
    }

    @ParameterizedTest
    @ValueSource(strings = { "{\"version\":2,\"id\":\"claims\"}", "{\"version\":2,\"id\":\"claims\",\"groups\":[]}",
            "{\"version\":2,\"id\":\"claims\",\"groups\":\"members\"}",
            "{\"version\":2,\"id\":\"claims\",\"groups\":[\"members\",3]}",
            "{\"version\":2,\"id\":\"claims\",\"groups\":[\" members\"]}",
            "{\"version\":2,\"id\":\"claims\",\"groups\":[\"\"]}" })
    void anAppJsonThatNamesNoGroupsRefusesTheApp(String appJson) {
        // The registry serves an app to its groups. With none it could only serve it to everyone or
        // no one, and the first is not what anybody wrote.
        ConfigSnapshot snapshot = build(app("acme", "claims", appJson, files("home.json", HOME)));

        assertTrue(snapshot.apps().isEmpty());
        assertEquals(List.of("app-groups"), codes(snapshot));
    }

    @ParameterizedTest
    @ValueSource(strings = { "{ \"id\": ", "[]", "{\"id\":\"claims\",\"id\":\"claims\",\"groups\":[\"members\"]}" })
    void anAppJsonThatDoesNotParseAsAnObjectRefusesTheApp(String appJson) {
        ConfigSnapshot snapshot = build(app("acme", "claims", appJson, files()));

        assertTrue(snapshot.apps().isEmpty());
        assertEquals(1, snapshot.diagnostics().size());
        assertTrue(Set.of("invalid-json", "not-an-object").contains(codes(snapshot).get(0)), codes(snapshot).toString());
    }

    @Test
    void anAppJsonOverTheFragmentLimitRefusesTheApp() {
        String padding = " ".repeat(ConfigSnapshot.MAX_JSON_BYTES);
        ConfigSnapshot snapshot = build(app("acme", "claims", appJson("claims", "members") + padding, files()));

        assertTrue(snapshot.apps().isEmpty());
        assertEquals(List.of("too-large"), codes(snapshot));
    }

    @Test
    void aFileThatCannotBeUsedIsLeftOutOnItsOwnAndTheAppIsStillServed() {
        String large = "{\"version\":2,\"cards\":[]," + "\"x\":\"" + "a".repeat(ConfigSnapshot.MAX_JSON_BYTES) + "\"}";
        Map<String, String> bodies = files("home.json", "{ \"version\": ", "navigation.json", "[1]",
                "queues/big.json", large, "queues/open.json", "{\"version\":2}", "labels/en.json",
                "{\"labels\":{},\"labels\":{}}");
        List<String> paths = new ArrayList<>(bodies.keySet());
        paths.add("queues/missing.json");
        ConfigSnapshot snapshot = build(
                app("acme", "claims", "agentic-ui-config/app.json", appJson("claims", "members"), paths, bodies));

        assertEquals(1, snapshot.apps().size());
        assertEquals(Set.of("queues/open.json"), snapshot.apps().get(0).files().keySet());
        assertEquals(List.of("invalid-json", "not-an-object", "too-large", "invalid-json", "unreadable"),
                codes(snapshot));
        assertTrue(snapshot.diagnostics().stream().allMatch(d -> d.scope().equals("apps/claims")));
        assertTrue(snapshot.diagnostics().get(4).message().contains("agentic-ui-config/queues/missing.json"),
                snapshot.diagnostics().get(4).message());
    }

    @ParameterizedTest
    @ValueSource(strings = { "app.json", "layouts/Claim/view.layout.json", "bootstrap.json", "manifest.json",
            "modules/cases.json", "assets/logo.svg", "queues/../app.json", "../home.json", "/home.json",
            "queues\\open.json", "queues/open.JSON", "queues/.hidden.json", "queues/a/b.json", "labels/EN.json",
            "labels/en_US.json", "tasks/claimReview.layout.json", "tasks/1review.step.layout.json", "home.json ",
            "Home.json", "" })
    void aFileAtNoPlaceOfAnAppDefinitionIsLeftOut(String path) {
        ConfigSnapshot snapshot = build(app("acme", "claims", "agentic-ui-config/app.json",
                appJson("claims", "members"), List.of(path), Map.of(path, "{}")));

        assertEquals(1, snapshot.apps().size());
        assertTrue(snapshot.apps().get(0).files().isEmpty());
        assertEquals(List.of("invalid-app-file"), codes(snapshot));
    }

    @Test
    void aFileNamedTwiceIsReadOnce() {
        ConfigSnapshot snapshot = build(app("acme", "claims", "agentic-ui-config/app.json",
                appJson("claims", "members"), List.of("home.json", "home.json"), Map.of("home.json", HOME)));

        assertEquals(Set.of("home.json"), snapshot.apps().get(0).files().keySet());
        assertEquals(List.of("duplicate-app-file"), codes(snapshot));
    }

    @ParameterizedTest
    @ValueSource(strings = { "../app.json", "agentic-ui-config/../app.json", "/agentic-ui-config/app.json",
            "agentic-ui-config/./app.json", "agentic-ui-config/.config/app.json", "agentic-ui-config\\app.json",
            "agentic-ui-config/home.json", "agentic-ui-config/app.json/", "agentic-ui-config/APP.json" })
    void anAppWhoseSrcIsNotItsAppJsonInsideItsBundleIsRefused(String src) {
        ConfigSnapshot snapshot = build(
                app("acme", "claims", src, appJson("claims", "members"), List.of("home.json"), Map.of("home.json", HOME)));

        assertTrue(snapshot.apps().isEmpty());
        assertEquals(List.of("invalid-contribution"), codes(snapshot));
        assertTrue(snapshot.diagnostics().get(0).message().contains("app.json"));
    }

    @ParameterizedTest
    @ValueSource(strings = { "app.json", "payers/app.json", "apps/payers-claims/agentic-ui-config/app.json" })
    void anAppJsonAnywhereInItsBundleIsAccepted(String src) {
        ConfigSnapshot snapshot = build(app("acme", "claims", src, appJson("claims", "members"), List.of(), Map.of()));

        assertEquals(1, snapshot.apps().size());
        assertTrue(snapshot.diagnostics().isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = { "Claims", "1claims", "claims_app", "-claims", "claims.app" })
    void anAppWhoseIdIsNotAnAppIdIsRefusedAndReportedToNoOneApp(String id) {
        ConfigSnapshot snapshot = build(app("acme", id, appJson(id, "members"), files()));

        assertTrue(snapshot.apps().isEmpty());
        assertEquals(List.of("invalid-contribution"), codes(snapshot));
        // Not "apps/<id>": an id that is not one never becomes a scope.
        assertEquals(ConfigScope.APPS, snapshot.diagnostics().get(0).scope());
    }

    @Test
    void anAppWithNoSrcIsRefused() {
        Contribution noSrc = Contribution.app("claims", true, new Provenance("acme", "acme.bundle", Provenance.INLINE),
                null, List.of(), null, new Object());

        ConfigSnapshot snapshot = build(noSrc);

        assertTrue(snapshot.apps().isEmpty());
        assertTrue(snapshot.diagnostics().get(0).message().contains("has no src"));
    }

    @Test
    void anAppThatNamesMoreFilesThanTheLimitIsRefused() {
        List<String> paths = new ArrayList<>();
        for (int i = 0; i <= ContributionRegistry.MAX_APP_FILES; i++) {
            paths.add("queues/q" + i + ".json");
        }
        ConfigSnapshot snapshot = build(app("acme", "claims", "agentic-ui-config/app.json",
                appJson("claims", "members"), paths, Map.of()));

        assertTrue(snapshot.apps().isEmpty());
        assertEquals(List.of("invalid-contribution"), codes(snapshot));
        assertTrue(snapshot.diagnostics().get(0).message().contains("the limit is 256"));
    }

    @Test
    void anAppAtTheFileLimitIsServed() {
        List<String> paths = new ArrayList<>();
        Map<String, String> bodies = new LinkedHashMap<>();
        for (int i = 0; i < ContributionRegistry.MAX_APP_FILES; i++) {
            paths.add("queues/q" + i + ".json");
            bodies.put("queues/q" + i + ".json", "{}");
        }
        ConfigSnapshot snapshot = build(
                app("acme", "claims", "agentic-ui-config/app.json", appJson("claims", "members"), paths, bodies));

        assertEquals(ContributionRegistry.MAX_APP_FILES, snapshot.apps().get(0).files().size());
    }

    @Test
    void anAppsDiagnosticsAreInNoResponseTheConfigurationServletServes() {
        ConfigSnapshot snapshot = build(app("acme", "claims", "agentic-ui-config/app.json",
                appJson("claims", "secret-group"), List.of("queues/missing.json"), Map.of()));
        ConfigEndpoint endpoint = new ConfigEndpoint(snapshot);

        assertFalse(snapshot.diagnostics().isEmpty());
        for (String path : List.of("/bootstrap.json", "/manifest.json", "/layouts.json")) {
            String body = new String(endpoint.respond(path, null).body());
            assertFalse(body.contains("claims"), path + ": " + body);
            assertFalse(body.contains("secret-group"), path + ": " + body);
        }
    }

    @Test
    void theAnonymousConfigurationServletServesNoAppFile() {
        ConfigSnapshot snapshot = build(
                app("acme", "claims", appJson("claims", "members"), files("home.json", HOME, "navigation.json", "{}")));
        ConfigEndpoint endpoint = new ConfigEndpoint(snapshot);

        for (String path : List.of("/home.json", "/navigation.json", "/app.json", "/apps.json",
                "/apps/claims/home.json", "/claims/home.json", "/agentic-ui-config/home.json")) {
            assertEquals(404, endpoint.respond(path, null).status(), path);
        }
        assertNull(endpoint.respond("/apps.json", null).headers().get("Content-Type"));
    }
}
