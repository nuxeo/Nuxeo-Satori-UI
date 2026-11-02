package org.nuxeo.agentic.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.function.UnaryOperator;
import java.util.stream.Stream;

/**
 * A directory on the server whose fragments are appended after every package's, re-read on each
 * request, so changing a configuration value costs a file write rather than a package rebuild, a
 * version bump, a reinstall and a restart.
 *
 * <h2>Why this exists at all</h2>
 *
 * The packaged configuration ships inside a bundle JAR and the snapshot is built once in
 * {@link AgenticUiConfigComponent#start}, so a one-character change to a label costs two to four
 * minutes and a restart that drops every session on a shared demo box. The servlet is not the
 * cause and moving the bytes out of Java would not fix it: what makes it slow is that the JSON is
 * inside a JAR, read once. A directory read per request has the same instant loop and gives up
 * none of the extension-point semantics (NXSAT-312 round 3, plan item H1).
 *
 * <h2>Off unless it is switched on, and unreachable when it is off</h2>
 *
 * {@link #ifEnabled} returns {@code null} unless {@value #ENABLED_PROPERTY} is set to {@code true}.
 * The component holds that {@code null} and never calls anything here, so on a server that has not
 * set the property **no path is built, no directory is stat-ed and no file is read**: the
 * production code path is the one that was there before this class existed. That is the property
 * {@code checkDevConfigOverrideIsNotProductionReachable} guards and
 * {@code AgenticUiConfigComponentTest} asserts by putting a fragment in the directory and showing
 * the response unchanged.
 *
 * Two properties rather than one, with the boolean as the switch: the enabling token is then a
 * single string independent of any path value, which is what a guardrail can grep a deployment
 * for. Setting only {@value #DIRECTORY_PROPERTY} does nothing.
 *
 * <h2>What it does not change</h2>
 *
 * Overrides are {@link ContributionRegistry#resolve(List, List) appended to the registry}, not
 * served around it. They are therefore subject to the same contract as a packaged contribution,
 * which is the point — an override that skipped validation would be worse than the restart:
 *
 * <ul>
 * <li>ordering: appended last, so they win, exactly as a package that {@code <require>}s every
 * other one would;
 * <li>replacement in place: a file named after a packaged fragment takes that fragment's position
 * rather than jumping to the end, and is reported as a replacement — a {@code warning}, since an
 * override is not packaged, so displacing one of our defaults is visible;
 * <li>per-contribution validation: a malformed override is rejected and reported and the packaged
 * fragment stays in force, because {@link ConfigSnapshot#load} is what reads the body;
 * <li>provenance: every fragment carries the file it was read from;
 * <li>the asset CSP: an overriding image is served by {@link ConfigEndpoint} like any other, so it
 * keeps {@code default-src 'none'; style-src 'unsafe-inline'; sandbox}.
 * </ul>
 *
 * <h2>Layout of the directory</h2>
 *
 * The same shape as {@code agentic-ui-config/} inside a configuration package's bundle, so a
 * developer copies a file across rather than learning a second layout:
 *
 * <pre>
 *   bootstrap.json                      fragment, layer bootstrap, name "dev"
 *   bootstrap.&lt;name&gt;.json               fragment, layer bootstrap, name &lt;name&gt;
 *   manifest.json                       fragment, layer manifest, name "dev"
 *   manifest.&lt;name&gt;.json                fragment, layer manifest, name &lt;name&gt;
 *   layouts/&lt;Type&gt;/&lt;mode&gt;.layout.json    layout for that type and mode
 *   assets/&lt;file&gt;                       image asset
 * </pre>
 *
 * The unqualified names are {@code dev} rather than {@code defaults} on purpose: {@code dev} is a
 * name no package uses, so {@code bootstrap.json} appends and wins on the keys it sets, while
 * {@code bootstrap.defaults.json} deliberately replaces our packaged fragment in place and loses
 * every key it does not restate. Both are useful and they are very different, so neither is the
 * accidental one.
 *
 * Anything else in the directory is reported as ignored rather than passed over, because a
 * developer who wrote {@code bootsrap.json} would otherwise be told nothing at all and conclude
 * the whole mechanism is broken.
 */
final class DevOverrides {

    /**
     * The switch. Nothing here runs unless this is {@code true} — {@link Boolean#parseBoolean}, so
     * only a case-insensitive {@code "true"} counts and every other value, {@code 1} included,
     * leaves the overrides off.
     */
    static final String ENABLED_PROPERTY = "nuxeo.agentic.ui.config.dev";

    /** Where to read, when the default is not where the developer wants it. */
    static final String DIRECTORY_PROPERTY = "nuxeo.agentic.ui.config.dev.dir";

    static final String DATA_DIR_PROPERTY = "nuxeo.data.dir";

    static final String DEFAULT_DIRECTORY_NAME = "agentic-ui-config-dev";

    /** The component name overrides are reported under, so provenance names the mechanism. */
    static final String COMPONENT = "org.nuxeo.agentic.ui.config.dev";

    /**
     * Not a bundle and deliberately not spellable as one. {@link Provenance#isPackaged} compares
     * the bundle against ours, so this value is also what makes an override that displaces a
     * packaged default report as a {@code warning} rather than as ordinary layering.
     */
    static final String BUNDLE = "dev-override-directory";

    private static final String LAYOUT_SUFFIX = ".layout.json";

    /** Deep enough for {@code layouts/<Type>/<mode>.layout.json} and no deeper. */
    private static final int MAX_DEPTH = 3;

    private final Path directory;

    private DevOverrides(Path directory) {
        this.directory = directory;
    }

    /**
     * The overrides to consult, or {@code null} when the server has not switched them on.
     *
     * @param properties the runtime's property lookup, passed in rather than read from
     *            {@code Framework} so the unset case — the production one — is testable without a
     *            running Nuxeo. The negative case is the one that must not rot.
     */
    static DevOverrides ifEnabled(UnaryOperator<String> properties) {
        if (!Boolean.parseBoolean(trimmed(properties.apply(ENABLED_PROPERTY)))) {
            return null;
        }
        String configured = trimmed(properties.apply(DIRECTORY_PROPERTY));
        if (!configured.isEmpty()) {
            return new DevOverrides(Path.of(configured));
        }
        String data = trimmed(properties.apply(DATA_DIR_PROPERTY));
        // No data directory to hang the default off: the switch is on and there is nowhere to
        // read, which is a misconfiguration to report rather than a directory to invent under the
        // working directory, wherever the server happens to have been started from.
        return data.isEmpty() ? null : new DevOverrides(Path.of(data, DEFAULT_DIRECTORY_NAME));
    }

    Path directory() {
        return directory;
    }

    /**
     * What the directory holds right now.
     *
     * @param stamp identifies the directory's state, so the component can reuse the snapshot it
     *            built — and with it the rendered bodies and their ETags — while nothing has
     *            changed. Built from each file's path, size and modification time, which is what
     *            keeps the per-request cost to one directory walk: no body is read until the stamp
     *            says one has changed. Known residue, stated rather than guarded: a filesystem
     *            with whole-second timestamps cannot distinguish two edits inside one second that
     *            leave the size identical. APFS, ext4 and NTFS all keep sub-second times, so this
     *            is FAT and some NFS mounts; touching the file moves it on.
     */
    record Scan(String stamp, List<Contribution> contributions, List<Diagnostic> diagnostics) {
    }

    Scan scan() {
        List<Contribution> contributions = new ArrayList<>();
        List<Diagnostic> diagnostics = new ArrayList<>();
        StringBuilder stamp = new StringBuilder();

        if (!Files.isDirectory(directory)) {
            // Not an error: switching the overrides on before creating the directory is an
            // ordinary order to do things in, and the next scan picks it up. Reported so that a
            // developer who created it somewhere else is told where we are looking.
            diagnostics.add(Diagnostic.info("dev-override-absent", ConfigScope.BOOTSTRAP, provenance(""),
                    String.format("The development override directory %s does not exist; nothing is overridden.",
                            directory)));
            return new Scan("absent", List.copyOf(contributions), List.copyOf(diagnostics));
        }

        List<Path> files;
        try (Stream<Path> walk = Files.walk(directory, MAX_DEPTH)) {
            files = walk.filter(path -> Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS))
                        .sorted(Comparator.comparing(Path::toString))
                        .toList();
        } catch (IOException | RuntimeException e) {
            diagnostics.add(Diagnostic.error("dev-override-unreadable", ConfigScope.BOOTSTRAP, provenance(""),
                    String.format("The development override directory %s could not be read: %s; "
                            + "the packaged configuration is unchanged.", directory, e)));
            // A stamp of its own, so a directory that becomes readable again is picked up rather
            // than mistaken for the state the last good scan left behind.
            return new Scan("unreadable:" + e, List.copyOf(contributions), List.copyOf(diagnostics));
        }

        for (Path file : files) {
            String relative = relative(file);
            stamp.append(relative).append('\u0000').append(size(file)).append('\u0000').append(modified(file))
                 .append('\n');
            Contribution contribution = contribution(relative, file);
            if (contribution == null) {
                diagnostics.add(Diagnostic.info("dev-override-ignored", ConfigScope.BOOTSTRAP, provenance(relative),
                        String.format("%s in the development override directory is not a name this directory reads: "
                                + "use bootstrap[.<name>].json, manifest[.<name>].json, "
                                + "layouts/<Type>/<mode>.layout.json or assets/<file>.", relative)));
                continue;
            }
            contributions.add(contribution);
        }
        return new Scan(stamp.toString(), List.copyOf(contributions), List.copyOf(diagnostics));
    }

    /**
     * The contribution a file makes, or {@code null} when its name is not one this directory
     * reads.
     *
     * Nothing is validated here beyond the shape of the name, on purpose: whether the layer, the
     * fragment name, the layout type and mode or the asset name are acceptable is
     * {@link ContributionRegistry#validate}'s to say, and asking it twice is how the two answers
     * come to differ.
     */
    private Contribution contribution(String relative, Path file) {
        Contribution.Content content = () -> Files.readAllBytes(file);

        String assetName = after(relative, "assets/");
        if (assetName != null) {
            return assetName.contains("/") ? null
                    : Contribution.asset(assetName, true, provenance(relative), content, file);
        }

        String layoutPath = after(relative, "layouts/");
        if (layoutPath != null) {
            int slash = layoutPath.indexOf('/');
            if (slash <= 0 || !layoutPath.endsWith(LAYOUT_SUFFIX)) {
                return null;
            }
            String type = layoutPath.substring(0, slash);
            String mode = layoutPath.substring(slash + 1, layoutPath.length() - LAYOUT_SUFFIX.length());
            return mode.contains("/") ? null
                    : Contribution.layout(type, mode, true, provenance(relative), content, file);
        }

        if (relative.contains("/")) {
            return null;
        }
        for (String layer : new String[] { ConfigScope.BOOTSTRAP, ConfigScope.MANIFEST }) {
            String name = fragmentName(relative, layer);
            if (name != null) {
                return Contribution.fragment(layer, name, true, provenance(relative), content, file);
            }
        }
        return null;
    }

    /**
     * The fragment name {@code <layer>.json} or {@code <layer>.<name>.json} carries, or
     * {@code null} when the file does not name this layer.
     */
    private static String fragmentName(String fileName, String layer) {
        String lower = fileName.toLowerCase(Locale.ROOT);
        if (lower.equals(layer + ".json")) {
            return "dev";
        }
        if (!lower.startsWith(layer + ".") || !lower.endsWith(".json")) {
            return null;
        }
        // Case comes from the file, not from the lower-cased comparison: `bootstrap.Acme.json`
        // contributes `Acme`, which is the name a package would have to match to replace it.
        return fileName.substring(layer.length() + 1, fileName.length() - ".json".length());
    }

    private static String after(String relative, String prefix) {
        return relative.startsWith(prefix) ? relative.substring(prefix.length()) : null;
    }

    private String relative(Path file) {
        // Separator-normalised, so the names above mean the same thing on Windows as on Linux and
        // the stamp does not change with the platform.
        return directory.relativize(file).toString().replace('\\', '/');
    }

    private Provenance provenance(String relative) {
        return new Provenance(COMPONENT, BUNDLE, relative.isEmpty() ? directory.toString() : relative);
    }

    private static long size(Path file) {
        try {
            return Files.size(file);
        } catch (IOException e) {
            return -1;
        }
    }

    private static String modified(Path file) {
        try {
            // The instant rather than the millisecond count, so the stamp carries whatever
            // precision the filesystem actually keeps.
            return Files.getLastModifiedTime(file).toInstant().toString();
        } catch (IOException e) {
            return "unknown";
        }
    }

    private static String trimmed(String value) {
        return value == null ? "" : value.trim();
    }
}
