package org.nuxeo.agentic.connectors;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLException;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Sends one webhook delivery: one {@code POST}, over HTTP/1.1, to the receiver's address, and reads
 * its status and nothing else.
 *
 * <ul>
 * <li><b>Where:</b> the host of the address the server sets, and no other. The host name is resolved
 * once, and <b>every</b> address it resolves to must be one a webhook may send to
 * ({@link WebhookAddresses}): a name that answers with one private address among public ones is
 * refused whole. The connection is then made to the address that was checked, not to the name
 * again, so a second DNS answer cannot move it. No proxy is used, and no redirect is followed: a
 * {@code 3xx} is an outcome, {@link Outcome#REDIRECTED}, and its {@code Location} is not read.</li>
 * <li><b>TLS:</b> for {@code https}, the server's default trust, the host name sent as SNI, and the
 * certificate checked against the host name, as an HTTPS client checks it.</li>
 * <li><b>Bounds:</b> a connect timeout, and one deadline for the whole attempt, the connection,
 * the handshake, the request and the status line, held by closing the socket when it passes, so
 * that neither a write the receiver does not read nor a TLS record trickled a byte at a time can
 * outlast it; a status line longer than {@value #MAX_STATUS_LINE} bytes is not read further. The
 * answer's headers past the status and its body are never read: the connection is closed. The
 * name's resolution is the JVM's, with its own timeouts, before the deadline starts.</li>
 * </ul>
 *
 * The JDK's own sockets, so that the connection goes to the address checked; Java's HTTP client
 * resolves the name itself when it connects.
 */
final class WebhookSender {

    static final String USER_AGENT = SystemOfRecordClient.USER_AGENT;

    static final int MAX_STATUS_LINE = 8192;

    /** The informational answers read past, at most, before the final one. */
    static final int MAX_INFORMATIONAL = 5;

    private static final Pattern STATUS_LINE = Pattern.compile("HTTP/1\\.[01] ([1-5][0-9]{2})(?: .*)?");

    /** Resolves a host name to its addresses, as the platform's DNS does; a test gives its own. */
    @FunctionalInterface
    interface Resolver {
        InetAddress[] resolve(String host) throws UnknownHostException;
    }

    /** What an attempt came to. {@code retried}: whether another attempt may come to something else. */
    enum Outcome {
        /** A {@code 2xx}. */
        DELIVERED(false),
        /** A {@code 3xx}, which is never followed. */
        REDIRECTED(false),
        /** A {@code 4xx} but {@code 408}, {@code 425} and {@code 429}: the receiver refuses it as it is. */
        REJECTED(false),
        /** A {@code 5xx}, a {@code 408}, {@code 425} or {@code 429}, or an answer that is not HTTP. */
        FAILED(true),
        /** The name did not resolve, or the address could not be reached. */
        UNREACHABLE(true),
        /** No status within the attempt's deadline. */
        TIMEOUT(true),
        /**
         * The TLS handshake failed for a reason another attempt would not change: a certificate the
         * server does not trust, or not the host's, or a protocol the receiver refuses.
         */
        TLS(false),
        /** The host resolved to an address a webhook may not send to: nothing was sent. */
        ADDRESS_REFUSED(false),
        /** The address or the secret is missing or unusable on this server: nothing was sent. */
        NOT_CONFIGURED(false),
        /** The webhook is no longer registered: nothing was sent. */
        UNKNOWN_WEBHOOK(false),
        /** The payload is larger than a delivery may be: nothing was sent. */
        TOO_LARGE(false),
        /** The payload is no longer kept, its time in the store passed: nothing was sent. */
        NO_PAYLOAD(false);

        final boolean retried;

        Outcome(boolean retried) {
            this.retried = retried;
        }

        /** The name in the log, the audit and the admin's list. */
        String label() {
            return name().toLowerCase(Locale.ROOT).replace('_', '-');
        }

        static Outcome ofStatus(int status) {
            if (status >= 200 && status < 300) {
                return DELIVERED;
            }
            if (status >= 300 && status < 400) {
                return REDIRECTED;
            }
            if (status == 408 || status == 425 || status == 429 || status >= 500) {
                return FAILED;
            }
            if (status >= 400) {
                return REJECTED;
            }
            return FAILED;
        }
    }

    /**
     * What an attempt came to: its outcome, the receiver's status when there was one, else 0, and
     * what to log: the kind of address refused, or the class of the failure. Never the address, the
     * payload or anything the receiver sent but its status.
     */
    record Result(Outcome outcome, int status, String detail) {

        static Result of(Outcome outcome, String detail) {
            return new Result(outcome, 0, detail);
        }
    }

    /**
     * Where a delivery goes, read from the address the server sets: the scheme, the host as resolved
     * (an IPv6 literal without its brackets), the port, the {@code Host} header and the path.
     */
    record Target(String scheme, String host, int port, String hostHeader, String path) {

        boolean tls() {
            return "https".equals(scheme);
        }
    }

    private final Resolver resolver;

    private final SSLSocketFactory tls;

    /** One thread for every attempt's deadline: it only closes sockets. The sender's own, stopped with it. */
    private final ScheduledExecutorService deadlines = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "agentic-webhooks-deadlines");
        thread.setDaemon(true);
        return thread;
    });

    WebhookSender(Resolver resolver, SSLSocketFactory tls) {
        this.resolver = resolver;
        this.tls = tls;
    }

    /** The platform's DNS, and the JVM's default trust. */
    static WebhookSender platform() {
        try {
            return new WebhookSender(InetAddress::getAllByName, SSLContext.getDefault().getSocketFactory());
        } catch (java.security.NoSuchAlgorithmException e) {
            // Every Java runtime has a default TLS context.
            throw new IllegalStateException(e);
        }
    }

    /**
     * The target of an address, or {@code null} when it is not one a webhook may send to: {@code https},
     * or {@code http} where {@code httpAllowed}, with a host and no user, query or fragment.
     */
    static Target target(String address, boolean httpAllowed) {
        if (address == null) {
            return null;
        }
        URI uri;
        try {
            uri = new URI(address);
        } catch (URISyntaxException e) {
            return null;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !(scheme.equals("http") && httpAllowed)) {
            return null;
        }
        if (uri.isOpaque() || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null
                || uri.getRawFragment() != null) {
            return null;
        }
        String host = uri.getHost();
        String bare = host.startsWith("[") && host.endsWith("]") ? host.substring(1, host.length() - 1) : host;
        if (bare.isEmpty() || bare.contains("%") || bare.endsWith(".")) {
            // No IPv6 zone: an interface of the server's is not a receiver's address. No trailing dot:
            // TLS takes no such name as SNI, nor checks a certificate against it.
            return null;
        }
        int defaultPort = scheme.equals("https") ? 443 : 80;
        int port = uri.getPort() == -1 ? defaultPort : uri.getPort();
        if (port < 1 || port > 65535) {
            return null;
        }
        String path = uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath();
        String hostHeader = host + (port == defaultPort ? "" : ":" + port);
        if (!printable(hostHeader) || !printable(path) || !path.startsWith("/")) {
            return null;
        }
        return new Target(scheme, bare, port, hostHeader, path);
    }

    /**
     * One attempt: the body {@code POST}ed with these headers, within the timeouts, to the target's
     * host as resolved and checked now.
     */
    Result send(Target target, boolean privateAllowed, Map<String, String> headers, byte[] body,
            Duration connectTimeout, Duration timeout) {
        InetAddress[] addresses;
        try {
            addresses = resolver.resolve(target.host());
        } catch (UnknownHostException e) {
            return Result.of(Outcome.UNREACHABLE, e.getClass().getSimpleName());
        }
        if (addresses == null || addresses.length == 0) {
            return Result.of(Outcome.UNREACHABLE, "no-address");
        }
        for (InetAddress address : addresses) {
            WebhookAddresses.Kind kind = WebhookAddresses.kind(address);
            if (!WebhookAddresses.allowed(kind, privateAllowed)) {
                return Result.of(Outcome.ADDRESS_REFUSED, kind.label());
            }
        }
        InetAddress pinned = addresses[0];
        long deadline = System.nanoTime() + timeout.toNanos();
        byte[] request = request(target, headers, body);
        Socket socket = new Socket(Proxy.NO_PROXY);
        // The deadline, whatever the socket is doing: a read waits at most until it, but a write, or a
        // TLS record trickled a byte at a time, would not; closing the socket ends either.
        AtomicBoolean expired = new AtomicBoolean();
        ScheduledFuture<?> watchdog = deadlines.schedule(() -> {
            expired.set(true);
            close(socket);
        }, timeout.toNanos(), TimeUnit.NANOSECONDS);
        try (socket) {
            int connect = (int) Math.max(1, Math.min(connectTimeout.toMillis(), timeout.toMillis()));
            socket.connect(new InetSocketAddress(pinned, target.port()), connect);
            Socket channel = socket;
            if (target.tls()) {
                SSLSocket ssl = (SSLSocket) tls.createSocket(socket, target.host(), target.port(), true);
                SSLParameters parameters = ssl.getSSLParameters();
                parameters.setEndpointIdentificationAlgorithm("HTTPS");
                if (!isLiteral(target.host())) {
                    parameters.setServerNames(List.of(new SNIHostName(target.host())));
                }
                ssl.setSSLParameters(parameters);
                ssl.setSoTimeout(remaining(deadline));
                ssl.startHandshake();
                channel = ssl;
            }
            channel.setSoTimeout(remaining(deadline));
            OutputStream out = channel.getOutputStream();
            out.write(request);
            out.flush();
            int status = status(new BufferedInputStream(channel.getInputStream()), channel, deadline);
            return status < 0 ? Result.of(Outcome.FAILED, "not-http")
                    : new Result(Outcome.ofStatus(status), status, null);
        } catch (IOException e) {
            if (expired.get() || e instanceof SocketTimeoutException) {
                return Result.of(Outcome.TIMEOUT, expired.get() ? "deadline" : e.getClass().getSimpleName());
            }
            if (e instanceof SSLException tlsFailure) {
                return Result.of(tls(tlsFailure), e.getClass().getSimpleName());
            }
            return Result.of(Outcome.UNREACHABLE, e.getClass().getSimpleName());
        } finally {
            watchdog.cancel(false);
        }
    }

    /** Stops the deadline's thread, when the component stops or a test replaces the sender. */
    void close() {
        deadlines.shutdownNow();
    }

    private static void close(Socket socket) {
        try {
            socket.close();
        } catch (IOException e) {
            // Closed already.
        }
    }

    /**
     * A TLS failure no other attempt would change, a certificate not trusted or not the host's, or a
     * protocol the receiver refuses, is {@link Outcome#TLS}; the connection ended by the receiver or
     * what is in front of it during the handshake, as a restart does, is {@link Outcome#UNREACHABLE},
     * and tried again.
     */
    static Outcome tls(SSLException failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof java.io.EOFException || cause instanceof java.net.SocketException) {
                return Outcome.UNREACHABLE;
            }
        }
        return Outcome.TLS;
    }

    /** An IPv4 or IPv6 literal, which is not sent as SNI. */
    static boolean isLiteral(String host) {
        return host.contains(":") || host.matches("[0-9.]+");
    }

    private static byte[] request(Target target, Map<String, String> headers, byte[] body) {
        StringBuilder head = new StringBuilder();
        head.append("POST ").append(target.path()).append(" HTTP/1.1\r\n");
        head.append("Host: ").append(target.hostHeader()).append("\r\n");
        head.append("User-Agent: ").append(USER_AGENT).append("\r\n");
        head.append("Content-Type: application/json\r\n");
        head.append("Content-Length: ").append(body.length).append("\r\n");
        head.append("Connection: close\r\n");
        headers.forEach((name, value) -> {
            if (!Connector.HEADER.matcher(name).matches() || !printable(value)) {
                // Every header is the add-on's own: an id, a timestamp, a nonce, a signature.
                throw new IllegalArgumentException("not a header a delivery sends");
            }
            head.append(name).append(": ").append(value).append("\r\n");
        });
        head.append("\r\n");
        byte[] start = head.toString().getBytes(StandardCharsets.US_ASCII);
        byte[] request = new byte[start.length + body.length];
        System.arraycopy(start, 0, request, 0, start.length);
        System.arraycopy(body, 0, request, start.length, body.length);
        return request;
    }

    /** Visible ASCII and spaces only: no line break can reach the request. */
    private static boolean printable(String value) {
        return value != null && value.chars().allMatch(c -> c >= 0x20 && c < 0x7f);
    }

    /** The final status, past at most {@value #MAX_INFORMATIONAL} informational answers, or -1. */
    private static int status(InputStream in, Socket channel, long deadline) throws IOException {
        for (int informational = 0; informational <= MAX_INFORMATIONAL; informational++) {
            String line = line(in, channel, deadline);
            Matcher matcher = line == null ? null : STATUS_LINE.matcher(line);
            if (matcher == null || !matcher.matches()) {
                return -1;
            }
            int status = Integer.parseInt(matcher.group(1));
            if (status >= 200 || status == 101) {
                return status == 101 ? -1 : status;
            }
            // 100 Continue, 103 Early Hints: their headers, to the blank line, then the next answer.
            for (int headers = 0;; headers++) {
                String header = line(in, channel, deadline);
                if (header == null || headers > 100) {
                    return -1;
                }
                if (header.isEmpty()) {
                    break;
                }
            }
        }
        return -1;
    }

    /** One line, without its line break, or {@code null} past the bound or at the end of the answer. */
    private static String line(InputStream in, Socket channel, long deadline) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        while (line.size() <= MAX_STATUS_LINE) {
            channel.setSoTimeout(remaining(deadline));
            int b = in.read();
            if (b < 0) {
                return null;
            }
            if (b == '\n') {
                String text = line.toString(StandardCharsets.ISO_8859_1);
                return text.endsWith("\r") ? text.substring(0, text.length() - 1) : text;
            }
            line.write(b);
        }
        return null;
    }

    /** The milliseconds left before the deadline, at least one; past it, a timeout. */
    private static int remaining(long deadline) throws SocketTimeoutException {
        long left = (deadline - System.nanoTime()) / 1_000_000;
        if (left <= 0) {
            throw new SocketTimeoutException("the attempt's deadline passed");
        }
        return (int) Math.min(Integer.MAX_VALUE, left);
    }
}
