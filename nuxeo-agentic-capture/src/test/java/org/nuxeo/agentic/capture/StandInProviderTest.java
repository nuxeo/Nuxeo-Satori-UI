/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.junit.Test;
import org.nuxeo.agentic.capture.CaptureProvider.Classification;
import org.nuxeo.agentic.capture.CaptureProvider.ExtractedField;
import org.nuxeo.agentic.capture.CaptureProvider.Submission;
import org.nuxeo.agentic.capture.standin.StandInProvider;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;

/** The stand-in, alone: the same text, the same answer, from a text file and from a PDF's own text. */
public class StandInProviderTest {

    static final Profile PROFILE = Profile.of(ProfileTestProfiles.withLetterAndInvoice());

    private static Submission of(byte[] content) {
        Blob blob = Blobs.createBlob(content);
        return new Submission(null, null, blob, PROFILE);
    }

    private static Submission of(String text) {
        return of(text.getBytes(StandardCharsets.UTF_8));
    }

    private static Map<String, ExtractedField> extract(Submission submission) throws CaptureProviderException {
        return new StandInProvider().extract(submission, PROFILE.captureClass("claimLetter").orElseThrow())
                                    .fields()
                                    .stream()
                                    .collect(Collectors.toMap(ExtractedField::name, f -> f));
    }

    @Test
    public void itClassifiesByTheShareOfAClassesKeywords() throws Exception {
        StandInProvider standIn = new StandInProvider();
        assertEquals(new Classification("claimLetter", 1.0),
                standIn.classify(of("CLAIM NUMBER: PC-24001\nPolicy number: X\nDate of loss: 2026-01-01")));
        assertEquals(new Classification("claimLetter", 0.67), standIn.classify(of("Claim number: PC-24001\nPolicy number: X")));
        assertEquals(new Classification("claimLetter", 0.33), standIn.classify(of("Claim number: PC-24001")));
        assertEquals(new Classification("invoice", 1.0), standIn.classify(of("Invoice number: 1. Amount due: 3")));
        Classification none = standIn.classify(of("A postcard."));
        assertNull(none.className());
        assertEquals(0, none.confidence(), 0);
    }

    @Test
    public void itReadsEachFieldAfterItsLabel() throws Exception {
        Map<String, ExtractedField> fields = extract(of("From: Rowan Vale\nClaim number:PC-24001 \nDate of loss: 2 October\n"));
        assertEquals("PC-24001", fields.get("claimNumber").value());
        assertEquals(0.97, fields.get("claimNumber").confidence(), 0);
        assertEquals("Rowan Vale", fields.get("sender").value());
        // Not of its form: read, and not trusted.
        assertEquals("2 October", fields.get("lossDate").value());
        assertEquals(0.4, fields.get("lossDate").confidence(), 0);
        assertEquals(null, fields.get("policyNumber"));
        // A label inside another word is not the label.
        assertTrue(extract(of("Subclaim number: PC-11111")).isEmpty());
    }

    @Test
    public void itReadsAPdfsOwnText() throws Exception {
        String pdf = "%PDF-1.4\n4 0 obj << /Length 80 >> stream\nBT /F1 11 Tf 72 700 Td (Claim number: PC-24003) Tj "
                + "0 -14 Td (Policy number: POL-PC-1002) Tj (Date of loss: 2026-10-02) Tj ET\nendstream\nendobj\n%%EOF\n";
        Submission letter = of(pdf.getBytes(StandardCharsets.ISO_8859_1));
        assertEquals(new Classification("claimLetter", 1.0), new StandInProvider().classify(letter));
        Map<String, ExtractedField> fields = extract(letter);
        assertEquals("PC-24003", fields.get("claimNumber").value());
        assertEquals("POL-PC-1002", fields.get("policyNumber").value());
        assertEquals("2026-10-02", fields.get("lossDate").value());
    }

    @Test
    public void theSameFileGivesTheSameAnswerEveryTime() throws Exception {
        Submission letter = of("Claim number: PC-24001\nPolicy number: POL-1\n");
        List<Object> answers = List.of(new StandInProvider().classify(letter), extract(letter));
        for (int i = 0; i < 5; i++) {
            assertEquals(answers, List.of(new StandInProvider().classify(letter), extract(letter)));
        }
    }
}
