package org.nuxeo.agentic.config;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.TreeMap;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The diagnostics page's report, for administrators ({@link DiagnosticsEndpoint}): read only, and
 * built from what the server already holds, for each request.
 *
 * <ul>
 * <li><b>Versions:</b> the platform's, Nuxeo's product name and version; and the app's, the {@code
 * nuxeo-agentic-ui} package installed and this bundle's own build.</li>
 * <li><b>Packages:</b> each installed Marketplace package, its version, its state and whether it is
 * the app, a kit or another add-on ({@link InstalledPackages}). A package's signature is {@code
 * not-recorded}: Nuxeo LTS 2025 keeps none.</li>
 * <li><b>Checks:</b> what the apps depend on the server for, each by an id the page names: the
 * retention module, Template Rendering, the AI package, the deployment layer, the development
 * overrides and the operation allow-list. Ids and states only; the page says what each means.</li>
 * <li><b>Configuration:</b> the layers in force, server-wide, with where each came from: the
 * bootstrap and manifest fragments, in the order the browser applies them, and the layouts; and
 * for each app, its package's files and its deployment layer's live versions.</li>
 * <li><b>Diagnostics:</b> the configuration's errors and warnings the server logged when it built
 * the configuration in force, and when it served each app's actions, each cleaned by {@link
 * Redaction}; the information-level ones are counted, not listed.</li>
 * </ul>
 *
 * <b>Built to hold nothing personal and nothing secret.</b> The properties read for it are the
 * product's name and version, shown, the package manager's directory, not shown, and the switches,
 * shown as on or off; none is a credential. One property's value can still show: with the
 * development overrides on, their directory is in their own messages and as their files' source,
 * its owner cleaned. No person is named: not the administrator asking, not who changed the
 * deployment layer (its trail is not read), not an app's groups. A layer's files are listed by path
 * and version, not by content. Every message is cleaned ({@link Redaction#clean}); a package's name
 * and every version are held to their form ({@link Redaction#identifier}, {@link Redaction#version})
 * rather than cleaned, so that a build's timestamped version is shown whole, and are {@code null}
 * when they are not of it. The cleaning is a second line: the page asks for the text to be read
 * before it is sent.
 */
final class DiagnosticsReport {

    static final String FORMAT = "nuxeo-agentic-ui-diagnostics/1";

    /** At most this many diagnostics are listed; the rest are counted. */
    static final int MAX_DIAGNOSTICS = 200;

    /** A facet of Nuxeo's retention module, {@code nuxeo-retention}, which the records add-on reads. */
    static final String RETENTION_FACET = "RetentionRule";

    /** A facet of Nuxeo Template Rendering, {@code nuxeo-template-rendering}, which letters would use. */
    static final String TEMPLATE_FACET = "TemplateBased";

    /** The AI package's operations: the client calls {@code AI.*} only. */
    static final String AI_PREFIX = "AI.";

    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;

    private DiagnosticsReport() {
    }

    /**
     * @param diagnostics every diagnostic the server logged for the configuration in force: the
     *            snapshot's, then the registry's for each app's actions
     * @param developmentOverrides whether {@value DevOverrides#ENABLED_PROPERTY} is on
     */
    static ObjectNode build(ConfigSnapshot snapshot, List<Diagnostic> diagnostics, LayerService layer,
            boolean developmentOverrides, ServerProbe probe, Clock clock) {
        ObjectNode report = NODES.objectNode().put("format", FORMAT).put("generatedAt", Instant.now(clock).toString());

        ObjectNode platform = report.putObject("platform");
        platform.put("product", Redaction.version(probe.property(ServerProbe.PRODUCT_NAME_PROPERTY)));
        platform.put("version", Redaction.version(probe.property(ServerProbe.PRODUCT_VERSION_PROPERTY)));

        InstalledPackages.Listing listing = InstalledPackages.read(probe.packagesDirectory());
        ObjectNode app = report.putObject("app");
        app.put("package", InstalledPackages.PLATFORM_PACKAGE);
        app.put("version", listing.packages()
                                  .stream()
                                  .filter(entry -> "app".equals(entry.role()))
                                  .map(entry -> Redaction.version(entry.version()))
                                  .findFirst()
                                  .orElse(null));
        app.put("core", Redaction.version(probe.coreVersion()));

        ObjectNode packages = report.putObject("packages");
        packages.put("recorded", listing.recorded());
        packages.put("problem", listing.problem());
        ArrayNode entries = packages.putArray("entries");
        for (InstalledPackages.Entry entry : listing.packages()) {
            // Held to a name's and a version's form rather than cleaned: the token rule would take a
            // build's timestamped version, 2026.0.2-20261126114747-BUILD-local, for a key.
            entries.addObject()
                   .put("name", Redaction.identifier(entry.name()))
                   .put("version", Redaction.version(entry.version()))
                   .put("state", entry.state())
                   .put("role", entry.role())
                   .put("signature", entry.signature());
        }

        report.set("checks", checks(layer, developmentOverrides, probe));
        report.set("configuration", configuration(snapshot, developmentOverrides));
        report.set("apps", apps(snapshot, layer));
        diagnostics(report, diagnostics);
        return report;
    }

    private static ArrayNode checks(LayerService layer, boolean developmentOverrides, ServerProbe probe) {
        ArrayNode checks = NODES.arrayNode();
        checks.addObject()
              .put("id", "retention")
              .put("status", probe.hasFacet(RETENTION_FACET) ? "present" : "absent")
              .put("facet", RETENTION_FACET);
        checks.addObject()
              .put("id", "template-rendering")
              .put("status", probe.hasFacet(TEMPLATE_FACET) ? "present" : "absent")
              .put("facet", TEMPLATE_FACET);
        Set<String> operations = probe.operations();
        long ai = operations.stream().filter(id -> id.startsWith(AI_PREFIX)).count();
        checks.addObject().put("id", "ai").put("status", ai > 0 ? "present" : "absent").put("operations", ai);
        checks.addObject()
              .put("id", "deployment-layer")
              .put("status", layer.enabled() ? "on" : "off")
              .put("selfApproval", layer.enabled() && layer.settings().selfApproval());
        checks.addObject().put("id", "development-overrides").put("status", developmentOverrides ? "on" : "off");
        boolean intact = probe.allowListIntact();
        checks.addObject()
              .put("id", "operation-allow-list")
              .put("status", intact ? "intact" : "replaced")
              .put("operations", intact ? probe.allowListSize() : 0);
        return checks;
    }

    /** The server-wide layers, in the order the browser applies them, with where each came from. */
    private static ObjectNode configuration(ConfigSnapshot snapshot, boolean developmentOverrides) {
        ObjectNode configuration = NODES.objectNode();
        configuration.put("builtAt", snapshot.builtAt().toString());
        configuration.put("developmentOverrides", developmentOverrides);
        ArrayNode layers = configuration.putArray("layers");
        for (String name : List.of(ConfigScope.BOOTSTRAP, ConfigScope.MANIFEST)) {
            ObjectNode layer = layers.addObject().put("layer", name);
            ArrayNode fragments = layer.putArray("fragments");
            for (ConfigSnapshot.Fragment fragment : snapshot.fragments(name)) {
                provenance(fragments.addObject().put("name", Redaction.clean(fragment.name())), fragment.provenance());
            }
        }
        ObjectNode layouts = layers.addObject().put("layer", ConfigScope.LAYOUTS);
        ArrayNode list = layouts.putArray("layouts");
        for (ConfigSnapshot.Layout layout : snapshot.layouts()) {
            provenance(list.addObject()
                           .put("type", Redaction.clean(layout.type()))
                           .put("mode", Redaction.clean(layout.mode())),
                    layout.provenance());
        }
        return configuration;
    }

    /** Each app: what its package and the app definition say of it, and the layers it is served from. */
    private static ArrayNode apps(ConfigSnapshot snapshot, LayerService layer) {
        ArrayNode apps = NODES.arrayNode();
        LayerService.Live live = layer.live();
        for (ConfigSnapshot.App app : snapshot.apps()) {
            ObjectNode entry = apps.addObject().put("id", app.id());
            entry.put("packageVersion", textOf(app.app(), "packageVersion"));
            entry.put("platform", textOf(app.app(), "platform"));
            ArrayNode layers = entry.putArray("layers");
            ObjectNode packaged = provenance(layers.addObject().put("layer", "package"), app.provenance());
            ArrayNode files = packaged.putArray("files");
            files.add(AppRegistryEndpoint.APP_FILE);
            app.files().keySet().forEach(path -> files.add(Redaction.clean(path)));
            ObjectNode deployment = layers.addObject().put("layer", "deployment").put("enabled", layer.enabled());
            ArrayNode overrides = deployment.putArray("files");
            new TreeMap<>(live.of(app.id())).forEach(
                    (path, file) -> overrides.addObject().put("path", Redaction.clean(path)).put("version", file.version()));
        }
        return apps;
    }

    /** Errors and warnings, listed, cleaned and capped; the information-level ones counted. */
    private static void diagnostics(ObjectNode report, List<Diagnostic> diagnostics) {
        ArrayNode list = report.putArray("diagnostics");
        int info = 0;
        int beyond = 0;
        for (Diagnostic diagnostic : diagnostics) {
            if (diagnostic.level() == Diagnostic.Level.INFO) {
                info++;
                continue;
            }
            if (list.size() == MAX_DIAGNOSTICS) {
                beyond++;
                continue;
            }
            ObjectNode entry = list.addObject()
                                   .put("level", diagnostic.level().label())
                                   .put("code", Redaction.clean(diagnostic.code()))
                                   .put("scope", Redaction.clean(diagnostic.scope()))
                                   .put("app", ConfigScope.appOf(diagnostic.scope()))
                                   .put("message", Redaction.clean(diagnostic.message()));
            provenance(entry, diagnostic.provenance());
        }
        report.putObject("diagnosticsOmitted").put("info", info).put("beyondLimit", beyond);
    }

    private static ObjectNode provenance(ObjectNode entry, Provenance provenance) {
        if (provenance == null) {
            return entry;
        }
        return entry.put("component", Redaction.clean(provenance.component()))
                    .put("bundle", Redaction.clean(provenance.bundle()))
                    .put("source", Redaction.clean(provenance.source()))
                    .put("packaged", provenance.isPackaged());
    }

    private static String textOf(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value != null && value.isTextual() ? Redaction.version(value.asText()) : null;
    }
}
