package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.nuxeo.agentic.config.TestContributions.app;
import static org.nuxeo.agentic.config.TestContributions.appJson;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.JsonNode;

/** What the app registry answers each person: the apps their groups may see, and those apps' files. */
class AppRegistryEndpointTest {

    private static final String HOME = "{\n  \"$schema\": \"../home.schema.json\",\n  \"version\": 2,\n  \"cards\": []\n}\n";

    private static final AppRegistryEndpoint.Viewer ADJUSTER = new AppRegistryEndpoint.Viewer("dana",
            Set.of("members", "claims-adjusters"), false);

    private static final AppRegistryEndpoint.Viewer CLERK = new AppRegistryEndpoint.Viewer("sam", Set.of("members"),
            false);

    private static final AppRegistryEndpoint.Viewer ANONYMOUS = new AppRegistryEndpoint.Viewer("Anonymous", Set.of(),
            false);

    private static final AppRegistryEndpoint.Viewer ADMINISTRATOR = new AppRegistryEndpoint.Viewer("Administrator",
            Set.of("administrators"), true);

    private static Map<String, String> files(String... pathsAndBodies) {
        Map<String, String> files = new LinkedHashMap<>();
        for (int i = 0; i < pathsAndBodies.length; i += 2) {
            files.put(pathsAndBodies[i], pathsAndBodies[i + 1]);
        }
        return files;
    }

    private static AppRegistryEndpoint endpoint(Contribution... contributions) {
        ContributionRegistry registry = new ContributionRegistry();
        for (Contribution contribution : contributions) {
            registry.add(contribution);
        }
        return new AppRegistryEndpoint(ConfigSnapshot.build(registry.resolve()));
    }

    /** Two apps, as two packages contribute them: claims for its adjusters, the directory for everyone. */
    private static AppRegistryEndpoint twoApps() {
        return endpoint(
                app("payers", "payers-claims", appJson("payers-claims", "claims-adjusters", "claims-supervisors"),
                        files("home.json", HOME, "navigation.json", "{\"version\":2,\"entries\":[]}",
                                "queues/unassigned-claims.json", "{\"version\":2}")),
                app("directory", "staff-directory", appJson("staff-directory", "members"),
                        files("home.json", "{\"version\":2,\"cards\":[{\"id\":\"x\"}]}")));
    }

    private static JsonNode body(AppRegistryEndpoint.Response response) throws Exception {
        return ConfigSnapshot.JSON.readTree(response.body());
    }

    private static List<String> ids(JsonNode listing) {
        List<String> ids = new ArrayList<>();
        listing.get("apps").forEach(app -> ids.add(app.get("id").asText()));
        return ids;
    }

    @Test
    void listsTheAppsWhoseGroupsThePersonIsInInContributionOrder() throws Exception {
        AppRegistryEndpoint endpoint = twoApps();

        AppRegistryEndpoint.Response response = endpoint.respond("/apps.json", ADJUSTER, null);
        assertEquals(200, response.status());
        assertEquals("application/json; charset=utf-8", response.headers().get("Content-Type"));
        JsonNode listing = body(response);
        assertEquals("nuxeo-agentic-ui-config/1", listing.get("format").asText());
        assertEquals("apps", listing.get("layer").asText());
        assertEquals(List.of("payers-claims", "staff-directory"), ids(listing));

        JsonNode claims = listing.at("/apps/0");
        assertEquals("apps/payers-claims/", claims.get("url").asText());
        assertEquals("payers", claims.get("component").asText());
        assertEquals("payers.bundle", claims.get("bundle").asText());
        assertEquals("agentic-ui-config/app.json", claims.get("source").asText());
        assertEquals(List.of("app.json", "home.json", "navigation.json", "queues/unassigned-claims.json"),
                ConfigSnapshot.JSON.convertValue(claims.get("files"), List.class));
        assertEquals("payers-claims", claims.at("/content/id").asText());
        assertEquals("claims-adjusters", claims.at("/content/groups/0").asText());
        assertEquals(0, listing.get("diagnostics").size());
    }

    @Test
    void someoneInNoneOfAnAppsGroupsIsNotShownIt() throws Exception {
        AppRegistryEndpoint endpoint = twoApps();

        assertEquals(List.of("staff-directory"), ids(body(endpoint.respond("/apps.json", CLERK, null))));
        // Anonymous is in no group, not even members: an anonymous visitor is not "everyone signed in".
        assertEquals(List.of(), ids(body(endpoint.respond("/apps.json", ANONYMOUS, null))));
        // An administrator is shown what their groups give them, like anyone: no app is everyone's
        // by being an administrator's.
        assertEquals(List.of(), ids(body(endpoint.respond("/apps.json", ADMINISTRATOR, null))));
    }

    @Test
    void servesEachFileOfAnAppThePersonMaySeeAsThePackageWroteIt() {
        AppRegistryEndpoint endpoint = twoApps();

        AppRegistryEndpoint.Response home = endpoint.respond("/apps/payers-claims/home.json", ADJUSTER, null);
        assertEquals(200, home.status());
        // Byte for byte, `$schema` and layout included: no envelope, as the development server serves it.
        assertArrayEquals(HOME.getBytes(StandardCharsets.UTF_8), home.body());
        assertEquals("application/json; charset=utf-8", home.headers().get("Content-Type"));

        AppRegistryEndpoint.Response appJson = endpoint.respond("/apps/payers-claims/app.json", ADJUSTER, null);
        assertEquals(200, appJson.status());
        assertEquals(appJson("payers-claims", "claims-adjusters", "claims-supervisors"),
                new String(appJson.body(), StandardCharsets.UTF_8));
        assertEquals(200, endpoint.respond("/apps/payers-claims/queues/unassigned-claims.json", ADJUSTER, null).status());
    }

    private static final String ENGLISH = "{\"$schema\":\"../../labels.schema.json\",\"version\":2,\"labels\":{"
            + "\"payers.app.claims\":\"Claims\",\"payers.queue.mine\":\"My claims\",\"payers.queue.open\":\"Open\"}}";

    /** Claims, with English and the Spanish and Swedish files the pipeline accepts: subsets of English. */
    private static AppRegistryEndpoint translated(String spanish) {
        return endpoint(app("payers", "payers-claims", appJson("payers-claims", "claims-adjusters"),
                files("labels/en.json", ENGLISH, "labels/es.json", spanish, "labels/sv.json",
                        "{\"version\":2,\"labels\":{\"payers.queue.mine\":\"Mina ärenden\"}}")));
    }

    private static Map<String, String> labels(AppRegistryEndpoint.Response response) throws Exception {
        assertEquals(200, response.status());
        return ConfigSnapshot.JSON.convertValue(body(response).get("labels"), Map.class);
    }

    @Test
    void servesALanguagesLabelsOverEnglishKeyByKey() throws Exception {
        AppRegistryEndpoint endpoint = translated(
                "{\"$schema\":\"../../labels.schema.json\",\"version\":2,\"labels\":{\"payers.app.claims\":\"Reclamaciones\"}}");

        AppRegistryEndpoint.Response spanish = endpoint.respond("/apps/payers-claims/labels/es.json", ADJUSTER, null);
        // The language's text where it gives one, English for every key it leaves out, in English's order.
        assertEquals(List.of("payers.app.claims", "payers.queue.mine", "payers.queue.open"),
                new ArrayList<>(labels(spanish).keySet()));
        assertEquals(Map.of("payers.app.claims", "Reclamaciones", "payers.queue.mine", "My claims",
                "payers.queue.open", "Open"), labels(spanish));
        // Still a version 2 labels file, with the language's own `$schema`.
        assertEquals(2, body(spanish).get("version").asInt());
        assertEquals("../../labels.schema.json", body(spanish).get("$schema").asText());

        assertEquals(Map.of("payers.app.claims", "Claims", "payers.queue.mine", "Mina ärenden", "payers.queue.open",
                "Open"), labels(endpoint.respond("/apps/payers-claims/labels/sv.json", ADJUSTER, null)));
    }

    @Test
    void servesEnglishAsThePackageWroteItAndNoLanguageItLacks() throws Exception {
        AppRegistryEndpoint endpoint = translated("{\"version\":2,\"labels\":{}}");

        AppRegistryEndpoint.Response english = endpoint.respond("/apps/payers-claims/labels/en.json", ADJUSTER, null);
        assertArrayEquals(ENGLISH.getBytes(StandardCharsets.UTF_8), english.body());
        // A language the package has no file for is not invented: the app asks only for a language
        // the listing names, and the listing names only the package's files.
        assertEquals(404, endpoint.respond("/apps/payers-claims/labels/fi.json", ADJUSTER, null).status());
        assertEquals(List.of("app.json", "labels/en.json", "labels/es.json", "labels/sv.json"),
                ConfigSnapshot.JSON.convertValue(body(endpoint.respond("/apps.json", ADJUSTER, null)).at("/apps/0/files"),
                        List.class));
        // An empty Spanish file is English throughout.
        assertEquals(Map.of("payers.app.claims", "Claims", "payers.queue.mine", "My claims", "payers.queue.open",
                "Open"), labels(endpoint.respond("/apps/payers-claims/labels/es.json", ADJUSTER, null)));
        // And someone who may not see the app is told nothing about it, in any language.
        assertEquals(404, endpoint.respond("/apps/payers-claims/labels/es.json", CLERK, null).status());
    }

    @Test
    void aTextThatIsNotOneFallsBackToEnglishAndAKeyEnglishLacksIsKeptForTheAppToJudge() throws Exception {
        AppRegistryEndpoint endpoint = translated("{\"version\":2,\"labels\":{\"payers.app.claims\":\"  \","
                + "\"payers.queue.mine\":7,\"payers.only.spanish\":\"Solo\"}}");

        Map<String, String> spanish = labels(endpoint.respond("/apps/payers-claims/labels/es.json", ADJUSTER, null));
        assertEquals("Claims", spanish.get("payers.app.claims"));
        assertEquals("My claims", spanish.get("payers.queue.mine"));
        assertEquals("Solo", spanish.get("payers.only.spanish"));
    }

    @Test
    void aLanguageFileThatIsNotAVersion2LabelsFileIsServedAsWritten() {
        String notLabels = "{\"version\":1,\"labels\":{\"payers.app.claims\":\"Reclamaciones\"}}";
        AppRegistryEndpoint endpoint = translated(notLabels);

        assertArrayEquals(notLabels.getBytes(StandardCharsets.UTF_8),
                endpoint.respond("/apps/payers-claims/labels/es.json", ADJUSTER, null).body());
        // With no English to fall back to, a language is served as written too.
        String alone = "{\"version\":2,\"labels\":{\"x.y\":\"Z\"}}";
        AppRegistryEndpoint noEnglish = endpoint(app("payers", "payers-claims",
                appJson("payers-claims", "claims-adjusters"), files("labels/es.json", alone)));
        assertArrayEquals(alone.getBytes(StandardCharsets.UTF_8),
                noEnglish.respond("/apps/payers-claims/labels/es.json", ADJUSTER, null).body());
    }

    @Test
    void anAppThePersonMayNotSeeIsNotFoundRatherThanForbidden() {
        AppRegistryEndpoint endpoint = twoApps();

        for (String path : List.of("/apps/payers-claims/home.json", "/apps/payers-claims/app.json")) {
            AppRegistryEndpoint.Response response = endpoint.respond(path, CLERK, null);
            assertEquals(404, response.status(), path);
            assertEquals(0, response.body().length);
        }
        assertEquals(404, endpoint.respond("/apps/payers-claims/home.json", ANONYMOUS, null).status());
        assertEquals(404, endpoint.respond("/apps/payers-claims/home.json", ADMINISTRATOR, null).status());
    }

    @Test
    void anythingButTheListingAndAListedFileIsNotFound() {
        AppRegistryEndpoint endpoint = twoApps();

        for (String path : new String[] { null, "", "/", "/apps", "/apps/", "/apps/payers-claims",
                "/apps/payers-claims/", "/apps/payers-claims/actions.json", "/apps/payers-claims/labels/en.json",
                "/apps/payers-claims/../staff-directory/home.json", "/apps/payers-claims//home.json",
                "/apps/payers-claims/home.json/", "/apps/payers-claims/HOME.json", "/apps/unknown/home.json",
                "/apps.json/", "/bootstrap.json", "/home.json", "/apps//home.json" }) {
            assertEquals(404, endpoint.respond(path, ADJUSTER, null).status(), String.valueOf(path));
        }
    }

    @Test
    void everyResponseIsPrivateToThePersonItWasFor() {
        AppRegistryEndpoint endpoint = twoApps();

        for (String path : List.of("/apps.json", "/apps/payers-claims/home.json", "/apps/unknown/home.json")) {
            Map<String, String> headers = endpoint.respond(path, ADJUSTER, null).headers();
            assertEquals("private, no-cache", headers.get("Cache-Control"), path);
            assertEquals("nosniff", headers.get("X-Content-Type-Options"), path);
        }
        Map<String, String> listing = endpoint.respond("/apps.json", ADJUSTER, null).headers();
        assertEquals("Cookie, Authorization", listing.get("Vary"));
        assertEquals(ConfigEndpoint.CONTENT_SECURITY_POLICY, listing.get("Content-Security-Policy"));
    }

    @Test
    void anUnchangedListingOrFileRevalidatesTo304AndAnotherPersonsListingDoesNot() {
        AppRegistryEndpoint endpoint = twoApps();

        String listing = endpoint.respond("/apps.json", ADJUSTER, null).headers().get("ETag");
        AppRegistryEndpoint.Response again = endpoint.respond("/apps.json", ADJUSTER, listing);
        assertEquals(304, again.status());
        assertEquals(0, again.body().length);
        assertEquals(listing, again.headers().get("ETag"));
        // Another person's list is another body, so the first person's tag does not match it.
        assertEquals(200, endpoint.respond("/apps.json", CLERK, listing).status());

        String home = endpoint.respond("/apps/payers-claims/home.json", ADJUSTER, null).headers().get("ETag");
        assertEquals(304, endpoint.respond("/apps/payers-claims/home.json", ADJUSTER, "W/" + home).status());
        assertEquals(200, endpoint.respond("/apps/payers-claims/home.json", ADJUSTER, "\"other\"").status());
    }

    @Test
    void anAppsDiagnosticsAreShownToThoseWhoSeeItAndEveryOneToAnAdministrator() throws Exception {
        AppRegistryEndpoint endpoint = endpoint(
                app("payers", "payers-claims", "agentic-ui-config/app.json",
                        appJson("payers-claims", "claims-adjusters"), List.of("queues/missing.json"), Map.of()),
                app("directory", "staff-directory", appJson("staff-directory", "members"),
                        files("home.json", "{ broken")),
                app("broken", "refused", "{\"id\":\"refused\"}", files()),
                app("broken", "Not-An-Id", appJson("Not-An-Id", "members"), files()));

        JsonNode adjuster = body(endpoint.respond("/apps.json", ADJUSTER, null)).get("diagnostics");
        List<String> seen = new ArrayList<>();
        adjuster.forEach(diagnostic -> seen.add(diagnostic.get("app").asText() + ":" + diagnostic.get("code").asText()));
        assertEquals(List.of("payers-claims:unreadable", "staff-directory:invalid-json"), seen);
        assertEquals("error", adjuster.get(0).get("level").asText());
        assertEquals("agentic-ui-config/queues/missing.json", adjuster.get(0).get("source").asText());

        JsonNode clerk = body(endpoint.respond("/apps.json", CLERK, null)).get("diagnostics");
        assertEquals(1, clerk.size());
        assertEquals("staff-directory", clerk.get(0).get("app").asText());

        // A refused app is shown to no one, so only an administrator is told why.
        JsonNode administrator = body(endpoint.respond("/apps.json", ADMINISTRATOR, null)).get("diagnostics");
        List<String> codes = new ArrayList<>();
        administrator.forEach(diagnostic -> codes.add(diagnostic.get("code").asText()));
        assertEquals(List.of("unreadable", "invalid-json", "app-groups", "invalid-contribution"), codes);
        assertFalse(administrator.get(3).has("app"), "an id that is not one is not reported as an app");
    }

    @Test
    void theConfigurationsOwnDiagnosticsAreNotTheRegistrys() throws Exception {
        AppRegistryEndpoint endpoint = endpoint(TestContributions.fragment("acme", "bootstrap", "acme", "{ broken"),
                app("directory", "staff-directory", appJson("staff-directory", "members"), files()));

        JsonNode diagnostics = body(endpoint.respond("/apps.json", ADMINISTRATOR, null)).get("diagnostics");

        assertEquals(0, diagnostics.size());
        assertTrue(endpoint.snapshot().diagnostics().stream().anyMatch(d -> d.code().equals("invalid-json")));
    }

    /**
     * A version another package has since replaced may have been for other groups, and its
     * diagnostics name its files: only the version in force's are shown with the app, and an
     * administrator still sees both.
     */
    @Test
    void aReplacedVersionsDiagnosticsAreNotShownToTheNewVersionsGroups() throws Exception {
        AppRegistryEndpoint endpoint = endpoint(
                app("hr", "payroll", "agentic-ui-config/app.json", appJson("payroll", "hr"),
                        List.of("queues/salaries-by-person.json"), Map.of()),
                app("acme", "payroll", appJson("payroll", "members"), files("home.json", "{ broken")));

        JsonNode clerk = body(endpoint.respond("/apps.json", CLERK, null)).get("diagnostics");
        List<String> seen = new ArrayList<>();
        clerk.forEach(diagnostic -> seen.add(diagnostic.get("component").asText() + ":" + diagnostic.get("code").asText()));
        assertEquals(List.of("acme:invalid-json", "acme:replaced"), seen);
        assertFalse(clerk.toString().contains("salaries-by-person"), clerk.toString());

        JsonNode administrator = body(endpoint.respond("/apps.json", ADMINISTRATOR, null)).get("diagnostics");
        assertTrue(administrator.toString().contains("salaries-by-person"));
    }

    @Test
    void aRevalidatedFileIsAsPrivateAsTheFirstAnswer() {
        AppRegistryEndpoint endpoint = twoApps();
        String etag = endpoint.respond("/apps/payers-claims/home.json", ADJUSTER, null).headers().get("ETag");

        AppRegistryEndpoint.Response again = endpoint.respond("/apps/payers-claims/home.json", ADJUSTER, etag);

        assertEquals(304, again.status());
        assertEquals("private, no-cache", again.headers().get("Cache-Control"));
        assertEquals(ConfigEndpoint.CONTENT_SECURITY_POLICY, again.headers().get("Content-Security-Policy"));
        // And someone who may not see the app is not told it is unchanged.
        assertEquals(404, endpoint.respond("/apps/payers-claims/home.json", CLERK, etag).status());
    }
}
