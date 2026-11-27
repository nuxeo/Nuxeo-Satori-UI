package org.nuxeo.agentic.connectors;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;

import org.nuxeo.agentic.connectors.SystemOfRecordStub.Answer;
import org.nuxeo.agentic.connectors.SystemOfRecordStub.Received;
import org.nuxeo.ecm.automation.AutomationService;
import org.nuxeo.ecm.automation.OperationContext;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.work.api.WorkManager;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.kv.KeyValueService;
import org.nuxeo.runtime.kv.KeyValueStoreProvider;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * The webhooks' runtime tests' receiver and server settings: a receiver on the loopback interface
 * that answers 204 at {@value #PATH} and keeps every request it is sent, body and all, the test
 * webhook pointed at it with a secret generated for the run, an audit that records what it is
 * given, and the clock the tests move on. The timer that looks for due deliveries is stopped, so
 * that only a test's own {@link WebhookComponent#retryDue} sends a retry.
 */
final class Hooks implements AutoCloseable {

    static final String WEBHOOK = "test.claimUpdates";

    static final String UNCONFIGURED = "test.unconfigured";

    static final String PREFIX = Webhook.PROPERTY_PREFIX + WEBHOOK + ".";

    static final String PATH = "/hooks/claims";

    /** What the audit was given: each entry's event and comment. */
    static final class Audit implements WebhookAudit {

        final List<String> entries = new CopyOnWriteArrayList<>();

        @Override
        public void record(String event, String comment) {
            entries.add(event + " " + comment);
        }

        List<String> events() {
            return entries.stream().map(entry -> entry.substring(0, entry.indexOf(' '))).toList();
        }
    }

    final SystemOfRecordStub receiver;

    final String secret = Fixtures.generatedSecret();

    final Fixtures.Clock clock = new Fixtures.Clock();

    final Audit audit = new Audit();

    /** The clock's time when the test started, in seconds. */
    final long started = clock.instant().getEpochSecond();

    final String repository;

    private final List<String> set = new ArrayList<>();

    private Hooks(SystemOfRecordStub receiver, String repository) {
        this.receiver = receiver;
        this.repository = repository;
    }

    static Hooks create(String repository) throws Exception {
        SystemOfRecordStub receiver = new SystemOfRecordStub();
        receiver.answer(PATH, Answer.json("").status(204));
        Hooks hooks = new Hooks(receiver, repository);
        WebhookComponent component = component();
        component.stopRetrying();
        component.clock(hooks.clock);
        component.audit(hooks.audit);
        component.sender(WebhookSender.platform());
        store().clear();
        hooks.set(PREFIX + "address", receiver.address() + PATH);
        hooks.set(PREFIX + "http.allowed", "true");
        hooks.set(PREFIX + "private.allowed", "true");
        hooks.set(PREFIX + "secret", hooks.secret);
        return hooks;
    }

    static WebhookComponent component() {
        return (WebhookComponent) Framework.getService(WebhookService.class);
    }

    static KeyValueStoreProvider store() {
        return (KeyValueStoreProvider) Framework.getService(KeyValueService.class)
                                                .getKeyValueStore(WebhookDeliveries.STORE);
    }

    void set(String property, String value) {
        Framework.getProperties().setProperty(property, value);
        set.add(property);
    }

    static void unset(String property) {
        Framework.getProperties().remove(property);
    }

    /** A claim with this number, created, not yet committed. */
    static DocumentModel claim(CoreSession session, String name, String number) {
        DocumentModel claim = session.createDocumentModel("/", name, "Claim");
        claim.setPropertyValue("claim:number", number);
        claim.setPropertyValue("dc:title", "Water damage, " + number);
        return session.createDocument(claim);
    }

    /** Waits for every scheduled work, the deliveries' attempts among them. */
    static void awaitWorks() throws InterruptedException {
        assertTrue("the work manager did not finish",
                Framework.getService(WorkManager.class).awaitCompletion(30, TimeUnit.SECONDS));
    }

    /** The due deliveries scheduled, as the timer would, and their attempts made. */
    int retry() throws InterruptedException {
        int scheduled = component().retryDue();
        awaitWorks();
        return scheduled;
    }

    /** What the receiver was sent, at its path. */
    List<Received> posts() {
        return receiver.received.stream().filter(r -> r.path().equals(PATH)).toList();
    }

    static JsonNode body(Received received) throws Exception {
        return WebhookDelivery.JSON.readTree(received.body());
    }

    /**
     * The delivery is signed as the add-on documents it, checked here apart from the add-on's own
     * code: HMAC-SHA256, keyed with the secret's UTF-8 bytes, of the webhook's id, the timestamp and
     * the nonce, each followed by a line feed, then the body's bytes as sent; the timestamp the
     * server's clock's, and the nonce one the change events would take.
     */
    void assertSigned(Received received) throws Exception {
        assertEquals("POST", received.method());
        assertEquals(WEBHOOK, received.header("X-Nuxeo-Webhook"));
        assertEquals("application/json", received.header("Content-Type"));
        assertEquals(SystemOfRecordClient.USER_AGENT, received.header("User-Agent"));
        String timestamp = received.header("X-Nuxeo-Connector-Timestamp");
        assertNotNull(timestamp);
        // Each attempt's own: the clock's when it was made, between the test's start and now.
        long sent = Long.parseLong(timestamp);
        assertTrue(timestamp, sent >= started && sent <= clock.instant().getEpochSecond());
        String nonce = received.header("X-Nuxeo-Connector-Nonce");
        assertNotNull(nonce);
        assertTrue(nonce, nonce.matches("[A-Za-z0-9_-]{16,128}"));
        assertEquals(sign(secret, WEBHOOK, timestamp, nonce, received.body()),
                received.header("X-Nuxeo-Connector-Signature"));
    }

    static String sign(String secret, String id, String timestamp, String nonce, byte[] body) throws Exception {
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        mac.update((id + "\n" + timestamp + "\n" + nonce + "\n").getBytes(StandardCharsets.UTF_8));
        return "sha256=" + java.util.HexFormat.of().formatHex(mac.doFinal(body));
    }

    /** The deliveries as an administrator lists them, through the service. */
    static List<com.fasterxml.jackson.databind.node.ObjectNode> deliveries(String state) {
        return component().deliveries(Claims.principal(Claims.ADMIN), state, 200);
    }

    /** An Automation operation run as {@code user}, its JSON answer. */
    JsonNode run(String user, String operation, Map<String, Object> params) throws Exception {
        CoreSession session = CoreInstance.getCoreSession(repository, Claims.principal(user));
        OperationContext context = new OperationContext(session);
        Blob answer = (Blob) Framework.getService(AutomationService.class).run(context, operation, params);
        return WebhookDelivery.JSON.readTree(answer.getString());
    }

    /** The status of the {@code NuxeoException} an operation run as {@code user} fails with. */
    int refused(String user, String operation, Map<String, Object> params) {
        try {
            run(user, operation, params);
        } catch (Throwable t) {
            for (Throwable cause = t; cause != null; cause = cause.getCause()) {
                if (cause instanceof org.nuxeo.ecm.core.api.NuxeoException refusal && refusal.getStatusCode() != 500) {
                    return refusal.getStatusCode();
                }
            }
            throw new AssertionError("refused, but with no status", t);
        }
        throw new AssertionError(operation + " was not refused for " + user);
    }

    @Override
    public void close() {
        set.forEach(Hooks::unset);
        set.clear();
        WebhookComponent component = component();
        component.clock(java.time.InstantSource.system());
        component.audit(new WebhookAudit.Platform());
        component.sender(WebhookSender.platform());
        store().clear();
        receiver.close();
    }
}
