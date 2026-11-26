package org.nuxeo.agentic.connectors;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.connectors.Claims.ADMIN;
import static org.nuxeo.agentic.connectors.Claims.ALICE;
import static org.nuxeo.agentic.connectors.Claims.BOB;
import static org.nuxeo.agentic.connectors.Claims.KEY_A;
import static org.nuxeo.agentic.connectors.Claims.KEY_B;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
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
import org.nuxeo.agentic.connectors.SystemOfRecordStub.Event;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * No secret in any log line: every line the add-on writes, at every level down to debug and trace,
 * and every line any other logger writes at the root's level, while the connector is read with its
 * credential, from the system and from the cache, refused, read past the cache, and sent change
 * events accepted and refused for each reason. Not the events secret, the credential, a signature,
 * a nonce, nor a record's key, which may be personal data.
 *
 * <p>The capture is shown to work: the lines this run must write are found first, so an empty or
 * silenced log fails rather than passes.
 */
@RunWith(FeaturesRunner.class)
@Features(ConnectorsFeature.class)
public class ConnectorLogTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private Claims claims;

    private ServletBridge nuxeo;

    private final Capture capture = new Capture();

    /** Every line, as the logger's name, the level and the formatted message with any exception. */
    private static final class Capture extends AbstractAppender {

        final List<String> lines = new CopyOnWriteArrayList<>();

        Capture() {
            super("connectors-log-test", null, null, true, Property.EMPTY_ARRAY);
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

    private List<LoggerConfig> attached;

    @Before
    public void setUp() throws Exception {
        LoggerContext context = LoggerContext.getContext(false);
        Configuration configuration = context.getConfiguration();
        capture.start();
        attached = new ArrayList<>();
        // The add-on's own logger, on at every level in log4j2-test.xml, and the root.
        for (String name : List.of(ConnectorComponent.class.getPackageName(),
                org.apache.logging.log4j.LogManager.ROOT_LOGGER_NAME)) {
            LoggerConfig config = configuration.getLoggerConfig(name);
            assertEquals("log4j2-test.xml configures " + name, name, config.getName());
            config.addAppender(capture, Level.ALL, null);
            attached.add(config);
        }
        assertEquals(Level.ALL, configuration.getLoggerConfig(ConnectorComponent.class.getPackageName()).getLevel());
        context.updateLoggers();
        claims = Claims.create(session, core.getRepositoryName());
        nuxeo = new ServletBridge();
    }

    @After
    public void tearDown() {
        for (LoggerConfig config : attached) {
            config.removeAppender(capture.getName());
        }
        LoggerContext.getContext(false).updateLoggers();
        capture.stop();
        nuxeo.close();
        claims.close();
    }

    @Test
    public void noSecretInAnyLogLine() throws Exception {
        String secret = Fixtures.generatedSecret();
        Claims.set(Claims.PREFIX + "events.secret", secret);
        List<String> sent = new ArrayList<>();

        claims.read(ALICE, claims.a);
        claims.clock.advance(Duration.ofSeconds(3));
        claims.read(ALICE, claims.a);
        claims.refusal(Exception.class, BOB, claims.a, false);
        claims.refusal(Exception.class, ALICE, claims.a, true);
        claims.read(ADMIN, claims.a, true);
        claims.stub.answer("/claims/" + KEY_B, SystemOfRecordStub.Answer.json("{}").status(503));
        claims.refusal(Exception.class, BOB, claims.b, false);

        Event accepted = Event.about(Claims.CONNECTOR, KEY_A, claims.clock);
        sent.add(accepted.signature(secret));
        sent.add(accepted.nonce());
        assertEquals(204, SystemOfRecordStub.send(nuxeo.events(), accepted, accepted.signature(secret)));
        assertEquals(401, SystemOfRecordStub.send(nuxeo.events(), accepted, accepted.signature(secret)));
        Event forged = Event.about(Claims.CONNECTOR, KEY_A, claims.clock);
        String forgery = forged.signature(Fixtures.generatedSecret());
        sent.add(forgery);
        sent.add(forged.nonce());
        assertEquals(401, SystemOfRecordStub.send(nuxeo.events(), forged, forgery));
        Event old = Event.about(Claims.CONNECTOR, KEY_A, claims.clock)
                         .at(Long.toString(claims.clock.instant().getEpochSecond() - 3600));
        sent.add(old.signature(secret));
        sent.add(old.nonce());
        assertEquals(401, SystemOfRecordStub.send(nuxeo.events(), old, old.signature(secret)));
        Event unknown = Event.about("test.unknown", KEY_A, claims.clock);
        sent.add(unknown.signature(secret));
        sent.add(unknown.nonce());
        assertEquals(401, SystemOfRecordStub.send(nuxeo.events(), unknown, unknown.signature(secret)));
        Event malformed = new Event(Claims.CONNECTOR, accepted.timestamp(), "stand-in-malformed-0001",
                "{\"key\":\"../" + KEY_A + "\"}");
        sent.add(malformed.signature(secret));
        sent.add(malformed.nonce());
        assertEquals(400, SystemOfRecordStub.send(nuxeo.events(), malformed, malformed.signature(secret)));
        // A secret too short to be used is still a secret: set, refused, and never logged.
        String tooShort = "short-" + Fixtures.generatedSecret().substring(0, 20);
        sent.add(tooShort);
        Claims.set(Claims.PREFIX + "events.secret", tooShort);
        Event unsigned = Event.about(Claims.CONNECTOR, KEY_A, claims.clock);
        sent.add(unsigned.nonce());
        assertEquals(401, SystemOfRecordStub.send(nuxeo.events(), unsigned, "sha256=" + "0".repeat(64)));

        List<String> lines = capture.lines;
        // The capture works: the lines this run must have written are there.
        for (String expected : List.of("nothing kept for document", "answered from the cache",
                "an administrator reads past the cache", "dropped 1 kept answer",
                "a change event was refused: its nonce has been seen already",
                "a change event was refused: its signature is not the connector's",
                "a change event was refused: its timestamp is more than",
                "a change event was refused: it names no connector",
                "a change event was refused: it is signed, but not a JSON object",
                "a change event was refused: the connector has no events secret", "the system answered HTTP 503")) {
            assertTrue("no line holds \"" + expected + "\":\n" + String.join("\n", lines),
                    lines.stream().anyMatch(line -> line.contains(expected)));
        }
        List<String> secrets = new ArrayList<>(List.of(secret, secret.substring(0, 16), claims.token,
                claims.token.substring(0, 16), KEY_A, KEY_B, "test.unknown"));
        sent.forEach(value -> secrets.add(value.startsWith("sha256=") ? value.substring(7) : value));
        for (String line : lines) {
            for (String value : secrets) {
                assertFalse("a log line holds what it must not: " + line, line.contains(value));
            }
        }
    }
}
