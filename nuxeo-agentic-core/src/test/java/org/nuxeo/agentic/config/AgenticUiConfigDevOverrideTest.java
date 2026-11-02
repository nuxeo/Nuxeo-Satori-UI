package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeFalse;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.UnaryOperator;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.ComponentName;
import org.nuxeo.runtime.model.RuntimeContext;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * The development override directory, through the component and the endpoint that serve it.
 *
 * Written at this level rather than against {@link DevOverrides} because the claims worth holding
 * are about the whole path: that production is untouched, that an edit is visible without a
 * restart, and that an override is still subject to the four-layer contract — ordering,
 * replacement in place, per-contribution validation, provenance and the asset CSP. An override
 * that reached the browser around any of those would be worse than the restart it saves.
 */
class AgenticUiConfigDevOverrideTest {

    private static final String DEFAULTS = "{\"branding\":{\"applicationTitle\":\"Hyland Nuxeo\"}}";

    /* ------------------------------------------------------------------- the fixture */

    /**
     * A contributor in a named bundle.
     *
     * The bundle, not the component, is what {@link Provenance#isPackaged} reads, and it is the
     * difference between an override being reported as ordinary layering and as displacing a
     * product default. A test that let it default would exercise the customer-on-customer branch
     * and pass for the wrong reason — the trap {@code TestContributions.packaged} documents.
     */
    private static ComponentInstance contributor(String component, String bundleName) {
        Object bundle = Proxy.newProxyInstance(AgenticUiConfigDevOverrideTest.class.getClassLoader(),
                new Class<?>[] { org.osgi.framework.Bundle.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getSymbolicName" -> bundleName;
                default -> throw new UnsupportedOperationException(method.getName());
                });
        RuntimeContext context = (RuntimeContext) Proxy.newProxyInstance(RuntimeContext.class.getClassLoader(),
                new Class<?>[] { RuntimeContext.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getBundle" -> bundle;
                default -> throw new UnsupportedOperationException(method.getName());
                });
        return (ComponentInstance) Proxy.newProxyInstance(ComponentInstance.class.getClassLoader(),
                new Class<?>[] { ComponentInstance.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getName" -> new ComponentName(component);
                case "getContext" -> context;
                default -> throw new UnsupportedOperationException(method.getName());
                });
    }

    private static FragmentDescriptor fragment(String layer, String name, String json) {
        FragmentDescriptor descriptor = new FragmentDescriptor();
        descriptor.name = name;
        descriptor.layer = layer;
        descriptor.json = json;
        return descriptor;
    }

    /** The product's own packaged defaults, as the runtime registers them. */
    private static void packaged(AgenticUiConfigComponent component, String layer, String name, String json) {
        component.registerContribution(fragment(layer, name, json), AgenticUiConfigComponent.XP_CONFIGURATION,
                contributor("org.nuxeo.agentic.ui.config.defaults", Provenance.PACKAGED_BUNDLE));
    }

    private static UnaryOperator<String> properties(String... pairs) {
        Map<String, String> values = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            values.put(pairs[i], pairs[i + 1]);
        }
        return values::get;
    }

    /**
     * A started component holding our packaged defaults, with the overrides on or off.
     *
     * The "off" case names the directory and omits only the switch, and that detail is the whole
     * value of these tests. The first version left both unset, so when the switch was deleted
     * from {@code ifEnabled} as a deliberate perturbation, {@code ifEnabled} still returned
     * {@code null} — it had no directory to point at — and every assertion below stayed green
     * against code with no switch in it at all. Naming the directory removes that second reason
     * to be off, so the only thing left holding the overrides off is the property, which is what
     * these tests claim to be about. It is also the realistic hazard: a leftover
     * {@code …dev.dir=} line in a conf file.
     */
    private static AgenticUiConfigComponent component(Path directory, boolean enabled) {
        AgenticUiConfigComponent component = new AgenticUiConfigComponent();
        packaged(component, ConfigScope.BOOTSTRAP, "defaults", DEFAULTS);
        packaged(component, ConfigScope.MANIFEST, "defaults", "{\"version\":1}");
        List<String> lookup = new ArrayList<>(List.of(DevOverrides.DIRECTORY_PROPERTY, directory.toString()));
        if (enabled) {
            lookup.addAll(List.of(DevOverrides.ENABLED_PROPERTY, "true"));
        }
        component.activateDevOverrides(properties(lookup.toArray(String[]::new)));
        return component;
    }

    private static void write(Path directory, String relative, String body) throws Exception {
        Path file = directory.resolve(relative);
        Files.createDirectories(file.getParent());
        Files.writeString(file, body);
    }

    private static ConfigEndpoint.Response response(AgenticUiConfigComponent component, String path) {
        return new ConfigEndpoint(component.getSnapshot()).respond(path, null);
    }

    private static JsonNode body(AgenticUiConfigComponent component, String path) throws Exception {
        return ConfigSnapshot.JSON.readTree(response(component, path).body());
    }

    private static List<String> titles(JsonNode envelope) {
        List<String> titles = new ArrayList<>();
        for (JsonNode entry : envelope.get("fragments")) {
            titles.add(entry.at("/content/branding/applicationTitle").asText(""));
        }
        return titles;
    }

    private static List<String> names(JsonNode envelope) {
        List<String> names = new ArrayList<>();
        for (JsonNode entry : envelope.get("fragments")) {
            names.add(entry.get("name").asText());
        }
        return names;
    }

    private static List<String> diagnosticCodes(JsonNode envelope) {
        List<String> codes = new ArrayList<>();
        for (JsonNode entry : envelope.get("diagnostics")) {
            codes.add(entry.get("code").asText());
        }
        return codes;
    }

    /* --------------------------------------------------- the production behaviour, unchanged */

    /**
     * With the property unset the directory is ignored entirely — asserted on the bytes.
     *
     * This is the acceptance criterion the whole feature rests on, so it is asserted the
     * strongest way available: a fragment that would be unmistakable in the output is written
     * into the directory, and the response is compared byte for byte, ETag included, against a
     * server that has no override directory at all. Anything that reached the filesystem would
     * change the body, the diagnostics or the ETag, and all three are held.
     */
    @Test
    void withThePropertyUnsetTheDirectoryIsIgnoredEntirely(@TempDir Path dir) throws Exception {
        write(dir, "bootstrap.json", "{\"branding\":{\"applicationTitle\":\"Should Never Appear\"}}");
        write(dir, "manifest.json", "{\"labels\":{\"app.navbar.browse\":\"Should Never Appear\"}}");
        write(dir, "assets/sneaky.svg", "<svg/>");

        ConfigEndpoint.Response withDirectory = response(component(dir, false), ConfigEndpoint.BOOTSTRAP_PATH);
        ConfigEndpoint.Response withoutDirectory = response(component(dir.resolve("absent"), false),
                ConfigEndpoint.BOOTSTRAP_PATH);

        assertArrayEquals(withoutDirectory.body(), withDirectory.body());
        assertEquals(withoutDirectory.headers().get("ETag"), withDirectory.headers().get("ETag"));
        assertFalse(new String(withDirectory.body(), StandardCharsets.UTF_8).contains("Should Never Appear"));
    }

    /** The same for the other two documents, so nothing leaks through a path this one does not read. */
    @Test
    void withThePropertyUnsetNoOverriddenAssetOrManifestIsServed(@TempDir Path dir) throws Exception {
        write(dir, "manifest.json", "{\"labels\":{\"app.navbar.browse\":\"Should Never Appear\"}}");
        write(dir, "assets/sneaky.svg", "<svg/>");
        AgenticUiConfigComponent component = component(dir, false);

        assertFalse(new String(response(component, ConfigEndpoint.MANIFEST_PATH).body(), StandardCharsets.UTF_8)
                                                                                 .contains("Should Never Appear"));
        assertEquals(404, response(component, ConfigEndpoint.assetPath("sneaky.svg")).status());
    }

    /* -------------------------------------------------------------------- the dev loop */

    @Test
    void withThePropertySetTheOverrideIsAppliedAfterEveryPackagedFragment(@TempDir Path dir) throws Exception {
        write(dir, "bootstrap.json", "{\"branding\":{\"applicationTitle\":\"Acme Insurance\"}}");

        JsonNode envelope = body(component(dir, true), ConfigEndpoint.BOOTSTRAP_PATH);

        assertEquals(List.of("defaults", "dev"), names(envelope));
        assertEquals(List.of("Hyland Nuxeo", "Acme Insurance"), titles(envelope));
    }

    /**
     * A second edit is picked up too — the directory is re-read, not read once and cached.
     *
     * The two bodies differ in length as well as in content, so the stamp moves on the file's
     * size whatever timestamp resolution the filesystem keeps. The alternative — writing two
     * bodies of equal length and relying on the modification time — would be a test that passes
     * on APFS and ext4 and flakes on a FAT or NFS working directory.
     */
    @Test
    void aSecondEditIsPickedUpWithoutARestart(@TempDir Path dir) throws Exception {
        write(dir, "bootstrap.json", "{\"branding\":{\"applicationTitle\":\"First\"}}");
        AgenticUiConfigComponent component = component(dir, true);
        assertEquals(List.of("Hyland Nuxeo", "First"), titles(body(component, ConfigEndpoint.BOOTSTRAP_PATH)));

        write(dir, "bootstrap.json", "{\"branding\":{\"applicationTitle\":\"Second, and longer\"}}");

        assertEquals(List.of("Hyland Nuxeo", "Second, and longer"),
                titles(body(component, ConfigEndpoint.BOOTSTRAP_PATH)));
    }

    @Test
    void removingTheFileRestoresThePackagedConfiguration(@TempDir Path dir) throws Exception {
        write(dir, "bootstrap.json", "{\"branding\":{\"applicationTitle\":\"Acme Insurance\"}}");
        AgenticUiConfigComponent component = component(dir, true);
        assertEquals(2, body(component, ConfigEndpoint.BOOTSTRAP_PATH).get("fragments").size());

        Files.delete(dir.resolve("bootstrap.json"));

        assertEquals(List.of("defaults"), names(body(component, ConfigEndpoint.BOOTSTRAP_PATH)));
    }

    /**
     * An unchanged directory answers from the same snapshot, so the rendered bodies and their
     * ETags survive and the browser still gets its 304.
     */
    @Test
    void anUnchangedDirectoryKeepsTheSameSnapshot(@TempDir Path dir) throws Exception {
        write(dir, "bootstrap.json", "{}");
        AgenticUiConfigComponent component = component(dir, true);

        assertSame(component.getSnapshot(), component.getSnapshot());
    }

    @Test
    void anEditedDirectoryGivesANewEtag(@TempDir Path dir) throws Exception {
        write(dir, "bootstrap.json", "{\"branding\":{\"applicationTitle\":\"First\"}}");
        AgenticUiConfigComponent component = component(dir, true);
        String before = response(component, ConfigEndpoint.BOOTSTRAP_PATH).headers().get("ETag");

        write(dir, "bootstrap.json", "{\"branding\":{\"applicationTitle\":\"Second, and longer\"}}");

        assertNotEquals(before, response(component, ConfigEndpoint.BOOTSTRAP_PATH).headers().get("ETag"));
    }

    /**
     * An override that could not be read is picked up once its permissions are repaired.
     *
     * {@code chmod} moves a file's ctime and leaves its path, size and modification time alone,
     * so a stamp built from those three cannot see the repair. Without readability in the stamp
     * this returns the cached fallback snapshot for as long as the body is not also edited, and
     * the developer sees a configuration that stays broken after they have fixed it.
     */
    @Test
    void anOverrideIsPickedUpAfterAPermissionOnlyRepair(@TempDir Path dir) throws Exception {
        write(dir, "bootstrap.json", "{\"branding\":{\"applicationTitle\":\"Acme Insurance\"}}");
        Path file = dir.resolve("bootstrap.json");
        assumeTrue(Files.getFileStore(file).supportsFileAttributeView(PosixFileAttributeView.class),
                "POSIX permissions are what this asserts the recovery from");
        Files.setPosixFilePermissions(file, Set.of());
        assumeFalse(Files.isReadable(file), "running as a user permissions do not apply to, root most likely");
        AgenticUiConfigComponent component = component(dir, true);
        assertEquals(List.of("defaults"), names(body(component, ConfigEndpoint.BOOTSTRAP_PATH)));

        Files.setPosixFilePermissions(file, Set.of(PosixFilePermission.OWNER_READ));

        assertEquals(List.of("defaults", "dev"), names(body(component, ConfigEndpoint.BOOTSTRAP_PATH)));
        assertEquals(List.of("Hyland Nuxeo", "Acme Insurance"),
                titles(body(component, ConfigEndpoint.BOOTSTRAP_PATH)));
    }

    /* ------------------------------------------- the composition contract, still applied */

    /**
     * A malformed override is rejected and reported, and the fragment it would have replaced
     * stays in force.
     *
     * The property that makes the override directory safe to use while a demo is running: a typo
     * at 23:50 the night before a prospect call leaves the packaged configuration serving, with
     * the reason in the diagnostics, rather than taking the application's configuration down.
     */
    @Test
    void aMalformedOverrideIsRejectedAndThePackagedFragmentStaysInForce(@TempDir Path dir) throws Exception {
        write(dir, "bootstrap.defaults.json", "{\"branding\": oops}");

        JsonNode envelope = body(component(dir, true), ConfigEndpoint.BOOTSTRAP_PATH);

        assertEquals(List.of("defaults"), names(envelope));
        assertEquals(List.of("Hyland Nuxeo"), titles(envelope));
        assertTrue(diagnosticCodes(envelope).contains("invalid-json"), envelope.toString());
        assertTrue(diagnosticCodes(envelope).contains("kept"), envelope.toString());
    }

    /**
     * An override too large to use is rejected like any other, rather than being read into the
     * heap first and rejected afterwards.
     *
     * The size limit is applied to bytes already in hand, so what keeps a mis-targeted copy of
     * something enormous from taking the server down is that the read itself stops one byte past
     * the limit. This asserts the outcome a developer sees; {@code DevOverridesTest} asserts that
     * only that many bytes were ever held.
     */
    @Test
    void anOverrideTooLargeToUseIsRejectedAndThePackagedFragmentStaysInForce(@TempDir Path dir) throws Exception {
        Files.createDirectories(dir);
        Files.write(dir.resolve("bootstrap.defaults.json"), new byte[ConfigSnapshot.MAX_JSON_BYTES + 4096]);

        JsonNode envelope = body(component(dir, true), ConfigEndpoint.BOOTSTRAP_PATH);

        assertEquals(List.of("defaults"), names(envelope));
        assertEquals(List.of("Hyland Nuxeo"), titles(envelope));
        assertTrue(diagnosticCodes(envelope).contains("too-large"), envelope.toString());
        assertTrue(diagnosticCodes(envelope).contains("kept"), envelope.toString());
    }

    /**
     * An override named after a packaged fragment replaces it <em>in place</em> — it takes the
     * position it displaced rather than jumping over everything registered in between — and the
     * displacement of a product default is reported as a warning, because the override's
     * provenance is not ours.
     */
    @Test
    void anOverrideNamedAfterAPackagedFragmentReplacesItInPlace(@TempDir Path dir) throws Exception {
        AgenticUiConfigComponent component = new AgenticUiConfigComponent();
        packaged(component, ConfigScope.BOOTSTRAP, "defaults", DEFAULTS);
        packaged(component, ConfigScope.BOOTSTRAP, "beta", "{\"defaultThemeId\":\"dark\"}");
        write(dir, "bootstrap.defaults.json", "{\"branding\":{\"applicationTitle\":\"Acme Insurance\"}}");
        component.activateDevOverrides(properties(DevOverrides.ENABLED_PROPERTY, "true",
                DevOverrides.DIRECTORY_PROPERTY, dir.toString()));

        JsonNode envelope = body(component, ConfigEndpoint.BOOTSTRAP_PATH);

        assertEquals(List.of("defaults", "beta"), names(envelope));
        assertEquals("Acme Insurance", envelope.at("/fragments/0/content/branding/applicationTitle").asText());
        assertEquals("bootstrap.defaults.json", envelope.at("/fragments/0/source").asText());
        assertTrue(diagnosticCodes(envelope).contains("replaced-packaged-default"), envelope.toString());
    }

    /**
     * Provenance names the file, so support can answer "where did this value come from" for an
     * override as it can for a package.
     */
    @Test
    void provenanceNamesTheFileAnOverrideCameFrom(@TempDir Path dir) throws Exception {
        write(dir, "manifest.acme.json", "{\"labels\":{\"app.navbar.browse\":\"Contracts\"}}");

        JsonNode entry = body(component(dir, true), ConfigEndpoint.MANIFEST_PATH).at("/fragments/1");

        assertEquals(DevOverrides.COMPONENT, entry.get("component").asText());
        assertEquals(DevOverrides.BUNDLE, entry.get("bundle").asText());
        assertEquals("manifest.acme.json", entry.get("source").asText());
    }

    /** A contributed image is served by the endpoint, so it keeps the endpoint's strict CSP. */
    @Test
    void anOverridingAssetKeepsTheStrictCsp(@TempDir Path dir) throws Exception {
        write(dir, "assets/acme-logo.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");

        ConfigEndpoint.Response asset = response(component(dir, true), ConfigEndpoint.assetPath("acme-logo.svg"));

        assertEquals(200, asset.status());
        assertEquals("image/svg+xml", asset.headers().get("Content-Type"));
        assertEquals(ConfigEndpoint.CONTENT_SECURITY_POLICY, asset.headers().get("Content-Security-Policy"));
    }

    /**
     * The asset allow-list applies to an override as well: the directory is a faster way to
     * contribute, not a way to contribute something a package could not.
     */
    @Test
    void anOverridingAssetThatIsNotAnImageIsRefused(@TempDir Path dir) throws Exception {
        write(dir, "assets/evil.html", "<script>alert(1)</script>");

        JsonNode envelope = body(component(dir, true), ConfigEndpoint.BOOTSTRAP_PATH);

        assertEquals(0, envelope.get("assets").size());
        assertTrue(diagnosticCodes(envelope).contains("invalid-contribution"), envelope.toString());
    }

    /** A layout override is read from the same place a package's layout file sits. */
    @Test
    void aLayoutOverrideIsServedAtItsLayoutPath(@TempDir Path dir) throws Exception {
        write(dir, "layouts/Contract/view.layout.json", "{\"rows\":[]}");

        ConfigEndpoint.Response layout = response(component(dir, true),
                ConfigEndpoint.layoutPath("Contract", "view"));

        assertEquals(200, layout.status());
    }

    /** A name the directory does not read reaches the browser's diagnostics rather than nothing. */
    @Test
    void aMisspeltFileNameIsReportedToTheBrowser(@TempDir Path dir) throws Exception {
        write(dir, "bootsrap.json", "{}");

        JsonNode envelope = body(component(dir, true), ConfigEndpoint.BOOTSTRAP_PATH);

        assertEquals(List.of("defaults"), names(envelope));
        assertTrue(diagnosticCodes(envelope).contains("dev-override-ignored"), envelope.toString());
    }
}
