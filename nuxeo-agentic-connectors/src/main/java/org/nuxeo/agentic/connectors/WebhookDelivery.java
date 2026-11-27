package org.nuxeo.agentic.connectors;

import java.io.IOException;
import java.time.Instant;
import java.util.Locale;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * One delivery of a webhook: a document event to send, sent, or given up on. Its record holds no
 * payload: the payload is kept apart ({@link WebhookDeliveries}), so that what is read to find due
 * deliveries, and what an administrator is shown, never holds a field's value.
 *
 * <ul>
 * <li>{@code id}: 32 hexadecimal digits, the payload's {@code delivery}, the same on every attempt
 * and on a resend, so that a receiver can tell a delivery it already has;</li>
 * <li>{@code webhook}, {@code event}, {@code document}, {@code type}: what it is about, the
 * document by its id;</li>
 * <li>{@code state}, {@code attempts}, {@code nextAt}, {@code outcome}, {@code status}: where it is,
 * how many times it was tried, when it may be tried next, and what the last attempt came to;</li>
 * <li>{@code kept}: whether its payload is kept, in flight and as a dead letter; a delivered one,
 * and one too large to send, keep none.</li>
 * </ul>
 */
record WebhookDelivery(String id, String webhook, String event, String document, String type, State state,
        int attempts, long created, long updated, long nextAt, String outcome, int status, boolean kept) {

    /** Where a delivery is. */
    enum State {
        /** Waiting for its first attempt, or for its next, at {@code nextAt}. */
        PENDING,
        /** Claimed by a node, which is sending it. */
        SENDING,
        /** A {@code 2xx}. */
        DELIVERED,
        /** Given up on: an outcome no other attempt would change, or its last attempt failed. */
        DEAD;

        String label() {
            return name().toLowerCase(Locale.ROOT);
        }

        static State of(String label) {
            for (State state : values()) {
                if (state.label().equals(label)) {
                    return state;
                }
            }
            return null;
        }
    }

    static final ObjectMapper JSON = new ObjectMapper();

    WebhookDelivery with(State state, int attempts, long updated, long nextAt, String outcome, int status,
            boolean kept) {
        return new WebhookDelivery(id, webhook, event, document, type, state, attempts, created, updated, nextAt,
                outcome, status, kept);
    }

    /** As kept in the store. */
    String toJson() {
        ObjectNode node = listing(false);
        node.put("created", created);
        node.put("updated", updated);
        node.put("nextAt", nextAt);
        node.put("kept", kept);
        return node.toString();
    }

    /** As the store kept it, or {@code null} for anything else. */
    static WebhookDelivery fromJson(String json) {
        if (json == null) {
            return null;
        }
        try {
            JsonNode node = JSON.readTree(json);
            State state = State.of(node.path("state").asText());
            if (state == null || !node.path("id").isTextual()) {
                return null;
            }
            return new WebhookDelivery(node.path("id").asText(), node.path("webhook").asText(),
                    node.path("event").asText(), node.path("document").asText(), node.path("type").asText(), state,
                    node.path("attempts").asInt(), node.path("created").asLong(), node.path("updated").asLong(),
                    node.path("nextAt").asLong(), node.path("outcome").isTextual() ? node.path("outcome").asText() : null,
                    node.path("status").asInt(), node.path("kept").asBoolean());
        } catch (IOException e) {
            return null;
        }
    }

    /**
     * What an administrator is shown: the delivery's id, its webhook, event, document and type, its
     * state, attempts and last outcome, and when. Never its payload, which this record does not hold.
     */
    ObjectNode listing() {
        return listing(true);
    }

    private ObjectNode listing(boolean dates) {
        ObjectNode node = JSON.createObjectNode();
        node.put("id", id);
        node.put("webhook", webhook);
        node.put("event", event);
        node.put("document", document);
        node.put("type", type);
        node.put("state", state.label());
        node.put("attempts", attempts);
        if (outcome != null) {
            node.put("outcome", outcome);
        }
        if (status > 0) {
            node.put("status", status);
        }
        if (dates) {
            node.put("created", Instant.ofEpochMilli(created).toString());
            node.put("updated", Instant.ofEpochMilli(updated).toString());
            if (state == State.PENDING) {
                node.put("nextAttempt", Instant.ofEpochMilli(nextAt).toString());
            }
            node.put("resendable", state == State.DEAD && kept);
        }
        return node;
    }
}
