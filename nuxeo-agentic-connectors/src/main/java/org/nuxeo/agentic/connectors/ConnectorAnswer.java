package org.nuxeo.agentic.connectors;

import java.util.LinkedHashMap;
import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * What {@code Connector.Read} answers:
 *
 * <pre>
 * { "connector": "payers.claimPayments", "status": "found",
 *   "fields": { "paymentStatus": "Paid", "paidAmount": 412.5 } }
 * </pre>
 *
 * <ul>
 * <li>{@code found}: the system has the record. {@code fields} holds each field of the allow-list
 * that its answer has as a text, a number or a boolean, and nothing else;</li>
 * <li>{@code not-found}: the system answered 404;</li>
 * <li>{@code no-key}: the document holds no key the connector can send, so the system was not
 * called.</li>
 * </ul>
 */
public record ConnectorAnswer(String connector, Status status, Map<String, JsonNode> fields) {

    public enum Status {
        FOUND("found"), NOT_FOUND("not-found"), NO_KEY("no-key");

        final String json;

        Status(String json) {
            this.json = json;
        }
    }

    static final ObjectMapper JSON = new ObjectMapper();

    public ConnectorAnswer {
        fields = java.util.Collections.unmodifiableMap(new LinkedHashMap<>(fields));
    }

    static ConnectorAnswer without(String connector, Status status) {
        return new ConnectorAnswer(connector, status, Map.of());
    }

    /**
     * The allow-list applied to a system's answer: each field read at its pointer, kept only when it
     * is a text, a number or a boolean. An object, a list or a {@code null} there is left out, so a
     * pointer to a branch of the answer cannot return the branch whole. Every other field of the
     * answer is never read.
     */
    static ConnectorAnswer found(Connector connector, JsonNode record) {
        Map<String, JsonNode> fields = new LinkedHashMap<>();
        for (Connector.Field field : connector.fields()) {
            JsonNode value = record.at(field.pointer());
            if (value.isTextual() || value.isNumber() || value.isBoolean()) {
                fields.put(field.name(), value);
            }
        }
        return new ConnectorAnswer(connector.id(), Status.FOUND, fields);
    }

    public String toJson() {
        ObjectNode root = JSON.createObjectNode();
        root.put("connector", connector);
        root.put("status", status.json);
        ObjectNode out = root.putObject("fields");
        fields.forEach(out::set);
        try {
            return JSON.writeValueAsString(root);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            // Texts, numbers and booleans always serialise.
            throw new IllegalStateException(e);
        }
    }
}
