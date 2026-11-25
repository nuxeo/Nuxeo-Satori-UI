package org.nuxeo.agentic.config;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The app registry's responses: which apps a person may see, and each one's files.
 *
 * Served after sign-in, by group (decision E, as the decision log proposes it; tenants are phase
 * 9). {@code apps.json} lists the apps whose {@code app.json} names a group the person is in, and
 * {@code apps/<id>/<path>} serves each file of one of them, as the package wrote it, with no
 * envelope, as the development server serves {@code home.json}. Anything else, an app the person
 * may not see included, is 404, as a file a package does not have is.
 *
 * <b>Seeing an app is not a security control.</b> The groups decide which apps the shell offers a
 * person, so that a claims adjuster is not shown the payroll app. They do not decide what anyone
 * may read: an app definition holds no record, and the records its queues, homes and pages show
 * are read through Nuxeo, whose permissions decide. A person who is shown no app can still read,
 * through the REST API, every record they have the right to.
 *
 * The listing is rendered for each request, since it differs from person to person; each file's
 * body and ETag are fixed when this is built, as {@link ConfigEndpoint}'s are. Every answer this
 * gives, a 404 included, is {@code private}: a shared cache must not hand one person's list to
 * another. The servlet's own 401 is {@code no-store}, and its 405 carries no body.
 *
 * <b>An app's {@code actions.json}</b> is served with only the actions this server's allow-list lets
 * run ({@link AppActions}), and what it leaves out is in the listing's diagnostics, as the app's.
 * The actions it serves that run an operation are the only ones {@code AgenticUi.RunAction} runs
 * ({@link #action}), each checked again when it does ({@link AppActionRunner}). So this is built
 * for one snapshot and one allow-list, and {@link #current} builds another when either changes.
 */
final class AppRegistryEndpoint {

    private static final Logger log = LogManager.getLogger(AppRegistryEndpoint.class);

    static final String APPS_PATH = "/apps.json";

    static final String APP_PREFIX = "/apps/";

    static final String APP_FILE = "app.json";

    static final String CACHE_CONTROL = "private, no-cache";

    /**
     * Who is asking: their name, every group Nuxeo counts them in (nested and virtual ones, such as
     * {@code members}, included) and whether they administer the server.
     */
    record Viewer(String name, Set<String> groups, boolean administrator) {

        Viewer {
            groups = Set.copyOf(groups);
        }
    }

    record Response(int status, Map<String, String> headers, byte[] body) {
    }

    private record Resource(byte[] body, String etag) {
    }

    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;

    private final ConfigSnapshot snapshot;

    private final AllowList allowList;

    /** Each app's files by path, {@code app.json} first, rendered once. */
    private final Map<String, Map<String, Resource>> files = new HashMap<>();

    /** Each app's served actions that run an operation, by app, then by action id. */
    private final Map<String, Map<String, RunnableAction>> runnable = new HashMap<>();

    /** The snapshot's diagnostics, then what serving each app's {@code actions.json} left out. */
    private final List<Diagnostic> diagnostics;

    /** The last one {@link #current} built, which the servlet and the run share. */
    private static volatile AppRegistryEndpoint current;

    /** With no allow-list: every action that runs an operation is left out. */
    AppRegistryEndpoint(ConfigSnapshot snapshot) {
        this(snapshot, AllowList.EMPTY);
    }

    AppRegistryEndpoint(ConfigSnapshot snapshot, AllowList allowList) {
        this.snapshot = snapshot;
        this.allowList = allowList;
        List<Diagnostic> all = new ArrayList<>(snapshot.diagnostics());
        for (ConfigSnapshot.App app : snapshot.apps()) {
            Map<String, Resource> byPath = new LinkedHashMap<>();
            byPath.put(APP_FILE, resource(app.appBytes()));
            for (ConfigSnapshot.AppFile file : app.files().values()) {
                if (AppActions.FILE.equals(file.path())) {
                    AppActions.Served served = AppActions.serve(app.id(), new Provenance(
                            app.provenance().component(), app.provenance().bundle(), file.source()), file.bytes(),
                            allowList);
                    byPath.put(file.path(), resource(served.bytes()));
                    runnable.put(app.id(), served.runnable());
                    all.addAll(served.diagnostics());
                } else {
                    byPath.put(file.path(), resource(file.bytes()));
                }
            }
            files.put(app.id(), byPath);
        }
        this.diagnostics = List.copyOf(all);
    }

    /**
     * The registry for this snapshot and allow-list: the one last built when neither has changed
     * since, so that file bodies and ETags change only when one does; otherwise a new one, whose
     * actions' diagnostics are logged once, as the snapshot's are when it is built.
     */
    static AppRegistryEndpoint current(ConfigSnapshot snapshot, AllowList allowList) {
        AppRegistryEndpoint built = current;
        if (built == null || built.snapshot != snapshot || built.allowList != allowList) {
            synchronized (AppRegistryEndpoint.class) {
                built = current;
                if (built == null || built.snapshot != snapshot || built.allowList != allowList) {
                    built = new AppRegistryEndpoint(snapshot, allowList);
                    for (Diagnostic diagnostic : built.diagnostics.subList(snapshot.diagnostics().size(),
                            built.diagnostics.size())) {
                        log.warn("Agentic UI app registry: {}", diagnostic.message());
                    }
                    current = built;
                }
            }
        }
        return built;
    }

    ConfigSnapshot snapshot() {
        return snapshot;
    }

    AllowList allowList() {
        return allowList;
    }

    /**
     * An action of an app that runs an operation, as this registry serves it, or {@code null}: when
     * there is no such app, the person may not see it, its {@code actions.json} does not serve the
     * action, or the action runs no operation. Each is the same answer, as a 404 is for a file.
     */
    RunnableAction action(String app, String id, Viewer viewer) {
        ConfigSnapshot.App found = app == null ? null : find(app);
        if (found == null || !mayView(found, viewer)) {
            return null;
        }
        Map<String, RunnableAction> actions = runnable.get(app);
        return actions == null || id == null ? null : actions.get(id);
    }

    static boolean mayView(ConfigSnapshot.App app, Viewer viewer) {
        for (String group : app.groups()) {
            if (viewer.groups().contains(group)) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param path the path below {@code /agentic-ui-apps}, as the servlet container decoded it
     * @param viewer the person signed in
     * @param ifNoneMatch the request's {@code If-None-Match} header, or {@code null}
     */
    Response respond(String path, Viewer viewer, String ifNoneMatch) {
        if (APPS_PATH.equals(path)) {
            return answer(resource(render(listing(viewer))), ifNoneMatch);
        }
        if (path != null && path.startsWith(APP_PREFIX)) {
            String rest = path.substring(APP_PREFIX.length());
            int slash = rest.indexOf('/');
            if (slash > 0) {
                String id = rest.substring(0, slash);
                ConfigSnapshot.App app = find(id);
                Map<String, Resource> byPath = files.get(id);
                if (app != null && byPath != null && mayView(app, viewer)) {
                    Resource file = byPath.get(rest.substring(slash + 1));
                    if (file != null) {
                        return answer(file, ifNoneMatch);
                    }
                }
            }
        }
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Cache-Control", CACHE_CONTROL);
        headers.put("X-Content-Type-Options", "nosniff");
        return new Response(404, headers, new byte[0]);
    }

    private ConfigSnapshot.App find(String id) {
        for (ConfigSnapshot.App app : snapshot.apps()) {
            if (app.id().equals(id)) {
                return app;
            }
        }
        return null;
    }

    /** The apps this person may see, in contribution order, and what the registry has to say about them. */
    ObjectNode listing(Viewer viewer) {
        ObjectNode listing = NODES.objectNode().put("format", ConfigEndpoint.FORMAT).put("layer", ConfigScope.APPS);
        ArrayNode apps = listing.putArray("apps");
        Set<String> visible = new HashSet<>();
        Map<String, Provenance> inForce = new HashMap<>();
        for (ConfigSnapshot.App app : snapshot.apps()) {
            if (!mayView(app, viewer)) {
                continue;
            }
            visible.add(app.id());
            inForce.put(app.id(), app.provenance());
            ObjectNode entry = apps.addObject().put("id", app.id()).put("url", "apps/" + app.id() + "/");
            entry.put("component", app.provenance().component());
            entry.put("bundle", app.provenance().bundle());
            entry.put("source", app.provenance().source());
            ArrayNode paths = entry.putArray("files");
            files.get(app.id()).keySet().forEach(paths::add);
            entry.set("content", app.app());
        }
        listing.set("diagnostics", diagnostics(diagnostics, inForce, viewer.administrator()));
        return listing;
    }

    /**
     * The registry's diagnostics this person may read: those about the version in force of an app
     * they may see, and every one to an administrator, who is the person who can act on them. An
     * app's diagnostics name its files and its groups, and a refused app's name an app nobody is
     * shown. So does a version that another package's has since replaced, which may have been for
     * other groups: only what the contribution in force said, from its own component and bundle,
     * is shown with it.
     *
     * @param inForce the provenance of each app the person may see, by its id
     */
    private static ArrayNode diagnostics(List<Diagnostic> diagnostics, Map<String, Provenance> inForce,
            boolean administrator) {
        ArrayNode list = NODES.arrayNode();
        for (Diagnostic diagnostic : diagnostics) {
            if (!ConfigScope.isAppScope(diagnostic.scope())) {
                continue;
            }
            String app = ConfigScope.appOf(diagnostic.scope());
            if (!administrator && !aboutTheVersionInForce(diagnostic, inForce.get(app))) {
                continue;
            }
            ObjectNode entry = list.addObject()
                                   .put("level", diagnostic.level().label())
                                   .put("code", diagnostic.code())
                                   .put("message", diagnostic.message());
            if (app != null) {
                entry.put("app", app);
            }
            entry.put("component", diagnostic.provenance().component());
            entry.put("bundle", diagnostic.provenance().bundle());
            entry.put("source", diagnostic.provenance().source());
        }
        return list;
    }

    /** Whether a diagnostic is the contribution in force's, by the component and bundle it came from. */
    private static boolean aboutTheVersionInForce(Diagnostic diagnostic, Provenance inForce) {
        return inForce != null && inForce.component().equals(diagnostic.provenance().component())
                && inForce.bundle().equals(diagnostic.provenance().bundle());
    }

    private static Response answer(Resource resource, String ifNoneMatch) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("ETag", resource.etag());
        headers.put("Cache-Control", CACHE_CONTROL);
        headers.put("Vary", "Cookie, Authorization");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy", ConfigEndpoint.CONTENT_SECURITY_POLICY);
        if (ConfigEndpoint.matches(ifNoneMatch, resource.etag())) {
            return new Response(304, headers, new byte[0]);
        }
        headers.put("Content-Type", ConfigEndpoint.JSON_TYPE);
        return new Response(200, headers, resource.body());
    }

    private static Resource resource(byte[] body) {
        return new Resource(body, ConfigEndpoint.etag(body));
    }

    private static byte[] render(ObjectNode node) {
        try {
            return ConfigSnapshot.JSON.writer(SerializationFeature.INDENT_OUTPUT)
                                      .writeValueAsString(node)
                                      .getBytes(StandardCharsets.UTF_8);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("cannot render the app registry", e);
        }
    }
}
