package org.nuxeo.agentic.connectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;

import org.junit.jupiter.api.Test;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.model.PropertyNotFoundException;

import com.fasterxml.jackson.databind.JsonNode;

/** What a payload carries: the named fields' values that are sent, and nothing else. */
class WebhookPayloadTest {

    /** A delivery's id, made of a short pattern so that no key-shaped string is in the source. */
    private static final String DELIVERY = "0123456789abcdef".repeat(2);

    @Test
    void textNumbersBooleansDatesAndListsOfThemAreSent() {
        assertEquals("\"Paid\"", WebhookPayload.value("Paid").toString());
        assertEquals("412", WebhookPayload.value(412L).toString());
        assertEquals("7", WebhookPayload.value(7).toString());
        assertEquals("412.5", WebhookPayload.value(412.5d).toString());
        assertEquals(0, new BigDecimal("12.30").compareTo(WebhookPayload.value(new BigDecimal("12.30")).decimalValue()));
        assertEquals("true", WebhookPayload.value(Boolean.TRUE).toString());
        assertEquals("null", WebhookPayload.value(null).toString());
        assertEquals("null", WebhookPayload.value(Double.NaN).toString());
        Calendar date = new GregorianCalendar(TimeZone.getTimeZone("Europe/Paris"));
        date.setTimeInMillis(1_795_694_400_000L);
        assertEquals("\"2026-11-26T12:00:00Z\"", WebhookPayload.value(date).toString());
        assertEquals("[\"water\",\"kitchen\"]", WebhookPayload.value(new String[] { "water", "kitchen" }).toString());
        assertEquals("[\"water\",null]", WebhookPayload.value(new String[] { "water", null }).toString());
        assertEquals("[1,null,2]", WebhookPayload.value(java.util.Arrays.asList(1L, null, 2L)).toString());
    }

    @Test
    void aFileAComplexPropertyAndAListOfThemAreWithheld() {
        assertNull(WebhookPayload.value(Blobs.createBlob("THE FILE'S CONTENT")));
        assertNull(WebhookPayload.value(Map.of("name", "A. Adjuster")));
        assertNull(WebhookPayload.value(List.of(Map.of("file", "x"))));
        assertNull(WebhookPayload.value(new Object[] { "a", Blobs.createBlob("x") }));
        assertNull(WebhookPayload.value(new Object()));
        assertNull(WebhookPayload.value(new String[][] { { "nested" } }));
    }

    @Test
    void theBodyIsTheDeliveryTheEventTheDocumentAndTheNamedFieldsInTheirOrder() throws Exception {
        WebhookDescriptor d = WebhookTest.descriptor();
        d.fields.add(WebhookTest.field("scan", "claim:scan"));
        d.fields.add(WebhookTest.field("missing", "other:property"));
        Webhook webhook = Webhook.of(d);
        DocumentModel document = (DocumentModel) Proxy.newProxyInstance(getClass().getClassLoader(),
                new Class<?>[] { DocumentModel.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getId" -> "4c6e9f1a-claim";
                case "getType" -> "Claim";
                case "getCurrentLifeCycleState" -> "approved";
                case "getPropertyValue" -> switch ((String) args[0]) {
                    case "claim:number" -> "CLAIM-000130";
                    case "claim:scan" -> Blobs.createBlob("THE FILE'S CONTENT");
                    default -> throw new PropertyNotFoundException((String) args[0]);
                    };
                default -> throw new UnsupportedOperationException(method.getName());
                });
        List<String> withheld = new ArrayList<>();
        byte[] body = WebhookPayload.build(DELIVERY, webhook, Webhook.Trigger.MODIFIED,
                document, withheld::add);
        String text = new String(body, StandardCharsets.UTF_8);
        assertEquals("{\"delivery\":\"" + DELIVERY + "\",\"event\":\"modified\","
                + "\"document\":{\"id\":\"4c6e9f1a-claim\",\"type\":\"Claim\"},"
                + "\"fields\":{\"claimNumber\":\"CLAIM-000130\",\"state\":\"approved\",\"scan\":null,\"missing\":null}}",
                text);
        assertEquals(List.of("scan"), withheld);
        JsonNode parsed = WebhookDelivery.JSON.readTree(body);
        assertTrue(parsed.at("/fields/scan").isNull());
    }
}
