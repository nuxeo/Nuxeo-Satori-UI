package org.nuxeo.agentic.connectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

/**
 * A delivery is signed in the change events' own scheme: the add-on's inbound check,
 * {@link ChangeEvents#receive}, accepts what {@link WebhookComponent#signed} signs, and a signer
 * written apart from both agrees with it. So a receiver that checks Nuxeo's scheme, as the stand-in
 * receiver does, checks a delivery.
 */
class WebhookSigningTest {

    /** A nonce, made of a short pattern so that no key-shaped string is in the source. */
    private static final String NONCE = "0123456789abcdef".repeat(2);

    private final Fixtures.Settings settings = new Fixtures.Settings();

    private final Fixtures.Clock clock = new Fixtures.Clock();

    private final Connector connector = Connector.of(Fixtures.descriptor());

    private final ChangeEvents events = new ChangeEvents(Map.of(connector.id(), connector)::get, settings.settings(),
            new ConnectorCache(settings.settings(), clock), Fixtures.metrics());

    @Test
    void theInboundCheckAcceptsAnOutboundSignature() throws Exception {
        String secret = Fixtures.generatedSecret();
        settings.eventsSecret(secret);
        String timestamp = Long.toString(clock.instant().getEpochSecond());
        byte[] body = "{\"key\":\"CLAIM-000130\"}".getBytes(StandardCharsets.UTF_8);
        Map<String, String> headers = WebhookComponent.signed(connector.id(), secret, timestamp,
                NONCE, body);
        assertEquals(List.of("X-Nuxeo-Webhook", ChangeEvents.TIMESTAMP_HEADER, ChangeEvents.NONCE_HEADER,
                ChangeEvents.SIGNATURE_HEADER), List.copyOf(headers.keySet()));
        assertEquals(connector.id(), headers.get("X-Nuxeo-Webhook"));
        assertEquals(Hooks.sign(secret, connector.id(), timestamp, NONCE, body),
                headers.get(ChangeEvents.SIGNATURE_HEADER));
        assertEquals(ChangeEvents.Reason.ACCEPTED,
                events.receive(connector.id(), headers.get(ChangeEvents.TIMESTAMP_HEADER),
                        headers.get(ChangeEvents.NONCE_HEADER), headers.get(ChangeEvents.SIGNATURE_HEADER), body)
                      .reason());
    }

    @Test
    void theIdTheTimestampTheNonceAndEveryByteOfTheBodyAreSigned() throws Exception {
        String secret = Fixtures.generatedSecret();
        byte[] body = "{\"delivery\":\"d\"}".getBytes(StandardCharsets.UTF_8);
        String signed = WebhookComponent.signed("a.webhook", secret, "1795694400", "nonce-0000000001", body)
                                        .get(ChangeEvents.SIGNATURE_HEADER);
        assertNotEquals(signed, WebhookComponent.signed("b.webhook", secret, "1795694400", "nonce-0000000001", body)
                                                .get(ChangeEvents.SIGNATURE_HEADER));
        assertNotEquals(signed, WebhookComponent.signed("a.webhook", secret, "1795694401", "nonce-0000000001", body)
                                                .get(ChangeEvents.SIGNATURE_HEADER));
        assertNotEquals(signed, WebhookComponent.signed("a.webhook", secret, "1795694400", "nonce-0000000002", body)
                                                .get(ChangeEvents.SIGNATURE_HEADER));
        assertNotEquals(signed, WebhookComponent.signed("a.webhook", secret, "1795694400", "nonce-0000000001",
                "{\"delivery\":\"e\"}".getBytes(StandardCharsets.UTF_8)).get(ChangeEvents.SIGNATURE_HEADER));
        assertNotEquals(signed, WebhookComponent.signed("a.webhook", Fixtures.generatedSecret(), "1795694400",
                "nonce-0000000001", body).get(ChangeEvents.SIGNATURE_HEADER));
    }

    @Test
    void theWaitGrowsFourfoldFromThirtySecondsToSixHours() {
        assertEquals(java.time.Duration.ofSeconds(30), WebhookComponent.backoff(1));
        assertEquals(java.time.Duration.ofMinutes(2), WebhookComponent.backoff(2));
        assertEquals(java.time.Duration.ofMinutes(8), WebhookComponent.backoff(3));
        assertEquals(java.time.Duration.ofMinutes(32), WebhookComponent.backoff(4));
        assertEquals(java.time.Duration.ofMinutes(128), WebhookComponent.backoff(5));
        assertEquals(java.time.Duration.ofHours(6), WebhookComponent.backoff(6));
        assertEquals(java.time.Duration.ofHours(6), WebhookComponent.backoff(10));
    }
}
