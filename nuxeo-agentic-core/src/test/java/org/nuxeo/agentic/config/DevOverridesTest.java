package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.UnaryOperator;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The development override directory, on its own.
 *
 * The switch is the half worth most of this file. Everything else here is read once by a
 * developer who has already decided to turn it on; {@link #isOffUnlessTheSwitchIsExplicitlyTrue}
 * is what every production server depends on, and it is the assertion that has to keep working
 * when someone later adds a second way in.
 */
class DevOverridesTest {

    private static UnaryOperator<String> properties(String... pairs) {
        Map<String, String> values = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            values.put(pairs[i], pairs[i + 1]);
        }
        return values::get;
    }

    /* -------------------------------------------------------------------- the switch */

    @Test
    void isOffWhenNoPropertyIsSetAtAll() {
        assertNull(DevOverrides.ifEnabled(properties()));
    }

    /**
     * Everything that is not {@code true} leaves it off, {@code 1} and {@code yes} included.
     *
     * {@link Boolean#parseBoolean} rather than a looser reading on purpose: the values a person
     * reaches for when they mean "on" are exactly the values that must not quietly turn a
     * production server's configuration into something editable from its filesystem. Being strict
     * costs a developer one correction; being lenient costs a customer a hole.
     */
    @ParameterizedTest
    @ValueSource(strings = { "", " ", "false", "FALSE", "0", "1", "yes", "on", "enabled" })
    void isOffUnlessTheSwitchIsExplicitlyTrue(String value) {
        assertNull(DevOverrides.ifEnabled(properties(DevOverrides.ENABLED_PROPERTY, value,
                DevOverrides.DIRECTORY_PROPERTY, "/tmp/somewhere")));
    }

    @ParameterizedTest
    @ValueSource(strings = { "true", "TRUE", "True", " true " })
    void isOnWhenTheSwitchIsTrue(String value) {
        DevOverrides overrides = DevOverrides.ifEnabled(
                properties(DevOverrides.ENABLED_PROPERTY, value, DevOverrides.DIRECTORY_PROPERTY, "/tmp/somewhere"));

        assertEquals(Path.of("/tmp/somewhere"), overrides.directory());
    }

    /**
     * The directory alone is not a switch. A leftover line naming a path is then inert, which is
     * the reason the switch is a separate boolean rather than the presence of the path.
     */
    @Test
    void isOffWhenOnlyTheDirectoryIsNamed() {
        assertNull(DevOverrides.ifEnabled(properties(DevOverrides.DIRECTORY_PROPERTY, "/tmp/somewhere")));
    }

    @Test
    void defaultsToTheDataDirectory() {
        DevOverrides overrides = DevOverrides.ifEnabled(
                properties(DevOverrides.ENABLED_PROPERTY, "true", DevOverrides.DATA_DIR_PROPERTY, "/var/lib/nuxeo"));

        assertEquals(Path.of("/var/lib/nuxeo", DevOverrides.DEFAULT_DIRECTORY_NAME), overrides.directory());
    }

    /** Switched on with nowhere to read: off, rather than a directory invented under the cwd. */
    @Test
    void isOffWhenSwitchedOnWithNoDirectoryAndNoDataDirectory() {
        assertNull(DevOverrides.ifEnabled(properties(DevOverrides.ENABLED_PROPERTY, "true")));
    }

    /* ------------------------------------------------------------ reading the directory */

    private static DevOverrides at(Path directory) {
        return DevOverrides.ifEnabled(properties(DevOverrides.ENABLED_PROPERTY, "true",
                DevOverrides.DIRECTORY_PROPERTY, directory.toString()));
    }

    private static void write(Path directory, String relative, String body) throws Exception {
        Path file = directory.resolve(relative);
        Files.createDirectories(file.getParent());
        Files.writeString(file, body);
    }

    private static String key(Contribution contribution) {
        return contribution.key();
    }

    @Test
    void readsEachNameIntoTheContributionItStandsFor(@TempDir Path dir) throws Exception {
        write(dir, "bootstrap.json", "{}");
        write(dir, "bootstrap.acme.json", "{}");
        write(dir, "manifest.json", "{}");
        write(dir, "manifest.Acme.json", "{}");
        write(dir, "layouts/Contract/view.layout.json", "{}");
        write(dir, "assets/acme-logo.svg", "<svg/>");

        List<String> keys = at(dir).scan().contributions().stream().map(DevOverridesTest::key).sorted().toList();

        assertEquals(List.of("asset acme-logo.svg", "fragment bootstrap/acme", "fragment bootstrap/dev",
                // The case of the name comes from the file, because that is what a package would
                // have to match to replace it.
                "fragment manifest/Acme", "fragment manifest/dev", "layout Contract/view"), keys);
    }

    /**
     * The unqualified names are {@code dev}, not {@code defaults}, so {@code bootstrap.json}
     * appends and wins rather than silently replacing our packaged fragment and dropping every
     * key it does not restate.
     */
    @Test
    void theUnqualifiedFragmentIsNamedDevSoItAppendsRatherThanReplacingTheDefaults(@TempDir Path dir)
            throws Exception {
        write(dir, "bootstrap.json", "{}");

        assertEquals("fragment bootstrap/dev", key(at(dir).scan().contributions().get(0)));
    }

    @Test
    void readsTheBodyOfAFragmentFromTheFile(@TempDir Path dir) throws Exception {
        write(dir, "bootstrap.json", "{\"branding\":{\"applicationTitle\":\"Edited\"}}");

        Contribution contribution = at(dir).scan().contributions().get(0);

        assertEquals("{\"branding\":{\"applicationTitle\":\"Edited\"}}",
                new String(contribution.content().read(), java.nio.charset.StandardCharsets.UTF_8));
    }

    /** Not packaged, so displacing one of our defaults is reported as a warning rather than as layering. */
    @Test
    void carriesProvenanceThatIsNotOurs(@TempDir Path dir) throws Exception {
        write(dir, "bootstrap.acme.json", "{}");

        Provenance provenance = at(dir).scan().contributions().get(0).provenance();

        assertEquals(DevOverrides.COMPONENT, provenance.component());
        assertEquals("bootstrap.acme.json", provenance.source());
        assertFalse(provenance.isPackaged());
    }

    /**
     * A name the directory does not read is reported, not passed over.
     *
     * Silence here is the failure mode that makes the whole feature look broken: a developer who
     * typed {@code bootsrap.json} reloads, sees nothing, and concludes the override directory
     * does not work.
     */
    @Test
    void reportsAFileWhoseNameItDoesNotRead(@TempDir Path dir) throws Exception {
        write(dir, "bootsrap.json", "{}");

        DevOverrides.Scan scan = at(dir).scan();

        assertEquals(List.of(), scan.contributions());
        assertEquals(1, scan.diagnostics().size());
        Diagnostic diagnostic = scan.diagnostics().get(0);
        assertEquals("dev-override-ignored", diagnostic.code());
        assertTrue(diagnostic.message().contains("bootsrap.json"), diagnostic.message());
    }

    @Test
    void reportsADirectoryThatDoesNotExist(@TempDir Path dir) {
        DevOverrides.Scan scan = at(dir.resolve("not-created")).scan();

        assertEquals(List.of(), scan.contributions());
        assertEquals("dev-override-absent", scan.diagnostics().get(0).code());
    }

    /* --------------------------------------------------------------------- the stamp */

    @Test
    void theStampIsStableWhileTheDirectoryIs(@TempDir Path dir) throws Exception {
        write(dir, "bootstrap.json", "{}");
        DevOverrides overrides = at(dir);

        assertEquals(overrides.scan().stamp(), overrides.scan().stamp());
    }

    @Test
    void theStampMovesWhenAFileIsEdited(@TempDir Path dir) throws Exception {
        write(dir, "bootstrap.json", "{\"a\":1}");
        DevOverrides overrides = at(dir);
        String before = overrides.scan().stamp();

        write(dir, "bootstrap.json", "{\"a\":1,\"b\":2}");

        assertNotEquals(before, overrides.scan().stamp());
    }

    @Test
    void theStampMovesWhenAFileIsRemoved(@TempDir Path dir) throws Exception {
        write(dir, "bootstrap.json", "{}");
        write(dir, "manifest.json", "{}");
        DevOverrides overrides = at(dir);
        String before = overrides.scan().stamp();

        Files.delete(dir.resolve("manifest.json"));

        assertNotEquals(before, overrides.scan().stamp());
    }
}
