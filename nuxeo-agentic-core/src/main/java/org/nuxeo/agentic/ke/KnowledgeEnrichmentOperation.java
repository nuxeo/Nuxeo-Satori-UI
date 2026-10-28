package org.nuxeo.agentic.ke;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.hyland.sdk.cic.ke.object.Action;
import org.hyland.sdk.cic.ke.object.ActionResult;
import org.hyland.sdk.cic.http.client.CICServiceException;
import org.hyland.sdk.cic.http.client.mapper.object.CICBlob;
import org.hyland.sdk.cic.ke.object.EnrichmentData;
import org.hyland.sdk.cic.ke.object.EnrichmentResult;
import org.hyland.sdk.cic.ke.KEService;
import org.nuxeo.ecm.automation.core.Constants;
import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.automation.core.annotations.Param;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.impl.blob.StringBlob;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Knowledge Enrichment through the Hyland CIC Java SDK. The Agentic UI posts the document blob as
 * {@code input} and the request as {@code params}, and gets back the Context API results in the
 * shape {@code KeClientService} already reads, so the Angular side does not change with the SDK.
 */
@Operation(id = KnowledgeEnrichmentOperation.ID, category = Constants.CAT_DOCUMENT, label = "Knowledge enrichment (CIC SDK)", description = "Runs Hyland Knowledge Enrichment actions on the input blob through the Context API.")
public class KnowledgeEnrichmentOperation {

    public static final String ID = "AgenticKnowledgeEnrichment.Enrich";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Param(name = "actions", description = "Comma-separated Context API action names, camelCase.")
    protected String actions;

    @Param(name = "sourceId", required = false)
    protected String sourceId;

    @Param(name = "classes", required = false, description = "JSON array of class labels.")
    protected String classes;

    @Param(name = "extraJsonPayloadStr", required = false, description = "JSON object: maxWordCount, instructions.")
    protected String extraJsonPayloadStr;

    @OperationMethod
    public Blob run(Blob input) throws IOException {
        KEService service = KnowledgeEnrichmentService.get();
        List<Action> requested = parseActions(actions);
        List<String> classList = classes == null ? List.of() : MAPPER.readValue(classes, new TypeReference<List<String>>() {});
        JsonNode extra = extraJsonPayloadStr == null ? MAPPER.createObjectNode() : MAPPER.readTree(extraJsonPayloadStr);
        Integer maxWordCount = extra.has("maxWordCount") ? extra.get("maxWordCount").asInt() : null;
        String instructions = extra.has("instructions") ? extra.get("instructions").asText() : null;

        EnrichmentResult result;
        try {
            result = service.enrich(toCicBlob(input), req -> {
                for (Action action : requested) {
                    req.action(action, cfg -> {
                        if (!classList.isEmpty()) {
                            cfg.classes(classList);
                        }
                        // Only text summarization takes maxWordCount; the image actions reject it.
                        if (maxWordCount != null && action == Action.TEXT_SUMMARIZATION) {
                            cfg.maxWordCount(maxWordCount);
                        }
                        if (instructions != null) {
                            cfg.instruction("context", instructions);
                        }
                    });
                }
            });
        } catch (CICServiceException e) {
            String remote = e.remoteCause()
                    .map(error -> error.message() + " " + error.errorDescription())
                    .orElse("no error body");
            throw new NuxeoException("Knowledge Enrichment failed: HTTP " + e.statusCode() + ": " + remote, e);
        } catch (RuntimeException e) {
            throw new NuxeoException("Knowledge Enrichment failed: " + e.getMessage(), e);
        }
        return new StringBlob(toJson(result).toString(), "application/json");
    }

    private static List<Action> parseActions(String names) {
        List<Action> parsed = new ArrayList<>();
        for (String name : names.split(",")) {
            String wire = name.trim();
            if (wire.isEmpty()) {
                continue;
            }
            Action action = Arrays.stream(Action.values())
                    .filter(candidate -> candidate.value().equals(wire))
                    .findFirst()
                    .orElseThrow(() -> new NuxeoException("Unknown Knowledge Enrichment action: " + wire));
            parsed.add(action);
        }
        return parsed;
    }

    private static CICBlob toCicBlob(Blob blob) {
        return new CICBlob() {
            @Override
            public InputStream getInputStream() {
                try {
                    return blob.getStream();
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            }

            @Override
            public Optional<String> getDigest() {
                return Optional.empty();
            }

            @Override
            public Optional<String> getContentType() {
                return Optional.ofNullable(blob.getMimeType());
            }
        };
    }

    /**
     * Writes the SDK result in the shape {@code KeClientService.normalize} reads: an envelope with
     * {@code results[0]} holding one key per action, each {@code {isSuccess, result, error}}.
     */
    static ObjectNode toJson(EnrichmentResult result) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("id", result.id());
        root.put("status", result.status());
        root.put("inProgress", !result.isComplete());
        ArrayNode results = root.putArray("results");
        for (var entry : result.results()) {
            ObjectNode node = results.addObject();
            node.put("objectKey", entry.objectKey());
            putAction(node, "textSummary", entry.textSummary(), r -> MAPPER.getNodeFactory().textNode(r.value()));
            putAction(node, "textClassification", entry.textClassification(), r -> MAPPER.getNodeFactory().textNode(r.value()));
            putAction(node, "imageDescription", entry.imageDescription(), r -> MAPPER.getNodeFactory().textNode(r.value()));
            putAction(node, "namedEntityText", entry.namedEntityText(), r -> entities(r.entities()));
            putAction(node, "namedEntityImage", entry.namedEntityImage(), r -> entities(r.entities()));
        }
        return root;
    }

    private static <T extends EnrichmentData> void putAction(ObjectNode node, String name, ActionResult<T> action,
            java.util.function.Function<T, JsonNode> value) {
        if (action == null) {
            return;
        }
        ObjectNode out = node.putObject(name);
        out.put("isSuccess", action.isSuccess());
        if (action.isSuccess() && action.result() != null) {
            out.set("result", value.apply(action.result()));
        }
        if (action.error() != null) {
            ObjectNode error = out.putObject("error");
            error.put("errorType", String.valueOf(action.error().type()));
            error.put("message", action.error().message());
        }
    }

    private static JsonNode entities(Map<String, List<String>> entities) {
        ObjectNode out = MAPPER.createObjectNode();
        entities.forEach((type, values) -> out.set(type, MAPPER.valueToTree(values)));
        return out;
    }
}
