package org.nuxeo.agentic.config;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The configuration in force, read and parsed once.
 *
 * Built when the component starts, after every package's contributions are registered, so the
 * content can only change with an install and a restart. A fragment that cannot be read or does
 * not parse is left out and reported; the others still apply, because one customer's typo must not
 * take every other package's configuration down with it.
 */
public final class ConfigSnapshot {

    static final int MAX_JSON_BYTES = 1024 * 1024;

    static final int MAX_ASSET_BYTES = 2 * 1024 * 1024;

    static final ObjectMapper JSON = new ObjectMapper().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
                                                       .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    record Fragment(String layer, String name, Provenance provenance, JsonNode content) {
    }

    record Layout(String type, String mode, Provenance provenance, JsonNode content) {
    }

    record Asset(String name, Provenance provenance, byte[] bytes, String contentType) {
    }

    /**
     * An app's definition, read whole: its {@code app.json} and the files it names, each as the
     * package wrote it.
     *
     * @param groups the groups {@code app.json} says the app is for, which the registry serves it to
     * @param files every file but {@code app.json}, by its path below the app's root, in the order
     *            the contribution names them
     */
    record App(String id, Provenance provenance, JsonNode app, byte[] appBytes, Set<String> groups,
            Map<String, AppFile> files) {

        App {
            groups = Set.copyOf(groups);
            files = java.util.Collections.unmodifiableMap(new LinkedHashMap<>(files));
        }
    }

    /** One file of an app: its bytes as packaged, and the path in its bundle it was read from. */
    record AppFile(String path, String source, byte[] bytes) {
    }

    /**
     * The files an app may name besides its {@code app.json}, each at the place that says what it is
     * (docs/business-apps/app-definition-v2.md, section 1), with the names the validator gives each
     * one: a queue's id, a language, a workflow and its step.
     */
    static final List<Pattern> APP_FILES = List.of(Pattern.compile("home\\.json"),
            Pattern.compile("navigation\\.json"), Pattern.compile("actions\\.json"),
            Pattern.compile("queues/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\\.json"),
            Pattern.compile("labels/[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\\.json"),
            Pattern.compile("tasks/[A-Za-z][A-Za-z0-9_-]{0,127}\\.[A-Za-z][A-Za-z0-9_-]{0,127}\\.layout\\.json"));

    static boolean isAppFile(String path) {
        return path != null && APP_FILES.stream().anyMatch(pattern -> pattern.matcher(path).matches());
    }

    private final List<Fragment> fragments;

    private final List<Layout> layouts;

    private final List<Asset> assets;

    private final List<App> apps;

    private final List<Diagnostic> diagnostics;

    /** When it was built, which is when the server logged its diagnostics. */
    private final java.time.Instant builtAt = java.time.Instant.now();

    private ConfigSnapshot(List<Fragment> fragments, List<Layout> layouts, List<Asset> assets, List<App> apps,
            List<Diagnostic> diagnostics) {
        this.fragments = List.copyOf(fragments);
        this.layouts = List.copyOf(layouts);
        this.assets = List.copyOf(assets);
        this.apps = List.copyOf(apps);
        this.diagnostics = List.copyOf(diagnostics);
    }

    /** When it was built: the server logs every one of its {@link #diagnostics} then, once. */
    java.time.Instant builtAt() {
        return builtAt;
    }

    /** Fragments of one layer, in the order the browser applies them. */
    List<Fragment> fragments(String layer) {
        return fragments.stream().filter(fragment -> fragment.layer().equals(layer)).toList();
    }

    List<Layout> layouts() {
        return layouts;
    }

    List<Asset> assets() {
        return assets;
    }

    /**
     * The apps in force, in contribution order. Served by the app registry alone, after sign-in:
     * {@link ConfigEndpoint}, which everyone reads before sign-in, never reads them.
     */
    List<App> apps() {
        return apps;
    }

    List<Diagnostic> diagnostics() {
        return diagnostics;
    }

    /**
     * A contribution whose body was read and checked: {@code json} for a fragment or layout, and
     * {@code app} for an app.
     */
    record Loaded(Contribution contribution, byte[] bytes, JsonNode json, App app) {
    }

    static ConfigSnapshot build(ContributionRegistry.Resolution resolution) {
        List<Fragment> fragments = new ArrayList<>();
        List<Layout> layouts = new ArrayList<>();
        List<Asset> assets = new ArrayList<>();
        List<App> apps = new ArrayList<>();

        for (Loaded loaded : resolution.inForce()) {
            Contribution contribution = loaded.contribution();
            Provenance provenance = contribution.provenance();
            switch (contribution.kind()) {
            case ASSET -> assets.add(
                    new Asset(contribution.name(), provenance, loaded.bytes(), contentType(contribution.name())));
            case LAYOUT -> layouts.add(new Layout(contribution.type(), contribution.mode(), provenance, loaded.json()));
            case FRAGMENT -> fragments.add(
                    new Fragment(contribution.layer(), contribution.name(), provenance, loaded.json()));
            case APP -> apps.add(loaded.app());
            }
        }
        return new ConfigSnapshot(fragments, layouts, assets, apps, resolution.diagnostics());
    }

    /** Reads and checks a contribution's body, or reports why it cannot be used and returns {@code null}. */
    static Loaded load(Contribution contribution, List<Diagnostic> diagnostics) {
        if (contribution.kind() == Contribution.Kind.APP) {
            return loadApp(contribution, diagnostics);
        }
        Provenance provenance = contribution.provenance();
        int limit = contribution.kind() == Contribution.Kind.ASSET ? MAX_ASSET_BYTES : MAX_JSON_BYTES;
        byte[] bytes;
        try {
            bytes = contribution.content().read();
        } catch (IOException | RuntimeException e) {
            diagnostics.add(Diagnostic.error("unreadable", contribution.scope(), provenance,
                    String.format("%s could not be read from %s: %s", contribution.key(), provenance.source(),
                            e.getMessage())));
            return null;
        }
        if (bytes.length > limit) {
            diagnostics.add(Diagnostic.error("too-large", contribution.scope(), provenance,
                    String.format("%s is %d bytes; the limit is %d.", contribution.key(), bytes.length, limit)));
            return null;
        }
        if (contribution.kind() == Contribution.Kind.ASSET) {
            return new Loaded(contribution, bytes, null, null);
        }
        JsonNode content = parseObject(contribution.key(), contribution.scope(), provenance, bytes, diagnostics);
        return content == null ? null : new Loaded(contribution, bytes, content, null);
    }

    /**
     * Reads an app whole: its {@code app.json}, which must name the app the contribution names and
     * the groups it is for, and then each file it names, under the same limits as a fragment.
     *
     * {@code app.json} decides whether there is an app at all: one that cannot be read, is too large,
     * does not parse, names another app or names no groups refuses the app, and an app it would
     * have replaced stays in force. The registry cannot serve an app to its groups without knowing
     * them, and the shell refuses an app it cannot read whole.
     *
     * Any other file is left out on its own, and reported, as a layout is: a queue with a typo must
     * not take the app's home and menu down with it, and the app treats a file that is not served as
     * one the package does not have.
     */
    private static Loaded loadApp(Contribution contribution, List<Diagnostic> diagnostics) {
        Provenance provenance = contribution.provenance();
        String scope = contribution.scope();
        String key = contribution.key();
        byte[] bytes = read(key + " app.json", scope, provenance, contribution.content(), diagnostics);
        if (bytes == null) {
            return null;
        }
        JsonNode app = parseObject(key + " app.json", scope, provenance, bytes, diagnostics);
        if (app == null) {
            return null;
        }
        JsonNode id = app.get("id");
        if (id == null || !id.isTextual() || !id.asText().equals(contribution.name())) {
            diagnostics.add(Diagnostic.error("app-id-mismatch", scope, provenance,
                    String.format("%s: its app.json has the id %s, not \"%s\"; the app is refused.", key,
                            id == null ? "missing" : id.toString(), contribution.name())));
            return null;
        }
        Set<String> groups = groups(app.get("groups"));
        if (groups == null) {
            diagnostics.add(Diagnostic.error("app-groups", scope, provenance,
                    String.format("%s: its app.json names no groups, so the registry cannot say who it is for; "
                            + "the app is refused. \"members\" is everyone.", key)));
            return null;
        }

        Map<String, AppFile> files = new LinkedHashMap<>();
        for (String path : contribution.files()) {
            Provenance file = new Provenance(provenance.component(), provenance.bundle(),
                    path == null ? provenance.source() : contribution.reader().source(path));
            String name = key + " " + path;
            if (!isAppFile(path)) {
                diagnostics.add(Diagnostic.error("invalid-app-file", scope, file,
                        String.format("%s is not a place an app definition has a file: home.json, navigation.json, "
                                + "actions.json, queues/<id>.json, labels/<language>.json or "
                                + "tasks/<workflow>.<step>.layout.json. Left out.", name)));
                continue;
            }
            if (files.containsKey(path)) {
                diagnostics.add(Diagnostic.warning("duplicate-app-file", scope, file,
                        String.format("%s is named twice; the second is ignored.", name)));
                continue;
            }
            byte[] body = read(name, scope, file, contribution.reader().file(path), diagnostics);
            if (body == null || parseObject(name, scope, file, body, diagnostics) == null) {
                continue;
            }
            files.put(path, new AppFile(path, file.source(), body));
        }
        return new Loaded(contribution, bytes, app,
                new App(contribution.name(), provenance, app, bytes, groups, files));
    }

    /** {@code app.json}'s groups, or {@code null} when it names none, or one that is not a group's name. */
    private static Set<String> groups(JsonNode value) {
        if (value == null || !value.isArray() || value.isEmpty()) {
            return null;
        }
        Set<String> groups = new LinkedHashSet<>();
        for (JsonNode group : value) {
            if (!group.isTextual() || group.asText().isBlank() || !group.asText().equals(group.asText().strip())) {
                return null;
            }
            groups.add(group.asText());
        }
        return groups;
    }

    /** A JSON body read whole, or {@code null}, reported, when it cannot be or is over the limit. */
    private static byte[] read(String what, String scope, Provenance provenance, Contribution.Content content,
            List<Diagnostic> diagnostics) {
        byte[] bytes;
        try {
            bytes = content.read();
        } catch (IOException | RuntimeException e) {
            diagnostics.add(Diagnostic.error("unreadable", scope, provenance,
                    String.format("%s could not be read from %s: %s", what, provenance.source(), e.getMessage())));
            return null;
        }
        if (bytes.length > MAX_JSON_BYTES) {
            diagnostics.add(Diagnostic.error("too-large", scope, provenance,
                    String.format("%s is %d bytes; the limit is %d.", what, bytes.length, MAX_JSON_BYTES)));
            return null;
        }
        return bytes;
    }

    private static JsonNode parseObject(String what, String scope, Provenance provenance, byte[] bytes,
            List<Diagnostic> diagnostics) {
        JsonNode content;
        try {
            content = JSON.readTree(bytes);
        } catch (IOException e) {
            diagnostics.add(Diagnostic.error("invalid-json", scope, provenance,
                    String.format("%s is not valid JSON: %s", what,
                            e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage().lines()
                                                                                        .findFirst()
                                                                                        .orElse(""))));
            return null;
        }
        if (content == null || !content.isObject()) {
            diagnostics.add(Diagnostic.error("not-an-object", scope, provenance,
                    String.format("%s must be a JSON object.", what)));
            return null;
        }
        return content;
    }

    static String contentType(String assetName) {
        String extension = assetName.substring(assetName.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        return switch (extension) {
            case "svg" -> "image/svg+xml";
            case "png" -> "image/png";
            case "jpg", "jpeg" -> "image/jpeg";
            case "gif" -> "image/gif";
            case "webp" -> "image/webp";
            case "ico" -> "image/x-icon";
            default -> throw new IllegalArgumentException("not an accepted asset type: " + assetName);
        };
    }
}
