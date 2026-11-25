package org.nuxeo.agentic.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.Collections;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * An app's deployment layer: the customer's own changes to its layout files and queues, made in the
 * designer and kept in the repository, above the package's files and below nothing else of the
 * app's (docs/business-apps/app-definition-v2.md, section 10, "The deployment layer").
 *
 * <h2>What a change goes through</h2>
 * <ol>
 * <li><b>A draft</b> ({@code save}): an administrator writes the file. The server checks it with
 * the app definition's own validator, against its content model ({@link DeploymentValidator}), and
 * refuses it on any finding, whatever the client checked. A draft is the administrators' alone: the
 * registry never serves one.</li>
 * <li><b>Submitted</b> ({@code submit}) for approval.</li>
 * <li><b>Approved and published</b> ({@code approve}) by an administrator who neither wrote any of
 * the draft nor submitted it, unless {@link LayerSettings#selfApproval()} lets them. It is checked
 * again, against the model as it is then, and becomes a new version, live: the registry serves it
 * to the app's groups in place of the package's file.</li>
 * <li><b>Rolled back</b> ({@code rollback}): the live version is taken out. The version the last
 * approval replaced is made live again, as a new version that keeps its makers and approver and
 * names who put it back, once it passes the validator as it is now; or the package's file is put
 * back in force. Nothing else, and a rollback is never undone by another: after one, the next puts
 * the package's file back, and what a rollback took out goes live again only as a draft, approved.
 * Immediate, and by one administrator, so that a change can be withdrawn in an incident at once,
 * and one administrator cannot bring back what another withdrew.</li>
 * <li>A draft may be <b>discarded</b> ({@code discard}).</li>
 * </ol>
 * The last {@value #MAX_VERSIONS} versions of a file are kept, and the live one always.
 *
 * <h2>Who</h2>
 * Administrators alone, as Nuxeo counts them ({@code NuxeoPrincipal.isAdministrator}), read or
 * change a layer, its drafts and versions included; everyone else is answered 403, whatever the app.
 * Hiding the designer's buttons from anyone is not the control: this is.
 *
 * <h2>Concurrent changes</h2>
 * Each file has a revision, which every change names and every change raises. A change naming
 * another is refused, 409, with the file as it is now, so that an administrator never writes over a
 * change they have not seen. Changes to one app are made one at a time: on a server by a lock of
 * the service's, and across a cluster inside the cluster's lock for the app ({@link AppLock}). The
 * repository's change token refuses a write made on a read another write has since replaced; the
 * change is then applied again to the layer as that write left it, and refused if its file moved.
 *
 * <h2>Audit</h2>
 * Every change is a line in the file's trail, with who made it, when, and the version and content
 * digest it made, kept with the layer, and a line in the server's log.
 *
 * <h2>What is not touched</h2>
 * The configuration servlet, which everyone reads before sign-in, never reads a layer: its responses
 * are the packages' alone. The registry serves only live files, only to the app's groups
 * ({@link #live}).
 */
final class LayerService {

    private static final Logger log = LogManager.getLogger(LayerService.class);

    static final String FORMAT = "nuxeo-agentic-ui-layer/1";

    static final int MAX_VERSIONS = 50;

    /** The most files an app's layer holds. */
    static final int MAX_FILES = 500;

    /** The most an app's layer weighs, stored, its versions and trail included. */
    static final int MAX_LAYER_BYTES = 64 * 1024 * 1024;

    /** The most lines a file's trail keeps; the server's log keeps every one. */
    static final int MAX_TRAIL = 1000;

    /** How old the registry's copy of the live layer may be, for a change made on another server. */
    static final long REFRESH_MILLIS = 10_000;

    /** How many times a change is applied again after another server's write came first. */
    private static final int ATTEMPTS = 5;

    static final Set<String> ACTIONS = Set.of("save", "submit", "approve", "rollback", "discard");

    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;

    /** An answer: an HTTP status and its JSON body. */
    record Outcome(int status, ObjectNode body) {
    }

    /** One live file, as the registry serves it: its body and its version. */
    record LiveFile(byte[] body, int version) {
    }

    /**
     * The live files of every app, by app id and path, as the registry serves them. The same
     * instance until a change, so that the registry renders its answers once per change.
     */
    record Live(Map<String, Map<String, LiveFile>> apps, String stamp) {

        static final Live NONE = new Live(Map.of(), "");

        Map<String, LiveFile> of(String app) {
            return apps.getOrDefault(app, Map.of());
        }
    }

    /**
     * A layer switched off, with nothing behind it: what a server answers before the component has
     * started, or without it. Every address is 404 and the registry serves no live file.
     */
    static final LayerService SWITCHED_OFF = new LayerService(LayerSettings.OFF, null, null, () -> null,
            Clock.systemUTC(), AppLock.NONE);

    private final LayerSettings settings;

    private final LayerStore store;

    private final DeploymentValidator validator;

    private final Supplier<ConfigSnapshot> snapshot;

    private final Supplier<AllowList> allowList;

    private final Clock clock;

    private final AppLock appLock;

    /** Held by every change on this server, so that changes are made one at a time. */
    private final Object changing = new Object();

    /** Raised by every change written here, so that a read of the layer made meanwhile is not kept. */
    private final AtomicLong generation = new AtomicLong();

    private volatile Live live;

    /** The configuration {@link #live} was checked against. */
    private volatile ConfigSnapshot liveSnapshot;

    /** The allow-list {@link #live} was checked against. */
    private volatile AllowList liveAllowList;

    private volatile long liveReadAt;

    /** The key of the cluster's lock every change to any app's layer is made in. */
    static final String LOCK_KEY = "agentic-ui-layer";

    /**
     * Holds the changes to the layer, every app's, to one at a time across a cluster: the server's
     * is {@code ClusterService.runAtomically}, which runs the work at once on a server that is not
     * in one. Within a server, the service's own lock does. One lock for every app, so that the
     * first changes of two apps cannot make the repository's folder twice; changes are few.
     */
    interface AppLock {

        AppLock NONE = (key, work) -> work.run();

        void run(String key, Runnable work);
    }

    /** With no allow-list: a queue may name none of the app's actions that run an operation. */
    LayerService(LayerSettings settings, LayerStore store, DeploymentValidator validator,
            Supplier<ConfigSnapshot> snapshot, Clock clock, AppLock appLock) {
        this(settings, store, validator, snapshot, () -> AllowList.EMPTY, clock, appLock);
    }

    /**
     * @param allowList the operations this server lets run ({@code org.nuxeo.agentic.ui.operations}),
     *            as the registry serves an app's {@code actions.json} with it: a queue of the layer is
     *            checked against the actions served, so it can name an action that runs an operation
     *            only while the allow-list lets that operation run
     */
    LayerService(LayerSettings settings, LayerStore store, DeploymentValidator validator,
            Supplier<ConfigSnapshot> snapshot, Supplier<AllowList> allowList, Clock clock, AppLock appLock) {
        this.settings = settings;
        this.store = store;
        this.validator = validator;
        this.snapshot = snapshot;
        this.allowList = allowList;
        this.clock = clock;
        this.appLock = appLock;
    }

    boolean enabled() {
        return settings.enabled();
    }

    // --- What the registry serves ------------------------------------------------------------------

    /**
     * Every app's live files, for the registry: {@link Live#NONE} when the layer is switched off, so
     * that turning it off serves every package's file again. Drafts are never read into it.
     *
     * <ul>
     * <li><b>Read again</b> after a change made here, when the configuration in force changes, and at
     * most every {@value #REFRESH_MILLIS} ms for a change made on another server, which costs one
     * read of each app's stamp, not of its layer, when nothing changed.</li>
     * <li><b>Checked again:</b> each live file is held to the validator as it is when the layer is
     * read, with the app's {@code actions.json} in force, and one it finds anything in is not
     * served, and logged: the package's file shows. So a file is never served that the validator
     * has not passed against the configuration it is served with, whoever wrote the stored
     * layer.</li>
     * <li><b>A store that cannot be read</b> keeps what was read last, or none: the packages' files
     * are served rather than an error.</li>
     * </ul>
     */
    Live live() {
        if (!settings.enabled()) {
            return Live.NONE;
        }
        ConfigSnapshot in = snapshot.get();
        AllowList allowed = allowList.get();
        Live current = live;
        if (current != null && liveSnapshot == in && liveAllowList == allowed
                && clock.millis() - liveReadAt < REFRESH_MILLIS) {
            return current;
        }
        synchronized (this) {
            current = live;
            if (current != null && liveSnapshot == in && liveAllowList == allowed
                    && clock.millis() - liveReadAt < REFRESH_MILLIS) {
                return current;
            }
            long started = generation.get();
            Map<String, LayerStore.Stored> stored;
            try {
                if (current != null && liveSnapshot == in && liveAllowList == allowed
                        && current.stamp().equals(stampsOf(store.stamps()))) {
                    liveReadAt = clock.millis();
                    return current;
                }
                stored = store.readAll();
            } catch (RuntimeException e) {
                log.warn("Agentic UI deployment layer: the layer could not be read, so what was read last, or the "
                        + "packages' files, are served: {}", e.toString());
                // Asked again in ten seconds, whatever the configuration, not on every request.
                Live kept = current == null ? Live.NONE : current;
                live = kept;
                liveSnapshot = in;
                liveAllowList = allowed;
                liveReadAt = clock.millis();
                return kept;
            }
            Map<String, String> stamps = new TreeMap<>();
            stored.forEach((app, each) -> stamps.put(app, each.stamp()));
            Live built = build(in, allowed, stored, stampsOf(stamps));
            // A change made here while this was read leaves it unkept, so the next read sees it.
            if (generation.get() == started) {
                live = built;
                liveSnapshot = in;
                liveAllowList = allowed;
                liveReadAt = clock.millis();
            }
            return built;
        }
    }

    /**
     * The live files of every app the configuration in force has, each that the validator passes. A
     * file the validator could not check at all, as when the model could not be read, is left out
     * for now and checked again at the next read: the layer is then built with no stamp, which no
     * read matches.
     */
    private Live build(ConfigSnapshot in, AllowList allowed, Map<String, LayerStore.Stored> stored, String stamp) {
        boolean[] unchecked = { false };
        Map<String, Map<String, LiveFile>> apps = new LinkedHashMap<>();
        for (Map.Entry<String, LayerStore.Stored> entry : new TreeMap<>(stored).entrySet()) {
            String app = entry.getKey();
            ConfigSnapshot.App definition = appOf(in, app);
            ObjectNode layer = definition == null ? null : parse(app, entry.getValue());
            if (layer == null) {
                continue;
            }
            Map<String, LiveFile> files = new LinkedHashMap<>();
            layer.path("files").fields().forEachRemaining(file -> {
                String path = file.getKey();
                JsonNode version = versionOf(file.getValue(), file.getValue().path("live").asInt(0));
                if (!LayerPaths.isLayerPath(path) || version == null || !version.path("content").isObject()) {
                    return;
                }
                DeploymentValidator.Answer answer = validator.validate(path, version.get("content"), definition.app(),
                        actionsOf(definition, allowed));
                if (!answer.passes()) {
                    unchecked[0] |= answer.refused() != null;
                    log.error("Agentic UI deployment layer: {}/{} version {} is not served, and the package's file is: {}",
                            app, path, version.path("version").asInt(),
                            answer.refused() != null ? answer.refused()
                                    : answer.findings().size() + " finding(s) of the validator");
                    return;
                }
                files.put(path, new LiveFile(render(version.get("content")), version.path("version").asInt()));
            });
            if (!files.isEmpty()) {
                apps.put(app, Collections.unmodifiableMap(files));
            }
        }
        return new Live(Collections.unmodifiableMap(apps), unchecked[0] ? "" : stamp);
    }

    private static String stampsOf(Map<String, String> stamps) {
        StringBuilder text = new StringBuilder();
        new TreeMap<>(stamps).forEach((app, stamp) -> text.append(app).append('=').append(stamp).append(';'));
        return text.toString();
    }

    // --- What administrators read ------------------------------------------------------------------

    /** Every app's overrides in force, by path, with their versions: what the upgrade check reads. */
    Outcome export(AppRegistryEndpoint.Viewer viewer) {
        Outcome refused = refusal(viewer, null, null);
        if (refused != null) {
            return refused;
        }
        ObjectNode body = NODES.objectNode().put("format", FORMAT);
        ArrayNode apps = body.putArray("apps");
        Map<String, LayerStore.Stored> stored;
        try {
            stored = store.readAll();
        } catch (RuntimeException e) {
            log.error("Agentic UI deployment layer: the layer could not be read", e);
            return error(500, "unreadable", "The deployment layer cannot be read.");
        }
        for (Map.Entry<String, LayerStore.Stored> entry : new TreeMap<>(stored).entrySet()) {
            ObjectNode layer = parse(entry.getKey(), entry.getValue());
            if (layer == null) {
                continue;
            }
            ObjectNode app = NODES.objectNode().put("id", entry.getKey());
            ArrayNode files = app.putArray("files");
            layer.path("files").fields().forEachRemaining(file -> {
                JsonNode version = versionOf(file.getValue(), file.getValue().path("live").asInt(0));
                if (version == null) {
                    return;
                }
                ObjectNode each = files.addObject().put("path", file.getKey()).put("version", version.path("version").asInt());
                each.put("sha256", version.path("sha256").asText());
                each.set("packageSha256", version.path("packageSha256"));
                LiveFile served = live().of(entry.getKey()).get(file.getKey());
                each.put("served", served != null && served.version() == version.path("version").asInt());
            });
            if (!files.isEmpty()) {
                apps.add(app);
            }
        }
        return new Outcome(200, body);
    }

    /** One app's layer, file by file: what is live, and what is drafted. */
    Outcome summary(String app, AppRegistryEndpoint.Viewer viewer) {
        Outcome refused = refusal(viewer, app, null);
        if (refused != null) {
            return refused;
        }
        ObjectNode layer = readLayer(app);
        if (layer == null) {
            return error(500, "unreadable", "The app's deployment layer cannot be read; nothing is changed.");
        }
        ObjectNode body = NODES.objectNode().put("format", FORMAT).put("app", app);
        ArrayNode files = body.putArray("files");
        layer.path("files").fields().forEachRemaining(file -> {
            JsonNode state = file.getValue();
            ObjectNode each = files.addObject().put("path", file.getKey()).put("revision", state.path("revision").asInt());
            each.put("live", state.path("live").asInt(0));
            JsonNode draft = state.get("draft");
            if (draft != null && draft.isObject()) {
                each.putObject("draft")
                    .put("savedBy", draft.path("savedBy").asText())
                    .put("savedAt", draft.path("savedAt").asText())
                    .put("submitted", draft.path("submittedBy").isTextual());
            } else {
                each.putNull("draft");
            }
        });
        return new Outcome(200, body);
    }

    /** One file of an app's layer: the package's, the live and the draft versions, and its history. */
    Outcome state(String app, String path, AppRegistryEndpoint.Viewer viewer) {
        Outcome refused = refusal(viewer, app, path);
        if (refused != null) {
            return refused;
        }
        ObjectNode layer = readLayer(app);
        if (layer == null) {
            return error(500, "unreadable", "The app's deployment layer cannot be read; nothing is changed.");
        }
        return new Outcome(200, describe(app, path, fileOf(layer, path), viewer));
    }

    // --- Changes -------------------------------------------------------------------------------------

    /**
     * Makes one change to one file: {@code { "action", "revision", "content"?, "to"? }}.
     *
     * Refused, and nothing written: 403 for anyone but an administrator, and for an approval its
     * own maker may not give; 404 for an app the server does not have or a path no layer holds; 400
     * for a request that is not one; 409 for a revision that is not the file's, or a change the file's
     * state does not allow; 422 for a file the validator finds anything in.
     */
    Outcome act(String app, String path, AppRegistryEndpoint.Viewer viewer, JsonNode request) {
        Outcome outcome = attempt(app, path, viewer, request);
        if (outcome.status() >= 400) {
            // Every refusal of a change is said, with who asked: an audit of what was tried, too.
            // Only what the service names itself is written as it is; anything the request chose
            // is written as a place-holder, so that no one writes lines of their own into the log.
            String action = request != null && ACTIONS.contains(request.path("action").asText())
                    ? request.get("action").asText() : "a change";
            log.warn("Agentic UI deployment layer: {} refused {} of {}/{}: {} {}", printable(viewer),
                    action, ConfigScope.APP_ID.matcher(String.valueOf(app)).matches() ? app : "(another app)",
                    LayerPaths.isLayerPath(path) ? path : "(another path)", outcome.status(),
                    outcome.body().path("error").asText());
        }
        return outcome;
    }

    /** A person's name as the log shows it: no character that could start a line of its own. */
    static String printable(AppRegistryEndpoint.Viewer viewer) {
        if (viewer == null) {
            return "nobody";
        }
        StringBuilder name = new StringBuilder();
        viewer.name().codePoints().limit(128).forEach(point -> name.appendCodePoint(Character.isISOControl(point) ? '?' : point));
        return name.toString();
    }

    private Outcome attempt(String app, String path, AppRegistryEndpoint.Viewer viewer, JsonNode request) {
        Outcome refused = refusal(viewer, app, path);
        if (refused != null) {
            return refused;
        }
        if (request == null || !request.isObject() || !request.path("action").isTextual()
                || !ACTIONS.contains(request.get("action").asText())) {
            return error(400, "bad-request", "A change is { \"action\", \"revision\" }, its action one of "
                    + String.join(", ", new java.util.TreeSet<>(ACTIONS)) + ".");
        }
        JsonNode revision = request.get("revision");
        if (revision == null || !revision.isIntegralNumber() || revision.asLong() < 0
                || revision.asLong() > Integer.MAX_VALUE) {
            return error(400, "bad-request", "A change names the revision of the file it was made on.");
        }
        synchronized (changing) {
            Outcome[] outcome = new Outcome[1];
            RuntimeException[] failed = new RuntimeException[1];
            try {
                appLock.run(LOCK_KEY, () -> {
                    try {
                        outcome[0] = change(app, path, viewer, request, revision.asInt());
                    } catch (RuntimeException e) {
                        failed[0] = e;
                    }
                });
            } catch (RuntimeException e) {
                if (outcome[0] != null) {
                    // The change was made, and the lock not given back: the change is what to answer.
                    log.warn("Agentic UI deployment layer: the cluster's lock was not given back: {}", e.toString());
                    return outcome[0];
                }
                log.warn("Agentic UI deployment layer: the cluster's lock was not given: {}", e.toString());
                return error(409, "busy", "Another server is changing the layer; read the file again and retry.");
            }
            if (failed[0] != null) {
                log.error("Agentic UI deployment layer: a change of {}/{} by {} failed", app, path, viewer.name(),
                        failed[0]);
                return error(500, "failed",
                        "The change could not be made. Read the file again: it says whether it was written.");
            }
            return outcome[0];
        }
    }

    /** One change, inside the app's locks: read, check, apply, write, and again if another write came first. */
    private Outcome change(String app, String path, AppRegistryEndpoint.Viewer viewer, JsonNode request,
            int revision) {
        for (int attempt = 0; attempt < ATTEMPTS; attempt++) {
            LayerStore.Stored stored;
            try {
                stored = store.read(app);
            } catch (RuntimeException e) {
                log.error("Agentic UI deployment layer: {} could not be read", app, e);
                return error(500, "unreadable", "The app's deployment layer cannot be read; nothing is changed.");
            }
            ObjectNode layer = stored == null ? emptyLayer(app) : parse(app, stored);
            if (layer == null) {
                return error(500, "unreadable", "The app's deployment layer cannot be read; nothing is changed.");
            }
            ObjectNode file = fileOf(layer, path).deepCopy();
            if (file.path("revision").asInt(0) != revision) {
                ObjectNode body = errorBody("stale", "The file has changed since revision " + revision
                        + ": it is at revision " + file.path("revision").asInt(0)
                        + ". Read it again and make the change on it.");
                body.set("state", describe(app, path, fileOf(layer, path), viewer));
                return new Outcome(409, body);
            }
            if (!layer.get("files").has(path) && layer.get("files").size() >= MAX_FILES) {
                return error(413, "too-many-files", "An app's deployment layer holds at most " + MAX_FILES + " files.");
            }
            Outcome applied = apply(app, path, viewer, request, file);
            if (applied != null) {
                return applied;
            }
            ((ObjectNode) layer.get("files")).set(path, file);
            byte[] json;
            try {
                json = ConfigSnapshot.JSON.writeValueAsBytes(layer);
            } catch (JsonProcessingException e) {
                return error(500, "unwritable", "The change could not be written; nothing is changed.");
            }
            // A rollback and a discard are never refused for the layer's size: an incident must
            // always be undoable.
            String action = request.get("action").asText();
            if (json.length > MAX_LAYER_BYTES && !"rollback".equals(action) && !"discard".equals(action)) {
                return error(413, "layer-too-large", String.format(
                        "The app's deployment layer would be %d bytes; the limit is %d. Discard drafts, or roll files "
                                + "back to the package's.", json.length, MAX_LAYER_BYTES));
            }
            boolean written;
            try {
                written = store.write(app, json, stored == null ? null : stored.stamp());
            } catch (RuntimeException e) {
                log.error("Agentic UI deployment layer: {} could not be written", app, e);
                return error(500, "unwritable", "The change could not be written; nothing is changed.");
            }
            if (written) {
                generation.incrementAndGet();
                live = null;
                JsonNode last = file.path("trail").path(file.path("trail").size() - 1);
                log.info("Agentic UI deployment layer: {} {} {}/{}, now revision {}{}", viewer.name(),
                        last.path("action").asText(), app, path, file.path("revision").asInt(),
                        last.has("version") ? ", version " + last.get("version").asInt() : "");
                return new Outcome(200, describe(app, path, file, viewer));
            }
        }
        return error(409, "busy", "Other changes to the app kept coming first; read the file again and retry.");
    }

    /**
     * Applies the change to {@code file}, a copy, or says why it is refused. {@code null} when
     * applied: the file then has its new revision and its trail's new line.
     */
    private Outcome apply(String app, String path, AppRegistryEndpoint.Viewer viewer, JsonNode request,
            ObjectNode file) {
        String action = request.get("action").asText();
        String now = Instant.now(clock).toString();
        int liveNumber = file.path("live").asInt(0);
        JsonNode draft = file.get("draft");
        boolean hasDraft = draft != null && draft.isObject();
        ObjectNode line = NODES.objectNode().put("at", now).put("by", viewer.name()).put("action", action);
        switch (action) {
        case "save" -> {
            JsonNode content = request.get("content");
            if (content == null || !content.isObject()) {
                return error(400, "bad-request", "A draft is saved with its file, \"content\", a JSON object.");
            }
            byte[] bytes = render(content);
            if (bytes.length > ConfigSnapshot.MAX_JSON_BYTES) {
                return error(413, "too-large", String.format("The file is %d bytes; the limit is %d.", bytes.length,
                        ConfigSnapshot.MAX_JSON_BYTES));
            }
            Outcome invalid = check(app, path, content);
            if (invalid != null) {
                return invalid;
            }
            Set<String> authors = new LinkedHashSet<>();
            if (hasDraft) {
                draft.path("authors").forEach(author -> authors.add(author.asText()));
            }
            authors.add(viewer.name());
            ObjectNode saved = NODES.objectNode();
            saved.set("content", content);
            saved.put("sha256", sha256(bytes));
            ArrayNode list = saved.putArray("authors");
            authors.forEach(list::add);
            saved.put("savedBy", viewer.name()).put("savedAt", now).put("basedOn", liveNumber);
            String packageSha = packageSha256(app, path);
            if (packageSha == null) {
                saved.putNull("packageSha256");
            } else {
                saved.put("packageSha256", packageSha);
            }
            file.set("draft", saved);
            line.put("sha256", saved.get("sha256").asText());
        }
        case "submit" -> {
            if (!hasDraft) {
                return error(409, "no-draft", "There is no draft to submit.");
            }
            if (draft.path("submittedBy").isTextual()) {
                return error(409, "submitted", "The draft is already submitted for approval.");
            }
            ((ObjectNode) draft).put("submittedBy", viewer.name()).put("submittedAt", now);
            line.put("sha256", draft.path("sha256").asText());
        }
        case "approve" -> {
            if (!hasDraft || !draft.path("submittedBy").isTextual()) {
                return error(409, "not-submitted", "There is no draft submitted for approval.");
            }
            String refusal = approvalRefusal(draft, viewer);
            if (refusal != null) {
                return error(403, "self-approval", refusal);
            }
            if (draft.path("basedOn").asInt(-1) != liveNumber) {
                return error(409, "live-changed", "The live version has changed since the draft was made on version "
                        + draft.path("basedOn").asInt() + ": save the draft again on the live version.");
            }
            Outcome invalid = check(app, path, draft.get("content"));
            if (invalid != null) {
                return invalid;
            }
            ObjectNode version = newVersion(file, draft.get("content"), "approved", liveNumber, now);
            version.set("authors", draft.get("authors"));
            version.put("submittedBy", draft.get("submittedBy").asText());
            version.put("approvedBy", viewer.name());
            version.set("packageSha256", draft.path("packageSha256"));
            file.remove("draft");
            file.put("previous", liveNumber);
            file.put("live", version.get("version").asInt());
            line.put("version", version.get("version").asInt()).put("sha256", version.get("sha256").asText());
        }
        case "rollback" -> {
            // At once, and by one administrator: undoing the last change to what is live, or putting
            // the package's file back. Any other version goes live again only as a draft, approved.
            int previous = file.path("previous").asInt(0);
            JsonNode to = request.get("to");
            int target;
            if (to == null || to.isNull()) {
                if (liveNumber == 0 && previous == 0) {
                    return error(409, "nothing-live", "The package's file is in force: there is nothing to roll back.");
                }
                target = previous;
            } else if (to.isIntegralNumber() && to.asLong() >= 0 && to.asLong() <= Integer.MAX_VALUE) {
                target = to.asInt();
            } else {
                return error(400, "bad-request", "\"to\" is the number of a version, or 0 for the package's file.");
            }
            if (target == liveNumber) {
                return error(409, "already-live", "Version " + target + " is the live version.");
            }
            if (target != 0 && target != previous) {
                return error(409, "not-restorable", "A rollback puts back the version live just before the live one, "
                        + (previous == 0 ? "and there is none" : "version " + previous)
                        + ", or the package's file, 0, and nothing else. Version " + target
                        + " is not rolled back to: it goes live again only if it is saved again as a draft and a "
                        + "second administrator approves it.");
            }
            // A rollback is not undone by another: what it took down goes live again only through a
            // draft and its approval, so one administrator cannot reverse another's at once.
            if (target == 0) {
                file.put("previous", 0);
                file.put("live", 0);
                line.put("version", 0);
            } else {
                JsonNode restored = versionOf(file, target);
                if (restored == null) {
                    return error(409, "unknown-version", "Version " + target + " is not kept.");
                }
                Outcome invalid = check(app, path, restored.get("content"));
                if (invalid != null) {
                    return invalid;
                }
                // The restored version's own makers and approver: the rollback approves nothing.
                ObjectNode version = newVersion(file, restored.get("content"), "rollback", liveNumber, now);
                version.put("from", target);
                version.set("authors", restored.path("authors"));
                version.set("submittedBy", restored.path("submittedBy"));
                version.set("approvedBy", restored.path("approvedBy"));
                version.put("restoredBy", viewer.name());
                version.set("packageSha256", restored.path("packageSha256"));
                file.put("previous", 0);
                file.put("live", version.get("version").asInt());
                line.put("version", version.get("version").asInt()).put("from", target);
            }
        }
        case "discard" -> {
            if (!hasDraft) {
                return error(409, "no-draft", "There is no draft to discard.");
            }
            line.put("sha256", draft.path("sha256").asText());
            file.remove("draft");
        }
        default -> {
            return error(400, "bad-request", "Unknown action.");
        }
        }
        int next = file.path("revision").asInt(0) + 1;
        file.put("revision", next);
        line.put("revision", next);
        ArrayNode trail = array(file, "trail");
        trail.add(line);
        // The last lines are kept with the layer, and every one in the server's log; how many were
        // let go is counted, so that the trail never reads as whole when it is not.
        while (trail.size() > MAX_TRAIL) {
            trail.remove(0);
            file.put("trailDropped", file.path("trailDropped").asInt(0) + 1);
        }
        prune(file);
        return null;
    }

    /** Why this administrator may not approve this draft, or {@code null} when they may. */
    private String approvalRefusal(JsonNode draft, AppRegistryEndpoint.Viewer viewer) {
        if (settings.selfApproval()) {
            return null;
        }
        // Names compared without their case: two sign-ins of one person in a directory that ignores
        // case are one person, and two people whose names differ only by case are refused, which is
        // the safe way to be wrong.
        boolean authored = false;
        for (JsonNode author : draft.path("authors")) {
            authored |= author.asText().equalsIgnoreCase(viewer.name());
        }
        if (authored) {
            return "You wrote this draft, so a second administrator approves it. "
                    + LayerSettings.SELF_APPROVAL_PROPERTY + "=true lets an administrator approve their own change.";
        }
        if (draft.path("submittedBy").asText().equalsIgnoreCase(viewer.name())) {
            return "You submitted this draft, so a second administrator approves it. "
                    + LayerSettings.SELF_APPROVAL_PROPERTY + "=true lets an administrator approve their own change.";
        }
        return null;
    }

    /** The validator's refusal of {@code content} at {@code path}, 422, or {@code null} when it passes. */
    private Outcome check(String app, String path, JsonNode content) {
        ConfigSnapshot.App definition = appOf(app);
        DeploymentValidator.Answer answer = validator.validate(path, content, definition == null ? null : definition.app(),
                actionsOf(definition, allowList.get()));
        if (answer.passes()) {
            return null;
        }
        ObjectNode body = errorBody("invalid", answer.refused() != null ? answer.refused()
                : "The validator refuses the file: " + answer.findings().size() + " finding(s).");
        body.set("findings", answer.findings() == null ? NODES.arrayNode() : answer.findings());
        return new Outcome(422, body);
    }

    private ObjectNode newVersion(ObjectNode file, JsonNode content, String kind, int replaced, String now) {
        int number = 0;
        for (JsonNode version : file.path("versions")) {
            number = Math.max(number, version.path("version").asInt());
        }
        ObjectNode version = NODES.objectNode().put("version", number + 1).put("kind", kind);
        version.set("content", content);
        version.put("sha256", sha256(render(content))).put("at", now).put("replaced", replaced);
        array(file, "versions").add(version);
        return version;
    }

    /**
     * Keeps the last {@value #MAX_VERSIONS} versions, and the live one and the one a rollback would
     * put back whatever their age.
     */
    private static void prune(ObjectNode file) {
        ArrayNode versions = array(file, "versions");
        int live = file.path("live").asInt(0);
        int previous = file.path("previous").asInt(0);
        while (versions.size() > MAX_VERSIONS) {
            int oldest = -1;
            for (int index = 0; index < versions.size(); index++) {
                int number = versions.get(index).path("version").asInt();
                if (number != live && number != previous) {
                    oldest = index;
                    break;
                }
            }
            if (oldest < 0) {
                return;
            }
            versions.remove(oldest);
        }
    }

    // --- Reading the layer -----------------------------------------------------------------------------

    /**
     * Refuses anyone but an administrator, before anything is read, so that no one else learns
     * whether an app or a file has a layer, or whether the layer is switched on; then a layer
     * switched off, an app the server does not have, and a path no layer holds. {@code null} when
     * the request may go on.
     */
    Outcome refusal(AppRegistryEndpoint.Viewer viewer, String app, String path) {
        if (viewer == null || !viewer.administrator()) {
            return error(403, "forbidden", "Only an administrator may read or change a deployment layer.");
        }
        if (!settings.enabled()) {
            return error(404, "not-found", "The deployment layer is switched off on this server.");
        }
        if (app != null && appOf(app) == null) {
            return error(404, "not-found", "The server has no app \"" + app + "\".");
        }
        if (path != null && !LayerPaths.isLayerPath(path)) {
            return error(404, "not-found", "A deployment layer holds layouts/<Type>/<view, edit or create>.layout.json "
                    + "and queues/<id>.json only.");
        }
        return null;
    }

    private ConfigSnapshot.App appOf(String app) {
        return appOf(snapshot.get(), app);
    }

    private static ConfigSnapshot.App appOf(ConfigSnapshot in, String app) {
        for (ConfigSnapshot.App each : in.apps()) {
            if (each.id().equals(app)) {
                return each;
            }
        }
        return null;
    }

    /**
     * The app's {@code actions.json} as the registry serves it with this allow-list, parsed, or
     * {@code null} when its package has none: an action that runs an operation the allow-list does
     * not let run is not in it, so a queue that names one is refused, as the queue page would leave
     * it out ({@link AppActions}).
     */
    private static JsonNode actionsOf(ConfigSnapshot.App definition, AllowList allowed) {
        ConfigSnapshot.AppFile file = definition == null ? null : definition.files().get(AppActions.FILE);
        if (file == null) {
            return null;
        }
        AppActions.Served served = AppActions.serve(definition.id(), new Provenance(
                definition.provenance().component(), definition.provenance().bundle(), file.source()), file.bytes(),
                allowed);
        try {
            return ConfigSnapshot.JSON.readTree(served.bytes());
        } catch (IOException e) {
            return null;
        }
    }

    private ObjectNode readLayer(String app) {
        LayerStore.Stored stored;
        try {
            stored = store.read(app);
        } catch (RuntimeException e) {
            log.error("Agentic UI deployment layer: {} could not be read", app, e);
            return null;
        }
        return stored == null ? emptyLayer(app) : parse(app, stored);
    }

    private static ObjectNode emptyLayer(String app) {
        ObjectNode layer = NODES.objectNode().put("format", FORMAT).put("app", app);
        layer.putObject("files");
        return layer;
    }

    /** A stored layer, or {@code null}, logged, when it is not one. */
    private static ObjectNode parse(String app, LayerStore.Stored stored) {
        try {
            JsonNode layer = ConfigSnapshot.JSON.readTree(stored.json());
            if (layer instanceof ObjectNode object && FORMAT.equals(object.path("format").asText())
                    && app.equals(object.path("app").asText()) && object.path("files").isObject()) {
                return object;
            }
        } catch (IOException e) {
            // Logged below, as a layer that is not one.
        }
        log.error("Agentic UI deployment layer: the stored layer of {} is not one; it is not served or changed", app);
        return null;
    }

    private static ObjectNode fileOf(ObjectNode layer, String path) {
        JsonNode file = layer.path("files").get(path);
        if (file instanceof ObjectNode object) {
            return object;
        }
        ObjectNode empty = NODES.objectNode().put("revision", 0).put("live", 0);
        empty.putArray("versions");
        empty.putArray("trail");
        return empty;
    }

    private static JsonNode versionOf(JsonNode file, int number) {
        if (number <= 0) {
            return null;
        }
        for (JsonNode version : file.path("versions")) {
            if (version.path("version").asInt() == number) {
                return version;
            }
        }
        return null;
    }

    /** The file's state as administrators read it, with what this one may do. */
    private ObjectNode describe(String app, String path, ObjectNode file, AppRegistryEndpoint.Viewer viewer) {
        ObjectNode body = NODES.objectNode().put("format", FORMAT).put("app", app).put("path", path);
        body.put("revision", file.path("revision").asInt(0));
        JsonNode packaged = packageContent(app, path);
        String packageSha = packaged == null ? null : sha256(render(packaged));
        if (packaged == null) {
            body.putNull("package");
        } else {
            body.putObject("package").put("sha256", packageSha).set("content", packaged);
        }
        int liveNumber = file.path("live").asInt(0);
        JsonNode liveVersion = versionOf(file, liveNumber);
        if (liveVersion == null) {
            body.putNull("live");
        } else {
            body.set("live", liveVersion.deepCopy());
        }
        // What a rollback puts back at once: 0, the package's file, when nothing was live before.
        body.put("previous", file.path("previous").asInt(0));
        // Whether the registry serves the live version: not when the validator refuses it now.
        LiveFile served = liveNumber == 0 ? null : live().of(app).get(path);
        body.put("served", served != null && served.version() == liveNumber);
        body.put("trailDropped", file.path("trailDropped").asInt(0));
        JsonNode draft = file.get("draft");
        body.set("draft", draft != null && draft.isObject() ? draft.deepCopy() : NODES.nullNode());
        ArrayNode versions = body.putArray("versions");
        for (JsonNode version : file.path("versions")) {
            ObjectNode each = version.deepCopy();
            each.remove("content");
            versions.add(each);
        }
        body.set("trail", file.path("trail").isArray() ? file.get("trail").deepCopy() : NODES.arrayNode());
        JsonNode recorded = liveVersion != null ? liveVersion.path("packageSha256")
                : draft != null && draft.isObject() ? draft.path("packageSha256") : null;
        body.put("packageChanged", recorded != null && !recorded.isMissingNode()
                && !(recorded.isNull() ? packageSha == null : recorded.asText().equals(packageSha)));
        ObjectNode permissions = body.putObject("permissions");
        permissions.put("write", viewer.administrator());
        boolean submitted = draft != null && draft.isObject() && draft.path("submittedBy").isTextual();
        String refusal = submitted ? approvalRefusal(draft, viewer) : "There is no draft submitted for approval.";
        permissions.put("approve", submitted && refusal == null);
        if (refusal == null) {
            permissions.putNull("approveRefused");
        } else {
            permissions.put("approveRefused", refusal);
        }
        permissions.put("selfApproval", settings.selfApproval());
        return body;
    }

    /** The package's file at this path, as the configuration in force has it, or {@code null}. */
    private JsonNode packageContent(String app, String path) {
        ConfigSnapshot current = snapshot.get();
        String[] layout = LayerPaths.typeAndMode(path);
        if (layout != null) {
            for (ConfigSnapshot.Layout each : current.layouts()) {
                if (each.type().equals(layout[0]) && each.mode().equals(layout[1])) {
                    return each.content();
                }
            }
            return null;
        }
        ConfigSnapshot.App definition = appOf(app);
        ConfigSnapshot.AppFile file = definition == null ? null : definition.files().get(path);
        if (file == null) {
            return null;
        }
        try {
            return ConfigSnapshot.JSON.readTree(file.bytes());
        } catch (IOException e) {
            return null;
        }
    }

    private String packageSha256(String app, String path) {
        JsonNode packaged = packageContent(app, path);
        return packaged == null ? null : sha256(render(packaged));
    }

    // --- Small things --------------------------------------------------------------------------------

    static byte[] render(JsonNode content) {
        try {
            return ConfigSnapshot.JSON.writeValueAsString(content).getBytes(StandardCharsets.UTF_8);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("cannot render a layer file", e);
        }
    }

    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    /** The array under {@code key}, put there when the file has none. */
    private static ArrayNode array(ObjectNode file, String key) {
        JsonNode value = file.get(key);
        return value instanceof ArrayNode list ? list : file.putArray(key);
    }

    static ObjectNode errorBody(String code, String message) {
        return NODES.objectNode().put("format", FORMAT).put("error", code).put("message", message);
    }

    static Outcome error(int status, String code, String message) {
        return new Outcome(status, errorBody(code, message));
    }
}
