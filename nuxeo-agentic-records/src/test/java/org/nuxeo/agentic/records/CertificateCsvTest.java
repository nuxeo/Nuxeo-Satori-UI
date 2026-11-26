package org.nuxeo.agentic.records;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;

import org.junit.Test;

/** The certificate's CSV, as a records specialist's spreadsheet reads it. */
public class CertificateCsvTest {

    private static final Instant AT = Instant.parse("2026-11-26T09:30:00Z");

    private static String csv(DueRecords.Due... records) {
        byte[] bytes = CertificateCsv.write(7, "alice", Dispositions.calendar(AT),
                List.of(new CertificateCsv.Approval("bob", Dispositions.calendar(AT.plusSeconds(60))),
                        new CertificateCsv.Approval("carol", Dispositions.calendar(AT.plusSeconds(120)))),
                Dispositions.calendar(AT.plusSeconds(121)), List.of(records));
        assertArrayEquals(CertificateCsv.BOM, Arrays.copyOf(bytes, 3));
        return new String(bytes, 3, bytes.length - 3, StandardCharsets.UTF_8);
    }

    private static DueRecords.Due record(String title) {
        return new DueRecords.Due("1b2c", "/records/" + title, title, "File", "9f8e", "Claims, seven years",
                Dispositions.calendar(AT.minusSeconds(86_400)));
    }

    @Test
    public void aRowPerRecordEachWholeOnItsOwn() {
        String[] lines = csv(record("Claim 1001"), record("Claim 1002")).split("\r\n", -1);
        assertEquals(4, lines.length);
        assertEquals("", lines[3]);
        assertEquals(String.join(",", CertificateCsv.HEADER.stream().map(field -> "\"" + field + "\"").toList()),
                lines[0]);
        assertEquals("\"7\",\"alice\",\"2026-11-26T09:30:00Z\",\"bob\",\"2026-11-26T09:31:00Z\",\"carol\","
                + "\"2026-11-26T09:32:00Z\",\"2026-11-26T09:32:01Z\",\"deleted\",\"1b2c\",\"/records/Claim 1001\","
                + "\"Claim 1001\",\"File\",\"9f8e\",\"Claims, seven years\",\"2026-11-25T09:30:00Z\"", lines[1]);
    }

    @Test
    public void aQuoteIsDoubledAndALineBreakStaysInItsField() {
        String line = csv(record("The \"main\"\nclaim")).split("\r\n")[1];
        assertEquals(true, line.contains("\"The \"\"main\"\"\nclaim\""));
    }

    @Test
    public void noTitleIsReadAsAFormula() {
        for (String formula : List.of("=HYPERLINK(\"http://example.invalid\")", "+1", "-1", "@SUM(A1)", "\tx", "\rx")) {
            assertEquals("'" + formula, CertificateCsv.field(formula));
        }
        assertEquals("Claim 1001", CertificateCsv.field("Claim 1001"));
        assertEquals("", CertificateCsv.field(null));
    }

    @Test
    public void itsDigestIsTheSha256OfItsBytes() {
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", CertificateCsv.sha256(new byte[0]));
    }
}
