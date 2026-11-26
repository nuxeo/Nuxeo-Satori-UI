/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.signature.Desk.ALICE;
import static org.nuxeo.agentic.signature.Signatures.text;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.time.Clock;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import javax.inject.Inject;

import org.apache.logging.log4j.Level;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.core.LogEvent;
import org.apache.logging.log4j.core.LoggerContext;
import org.apache.logging.log4j.core.appender.AbstractAppender;
import org.apache.logging.log4j.core.config.LoggerConfig;
import org.apache.logging.log4j.core.config.Property;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * No secret in a log: every line the add-on logs, at every level, with its stack, through a send,
 * a refused send, refused and accepted callbacks and a service that fails, holds neither the API
 * key, nor the callback secret, nor a callback's signature, nor a signer's address, nor the file.
 * The capture is shown to work by the refusals it must hold.
 */
@RunWith(FeaturesRunner.class)
@Features(SignatureFeature.class)
public class LogTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private String repository;

    private StandInStub stub;

    private final List<String> lines = Collections.synchronizedList(new ArrayList<>());

    private LoggerConfig logger;

    private Level level;

    private AbstractAppender appender;

    @Before
    public void setUp() throws Exception {
        repository = core.getRepositoryName();
        stub = new StandInStub();
        Desk.configure(stub);
        Desk.create(session);
        LoggerContext context = (LoggerContext) LogManager.getContext(false);
        logger = context.getConfiguration().getLoggerConfig("org.nuxeo.agentic.signature");
        assertEquals("org.nuxeo.agentic.signature", logger.getName());
        level = logger.getLevel();
        appender = new AbstractAppender("signature-capture", null, null, true, Property.EMPTY_ARRAY) {
            @Override
            public void append(LogEvent event) {
                StringBuilder line = new StringBuilder(event.getMessage().getFormattedMessage());
                if (event.getThrown() != null) {
                    StringWriter stack = new StringWriter();
                    event.getThrown().printStackTrace(new PrintWriter(stack));
                    line.append('\n').append(stack);
                }
                lines.add(line.toString());
            }
        };
        appender.start();
        logger.addAppender(appender, Level.ALL, null);
        logger.setLevel(Level.ALL);
        logger.setAdditive(false);
        context.updateLoggers();
    }

    @After
    public void tearDown() {
        LoggerContext context = (LoggerContext) LogManager.getContext(false);
        logger.removeAppender(appender.getName());
        logger.setLevel(level);
        logger.setAdditive(true);
        context.updateLoggers();
        appender.stop();
        stub.close();
    }

    @Test
    public void noLineHoldsACredentialASignatureAnAddressOrTheFile() {
        String caseId = Desk.newCase(repository, "onb-1", "agreement.pdf");
        String requestId = Desk.send(repository, ALICE, caseId, "agreement.pdf");
        String envelope = text(Desk.stored(repository, requestId), Signatures.ENVELOPE);

        // Refused: a second send, a forged callback, a stale one, a replay.
        Desk.refusedAs(repository, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf",
                Desk.ONE_SIGNER)));
        byte[] body = StandInStub.callbackBody("evt_1", "envelope.signed", envelope, null);
        long now = Clock.systemUTC().instant().getEpochSecond();
        Map<String, String> forged = StandInStub.signedHeaders("forged-secret-0123456789-0123456789-xyz", now, body);
        Desk.post(repository, forged, body);
        Desk.post(repository, StandInStub.signedHeaders(StandInStub.SECRET, now - 3600, body), body);
        // The service failing, then the callback taken, then replayed.
        stub.mode = StandInStub.Mode.NOT_SIGNED;
        Map<String, String> genuine = StandInStub.signedHeaders(StandInStub.SECRET, now, body);
        Desk.post(repository, genuine, body);
        stub.mode = StandInStub.Mode.NORMAL;
        assertEquals(CallbackEndpoint.RECEIVED, Desk.post(repository, genuine, body));
        Desk.post(repository, genuine, body);
        // A send the service refuses.
        String other = Desk.newCase(repository, "onb-2", "agreement.pdf");
        stub.mode = StandInStub.Mode.SEND_FAILS;
        Desk.refusedAs(repository, ALICE, s -> s.createDocument(Desk.requestModel(s, other, "agreement.pdf",
                Desk.ONE_SIGNER)));

        List<String> all = List.copyOf(lines);
        // The capture works: it holds the refusals.
        assertTrue(all.toString(), all.stream().anyMatch(l -> l.contains("refused: MISMATCH")));
        assertTrue(all.toString(), all.stream().anyMatch(l -> l.contains("outside the 300 s window")));
        assertTrue(all.toString(), all.stream().anyMatch(l -> l.contains("received already")));
        assertTrue(all.toString(), all.stream().anyMatch(l -> l.contains("NOT_SIGNED")));
        assertTrue(all.toString(), all.stream().anyMatch(l -> l.contains("did not take a file")));

        String signature = genuine.get("x-standin-signature");
        List<String> secrets = List.of(StandInStub.API_KEY, StandInStub.SECRET, signature,
                forged.get("x-standin-signature"), signature.substring(signature.indexOf("v1=") + 3),
                "rowan.vale@example.com", "%PDF", "Bearer");
        for (String line : all) {
            for (String secret : secrets) {
                assertTrue("a log line holds " + secret + ": " + line, !line.contains(secret));
            }
        }
    }
}
