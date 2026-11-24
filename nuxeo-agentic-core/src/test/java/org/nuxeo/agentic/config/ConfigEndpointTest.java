package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.nuxeo.agentic.config.TestContributions.fragment;
import static org.nuxeo.agentic.config.TestContributions.layout;

import java.nio.charset.StandardCharsets;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.JsonNode;

class ConfigEndpointTest {

    private static final byte[] SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\"/>".getBytes(StandardCharsets.UTF_8);

    private static ConfigSnapshot snapshot(String acmeTitle) {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(fragment("ours", "bootstrap", "defaults", "{\"branding\":{\"applicationTitle\":\"Hyland Nuxeo\"}}"));
        registry.add(fragment("ours", "manifest", "defaults", "{\"version\":1}"));
        registry.add(fragment("acme", "bootstrap", "acme",
                "{\"branding\":{\"applicationTitle\":\"" + acmeTitle + "\",\"logo\":{\"src\":\"assets/acme-logo.svg\"}}}"));
        registry.add(fragment("acme", "manifest", "acme", "{\"labels\":{\"app.navbar.browse\":\"Contracts\"}}"));
        registry.add(layout("acme", "Contract", "view", "{\"rows\":[]}"));
        registry.add(TestContributions.asset("acme", "acme-logo.svg", SVG));
        return ConfigSnapshot.build(registry.resolve());
    }

    private static JsonNode body(ConfigEndpoint.Response response) throws Exception {
        return ConfigSnapshot.JSON.readTree(response.body());
    }

    @Test
    void servesTheBootstrapFragmentsInOrderWithProvenance() throws Exception {
        ConfigEndpoint.Response response = new ConfigEndpoint(snapshot("Acme")).respond("/bootstrap.json",
                null);

        assertEquals(200, response.status());
        assertEquals("application/json; charset=utf-8", response.headers().get("Content-Type"));
        JsonNode envelope = body(response);
        assertEquals("nuxeo-agentic-ui-config/1", envelope.get("format").asText());
        assertEquals("bootstrap", envelope.get("layer").asText());
        JsonNode fragments = envelope.get("fragments");
        assertEquals(2, fragments.size());
        assertEquals("defaults", fragments.get(0).get("name").asText());
        assertEquals("ours", fragments.get(0).get("component").asText());
        assertEquals("acme", fragments.get(1).get("component").asText());
        assertEquals("acme.bundle", fragments.get(1).get("bundle").asText());
        assertEquals("agentic-ui-config/acme.json", fragments.get(1).get("source").asText());
        assertEquals("Acme", fragments.get(1).at("/content/branding/applicationTitle").asText());
        assertEquals("assets/acme-logo.svg", envelope.at("/assets/0/url").asText());
        assertEquals(0, envelope.get("diagnostics").size());
    }

    @Test
    void servesTheManifestFragmentsWithoutBootstrapContent() throws Exception {
        JsonNode envelope = body(new ConfigEndpoint(snapshot("Acme")).respond("/manifest.json", null));

        assertEquals("manifest", envelope.get("layer").asText());
        assertEquals(2, envelope.get("fragments").size());
        assertEquals("Contracts", envelope.at("/fragments/1/content/labels/app.navbar.browse").asText());
        assertFalse(envelope.has("assets"));
        assertFalse(envelope.toString().contains("applicationTitle"));
    }

    @Test
    void servesTheLayoutIndexAndEachLayoutFile() throws Exception {
        ConfigEndpoint endpoint = new ConfigEndpoint(snapshot("Acme"));

        JsonNode index = body(endpoint.respond("/layouts.json", null));
        assertEquals("layouts/Contract/view.layout.json", index.at("/layouts/0/url").asText());
        assertEquals("acme", index.at("/layouts/0/component").asText());

        JsonNode file = body(endpoint.respond("/layouts/Contract/view.layout.json", null));
        assertEquals("layout", file.get("layer").asText());
        assertTrue(file.at("/content/rows").isArray());

        assertEquals(404, endpoint.respond("/layouts/Contract/edit.layout.json", null).status());
    }

    @Test
    void servesAssetsAsImagesThatCannotRunScript() {
        ConfigEndpoint.Response response = new ConfigEndpoint(snapshot("Acme")).respond(
                "/assets/acme-logo.svg", null);

        assertEquals(200, response.status());
        assertEquals("image/svg+xml", response.headers().get("Content-Type"));
        assertEquals("nosniff", response.headers().get("X-Content-Type-Options"));
        assertTrue(response.headers().get("Content-Security-Policy").contains("sandbox"));
        assertTrue(response.headers().get("Content-Security-Policy").contains("default-src 'none'"));
        assertArrayEquals(SVG, response.body());
    }

    @Test
    void theEtagIsStableForTheSameContentAndChangesWithIt() {
        String first = new ConfigEndpoint(snapshot("Acme")).respond("/bootstrap.json", null)
                                                                       .headers()
                                                                       .get("ETag");
        String again = new ConfigEndpoint(snapshot("Acme")).respond("/bootstrap.json", null)
                                                                       .headers()
                                                                       .get("ETag");
        String changed = new ConfigEndpoint(snapshot("Acme Corp")).respond("/bootstrap.json", null)
                                                                             .headers()
                                                                             .get("ETag");

        assertTrue(first.matches("\"[0-9a-f]{32}\""), first);
        assertEquals(first, again);
        assertNotEquals(first, changed);
    }

    @Test
    void revalidationAnswers304WhenNothingChanged() {
        ConfigEndpoint endpoint = new ConfigEndpoint(snapshot("Acme"));
        ConfigEndpoint.Response fresh = endpoint.respond("/manifest.json", null);
        String etag = fresh.headers().get("ETag");

        for (String header : List.of(etag, "W/" + etag, "\"other\", " + etag, "*")) {
            ConfigEndpoint.Response revalidated = endpoint.respond("/manifest.json", header);
            assertEquals(304, revalidated.status(), header);
            assertEquals(0, revalidated.body().length);
            assertEquals(etag, revalidated.headers().get("ETag"));
            assertEquals("no-cache", revalidated.headers().get("Cache-Control"));
        }
        assertEquals(200, endpoint.respond("/manifest.json", "\"stale\"").status());
        assertEquals("no-cache", fresh.headers().get("Cache-Control"));
        assertEquals("nosniff", fresh.headers().get("X-Content-Type-Options"));
    }

    @Test
    void anythingElseIsNotFound() {
        ConfigEndpoint endpoint = new ConfigEndpoint(snapshot("Acme"));
        for (String path : java.util.Arrays.asList(null, "", "/", "/bootstrap.example.json", "/acme-logo.svg",
                "/../bootstrap.json", "/assets/../bootstrap.json", "/assets/missing.svg", "/layouts/",
                "/BOOTSTRAP.JSON", "/bootstrap.json/")) {
            ConfigEndpoint.Response response = endpoint.respond(path, null);
            assertEquals(404, response.status(), String.valueOf(path));
            assertEquals(0, response.body().length);
            assertFalse(response.headers().containsKey("ETag"));
        }
    }

    @Test
    void aFragmentWithAnUnknownOrMissingLayerIsReportedInBootstrap() throws Exception {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(fragment("ours", "bootstrap", "defaults", "{}"));
        registry.add(fragment("acme", "runtime", "acme", "{}"));
        registry.add(fragment("acme", null, "unlayered", "{}"));
        ConfigEndpoint endpoint = new ConfigEndpoint(ConfigSnapshot.build(registry.resolve()));

        JsonNode bootstrap = body(endpoint.respond("/bootstrap.json", null));

        assertEquals(1, bootstrap.get("fragments").size());
        JsonNode diagnostics = bootstrap.get("diagnostics");
        assertEquals(2, diagnostics.size());
        for (JsonNode diagnostic : diagnostics) {
            assertEquals("invalid-contribution", diagnostic.get("code").asText());
            assertEquals("acme", diagnostic.get("component").asText());
        }
        assertEquals(0, body(endpoint.respond("/manifest.json", null)).get("diagnostics").size());
    }

    /**
     * The registry deciding on a warning is not the same as a customer seeing one: the level and
     * the code have to survive into the served envelope, which is the only thing the browser and
     * any support tooling ever read (NXSAT-747).
     */
    @Test
    void displacingOneOfOurPackagedDefaultsIsServedAsAWarning() throws Exception {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(TestContributions.packagedFragment("bootstrap", "defaults", "{}"));
        registry.add(fragment("dflt", "bootstrap", "defaults", "{}"));
        ConfigEndpoint endpoint = new ConfigEndpoint(ConfigSnapshot.build(registry.resolve()));

        JsonNode bootstrap = body(endpoint.respond("/bootstrap.json", null));

        assertEquals(1, bootstrap.get("diagnostics").size());
        assertEquals("replaced-packaged-default", bootstrap.at("/diagnostics/0/code").asText());
        assertEquals("warning", bootstrap.at("/diagnostics/0/level").asText());
        assertEquals("dflt", bootstrap.at("/diagnostics/0/component").asText());
        assertTrue(bootstrap.at("/diagnostics/0/message").asText().contains("fragment bootstrap/defaults"));
    }

    @Test
    void contributionDiagnosticsAreFiledUnderTheirResponse() throws Exception {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(fragment("ours", "bootstrap", "defaults", "{}"));
        registry.add(fragment("acme", "manifest", "broken", "{"));
        registry.add(fragment("partner", "bootstrap", "defaults", "{}"));
        ConfigEndpoint endpoint = new ConfigEndpoint(ConfigSnapshot.build(registry.resolve()));

        JsonNode bootstrap = body(endpoint.respond("/bootstrap.json", null));
        JsonNode manifest = body(endpoint.respond("/manifest.json", null));

        // "ours" here is a component name, not our bundle, so this is one package replacing
        // another's fragment: ordinary layering, reported at info (NXSAT-747).
        assertEquals("replaced", bootstrap.at("/diagnostics/0/code").asText());
        assertEquals("info", bootstrap.at("/diagnostics/0/level").asText());
        assertEquals("partner", bootstrap.at("/diagnostics/0/component").asText());
        assertEquals(1, bootstrap.get("diagnostics").size());
        assertEquals("invalid-json", manifest.at("/diagnostics/0/code").asText());
        assertEquals("error", manifest.at("/diagnostics/0/level").asText());
        assertEquals(1, manifest.get("diagnostics").size());
        assertEquals(0, manifest.get("fragments").size());
    }

    @Test
    void weakComparisonIgnoresTheWeakPrefixOnEitherSide() {
        assertTrue(ConfigEndpoint.matches("W/\"a\"", "\"a\""));
        assertTrue(ConfigEndpoint.matches("\"a\"", "W/\"a\""));
        assertFalse(ConfigEndpoint.matches(null, "\"a\""));
        assertFalse(ConfigEndpoint.matches("\"b\"", "\"a\""));
        assertFalse(ConfigEndpoint.matches("a", "\"a\""));
    }
}
