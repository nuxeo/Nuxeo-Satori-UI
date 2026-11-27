/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.review;

import java.io.IOException;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * What a review annotation's payload, its {@code externalEntity:entity}, says, read as the asset
 * page's review reads it ({@code libs/shared/document-layouts/src/lib/record-page/picture-review.ts}):
 * version 1, a round from 1 to {@value #MAX_ROUNDS}, and
 *
 * <ul>
 * <li>{@code "kind": "pin"} with {@code x} and {@code y} fractions from 0 to 1: a pin, which anyone
 * Nuxeo lets comment may place;</li>
 * <li>{@code "kind": "round-closed"}: the round sent back, closed and the next opened;</li>
 * <li>{@code "kind": "decision"} with {@code "decision": "approved"} or {@code "rejected"}: the
 * review concluded.</li>
 * </ul>
 *
 * Anything else of the review's origin, a payload that is not JSON, names a key twice, or is of
 * another version or kind, is no pin: the listener holds it as a decision would be held, so that
 * nothing but a pin is written without the permission.
 */
public record ReviewPayload(Kind kind, int round, Decision decision) {

    /** The most rounds a review counts, and the highest a payload may name. */
    public static final int MAX_ROUNDS = 999;

    /** The only version of the payload the review writes and reads. */
    static final int VERSION = 1;

    /** What a review annotation is. */
    public enum Kind {
        PIN, ROUND_CLOSED, DECISION
    }

    /** How a review is concluded, as the payload writes it and the audit records it. */
    public enum Decision {
        APPROVED("approved"), REJECTED("rejected");

        private final String code;

        Decision(String code) {
            this.code = code;
        }

        public String code() {
            return code;
        }

        static Decision of(String code) {
            for (Decision decision : values()) {
                if (decision.code.equals(code)) {
                    return decision;
                }
            }
            return null;
        }
    }

    /** A JSON reader that refuses a key written twice, which a browser's parser would read as its last. */
    private static final ObjectMapper JSON = new ObjectMapper(
            new JsonFactory().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION));

    /** The payload {@code entity} holds, or {@code null} when it is none of the three. */
    public static ReviewPayload read(String entity) {
        if (entity == null || entity.length() > 4096) {
            return null;
        }
        JsonNode node;
        try {
            node = JSON.readTree(entity);
        } catch (IOException | RuntimeException e) {
            return null;
        }
        if (node == null || !node.isObject()) {
            return null;
        }
        JsonNode version = node.get("version");
        JsonNode round = node.get("round");
        JsonNode kind = node.get("kind");
        if (version == null || !version.isIntegralNumber() || version.asLong() != VERSION || round == null
                || !round.isIntegralNumber() || round.asLong() < 1 || round.asLong() > MAX_ROUNDS || kind == null
                || !kind.isTextual()) {
            return null;
        }
        int number = round.asInt();
        switch (kind.asText()) {
        case "pin" -> {
            return fraction(node.get("x")) && fraction(node.get("y")) ? new ReviewPayload(Kind.PIN, number, null)
                    : null;
        }
        case "round-closed" -> {
            return new ReviewPayload(Kind.ROUND_CLOSED, number, null);
        }
        case "decision" -> {
            JsonNode decided = node.get("decision");
            Decision decision = decided != null && decided.isTextual() ? Decision.of(decided.asText()) : null;
            return decision == null ? null : new ReviewPayload(Kind.DECISION, number, decision);
        }
        default -> {
            return null;
        }
        }
    }

    private static boolean fraction(JsonNode value) {
        if (value == null || !value.isNumber()) {
            return false;
        }
        double number = value.asDouble();
        return Double.isFinite(number) && number >= 0 && number <= 1;
    }

    /** Whether it is a pin, the one kind written without the permission. */
    public boolean isPin() {
        return kind == Kind.PIN;
    }

    /** The decision as the audit and the enricher name it: {@code sent-back}, {@code approved} or {@code rejected}. */
    public String code() {
        return switch (kind) {
        case ROUND_CLOSED -> "sent-back";
        case DECISION -> decision.code();
        case PIN -> "pin";
        };
    }
}
