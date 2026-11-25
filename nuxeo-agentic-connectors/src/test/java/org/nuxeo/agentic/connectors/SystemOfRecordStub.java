package org.nuxeo.agentic.connectors;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * A system of record on the loopback interface, for tests: each path answers as a test sets it,
 * and every request is kept, so a test can say that nothing was sent as surely as what was.
 * Unset paths answer 404.
 */
final class SystemOfRecordStub implements AutoCloseable {

    /** One request as the stub received it. */
    record Received(String method, String path, String rawQuery, Map<String, List<String>> headers) {

        String header(String name) {
            for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
                if (entry.getKey().equalsIgnoreCase(name)) {
                    return entry.getValue().get(0);
                }
            }
            return null;
        }
    }

    /** How a path answers. {@code chunked} sends no Content-Length; {@code stallMillis} waits mid-body. */
    record Answer(int status, String contentType, byte[] body, long delayMillis, boolean chunked,
            long stallMillis, Map<String, String> headers) {

        static Answer json(String body) {
            return new Answer(200, "application/json", body.getBytes(StandardCharsets.UTF_8), 0, false, 0, Map.of());
        }

        Answer status(int status) {
            return new Answer(status, contentType, body, delayMillis, chunked, stallMillis, headers);
        }

        Answer contentType(String contentType) {
            return new Answer(status, contentType, body, delayMillis, chunked, stallMillis, headers);
        }

        Answer delay(long millis) {
            return new Answer(status, contentType, body, millis, chunked, stallMillis, headers);
        }

        Answer withoutLength() {
            return new Answer(status, contentType, body, delayMillis, true, stallMillis, headers);
        }

        Answer stallMidBody(long millis) {
            return new Answer(status, contentType, body, delayMillis, true, millis, headers);
        }

        Answer header(String name, String value) {
            Map<String, String> more = new java.util.LinkedHashMap<>(headers);
            more.put(name, value);
            return new Answer(status, contentType, body, delayMillis, chunked, stallMillis, more);
        }
    }

    private final HttpServer server;

    private final Map<String, Answer> answers = new ConcurrentHashMap<>();

    final List<Received> received = new CopyOnWriteArrayList<>();

    SystemOfRecordStub() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.setExecutor(Executors.newCachedThreadPool());
        server.createContext("/", this::handle);
        server.start();
    }

    /** {@code http://127.0.0.1:<port>}, with no trailing slash. */
    String address() {
        return "http://" + server.getAddress().getHostString() + ":" + server.getAddress().getPort();
    }

    SystemOfRecordStub answer(String path, Answer answer) {
        answers.put(path, answer);
        return this;
    }

    private void handle(HttpExchange exchange) throws IOException {
        received.add(new Received(exchange.getRequestMethod(), exchange.getRequestURI().getRawPath(),
                exchange.getRequestURI().getRawQuery(), Map.copyOf(exchange.getRequestHeaders())));
        Answer answer = answers.getOrDefault(exchange.getRequestURI().getRawPath(),
                new Answer(404, "application/json", "{\"error\":\"none\"}".getBytes(StandardCharsets.UTF_8), 0,
                        false, 0, Map.of()));
        try {
            if (answer.delayMillis() > 0) {
                Thread.sleep(answer.delayMillis());
            }
            if (answer.contentType() != null) {
                exchange.getResponseHeaders().set("Content-Type", answer.contentType());
            }
            answer.headers().forEach((name, value) -> exchange.getResponseHeaders().set(name, value));
            exchange.sendResponseHeaders(answer.status(),
                    answer.chunked() ? 0 : answer.body().length == 0 ? -1 : answer.body().length);
            try (OutputStream out = exchange.getResponseBody()) {
                if (answer.stallMillis() > 0) {
                    out.write(answer.body(), 0, Math.min(16, answer.body().length));
                    out.flush();
                    Thread.sleep(answer.stallMillis());
                    out.write(answer.body(), Math.min(16, answer.body().length),
                            Math.max(0, answer.body().length - 16));
                } else {
                    out.write(answer.body());
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (IOException e) {
            // The client went away, as a client that refuses a body does.
        } finally {
            exchange.close();
        }
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
