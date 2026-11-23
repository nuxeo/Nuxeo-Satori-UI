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
}
