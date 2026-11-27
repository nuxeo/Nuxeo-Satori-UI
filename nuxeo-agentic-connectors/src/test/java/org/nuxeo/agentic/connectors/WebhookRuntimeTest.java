package org.nuxeo.agentic.connectors;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import java.net.InetAddress;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import javax.inject.Inject;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.agentic.connectors.SystemOfRecordStub.Answer;
import org.nuxeo.agentic.connectors.SystemOfRecordStub.Received;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.event.EventService;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.test.runner.TransactionalFeature;
import org.nuxeo.runtime.transaction.TransactionHelper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Outbound webhooks in a real runtime and repository: documents created, modified, moved along
 * their lifecycle and their workflow tasks done, in transactions that commit or roll back; the
 * deliveries made by the work manager to a receiver on the loopback interface; and what an
 * administrator sees and sends again, through the Automation service.
 */
@RunWith(FeaturesRunner.class)
@Features(WebhooksFeature.class)
public class WebhookRuntimeTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    @Inject
    protected TransactionalFeature transactions;

    private Hooks hooks;

    @Before
    public void setUp() throws Exception {
        hooks = Hooks.create(core.getRepositoryName());
    }

    @After
    public void tearDown() {
        hooks.close();
    }

    /** The transaction committed, and every work it caused done: the listener's, then the attempts. */
    private void commit() throws InterruptedException {
        transactions.nextTransaction();
        Hooks.awaitWorks();
    }

    @Test
    public void aClaimCreatedIsSentSignedWithTheNamedFieldsAndNothingElse() throws Exception {
        DocumentModel claim = session.createDocumentModel("/", "claim-a", "Claim");
        claim.setPropertyValue("claim:number", "CLAIM-000130");
        claim.setPropertyValue("dc:title", "Water damage");
        claim.setPropertyValue("dc:description", "An adjuster's note that no webhook names");
        claim.setPropertyValue("dc:subjects", new String[] { "water", "kitchen" });
        claim.setPropertyValue("claim:scan", (java.io.Serializable) Blobs.createBlob("THE SCANNED FILE'S CONTENT",
                "text/plain", null, "scan.txt"));
        claim.setPropertyValue("claim:adjuster", (java.io.Serializable) Map.of("name", "A. Adjuster", "phone",
                "555-0100"));
        claim = session.createDocument(claim);
        commit();

        List<Received> posts = hooks.posts();
        assertEquals(1, posts.size());
        Received post = posts.get(0);
        hooks.assertSigned(post);
        JsonNode body = Hooks.body(post);
        assertEquals(List.of("delivery", "event", "document", "fields"), names(body));
        assertTrue(body.get("delivery").asText().matches("[0-9a-f]{32}"));
        assertEquals("created", body.get("event").asText());
        assertEquals(List.of("id", "type"), names(body.get("document")));
        assertEquals(claim.getId(), body.at("/document/id").asText());
        assertEquals("Claim", body.at("/document/type").asText());
        assertEquals(List.of("claimNumber", "title", "subjects", "state", "scan", "adjuster"),
                names(body.get("fields")));
        assertEquals("CLAIM-000130", body.at("/fields/claimNumber").asText());
        assertEquals("Water damage", body.at("/fields/title").asText());
        assertEquals("[\"water\",\"kitchen\"]", body.at("/fields/subjects").toString());
        assertEquals("project", body.at("/fields/state").asText());
        // A file and a complex property are named, and withheld: never their content, name or parts.
        assertTrue(body.at("/fields/scan").isNull());
        assertTrue(body.at("/fields/adjuster").isNull());
        String text = post.text();
        for (String never : List.of("SCANNED", "scan.txt", "adjuster's note", "A. Adjuster", "555-0100")) {
            assertFalse(never + " is in the payload", text.contains(never));
        }

        // Delivered: kept without its payload, and audited without the fields' values.
        List<ObjectNode> delivered = Hooks.deliveries("delivered");
        assertEquals(1, delivered.size());
        assertEquals(body.get("delivery").asText(), delivered.get(0).get("id").asText());
        assertEquals(204, delivered.get(0).get("status").asInt());
        assertTrue(Hooks.deliveries("pending").isEmpty());
        assertFalse(delivered.get(0).toString().contains("CLAIM-000130"));
        assertEquals(List.of(WebhookAudit.DELIVERED), hooks.audit.events());
        String entry = hooks.audit.entries.get(0);
        assertTrue(entry, entry.contains("delivery=" + body.get("delivery").asText()) && entry.contains("status=204")
                && entry.contains("document=" + claim.getId()));
        assertFalse(entry, entry.contains("CLAIM-000130") || entry.contains("Water damage")
                || entry.contains(hooks.secret));
    }

    @Test
    public void eachEventIsSentOncePerTransactionAndOnlyForTheWebhooksTypes() throws Exception {
        DocumentModel claim = Hooks.claim(session, "claim-b", "CLAIM-000131");
        session.createDocument(session.createDocumentModel("/", "not-a-claim", "Folder"));
        commit();
        assertEquals(List.of("created"), events());

        // Modified three times in one transaction: one delivery, with the values as committed.
        for (String title : List.of("First", "Second", "Third")) {
            claim.setPropertyValue("dc:title", title);
            claim = session.saveDocument(claim);
        }
        commit();
        assertEquals(List.of("created", "modified"), events());
        assertEquals("Third", Hooks.body(hooks.posts().get(1)).at("/fields/title").asText());

        session.followTransition(claim.getRef(), "approve");
        commit();
        JsonNode transitioned = Hooks.body(last());
        assertEquals("transitioned", transitioned.get("event").asText());
        assertEquals("approved", transitioned.at("/fields/state").asText());

        // A workflow task done on the claim: the task service fires it on the task's documents.
        DocumentEventContext context = new DocumentEventContext(session, session.getPrincipal(),
                session.getDocument(claim.getRef()));
        Framework.getService(EventService.class).fireEvent(context.newEvent("workflowTaskCompleted"));
        commit();
        assertEquals("taskCompleted", Hooks.body(last()).get("event").asText());

        // The folder sent nothing; each delivery is its own.
        List<String> ids = new ArrayList<>();
        for (Received post : hooks.posts()) {
            hooks.assertSigned(post);
            assertEquals(claim.getId(), Hooks.body(post).at("/document/id").asText());
            ids.add(Hooks.body(post).get("delivery").asText());
        }
        assertEquals(ids.size(), ids.stream().distinct().count());
    }

    private List<String> events() throws Exception {
        List<String> events = new ArrayList<>();
        for (Received post : hooks.posts()) {
            events.add(Hooks.body(post).get("event").asText());
        }
        return events;
    }

    private Received last() {
        List<Received> posts = hooks.posts();
        return posts.get(posts.size() - 1);
    }

    @Test
    public void nothingIsSentOrKeptForATransactionThatRollsBack() throws Exception {
        DocumentModel claim = Hooks.claim(session, "claim-c", "CLAIM-000132");
        claim.setPropertyValue("dc:title", "Changed, then rolled back");
        session.saveDocument(claim);
        TransactionHelper.setTransactionRollbackOnly();
        // Rolled back here, since the feature's nextTransaction leaves a transaction marked for rollback.
        assertFalse(TransactionHelper.isTransactionActive());
        TransactionHelper.commitOrRollbackTransaction();
        assertFalse(TransactionHelper.isTransactionActiveOrMarkedRollback());
        TransactionHelper.startTransaction();
        commit();
        assertEquals(List.of(), hooks.posts());
        assertEquals(List.of(), Hooks.deliveries(null));
        assertEquals(List.of(), hooks.audit.entries);
        assertFalse(session.exists(new org.nuxeo.ecm.core.api.PathRef("/claim-c")));

        // The same, committed: the receiver is reached, so the silence above was the rollback's.
        Hooks.claim(session, "claim-c", "CLAIM-000132");
        commit();
        assertEquals(1, hooks.posts().size());
    }

    @Test
    public void aFailingReceiverIsRetriedWithBackoffThenDeadLetteredThenResent() throws Exception {
        hooks.receiver.answer(Hooks.PATH, Answer.json("{\"error\":\"down\"}").status(503));
        DocumentModel claim = Hooks.claim(session, "claim-d", "CLAIM-000133");
        commit();
        assertEquals(1, hooks.posts().size());
        ObjectNode pending = Hooks.deliveries("pending").get(0);
        assertEquals(1, pending.get("attempts").asInt());
        assertEquals("failed", pending.get("outcome").asText());
        assertEquals(503, pending.get("status").asInt());
        assertEquals(hooks.clock.instant().plusSeconds(30).toString(), pending.get("nextAttempt").asText());

        // Not before its time.
        assertEquals(0, hooks.retry());
        hooks.clock.advance(Duration.ofSeconds(29));
        assertEquals(0, hooks.retry());
        assertEquals(1, hooks.posts().size());
        hooks.clock.advance(Duration.ofSeconds(1));
        assertEquals(1, hooks.retry());
        assertEquals(2, hooks.posts().size());
        // The second wait is four times the first.
        hooks.clock.advance(Duration.ofSeconds(119));
        assertEquals(0, hooks.retry());
        hooks.clock.advance(Duration.ofSeconds(1));
        assertEquals(1, hooks.retry());
        assertEquals(3, hooks.posts().size());

        // Its third attempt was its last: a dead letter, kept with its payload, listed without it.
        assertEquals(List.of(), Hooks.deliveries("pending"));
        List<ObjectNode> dead = Hooks.deliveries("dead");
        assertEquals(1, dead.size());
        ObjectNode letter = dead.get(0);
        assertEquals(3, letter.get("attempts").asInt());
        assertEquals("failed", letter.get("outcome").asText());
        assertTrue(letter.get("resendable").asBoolean());
        assertEquals(claim.getId(), letter.get("document").asText());
        assertFalse(letter.toString(), letter.toString().contains("CLAIM-000133") || letter.has("body")
                || letter.has("fields"));
        hooks.clock.advance(Duration.ofHours(7));
        assertEquals("a dead letter is not retried", 0, hooks.retry());
        assertEquals(3, hooks.posts().size());
        assertEquals(List.of(WebhookAudit.RETRYING, WebhookAudit.RETRYING, WebhookAudit.DEAD_LETTERED),
                hooks.audit.events());

        // Each attempt is signed afresh, and is the same delivery.
        List<String> nonces = new ArrayList<>();
        for (Received post : hooks.posts()) {
            hooks.assertSigned(post);
            nonces.add(post.header("X-Nuxeo-Connector-Nonce"));
            assertEquals(letter.get("id").asText(), Hooks.body(post).get("delivery").asText());
        }
        assertEquals(3, nonces.stream().distinct().count());

        // The receiver mended, the administrator sends it again: the same delivery, delivered.
        hooks.receiver.answer(Hooks.PATH, Answer.json("").status(204));
        JsonNode resent = hooks.run(Claims.ADMIN, ResendWebhookDeliveryOperation.ID,
                Map.of("delivery", letter.get("id").asText()));
        assertEquals("pending", resent.at("/delivery/state").asText());
        assertEquals(0, resent.at("/delivery/attempts").asInt());
        commit();
        assertEquals(4, hooks.posts().size());
        Received again = last();
        hooks.assertSigned(again);
        assertEquals(Hooks.body(hooks.posts().get(0)), Hooks.body(again));
        assertEquals(List.of(), Hooks.deliveries("dead"));
        List<ObjectNode> delivered = Hooks.deliveries("delivered");
        assertEquals(1, delivered.size());
        assertEquals(letter.get("id").asText(), delivered.get(0).get("id").asText());
        assertEquals(1, delivered.get(0).get("attempts").asInt());
        assertEquals(List.of(WebhookAudit.RETRYING, WebhookAudit.RETRYING, WebhookAudit.DEAD_LETTERED,
                WebhookAudit.RESENT, WebhookAudit.DELIVERED), hooks.audit.events());
        assertTrue(hooks.audit.entries.get(3), hooks.audit.entries.get(3).endsWith(" by=" + Claims.ADMIN));

        // Sent again once only: a second resend finds no dead letter.
        assertEquals(404, hooks.refused(Claims.ADMIN, ResendWebhookDeliveryOperation.ID,
                Map.of("delivery", letter.get("id").asText())));
    }

    /**
     * Four nodes, or four works, run one due attempt at once, the receiver slow to answer: the claim
     * lets one of them send it, and the others send nothing.
     */
    @Test
    public void anAttemptIsClaimedOnceWhateverRunsIt() throws Exception {
        hooks.receiver.answer(Hooks.PATH, Answer.json("{}").status(503));
        Hooks.claim(session, "claim-k", "CLAIM-000143");
        commit();
        assertEquals(1, hooks.posts().size());
        String id = Hooks.deliveries("pending").get(0).get("id").asText();
        hooks.receiver.answer(Hooks.PATH, Answer.json("").status(204).delay(300));
        hooks.clock.advance(Duration.ofSeconds(30));

        java.util.concurrent.ExecutorService nodes = java.util.concurrent.Executors.newFixedThreadPool(4);
        java.util.concurrent.CountDownLatch go = new java.util.concurrent.CountDownLatch(1);
        List<java.util.concurrent.Future<?>> running = new ArrayList<>();
        for (int node = 0; node < 4; node++) {
            running.add(nodes.submit(() -> {
                go.await();
                Hooks.component().deliver(id);
                return null;
            }));
        }
        go.countDown();
        for (java.util.concurrent.Future<?> each : running) {
            each.get(10, java.util.concurrent.TimeUnit.SECONDS);
        }
        nodes.shutdown();
        assertEquals("one attempt, sent once", 2, hooks.posts().size());
        assertEquals(1, Hooks.deliveries("delivered").size());
        assertEquals(2, Hooks.deliveries("delivered").get(0).get("attempts").asInt());
    }

    @Test
    public void anAnswerNoRetryWouldChangeIsADeadLetterAtOnce() throws Exception {
        hooks.receiver.answer(Hooks.PATH, Answer.json("{}").status(400));
        Hooks.claim(session, "claim-e", "CLAIM-000134");
        commit();
        hooks.clock.advance(Duration.ofHours(1));
        assertEquals(0, hooks.retry());
        assertEquals(1, hooks.posts().size());
        ObjectNode letter = Hooks.deliveries("dead").get(0);
        assertEquals("rejected", letter.get("outcome").asText());
        assertEquals(400, letter.get("status").asInt());
        assertEquals(1, letter.get("attempts").asInt());
    }

    @Test
    public void aHostTheServerDoesNotNameIsNeverSentTo() throws Exception {
        // No address: nothing sent, and nothing kept, for either webhook.
        Hooks.unset(Hooks.PREFIX + "address");
        DocumentModel claim = Hooks.claim(session, "claim-f", "CLAIM-000135");
        commit();
        claim.setPropertyValue("dc:title", "Modified");
        session.saveDocument(claim);
        commit();
        assertEquals(List.of(), hooks.receiver.received);
        assertEquals(List.of(), Hooks.deliveries(null));

        // A receiver that redirects elsewhere: the other host is never asked, and the delivery is a
        // dead letter, since following it is what no attempt will do.
        try (SystemOfRecordStub elsewhere = new SystemOfRecordStub()) {
            elsewhere.answer(Hooks.PATH, Answer.json("").status(204));
            hooks.receiver.answer(Hooks.PATH,
                    Answer.json("").status(307).header("Location", elsewhere.address() + Hooks.PATH));
            hooks.set(Hooks.PREFIX + "address", hooks.receiver.address() + Hooks.PATH);
            claim.setPropertyValue("dc:title", "Modified again");
            session.saveDocument(claim);
            commit();
            hooks.clock.advance(Duration.ofHours(1));
            hooks.retry();
            assertEquals(1, hooks.posts().size());
            assertEquals(List.of(), elsewhere.received);
            ObjectNode letter = Hooks.deliveries("dead").get(0);
            assertEquals("redirected", letter.get("outcome").asText());
            assertEquals(307, letter.get("status").asInt());
        }

        // The address the server names, and only it: a resend goes where the server says now.
        try (SystemOfRecordStub moved = new SystemOfRecordStub()) {
            moved.answer(Hooks.PATH, Answer.json("").status(204));
            hooks.set(Hooks.PREFIX + "address", moved.address() + Hooks.PATH);
            hooks.run(Claims.ADMIN, ResendWebhookDeliveryOperation.ID,
                    Map.of("delivery", Hooks.deliveries("dead").get(0).get("id").asText()));
            commit();
            assertEquals(1, hooks.posts().size());
            assertEquals(1, moved.received.size());
        }
    }

    @Test
    public void aPrivateOrLoopbackAddressIsRefusedEvenThroughDns() throws Exception {
        WebhookComponent component = Hooks.component();
        int port = Integer.parseInt(hooks.receiver.address().replaceAll(".*:", ""));
        AtomicInteger asked = new AtomicInteger();
        List<InetAddress> answer = new ArrayList<>();
        component.sender(new WebhookSender(host -> {
            asked.incrementAndGet();
            if (!host.equals("receiver.example.test")) {
                return InetAddress.getAllByName(host);
            }
            return answer.toArray(InetAddress[]::new);
        }, javax.net.ssl.HttpsURLConnection.getDefaultSSLSocketFactory()));

        // The loopback address itself, private addresses not allowed.
        Hooks.unset(Hooks.PREFIX + "private.allowed");
        Hooks.claim(session, "claim-g1", "CLAIM-000136");
        commit();
        assertRefused("loopback");

        // A name the DNS answers with the loopback address.
        hooks.set(Hooks.PREFIX + "address", "http://receiver.example.test:" + port + Hooks.PATH);
        answer.add(InetAddress.getByName("127.0.0.1"));
        Hooks.claim(session, "claim-g2", "CLAIM-000137");
        commit();
        assertRefused("loopback");

        // A name the DNS answers with a public and a private address: refused whole.
        answer.clear();
        answer.add(InetAddress.getByName("93.184.215.14"));
        answer.add(InetAddress.getByName("10.0.0.5"));
        Hooks.claim(session, "claim-g3", "CLAIM-000138");
        commit();
        assertRefused("private");

        // Link-local, where cloud metadata answers: refused even where private addresses are allowed.
        hooks.set(Hooks.PREFIX + "private.allowed", "true");
        answer.clear();
        answer.add(InetAddress.getByName("169.254.169.254"));
        Hooks.claim(session, "claim-g4", "CLAIM-000139");
        commit();
        assertRefused("link-local");
        answer.clear();
        answer.add(InetAddress.getByName("::ffff:169.254.169.254"));
        Hooks.claim(session, "claim-g5", "CLAIM-000140");
        commit();
        assertRefused("link-local");
        assertEquals("nothing was sent", List.of(), hooks.receiver.received);

        // Allowed, the name resolved once and the connection made to the address checked, the name
        // kept for the Host header.
        answer.clear();
        answer.add(InetAddress.getByName("127.0.0.1"));
        asked.set(0);
        Hooks.claim(session, "claim-g6", "CLAIM-000141");
        commit();
        assertEquals(1, hooks.posts().size());
        assertEquals("receiver.example.test:" + port, hooks.posts().get(0).header("Host"));
        assertEquals(1, asked.get());
        hooks.assertSigned(hooks.posts().get(0));
    }

    /** The last delivery a dead letter, its address refused for this kind, and nothing sent. */
    private void assertRefused(String kind) {
        List<ObjectNode> dead = Hooks.deliveries("dead");
        assertFalse(dead.isEmpty());
        ObjectNode letter = dead.get(0);
        assertEquals("address-refused", letter.get("outcome").asText());
        assertEquals(1, letter.get("attempts").asInt());
        assertFalse(letter.has("status"));
        assertEquals(List.of(), hooks.receiver.received);
        String entry = hooks.audit.entries.get(hooks.audit.entries.size() - 1);
        assertTrue(entry, entry.startsWith(WebhookAudit.DEAD_LETTERED + " ") && entry.contains("outcome=address-refused")
                && entry.contains(" reason=" + kind));
    }

    @Test
    public void onlyAnAdministratorListsOrResendsDeliveries() throws Exception {
        hooks.receiver.answer(Hooks.PATH, Answer.json("{}").status(410));
        Hooks.claim(session, "claim-h", "CLAIM-000142");
        commit();
        String id = Hooks.deliveries("dead").get(0).get("id").asText();
        hooks.receiver.answer(Hooks.PATH, Answer.json("").status(204));

        for (String user : List.of(Claims.ALICE, Claims.BOB)) {
            assertEquals(403, hooks.refused(user, ListWebhookDeliveriesOperation.ID, Map.of()));
            assertEquals(403, hooks.refused(user, ListWebhookDeliveriesOperation.ID, Map.of("state", "dead")));
            assertEquals(403, hooks.refused(user, ResendWebhookDeliveryOperation.ID, Map.of("delivery", id)));
            // Refused before anything is read: an id that is no dead letter's is refused the same.
            assertEquals(403, hooks.refused(user, ResendWebhookDeliveryOperation.ID,
                    Map.of("delivery", "0".repeat(32))));
        }
        commit();
        assertEquals("nothing was sent again", 1, hooks.posts().size());
        assertEquals(1, Hooks.deliveries("dead").size());
        assertEquals(List.of(WebhookAudit.DEAD_LETTERED), hooks.audit.events());
        try {
            Hooks.component().deliveries(null, null, 10);
            throw new AssertionError("no principal, and listed");
        } catch (org.nuxeo.ecm.core.api.NuxeoException e) {
            assertEquals(403, e.getStatusCode());
        }

        JsonNode listed = hooks.run(Claims.ADMIN, ListWebhookDeliveriesOperation.ID, Map.of("state", "dead"));
        assertEquals(id, listed.at("/deliveries/0/id").asText());
        assertEquals(400, hooks.refused(Claims.ADMIN, ListWebhookDeliveriesOperation.ID, Map.of("state", "all")));
        assertEquals(404, hooks.refused(Claims.ADMIN, ResendWebhookDeliveryOperation.ID,
                Map.of("delivery", "../" + id)));
        hooks.run(Claims.ADMIN, ResendWebhookDeliveryOperation.ID, Map.of("delivery", id));
        commit();
        assertEquals(2, hooks.posts().size());
        assertNotEquals(hooks.posts().get(0).header("X-Nuxeo-Connector-Nonce"),
                hooks.posts().get(1).header("X-Nuxeo-Connector-Nonce"));
    }

    private static List<String> names(JsonNode node) {
        List<String> names = new ArrayList<>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }
}
