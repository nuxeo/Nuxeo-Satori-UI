/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.Test;
import org.nuxeo.agentic.signature.CallbackEvent.Outcome;
import org.nuxeo.agentic.signature.CallbackRefusedException.Reason;
import org.nuxeo.agentic.signature.Envelope.Signer;
import org.nuxeo.agentic.signature.standin.StandInProvider;

/**
 * The stand-in provider on its own, with no Nuxeo runtime: where its settings come from, which
 * addresses it calls, and how it authenticates a callback, a known HMAC-SHA256 included.
 */
public class StandInProviderTest {

    private static StandInProvider provider(Map<String, String> properties, Map<String, String> env) {
        StandInProvider provider = new StandInProvider();
        provider.init("standin", new SignatureSettings(properties::get, env::get));
        return provider;
    }

    private static Map<String, String> settings(String address) {
        Map<String, String> properties = new HashMap<>();
        properties.put("nuxeo.agentic.signature.standin.address", address);
        properties.put("nuxeo.agentic.signature.standin.apiKey", StandInStub.API_KEY);
        properties.put("nuxeo.agentic.signature.standin.callbackSecret", StandInStub.SECRET);
        return properties;
    }

    @Test
    public void itIsConfiguredByAnHttpsAddressAKeyAndASecret() {
        assertTrue(provider(settings("https://esign.example.com/api"), Map.of()).configured());
        // The credentials from the environment, named for the provider.
        Map<String, String> properties = new HashMap<>(settings("https://esign.example.com"));
        properties.remove("nuxeo.agentic.signature.standin.apiKey");
        properties.remove("nuxeo.agentic.signature.standin.callbackSecret");
        assertFalse(provider(properties, Map.of()).configured());
        assertTrue(provider(properties, Map.of("NUXEO_SIGNATURE_STANDIN_API_KEY", StandInStub.API_KEY,
                "NUXEO_SIGNATURE_STANDIN_CALLBACK_SECRET", StandInStub.SECRET)).configured());
    }

    @Test
    public void anAddressItMayNotCallLeavesItUnconfigured() {
        for (String address : List.of("http://esign.example.com", "ftp://esign.example.com",
                "https://user:secret@esign.example.com", "https://esign.example.com/?to=elsewhere",
                "https://esign.example.com/#x", "mailto:someone@example.com", "not an address", "https:///path")) {
            assertFalse(address, provider(settings(address), Map.of()).configured());
        }
        Map<String, String> http = settings("http://127.0.0.1:8092");
        http.put("nuxeo.agentic.signature.standin.http.allowed", "true");
        assertTrue(provider(http, Map.of()).configured());
    }

    @Test
    public void aSecretShorterThanThirtyTwoCharactersOrAKeyAHeaderCannotCarryIsNotUsed() {
        Map<String, String> properties = settings("https://esign.example.com");
        properties.put("nuxeo.agentic.signature.standin.callbackSecret", "a".repeat(31));
        assertFalse(provider(properties, Map.of()).configured());
        properties.put("nuxeo.agentic.signature.standin.callbackSecret", StandInStub.SECRET);
        properties.put("nuxeo.agentic.signature.standin.apiKey", "key\r\nX-Injected: yes");
        assertFalse(provider(properties, Map.of()).configured());
    }

    /**
     * The signature is the HMAC-SHA256 of {@code <t>.<body>}: a vector computed with OpenSSL, apart
     * from the JDK, which the stand-in service's selftest holds its own signing to as well.
     *
     * <pre>
     * printf '%s' '1790000000.{"id":"evt_1","type":"envelope.signed","envelope":"env_1"}' \
     *   | openssl dgst -sha256 -hmac 'test-callback-secret-0123456789abcdef-0123' -hex
     * </pre>
     */
    @Test
    public void theSignatureIsTheHmacSha256OfTheTimeAndTheBody() {
        assertEquals("43027280a4fd060c6233a9b1f34dfa7a0871d6ec529236dbbb579579c829771c",
                StandInProvider.sign(StandInStub.SECRET, "1790000000",
                        "{\"id\":\"evt_1\",\"type\":\"envelope.signed\",\"envelope\":\"env_1\"}"
                                .getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    public void anAuthenticCallbackIsReadAndItsSignedTimeReturned() {
        StandInProvider provider = provider(settings("https://esign.example.com"), Map.of());
        byte[] body = StandInStub.callbackBody("evt_9", "envelope.declined", "env_7", "Not my name");
        CallbackEvent event = provider.authenticate(new Callback(StandInStub.signedHeaders(StandInStub.SECRET,
                1_790_000_000L, body), body));
        assertEquals("evt_9", event.id());
        assertEquals("env_7", event.envelope());
        assertEquals(Outcome.DECLINED, event.outcome());
        assertEquals(Instant.ofEpochSecond(1_790_000_000L), event.timestamp());
        assertEquals("Not my name", event.reason());
        byte[] signed = StandInStub.callbackBody("evt_10", "envelope.signed", "env_7", null);
        assertEquals(Outcome.SIGNED, provider.authenticate(new Callback(StandInStub.signedHeaders(
                StandInStub.SECRET, 1L, signed), signed)).outcome());
        byte[] other = StandInStub.callbackBody("evt_11", "envelope.viewed", "env_7", null);
        CallbackEvent viewed = provider.authenticate(new Callback(StandInStub.signedHeaders(StandInStub.SECRET, 1L,
                other), other));
        assertEquals(Outcome.OTHER, viewed.outcome());
        assertNull(viewed.reason());
    }

    @Test
    public void aCallbackIsReadOnlyOnceItsSignatureMatches() {
        StandInProvider provider = provider(settings("https://esign.example.com"), Map.of());
        byte[] body = StandInStub.callbackBody("evt_9", "envelope.signed", "env_7", null);
        Map<String, String> good = StandInStub.signedHeaders(StandInStub.SECRET, 100L, body);
        assertRefused(provider, Map.of(), body, Reason.MISSING);
        assertRefused(provider, Map.of("x-standin-signature", "t=100"), body, Reason.MISSING);
        assertRefused(provider, Map.of("x-standin-signature", "v1=" + "a".repeat(64) + ",t=100"), body,
                Reason.MISSING);
        assertRefused(provider, StandInStub.signedHeaders("wrong-secret-0123456789-0123456789-xx", 100L, body), body,
                Reason.MISMATCH);
        assertRefused(provider, good, "{\"id\":\"evt_9\",\"type\":\"envelope.signed\",\"envelope\":\"env_8\"}"
                .getBytes(StandardCharsets.UTF_8), Reason.MISMATCH);
        // Authentic, and not a callback.
        byte[] array = "[1,2]".getBytes(StandardCharsets.UTF_8);
        assertRefused(provider, StandInStub.signedHeaders(StandInStub.SECRET, 100L, array), array, Reason.MALFORMED);
        byte[] trailing = "{\"id\":\"e\",\"type\":\"t\",\"envelope\":\"v\"} {}".getBytes(StandardCharsets.UTF_8);
        assertRefused(provider, StandInStub.signedHeaders(StandInStub.SECRET, 100L, trailing), trailing,
                Reason.MALFORMED);
        // With no secret on the server, nothing is authentic.
        Map<String, String> properties = settings("https://esign.example.com");
        properties.remove("nuxeo.agentic.signature.standin.callbackSecret");
        assertRefused(provider(properties, Map.of()), good, body, Reason.NOT_CONFIGURED);
    }

    private static void assertRefused(StandInProvider provider, Map<String, String> headers, byte[] body,
            Reason reason) {
        CallbackRefusedException e = assertThrows(CallbackRefusedException.class,
                () -> provider.authenticate(new Callback(headers, body)));
        assertEquals(reason, e.reason());
    }

    @Test
    public void whatCouldBeLoggedHoldsNoContentNoAddressAndNoSignature() {
        Envelope envelope = new Envelope("ref", "Subject", null, List.of(new Signer("Rowan Vale",
                "rowan.vale@example.com")), "a.pdf", "application/pdf", Desk.PDF, "00");
        assertFalse(envelope.toString().contains("rowan.vale@example.com"));
        assertFalse(envelope.toString().contains("%PDF"));
        byte[] body = StandInStub.callbackBody("evt_9", "envelope.signed", "env_7", null);
        Callback callback = new Callback(StandInStub.signedHeaders(StandInStub.SECRET, 100L, body), body);
        assertFalse(callback.toString().contains("v1="));
        assertFalse(callback.toString().contains("env_7"));
        assertFalse(new CallbackRefusedException(Reason.MISMATCH).getMessage().contains("v1="));
    }
}
