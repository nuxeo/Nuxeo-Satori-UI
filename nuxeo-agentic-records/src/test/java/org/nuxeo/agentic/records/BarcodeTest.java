package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.test.runner.RuntimeFeature;

/** A barcode's form and its check digit, as a scanner reads one and a person types one. */
@RunWith(FeaturesRunner.class)
@Features(RuntimeFeature.class)
public class BarcodeTest {

    @After
    public void resetPrefix() {
        Framework.getProperties().remove(Barcodes.PREFIX_PROPERTY);
    }

    @Test
    public void aBarcodeIsItsPrefixItsPaddedValueAndItsCheckDigit() {
        // 0 0 0 0 0 0 4 2: the 2 doubled is 4, and the 4 kept; 8, so the check digit is 2.
        assertEquals("PR000000422", Barcodes.format("PR", 42));
        assertEquals("PR000000018", Barcodes.format("PR", 1));
        // Wider than eight digits, it is written whole, never cut.
        assertEquals("PR1234567897", Barcodes.format("PR", 123456789));
        assertTrue(Barcodes.valid("PR000000422"));
        assertTrue(Barcodes.valid("PR1234567897"));
    }

    @Test
    public void oneDigitMistypedOrTwoNeighboursSwappedIsNoBarcode() {
        assertFalse(Barcodes.valid("PR000000432"));
        assertFalse(Barcodes.valid("PR000000242"));
        assertFalse(Barcodes.valid("PR000000423"));
        assertFalse(Barcodes.valid("PR00000422"));
        assertFalse(Barcodes.valid("pr000000422"));
        assertFalse(Barcodes.valid("P1R000000422"));
        assertFalse(Barcodes.valid("PR0000004222"));
        assertFalse(Barcodes.valid(""));
        assertFalse(Barcodes.valid(null));
        for (long value = 1; value < 2000; value++) {
            String barcode = Barcodes.format("PR", value);
            assertTrue(barcode, Barcodes.valid(barcode));
            for (int position = 2; position < barcode.length(); position++) {
                char digit = barcode.charAt(position);
                String typo = barcode.substring(0, position) + (char) ('0' + (digit - '0' + 1) % 10)
                        + barcode.substring(position + 1);
                assertFalse(typo, Barcodes.valid(typo));
            }
        }
    }

    @Test
    public void typedOrScannedItIsReadAsIssued() {
        assertEquals("PR000000422", Barcodes.normal(" pr-0000 0042 2\n"));
        assertTrue(Barcodes.looksLike(Barcodes.normal("pr000000422")));
        assertFalse(Barcodes.looksLike(Barcodes.normal("Box 7")));
    }

    @Test
    public void thePrefixIsTheDeploymentsWhenItIsOneToFourCapitals() {
        assertEquals(Barcodes.DEFAULT_PREFIX, Barcodes.prefix());
        Framework.getProperties().setProperty(Barcodes.PREFIX_PROPERTY, "ACME");
        assertEquals("ACME", Barcodes.prefix());
        for (String wrong : new String[] { "acme", "TOOLONG", "A1", "", " " }) {
            Framework.getProperties().setProperty(Barcodes.PREFIX_PROPERTY, wrong);
            assertEquals(wrong, Barcodes.DEFAULT_PREFIX, Barcodes.prefix());
        }
    }
}
