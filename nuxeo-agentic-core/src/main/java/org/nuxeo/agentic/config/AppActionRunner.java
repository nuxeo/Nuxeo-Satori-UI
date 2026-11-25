package org.nuxeo.agentic.config;

import static org.nuxeo.ecm.core.api.security.SecurityConstants.READ;

import java.io.IOException;
import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.config.AppActionException.Kind;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.PropertyException;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;

/**
 * {@code AgenticUi.RunAction}: one action of an app's {@code actions.json}, run on one record, in
 * the order that keeps an operation from running before it may.
 *
 * <ol>
 * <li>The reader's {@code Read} on the record, first, so that no one learns which actions exist from
 * a record they may not read.</li>
 * <li>The action, as the app registry serves it to the reader: an app whose groups they are in, its
 * {@code actions.json} as the allow-list left it ({@link AppActions}), an action there that runs an
 * operation. The request names the app and the action, never the operation, so it can ask only for
 * what the registry serves.</li>
 * <li>That it runs on one record: {@code record} or {@code row}. Bulk actions do not run here.</li>
 * <li>The allow-list again, as it stands now: the operation on it, for this app when it names apps,
 * the reader in one of its groups when it names any, and the reader holding its permission on the
 * record.</li>
 * <li>The record as the repository stores it, never the one the request gave: Automation builds an
 * input document from a JSON entity, and applies the entity's properties to it in memory. Its type
 * and its lifecycle state, when the allow-list names any, must be among them.</li>
 * <li>The parameters: each one the allow-list still gives the operation, its value from where it
 * says and of the type it gives it, and a value for each it requires. A literal comes from the
 * served file, a field from the stored record, and what the person entered from the request, for
 * the form's fields only: a value for any other is refused.</li>
 * <li>The operation, in an Automation context of its own, as the reader, with the stored record as
 * its input and those parameters, and nothing else from the request. While it runs, and only then,
 * {@link #running} answers yes for it: {@code AgenticUi.RequireRunAction}, the first step of a
 * chain meant for a button, refuses every other way of running the chain, Nuxeo's own Automation
 * endpoint and its dispatchers such as {@code RunOperation} among them.</li>
 * <li>The record's history: {@code Audit.LogEvent} records who ran which action of which app, and
 * its operation. Never a value: they may be personal data. Recorded after the operation returns,
 * so an operation that fails leaves no entry, and an entry that cannot be written fails the run.
 * Whether an entry written is undone when the request's transaction is rolled back later depends
 * on the server's audit backend, and is not checked.</li>
 * </ol>
 *
 * Nothing here is the only control. Nuxeo's permissions gate every operation the chain runs, as
 * for any request of the reader's, and Nuxeo's own Automation endpoint still runs any operation a
 * reader may run, allow-listed or not, directly or through a dispatcher such as {@code RunOperation},
 * except a chain that begins with {@code AgenticUi.RequireRunAction}. And a REST binding that keeps an
 * operation to administrators or to some groups on that endpoint keeps it so for a button too
 * (docs/api-integrations.md, section 40).
 */
final class AppActionRunner {

    private static final Logger log = LogManager.getLogger(AppActionRunner.class);

    /** The most what the person entered may hold, as JSON. */
    static final int MAX_VALUES_BYTES = 64 * 1024;

    static final String AUDIT_OPERATION = "Audit.LogEvent";

    static final String AUDIT_EVENT = "App action run";

    static final String AUDIT_CATEGORY = "Agentic UI";

    /**
     * The operation this thread is running for an app's button, or {@code null}. Server-side only:
     * nothing a request carries can set it, as it could a context variable, which Automation's
     * dispatchers copy from the request.
     */
    private static final ThreadLocal<String> RUNNING = new ThreadLocal<>();

    /**
     * Whether {@code operation} runs now, on this thread, for an app's button. Its surrounding white
     * space is left out: a chain's XML parameter can carry the line break after its text, as the kit's
     * platform check reads it with the server's own descriptor classes.
     */
    static boolean running(String operation) {
        return operation != null && operation.strip().equals(RUNNING.get());
    }

    /** What the run asks of the server it runs on, besides the allow-list. */
    interface Platform {

        /**
         * Whether {@code AgenticUi.RunAction} and {@code AgenticUi.RequireRunAction} are still this
         * module's operations: a chain, or an alias, of either id would replace it.
         */
        boolean intact();

        /**
         * Whether Nuxeo's own REST binding for {@code operation}, when it has one, lets
         * {@code principal} run it: a button never runs what Nuxeo's endpoint keeps to
         * administrators or to some groups, or has disabled.
         */
        boolean bindingAdmits(String operation, NuxeoPrincipal principal);
    }

    /** A server that replaced nothing and binds nothing: for tests. */
    static final Platform UNBOUND = new Platform() {
        @Override
        public boolean intact() {
            return true;
        }

        @Override
        public boolean bindingAdmits(String operation, NuxeoPrincipal principal) {
            return true;
        }
    };

    /** Runs one Automation operation as the reader, on {@code input}, given {@code parameters} only. */
    @FunctionalInterface
    interface Automation {
        Object run(CoreSession session, DocumentModel input, String operation, Map<String, Object> parameters)
                throws Exception;
    }

    /** What ran. */
    record Result(String app, String action, String operation) {

        String toJson() {
            return JsonNodeFactory.instance.objectNode()
                                           .put("app", app)
                                           .put("action", action)
                                           .put("status", "done")
                                           .toString();
        }
    }

    private final AppRegistryEndpoint registry;

    private final Supplier<AllowList> allowList;

    private final Automation automation;

    private final Platform platform;

    AppActionRunner(AppRegistryEndpoint registry, Supplier<AllowList> allowList, Automation automation) {
        this(registry, allowList, automation, UNBOUND);
    }

    AppActionRunner(AppRegistryEndpoint registry, Supplier<AllowList> allowList, Automation automation,
            Platform platform) {
        this.registry = registry;
        this.allowList = allowList;
        this.automation = automation;
        this.platform = platform;
    }

    Result run(CoreSession session, DocumentModel input, String app, String id, String values) {
        AppRegistryEndpoint.Viewer viewer = AgenticUiAppsServlet.viewer(session.getPrincipal());
        if (viewer == null) {
            throw new DocumentSecurityException("Running an app's action needs a user");
        }
        if (!platform.intact()) {
            throw new AppActionException(Kind.PLATFORM_REPLACED);
        }
        DocumentRef ref = input == null ? null : input.getRef();
        if (ref == null) {
            throw new AppActionException(Kind.NO_RECORD);
        }
        // Asked of the session, as the user: an administrator holds every permission, as Nuxeo decides.
        if (!session.hasPermission(ref, READ)) {
            throw new DocumentSecurityException("Running an app's action needs the Read permission on the record");
        }
        RunnableAction action = registry.action(app, id, viewer);
        if (action == null) {
            throw refused(Kind.UNKNOWN_ACTION, viewer, app, id, null);
        }
        if (!action.runsOnOneRecord()) {
            throw refused(Kind.NOT_ON_A_RECORD, viewer, app, id, action.operation());
        }
        AllowedOperation allowed = allowList.get().get(action.operation());
        if (allowed == null) {
            throw refused(Kind.NOT_ALLOWED, viewer, app, id, action.operation());
        }
        if (!allowed.apps().isEmpty() && !allowed.apps().contains(app)) {
            throw refused(Kind.NOT_ALLOWED, viewer, app, id, action.operation());
        }
        if (!allowed.groups().isEmpty() && allowed.groups().stream().noneMatch(viewer.groups()::contains)) {
            throw refused(Kind.NOT_IN_GROUP, viewer, app, id, action.operation());
        }
        if (!platform.bindingAdmits(action.operation(), session.getPrincipal())) {
            throw refused(Kind.NOT_ALLOWED, viewer, app, id, action.operation() + ", by Nuxeo's REST binding for it");
        }
        if (!session.hasPermission(ref, allowed.permission())) {
            log.warn("Agentic UI action refused: {} ran {} of the app {} ({}) without the {} permission on {}",
                    loggable(viewer.name()), id, app, action.operation(), allowed.permission(), ref);
            throw new DocumentSecurityException(
                    "Running this action needs the " + allowed.permission() + " permission on the record");
        }
        DocumentModel stored = session.getDocument(ref);
        if (!allowed.types().isEmpty() && !allowed.types().contains(stored.getType())
                || !allowed.states().isEmpty() && !allowed.states().contains(stored.getCurrentLifeCycleState())) {
            throw refused(Kind.NOT_FOR_THIS_RECORD, viewer, app, id, action.operation());
        }
        for (AllowedOperation.Parameter declared : allowed.parameters().values()) {
            if (declared.required() && !action.parameters().containsKey(declared.name())) {
                throw refused(Kind.NOT_ALLOWED, viewer, app, id,
                        action.operation() + ", required parameter " + declared.name() + " not given");
            }
        }
        Map<String, JsonNode> entered = entered(values, action, viewer, app, id);
        Map<String, Object> parameters = new LinkedHashMap<>();
        for (Map.Entry<String, RunnableAction.Source> parameter : action.parameters().entrySet()) {
            String name = parameter.getKey();
            AllowedOperation.Parameter declared = allowed.parameters().get(name);
            if (declared == null || !declared.admits(parameter.getValue())) {
                throw refused(Kind.NOT_ALLOWED, viewer, app, id, action.operation() + ", parameter " + name);
            }
            Object value;
            try {
                value = switch (parameter.getValue()) {
                    case RunnableAction.Literal literal -> declared.fromJson(literal.value());
                    case RunnableAction.Field field -> declared.fromProperty(property(stored, field.xpath()));
                    case RunnableAction.Input inputValue -> declared.fromJson(entered.get(inputValue.name()));
                };
            } catch (IllegalArgumentException e) {
                throw refused(Kind.INVALID_VALUE, viewer, app, id,
                        action.operation() + ", parameter " + name + " " + e.getMessage());
            }
            if (declared.required() && value instanceof String text && text.isBlank()) {
                throw refused(Kind.INVALID_VALUE, viewer, app, id,
                        action.operation() + ", parameter " + name + " is required and blank");
            }
            if (value != null) {
                parameters.put(name, value);
            } else if (declared.required()) {
                throw refused(Kind.INVALID_VALUE, viewer, app, id,
                        action.operation() + ", parameter " + name + " is required and has no value");
            }
        }
        try {
            String outer = RUNNING.get();
            RUNNING.set(action.operation());
            try {
                automation.run(session, stored, action.operation(), parameters);
            } finally {
                if (outer == null) {
                    RUNNING.remove();
                } else {
                    RUNNING.set(outer);
                }
            }
            automation.run(session, stored, AUDIT_OPERATION,
                    Map.of("event", AUDIT_EVENT, "category", AUDIT_CATEGORY, "comment",
                            String.format("%s ran the action %s of the app %s, which runs %s.", viewer.name(), id, app,
                                    action.operation())));
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new org.nuxeo.ecm.core.api.NuxeoException(e);
        }
        log.info("Agentic UI action run: {} ran {} of the app {} ({}) on {}", loggable(viewer.name()), id, app,
                action.operation(), stored.getId());
        return new Result(app, id, action.operation());
    }

    /**
     * What the person entered, by the name of the form's field, {@code var:<name>}: a JSON object of
     * texts, numbers, booleans and nulls, for the action's form fields only.
     */
    private static Map<String, JsonNode> entered(String values, RunnableAction action,
            AppRegistryEndpoint.Viewer viewer, String app, String id) {
        Map<String, JsonNode> entered = new LinkedHashMap<>();
        if (values == null || values.isBlank()) {
            return entered;
        }
        JsonNode object;
        try {
            if (values.getBytes(StandardCharsets.UTF_8).length > MAX_VALUES_BYTES) {
                throw new IOException("too large");
            }
            object = ConfigSnapshot.JSON.readTree(values);
        } catch (IOException e) {
            throw refused(Kind.UNREADABLE_VALUES, viewer, app, id, null);
        }
        if (object == null || !object.isObject()) {
            throw refused(Kind.UNREADABLE_VALUES, viewer, app, id, null);
        }
        Set<String> inputs = new HashSet<>();
        for (RunnableAction.Source source : action.parameters().values()) {
            if (source instanceof RunnableAction.Input input) {
                inputs.add(input.name());
            }
        }
        for (Iterator<Map.Entry<String, JsonNode>> it = object.fields(); it.hasNext();) {
            Map.Entry<String, JsonNode> value = it.next();
            if (!inputs.contains(value.getKey())) {
                throw refused(Kind.UNKNOWN_VALUE, viewer, app, id, null);
            }
            if (value.getValue().isContainerNode()) {
                throw refused(Kind.UNREADABLE_VALUES, viewer, app, id, null);
            }
            entered.put(value.getKey(), value.getValue());
        }
        return entered;
    }

    private static Serializable property(DocumentModel stored, String xpath) {
        try {
            return stored.getPropertyValue(xpath);
        } catch (PropertyException e) {
            // A record without the property: the action was not written for its type.
            throw new IllegalArgumentException("names a property the record does not have");
        }
    }

    /** Logs why, with who asked and for what, and never a value; the answer says only the kind. */
    private static AppActionException refused(Kind kind, AppRegistryEndpoint.Viewer viewer, String app, String id,
            String operation) {
        log.warn("Agentic UI action refused ({}): {} asked for the action {} of the app {}{}", kind,
                loggable(viewer.name()), loggable(id), loggable(app), operation == null ? "" : " (" + operation + ")");
        return new AppActionException(kind);
    }

    /**
     * A name the request gave, as the log may hold it: the app's and the action's are the request's
     * own, so one with a line break could otherwise write a line of its own into the log.
     */
    static String loggable(String name) {
        if (name == null) {
            return "(none)";
        }
        String shown = name.length() > 128 ? name.substring(0, 128) + "..." : name;
        return shown.chars().allMatch(c -> c > 0x20 && c < 0x7f) ? shown : "(not a name)";
    }
}
