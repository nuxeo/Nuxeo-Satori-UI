package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The validator the server runs gives, for every file of the parity corpus, the answer the
 * TypeScript source gives it: the same findings, in the same order, with the same words, or the
 * same refusal. The corpus is the starter kits' layout files and queues, each kit's first ones
 * broken in the ways a draft could be, and the paths and model the server refuses outright, with
 * the answers {@code server-validator.ts} gave when {@code server-validator-build.mjs} wrote it;
 * {@code server-validator.spec.ts} fails when the corpus or the script is not what the source
 * builds now. So a polyfill that differs from the library method it stands in for, or a script
 * that lags the source, fails here or there.
 */
class DeploymentValidatorParityTest {

    @Test
    void theServerGivesEveryFileOfTheCorpusTheAnswerTheSourceGivesIt() {
        JsonNode corpus = LayerFixtures.corpus();
        List<String> differences = new ArrayList<>();
        int findings = 0;
        int refusals = 0;
        // One engine per set of registered ids, each asked with the case's model.
        java.util.concurrent.atomic.AtomicReference<JsonNode> model = new java.util.concurrent.atomic.AtomicReference<>();
        java.util.Map<LayerSettings, DeploymentValidator> validators = new java.util.HashMap<>();
        for (JsonNode each : corpus.get("cases")) {
            JsonNode kit = corpus.get("kits").get(each.get("kit").asText());
            model.set(each.has("model") ? each.get("model") : kit.get("model"));
            LayerSettings settings = settings(each.path("registered"));
            DeploymentValidator validator = validators.computeIfAbsent(settings,
                    key -> new NashornDeploymentValidator(model::get, key));
            JsonNode actions = each.get("noActions").asBoolean() ? null : kit.get("actions");
            DeploymentValidator.Answer answer = validator.validate(each.get("path").asText(), each.get("content"),
                    kit.get("app"), actions == null || actions.isNull() ? null : actions);
            ObjectNode given = JsonNodeFactory.instance.objectNode();
            if (answer.refused() != null) {
                given.put("refused", answer.refused());
                refusals++;
            } else {
                given.set("findings", answer.findings());
                findings += answer.findings().size();
            }
            if (!given.equals(each.get("expected"))) {
                differences.add(each.get("name").asText() + ": the server gives " + given + ", the source "
                        + each.get("expected"));
            }
        }
        assertEquals(List.of(), differences);
        // The corpus is not all passes: it holds refusals and findings of every kind.
        assertTrue(refusals >= 5, "refusals: " + refusals);
        assertTrue(findings >= 30, "findings: " + findings);
    }

    @Test
    void theComparisonSeesAnAnswerThatDiffers() {
        // Held to a model that lacks the Claim type, the kit's Claim record page has findings it
        // does not have in the corpus: the equality the test above relies on is not a tautology.
        JsonNode corpus = LayerFixtures.corpus();
        JsonNode claim = null;
        for (JsonNode each : corpus.get("cases")) {
            if (each.get("name").asText().equals(LayerFixtures.KIT + ": " + LayerFixtures.CLAIM_VIEW)) {
                claim = each;
            }
        }
        ObjectNode model = LayerFixtures.kit("model").deepCopy();
        ((ObjectNode) model.get("doctypes")).remove("Claim");
        DeploymentValidator.Answer answer = new NashornDeploymentValidator(() -> model, LayerFixtures.ON)
                .validate(LayerFixtures.CLAIM_VIEW, claim.get("content"), null, null);
        ObjectNode given = JsonNodeFactory.instance.objectNode();
        given.set("findings", answer.findings());
        assertTrue(answer.findings().size() > 0);
        assertTrue(!given.equals(claim.get("expected")));
    }

    private static LayerSettings settings(JsonNode registered) {
        return new LayerSettings(true, false, ids(registered.get("rules")), ids(registered.get("rowActions")),
                ids(registered.get("bulkActions")));
    }

    private static List<String> ids(JsonNode list) {
        List<String> ids = new ArrayList<>();
        if (list instanceof ArrayNode array) {
            array.forEach(id -> ids.add(id.asText()));
        }
        return ids;
    }
}
