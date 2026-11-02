package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.nuxeo.agentic.config.TestContributions.disabledFragment;
import static org.nuxeo.agentic.config.TestContributions.fragment;
import static org.nuxeo.agentic.config.TestContributions.layout;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;

class ContributionRegistryTest {

    private static List<String> owners(ContributionRegistry.Resolution resolution) {
        return resolution.inForce()
                         .stream()
                         .map(ConfigSnapshot.Loaded::contribution)
                         .map(c -> c.provenance().component() + ":" + c.key())
                         .toList();
    }

    private static List<String> codes(ContributionRegistry.Resolution resolution) {
        return resolution.diagnostics().stream().map(Diagnostic::code).toList();
    }

    @Test
    void keepsRegistrationOrder() {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(fragment("ours", "bootstrap", "defaults", "{}"));
        registry.add(fragment("acme", "bootstrap", "acme", "{}"));
        registry.add(fragment("partner", "bootstrap", "partner", "{}"));

        assertEquals(List.of("ours:fragment bootstrap/defaults", "acme:fragment bootstrap/acme",
                "partner:fragment bootstrap/partner"), owners(registry.resolve()));
    }

    @Test
    void aLaterFragmentWithTheSameNameAndLayerReplacesTheEarlierOneInPlace() {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(fragment("ours", "bootstrap", "defaults", "{}"));
        registry.add(fragment("acme", "bootstrap", "acme", "{}"));
        registry.add(fragment("partner", "bootstrap", "defaults", "{}"));

        ContributionRegistry.Resolution resolution = registry.resolve();

        assertEquals(List.of("partner:fragment bootstrap/defaults", "acme:fragment bootstrap/acme"),
                owners(resolution));
        assertEquals(List.of("replaced"), codes(resolution));
        assertTrue(resolution.diagnostics().get(0).message().contains("ours (bundle ours.bundle)"));
        assertTrue(resolution.diagnostics().get(0).message().contains("replaced by partner"));
        // One package patching another's fragment is ordinary layering and stays quiet. Asserted
        // because it was not (NXSAT-747): the level here was unchecked, so making the packaged
        // case a warning could have made every replacement one and nothing would have failed.
        assertEquals(Diagnostic.Level.INFO, resolution.diagnostics().get(0).level());
    }

    @Test
    void theSameNameInAnotherLayerIsADifferentFragment() {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(fragment("ours", "bootstrap", "defaults", "{}"));
        registry.add(fragment("ours", "manifest", "defaults", "{}"));

        assertEquals(2, registry.resolve().inForce().size());
        assertTrue(registry.resolve().diagnostics().isEmpty());
    }

    @Test
    void disablingRemovesTheFragmentAndSaysWho() {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(fragment("ours", "manifest", "defaults", "{}"));
        registry.add(fragment("acme", "manifest", "acme", "{}"));
        registry.add(disabledFragment("partner", "manifest", "acme"));

        ContributionRegistry.Resolution resolution = registry.resolve();

        assertEquals(List.of("ours:fragment manifest/defaults"), owners(resolution));
        assertEquals(List.of("removed"), codes(resolution));
        assertEquals(ConfigScope.MANIFEST, resolution.diagnostics().get(0).scope());
        // As above: removing another package's fragment is what the disable flag is for.
        assertEquals(Diagnostic.Level.INFO, resolution.diagnostics().get(0).level());
    }

    // NXSAT-747. Losing our own packaged defaults is almost never deliberate, and an `info` is
    // not something anyone greps `server.log` for. Both of these displace a contribution whose
    // provenance is the bundle we ship, which is the only thing that distinguishes them from the
    // two tests above.
    @Test
    void replacingOneOfOurPackagedDefaultsIsAWarningWithItsOwnCode() {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(TestContributions.packagedFragment("bootstrap", "defaults", "{}"));
        registry.add(fragment("dflt", "bootstrap", "defaults", "{}"));

        ContributionRegistry.Resolution resolution = registry.resolve();

        assertEquals(List.of("dflt:fragment bootstrap/defaults"), owners(resolution));
        assertEquals(List.of("replaced-packaged-default"), codes(resolution));
        Diagnostic diagnostic = resolution.diagnostics().get(0);
        assertEquals(Diagnostic.Level.WARNING, diagnostic.level());
        // The message must still say what was displaced and who displaced it, or raising the
        // level only tells an administrator that something happened somewhere.
        assertTrue(diagnostic.message().contains("fragment bootstrap/defaults"));
        assertTrue(diagnostic.message().contains("org.nuxeo.agentic.ui.config.defaults"));
        assertTrue(diagnostic.message().contains("replaced by dflt"));
    }

    @Test
    void disablingOneOfOurPackagedDefaultsIsAWarningWithItsOwnCode() {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(TestContributions.packagedFragment("manifest", "defaults", "{}"));
        registry.add(disabledFragment("dflt", "manifest", "defaults"));

        ContributionRegistry.Resolution resolution = registry.resolve();

        assertTrue(resolution.inForce().isEmpty());
        assertEquals(List.of("removed-packaged-default"), codes(resolution));
        Diagnostic diagnostic = resolution.diagnostics().get(0);
        assertEquals(Diagnostic.Level.WARNING, diagnostic.level());
        assertTrue(diagnostic.message().contains("fragment manifest/defaults"));
        assertTrue(diagnostic.message().contains("removed by dflt"));
    }

    /**
     * The rule is about what we ship, not about fragments, so it holds for anything we package.
     * We contribute only fragments today; this is what makes that a fact about the contribution
     * list rather than a limit of the check.
     */
    @Test
    void aPackagedLayoutIsDisplacedAsLoudlyAsAPackagedFragment() {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(TestContributions.packagedLayout("File", "view", "{}"));
        registry.add(layout("acme", "File", "view", "{}"));

        ContributionRegistry.Resolution resolution = registry.resolve();

        assertEquals(List.of("replaced-packaged-default"), codes(resolution));
        assertEquals(Diagnostic.Level.WARNING, resolution.diagnostics().get(0).level());
    }

    /**
     * {@link Provenance#isPackaged} compares the contributing bundle against a string. Rename the
     * bundle in the manifest without changing that string and every displacement of our own
     * defaults silently drops back to `info` — the failure this whole change exists to prevent,
     * reintroduced with nothing failing.
     */
    @Test
    void theBundleWeTreatAsOursIsTheOneWeActuallyShip() throws IOException {
        Path manifest = Path.of(System.getProperty("basedir", "."), "src/main/resources/META-INF/MANIFEST.MF");
        String declared = Files.readAllLines(manifest)
                                .stream()
                                .filter(line -> line.startsWith("Bundle-SymbolicName:"))
                                .map(line -> line.substring("Bundle-SymbolicName:".length()).trim())
                                // `org.nuxeo.agentic.core;singleton:=true` — the name is what
                                // Bundle.getSymbolicName() returns, without the directives.
                                .map(value -> value.split(";")[0])
                                .findFirst()
                                .orElseThrow(() -> new AssertionError(
                                        "no Bundle-SymbolicName in " + manifest));

        assertEquals(declared, Provenance.PACKAGED_BUNDLE);
    }

    @Test
    void disablingSomethingThatWasNeverContributedIsReported() {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(disabledFragment("acme", "bootstrap", "typo"));

        ContributionRegistry.Resolution resolution = registry.resolve();

        assertTrue(resolution.inForce().isEmpty());
        assertEquals(List.of("disabled-nothing"), codes(resolution));
        assertEquals(Diagnostic.Level.WARNING, resolution.diagnostics().get(0).level());
    }

    @Test
    void reEnablingAfterARemovalAppendsAtTheEnd() {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(fragment("ours", "bootstrap", "a", "{}"));
        registry.add(fragment("ours", "bootstrap", "b", "{}"));
        registry.add(disabledFragment("acme", "bootstrap", "a"));
        registry.add(fragment("acme", "bootstrap", "a", "{}"));

        assertEquals(List.of("ours:fragment bootstrap/b", "acme:fragment bootstrap/a"),
                owners(registry.resolve()));
    }

    @Test
    void aLaterLayoutForTheSameTypeAndModeReplacesTheWholeFile() {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(layout("ours", "File", "view", "{}"));
        registry.add(layout("acme", "File", "edit", "{}"));
        registry.add(layout("partner", "File", "view", "{}"));

        ContributionRegistry.Resolution resolution = registry.resolve();

        assertEquals(List.of("partner:layout File/view", "acme:layout File/edit"), owners(resolution));
        assertEquals(ConfigScope.LAYOUTS, resolution.diagnostics().get(0).scope());
    }

    @Test
    void invalidContributionsAreReportedAndSkipped() {
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(fragment("acme", "runtime", "acme", "{}"));
        registry.add(fragment("acme", "bootstrap", "../escape", "{}"));
        registry.add(layout("acme", "File", "View", "{}"));
        registry.add(layout("acme", "../File", "view", "{}"));
        registry.add(TestContributions.asset("acme", "logo.html", new byte[0]));
        registry.add(TestContributions.asset("acme", "../logo.svg", new byte[0]));
        registry.add(Contribution.fragment("bootstrap", "empty", true, TestContributions.from("acme"), null,
                new Object()));

        ContributionRegistry.Resolution resolution = registry.resolve();

        assertTrue(resolution.inForce().isEmpty());
        assertEquals(7, resolution.diagnostics().size());
        assertTrue(resolution.diagnostics().stream().allMatch(d -> d.level() == Diagnostic.Level.ERROR));
        assertTrue(resolution.diagnostics().stream().allMatch(d -> d.code().equals("invalid-contribution")));
    }

    @Test
    void acceptsImageAssetNamesOnly() {
        for (String name : List.of("logo.svg", "acme-logo.PNG", "brand.mark.webp", "favicon.ico", "a_b.jpeg")) {
            assertTrue(ContributionRegistry.ASSET_NAME.matcher(name).matches(), name);
        }
        for (String name : List.of("logo.svg.js", "logo", ".svg", "dir/logo.svg", "logo.svgz", "x.html")) {
            assertFalse(ContributionRegistry.ASSET_NAME.matcher(name).matches(), name);
        }
    }

    @Test
    void withdrawingAContributionIsTheSameAsNeverHavingRegisteredIt() {
        Contribution partner = fragment("partner", "bootstrap", "defaults", "{}");
        ContributionRegistry registry = new ContributionRegistry();
        registry.add(fragment("ours", "bootstrap", "defaults", "{}"));
        registry.add(partner);

        assertTrue(registry.remove(partner.descriptor()));

        ContributionRegistry.Resolution resolution = registry.resolve();
        assertEquals(List.of("ours:fragment bootstrap/defaults"), owners(resolution));
        assertTrue(resolution.diagnostics().isEmpty());
        assertFalse(registry.remove(partner.descriptor()));
    }
}
