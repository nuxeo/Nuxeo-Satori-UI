package org.nuxeo.agentic.connectors;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import javax.inject.Inject;

import org.apache.logging.log4j.Level;
import org.apache.logging.log4j.core.LogEvent;
import org.apache.logging.log4j.core.LoggerContext;
import org.apache.logging.log4j.core.appender.AbstractAppender;
import org.apache.logging.log4j.core.config.Configuration;
import org.apache.logging.log4j.core.config.LoggerConfig;
import org.apache.logging.log4j.core.config.Property;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.agentic.connectors.SystemOfRecordStub.Answer;
import org.nuxeo.agentic.connectors.SystemOfRecordStub.Received;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.test.runner.TransactionalFeature;

/**
 * No secret in any log line the webhooks write: every line the add-on writes, at every level down
 * to trace, and every line any other logger writes at the root's level, while deliveries are
 * delivered, retried, dead-lettered, sent again, redirected, refused their address, not sent for
 * want of an address or of a long enough secret, and their fields withheld. Not the secret, a
 * signature, a nonce, the receiver's address, the payload, nor any field's value.
 *
 * <p>The capture is shown to work: the lines this run must write are found first, so an empty or
 * silenced log fails rather than passes.
 */
@RunWith(FeaturesRunner.class)
@Features(WebhooksFeature.class)
public class WebhookLogTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    @Inject
    protected TransactionalFeature transactions;

    private Hooks hooks;

    private final Capture capture = new Capture();

    private List<LoggerConfig> attached;

    /** Every line, as the logger's name, the level and the formatted message with any exception. */
    private static final class Capture extends AbstractAppender {

        final List<String> lines = new CopyOnWriteArrayList<>();

        Capture() {
            super("webhooks-log-test", null, null, true, Property.EMPTY_ARRAY);
        }

        @Override
        public void append(LogEvent event) {
            StringBuilder line = new StringBuilder(event.getLoggerName()).append(' ')
                                                                         .append(event.getLevel())
                                                                         .append(' ')
                                                                         .append(event.getMessage().getFormattedMessage());
            for (Throwable t = event.getThrown(); t != null; t = t.getCause()) {
                line.append(" | ").append(t);
            }
            lines.add(line.toString());
        }
    }

    @Before
    public void setUp() throws Exception {
        LoggerContext context = LoggerContext.getContext(false);
        Configuration configuration = context.getConfiguration();
        capture.start();
        attached = new ArrayList<>();
        for (String name : List.of(ConnectorComponent.class.getPackageName(),
                org.apache.logging.log4j.LogManager.ROOT_LOGGER_NAME)) {
            LoggerConfig config = configuration.getLoggerConfig(name);
            assertEquals("log4j2-test.xml configures " + name, name, config.getName());
            config.addAppender(capture, Level.ALL, null);
            attached.add(config);
        }
        context.updateLoggers();
        hooks = Hooks.create(core.getRepositoryName());
    }

    @After
    public void tearDown() {
        for (LoggerConfig config : attached) {
            config.removeAppender(capture.getName());
        }
        LoggerContext.getContext(false).updateLoggers();
        capture.stop();
        hooks.close();
    }

    private void commit() throws InterruptedException {
        transactions.nextTransaction();
        Hooks.awaitWorks();
    }

    @Test
    public void noSecretSignatureNonceAddressOrValueInAnyLogLine() throws Exception {
        List<String> values = List.of("CLAIM-000150", "CLAIM-000151", "CLAIM-000152", "CLAIM-000153",
                "CLAIM-000154");

        // Delivered, with a file and a complex property withheld.
        DocumentModel claim = Hooks.claim(session, "log-a", values.get(0));
        claim.setPropertyValue("claim:scan", (java.io.Serializable) Blobs.createBlob("SCANNED-CONTENT"));
        claim.setPropertyValue("claim:adjuster", (java.io.Serializable) Map.of("name", "A. Adjuster"));
        session.saveDocument(claim);
        commit();

        // Retried, then a dead letter, then sent again and delivered.
        hooks.receiver.answer(Hooks.PATH, Answer.json("{}").status(503));
        Hooks.claim(session, "log-b", values.get(1));
        commit();
        for (int attempt = 0; attempt < 2; attempt++) {
            hooks.clock.advance(Duration.ofHours(1));
            hooks.retry();
        }
        String dead = Hooks.deliveries("dead").get(0).get("id").asText();
        hooks.receiver.answer(Hooks.PATH, Answer.json("").status(204));
        hooks.run(Claims.ADMIN, ResendWebhookDeliveryOperation.ID, Map.of("delivery", dead));
        commit();

        // Redirected, and not followed.
        hooks.receiver.answer(Hooks.PATH, Answer.json("").status(302).header("Location", "http://127.0.0.1:9/x"));
        Hooks.claim(session, "log-c", values.get(2));
        commit();

        // Its address refused: loopback, with private addresses not allowed.
        Hooks.unset(Hooks.PREFIX + "private.allowed");
        Hooks.claim(session, "log-d", values.get(3));
        commit();

        // Not sent: a secret too short, then no address.
        String tooShort = "short-" + Fixtures.generatedSecret().substring(0, 20);
        hooks.set(Hooks.PREFIX + "secret", tooShort);
        Hooks.claim(session, "log-e", values.get(4));
        commit();
        Hooks.unset(Hooks.PREFIX + "address");
        hooks.clock.advance(Duration.ofMinutes(2));
        claim.setPropertyValue("dc:title", "Modified with no address");
        session.saveDocument(claim);
        commit();

        List<String> lines = capture.lines;
        for (String expected : List.of("delivered at attempt 1, HTTP 204", "tried again in", "is a dead letter after 3",
                "sent again by " + Claims.ADMIN, "redirected, HTTP 302", "address-refused (loopback)",
                "the field scan is sent as null", "the field adjuster is sent as null",
                "is not set, or shorter than 32 characters", "an event is not sent, nor kept: the server property "
                        + Hooks.PREFIX + "address")) {
            assertTrue("no line holds \"" + expected + "\":\n" + String.join("\n", lines),
                    lines.stream().anyMatch(line -> line.contains(expected)));
        }

        List<String> secrets = new ArrayList<>(List.of(hooks.secret, hooks.secret.substring(0, 16), tooShort,
                hooks.receiver.address().replace("http://", ""), "SCANNED-CONTENT", "A. Adjuster", "Water damage"));
        secrets.addAll(values);
        assertTrue(hooks.posts().size() >= 5);
        for (Received post : hooks.posts()) {
            secrets.add(post.header("X-Nuxeo-Connector-Signature").substring("sha256=".length()));
            secrets.add(post.header("X-Nuxeo-Connector-Nonce"));
            secrets.add(post.text());
        }
        for (String line : lines) {
            for (String value : secrets) {
                assertFalse("a log line holds what it must not: " + line, line.contains(value));
            }
        }
    }
}
