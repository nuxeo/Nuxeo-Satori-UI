/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature.standin;

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
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.signature.Callback;
import org.nuxeo.agentic.signature.CallbackEvent;
import org.nuxeo.agentic.signature.CallbackEvent.Outcome;
import org.nuxeo.agentic.signature.CallbackRefusedException;
import org.nuxeo.agentic.signature.CallbackRefusedException.Reason;
import org.nuxeo.agentic.signature.Envelope;
import org.nuxeo.agentic.signature.SignatureProvider;
import org.nuxeo.agentic.signature.SignatureProviderException;
import org.nuxeo.agentic.signature.SignatureProviderException.Kind;
import org.nuxeo.agentic.signature.SignatureSettings;
import org.nuxeo.agentic.signature.Signatures;
import org.nuxeo.agentic.signature.SignedResult;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The stand-in provider: the add-on's demo service, {@code demo/esign-stand-in.mjs}, which signs
 * nothing for real. For development and demonstration servers only; no vendor is chosen
 * (decision H). It shows what a provider does, so that a vendor's is the same shape.
 *
 * <p><strong>Settings,</strong> the server's only, under {@code nuxeo.agentic.signature.<id>.}:
 * <ul>
 * <li>{@code address}: {@code https://host[:port][/path]}, with no user, query or fragment; plain
 * {@code http} only where the server also sets {@code http.allowed=true}, for a demo on one host;</li>
 * <li>{@code apiKey}, or the environment's {@code NUXEO_SIGNATURE_<ID>_API_KEY}: sent as a bearer
 * token, in one header, on every call to the service;</li>
 * <li>{@code callbackSecret}, or {@code NUXEO_SIGNATURE_<ID>_CALLBACK_SECRET}: the shared secret the
 * service signs its callbacks with, {@value #MIN_SECRET} characters at least.</li>
 * </ul>
 * None of them is ever logged, or put in an answer or an error.
 *
 * <p><strong>A callback</strong> carries {@code X-StandIn-Signature: t=<unix seconds>,v1=<hex>},
 * the HMAC-SHA256 of {@code <t>.<body>} under the callback secret, as some vendors sign theirs. It
 * is compared in constant time ({@link MessageDigest#isEqual}), and the body is read only once it
 * matches. The time it returns is {@code t}, which the signature covers, so the add-on's window
 * holds a replayed callback to it.
 *
 * <p><strong>Every call</strong> is bounded: a connect timeout, one deadline for the whole call, a
 * body of at most {@value #MAX_ANSWER} bytes, and no redirect followed, since one could take the
 * API key elsewhere. The body of an answer that is not a JSON success is not read.
 */
public class StandInProvider implements SignatureProvider {

    private static final Logger log = LogManager.getLogger(StandInProvider.class);

    public static final String SIGNATURE_HEADER = "X-StandIn-Signature";

    static final Pattern SIGNATURE = Pattern.compile("t=([0-9]{1,12}),v1=([0-9a-f]{64})");

    static final int MIN_SECRET = 32;

    static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);

    static final Duration CALL_TIMEOUT = Duration.ofSeconds(20);

    /** The largest answer read: a 10 MiB file and its evidence, in Base64, in JSON. */
    static final int MAX_ANSWER = 24 * 1024 * 1024;

    static final String USER_AGENT = "nuxeo-agentic-signature";

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final ObjectReader ONE_VALUE = JSON.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    private String id;

    private SignatureSettings settings;

    private volatile HttpClient client;

    @Override
    public void init(String id, SignatureSettings settings) {
        this.id = id;
        this.settings = settings;
    }

    String property(String name) {
        return "nuxeo.agentic.signature." + id + "." + name;
    }

    String env(String name) {
        return "NUXEO_SIGNATURE_" + id.toUpperCase(Locale.ROOT).replace('-', '_') + "_" + name;
    }

    private String apiKey() {
        String key = settings.secret(property("apiKey"), env("API_KEY"));
        if (key != null && !key.chars().allMatch(c -> c > 0x20 && c < 0x7f)) {
            log.warn("E-signature: {}'s API key holds a character a header may not carry", id);
            return null;
        }
        return key;
    }

    private String callbackSecret() {
        String secret = settings.secret(property("callbackSecret"), env("CALLBACK_SECRET"));
        if (secret != null && secret.length() < MIN_SECRET) {
            log.warn("E-signature: {}'s callback secret is shorter than {} characters, so it is not used", id,
                    MIN_SECRET);
            return null;
        }
        return secret;
    }

    @Override
    public boolean configured() {
        return base(false) != null && apiKey() != null && callbackSecret() != null;
    }

    /** The service's address, or {@code null} when the server has none it may call. */
    URI base(boolean warn) {
        String address = settings.property(property("address"));
        if (address == null) {
            if (warn) {
                log.warn("E-signature: {} has no address; set {}", id, property("address"));
            }
            return null;
        }
        URI base;
        try {
            base = new URI(address);
        } catch (URISyntaxException e) {
            return unusable(warn, "is not an address");
        }
        String scheme = base.getScheme() == null ? "" : base.getScheme().toLowerCase(Locale.ROOT);
        boolean httpAllowed = "true".equals(settings.property(property("http.allowed")));
        if (!scheme.equals("https") && !(scheme.equals("http") && httpAllowed)) {
            return unusable(warn, "is not https (plain http needs " + property("http.allowed") + "=true)");
        }
        if (base.isOpaque() || base.getHost() == null || base.getRawUserInfo() != null || base.getRawQuery() != null
                || base.getRawFragment() != null) {
            return unusable(warn, "must be scheme://host[:port][/path], with no user, query or fragment");
        }
        return base;
    }

    private URI unusable(boolean warn, String why) {
        if (warn) {
            log.warn("E-signature: {}'s address, in {}, {}", id, property("address"), why);
        }
        return null;
    }

    /** The address of {@code path} on the service, held to its host and path. */
    URI target(String path) {
        URI base = base(true);
        if (base == null) {
            throw new SignatureProviderException(Kind.NOT_CONFIGURED);
        }
        String basePath = base.getRawPath() == null ? "" : base.getRawPath();
        if (basePath.endsWith("/")) {
            basePath = basePath.substring(0, basePath.length() - 1);
        }
        URI target = URI.create(base.getScheme().toLowerCase(Locale.ROOT) + "://" + base.getRawAuthority() + basePath
                + path);
        if (!base.getRawAuthority().equals(target.getRawAuthority()) || !target.getRawPath().equals(basePath + path)) {
            throw new SignatureProviderException(Kind.NOT_CONFIGURED);
        }
        return target;
    }

    private static String envelopePath(String envelope) {
        if (envelope == null || !Signatures.EXTERNAL_ID.matcher(envelope).matches()) {
            throw new SignatureProviderException(Kind.NOT_FOUND);
        }
        return "/envelopes/" + envelope;
    }

    // ------------------------------------------------------------------ the service

    @Override
    public String send(Envelope envelope) {
        ObjectNode body = JSON.createObjectNode();
        body.put("reference", envelope.reference());
        body.put("subject", envelope.subject());
        if (envelope.message() != null) {
            body.put("message", envelope.message());
        }
        ArrayNode signers = body.putArray("signers");
        for (Envelope.Signer signer : envelope.signers()) {
            signers.addObject().put("name", signer.name()).put("email", signer.email());
        }
        ObjectNode document = body.putObject("document");
        document.put("fileName", envelope.fileName());
        document.put("mimeType", envelope.mimeType());
        document.put("sha256", envelope.sha256());
        document.put("content", Base64.getEncoder().encodeToString(envelope.content()));
        byte[] json;
        try {
            json = JSON.writeValueAsBytes(body);
        } catch (IOException e) {
            throw new SignatureProviderException(Kind.UNREADABLE);
        }
        Answer answer = call(HttpRequest.newBuilder(target("/envelopes"))
                                        .POST(HttpRequest.BodyPublishers.ofByteArray(json))
                                        .header("Content-Type", "application/json"));
        if (answer.status() != 201 && answer.status() != 200) {
            throw refused(answer.status());
        }
        JsonNode sent = answer.json();
        String envelopeId = sent.path("id").asText(null);
        if (envelopeId == null || !Signatures.EXTERNAL_ID.matcher(envelopeId).matches()) {
            throw new SignatureProviderException(Kind.UNREADABLE);
        }
        return envelopeId;
    }

    @Override
    public SignedResult fetchSigned(String envelope) {
        Answer answer = call(HttpRequest.newBuilder(target(envelopePath(envelope) + "/result")).GET());
        if (answer.status() == 404) {
            throw new SignatureProviderException(Kind.NOT_FOUND);
        }
        if (answer.status() == 409) {
            throw new SignatureProviderException(Kind.NOT_SIGNED);
        }
        if (answer.status() != 200) {
            throw refused(answer.status());
        }
        JsonNode result = answer.json();
        if (!envelope.equals(result.path("envelope").asText(null))) {
            throw new SignatureProviderException(Kind.UNREADABLE);
        }
        if (!"signed".equals(result.path("status").asText(null))) {
            throw new SignatureProviderException(Kind.NOT_SIGNED);
        }
        JsonNode document = result.path("document");
        JsonNode evidence = result.path("evidence");
        byte[] content = decode(document.path("content"));
        byte[] proof = decode(evidence.path("content"));
        // The service's own digest of what it gave back, checked: a file cut on its way is not filed.
        String sha256 = document.path("sha256").asText("");
        if (!MessageDigest.isEqual(sha256(content).getBytes(StandardCharsets.US_ASCII),
                sha256.getBytes(StandardCharsets.US_ASCII))) {
            throw new SignatureProviderException(Kind.UNREADABLE);
        }
        return new SignedResult(document.path("fileName").asText(null), document.path("mimeType").asText(null),
                content, evidence.path("fileName").asText(null), evidence.path("mimeType").asText(null), proof);
    }

    @Override
    public void cancel(String envelope) {
        Answer answer = call(HttpRequest.newBuilder(target(envelopePath(envelope))).DELETE());
        if (answer.status() != 200 && answer.status() != 204 && answer.status() != 404) {
            throw refused(answer.status());
        }
    }

    private static byte[] decode(JsonNode node) {
        if (!node.isTextual()) {
            throw new SignatureProviderException(Kind.UNREADABLE);
        }
        try {
            return Base64.getDecoder().decode(node.asText());
        } catch (IllegalArgumentException e) {
            throw new SignatureProviderException(Kind.UNREADABLE);
        }
    }

    private SignatureProviderException refused(int status) {
        log.warn("E-signature: {}'s service answered HTTP {}", id, status);
        return new SignatureProviderException(status >= 500 ? Kind.UNREACHABLE : Kind.REFUSED);
    }

    /** What an answer kept: its status, and its body when it was a JSON success. */
    record Answer(int status, byte[] body) {

        JsonNode json() {
            if (body == null) {
                throw new SignatureProviderException(Kind.UNREADABLE);
            }
            try {
                JsonNode node = ONE_VALUE.readTree(body);
                if (node == null || !node.isObject()) {
                    throw new SignatureProviderException(Kind.UNREADABLE);
                }
                return node;
            } catch (IOException e) {
                throw new SignatureProviderException(Kind.UNREADABLE);
            }
        }
    }

    private Answer call(HttpRequest.Builder request) {
        String apiKey = apiKey();
        if (apiKey == null) {
            log.warn("E-signature: {} has no API key; set {} or {}", id, property("apiKey"), env("API_KEY"));
            throw new SignatureProviderException(Kind.NOT_CONFIGURED);
        }
        request.timeout(CALL_TIMEOUT)
               .header("Accept", "application/json")
               .header("User-Agent", USER_AGENT)
               .header("Authorization", "Bearer " + apiKey);
        CompletableFuture<HttpResponse<Answer>> call = client().sendAsync(request.build(), info -> {
            String type = info.headers().firstValue("Content-Type").orElse("");
            boolean json = type.split(";", 2)[0].trim().equalsIgnoreCase("application/json");
            if (info.statusCode() / 100 != 2 || !json) {
                return new Unread(info.statusCode());
            }
            boolean declaredTooLarge = info.headers().firstValueAsLong("Content-Length").orElse(-1) > MAX_ANSWER;
            return HttpResponse.BodySubscribers.mapping(new Limited(MAX_ANSWER, declaredTooLarge),
                    bytes -> new Answer(info.statusCode(), bytes));
        });
        try {
            // One deadline for the whole call: the request's own timeout stops at the headers.
            HttpResponse<Answer> response = call.get(CALL_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
            if (response.statusCode() >= 300 && response.statusCode() < 400) {
                log.warn("E-signature: {}'s service answered with a redirect, which is not followed", id);
                throw new SignatureProviderException(Kind.REFUSED);
            }
            return response.body();
        } catch (TimeoutException e) {
            call.cancel(true);
            throw failed(Kind.TIMEOUT, e);
        } catch (InterruptedException e) {
            call.cancel(true);
            Thread.currentThread().interrupt();
            throw failed(Kind.UNREACHABLE, e);
        } catch (ExecutionException e) {
            throw failed(kindOf(e.getCause()), e.getCause());
        }
    }

    private HttpClient client() {
        HttpClient made = client;
        if (made == null) {
            synchronized (this) {
                made = client;
                if (made == null) {
                    made = HttpClient.newBuilder()
                                     .connectTimeout(CONNECT_TIMEOUT)
                                     .followRedirects(HttpClient.Redirect.NEVER)
                                     .version(HttpClient.Version.HTTP_1_1)
                                     .build();
                    client = made;
                }
            }
        }
        return made;
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

    /** Logged with the cause's class only: its message may hold the address. */
    private SignatureProviderException failed(Kind kind, Throwable cause) {
        log.warn("E-signature: a call to {}'s service failed: {}{}", id, kind,
                cause == null ? "" : " (" + cause.getClass().getSimpleName() + ")");
        return new SignatureProviderException(kind);
    }

    // ------------------------------------------------------------------ callbacks

    @Override
    public CallbackEvent authenticate(Callback callback) {
        String secret = callbackSecret();
        if (secret == null) {
            throw new CallbackRefusedException(Reason.NOT_CONFIGURED);
        }
        String header = callback.header(SIGNATURE_HEADER);
        Matcher matcher = header == null ? null : SIGNATURE.matcher(header.trim());
        if (matcher == null || !matcher.matches()) {
            throw new CallbackRefusedException(Reason.MISSING);
        }
        String time = matcher.group(1);
        String expected = sign(secret, time, callback.body());
        if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.US_ASCII),
                matcher.group(2).getBytes(StandardCharsets.US_ASCII))) {
            throw new CallbackRefusedException(Reason.MISMATCH);
        }
        // Authenticated: only now is the body read.
        JsonNode event;
        try {
            event = ONE_VALUE.readTree(callback.body());
        } catch (IOException e) {
            throw new CallbackRefusedException(Reason.MALFORMED);
        }
        if (event == null || !event.isObject() || !event.path("id").isTextual() || !event.path("type").isTextual()
                || !event.path("envelope").isTextual()) {
            throw new CallbackRefusedException(Reason.MALFORMED);
        }
        Outcome outcome = switch (event.path("type").asText()) {
            case "envelope.signed" -> Outcome.SIGNED;
            case "envelope.declined" -> Outcome.DECLINED;
            default -> Outcome.OTHER;
        };
        String reason = event.path("reason").isTextual() ? event.path("reason").asText() : null;
        return new CallbackEvent(event.path("id").asText(), event.path("envelope").asText(), outcome,
                Instant.ofEpochSecond(Long.parseLong(time)), reason);
    }

    /** The signature of a callback: hex of the HMAC-SHA256 of {@code <time>.<body>} under the secret. */
    public static String sign(String secret, String time, byte[] body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            mac.update(time.getBytes(StandardCharsets.US_ASCII));
            mac.update((byte) '.');
            mac.update(body);
            return HexFormat.of().formatHex(mac.doFinal());
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new IllegalStateException("HmacSHA256 is missing from the JDK", e);
        }
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is missing from the JDK", e);
        }
    }

    @Override
    public List<String> accepts() {
        return List.of("application/pdf");
    }

    // ------------------------------------------------------------------ bounded bodies

    /** A body that is not read: cancelled as soon as it is offered; only its status is kept. */
    static final class Unread implements HttpResponse.BodySubscriber<Answer> {

        private final CompletableFuture<Answer> result;

        Unread(int status) {
            result = CompletableFuture.completedFuture(new Answer(status, null));
        }

        @Override
        public CompletionStage<Answer> getBody() {
            return result;
        }

        @Override
        public void onSubscribe(Flow.Subscription subscription) {
            subscription.cancel();
        }

        @Override
        public void onNext(List<ByteBuffer> items) {
            // Cancelled.
        }

        @Override
        public void onError(Throwable throwable) {
            // The answer is its status.
        }

        @Override
        public void onComplete() {
            // The answer is its status.
        }
    }

    static final class TooLarge extends IOException {

        private static final long serialVersionUID = 1L;

        TooLarge() {
            super("larger than the provider reads");
        }
    }

    /** Collects a body up to a limit, and cancels the rest once it would pass it. */
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
