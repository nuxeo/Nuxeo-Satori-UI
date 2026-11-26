/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.junit.Test;

/**
 * A series as its contribution describes it, the numbers it writes, and the revisions.
 */
public class NumberSeriesTest {

    private static NumberSeries.Result read(String id, String digits, String revisions) {
        return NumberSeries.of(new NumberSeriesDescriptor(id, digits, revisions, true));
    }

    @Test
    public void aNumberIsTheIdAHyphenAndTheValueToItsDigits() {
        NumberSeries dwg = read("DWG", "5", null).series();
        assertEquals("DWG-00001", dwg.format(1));
        assertEquals("DWG-00042", dwg.format(42));
        assertEquals("DWG-99999", dwg.format(99_999));
        // Wider than its digits, whole rather than cut: never the same as another value's.
        assertEquals("DWG-100000", dwg.format(100_000));
        assertThrows(IllegalArgumentException.class, () -> dwg.format(0));
        assertEquals("org.nuxeo.agentic.documents.series.DWG", dwg.sequenceKey());
    }

    /** Two series never write the same number, ids with hyphens and digits included. */
    @Test
    public void twoSeriesNeverWriteTheSameNumber() {
        List<NumberSeries> series = List.of(read("A", "1", null).series(), read("A-1", "1", null).series(),
                read("A-0", "2", null).series(), read("A1", "1", null).series());
        Set<String> numbers = new HashSet<>();
        int written = 0;
        for (NumberSeries each : series) {
            for (long value = 1; value <= 120; value++) {
                numbers.add(each.format(value));
                written++;
            }
        }
        assertEquals(written, numbers.size());
    }

    @Test
    public void aSeriesWithAMistakeIsLeftOut() {
        for (String id : new String[] { null, "", "dwg", "DWG-", "-DWG", "DW G", "DWG--1", "DWG_1", "A".repeat(33),
                "DWG\nX" }) {
            NumberSeries.Result result = read(id, null, null);
            assertNull(String.valueOf(id), result.series());
            assertFalse(result.problems().isEmpty());
        }
        // An attribute's surrounding spaces are not part of it.
        assertEquals("DWG", read(" DWG\n", null, null).series().id());
        for (String digits : new String[] { "0", "13", "-1", "five" }) {
            assertNull(digits, read("DWG", digits, null).series());
        }
        assertNull(read("DWG", null, "roman").series());
        assertNotEquals(null, read("A".repeat(32), "12", "numbers").series());
    }

    @Test
    public void unsetDigitsAreFiveAndUnsetRevisionsLetters() {
        NumberSeries series = read("DWG", null, null).series();
        assertEquals(5, series.digits());
        assertEquals(RevisionScheme.LETTERS, series.revisions());
        assertEquals(RevisionScheme.NUMBERS, read("SPEC", " 3 ", " Numbers ").series().revisions());
    }

    @Test
    public void lettersRunAToZThenAA() {
        RevisionScheme letters = RevisionScheme.LETTERS;
        assertEquals("A", letters.first());
        assertEquals("B", letters.next("A"));
        assertEquals("Z", letters.next("Y"));
        assertEquals("AA", letters.next("Z"));
        assertEquals("AB", letters.next("AA"));
        assertEquals("BA", letters.next("AZ"));
        assertEquals("AAA", letters.next("ZZ"));
        // What the scheme does not write has no next: superseding it is refused, not guessed.
        for (String odd : new String[] { null, "", "a", "1", "A1", " A", "ZZZZZZ" }) {
            assertNull(odd, letters.next(odd));
        }
    }

    @Test
    public void numbersRunFromOne() {
        RevisionScheme numbers = RevisionScheme.NUMBERS;
        assertEquals("1", numbers.first());
        assertEquals("2", numbers.next("1"));
        assertEquals("10", numbers.next("9"));
        for (String odd : new String[] { null, "", "0", "01", "A", "-1", "999999999" }) {
            assertNull(odd, numbers.next(odd));
        }
        assertTrue(numbers.writes("999999999"));
    }

    @Test
    public void aDocumentIdIsLettersDigitsAndHyphens() {
        assertTrue(ControlledDocuments.isDocumentId("4f0c1e1a-0000-4000-8000-000000000000"));
        assertTrue(ControlledDocuments.isDocumentId("1234"));
        for (String odd : new String[] { null, "", "../x", "a b", "a'b", "x".repeat(65), "id\n" }) {
            assertFalse(String.valueOf(odd), ControlledDocuments.isDocumentId(odd));
        }
    }
}
