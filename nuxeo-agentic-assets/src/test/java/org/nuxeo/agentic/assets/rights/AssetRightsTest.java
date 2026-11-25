package org.nuxeo.agentic.assets.rights;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.assets.rights.Decision.Reason;

/** The decision, use by use, as the kit's policy makes it. */
class AssetRightsTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 24);

    private static final RightsPolicy KIT = RightsPolicy.of(Fakes.kitPolicy());

    private static final Set<String> ALL = Set.of("E-commerce", "Wholesale", "Social", "Print");

    private static Decision decide(AssetFacts facts, Use use) {
        return AssetRights.decide(KIT, facts, use, TODAY);
    }

    @Test
    void aClearedAssetOnEveryChannelIsServedEachUseItsPolicyLists() {
        AssetFacts cleared = new AssetFacts(LocalDate.of(2027, 12, 31), ALL);

        assertEquals(Decision.allow(Reason.CLEARED, "Print"), decide(cleared, Use.ORIGINAL));
        assertEquals(Decision.allow(Reason.CLEARED, "Print"), decide(cleared, Use.view("OriginalJpeg")));
        assertEquals(Decision.allow(Reason.CLEARED, "Print"), decide(cleared, Use.rendition("OriginalJpeg")));
        assertEquals(Decision.allow(Reason.CLEARED, "E-commerce"), decide(cleared, Use.view("FullHD")));
        assertEquals(Decision.allow(Reason.PREVIEW, null), decide(cleared, Use.view("Medium")));
    }

    /** The demo's step 2: asset 503 holds E-commerce and Social, so nothing Print covers. */
    @Test
    void withNoPrintChannelThePrintUsesAreRefusedAndTheOthersServed() {
        AssetFacts noPrint = new AssetFacts(LocalDate.of(2026, 12, 14), Set.of("E-commerce", "Social"));

        Decision print = decide(noPrint, Use.view("OriginalJpeg"));
        assertFalse(print.allowed());
        assertEquals(Reason.CHANNEL_NOT_COVERED, print.reason());
        assertEquals("Print", print.channel());
        assertEquals(print, decide(noPrint, Use.rendition("OriginalJpeg")));
        assertEquals(print, decide(noPrint, Use.ORIGINAL));

        assertEquals(Decision.allow(Reason.CLEARED, "E-commerce"), decide(noPrint, Use.view("FullHD")));
        assertEquals(Decision.allow(Reason.PREVIEW, null), decide(noPrint, Use.view("Thumbnail")));
    }

    @Test
    void onceTheEndDayHasPassedEveryChannelUseIsRefusedAndPreviewsStillServed() {
        LocalDate ended = LocalDate.of(2026, 11, 14);
        AssetFacts facts = new AssetFacts(ended, ALL);

        for (Use use : new Use[] { Use.ORIGINAL, Use.view("OriginalJpeg"), Use.view("FullHD"),
                Use.rendition("FullHD") }) {
            Decision decision = decide(facts, use);
            assertFalse(decision.allowed(), use::toString);
            assertEquals(Reason.RIGHTS_ENDED, decision.reason(), use::toString);
            assertEquals(ended, decision.rightsEnd(), use::toString);
        }
        assertEquals(Decision.allow(Reason.PREVIEW, null), decide(facts, Use.view("Medium")));
        assertEquals(Decision.allow(Reason.PREVIEW, null), decide(facts, Use.rendition("thumbnail")));
    }

    /** The end day is the last day covered: refused from the day after it, not on it. */
    @Test
    void theEndDayItselfIsStillCoveredAndTheDayAfterIsNot() {
        assertTrue(decide(new AssetFacts(TODAY, ALL), Use.ORIGINAL).allowed());
        assertEquals(Reason.RIGHTS_ENDED, decide(new AssetFacts(TODAY.minusDays(1), ALL), Use.ORIGINAL).reason());
    }

    @Test
    void rightsWithNoEndDoNotEnd() {
        assertTrue(decide(new AssetFacts(null, ALL), Use.ORIGINAL).allowed());
    }

    /** The control's default: nothing clears a use the policy does not name. */
    @Test
    void aUseThePolicyDoesNotListIsRefusedEvenOnAClearedAsset() {
        AssetFacts cleared = new AssetFacts(null, ALL);

        for (Use use : new Use[] { Use.view("Huge"), Use.rendition("pdf"), Use.rendition("zipExport"),
                Use.rendition("xmlExport"), Use.blob("files:files/0/file"), Use.unknown(null),
                Use.unknown("picture:views/9/content") }) {
            assertEquals(Decision.refuse(Reason.NOT_CLEARED), decide(cleared, use), use::toString);
        }
    }

    @Test
    void anAssetWithNoChannelsIsRefusedEveryChannelUse() {
        AssetFacts none = new AssetFacts(null, Set.of());

        assertEquals(Reason.CHANNEL_NOT_COVERED, decide(none, Use.view("FullHD")).reason());
        assertEquals(Reason.CHANNEL_NOT_COVERED, decide(none, Use.ORIGINAL).reason());
        assertTrue(decide(none, Use.view("Small")).allowed());
    }

    /** Channels match as written: a near miss is a refusal, never a guess. */
    @Test
    void aChannelMatchesExactly() {
        assertFalse(decide(new AssetFacts(null, Set.of("print", "PRINT", "Print ")), Use.ORIGINAL).allowed());
    }

    @Test
    void aBrokenPolicyRefusesEveryUseItsPreviewsIncluded() {
        RightsPolicyDescriptor descriptor = Fakes.kitPolicy();
        descriptor.channelsXpath = null;
        RightsPolicy broken = RightsPolicy.of(descriptor);

        AssetFacts cleared = new AssetFacts(null, ALL);
        assertEquals(Decision.refuse(Reason.POLICY_ERROR), AssetRights.decide(broken, cleared, Use.view("Medium"), TODAY));
        assertEquals(Decision.refuse(Reason.POLICY_ERROR), AssetRights.decide(broken, cleared, Use.ORIGINAL, TODAY));
    }

    @Test
    void aDecisionCannotSayAllowedWithARefusingReason() {
        assertThrows(IllegalArgumentException.class, () -> new Decision(true, Reason.RIGHTS_ENDED, null, null));
        assertThrows(IllegalArgumentException.class, () -> new Decision(false, Reason.CLEARED, null, null));
        assertNull(Decision.refuse(Reason.NOT_CLEARED).channel());
    }
}
