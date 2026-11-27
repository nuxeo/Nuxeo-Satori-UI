/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.capture.Captures.text;
import static org.nuxeo.agentic.capture.Mailroom.CAROL;
import static org.nuxeo.agentic.capture.Mailroom.INBOX;

import java.util.Map;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.agentic.capture.ai.AiPackageProvider;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * The AI package's provider: not called while it is switched off, however else the server is set;
 * once on, it calls the AI package's two operations with the item's id and the profile's own
 * definitions only, and its answer goes through the same rule as any provider's. The operations
 * are the tests' stand-ins ({@link TestAiOperations}): no AI service is called.
 */
@RunWith(FeaturesRunner.class)
@Features(CaptureFeature.class)
public class AiProviderTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private String repository;

    @Before
    public void setUp() {
        repository = core.getRepositoryName();
        Mailroom.create(session);
    }

    private String mail(String name) {
        return Mailroom.mail(repository, CAROL, INBOX, name, Mailroom.letter("PC-24001", 3));
    }

    @Test
    public void theAiProviderIsNotCalledWhileItIsSwitchedOff() {
        // Nothing named.
        Mailroom.settings(null, null);
        assertEquals(Captures.NO_PROVIDER, text(Mailroom.stored(repository, mail("a")), Captures.REASON));
        // Named, and not switched on.
        Mailroom.settings("ai", null);
        assertEquals(Captures.NO_PROVIDER, text(Mailroom.stored(repository, mail("b")), Captures.REASON));
        // Named, and switched off in so many words, or with anything but true.
        for (String off : new String[] { "false", "yes", "1", "on", " " }) {
            Mailroom.settings("ai", off);
            assertEquals(off, Captures.NO_PROVIDER, text(Mailroom.stored(repository, mail("c" + off.trim())), Captures.REASON));
        }
        // Switched on, and the stand-in named instead.
        Mailroom.settings("standin", "true");
        assertEquals(Captures.FILED, text(Mailroom.stored(repository, mail("d")), Captures.STATUS));
        assertEquals(0, TestAiOperations.CALLS.get());
        assertTrue(TestAiOperations.GIVEN.isEmpty());

        // The positive control: named and switched on, it is called.
        Mailroom.settings("ai", "true");
        String id = Mailroom.mail(repository, CAROL, INBOX, "e", Mailroom.letter("PC-24002", 3));
        assertEquals(2, TestAiOperations.CALLS.get());
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals("ai", text(item, Captures.PROVIDER));
    }

    @Test
    public void anOperationThatIsNotTheAiPackagesIsNeverCalled() {
        Mailroom.settings("ai", "true");
        Mailroom.set(AiPackageProvider.CLASSIFY_PROPERTY, "Document.Delete");
        assertNull(Framework.getService(CaptureService.class).activeProviderId());
        String id = mail("a");
        assertEquals(Captures.NO_PROVIDER, text(Mailroom.stored(repository, id), Captures.REASON));
        assertTrue(Mailroom.inTransactionAs(repository, Mailroom.ADMINISTRATOR,
                s -> s.exists(new org.nuxeo.ecm.core.api.IdRef(id))));
        Mailroom.set(AiPackageProvider.CLASSIFY_PROPERTY, null);
        Mailroom.set(AiPackageProvider.EXTRACT_PROPERTY, "AI.CaptureExtract; Document.Delete");
        assertNull(Framework.getService(CaptureService.class).activeProviderId());
        assertEquals(0, TestAiOperations.CALLS.get());
    }

    @Test
    public void switchedOnItSendsTheItemsIdAndTheProfilesDefinitionsAndFiles() {
        Mailroom.settings("ai", "true");
        String claim = Mailroom.claimId(session, "pc-24001");
        String id = mail("letter");
        DocumentModel item = Mailroom.stored(repository, id);
        assertEquals(Captures.FILED, text(item, Captures.STATUS));
        assertEquals(Captures.AUTOMATIC, text(item, Captures.OUTCOME));
        assertEquals(0.93, (Double) item.getPropertyValue(Captures.CONFIDENCE), 0);
        assertEquals(claim, text(item, Captures.RECORD));
        assertEquals(1, Mailroom.attachments(repository, claim).size());

        assertEquals(2, TestAiOperations.GIVEN.size());
        Map<String, String> classify = TestAiOperations.GIVEN.get(0);
        assertEquals("AI.CaptureClassify", classify.get("operation"));
        assertEquals(id, classify.get("docId"));
        assertTrue(classify.get("classesJson"), classify.get("classesJson").contains("\"name\":\"claimLetter\""));
        assertTrue(classify.get("classesJson").contains("\"name\":\"invoice\""));
        Map<String, String> extract = TestAiOperations.GIVEN.get(1);
        assertEquals("AI.CaptureExtract", extract.get("operation"));
        assertEquals("claimLetter", extract.get("class"));
        assertTrue(extract.get("fieldsJson"), extract.get("fieldsJson").contains("\"name\":\"claimNumber\""));
        assertTrue(extract.get("fieldsJson").contains("\"format\":\"PC-[0-9]{5}\""));
        // Nothing of the letter itself goes with them: the AI package reads the item by its id.
        for (Map<String, String> given : TestAiOperations.GIVEN) {
            for (String value : given.values()) {
                assertFalse(value, value.contains(Mailroom.SENDER));
                assertFalse(value, value.contains("PC-24001"));
                assertFalse(value, value.contains("kitchen"));
            }
        }
    }

    @Test
    public void itsAnswerGoesThroughTheSameRule() {
        Mailroom.settings("ai", "true");
        TestAiOperations.classifyAnswer = "{\"class\":\"claimLetter\",\"confidence\":0.6}";
        assertEquals(Captures.LOW_CONFIDENCE, text(Mailroom.stored(repository, mail("low")), Captures.REASON));
        TestAiOperations.classifyAnswer = "{\"class\":\"ransomNote\",\"confidence\":0.99}";
        assertEquals(Captures.UNKNOWN_CLASS, text(Mailroom.stored(repository, mail("unknown")), Captures.REASON));
        TestAiOperations.classifyAnswer = "{\"class\":\"claimLetter\",\"confidence\":\"very\"}";
        assertEquals(Captures.LOW_CONFIDENCE, text(Mailroom.stored(repository, mail("word")), Captures.REASON));
        TestAiOperations.classifyAnswer = "{\"class\":\"claimLetter\",\"confidence\":0.99}";
        TestAiOperations.extractAnswer = "{\"fields\":[{\"name\":\"claimNumber\",\"value\":\"PC-24001' OR 1=1\",\"confidence\":0.99}]}";
        DocumentModel injected = Mailroom.stored(repository, mail("injected"));
        assertEquals(Captures.LOW_CONFIDENCE, text(injected, Captures.REASON));
        assertNull(text(injected, Captures.PROPOSED_RECORD));
    }

    @Test
    public void anAnswerItCannotReadOrAnOperationThatFailsOrIsAbsentLeavesTheItemWaiting() {
        Mailroom.settings("ai", "true");
        TestAiOperations.classifyAnswer = "not json";
        assertEquals(Captures.PROVIDER_FAILED, text(Mailroom.stored(repository, mail("garbled")), Captures.REASON));
        TestAiOperations.classifyAnswer = "[1, 2, 3]";
        assertEquals(Captures.PROVIDER_FAILED, text(Mailroom.stored(repository, mail("array")), Captures.REASON));
        TestAiOperations.classifyAnswer = "{\"class\":\"claimLetter\",\"pad\":\"" + "x".repeat(300 * 1024) + "\"}";
        assertEquals(Captures.PROVIDER_FAILED, text(Mailroom.stored(repository, mail("huge")), Captures.REASON));
        TestAiOperations.reset();
        TestAiOperations.fail = true;
        assertEquals(Captures.PROVIDER_FAILED, text(Mailroom.stored(repository, mail("failing")), Captures.REASON));
        // The AI package not installed: its operation is not there.
        TestAiOperations.fail = false;
        Mailroom.set(AiPackageProvider.CLASSIFY_PROPERTY, "AI.NotInstalled");
        assertEquals(Captures.PROVIDER_FAILED, text(Mailroom.stored(repository, mail("absent")), Captures.REASON));
        assertTrue(Mailroom.attachments(repository, Mailroom.claimId(session, "pc-24001")).isEmpty());
    }
}
