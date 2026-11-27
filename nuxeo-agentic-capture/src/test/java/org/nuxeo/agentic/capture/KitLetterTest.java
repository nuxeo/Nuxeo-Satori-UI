/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import javax.xml.parsers.DocumentBuilderFactory;

import org.junit.Test;
import org.nuxeo.agentic.capture.CaptureProvider.Classification;
import org.nuxeo.agentic.capture.CaptureProvider.ExtractedField;
import org.nuxeo.agentic.capture.CaptureProvider.Extraction;
import org.nuxeo.agentic.capture.CaptureProvider.Submission;
import org.nuxeo.agentic.capture.ConfidenceRule.Verdict;
import org.nuxeo.agentic.capture.standin.StandInProvider;
import org.nuxeo.common.xmap.XMap;
import org.nuxeo.ecm.core.api.Blobs;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * Demo step 3 with the stand-in, as far as it goes without a server: the P&C claims kit's own
 * profile, read from its component as the runtime reads it (XMap), checked as the add-on checks
 * it, and its two fictional letters, read by the stand-in and judged by the confidence rule. The
 * letter about PC-24003 may be filed by itself; the unclear one waits for a person, its claim
 * number not of its form. Matching and filing are the runtime's, held by {@link CaptureTest}.
 */
public class KitLetterTest {

    static final Path KIT = Path.of("..", "business-apps", "packages", "pc-claims-demo");

    static Profile kitProfile() throws Exception {
        var factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        var document = factory.newDocumentBuilder()
                              .parse(KIT.resolve("bundle/OSGI-INF/pc-claims-demo-capture.xml").toFile());
        NodeList profiles = document.getElementsByTagName("profile");
        assertEquals(1, profiles.getLength());
        XMap xmap = new XMap();
        xmap.register(ProfileDescriptor.class);
        return Profile.of((ProfileDescriptor) xmap.load((Element) profiles.item(0)));
    }

    private static Submission letter(Profile profile, String name) throws Exception {
        byte[] bytes = Files.readAllBytes(KIT.resolve("demo").resolve(name));
        return new Submission(null, null, Blobs.createBlob(bytes, "application/pdf"), profile);
    }

    private static Verdict judge(Profile profile, Submission letter) throws Exception {
        StandInProvider standIn = new StandInProvider();
        Classification classification = standIn.classify(letter);
        Extraction extraction = profile.captureClass(classification.className()).isPresent()
                ? standIn.extract(letter, profile.captureClass(classification.className()).get())
                : null;
        return ConfidenceRule.judge(profile, classification, extraction);
    }

    @Test
    public void theKitsProfileIsOneTheAddOnRegisters() throws Exception {
        Profile profile = kitProfile();
        assertEquals("pc-claims-mail", profile.id());
        assertEquals("PropertyClaimInbox", profile.inboxType());
        assertEquals("PropertyClaimMail", profile.itemType());
        assertEquals("PropertyClaim", profile.recordType());
        assertEquals(0.85, profile.threshold(), 0);
        assertEquals(List.of("pclaim:number"),
                profile.captureClass("claimLetter").orElseThrow().keys().stream().map(f -> f.match()).toList());
    }

    @Test
    public void theLetterAboutPc24003MayBeFiledByItself() throws Exception {
        Profile profile = kitProfile();
        Verdict verdict = judge(profile, letter(profile, "claim-letter-pc-24003.pdf"));
        assertNull(verdict.reason());
        assertEquals("claimLetter", verdict.captureClass().name());
        assertEquals(1.0, verdict.classConfidence(), 0);
        assertEquals(Map.of("claimNumber", "PC-24003"), verdict.keys());
        Map<String, String> fields = verdict.fields()
                                            .stream()
                                            .collect(Collectors.toMap(ExtractedField::name, ExtractedField::value));
        assertEquals("POL-PC-1002", fields.get("policyNumber"));
        assertEquals("Calder and Finch Bakery", fields.get("sender"));
        assertEquals("the night of the windstorm", fields.get("lossDate"));
    }

    @Test
    public void theUnclearLetterWaitsForAPerson() throws Exception {
        Profile profile = kitProfile();
        Verdict verdict = judge(profile, letter(profile, "claim-letter-unclear.pdf"));
        assertEquals(Captures.LOW_CONFIDENCE, verdict.reason());
        assertEquals(0.33, verdict.classConfidence(), 0);
        assertEquals(0, verdict.confidence(), 0);
        // Its number read with a letter O: kept as read, and no key, so no claim is looked for.
        assertTrue(verdict.keys().isEmpty());
        List<String> read = new ArrayList<>();
        verdict.fields().forEach(f -> read.add(f.name() + "=" + f.value()));
        assertEquals(List.of("claimNumber=PC-24O08", "sender=Ottoline Brandt"), read);
    }
}
