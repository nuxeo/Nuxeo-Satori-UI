package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.nuxeo.agentic.config.LayerFixtures.ADA;
import static org.nuxeo.agentic.config.LayerFixtures.CLAIM_VIEW;
import static org.nuxeo.agentic.config.LayerFixtures.DANA;
import static org.nuxeo.agentic.config.LayerFixtures.ON;
import static org.nuxeo.agentic.config.LayerFixtures.claimViewWith;
import static org.nuxeo.agentic.config.LayerFixtures.save;
import static org.nuxeo.agentic.config.LayerFixtures.text;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.JsonNode;

/** The deployment layer's addresses: what a request must be before the service is asked. */
class LayerEndpointTest {

    private static final String FILE = "/apps/payers-claims/layer/" + CLAIM_VIEW;

    private final LayerFixtures.MemoryStore store = new LayerFixtures.MemoryStore();

    private final LayerEndpoint endpoint = new LayerEndpoint(LayerFixtures.service(ON, store));

    private static byte[] bytes(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    private AppRegistryEndpoint.Response post(String contentType, String header, byte[] body) {
        return endpoint.respond("POST", FILE, ADA, contentType, header, body);
    }

    private static JsonNode json(AppRegistryEndpoint.Response response) throws Exception {
        return ConfigSnapshot.JSON.readTree(response.body());
    }

    @Test
    void answersItsOwnPathsAndNoneOfTheRegistrys() {
        assertTrue(LayerEndpoint.answers("/layer.json"));
        assertTrue(LayerEndpoint.answers("/apps/payers-claims/layer.json"));
        assertTrue(LayerEndpoint.answers(FILE));
        assertFalse(LayerEndpoint.answers("/apps.json"));
        assertFalse(LayerEndpoint.answers("/apps/payers-claims/" + CLAIM_VIEW));
        assertFalse(LayerEndpoint.answers("/apps/payers-claims/layerx.json"));
        assertFalse(LayerEndpoint.answers("/apps/Payers/layer.json"));
        assertFalse(LayerEndpoint.answers(null));
    }

    @Test
    void aChangeIsAcceptedAsJsonWithTheChangeHeader() throws Exception {
        AppRegistryEndpoint.Response saved = post("application/json; charset=utf-8", "1",
                bytes(text(save(0, claimViewWith("Mine")))));
        assertEquals(200, saved.status());
        assertEquals(1, json(saved).get("revision").asInt());
        assertEquals("no-store", saved.headers().get("Cache-Control"));
        assertEquals("nosniff", saved.headers().get("X-Content-Type-Options"));
        assertEquals(ConfigEndpoint.JSON_TYPE, saved.headers().get("Content-Type"));
    }

    @Test
    void aChangeAPageOnAnotherSiteCouldSendIsRefusedAndWritesNothing() {
        byte[] body = bytes(text(save(0, claimViewWith("Forged"))));
        // A form can send text/plain or a urlencoded body without a preflight; neither is a change.
        assertEquals(415, post("text/plain", "1", body).status());
        assertEquals(415, post("application/x-www-form-urlencoded", "1", body).status());
        assertEquals(415, post(null, "1", body).status());
        // Nor can it set a header of its own without one.
        assertEquals(403, post("application/json", null, body).status());
        assertEquals(403, post("application/json", " ", body).status());
        assertEquals(0, store.writes);
    }

    @Test
    void aBodyTooLargeTooDeepOrNotJsonIsRefused() throws Exception {
        assertEquals(413, post("application/json", "1", null).status());
        assertEquals(413, post("application/json", "1", new byte[LayerEndpoint.MAX_BODY_BYTES + 1]).status());
        String deep = "[".repeat(LayerEndpoint.MAX_DEPTH + 1) + "]".repeat(LayerEndpoint.MAX_DEPTH + 1);
        AppRegistryEndpoint.Response nested = post("application/json", "1", bytes(deep));
        assertEquals(400, nested.status());
        assertTrue(json(nested).get("message").asText().contains("nested deeper"));
        assertEquals(400, post("application/json", "1", bytes("{\"action\":\"save\",\"action\":\"discard\"}")).status());
        assertEquals(400, post("application/json", "1", bytes("{\"action\":\"save\"} {}")).status());
        assertEquals(400, post("application/json", "1", bytes("not json")).status());
        assertEquals(0, store.writes);
    }

    @Test
    void aNonAdministratorIsRefusedAtTheAddressToo() {
        AppRegistryEndpoint.Response refused = endpoint.respond("POST", FILE, DANA, "application/json", "1",
                bytes(text(save(0, claimViewWith("Mine")))));
        assertEquals(403, refused.status());
        assertEquals(403, endpoint.respond("GET", FILE, DANA, null, null, new byte[0]).status());
        assertEquals(403, endpoint.respond("GET", "/layer.json", DANA, null, null, new byte[0]).status());
        assertEquals(0, store.writes);
    }

    @Test
    void readsAreGetOrHeadAndChangesArePostToAFile() {
        assertEquals(200, endpoint.respond("GET", FILE, ADA, null, null, new byte[0]).status());
        assertEquals(200, endpoint.respond("HEAD", "/apps/payers-claims/layer.json", ADA, null, null, new byte[0])
                                  .status());
        assertEquals(200, endpoint.respond("GET", "/layer.json", ADA, null, null, new byte[0]).status());
        AppRegistryEndpoint.Response put = endpoint.respond("PUT", FILE, ADA, "application/json", "1", new byte[0]);
        assertEquals(405, put.status());
        assertEquals(LayerEndpoint.ALLOWED, put.headers().get("Allow"));
        assertEquals(405, endpoint.respond("POST", "/layer.json", ADA, "application/json", "1", bytes("{}")).status());
        assertEquals(405,
                endpoint.respond("POST", "/apps/payers-claims/layer.json", ADA, "application/json", "1", bytes("{}"))
                        .status());
    }
}
