/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.assets.rights.AssetFacts.Window;
import org.nuxeo.agentic.assets.rights.Decision.Reason;

/**
 * Media rights in a policy: territories, release windows, a film's windows read for its localised
 * versions, and a delivery package, read through XMap as the runtime reads them; every mistake a
 * refusal; and the decision's order, a territory and a window after the rights end and the
 * channel.
 */
class TerritoriesPolicyTest {

    /** The media kit's own component, read where the kit keeps it. */
    static final Path KIT_COMPONENT = Path.of("..", "business-apps", "packages", "media-demo", "bundle", "OSGI-INF",
            "media-demo-rights.xml");

    static final LocalDate TODAY = LocalDate.of(2026, 11, 26);

    private static RightsPolicy parse(String policyXml) throws Exception {
        String component = """
                <component name="test">
                  <extension target="org.nuxeo.agentic.assets.rights" point="policies">
                %s
                  </extension>
                </component>
                """.formatted(policyXml);
        List<RightsPolicyDescriptor> policies = RightsPolicyTest.contributed(component.getBytes(StandardCharsets.UTF_8));
        assertEquals(1, policies.size());
        return RightsPolicy.of(policies.get(0));
    }

    private static final String RULES = """
              <rightsEnd xpath="dc:expired" />
              <channels xpath="fver:channels" />
              <original xpath="files:files/0/file" channel="SVOD" />
              <blob xpath="files:files/1/file" channel="SVOD" />
              <blob xpath="files:files/2/file" channel="Marketing" />
              <rendition name="thumbnail" preview="true" />
            """;

    private static RightsPolicy territorial(String extra) throws Exception {
        return parse("""
                <policy type="FilmVersion">
                %s
                  <territories xpath="fver:territories" />
                  <windows xpath="film:windows" document="fver:film" type="Film" />
                %s
                </policy>
                """.formatted(RULES, extra));
    }

    @Test
    void xmapReadsTerritoriesWindowsAndADeliveryPackage() throws Exception {
        RightsPolicy policy = territorial("""
                  <delivery>
                    <original />
                    <blob xpath="files:files/1/file" />
                    <blob xpath="files:files/2/file" />
                  </delivery>
                """);
        assertEquals(List.of(), policy.problems());
        assertFalse(policy.broken());
        assertTrue(policy.territorial());
        assertEquals("fver:territories", policy.territoriesXpath());
        assertEquals("film:windows", policy.windowsXpath());
        assertEquals("fver:film", policy.windowsDocumentXpath());
        assertEquals("Film", policy.windowsDocumentType());
        assertEquals(List.of(Use.ORIGINAL, Use.blob("files:files/1/file"), Use.blob("files:files/2/file")),
                policy.delivery());
        assertFalse(policy.deliveryBroken());
    }

    /** A policy with neither is as it was before: no territory is read, and none decides. */
    @Test
    void aPolicyWithNoTerritoriesIsAsBefore() throws Exception {
        RightsPolicy policy = parse("<policy type=\"FilmVersion\">" + RULES + "</policy>");
        assertFalse(policy.territorial());
        assertNull(policy.territoriesXpath());
        assertNull(policy.windowsXpath());
        assertNull(policy.delivery());
        AssetFacts facts = new AssetFacts(null, Set.of("SVOD"));
        assertEquals(Decision.allow(Reason.CLEARED, "SVOD"), AssetRights.decide(policy, facts, Use.ORIGINAL, TODAY));
    }

    /** One of territories and windows without the other decides nothing, so it refuses every use. */
    @Test
    void aTerritoryWithNoWindowOrAWindowWithNoTerritoryBreaksThePolicy() throws Exception {
        for (String half : List.of("<territories xpath=\"fver:territories\" />", "<windows xpath=\"film:windows\" />",
                "<windows document=\"fver:film\" />",
                "<territories xpath=\"fver:territories\" /><windows document=\"fver:film\" />",
                // Windows from another document, of no type said: any document could lend its own.
                "<territories xpath=\"fver:territories\" /><windows xpath=\"film:windows\" document=\"fver:film\" />")) {
            RightsPolicy policy = parse("<policy type=\"FilmVersion\">" + RULES + half + "</policy>");
            assertTrue(policy.broken(), half);
            assertFalse(policy.problems().isEmpty(), half);
            assertEquals(Decision.refuse(Reason.POLICY_ERROR), AssetRights.decide(policy,
                    new AssetFacts(null, Set.of("SVOD")), Use.ORIGINAL, TODAY), half);
        }
    }

    /** Every mistake in a delivery package refuses every delivery, and is said. */
    @Test
    void aMistakeInADeliveryPackageRefusesEveryDelivery() throws Exception {
        for (String mistake : List.of(
                // Empty.
                "<delivery />",
                // A use the policy does not list, or lists as a preview.
                "<delivery><blob xpath=\"files:files/3/file\" /></delivery>",
                "<delivery><view name=\"FullHD\" /></delivery>",
                "<view name=\"Medium\" preview=\"true\" /><delivery><view name=\"Medium\" /></delivery>",
                "<delivery><original /><blob xpath=\"files:files/1/file\" channel=\"SVOD\" /></delivery>",
                "<delivery><original preview=\"true\" /></delivery>",
                "<delivery><original xpath=\"files:files/1/file\" /></delivery>",
                // Not a file the document holds.
                "<delivery><original /><rendition name=\"thumbnail\" /></delivery>",
                "<delivery><original /><storyboard /></delivery>",
                // An entry naming nothing.
                "<delivery><original /><blob /></delivery>")) {
            RightsPolicy policy = territorial(mistake);
            assertTrue(policy.deliveryBroken(), mistake);
            assertFalse(policy.problems().isEmpty(), mistake);
            // The policy's other uses are as they were: a mistake in the package refuses deliveries.
            assertFalse(policy.broken(), mistake);
        }
        RightsPolicy noTerritories = parse("<policy type=\"FilmVersion\">" + RULES
                + "<delivery><original /></delivery></policy>");
        assertTrue(noTerritories.deliveryBroken());
        // A file listed twice is delivered once, and said. XMap reads one <original> only.
        RightsPolicy twice = territorial("<delivery><original /><blob xpath=\"files:files/1/file\" />"
                + "<blob xpath=\"files:files/1/file\" /></delivery>");
        assertFalse(twice.deliveryBroken());
        assertEquals(List.of(Use.ORIGINAL, Use.blob("files:files/1/file")), twice.delivery());
        assertEquals(1, twice.problems().size(), twice.problems()::toString);
    }

    // ----- The windows, as a document holds them -----

    private static Map<String, Serializable> window(String territory, String channel, String from, String until) {
        Map<String, Serializable> window = new HashMap<>();
        window.put("territory", territory);
        window.put("channel", channel);
        window.put("from", from == null ? null : Fakes.midnightUtc(from));
        window.put("until", until == null ? null : Fakes.midnightUtc(until));
        return window;
    }

    @Test
    void windowsAreReadEachWithATerritoryAChannelAndAFirstDay() {
        ArrayList<Map<String, Serializable>> list = new ArrayList<>(List.of(
                window(" FR ", "SVOD", "2026-11-01", "2027-04-30"), window("DE", "Marketing", "2026-12-01", null)));
        List<Window> windows = AssetFacts.windows(list);
        assertEquals(List.of(new Window("FR", "SVOD", LocalDate.of(2026, 11, 1), LocalDate.of(2027, 4, 30)),
                new Window("DE", "Marketing", LocalDate.of(2026, 12, 1), null)), windows);
        assertEquals(List.of(), AssetFacts.windows(null));
        assertTrue(windows.get(1).open(LocalDate.of(2099, 1, 1)), "a window with no last day stays open");
        assertFalse(windows.get(1).open(LocalDate.of(2026, 11, 30)));
    }

    /** A window the add-on cannot read whole is a mistake: the windows, and so the rights, refuse. */
    @Test
    void aWindowMissingAPartOrEndingBeforeItOpensCannotBeRead() {
        for (Map<String, Serializable> broken : List.of(window(null, "SVOD", "2026-11-01", null),
                window(" ", "SVOD", "2026-11-01", null), window("FR", null, "2026-11-01", null),
                window("FR", "SVOD", null, "2027-01-01"), window("FR", "SVOD", "2026-11-02", "2026-11-01"))) {
            ArrayList<Map<String, Serializable>> list = new ArrayList<>(List.of(broken));
            assertThrows(IllegalStateException.class, () -> AssetFacts.windows(list), broken::toString);
        }
        assertThrows(IllegalStateException.class, () -> AssetFacts.windows("FR SVOD"));
        ArrayList<Object> notComplex = new ArrayList<>(List.of("FR"));
        assertThrows(IllegalStateException.class, () -> AssetFacts.windows(notComplex));
    }

    // ----- The decision -----

    private static AssetFacts facts(String end, Set<String> channels, Set<String> territories, Window... windows) {
        return new AssetFacts(end == null ? null : LocalDate.parse(end), channels, territories, List.of(windows));
    }

    private static Window open(String territory, String channel) {
        return new Window(territory, channel, TODAY.minusDays(10), TODAY.plusDays(10));
    }

    private static Decision decide(RightsPolicy policy, AssetFacts facts, Use use, String territory) {
        return AssetRights.decide(policy, () -> facts, use, TODAY, territory);
    }

    @Test
    void aDeliveryIsDecidedByItsTerritoryAndThatTerritorysWindowForTheChannel() throws Exception {
        RightsPolicy policy = territorial("");
        AssetFacts french = facts("2027-12-31", Set.of("SVOD", "Marketing"), Set.of("FR", "BE"), open("FR", "SVOD"),
                open("DE", "SVOD"), new Window("BE", "SVOD", TODAY.plusDays(1), null));

        assertEquals(Decision.allow(Reason.CLEARED, "SVOD"), decide(policy, french, Use.ORIGINAL, "FR"));
        assertEquals(new Decision(false, Reason.TERRITORY_NOT_COVERED, "SVOD", null, "DE"),
                decide(policy, french, Use.ORIGINAL, "DE"));
        assertEquals(new Decision(false, Reason.OUTSIDE_WINDOW, "SVOD", null, "BE"),
                decide(policy, french, Use.ORIGINAL, "BE"));
        // FR has no Marketing window.
        assertEquals(new Decision(false, Reason.OUTSIDE_WINDOW, "Marketing", null, "FR"),
                decide(policy, french, Use.blob("files:files/2/file"), "FR"));
        // Territories and channels match as written: case counts.
        assertEquals(Reason.TERRITORY_NOT_COVERED, decide(policy, french, Use.ORIGINAL, "fr").reason());
    }

    /** The rights end and the channel come first, as for any asset; a preview needs no window. */
    @Test
    void theRightsEndAndTheChannelAreDecidedBeforeTheTerritoryAndTheWindow() throws Exception {
        RightsPolicy policy = territorial("");
        AssetFacts ended = facts("2026-11-25", Set.of("SVOD"), Set.of(), open("FR", "SVOD"));
        assertEquals(Reason.RIGHTS_ENDED, decide(policy, ended, Use.ORIGINAL, "DE").reason());
        AssetFacts noMarketing = facts(null, Set.of("SVOD"), Set.of());
        assertEquals(Reason.CHANNEL_NOT_COVERED, decide(policy, noMarketing, Use.blob("files:files/2/file"), "DE")
                                                                                                         .reason());
        assertEquals(Decision.allow(Reason.PREVIEW, null),
                decide(policy, facts(null, Set.of(), Set.of()), Use.rendition("thumbnail"), "DE"));
        assertEquals(Reason.NOT_CLEARED, decide(policy, noMarketing, Use.blob("files:files/9/file"), "FR").reason());
    }

    /** A download names no territory: a window for its channel open in any of the asset's territories serves it. */
    @Test
    void aDownloadIsServedWhileAWindowIsOpenInAnyTerritoryTheAssetHolds() throws Exception {
        RightsPolicy policy = territorial("");
        AssetFacts held = facts(null, Set.of("SVOD", "Marketing"), Set.of("DE", "CH"), open("CH", "SVOD"),
                open("FR", "Marketing"), new Window("DE", "Marketing", TODAY.plusDays(1), null));
        assertEquals(Decision.allow(Reason.CLEARED, "SVOD"), decide(policy, held, Use.ORIGINAL, null));
        // Marketing is open in FR, which the asset does not hold, and not yet in DE.
        assertEquals(new Decision(false, Reason.OUTSIDE_WINDOW, "Marketing", null, null),
                decide(policy, held, Use.blob("files:files/2/file"), null));
        assertEquals(new Decision(false, Reason.TERRITORY_NOT_COVERED, "SVOD", null, null),
                decide(policy, facts(null, Set.of("SVOD"), Set.of(), open("CH", "SVOD")), Use.ORIGINAL, null));
        // The four-argument decision, as the share links and the enricher call it, is a download's.
        assertEquals(Reason.OUTSIDE_WINDOW,
                AssetRights.decide(policy, held, Use.blob("files:files/2/file"), TODAY).reason());
    }

    /** The media kit's own component, read from where the kit keeps it: sound, with its package. */
    @Test
    void theMediaKitsOwnPolicyIsSound() throws Exception {
        assertTrue(Files.isRegularFile(KIT_COMPONENT), KIT_COMPONENT + " is where the kit keeps its policy");
        List<RightsPolicyDescriptor> policies = RightsPolicyTest.contributed(Files.readAllBytes(KIT_COMPONENT));
        assertEquals(1, policies.size());
        RightsPolicy kit = RightsPolicy.of(policies.get(0));
        assertEquals("FilmVersion", kit.type());
        assertEquals(List.of(), kit.problems());
        assertTrue(kit.territorial());
        assertEquals("fver:territories", kit.territoriesXpath());
        assertEquals("film:windows", kit.windowsXpath());
        assertEquals("fver:film", kit.windowsDocumentXpath());
        assertEquals("Film", kit.windowsDocumentType());
        assertEquals("files:files/0/file", kit.originalXpath());
        assertEquals(List.of(Use.ORIGINAL, Use.blob("files:files/1/file"), Use.blob("files:files/2/file")),
                kit.delivery());
        assertEquals("SVOD", kit.rule(Use.ORIGINAL).channel());
        assertEquals("SVOD", kit.rule(Use.blob("files:files/1/file")).channel());
        assertEquals("Marketing", kit.rule(Use.blob("files:files/2/file")).channel());
        assertTrue(kit.rule(Use.rendition("thumbnail")).preview());
    }
}
