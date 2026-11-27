/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.assets.rights.Decision.Reason;
import org.nuxeo.agentic.assets.rights.Watermark.Occasion;
import org.nuxeo.agentic.assets.rights.Watermark.Placement;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.impl.UserPrincipal;

/**
 * A rights policy's watermark, since 0.5.0, read through XMap as the runtime reads it: its occasions,
 * the uses each marks, who is exempt, its text and its placement; each mistake breaking the policy,
 * so that nothing it would mark is served unmarked; and a download refused unmarked,
 * {@code watermark-required}, for anyone it marks.
 */
class WatermarkPolicyTest {

    static final LocalDate TODAY = LocalDate.of(2026, 11, 27);

    private static final NuxeoPrincipal OUTSIDER = new UserPrincipal("olga", List.of("members"), false, false);

    private static final NuxeoPrincipal STAFF = new UserPrincipal("sam", List.of("members", "brand-team"), false,
            false);

    private static final NuxeoPrincipal ADMINISTRATOR = new UserPrincipal("Administrator", List.of("administrators"),
            false, true);

    private static RightsPolicy parse(String watermark) throws Exception {
        String component = """
                <component name="test">
                  <extension target="org.nuxeo.agentic.assets.rights" point="policies">
                    <policy type="AcmeAsset">
                      <rightsEnd xpath="dc:expired" />
                      <channels xpath="acmeasset:channels" />
                      <original channel="Print" />
                      <view name="Medium" preview="true" />
                      <view name="Small" preview="true" />
                      <view name="FullHD" channel="E-commerce" />
                      <rendition name="thumbnail" preview="true" />
                %s
                    </policy>
                  </extension>
                </component>
                """.formatted(watermark);
        List<RightsPolicyDescriptor> policies = RightsPolicyTest.contributed(component.getBytes(StandardCharsets.UTF_8));
        assertEquals(1, policies.size());
        return RightsPolicy.of(policies.get(0));
    }

    private static final AssetFacts FACTS = new AssetFacts(TODAY.plusDays(30), Set.of("Print", "E-commerce"));

    private static Decision download(RightsPolicy policy, Use use, NuxeoPrincipal person) {
        return AssetRights.watermarked(policy, use, AssetRights.decide(policy, FACTS, use, TODAY), person);
    }

    @Test
    void xmapReadsTheOccasionsTheUsesTheExemptGroupsTheTextAndThePlacement() throws Exception {
        RightsPolicy policy = parse("""
                <watermark text="ACME · {recipient} · {day}" placement="bottom-right">
                  <previews><view name="Medium" /></previews>
                  <downloads />
                  <except group="brand-team" />
                </watermark>
                """);
        assertFalse(policy.broken(), policy.problems()::toString);
        Watermark watermark = policy.watermark();
        assertNotNull(watermark);
        assertEquals(Placement.BOTTOM_RIGHT, watermark.placement());
        assertEquals(Set.of("brand-team"), watermark.except());
        assertTrue(watermark.marks(Occasion.PREVIEW, Use.view("Medium")));
        assertFalse(watermark.marks(Occasion.PREVIEW, Use.view("Small")), "a preview it does not name");
        assertTrue(watermark.marks(Occasion.DOWNLOAD, Use.view("FullHD")), "downloads naming none: every one");
        assertTrue(watermark.marks(Occasion.DOWNLOAD, Use.ORIGINAL));
        assertFalse(watermark.marks(Occasion.DELIVERY), "no deliveries");
    }

    @Test
    void aMarkedUseIsRefusedUnmarkedToAnyoneOutsideTheExemptGroupsAndAnAdministratorIsNotExempt() throws Exception {
        RightsPolicy policy = parse("""
                <watermark text="ACME · {recipient}">
                  <previews><view name="Medium" /></previews>
                  <downloads><view name="FullHD" /></downloads>
                  <except group="brand-team" />
                </watermark>
                """);
        for (NuxeoPrincipal person : new NuxeoPrincipal[] { OUTSIDER, ADMINISTRATOR, null }) {
            Decision medium = download(policy, Use.view("Medium"), person);
            assertFalse(medium.allowed());
            assertEquals(Reason.WATERMARK_REQUIRED, medium.reason());
            Decision fullHd = download(policy, Use.view("FullHD"), person);
            assertEquals(Reason.WATERMARK_REQUIRED, fullHd.reason());
            assertEquals("E-commerce", fullHd.channel(), "its channel kept");
            assertEquals(Reason.PREVIEW, download(policy, Use.view("Small"), person).reason(), "not marked");
            assertEquals(Reason.CLEARED, download(policy, Use.ORIGINAL, person).reason(), "not marked");
        }
        assertEquals(Reason.PREVIEW, download(policy, Use.view("Medium"), STAFF).reason());
        assertEquals(Reason.CLEARED, download(policy, Use.view("FullHD"), STAFF).reason());
    }

    @Test
    void aRefusalStaysTheRightsOwn() throws Exception {
        RightsPolicy policy = parse("""
                <watermark text="ACME · {recipient}"><downloads /></watermark>
                """);
        AssetFacts ended = new AssetFacts(TODAY.minusDays(1), Set.of("Print", "E-commerce"));
        Decision decided = AssetRights.watermarked(policy, Use.ORIGINAL,
                AssetRights.decide(policy, ended, Use.ORIGINAL, TODAY), OUTSIDER);
        assertEquals(Reason.RIGHTS_ENDED, decided.reason());
        assertEquals(Reason.NOT_CLEARED, download(policy, Use.view("Unlisted"), OUTSIDER).reason());
    }

    @Test
    void theTextNamesTheRecipientTheUserTheDayAndTheTerritoryEachCleanedAndCut() throws Exception {
        Watermark watermark = parse("""
                <watermark text="FOR {recipient} BY {user} · {territory} · {day}"><downloads /></watermark>
                """).watermark();
        assertEquals("FOR Acme Distribution France BY dana · FR · 2026-11-27",
                watermark.text("Acme Distribution France", "dana", TODAY, "FR"));
        assertEquals("FOR olga BY olga ·  · 2026-11-27", watermark.text("olga", "olga", TODAY, ""));
        assertEquals("FOR ab BY c ·  · 2026-11-27", watermark.text("a\u0000b\n", "‮c", TODAY, null));
        String long_ = "x".repeat(150);
        assertEquals("FOR " + "x".repeat(Watermark.MAX_VALUE) + " BY u ·  · 2026-11-27",
                watermark.text(long_, "u", TODAY, ""));
    }

    @Test
    void anExceptNamingNoGroupIsLeftOutSoThatMoreIsMarked() throws Exception {
        RightsPolicy policy = parse("""
                <watermark text="ACME"><previews /><except group="Everyone" /><except group=" " />
                  <except group="members" /><except group="administrators" /></watermark>
                """);
        assertFalse(policy.broken());
        assertEquals(Set.of(), policy.watermark().except());
        assertEquals(Reason.WATERMARK_REQUIRED, download(policy, Use.view("Medium"), STAFF).reason());
    }

    /**
     * The system, acting for no one, is exempt from nothing whatever groups it carries; acting for
     * someone, it is that person, as the user directory has them.
     */
    @Test
    void theSystemActingForNoOneIsExemptFromNothing() throws Exception {
        RightsPolicy policy = parse("""
                <watermark text="ACME"><previews /><except group="brand-team" /></watermark>
                """);
        NuxeoPrincipal system = new UserPrincipal("system", List.of("brand-team", "administrators"), false, true);
        assertEquals(Reason.WATERMARK_REQUIRED, download(policy, Use.view("Medium"), system).reason());
        assertEquals(Reason.PREVIEW, download(policy, Use.view("Medium"), STAFF).reason());
    }

    @Test
    void eachMistakeBreaksThePolicySoThatEveryUseIsRefused() throws Exception {
        for (String broken : List.of(
                // Two watermarks.
                "<watermark text=\"A\"><downloads /></watermark><watermark text=\"B\"><previews /></watermark>",
                // No text, or an empty one.
                "<watermark><downloads /></watermark>", "<watermark text=\"  \"><downloads /></watermark>",
                // A name it does not know, a brace that names nothing, a control character, too long.
                "<watermark text=\"FOR {email}\"><downloads /></watermark>",
                "<watermark text=\"FOR {recipient\"><downloads /></watermark>",
                "<watermark text=\"FOR &#9;TAB\"><downloads /></watermark>",
                "<watermark text=\"" + "x".repeat(Watermark.MAX_TEXT + 1) + "\"><downloads /></watermark>",
                // A placement it does not know, or written otherwise.
                "<watermark text=\"A\" placement=\"diagonal\"><downloads /></watermark>",
                "<watermark text=\"A\" placement=\"Tiled\"><downloads /></watermark>",
                // No occasion.
                "<watermark text=\"A\" />",
                // An occasion naming a use the policy does not list for it.
                "<watermark text=\"A\"><previews><view name=\"FullHD\" /></previews></watermark>",
                "<watermark text=\"A\"><downloads><view name=\"Medium\" /></downloads></watermark>",
                "<watermark text=\"A\"><downloads><blob xpath=\"files:files/0/file\" /></downloads></watermark>",
                "<watermark text=\"A\"><previews><view /></previews></watermark>",
                // Deliveries in a policy with no package.
                "<watermark text=\"A\"><deliveries /></watermark>")) {
            RightsPolicy policy = parse(broken);
            assertTrue(policy.broken(), broken);
            assertNull(policy.watermark(), broken);
            assertFalse(policy.problems().isEmpty(), broken);
            assertEquals(Reason.POLICY_ERROR, download(policy, Use.view("Medium"), STAFF).reason(), broken);
            assertEquals(Reason.POLICY_ERROR, download(policy, Use.view("FullHD"), STAFF).reason(), broken);
        }
    }

    /**
     * A delivery's mark names its filer, {@code {user}}: the distributor's name is the filer's to
     * write, so a mark naming it alone could name anyone. With no {@code {user}}, the policy is broken.
     */
    @Test
    void aMarkForDeliveriesMustNameItsFiler() throws Exception {
        String rules = """
                      <territories xpath="fver:territories" />
                      <windows xpath="film:windows" />
                      <delivery><original /></delivery>
                """;
        RightsPolicy without = parse(rules + "<watermark text=\"FOR {recipient}\"><deliveries /></watermark>");
        assertTrue(without.broken(), without.problems()::toString);
        assertTrue(without.problems().stream().anyMatch(problem -> problem.contains("{user}")),
                without.problems()::toString);
        RightsPolicy with = parse(rules + "<watermark text=\"FOR {recipient} BY {user}\"><deliveries /></watermark>");
        assertFalse(with.broken(), with.problems()::toString);
        assertTrue(with.watermark().marks(Occasion.DELIVERY, Use.ORIGINAL));
    }

    @Test
    void theMediaKitsOwnWatermarkMarksItsStillForOutsidersAndItsKeyArtForEachDelivery() throws Exception {
        List<RightsPolicyDescriptor> policies = RightsPolicyTest.contributed(Files.readAllBytes(
                TerritoriesPolicyTest.KIT_COMPONENT));
        RightsPolicy policy = RightsPolicy.of(policies.get(0));
        assertFalse(policy.broken(), policy.problems()::toString);
        Watermark watermark = policy.watermark();
        assertNotNull(watermark);
        Use still = Use.blob("files:files/3/file");
        Use keyArt = Use.blob("files:files/2/file");
        assertTrue(policy.rule(still).preview());
        assertTrue(watermark.marks(Occasion.PREVIEW, still));
        assertFalse(watermark.marks(Occasion.PREVIEW, Use.rendition("thumbnail")), "the lists' thumbnail");
        assertFalse(watermark.marks(Occasion.DOWNLOAD), "a download is not marked");
        assertTrue(watermark.marks(Occasion.DELIVERY, keyArt));
        assertFalse(watermark.marks(Occasion.DELIVERY, Use.ORIGINAL), "the master is not");
        assertFalse(watermark.marks(Occasion.DELIVERY, Use.blob("files:files/1/file")), "nor the subtitles");
        assertEquals(Set.of("media-rights", "media-distribution"), watermark.except());
        assertEquals("ACME PICTURES · FOR Acme Distribution France · dana · 2026-11-27",
                watermark.text("Acme Distribution France", "dana", TODAY, "FR"));
        NuxeoPrincipal partner = new UserPrincipal("paula", List.of("members"), false, false);
        assertTrue(watermark.requiredFor(Occasion.PREVIEW, still, partner));
        assertFalse(watermark.requiredFor(Occasion.PREVIEW, still,
                new UserPrincipal("dana", List.of("media-distribution"), false, false)));
        assertTrue(watermark.requiredFor(Occasion.DELIVERY, keyArt,
                new UserPrincipal("dana", List.of("media-distribution"), false, false)), "a delivery is marked for its distributor, whoever files it");
    }
}
