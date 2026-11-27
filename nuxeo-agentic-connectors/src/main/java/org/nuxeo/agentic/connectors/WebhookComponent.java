package org.nuxeo.agentic.connectors;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.function.UnaryOperator;
import java.util.regex.Pattern;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.connectors.WebhookDelivery.State;
import org.nuxeo.agentic.connectors.WebhookSender.Outcome;
import org.nuxeo.agentic.connectors.WebhookSender.Result;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentNotFoundException;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.work.api.WorkManager;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.kv.KeyValueService;
import org.nuxeo.runtime.kv.KeyValueStore;
import org.nuxeo.runtime.model.ComponentContext;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.DefaultComponent;
import org.nuxeo.runtime.transaction.TransactionHelper;

import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Outbound webhooks: holds the ones the server's configuration contributes, and sends their
 * deliveries.
 *
 * <ol>
 * <li><b>After the commit:</b> {@link WebhookListener}, post-commit and asynchronous, hands each
 * document event a webhook sends to {@link #enqueue}. The document is read again as the repository
 * now stores it, with the system's rights, and the payload built from it ({@link WebhookPayload}).
 * A webhook whose address or secret the server does not set sends nothing, and nothing is kept for
 * it.</li>
 * <li><b>Kept, then sent:</b> the delivery is kept in flight ({@link WebhookDeliveries}), and one
 * {@link WebhookWork} scheduled in the work manager's queue {@value WebhookWork#CATEGORY}, which
 * claims it and makes one attempt ({@link #deliver}).</li>
 * <li><b>Signed</b> as the change events Nuxeo takes are signed ({@link ChangeEvents}): the headers
 * {@code X-Nuxeo-Connector-Timestamp}, {@code -Nonce} and {@code -Signature}, {@code sha256=} and the
 * HMAC-SHA256, keyed with the webhook's secret, of its id, the timestamp and the nonce, each followed
 * by a line feed, then the body. A fresh timestamp and nonce for each attempt.</li>
 * <li><b>Sent</b> to the server's address for it only ({@link WebhookSender}), checked after DNS,
 * no redirect followed.</li>
 * <li><b>Retried:</b> an attempt that may come to something else next time, a 5xx, a 408, 425 or
 * 429, a timeout or an unreachable receiver, is made again after {@link #backoff}, 30 seconds and
 * four times longer each time, up to six hours, until the webhook's {@code maxAttempts}. Every
 * node looks for due deliveries every {@value #RETRY_EVERY_SECONDS} seconds. An attempt claimed and
 * not finished within {@link #CLAIM_TIMEOUT} is taken over; the late outcome of the node that
 * claimed it is audited and changes nothing ({@link WebhookDeliveries}).</li>
 * <li><b>Then a dead letter:</b> after its last attempt, or at once for an outcome no attempt would
 * change, a redirect, a 4xx, a certificate or protocol failure, an address refused or a webhook not
 * configured. Kept with its payload for 30 days, for an administrator to see and send again
 * ({@link #deliveries}, {@link #resend}).</li>
 * <li><b>Audited:</b> every attempt's outcome, and every resend ({@link WebhookAudit}).</li>
 * </ol>
 *
 * The log names the webhook, the delivery, the document's id and type, the outcome and the
 * receiver's status: never the address, the secret, the signature, the nonce or the payload.
 */
public class WebhookComponent extends DefaultComponent implements WebhookService {

    private static final Logger log = LogManager.getLogger(WebhookComponent.class);

    static final String XP_WEBHOOKS = "webhooks";

    static final long RETRY_EVERY_SECONDS = 30;

    static final Duration FIRST_RETRY = Duration.ofSeconds(30);

    static final Duration MAX_RETRY = Duration.ofHours(6);

    /** How long a node that claimed an attempt has to finish it before another may: past any timeout. */
    static final Duration CLAIM_TIMEOUT = Duration.ofMinutes(2);

    static final int MIN_SECRET_LENGTH = ChangeEvents.MIN_SECRET_LENGTH;

    public static final String WEBHOOK_HEADER = "X-Nuxeo-Webhook";

    static final int DEFAULT_LIMIT = 50;

    static final int MAX_LIMIT = 200;

    /** A delivery's id: 32 lower-case hexadecimal digits. */
    static final Pattern DELIVERY_ID = Pattern.compile("[0-9a-f]{32}");

    private static final SecureRandom RANDOM = new SecureRandom();

    private final Map<String, Webhook> webhooks = new ConcurrentHashMap<>();

    private final Map<String, WebhookDescriptor> sources = new ConcurrentHashMap<>();

    /** When each warning was last logged, so that a busy repository does not fill the log with one. */
    private final Map<String, Instant> lastWarned = new ConcurrentHashMap<>();

    private volatile UnaryOperator<String> properties = name -> null;

    private volatile InstantSource clock = InstantSource.system();

    private volatile WebhookSender sender;

    private volatile WebhookAudit audit;

    private volatile WebhookDeliveries deliveries;

    private volatile ConnectorMetrics metrics;

    private volatile ScheduledExecutorService retries;

    @Override
    public void registerContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        if (!XP_WEBHOOKS.equals(extensionPoint) || !(contribution instanceof WebhookDescriptor descriptor)) {
            log.warn("Unknown contribution to {}: {}", extensionPoint, contribution);
            return;
        }
        register(descriptor, contributor.getName().getName());
    }

    /** Package-private for tests, which have no runtime to contribute through. */
    void register(WebhookDescriptor descriptor, String component) {
        if (!descriptor.isEnabled()) {
            if (descriptor.getId() != null && webhooks.remove(descriptor.getId()) != null) {
                sources.remove(descriptor.getId());
                log.info("Webhook {} removed by {}", descriptor.getId(), component);
            }
            return;
        }
        Webhook webhook;
        try {
            webhook = Webhook.of(descriptor);
        } catch (IllegalArgumentException e) {
            // Fails closed: a mistake in a contribution that meant to narrow a webhook must not leave the
            // wider one it replaces sending.
            String id = descriptor.getId();
            boolean removed = id != null && webhooks.remove(id) != null;
            if (removed) {
                sources.remove(id);
            }
            log.error("A webhook contributed by {} is not registered{}: {}", component,
                    removed ? ", and the one registered before with its id is removed" : "", e.getMessage());
            return;
        }
        webhooks.put(webhook.id(), webhook);
        sources.put(webhook.id(), descriptor);
    }

    @Override
    public void unregisterContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        if (contribution instanceof WebhookDescriptor descriptor) {
            String id = descriptor.getId();
            if (id != null && sources.get(id) == descriptor) {
                sources.remove(id);
                webhooks.remove(id);
            }
        }
    }

    @Override
    public void start(ComponentContext context) {
        start(Framework::getProperty, InstantSource.system(), WebhookSender.platform(), new WebhookAudit.Platform(),
                () -> Framework.getService(KeyValueService.class).getKeyValueStore(WebhookDeliveries.STORE),
                new ConnectorMetrics());
        ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "agentic-webhooks-retries");
            thread.setDaemon(true);
            return thread;
        });
        timer.scheduleWithFixedDelay(this::sweep, RETRY_EVERY_SECONDS, RETRY_EVERY_SECONDS, TimeUnit.SECONDS);
        retries = timer;
    }

    void start(UnaryOperator<String> properties, InstantSource clock, WebhookSender sender, WebhookAudit audit,
            Supplier<KeyValueStore> store, ConnectorMetrics metrics) {
        this.properties = properties;
        this.clock = clock;
        this.sender = sender;
        this.audit = audit;
        this.deliveries = new WebhookDeliveries(store);
        this.metrics = metrics;
    }

    @Override
    public void stop(ComponentContext context) {
        stopRetrying();
        deliveries = null;
    }

    /** Stops looking for due deliveries; tests call {@link #retryDue} themselves. */
    void stopRetrying() {
        ScheduledExecutorService timer = retries;
        retries = null;
        if (timer != null) {
            timer.shutdownNow();
        }
    }

    /** For tests, which move the clock on rather than wait. */
    void clock(InstantSource clock) {
        this.clock = clock;
    }

    /** For tests: a resolver and a TLS trust of their own. */
    void sender(WebhookSender sender) {
        this.sender = sender;
    }

    /** For tests: an audit that records what it is given. */
    void audit(WebhookAudit audit) {
        this.audit = audit;
    }

    @Override
    public Webhook getWebhook(String id) {
        return id == null ? null : webhooks.get(id);
    }

    /** Whether a registered webhook sends this trigger for this type: the listener's filter. */
    boolean sends(Webhook.Trigger trigger, String type) {
        for (Webhook webhook : webhooks.values()) {
            if (webhook.sends(trigger, type)) {
                return true;
            }
        }
        return false;
    }

    private String property(String name) {
        String value = properties.apply(name);
        return value == null || value.isBlank() ? null : value.trim();
    }

    private boolean flag(String name) {
        return "true".equals(property(name));
    }

    /** The receiver's address, or {@code null} when the server sets none it may send to. */
    private WebhookSender.Target target(Webhook webhook) {
        return WebhookSender.target(property(webhook.addressProperty()), flag(webhook.httpAllowedProperty()));
    }

    /**
     * The webhook's secret, or {@code null} when the server sets none of at least 32 characters, or
     * sets the same one as the events secret of the connector with the same id: the two are signed in
     * one scheme over the same id, so a delivery could otherwise be replayed to that connector's
     * change events, within their window, and verify.
     */
    private String secret(Webhook webhook) {
        String secret = property(webhook.secretProperty());
        if (secret == null || secret.length() < MIN_SECRET_LENGTH) {
            return null;
        }
        if (secret.equals(property(Connector.PROPERTY_PREFIX + webhook.id() + ".events.secret"))) {
            warn(webhook.id() + " shared secret", "Webhook {}: nothing is sent: its secret is the events secret of the"
                    + " connector with the same id; give each its own", webhook.id());
            return null;
        }
        return secret;
    }

    /**
     * The deliveries of a document event, one per webhook that sends it: the payload built from the
     * document as the repository now stores it, kept, and its first attempt scheduled.
     */
    void enqueue(Webhook.Trigger trigger, String repository, String documentId, String type) {
        WebhookDeliveries store = deliveries;
        if (store == null) {
            return;
        }
        List<Webhook> sending = new ArrayList<>();
        for (Webhook webhook : webhooks.values()) {
            if (!webhook.sends(trigger, type)) {
                continue;
            }
            if (target(webhook) == null) {
                warn(webhook.id() + " address", "Webhook {}: an event is not sent, nor kept: the server property {}"
                        + " is not set, or not an https address with a host and no user, query or fragment ({} lets"
                        + " it be http)", webhook.id(), webhook.addressProperty(), webhook.httpAllowedProperty());
                continue;
            }
            if (secret(webhook) == null) {
                warn(webhook.id() + " secret", "Webhook {}: an event is not sent, nor kept: the server property {} is"
                        + " not set, or shorter than {} characters, or another's", webhook.id(),
                        webhook.secretProperty(), MIN_SECRET_LENGTH);
                continue;
            }
            sending.add(webhook);
        }
        if (sending.isEmpty()) {
            return;
        }
        // Read, and the payloads built, in the session: a document's properties are read from it.
        Map<Webhook, Payload> payloads;
        try {
            payloads = CoreInstance.doPrivileged(repository, (Function<CoreSession, Map<Webhook, Payload>>) session -> {
                DocumentModel document = session.getDocument(new IdRef(documentId));
                Map<Webhook, Payload> built = new LinkedHashMap<>();
                if (!type.equals(document.getType())) {
                    return built;
                }
                for (Webhook webhook : sending) {
                    String id = randomHex();
                    built.put(webhook, new Payload(id, WebhookPayload.build(id, webhook, trigger, document,
                            field -> warn(webhook.id() + " field " + field, "Webhook {}: the field {} is sent as null:"
                                    + " its value is not text, a number, a boolean, a date or a list of those",
                                    webhook.id(), field))));
                }
                return built;
            });
        } catch (DocumentNotFoundException e) {
            log.info("Webhooks: document {} is gone before its {} event could be sent", documentId, trigger.id);
            return;
        }
        payloads.forEach((webhook, payload) -> {
            long now = clock.millis();
            if (payload.body().length > WebhookPayload.MAX_BYTES) {
                WebhookDelivery dead = new WebhookDelivery(payload.id(), webhook.id(), trigger.id, documentId, type,
                        State.DEAD, 0, now, now, now, Outcome.TOO_LARGE.label(), 0, false);
                store.deadAtOnce(dead);
                given(webhook, dead, Result.of(Outcome.TOO_LARGE, payload.body().length + "-bytes"));
                return;
            }
            WebhookDelivery delivery = new WebhookDelivery(payload.id(), webhook.id(), trigger.id, documentId, type,
                    State.PENDING, 0, now, now, now, null, 0, true);
            store.add(delivery, new String(payload.body(), StandardCharsets.UTF_8));
            log.debug("Webhook {}: delivery {} of {} on a {}, document {}, kept", webhook.id(), payload.id(),
                    trigger.id, type, documentId);
            schedule(delivery, TransactionHelper.isTransactionActive());
        });
    }

    /** A delivery's id and its payload's bytes. */
    private record Payload(String id, byte[] body) {
    }

    private static void schedule(WebhookDelivery delivery, boolean afterCommit) {
        WorkManager works = Framework.getService(WorkManager.class);
        if (works == null) {
            // Kept in flight: the next look for due deliveries schedules it.
            return;
        }
        works.schedule(new WebhookWork(delivery.id(), delivery.attempts()), WorkManager.Scheduling.IF_NOT_SCHEDULED,
                afterCommit);
    }

    private static boolean due(WebhookDelivery delivery, long now) {
        return delivery.state() == State.PENDING && delivery.nextAt() <= now
                || delivery.state() == State.SENDING && delivery.updated() + CLAIM_TIMEOUT.toMillis() <= now;
    }

    @Override
    public void deliver(String id) {
        WebhookDeliveries store = deliveries;
        if (store == null || id == null) {
            return;
        }
        WebhookDeliveries.Stored stored = store.inFlight(id);
        if (stored == null) {
            return;
        }
        WebhookDelivery was = stored.delivery();
        long now = clock.millis();
        if (!due(was, now)) {
            return;
        }
        Webhook webhook = webhooks.get(was.webhook());
        // A claim that expired: its node stopped, or stalled, before it finished. Its last attempt is
        // not made again; any other is, as the next.
        boolean lost = was.state() == State.SENDING && webhook != null && was.attempts() >= webhook.maxAttempts();
        WebhookDelivery claimed = was.with(State.SENDING, lost ? was.attempts() : was.attempts() + 1, now,
                was.nextAt(), was.outcome(), was.status(), was.kept());
        if (!store.replace(stored, claimed)) {
            // Another node, or another work, claimed it first.
            return;
        }
        WebhookDeliveries.Stored mine = WebhookDeliveries.Stored.of(claimed);
        Result result;
        if (lost) {
            result = Result.of(Outcome.TIMEOUT, "claim-expired");
        } else {
            try {
                result = attempt(store, webhook, claimed);
            } catch (RuntimeException e) {
                // Whatever it was, the delivery's outcome, so that it is retried, then a dead letter,
                // rather than claimed again for ever. The class only: its message may hold the address.
                result = Result.of(Outcome.FAILED, e.getClass().getSimpleName());
            }
        }
        finish(store, mine, webhook, result);
    }

    private Result attempt(WebhookDeliveries store, Webhook webhook, WebhookDelivery delivery) {
        if (webhook == null) {
            return Result.of(Outcome.UNKNOWN_WEBHOOK, null);
        }
        WebhookSender.Target target = target(webhook);
        if (target == null) {
            return Result.of(Outcome.NOT_CONFIGURED, "address");
        }
        String secret = secret(webhook);
        if (secret == null) {
            return Result.of(Outcome.NOT_CONFIGURED, "secret");
        }
        String payload = store.payload(delivery.id());
        if (payload == null) {
            return Result.of(Outcome.NO_PAYLOAD, null);
        }
        byte[] body = payload.getBytes(StandardCharsets.UTF_8);
        Map<String, String> headers = signed(webhook.id(), secret, Long.toString(clock.instant().getEpochSecond()),
                randomHex(), body);
        return sender.send(target, flag(webhook.privateAllowedProperty()), headers, body, webhook.connectTimeout(),
                webhook.timeout());
    }

    /**
     * The headers that sign a delivery, as {@link ChangeEvents} checks the change events Nuxeo takes:
     * the webhook's id, the timestamp, the nonce, and {@code sha256=} with the HMAC-SHA256, keyed with
     * the secret's UTF-8 bytes, of the id, the timestamp and the nonce, each followed by a line feed,
     * then the body.
     */
    static Map<String, String> signed(String webhook, String secret, String timestamp, String nonce, byte[] body) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put(WEBHOOK_HEADER, webhook);
        headers.put(ChangeEvents.TIMESTAMP_HEADER, timestamp);
        headers.put(ChangeEvents.NONCE_HEADER, nonce);
        headers.put(ChangeEvents.SIGNATURE_HEADER, ChangeEvents.SIGNATURE_SCHEME
                + HexFormat.of().formatHex(ChangeEvents.mac(secret, webhook, timestamp, nonce, body)));
        return headers;
    }

    private void finish(WebhookDeliveries store, WebhookDeliveries.Stored mine, Webhook webhook, Result result) {
        WebhookDelivery claimed = mine.delivery();
        long now = clock.millis();
        Outcome outcome = result.outcome();
        if (outcome == Outcome.DELIVERED) {
            WebhookDelivery done = claimed.with(State.DELIVERED, claimed.attempts(), now, now, outcome.label(),
                    result.status(), false);
            if (store.delivered(mine, done)) {
                given(webhook, done, result);
            } else {
                superseded(done, result);
            }
            return;
        }
        if (outcome.retried && webhook != null && claimed.attempts() < webhook.maxAttempts()) {
            Duration wait = backoff(claimed.attempts());
            WebhookDelivery pending = claimed.with(State.PENDING, claimed.attempts(), now, now + wait.toMillis(),
                    outcome.label(), result.status(), claimed.kept());
            if (!store.replace(mine, pending)) {
                superseded(pending, result);
                return;
            }
            log.warn("Webhook {}: delivery {} ({} of a {}, document {}), attempt {} of {}: {}{}{}; tried again in {} s",
                    claimed.webhook(), claimed.id(), claimed.event(), claimed.type(), claimed.document(),
                    claimed.attempts(), webhook.maxAttempts(), outcome.label(), status(result), detail(result),
                    wait.toSeconds());
            metrics().webhookAttempt(claimed.webhook(), outcome.label());
            audit.record(WebhookAudit.RETRYING, WebhookAudit.comment(pending, null, result.detail()));
            return;
        }
        WebhookDelivery dead = claimed.with(State.DEAD, claimed.attempts(), now, now, outcome.label(),
                result.status(), claimed.kept());
        if (store.dead(mine, dead)) {
            given(webhook, dead, result);
        } else {
            superseded(dead, result);
        }
    }

    /**
     * An attempt whose claim another node took over before it finished: what it came to is logged,
     * counted and audited, since it may have reached the receiver, and changes nothing in the store,
     * which is the other node's to write.
     */
    private void superseded(WebhookDelivery delivery, Result result) {
        Outcome outcome = result.outcome();
        metrics().webhookAttempt(delivery.webhook(), outcome.label());
        log.warn("Webhook {}: delivery {} ({} of a {}, document {}), attempt {}: {}{}{}; it was taken over by another"
                + " node meanwhile, so this outcome changes nothing", delivery.webhook(), delivery.id(),
                delivery.event(), delivery.type(), delivery.document(), delivery.attempts(), outcome.label(),
                status(result), detail(result));
        audit.record(outcome == Outcome.DELIVERED ? WebhookAudit.DELIVERED : WebhookAudit.RETRYING,
                WebhookAudit.comment(delivery, null, "superseded"));
    }

    /** A delivery done with: delivered, or a dead letter. Logged, counted and audited. */
    private void given(Webhook webhook, WebhookDelivery delivery, Result result) {
        Outcome outcome = result.outcome();
        metrics().webhookAttempt(delivery.webhook(), outcome.label());
        if (outcome == Outcome.DELIVERED) {
            log.info("Webhook {}: delivery {} ({} of a {}, document {}) delivered at attempt {}, HTTP {}",
                    delivery.webhook(), delivery.id(), delivery.event(), delivery.type(), delivery.document(),
                    delivery.attempts(), result.status());
            audit.record(WebhookAudit.DELIVERED, WebhookAudit.comment(delivery, null, null));
            return;
        }
        metrics().webhookDead(delivery.webhook());
        log.warn("Webhook {}: delivery {} ({} of a {}, document {}) is a dead letter after {} attempt(s) of {}: {}{}{}",
                delivery.webhook(), delivery.id(), delivery.event(), delivery.type(), delivery.document(),
                delivery.attempts(), webhook == null ? "?" : Integer.toString(webhook.maxAttempts()), outcome.label(),
                status(result), detail(result));
        audit.record(WebhookAudit.DEAD_LETTERED, WebhookAudit.comment(delivery, null, result.detail()));
    }

    private static String status(Result result) {
        return result.status() > 0 ? ", HTTP " + result.status() : "";
    }

    private static String detail(Result result) {
        return result.detail() == null ? "" : " (" + result.detail() + ")";
    }

    /** How long after its {@code attempts}-th failed attempt a delivery is tried again. */
    static Duration backoff(int attempts) {
        Duration wait = FIRST_RETRY;
        for (int i = 1; i < attempts && wait.compareTo(MAX_RETRY) < 0; i++) {
            wait = wait.multipliedBy(4);
        }
        return wait.compareTo(MAX_RETRY) > 0 ? MAX_RETRY : wait;
    }

    @Override
    public int retryDue() {
        WebhookDeliveries store = deliveries;
        if (store == null) {
            return 0;
        }
        long now = clock.millis();
        int scheduled = 0;
        for (String id : store.inFlightIds()) {
            WebhookDeliveries.Stored stored = store.inFlight(id);
            if (stored != null && due(stored.delivery(), now)) {
                schedule(stored.delivery(), false);
                scheduled++;
            }
        }
        return scheduled;
    }

    /** The timer's look for due deliveries: never throws, so that the timer goes on. */
    private void sweep() {
        try {
            int scheduled = retryDue();
            if (scheduled > 0) {
                log.debug("Webhooks: {} due deliveries scheduled", scheduled);
            }
        } catch (RuntimeException e) {
            log.warn("Webhooks: due deliveries could not be looked for ({})", e.getClass().getSimpleName());
        }
    }

    private static void administrator(NuxeoPrincipal who) {
        if (who == null || !who.isAdministrator()) {
            throw new NuxeoException("Only an administrator may see or resend webhook deliveries", 403);
        }
    }

    @Override
    public List<ObjectNode> deliveries(NuxeoPrincipal who, String state, int limit) {
        administrator(who);
        List<String> prefixes;
        if (state == null || state.isBlank()) {
            prefixes = List.of(WebhookDeliveries.IN_FLIGHT_PREFIX, WebhookDeliveries.DEAD_PREFIX,
                    WebhookDeliveries.DELIVERED_PREFIX);
        } else if (state.equals(State.PENDING.label())) {
            prefixes = List.of(WebhookDeliveries.IN_FLIGHT_PREFIX);
        } else if (state.equals(State.DEAD.label())) {
            prefixes = List.of(WebhookDeliveries.DEAD_PREFIX);
        } else if (state.equals(State.DELIVERED.label())) {
            prefixes = List.of(WebhookDeliveries.DELIVERED_PREFIX);
        } else {
            throw new NuxeoException("The state is one of pending, delivered or dead", 400);
        }
        int bounded = limit <= 0 ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT);
        WebhookDeliveries store = running();
        return store.recent(prefixes, bounded).stream().map(WebhookDelivery::listing).toList();
    }

    @Override
    public ObjectNode resend(NuxeoPrincipal who, String id) {
        administrator(who);
        if (id == null || !DELIVERY_ID.matcher(id).matches()) {
            throw new NuxeoException("No dead letter has this id", 404);
        }
        WebhookDeliveries store = running();
        WebhookDelivery dead = store.deadLetter(id);
        if (dead == null || dead.state() != State.DEAD) {
            throw new NuxeoException("No dead letter has this id", 404);
        }
        if (!dead.kept() || store.payload(id) == null) {
            throw new NuxeoException("This dead letter's payload is not kept, so it cannot be sent again", 409);
        }
        long now = clock.millis();
        WebhookDelivery pending = dead.with(State.PENDING, 0, now, now, "resent", 0, true);
        if (!store.revive(dead, pending)) {
            throw new NuxeoException("This delivery is already being sent again", 409);
        }
        log.info("Webhook {}: delivery {} ({} of a {}, document {}) sent again by {}", pending.webhook(), pending.id(),
                pending.event(), pending.type(), pending.document(), who.getName());
        audit.record(WebhookAudit.RESENT, WebhookAudit.comment(pending, who.getName(), null));
        schedule(pending, TransactionHelper.isTransactionActive());
        return pending.listing();
    }

    private WebhookDeliveries running() {
        WebhookDeliveries store = deliveries;
        if (store == null) {
            throw new NuxeoException("Webhooks are not started on this server", 503);
        }
        return store;
    }

    private ConnectorMetrics metrics() {
        ConnectorMetrics running = metrics;
        return running == null ? new ConnectorMetrics(new io.dropwizard.metrics5.MetricRegistry()) : running;
    }

    /** Logged at WARN once a minute per key, at debug otherwise. */
    private void warn(String key, String message, Object... arguments) {
        Instant now = clock.instant();
        Instant last = lastWarned.get(key);
        if (last == null || Duration.between(last, now).compareTo(Duration.ofMinutes(1)) >= 0) {
            lastWarned.put(key, now);
            log.warn(message, arguments);
        } else {
            log.debug(message, arguments);
        }
    }

    private static String randomHex() {
        byte[] bytes = new byte[16];
        RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
}
