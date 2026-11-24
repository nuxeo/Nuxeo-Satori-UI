package org.nuxeo.agentic.connectors;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.ConnectException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Pattern;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.connectors.ConnectorException.Kind;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectReader;

/**
 * Calls a system of record for one record, and holds the call to its connector's bounds.
 *
 * <ul>
 * <li><b>Where:</b> the address is the server property the connector names, an {@code https}
 * address with a host and no user, query or fragment ({@code http} too where the server sets the
 * connector's {@link Connector#httpAllowedProperty}). The connector's path is appended, with the key
 * in place of {@code {key}}. The key is the only part of the request that comes from a document, and
 * it is sent only when it is one path segment of letters, digits, {@code .}, {@code _} or
 * {@code -}, starting with a letter or a digit, so it cannot leave the path, add a query or climb
 * with {@code ..}. A host name {@link URI} does not read, such as one with an {@code _}, is not
 * configured.</li>
 * <li><b>How:</b> one {@code GET}, over HTTP/1.1, with {@code Accept: application/json} and the
 * connector's credential if it has one. A redirect is never followed: it could send the credential
 * elsewhere.</li>
 * <li><b>Bounds:</b> at most {@code maxConcurrent} calls of a connector at once, the others refused
 * at once rather than queued; the connect timeout, and one deadline for the whole call, headers
 * and body; a body larger than {@code maxBytes}, by its {@code Content-Length} or as it arrives, is
 * refused and the rest of it is not read. The body of any answer but a 200 with a JSON type is not
 * read at all.</li>
 * <li><b>The answer:</b> a 200 with one JSON object is found, a 404 is not found, and anything else
 * is a {@link ConnectorException}.</li>
 * </ul>
 */
final class SystemOfRecordClient implements AutoCloseable {

    private static final Logger log = LogManager.getLogger(SystemOfRecordClient.class);

    /** A key that is sent: one path segment, never {@code .} or {@code ..}, which start with a dot. */
    static final Pattern KEY = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,127}");

    static final String USER_AGENT = "nuxeo-agentic-connectors";

    private final ConnectorSettings settings;

    /** One client per connect timeout: a client holds a selector thread, so one per call would be wasteful. */
    private final Map<Duration, HttpClient> clients = new ConcurrentHashMap<>();

    /** The calls each connector may have running at once, by its id and its limit. */
    private final Map<String, Semaphore> running = new ConcurrentHashMap<>();

    /** Set by {@link #close}: a call that arrives after it is refused rather than building a client. */
    private volatile boolean closed;

    /** Reads one JSON value, and refuses anything after it. */
    private static final ObjectReader ONE_VALUE = ConnectorAnswer.JSON.reader()
                                                                      .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    SystemOfRecordClient(ConnectorSettings settings) {
        this.settings = settings;
    }

    static boolean sendable(String key) {
        return key != null && KEY.matcher(key).matches();
    }

    /**
     * The address of the connector's record for {@code key}, or {@link Kind#NOT_CONFIGURED} when the
     * server's address for it is missing or not one that may be called.
     */
    URI target(Connector connector, String key) {
        if (!sendable(key)) {
            throw new IllegalArgumentException("not a key that is sent");
        }
        String address = settings.property(connector.addressProperty());
        if (address == null) {
            log.warn("Connector {}: the server property {} that holds its address is not set", connector.id(),
                    connector.addressProperty());
            throw new ConnectorException(Kind.NOT_CONFIGURED);
        }
        URI base;
        try {
            base = new URI(address);
        } catch (URISyntaxException e) {
            throw notConfigured(connector, "is not an address");
        }
        String scheme = base.getScheme() == null ? "" : base.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !(scheme.equals("http") && settings.httpAllowed(connector))) {
            throw notConfigured(connector,
                    "is not https (plain http needs " + connector.httpAllowedProperty() + "=true on the server)");
        }
        if (base.isOpaque() || base.getHost() == null || base.getRawUserInfo() != null || base.getRawQuery() != null
                || base.getRawFragment() != null) {
            throw notConfigured(connector, "must be scheme://host[:port][/path], with no user, query or fragment");
        }
        String basePath = base.getRawPath() == null ? "" : base.getRawPath();
        if (basePath.endsWith("/")) {
            basePath = basePath.substring(0, basePath.length() - 1);
        }
        String path = connector.path().replace(Connector.KEY_PLACEHOLDER, key);
        URI target = URI.create(scheme + "://" + base.getRawAuthority() + basePath + path);
        // Held again after the join: the target is on the address's own host and under its path.
        if (!base.getRawAuthority().equals(target.getRawAuthority())
                || !target.getRawPath().equals(basePath + path)) {
            throw notConfigured(connector, "does not join with the connector's path");
        }
        return target;
    }

    private static ConnectorException notConfigured(Connector connector, String why) {
        log.warn("Connector {}: the address in the server property {} {}", connector.id(),
                connector.addressProperty(), why);
        return new ConnectorException(Kind.NOT_CONFIGURED);
    }

    /** The credential's header value, {@code prefix + value}, or {@code null} for a connector with none. */
    private String credential(Connector connector) {
        Connector.Credential credential = connector.credential();
        if (credential == null) {
            return null;
        }
        String value = credential.property() == null ? null : settings.property(credential.property());
        if (value == null && credential.env() != null) {
            value = settings.env(credential.env());
        }
        if (value == null) {
            log.warn("Connector {}: its credential is in neither the server property {} nor the environment variable {}",
                    connector.id(), credential.property(), credential.env());
            throw new ConnectorException(Kind.NOT_CONFIGURED);
        }
        String header = credential.prefix() + value;
        if (!header.chars().allMatch(c -> c >= 0x20 && c < 0x7f)) {
            log.warn("Connector {}: its credential holds a character a header may not carry", connector.id());
            throw new ConnectorException(Kind.NOT_CONFIGURED);
        }
        return header;
    }

    /**
     * The record for {@code key}: found, or not found. Every other outcome throws. A call past the
     * connector's {@code maxConcurrent} is refused at once, so that a slow system holds no more of
     * the server's request threads than that.
     */
    ConnectorAnswer fetch(Connector connector, String key) {
        if (closed) {
            throw new ConnectorException(Kind.NOT_CONFIGURED);
        }
        Semaphore slots = running.computeIfAbsent(connector.id() + "#" + connector.maxConcurrent(),
                ignored -> new Semaphore(connector.maxConcurrent()));
        if (!slots.tryAcquire()) {
            log.warn("Connector {}: {} calls already running, the most it allows", connector.id(),
                    connector.maxConcurrent());
            throw new ConnectorException(Kind.BUSY);
        }
        try {
            return call(connector, key);
        } finally {
            slots.release();
        }
    }

    private ConnectorAnswer call(Connector connector, String key) {
        URI uri = target(connector, key);
        String credential = credential(connector);
        HttpRequest.Builder request = HttpRequest.newBuilder(uri)
                                                 .GET()
                                                 .timeout(connector.timeout())
                                                 .header("Accept", "application/json")
                                                 .header("User-Agent", USER_AGENT);
        if (credential != null) {
            try {
                request.header(connector.credential().header(), credential);
            } catch (IllegalArgumentException e) {
                log.warn("Connector {}: its credential cannot be sent in the header {}", connector.id(),
                        connector.credential().header());
                throw new ConnectorException(Kind.NOT_CONFIGURED);
            }
        }
        HttpClient client = clients.computeIfAbsent(connector.connectTimeout(),
                timeout -> HttpClient.newBuilder()
                                     .connectTimeout(timeout)
                                     .followRedirects(HttpClient.Redirect.NEVER)
                                     .version(HttpClient.Version.HTTP_1_1)
                                     .build());
        CompletableFuture<HttpResponse<Body>> call = client.sendAsync(request.build(), body(connector.maxBytes()));
        HttpResponse<Body> response;
        try {
            // One deadline for the whole call: the request's own timeout stops at the headers.
            response = call.get(connector.timeout().toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            call.cancel(true);
            throw failed(connector, Kind.TIMEOUT, e);
        } catch (InterruptedException e) {
            call.cancel(true);
            Thread.currentThread().interrupt();
            throw failed(connector, Kind.UNREACHABLE, e);
        } catch (ExecutionException e) {
            throw failed(connector, kindOf(e.getCause()), e.getCause());
        }
        int status = response.statusCode();
        if (status == 404) {
            return ConnectorAnswer.without(connector.id(), ConnectorAnswer.Status.NOT_FOUND);
        }
        if (status >= 300 && status < 400) {
            throw failed(connector, Kind.REDIRECTED, null);
        }
        if (status != 200) {
            log.warn("Connector {}: the system answered HTTP {}", connector.id(), status);
            throw new ConnectorException(Kind.REFUSED);
        }
        Body body = response.body();
        if (!body.json()) {
            throw failed(connector, Kind.UNREADABLE, null);
        }
        JsonNode record;
        try {
            record = ONE_VALUE.readTree(body.bytes());
        } catch (IOException e) {
            throw failed(connector, Kind.UNREADABLE, e);
        }
        if (record == null || !record.isObject()) {
            throw failed(connector, Kind.UNREADABLE, null);
        }
        return ConnectorAnswer.found(connector, record);
    }

    private static Kind kindOf(Throwable cause) {
        for (Throwable t = cause; t != null; t = t.getCause()) {
            if (t instanceof TooLarge) {
                return Kind.TOO_LARGE;
            }
            if (t instanceof HttpTimeoutException) {
                return Kind.TIMEOUT;
            }
            if (t instanceof ConnectException) {
                return Kind.UNREACHABLE;
            }
        }
        return Kind.UNREACHABLE;
    }

    /** Logged with the cause's class only: its message may hold the address or the key. */
    private static ConnectorException failed(Connector connector, Kind kind, Throwable cause) {
        log.warn("Connector {}: {}{}", connector.id(), kind,
                cause == null ? "" : " (" + cause.getClass().getSimpleName() + ")");
        return new ConnectorException(kind);
    }

    @Override
    public void close() {
        closed = true;
        clients.values().forEach(HttpClient::close);
        clients.clear();
    }

    /** What the body handler kept of an answer. */
    record Body(byte[] bytes, boolean json) {
    }

    /** {@code application/json}, or a {@code +json} type, with any parameters. */
    static boolean isJson(String contentType) {
        if (contentType == null) {
            return false;
        }
        String type = contentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return type.equals("application/json") || (type.startsWith("application/") && type.endsWith("+json"));
    }

    /**
     * Reads a 200's JSON body up to {@code maxBytes}, and nothing of any other answer, whose status
     * is all that is used: its body is cancelled unread, so a 404 that trickles on is still a 404.
     */
    static HttpResponse.BodyHandler<Body> body(int maxBytes) {
        return info -> {
            if (info.statusCode() != 200 || !isJson(info.headers().firstValue("Content-Type").orElse(null))) {
                return new Unread();
            }
            boolean declaredTooLarge = info.headers().firstValueAsLong("Content-Length").orElse(-1) > maxBytes;
            return HttpResponse.BodySubscribers.mapping(new Limited(maxBytes, declaredTooLarge),
                    bytes -> new Body(bytes, true));
        };
    }

    /** A body that is not read: cancelled as soon as it is offered, and answered with nothing. */
    static final class Unread implements HttpResponse.BodySubscriber<Body> {

        private final CompletableFuture<Body> result = CompletableFuture.completedFuture(
                new Body(new byte[0], false));

        @Override
        public CompletionStage<Body> getBody() {
            return result;
        }

        @Override
        public void onSubscribe(Flow.Subscription subscription) {
            subscription.cancel();
        }

        @Override
        public void onNext(List<ByteBuffer> items) {
            // Cancelled: nothing more is asked for.
        }

        @Override
        public void onError(Throwable throwable) {
            // The answer is already its status.
        }

        @Override
        public void onComplete() {
            // The answer is already its status.
        }
    }

    /** A body past the connector's {@code maxBytes}. */
    static final class TooLarge extends IOException {

        private static final long serialVersionUID = 1L;

        TooLarge() {
            super("larger than the connector allows");
        }
    }

    /** Collects a body up to a limit, and cancels the rest of it once it would pass the limit. */
    static final class Limited implements HttpResponse.BodySubscriber<byte[]> {

        private final int max;

        private final boolean refuse;

        private final ByteArrayOutputStream out = new ByteArrayOutputStream();

        private final CompletableFuture<byte[]> result = new CompletableFuture<>();

        private Flow.Subscription subscription;

        Limited(int max, boolean refuse) {
            this.max = max;
            this.refuse = refuse;
        }

        @Override
        public CompletionStage<byte[]> getBody() {
            return result;
        }

        @Override
        public void onSubscribe(Flow.Subscription subscription) {
            this.subscription = subscription;
            if (refuse) {
                subscription.cancel();
                result.completeExceptionally(new TooLarge());
                return;
            }
            subscription.request(Long.MAX_VALUE);
        }

        @Override
        public void onNext(List<ByteBuffer> items) {
            if (result.isDone()) {
                return;
            }
            for (ByteBuffer item : items) {
                if (out.size() + item.remaining() > max) {
                    subscription.cancel();
                    result.completeExceptionally(new TooLarge());
                    return;
                }
                byte[] chunk = new byte[item.remaining()];
                item.get(chunk);
                out.write(chunk, 0, chunk.length);
            }
        }

        @Override
        public void onError(Throwable throwable) {
            result.completeExceptionally(throwable);
        }

        @Override
        public void onComplete() {
            result.complete(out.toByteArray());
        }
    }
}
