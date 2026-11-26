/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import org.nuxeo.agentic.signature.standin.StandInProvider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * The stand-in e-signature service, as {@code demo/esign-stand-in.mjs} answers, on the loopback
 * interface, for the tests: it takes envelopes with the API key, gives a signed envelope's result,
 * and voids one; and it makes callbacks as the service signs them. What it was asked is kept, so a
 * test can say nothing was sent. Each answer can be made to fail, one way at a time.
 */
final class StandInStub implements AutoCloseable {

    static final String API_KEY = "test-api-key-0123456789abcdef";

    static final String SECRET = "test-callback-secret-0123456789abcdef-0123";

    private static final ObjectMapper JSON = new ObjectMapper();

    /** An envelope as the stub keeps it. */
    record Sent(String id, JsonNode body, byte[] content) {
    }

    /** How the stub answers, one way of failing at a time. */
    enum Mode {
        NORMAL, SEND_FAILS, NOT_SIGNED, PENDING, TAMPERED, REDIRECT
    }

    private final HttpServer server;

    private final Map<String, Sent> envelopes = new ConcurrentHashMap<>();

    /** Each envelope's status as the service says it, "sent" until a test declares another. */
    private final Map<String, String> statuses = new ConcurrentHashMap<>();

    final List<String> requests = Collections.synchronizedList(new ArrayList<>());

    final List<String> voided = Collections.synchronizedList(new ArrayList<>());

    private final AtomicInteger next = new AtomicInteger();

    volatile Mode mode = Mode.NORMAL;

    StandInStub() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/", this::handle);
        server.start();
    }

    String address() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    /** What the service says of an envelope from now on: what its signer did, as a test plays it. */
    void declare(String id, String status) {
        statuses.put(id, status);
    }

    Sent envelope(String id) {
        return envelopes.get(id);
    }

    int envelopeCount() {
        return envelopes.size();
    }

    private void handle(HttpExchange exchange) throws IOException {
        String method = exchange.getRequestMethod();
        String path = exchange.getRequestURI().getPath();
        requests.add(method + " " + path);
        byte[] body = exchange.getRequestBody().readAllBytes();
        if (!("Bearer " + API_KEY).equals(exchange.getRequestHeaders().getFirst("Authorization"))) {
            answer(exchange, 401, "{\"error\":\"unauthorized\"}");
            return;
        }
        if (mode == Mode.REDIRECT) {
            exchange.getResponseHeaders().add("Location", "http://127.0.0.1:1/elsewhere");
            answer(exchange, 302, "{}");
            return;
        }
        if ("POST".equals(method) && "/envelopes".equals(path)) {
            if (mode == Mode.SEND_FAILS) {
                answer(exchange, 500, "{\"error\":\"the stub fails\"}");
                return;
            }
            JsonNode sent = JSON.readTree(body);
            String id = "env_" + next.incrementAndGet();
            byte[] content = Base64.getDecoder().decode(sent.path("document").path("content").asText());
            envelopes.put(id, new Sent(id, sent, content));
            answer(exchange, 201, "{\"id\":\"" + id + "\",\"status\":\"sent\"}");
            return;
        }
        String[] parts = path.split("/");
        // "", "envelopes", id[, "result"]
        if (parts.length >= 3 && "envelopes".equals(parts[1])) {
            Sent sent = envelopes.get(parts[2]);
            if ("GET".equals(method) && parts.length == 3) {
                answer(exchange, sent == null ? 404 : 200, sent == null ? "{\"error\":\"not found\"}"
                        : "{\"id\":\"" + sent.id() + "\",\"status\":\"" + statuses.getOrDefault(sent.id(), "sent") + "\"}");
                return;
            }
            if ("DELETE".equals(method) && parts.length == 3) {
                voided.add(parts[2]);
                answer(exchange, sent == null ? 404 : 204, null);
                return;
            }
            if ("GET".equals(method) && parts.length == 4 && "result".equals(parts[3])) {
                if (sent == null) {
                    answer(exchange, 404, "{\"error\":\"not found\"}");
                    return;
                }
                if (mode == Mode.NOT_SIGNED) {
                    answer(exchange, 409, "{\"error\":\"not signed\"}");
                    return;
                }
                answer(exchange, 200, result(sent));
                return;
            }
        }
        answer(exchange, 404, "{\"error\":\"not found\"}");
    }

    /** The signed file as the stand-in makes it: the original and a trailer saying so. */
    static byte[] signed(byte[] original, String id) {
        byte[] trailer = ("\n% Signed by the stand-in e-signature service, envelope " + id + ".\n")
                .getBytes(StandardCharsets.US_ASCII);
        byte[] signed = new byte[original.length + trailer.length];
        System.arraycopy(original, 0, signed, 0, original.length);
        System.arraycopy(trailer, 0, signed, original.length, trailer.length);
        return signed;
    }

    static byte[] evidence(String id) {
        return ("{\"envelope\":\"" + id + "\",\"service\":\"stand-in\"}").getBytes(StandardCharsets.UTF_8);
    }

    private String result(Sent sent) throws IOException {
        byte[] signed = signed(sent.content(), sent.id());
        ObjectNode result = JSON.createObjectNode();
        result.put("envelope", sent.id());
        result.put("status", mode == Mode.PENDING ? "sent" : "signed");
        ObjectNode document = result.putObject("document");
        document.put("fileName", sent.body().path("document").path("fileName").asText());
        document.put("mimeType", "application/pdf");
        document.put("sha256", mode == Mode.TAMPERED ? sha256(sent.content()) : sha256(signed));
        document.put("content", Base64.getEncoder().encodeToString(signed));
        ObjectNode evidence = result.putObject("evidence");
        evidence.put("fileName", sent.id() + "-evidence.json");
        evidence.put("mimeType", "application/json");
        evidence.put("content", Base64.getEncoder().encodeToString(evidence(sent.id())));
        return JSON.writeValueAsString(result);
    }

    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void answer(HttpExchange exchange, int status, String body) throws IOException {
        if (body == null) {
            exchange.sendResponseHeaders(status, -1);
            exchange.close();
            return;
        }
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    // ------------------------------------------------------------------ callbacks

    /** A callback's body, as the service sends one. */
    static byte[] callbackBody(String eventId, String type, String envelope, String reason) {
        ObjectNode event = JSON.createObjectNode();
        event.put("id", eventId);
        event.put("type", type);
        event.put("envelope", envelope);
        if (reason != null) {
            event.put("reason", reason);
        }
        try {
            return JSON.writeValueAsBytes(event);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The headers of a callback signed with {@code secret} at {@code epochSeconds}, by lower-case name. */
    static Map<String, String> signedHeaders(String secret, long epochSeconds, byte[] body) {
        String time = Long.toString(epochSeconds);
        return Map.of(StandInProvider.SIGNATURE_HEADER.toLowerCase(), "t=" + time + ",v1="
                + StandInProvider.sign(secret, time, body), "content-type", "application/json");
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
