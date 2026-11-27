package org.nuxeo.agentic.connectors;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.function.Consumer;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.PropertyException;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * A delivery's payload: the delivery's id, the event, the document's id and type, and the
 * webhook's fields, each under its name, and nothing else.
 *
 * <pre>
 * {
 *   "delivery": "&lt;32 hexadecimal digits&gt;",
 *   "event": "modified",
 *   "document": { "id": "1f0b7a52-…", "type": "Claim" },
 *   "fields": { "claimNumber": "CLAIM-000130", "state": "approved" }
 * }
 * </pre>
 *
 * <ul>
 * <li><b>Every field the webhook names is there, and no other:</b> one the document does not have,
 * or whose value is empty, is {@code null}.</li>
 * <li><b>Only values that are text, a number, a boolean, a date or a list of those are sent.</b> A
 * date is ISO 8601, in UTC. Anything else, a file above all, or a complex property, is withheld:
 * sent as {@code null}, and the log says, by the field's name only, that it was ({@link #withheld}).
 * A file's content, its name or its digest are never read.</li>
 * <li><b>At most {@value #MAX_BYTES} bytes:</b> a payload past it is not sent at all, rather than
 * cut.</li>
 * </ul>
 */
final class WebhookPayload {

    static final int MAX_BYTES = 64 * 1024;

    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;

    private WebhookPayload() {
    }

    /**
     * The payload's bytes, as UTF-8 JSON. {@code withheld} is told each field whose value was not
     * one that is sent, by its name.
     */
    static byte[] build(String delivery, Webhook webhook, Webhook.Trigger trigger, DocumentModel document,
            Consumer<String> withheld) {
        ObjectNode payload = NODES.objectNode();
        payload.put("delivery", delivery);
        payload.put("event", trigger.id);
        ObjectNode about = payload.putObject("document");
        about.put("id", document.getId());
        about.put("type", document.getType());
        ObjectNode fields = payload.putObject("fields");
        for (Webhook.Field field : webhook.fields()) {
            Object value;
            try {
                value = Webhook.LIFECYCLE_STATE.equals(field.xpath()) ? document.getCurrentLifeCycleState()
                        : document.getPropertyValue(field.xpath());
            } catch (PropertyException e) {
                // Not a property of this document's schemas: a field it does not have.
                value = null;
            }
            JsonNode node = value(value);
            if (node == null) {
                withheld.accept(field.name());
                node = NODES.nullNode();
            }
            fields.set(field.name(), node);
        }
        return payload.toString().getBytes(StandardCharsets.UTF_8);
    }

    /**
     * The JSON of a value that is sent, {@link JsonNodeFactory#nullNode()} for none, or {@code null}
     * for one that is withheld.
     */
    static JsonNode value(Object value) {
        if (value == null) {
            return NODES.nullNode();
        }
        if (value instanceof Object[] array) {
            return list(Arrays.asList(array));
        }
        if (value instanceof Collection<?> collection) {
            return list(collection);
        }
        return scalar(value);
    }

    private static JsonNode list(Collection<?> values) {
        ArrayNode array = NODES.arrayNode();
        for (Object each : new ArrayList<>(values)) {
            JsonNode node = each == null ? NODES.nullNode() : scalar(each);
            if (node == null) {
                return null;
            }
            array.add(node);
        }
        return array;
    }

    private static JsonNode scalar(Object value) {
        if (value instanceof Blob) {
            return null;
        }
        if (value instanceof String text) {
            return NODES.textNode(text);
        }
        if (value instanceof Boolean bool) {
            return NODES.booleanNode(bool);
        }
        if (value instanceof Long || value instanceof Integer || value instanceof Short || value instanceof Byte) {
            return NODES.numberNode(((Number) value).longValue());
        }
        if (value instanceof Double || value instanceof Float) {
            double number = ((Number) value).doubleValue();
            return Double.isFinite(number) ? NODES.numberNode(number) : NODES.nullNode();
        }
        if (value instanceof BigDecimal decimal) {
            return NODES.numberNode(decimal);
        }
        if (value instanceof BigInteger integer) {
            return NODES.numberNode(integer);
        }
        if (value instanceof Calendar calendar) {
            return NODES.textNode(calendar.toInstant().toString());
        }
        if (value instanceof Date date) {
            return NODES.textNode(date.toInstant().toString());
        }
        // A complex property's map, or anything else: not a value that is sent.
        return null;
    }
}
