package org.nuxeo.agentic.connectors;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.regex.Pattern;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectReader;

/**
 * Change events from a system of record: it says a record changed, and the answers kept for it are
 * dropped, so that the next card drawn asks it again. That is all an event does: it writes nothing,
 * in Nuxeo or anywhere, and it reads no document.
 *
 * <pre>
 * POST /nuxeo/agentic-connectors/events/payers.claimPayments
 * X-Nuxeo-Connector-Timestamp: 1795680000
 * X-Nuxeo-Connector-Nonce: 3f9a0c1e7b2d4a6f8e1c
 * X-Nuxeo-Connector-Signature: sha256=&lt;64 hexadecimal digits&gt;
 *
 * { "key": "CLAIM-000130" }
 * </pre>
 *
 * <ul>
 * <li><b>Who may send one:</b> whoever holds the connector's events secret, the server property
 * {@code nuxeo.agentic.connectors.<id>.events.secret}, at least {@value #MIN_SECRET_LENGTH}
 * characters. Unset or shorter, the connector takes no events. The sender signs, with HMAC-SHA256
 * and the secret's UTF-8 bytes as the key, the connector's id, the timestamp and the nonce, each
 * followed by a line feed, then the body's bytes as sent. The signature is compared in constant
 * time ({@link MessageDigest#isEqual}).</li>
 * <li><b>Not twice:</b> the timestamp, in whole seconds since 1970, must be within
 * {@value #WINDOW_SECONDS} seconds of the server's clock, either way, and the nonce,
 * {@value #MIN_NONCE} to {@value #MAX_NONCE} letters, digits, {@code _} or {@code -}, must not have
 * been seen for the connector while its timestamp could still be accepted. Only a signed event's
 * nonce is remembered, at most {@value #MAX_NONCES} per connector at once: past that, a new event is
 * answered 503 until older nonces expire, and its sender should send it again.</li>
 * <li><b>The body:</b> one JSON object, at most {@value #MAX_BODY_BYTES} bytes, whose {@code key}
 * is a record's key as the connector sends it, one path segment. Other members are ignored.</li>
 * <li><b>The answer:</b> 204 once the answers are dropped, however many there were. 401 for every
 * refusal of who sent it, an unknown connector included, so that the answer says nothing of which
 * connectors take events to someone without the secret (its timing is not made the same: a
 * connector's id is no secret, a layout names it); 400 for a signed event that is not one; 413 for
 * a body too large; 503 when too many nonces are remembered.</li>
 * </ul>
 *
 * The log names the connector, only once it is one the server has, and the {@link Reason}: never
 * the secret, the signature, the nonce, the key or the body.
 */
public final class ChangeEvents {

    private static final Logger log = LogManager.getLogger(ChangeEvents.class);

    public static final String TIMESTAMP_HEADER = "X-Nuxeo-Connector-Timestamp";

    public static final String NONCE_HEADER = "X-Nuxeo-Connector-Nonce";

    public static final String SIGNATURE_HEADER = "X-Nuxeo-Connector-Signature";

    public static final String SIGNATURE_SCHEME = "sha256=";

    static final int WINDOW_SECONDS = 300;

    static final Duration WINDOW = Duration.ofSeconds(WINDOW_SECONDS);

    public static final int MAX_BODY_BYTES = 4096;

    static final int MIN_SECRET_LENGTH = 32;

    static final int MIN_NONCE = 16;

    static final int MAX_NONCE = 128;

    static final int MAX_NONCES = 10_000;

    private static final Pattern NONCE = Pattern.compile("[A-Za-z0-9_-]{" + MIN_NONCE + "," + MAX_NONCE + "}");

    private static final Pattern TIMESTAMP = Pattern.compile("[0-9]{1,12}");

    private static final Pattern SIGNATURE = Pattern.compile(Pattern.quote(SIGNATURE_SCHEME) + "[0-9a-fA-F]{64}");

    private static final ObjectReader ONE_VALUE = ConnectorAnswer.JSON.reader()
                                                                      .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    /** What the endpoint answers. */
    public enum Outcome {
        ACCEPTED(204), MALFORMED(400), REFUSED(401), TOO_LARGE(413), BUSY(503);

        public final int status;

        Outcome(int status) {
            this.status = status;
        }
    }

    /** Why, for the log and the metrics: never anything the request sent. */
    public enum Reason {
        ACCEPTED(Outcome.ACCEPTED, "accepted"),
        UNKNOWN_CONNECTOR(Outcome.REFUSED, "it names no connector this server takes events for"),
        NO_SECRET(Outcome.REFUSED, "the connector has no events secret of at least " + MIN_SECRET_LENGTH
                + " characters on this server"),
        NO_TIMESTAMP(Outcome.REFUSED, "it has no timestamp in whole seconds"),
        STALE(Outcome.REFUSED, "its timestamp is more than " + WINDOW_SECONDS + " seconds from the server's clock"),
        NO_NONCE(Outcome.REFUSED, "it has no nonce of " + MIN_NONCE + " to " + MAX_NONCE + " letters, digits, '_' or '-'"),
        BAD_SIGNATURE(Outcome.REFUSED, "its signature is not the connector's"),
        REPLAYED(Outcome.REFUSED, "its nonce has been seen already"),
        NOT_AN_EVENT(Outcome.MALFORMED, "it is signed, but not a JSON object with a key the connector sends"),
        TOO_LARGE(Outcome.TOO_LARGE, "its body is larger than " + MAX_BODY_BYTES + " bytes"),
        TOO_MANY_NONCES(Outcome.BUSY, "the connector already remembers " + MAX_NONCES + " nonces");

        public final Outcome outcome;

        final String why;

        Reason(Outcome outcome, String why) {
            this.outcome = outcome;
            this.why = why;
        }
    }

    /** An event's outcome, and how many kept answers it dropped. */
    public record Result(Reason reason, int invalidated) {

        public Outcome outcome() {
            return reason.outcome;
        }
    }

    private final Function<String, Connector> connectors;

    private final ConnectorSettings settings;

    private final ConnectorCache cache;

    private final ConnectorMetrics metrics;

    /** Each connector's nonces, and until when each is remembered. */
    private final Map<String, Nonces> nonces = new ConcurrentHashMap<>();

    /** How often a connector's expired nonces are forgotten, besides whenever its store is full. */
    static final Duration PURGE_EVERY = Duration.ofMinutes(1);

    /**
     * One connector's nonces, each until its timestamp could no longer be accepted. One lock, so that
     * a nonce is looked up and remembered at once: two copies of one event, sent together, are one
     * accepted and one replayed.
     */
    private static final class Nonces {

        private final Map<String, Instant> until = new java.util.HashMap<>();

        private Instant purged = Instant.EPOCH;

        synchronized Reason remember(String nonce, Instant expires, Instant now) {
            if (until.size() >= MAX_NONCES || Duration.between(purged, now).compareTo(PURGE_EVERY) >= 0) {
                until.values().removeIf(at -> at.isBefore(now));
                purged = now;
            }
            Instant seen = until.get(nonce);
            if (seen != null && !seen.isBefore(now)) {
                return Reason.REPLAYED;
            }
            if (seen == null && until.size() >= MAX_NONCES) {
                return Reason.TOO_MANY_NONCES;
            }
            // New, or seen so long ago that its timestamp could not be accepted now.
            until.put(nonce, expires);
            return null;
        }

        synchronized int size() {
            return until.size();
        }
    }

    /** When each refusal was last logged at WARN, so that someone without the secret cannot fill the log. */
    private final Map<String, Instant> lastWarned = new ConcurrentHashMap<>();

    ChangeEvents(Function<String, Connector> connectors, ConnectorSettings settings, ConnectorCache cache,
            ConnectorMetrics metrics) {
        this.connectors = connectors;
        this.settings = settings;
        this.cache = cache;
        this.metrics = metrics;
    }

    /**
     * One event, as the endpoint received it: the connector its path names, the three headers, and
     * the body's bytes. Every check is made before anything is dropped.
     */
    public Result receive(String connectorId, String timestamp, String nonce, String signature, byte[] body) {
        Connector connector = connectorId == null || !Connector.ID.matcher(connectorId).matches() ? null
                : connectors.apply(connectorId);
        if (connector == null) {
            return refused(null, Reason.UNKNOWN_CONNECTOR);
        }
        if (body == null || body.length > MAX_BODY_BYTES) {
            return refused(connector, Reason.TOO_LARGE);
        }
        String secret = secret(connector);
        if (secret == null) {
            return refused(connector, Reason.NO_SECRET);
        }
        if (timestamp == null || !TIMESTAMP.matcher(timestamp).matches()) {
            return refused(connector, Reason.NO_TIMESTAMP);
        }
        Instant now = cache.now();
        Instant sent = Instant.ofEpochSecond(Long.parseLong(timestamp));
        if (Duration.between(sent, now).abs().compareTo(WINDOW) > 0) {
            return refused(connector, Reason.STALE);
        }
        if (nonce == null || !NONCE.matcher(nonce).matches()) {
            return refused(connector, Reason.NO_NONCE);
        }
        if (signature == null || !SIGNATURE.matcher(signature).matches()) {
            return refused(connector, Reason.BAD_SIGNATURE);
        }
        byte[] given = HexFormat.of().parseHex(signature.substring(SIGNATURE_SCHEME.length()));
        byte[] expected = mac(secret, connector.id(), timestamp, nonce, body);
        if (!MessageDigest.isEqual(expected, given)) {
            return refused(connector, Reason.BAD_SIGNATURE);
        }
        Reason remembered = remember(connector, nonce, sent.plus(WINDOW), now);
        if (remembered != null) {
            return refused(connector, remembered);
        }
        String key = keyOf(body);
        if (key == null) {
            return refused(connector, Reason.NOT_AN_EVENT);
        }
        int dropped = cache.invalidate(connector, key);
        metrics.accepted(connector);
        metrics.invalidated(connector, dropped);
        // The key may be personal data, and the nonce is the sender's: neither is logged.
        log.info("Connector {}: a change event from the system of record dropped {} kept answer(s)", connector.id(),
                dropped);
        return new Result(Reason.ACCEPTED, dropped);
    }

    private String secret(Connector connector) {
        String secret = settings.property(connector.eventsSecretProperty());
        return secret == null || secret.length() < MIN_SECRET_LENGTH ? null : secret;
    }

    /** {@code null} once the nonce is remembered; why not, when it has been seen or there is no room. */
    private Reason remember(Connector connector, String nonce, Instant until, Instant now) {
        return nonces.computeIfAbsent(connector.id(), id -> new Nonces()).remember(nonce, until, now);
    }

    /** The key a signed body names, or {@code null} when it is not one JSON object with such a key. */
    static String keyOf(byte[] body) {
        JsonNode event;
        try {
            event = ONE_VALUE.readTree(body);
        } catch (IOException e) {
            return null;
        }
        if (event == null || !event.isObject() || !event.path("key").isTextual()) {
            return null;
        }
        String key = event.get("key").asText();
        return SystemOfRecordClient.sendable(key) ? key : null;
    }

    /**
     * HMAC-SHA256, keyed with the secret's UTF-8 bytes, of the connector's id, the timestamp and the
     * nonce, each followed by a line feed, then the body. None of the three holds a line feed, so no
     * two events sign the same bytes.
     */
    static byte[] mac(String secret, String connectorId, String timestamp, String nonce, byte[] body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            mac.update((connectorId + "\n" + timestamp + "\n" + nonce + "\n").getBytes(StandardCharsets.UTF_8));
            return mac.doFinal(body);
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            // Every Java runtime has HmacSHA256, and takes any key of at least one byte.
            throw new IllegalStateException(e);
        }
    }

    private Result refused(Connector connector, Reason reason) {
        metrics.refused(connector, reason);
        // Named only once known: an unknown id is the request's, and is never written to the log.
        String who = connector == null ? "?" : connector.id();
        Instant now = cache.now();
        Instant last = lastWarned.get(who + reason);
        if (last == null || Duration.between(last, now).compareTo(Duration.ofMinutes(1)) >= 0) {
            lastWarned.put(who + reason, now);
            log.warn("Connector {}: a change event was refused: {}", connector == null ? "(none)" : who, reason.why);
        } else {
            log.debug("Connector {}: a change event was refused: {}", connector == null ? "(none)" : who, reason.why);
        }
        return new Result(reason, 0);
    }

    /**
     * How many nonces are remembered for the connector, for tests. A connector contributed again
     * keeps its nonces: they are its id's, and forgetting them would let an event be sent twice.
     */
    int remembered(String connectorId) {
        Nonces seen = nonces.get(connectorId);
        return seen == null ? 0 : seen.size();
    }
}
