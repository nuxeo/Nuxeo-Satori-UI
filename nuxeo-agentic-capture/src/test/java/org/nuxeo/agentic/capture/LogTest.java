/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.capture.Mailroom.ALICE;
import static org.nuxeo.agentic.capture.Mailroom.BOB;
import static org.nuxeo.agentic.capture.Mailroom.CAROL;
import static org.nuxeo.agentic.capture.Mailroom.INBOX;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

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
import org.nuxeo.agentic.capture.ai.AiPackageProvider;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * No secret and no content in a log: every line the add-on logs, at every level, with its stack,
 * through filings, queuings, refusals, a provider's failure whose message quotes the letter, and
 * the AI provider switched on, holds neither a field's value, nor the letter's text, nor a setting's
 * value. The capture is shown to work by the lines it must hold.
 */
@RunWith(FeaturesRunner.class)
@Features(CaptureFeature.class)
public class LogTest {

    /** A made-up operation name, set as a setting, which no line may repeat. */
    private static final String SETTING_VALUE = "AI.SettingNoLineRepeats";

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private String repository;

    private final List<String> lines = Collections.synchronizedList(new ArrayList<>());

    private LoggerConfig logger;

    private Level level;

    private AbstractAppender appender;

    @Before
    public void setUp() {
        repository = core.getRepositoryName();
        Mailroom.create(session);
        LoggerContext context = (LoggerContext) LogManager.getContext(false);
        logger = context.getConfiguration().getLoggerConfig("org.nuxeo.agentic.capture");
        assertEquals("org.nuxeo.agentic.capture", logger.getName());
        level = logger.getLevel();
        appender = new AbstractAppender("capture-log", null, null, true, Property.EMPTY_ARRAY) {
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
    }

    @Test
    public void noLineHoldsAFieldsValueTheLettersTextOrASetting() {
        Mailroom.settings("standin", null);
        Mailroom.mail(repository, CAROL, INBOX, "filed", Mailroom.letter("PC-24001", 3));
        String waiting = Mailroom.mail(repository, CAROL, INBOX, "waiting", Mailroom.letter("PC-24002", 2));
        Mailroom.mail(repository, CAROL, INBOX, "unmatched", Mailroom.letter("PC-29999", 3));
        // Refused: a correction with a value too long, a confirm by someone who may not write the claim.
        Mailroom.refusedDecision(repository, BOB, waiting, item -> Mailroom.field(item, "sender",
                Mailroom.SENDER + " ".repeat(Captures.MAX_VALUE)));
        Mailroom.refusedDecision(repository, BOB, waiting,
                item -> Mailroom.field(item, Mailroom.SENDER + " " + Mailroom.SENDER_ADDRESS, "x"));
        Mailroom.refusedDecision(repository, BOB, waiting,
                item -> item.setPropertyValue(Captures.DECISION, Captures.CONFIRM));
        Mailroom.decide(repository, ALICE, waiting, item -> {
            Mailroom.field(item, "sender", Mailroom.SENDER + ", " + Mailroom.SENDER_ADDRESS);
            item.setPropertyValue(Captures.DECISION, Captures.CONFIRM);
        });
        // The AI provider on, its operation failing with the letter in its message, then answering.
        Mailroom.settings("ai", "true");
        Mailroom.set(AiPackageProvider.EXTRACT_PROPERTY, "AI.CaptureExtract");
        TestAiOperations.fail = true;
        Mailroom.mail(repository, CAROL, INBOX, "failing", Mailroom.letter("PC-24001", 3));
        TestAiOperations.fail = false;
        Mailroom.mail(repository, CAROL, INBOX, "ai", Mailroom.letter("PC-24001", 3));
        Mailroom.set(AiPackageProvider.CLASSIFY_PROPERTY, SETTING_VALUE);
        Mailroom.mail(repository, CAROL, INBOX, "absent", Mailroom.letter("PC-24001", 3));
        // The scripted provider throwing with the letter in its message.
        Mailroom.settings("scripted", null);
        ScriptedProvider.crash = new IllegalStateException("could not read " + Mailroom.SENDER_PHONE);
        Mailroom.mail(repository, CAROL, INBOX, "crashed", Mailroom.letter("PC-24001", 3));

        List<String> captured = List.copyOf(lines);
        // The capture works: it holds the lines it must.
        assertTrue(captured.toString(), captured.stream().anyMatch(l -> l.contains("waits for a person: lowConfidence")));
        assertTrue(captured.toString(), captured.stream().anyMatch(l -> l.contains("refused")));
        assertTrue(captured.toString(), captured.stream().anyMatch(l -> l.contains("FAILED")));
        assertTrue(captured.toString(), captured.stream().anyMatch(l -> l.contains("IllegalStateException")));
        for (String line : captured) {
            for (String secret : new String[] { Mailroom.SENDER, "Rowan", Mailroom.SENDER_ADDRESS, "Ashgrove",
                    Mailroom.SENDER_PHONE, "PC-24001", "PC-24002", "PC-29999", "POL-PC-1001", "kitchen",
                    "Northgate", SETTING_VALUE }) {
                assertFalse(secret + " in: " + line, line.contains(secret));
            }
        }
    }
}
