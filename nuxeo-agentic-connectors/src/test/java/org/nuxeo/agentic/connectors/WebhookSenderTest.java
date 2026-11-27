package org.nuxeo.agentic.connectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.connectors.WebhookSender.Outcome;
import org.nuxeo.agentic.connectors.WebhookSender.Result;
import org.nuxeo.agentic.connectors.WebhookSender.Target;

import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;

/**
 * The webhooks' sender against receivers on the loopback interface: what it sends, byte for byte;
 * the statuses and what each is; the bounds; the addresses it refuses after resolving; a redirect
 * not followed; and TLS, with a certificate made for the run.
 */
class WebhookSenderTest {

    private static final Duration CONNECT = Duration.ofSeconds(1);

    private static final Duration TIMEOUT = Duration.ofSeconds(2);

    private static final Map<String, String> HEADERS = Map.of("X-Nuxeo-Webhook", "test.claimUpdates");

    private static final byte[] BODY = "{\"delivery\":\"d\",\"event\":\"created\"}".getBytes(StandardCharsets.UTF_8);

    /** A receiver that answers each connection with the bytes it is given, and keeps what it read. */
    static final class Raw implements AutoCloseable {

        final ServerSocket server;

        final List<byte[]> requests = new CopyOnWriteArrayList<>();

        final AtomicInteger connections = new AtomicInteger();

        volatile byte[] answer = "HTTP/1.1 204 No Content\r\n\r\n".getBytes(StandardCharsets.US_ASCII);

        /** Sent one byte at a time with this pause, when not zero. */
        volatile long trickleMillis;

        /** Nothing answered, the connection held open, when true. */
        volatile boolean silent;

        Raw() throws IOException {
            server = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
            Thread accept = new Thread(this::serve, "raw-receiver");
            accept.setDaemon(true);
            accept.start();
        }

        int port() {
            return server.getLocalPort();
        }

        private void serve() {
            while (!server.isClosed()) {
                try {
                    Socket socket = server.accept();
                    connections.incrementAndGet();
                    Thread each = new Thread(() -> answer(socket));
                    each.setDaemon(true);
                    each.start();
                } catch (IOException e) {
                    return;
                }
            }
        }

        private void answer(Socket socket) {
            try (socket) {
                socket.setSoTimeout(5_000);
                requests.add(read(socket.getInputStream()));
                if (silent) {
                    Thread.sleep(5_000);
                    return;
                }
                OutputStream out = socket.getOutputStream();
                if (trickleMillis > 0) {
                    for (byte b : answer) {
                        out.write(b);
                        out.flush();
                        Thread.sleep(trickleMillis);
                    }
                } else {
                    out.write(answer);
                }
                out.flush();
            } catch (IOException | InterruptedException e) {
                // The sender went away, as it does once it has a status.
            }
        }

        /** The request's head, to the blank line, and its body, by its Content-Length. */
        private static byte[] read(InputStream in) throws IOException {
            ByteArrayOutputStream request = new ByteArrayOutputStream();
            int length = -1;
            StringBuilder line = new StringBuilder();
            int b;
            while ((b = in.read()) >= 0) {
                request.write(b);
                if (b == '\n') {
                    String text = line.toString().trim();
                    if (text.isEmpty()) {
                        break;
                    }
                    if (text.toLowerCase(java.util.Locale.ROOT).startsWith("content-length:")) {
                        length = Integer.parseInt(text.substring(15).trim());
                    }
                    line.setLength(0);
                } else {
                    line.append((char) b);
                }
            }
            if (length > 0) {
                request.write(in.readNBytes(length));
            }
            return request.toByteArray();
        }

        @Override
        public void close() throws IOException {
            server.close();
        }
    }

    private Raw raw;

    @AfterEach
    void tearDown() throws IOException {
        if (raw != null) {
            raw.close();
        }
    }

    private static WebhookSender sender(WebhookSender.Resolver resolver) {
        return new WebhookSender(resolver, javax.net.ssl.HttpsURLConnection.getDefaultSSLSocketFactory());
    }

    private static WebhookSender loopback() {
        return sender(InetAddress::getAllByName);
    }

    private Target local(String path) {
        return WebhookSender.target("http://127.0.0.1:" + raw.port() + path, true);
    }

    @Test
    void anAddressIsHttpsWithAHostAndNoUserQueryOrFragment() {
        Target target = WebhookSender.target("https://hooks.example.com/in/claims", false);
        assertEquals(new Target("https", "hooks.example.com", 443, "hooks.example.com", "/in/claims"), target);
        assertEquals(new Target("https", "hooks.example.com", 8443, "hooks.example.com:8443", "/"),
                WebhookSender.target("https://hooks.example.com:8443", false));
        assertEquals(new Target("https", "2606:4700::1", 8443, "[2606:4700::1]:8443", "/x"),
                WebhookSender.target("https://[2606:4700::1]:8443/x", false));
        assertNull(WebhookSender.target("http://hooks.example.com/in", false));
        assertEquals(new Target("http", "hooks.example.com", 80, "hooks.example.com", "/in"),
                WebhookSender.target("http://hooks.example.com/in", true));
        for (String address : new String[] { null, "", "hooks.example.com/in", "ftp://hooks.example.com/in",
                "https://user@hooks.example.com/in", "https://hooks.example.com/in?token=x",
                "https://hooks.example.com/in#part", "https:hooks.example.com", "https://hooks_example.com/in",
                "https://[fe80::1%25en0]/in", "https://hooks.example.com:0/in", "https:///in", "https://hooks.example.com/in\r\nX: y" }) {
            assertNull(WebhookSender.target(address, true), String.valueOf(address));
        }
    }

    @Test
    void itSendsOnePostWithTheHeadersAndTheBodyAndNothingElse() throws Exception {
        raw = new Raw();
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("X-Nuxeo-Webhook", "test.claimUpdates");
        headers.put("X-Nuxeo-Connector-Timestamp", "1795694400");
        Result result = loopback().send(local("/hooks/claims"), true, headers, BODY, CONNECT, TIMEOUT);
        assertEquals(new Result(Outcome.DELIVERED, 204, null), result);
        assertEquals(1, raw.requests.size());
        String request = new String(raw.requests.get(0), StandardCharsets.UTF_8);
        assertEquals("POST /hooks/claims HTTP/1.1\r\n" + "Host: 127.0.0.1:" + raw.port() + "\r\n"
                + "User-Agent: nuxeo-agentic-connectors\r\n" + "Content-Type: application/json\r\n"
                + "Content-Length: " + BODY.length + "\r\n" + "Connection: close\r\n"
                + "X-Nuxeo-Webhook: test.claimUpdates\r\n" + "X-Nuxeo-Connector-Timestamp: 1795694400\r\n\r\n"
                + new String(BODY, StandardCharsets.UTF_8), request);
    }

    @Test
    void eachStatusIsWhatItIs() throws Exception {
        raw = new Raw();
        Map<String, Outcome> expected = new LinkedHashMap<>();
        expected.put("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok", Outcome.DELIVERED);
        expected.put("HTTP/1.0 202 Accepted\r\n\r\n", Outcome.DELIVERED);
        expected.put("HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 103 Early Hints\r\nLink: </a>\r\n\r\nHTTP/1.1 204 No Content\r\n\r\n",
                Outcome.DELIVERED);
        expected.put("HTTP/1.1 301 Moved Permanently\r\nLocation: http://127.0.0.1:9/elsewhere\r\n\r\n",
                Outcome.REDIRECTED);
        expected.put("HTTP/1.1 400 Bad Request\r\n\r\n", Outcome.REJECTED);
        expected.put("HTTP/1.1 401 Unauthorized\r\n\r\n", Outcome.REJECTED);
        expected.put("HTTP/1.1 404 Not Found\r\n\r\n", Outcome.REJECTED);
        expected.put("HTTP/1.1 408 Request Timeout\r\n\r\n", Outcome.FAILED);
        expected.put("HTTP/1.1 429 Too Many Requests\r\n\r\n", Outcome.FAILED);
        expected.put("HTTP/1.1 500 Internal Server Error\r\n\r\n", Outcome.FAILED);
        expected.put("HTTP/1.1 503 Service Unavailable\r\n\r\n", Outcome.FAILED);
        expected.put("HTTP/1.1 101 Switching Protocols\r\n\r\n", Outcome.FAILED);
        expected.put("SSH-2.0-OpenSSH_9.6\r\n", Outcome.FAILED);
        expected.put("HTTP/2 200\r\n\r\n", Outcome.FAILED);
        expected.put("", Outcome.FAILED);
        for (Map.Entry<String, Outcome> each : expected.entrySet()) {
            raw.answer = each.getKey().getBytes(StandardCharsets.US_ASCII);
            Result result = loopback().send(local("/"), true, HEADERS, BODY, CONNECT, TIMEOUT);
            assertEquals(each.getValue(), result.outcome(), each.getKey());
        }
        assertTrue(Outcome.FAILED.retried && Outcome.TIMEOUT.retried && Outcome.UNREACHABLE.retried);
        for (Outcome never : new Outcome[] { Outcome.REDIRECTED, Outcome.REJECTED, Outcome.TLS,
                Outcome.ADDRESS_REFUSED, Outcome.NOT_CONFIGURED, Outcome.UNKNOWN_WEBHOOK, Outcome.TOO_LARGE }) {
            assertTrue(!never.retried, never.name());
        }
    }

    @Test
    void aRedirectIsNotFollowed() throws Exception {
        raw = new Raw();
        try (Raw elsewhere = new Raw()) {
            raw.answer = ("HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:" + elsewhere.port()
                    + "/hooks/claims\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
            Result result = loopback().send(local("/hooks/claims"), true, HEADERS, BODY, CONNECT, TIMEOUT);
            assertEquals(new Result(Outcome.REDIRECTED, 307, null), result);
            Thread.sleep(200);
            assertEquals(0, elsewhere.connections.get());
        }
    }

    @Test
    void anAttemptHasOneDeadlineThatATrickleCannotPass() throws Exception {
        raw = new Raw();
        raw.silent = true;
        long started = System.nanoTime();
        Result silent = loopback().send(local("/"), true, HEADERS, BODY, CONNECT, Duration.ofMillis(500));
        assertEquals(Outcome.TIMEOUT, silent.outcome());
        assertTrue(Duration.ofNanos(System.nanoTime() - started).toMillis() < 2_000);

        raw.silent = false;
        raw.trickleMillis = 100;
        raw.answer = "HTTP/1.1 204 No Content\r\n\r\n".getBytes(StandardCharsets.US_ASCII);
        started = System.nanoTime();
        Result trickle = loopback().send(local("/"), true, HEADERS, BODY, CONNECT, Duration.ofMillis(800));
        assertEquals(Outcome.TIMEOUT, trickle.outcome());
        assertTrue(Duration.ofNanos(System.nanoTime() - started).toMillis() < 2_000);
    }

    @Test
    void aStatusLineLongerThanTheBoundIsNotReadFurther() throws Exception {
        raw = new Raw();
        raw.answer = ("HTTP/1.1 200 " + "x".repeat(WebhookSender.MAX_STATUS_LINE + 10) + "\r\n\r\n")
                                                                                                .getBytes(StandardCharsets.US_ASCII);
        assertEquals(Outcome.FAILED, loopback().send(local("/"), true, HEADERS, BODY, CONNECT, TIMEOUT).outcome());
    }

    @Test
    void aClosedPortIsUnreachableAndAnUnknownNameToo() throws Exception {
        int closed;
        try (ServerSocket socket = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            closed = socket.getLocalPort();
        }
        Target target = WebhookSender.target("http://127.0.0.1:" + closed + "/", true);
        assertEquals(Outcome.UNREACHABLE, loopback().send(target, true, HEADERS, BODY, CONNECT, TIMEOUT).outcome());
        WebhookSender none = sender(host -> {
            throw new UnknownHostException(host);
        });
        assertEquals(Outcome.UNREACHABLE,
                none.send(WebhookSender.target("https://hooks.example.test/", false), true, HEADERS, BODY, CONNECT,
                        TIMEOUT).outcome());
    }

    @Test
    void everyAddressANameResolvesToIsCheckedAndTheOneCheckedIsTheOneConnectedTo() throws Exception {
        raw = new Raw();
        AtomicInteger asked = new AtomicInteger();
        InetAddress[][] answer = { { InetAddress.getByName("127.0.0.1") } };
        WebhookSender dns = sender(host -> {
            asked.incrementAndGet();
            return answer[0];
        });
        Target named = WebhookSender.target("http://receiver.example.test:" + raw.port() + "/in", true);

        assertEquals(new Result(Outcome.ADDRESS_REFUSED, 0, "loopback"),
                dns.send(named, false, HEADERS, BODY, CONNECT, TIMEOUT));
        answer[0] = new InetAddress[] { InetAddress.getByName("93.184.215.14"), InetAddress.getByName("127.0.0.1") };
        assertEquals(new Result(Outcome.ADDRESS_REFUSED, 0, "loopback"),
                dns.send(named, false, HEADERS, BODY, CONNECT, TIMEOUT));
        answer[0] = new InetAddress[] { InetAddress.getByName("169.254.169.254") };
        assertEquals(new Result(Outcome.ADDRESS_REFUSED, 0, "link-local"),
                dns.send(named, true, HEADERS, BODY, CONNECT, TIMEOUT));
        answer[0] = new InetAddress[0];
        assertEquals(Outcome.UNREACHABLE, dns.send(named, true, HEADERS, BODY, CONNECT, TIMEOUT).outcome());
        assertEquals(0, raw.connections.get(), "nothing was connected to");

        answer[0] = new InetAddress[] { InetAddress.getByName("127.0.0.1") };
        asked.set(0);
        assertEquals(Outcome.DELIVERED, dns.send(named, true, HEADERS, BODY, CONNECT, TIMEOUT).outcome());
        assertEquals(1, asked.get(), "resolved once");
        assertTrue(new String(raw.requests.get(0), StandardCharsets.US_ASCII)
                                                                          .contains("\r\nHost: receiver.example.test:" + raw.port() + "\r\n"));
    }

    @Test
    void aHeaderThatCouldBreakTheRequestIsNeverWritten() throws Exception {
        raw = new Raw();
        for (Map<String, String> headers : List.of(Map.of("X-Nuxeo-Webhook", "a\r\nX-Injected: yes"),
                Map.of("X-Bad Name", "v"), Map.of("X-Nuxeo-Webhook", "café"))) {
            assertThrows(IllegalArgumentException.class,
                    () -> loopback().send(local("/"), true, headers, BODY, CONNECT, TIMEOUT));
        }
        assertEquals(0, raw.requests.size());
    }

    /**
     * TLS, with a certificate made for this run by the JDK's keytool for {@code receiver.example.test}:
     * delivered when the name is the certificate's and it is trusted; refused for another name, and
     * for the JVM's default trust, which does not hold it.
     */
    @Test
    void tlsChecksTheCertificateAgainstTheHostName() throws Exception {
        Path dir = Files.createTempDirectory("webhook-tls");
        String password = Fixtures.generatedSecret();
        Path store = dir.resolve("receiver.p12");
        ProcessBuilder keytool = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "keytool").toString(),
                "-genkeypair", "-alias", "receiver", "-keyalg", "EC", "-groupname", "secp256r1", "-dname",
                "CN=receiver.example.test", "-ext", "SAN=dns:receiver.example.test", "-validity", "2", "-keystore",
                store.toString(), "-storetype", "PKCS12", "-storepass:env", "WEBHOOK_TEST_STORE", "-keypass:env",
                "WEBHOOK_TEST_STORE").redirectErrorStream(true);
        keytool.environment().put("WEBHOOK_TEST_STORE", password);
        Process run = keytool.start();
        run.getInputStream().readAllBytes();
        assertEquals(0, run.waitFor(), "keytool made the certificate");

        KeyStore keys = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(store)) {
            keys.load(in, password.toCharArray());
        }
        KeyManagerFactory keyManagers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        keyManagers.init(keys, password.toCharArray());
        SSLContext serverTls = SSLContext.getInstance("TLS");
        serverTls.init(keyManagers.getKeyManagers(), null, null);
        KeyStore trusted = KeyStore.getInstance("PKCS12");
        trusted.load(null, null);
        trusted.setCertificateEntry("receiver", keys.getCertificate("receiver"));
        TrustManagerFactory trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        trust.init(trusted);
        SSLContext clientTls = SSLContext.getInstance("TLS");
        clientTls.init(null, trust.getTrustManagers(), null);

        HttpsServer server = HttpsServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.setHttpsConfigurator(new HttpsConfigurator(serverTls));
        List<String> hosts = new CopyOnWriteArrayList<>();
        server.createContext("/in", exchange -> {
            hosts.add(exchange.getRequestHeaders().getFirst("Host"));
            exchange.getRequestBody().readAllBytes();
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        server.start();
        try {
            int port = server.getAddress().getPort();
            WebhookSender.Resolver toLoopback = host -> new InetAddress[] { InetAddress.getByName("127.0.0.1") };
            WebhookSender trusting = new WebhookSender(toLoopback, clientTls.getSocketFactory());
            Target named = WebhookSender.target("https://receiver.example.test:" + port + "/in", false);
            assertNotNull(named);
            assertEquals(new Result(Outcome.DELIVERED, 204, null),
                    trusting.send(named, true, HEADERS, BODY, CONNECT, TIMEOUT));
            assertEquals(List.of("receiver.example.test:" + port), hosts);

            Target other = WebhookSender.target("https://other.example.test:" + port + "/in", false);
            assertEquals(Outcome.TLS, trusting.send(other, true, HEADERS, BODY, CONNECT, TIMEOUT).outcome());
            WebhookSender platform = new WebhookSender(toLoopback,
                    javax.net.ssl.HttpsURLConnection.getDefaultSSLSocketFactory());
            assertEquals(Outcome.TLS, platform.send(named, true, HEADERS, BODY, CONNECT, TIMEOUT).outcome());
            assertEquals(1, hosts.size(), "nothing reached the receiver but the trusted, named delivery");
        } finally {
            server.stop(0);
            Files.deleteIfExists(store);
            Files.deleteIfExists(dir);
        }
    }
}
