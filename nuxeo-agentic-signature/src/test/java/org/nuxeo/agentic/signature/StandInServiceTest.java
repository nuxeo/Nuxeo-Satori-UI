/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.After;
import org.junit.Assume;
import org.junit.Before;
import org.junit.Test;
import org.nuxeo.agentic.signature.CallbackEvent.Outcome;
import org.nuxeo.agentic.signature.Envelope.Signer;
import org.nuxeo.agentic.signature.standin.StandInProvider;

import com.sun.net.httpserver.HttpServer;

/**
 * The stand-in provider and the stand-in service, {@code demo/esign-stand-in.mjs}, as the demo runs
 * them: the provider sends a file to the real service, the service's signer posts its callback,
 * signed with the secret, to a receiver standing for Nuxeo, the provider authenticates it, and
 * fetches the signed file and its evidence. So the two speak the same protocol, which the stub of
 * the other tests only copies. Needs {@code node} on the path, as the build that runs these tests
 * has for the client; without it the test is skipped, and says so.
 */
public class StandInServiceTest {

    private static final String API_KEY = "interop-fictional-api-key-0123456789";

    private static final String SECRET = "interop-fictional-callback-secret-0123456789";

    private Process service;

    private HttpServer nuxeo;

    private final BlockingQueue<Callback> callbacks = new ArrayBlockingQueue<>(10);

    private String base;

    private StandInProvider provider;

    @Before
    public void setUp() throws Exception {
        Assume.assumeTrue("node is not on the path: the stand-in service is not run", nodeAvailable());
        nuxeo = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        nuxeo.createContext("/nuxeo/agentic-signature/callback/standin", exchange -> {
            Map<String, String> headers = new HashMap<>();
            exchange.getRequestHeaders().forEach((name, values) -> headers.put(name.toLowerCase(Locale.ROOT),
                    values.get(0)));
            callbacks.add(new Callback(headers, exchange.getRequestBody().readAllBytes()));
            byte[] answer = "{\"status\":\"received\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, answer.length);
            exchange.getResponseBody().write(answer);
            exchange.close();
        });
        nuxeo.start();
        ProcessBuilder builder = new ProcessBuilder("node", Path.of("demo", "esign-stand-in.mjs").toString(),
                "--port", "0").redirectErrorStream(true);
        builder.environment().put("STANDIN_API_KEY", API_KEY);
        builder.environment().put("STANDIN_CALLBACK_SECRET", SECRET);
        builder.environment().put("NUXEO_CALLBACK_URL",
                "http://127.0.0.1:" + nuxeo.getAddress().getPort() + "/nuxeo/agentic-signature/callback/standin");
        service = builder.start();
        BufferedReader out = new BufferedReader(new InputStreamReader(service.getInputStream(), StandardCharsets.UTF_8));
        Pattern started = Pattern.compile("answers on (http://[^/]+)/envelopes");
        long deadline = System.currentTimeMillis() + 10_000;
        while (base == null && System.currentTimeMillis() < deadline) {
            String line = out.readLine();
            if (line == null) {
                break;
            }
            Matcher matcher = started.matcher(line);
            if (matcher.find()) {
                base = matcher.group(1);
            }
        }
        assertNotNull("the stand-in service did not start", base);
        // Drain the rest, so that the service never blocks on a full pipe.
        Thread drain = new Thread(() -> {
            try {
                while (out.readLine() != null) {
                    // Its log: method, path and status.
                }
            } catch (IOException e) {
                // The service stopped.
            }
        });
        drain.setDaemon(true);
        drain.start();
        Map<String, String> properties = Map.of("nuxeo.agentic.signature.standin.address", base,
                "nuxeo.agentic.signature.standin.http.allowed", "true", "nuxeo.agentic.signature.standin.apiKey",
                API_KEY, "nuxeo.agentic.signature.standin.callbackSecret", SECRET);
        provider = new StandInProvider();
        provider.init("standin", new SignatureSettings(properties::get, name -> null));
    }

    @After
    public void tearDown() {
        if (service != null) {
            service.destroy();
        }
        if (nuxeo != null) {
            nuxeo.stop(0);
        }
    }

    private static boolean nodeAvailable() {
        try {
            Process node = new ProcessBuilder("node", "--version").redirectErrorStream(true).start();
            return node.waitFor(10, TimeUnit.SECONDS) && node.exitValue() == 0;
        } catch (IOException e) {
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    /** The demo's signer: what {@code esign-stand-in.mjs sign <envelope>} does. */
    private int act(String envelope, String action) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(base + "/envelopes/" + envelope + "/" + action))
                                         .header("Authorization", "Bearer " + API_KEY)
                                         .header("Content-Type", "application/json")
                                         .POST(HttpRequest.BodyPublishers.ofString(
                                                 "{\"reason\":\"The address is wrong\"}"))
                                         .build();
        try (HttpClient client = HttpClient.newHttpClient()) {
            return client.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
        }
    }

    private Envelope envelope() {
        return new Envelope("ref-1", "Account agreement", "Please sign.",
                List.of(new Signer("Rowan Vale", "rowan.vale@example.com")), "agreement.pdf", "application/pdf",
                Desk.PDF, StandInStub.sha256(Desk.PDF));
    }

    @Test
    public void theProviderAndTheServiceSpeakTheSameProtocol() throws Exception {
        assertTrue(provider.configured());
        String envelope = provider.send(envelope());
        assertTrue(envelope, Signatures.EXTERNAL_ID.matcher(envelope).matches());
        assertEquals(SignatureProvider.EnvelopeStatus.OUT, provider.status(envelope));
        // Not signed yet: the service says so, and the provider files nothing.
        SignatureProviderException early = assertThrows(SignatureProviderException.class,
                () -> provider.fetchSigned(envelope));
        assertEquals(SignatureProviderException.Kind.NOT_SIGNED, early.kind());

        assertEquals(200, act(envelope, "sign"));
        Callback callback = callbacks.poll(10, TimeUnit.SECONDS);
        assertNotNull("no callback came", callback);
        CallbackEvent event = provider.authenticate(callback);
        assertEquals(envelope, event.envelope());
        assertEquals(Outcome.SIGNED, event.outcome());
        assertTrue(Duration.between(event.timestamp(), Instant.now()).abs().getSeconds() < 30);

        assertEquals(SignatureProvider.EnvelopeStatus.SIGNED, provider.status(envelope));
        SignedResult result = provider.fetchSigned(envelope);
        assertEquals("application/pdf", result.mimeType());
        assertArrayEquals(Desk.PDF, java.util.Arrays.copyOf(result.content(), Desk.PDF.length));
        assertTrue(result.content().length > Desk.PDF.length);
        String evidence = new String(result.evidence(), StandardCharsets.UTF_8);
        assertTrue(evidence, evidence.contains(StandInStub.sha256(Desk.PDF)));
        assertEquals("application/json", result.evidenceMimeType());
    }

    @Test
    public void aDeclineAndAVoidReachTheProviderAsTheyShould() throws Exception {
        String declined = provider.send(envelope());
        assertEquals(200, act(declined, "decline"));
        CallbackEvent event = provider.authenticate(callbacks.poll(10, TimeUnit.SECONDS));
        assertEquals(Outcome.DECLINED, event.outcome());
        assertEquals("The address is wrong", event.reason());
        assertEquals(SignatureProvider.EnvelopeStatus.DECLINED, provider.status(declined));

        String voided = provider.send(envelope());
        provider.cancel(voided);
        assertEquals(SignatureProvider.EnvelopeStatus.VOIDED, provider.status(voided));
        assertEquals(409, act(voided, "sign"));

        // A callback the service signed with another secret is not the provider's.
        StandInProvider other = new StandInProvider();
        Map<String, String> properties = Map.of("nuxeo.agentic.signature.standin.address", base,
                "nuxeo.agentic.signature.standin.http.allowed", "true", "nuxeo.agentic.signature.standin.apiKey",
                API_KEY, "nuxeo.agentic.signature.standin.callbackSecret", "another-secret-0123456789-0123456789-x");
        other.init("standin", new SignatureSettings(properties::get, name -> null));
        String signed = provider.send(envelope());
        assertEquals(200, act(signed, "sign"));
        Callback callback = callbacks.poll(10, TimeUnit.SECONDS);
        assertThrows(CallbackRefusedException.class, () -> other.authenticate(callback));
    }
}
