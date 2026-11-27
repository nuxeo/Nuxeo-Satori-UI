package org.nuxeo.agentic.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * An app's {@code actions.json} as the app registry serves it: with only the actions this server's
 * allow-list lets run (docs/business-apps/app-definition-v2.md, section 5).
 *
 * An action that runs an operation, one with an {@code operation} key, is served only when:
 *
 * <ul>
 * <li>its id is an action's, and no action before it has the same one;</li>
 * <li>its operation is on the allow-list;</li>
 * <li>{@code on}, when it has one, lists only {@code record}, {@code row} and {@code bulk};</li>
 * <li>each of its parameters is one the allow-list gives the operation, and its value is a literal
 * of the parameter's type, a field of the record, {@code { "field": "<prefix>:<name>" }}, or what
 * the person enters in the action's form, {@code { "field": "var:<name>" }}; a bulk action's are
 * literals only. A computation is not run on the server, so a parameter computed in the browser is
 * refused rather than trusted.</li>
 * </ul>
 *
 * Any other is left out, and a diagnostic says why, in the app's scope, so that whoever may see the
 * app is told. Every other action, a lifecycle button among them, is served as it is: what it does
 * is Nuxeo's lifecycle, which the server gates as for any request, and the app's validator decides
 * what it draws. A file with nothing left out is served byte for byte as the package wrote it.
 *
 * Configuration cannot widen the allow-list: the file names an operation; only the deployment's
 * contribution to {@code org.nuxeo.agentic.ui.operations} allows one.
 */
final class AppActions {

    static final String FILE = "actions.json";

    /** As the validator writes an action's id. */
    static final Pattern ACTION_ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,63}");

    /** The platform's own ids, which an app's file cannot take. */
    static final Pattern PLATFORM_ID = Pattern.compile("(?:app|core)\\..*");

    /** A record's property, as a field reference writes it. */
    static final Pattern XPATH = Pattern.compile("[A-Za-z_][A-Za-z0-9_-]*:[A-Za-z_][A-Za-z0-9_-]*");

    static final String VARIABLE = "var:";

    /** Where an action shows: the record page's toolbar, a queue's row, a card of the record page that names it, a queue's selection. */
    static final Set<String> PLACEMENTS = Set.of("record", "row", "card", "bulk");

    /**
     * What the registry serves, and what it can run.
     *
     * @param bytes the file's body as served
     * @param runnable the actions that run an operation and were served, by id
     */
    record Served(byte[] bytes, Map<String, RunnableAction> runnable, List<Diagnostic> diagnostics) {
    }

    private AppActions() {
    }

    /**
     * @param app the app's id, for the diagnostics' scope
     * @param provenance the file's: the component and bundle of the app, and where the file was read
     * @param bytes the file as the package wrote it, which the snapshot has read as a JSON object
     */
    static Served serve(String app, Provenance provenance, byte[] bytes, AllowList allowList) {
        List<Diagnostic> diagnostics = new ArrayList<>();
        Map<String, RunnableAction> runnable = new LinkedHashMap<>();
        JsonNode file;
        try {
            file = ConfigSnapshot.JSON.readTree(bytes);
        } catch (IOException e) {
            // The snapshot read it as a JSON object; this cannot fail unless the bytes changed.
            throw new IllegalStateException("actions.json of " + app + " no longer parses", e);
        }
        if (!(file instanceof ObjectNode object) || !(object.get("actions") instanceof ArrayNode actions)) {
            // Not a list of actions: the app's validator refuses the file, and nothing in it runs.
            return new Served(bytes, runnable, diagnostics);
        }
        String scope = ConfigScope.app(app);
        Set<String> ids = new HashSet<>();
        ArrayNode kept = actions.arrayNode();
        boolean leftOut = false;
        for (JsonNode entry : actions) {
            JsonNode id = entry.get("id");
            if (!entry.isObject() || !entry.has("operation")) {
                if (id != null && id.isTextual()) {
                    ids.add(id.asText());
                }
                kept.add(entry);
                continue;
            }
            String name = id != null && id.isTextual() ? id.asText() : null;
            String refusal = refusal(app, entry, name, ids, allowList, runnable);
            if (refusal != null) {
                leftOut = true;
                // Only names an action or an operation may have are quoted: the message is logged, and
                // the file is the package's, so a name with a line break would write a line of its own.
                diagnostics.add(Diagnostic.error("action-refused", scope, provenance,
                        String.format("%s %s: the action %s %s; it is not served, and does not run.", app, FILE,
                                name == null || !ACTION_ID.matcher(name).matches() ? "with no id an action may have"
                                        : "\"" + name + "\"",
                                refusal)));
                continue;
            }
            ids.add(name);
            kept.add(entry);
        }
        if (!leftOut) {
            return new Served(bytes, runnable, diagnostics);
        }
        ObjectNode served = object.deepCopy();
        served.set("actions", kept);
        return new Served(render(served), runnable, diagnostics);
    }

    /**
     * Why an action that runs an operation is not served, or {@code null}, having added it to
     * {@code runnable}, when it is.
     */
    private static String refusal(String app, JsonNode entry, String id, Set<String> ids, AllowList allowList,
            Map<String, RunnableAction> runnable) {
        if (id == null || !ACTION_ID.matcher(id).matches() || PLATFORM_ID.matcher(id).matches()) {
            return "has no id an app's action may have";
        }
        if (ids.contains(id)) {
            return "has the id of an action before it";
        }
        JsonNode operation = entry.get("operation");
        if (!operation.isTextual() || !AllowedOperation.ID.matcher(operation.asText()).matches()) {
            return "names no operation";
        }
        AllowedOperation allowed = allowList.get(operation.asText());
        if (allowed == null) {
            return "runs \"" + operation.asText() + "\", which this server's allow-list does not hold";
        }
        if (!allowed.apps().isEmpty() && !allowed.apps().contains(app)) {
            return "runs \"" + allowed.id() + "\", which this server's allow-list lets only other apps' buttons run";
        }
        Set<String> placements = placements(entry.get("on"));
        if (placements == null) {
            return "has an \"on\" that is not a list of \"record\", \"row\", \"card\" and \"bulk\"";
        }
        JsonNode parameters = entry.get("parameters");
        if (parameters != null && !parameters.isObject()) {
            return "has parameters that are not an object";
        }
        Map<String, RunnableAction.Source> sources = new LinkedHashMap<>();
        if (parameters != null) {
            for (Iterator<Map.Entry<String, JsonNode>> it = parameters.fields(); it.hasNext();) {
                Map.Entry<String, JsonNode> parameter = it.next();
                String name = parameter.getKey();
                AllowedOperation.Parameter declared = allowed.parameters().get(name);
                if (declared == null) {
                    return AllowedOperation.PARAMETER.matcher(name).matches()
                            ? "gives " + allowed.id() + " the parameter \"" + name
                                    + "\", which this server's allow-list does not let it be given"
                            : "gives " + allowed.id() + " a parameter whose name is not one";
                }
                RunnableAction.Source source = source(parameter.getValue());
                if (source == null) {
                    return "gives the parameter \"" + name + "\" a value that is neither a literal, a field of the"
                            + " record, nor a field of its form: a computation is not run on the server";
                }
                if (!declared.admits(source)) {
                    return "gives the parameter \"" + name + "\" its value from elsewhere than this server's"
                            + " allow-list says: " + declared.source();
                }
                if (source instanceof RunnableAction.Literal literal) {
                    try {
                        declared.fromJson(literal.value());
                    } catch (IllegalArgumentException e) {
                        return "gives the parameter \"" + name + "\" a value that " + e.getMessage()
                                + ", and the allow-list makes it a " + declared.type().label();
                    }
                } else if (placements.contains("bulk")) {
                    return "runs in bulk, on many records, and gives the parameter \"" + name
                            + "\" a value that is not a literal";
                }
                sources.put(name, source);
            }
        }
        for (AllowedOperation.Parameter declared : allowed.parameters().values()) {
            if (declared.required() && !sources.containsKey(declared.name())) {
                return "does not give " + allowed.id() + " the parameter \"" + declared.name()
                        + "\", which this server's allow-list requires";
            }
        }
        runnable.put(id, new RunnableAction(id, allowed.id(), placements, sources));
        return null;
    }

    /** {@code on}'s places, {@code record} when there is none; {@code null} when it is not a list of them. */
    private static Set<String> placements(JsonNode on) {
        if (on == null) {
            return Set.of("record");
        }
        if (!on.isArray() || on.isEmpty()) {
            return null;
        }
        Set<String> placements = new LinkedHashSet<>();
        for (JsonNode place : on) {
            if (!place.isTextual() || !PLACEMENTS.contains(place.asText()) || !placements.add(place.asText())) {
                return null;
            }
        }
        return placements;
    }

    /** Where a parameter's value comes from, or {@code null} for a value the server cannot take. */
    private static RunnableAction.Source source(JsonNode value) {
        if (value.isTextual() || value.isNumber() || value.isBoolean()) {
            return new RunnableAction.Literal(value);
        }
        if (!value.isObject() || value.size() != 1 || !value.has("field") || !value.get("field").isTextual()) {
            return null;
        }
        String xpath = value.get("field").asText();
        if (xpath.startsWith(VARIABLE)) {
            String name = xpath.substring(VARIABLE.length());
            return AllowedOperation.PARAMETER.matcher(name).matches() ? new RunnableAction.Input(name) : null;
        }
        return XPATH.matcher(xpath).matches() ? new RunnableAction.Field(xpath) : null;
    }

    private static byte[] render(ObjectNode node) {
        try {
            return ConfigSnapshot.JSON.writer(SerializationFeature.INDENT_OUTPUT)
                                      .writeValueAsString(node)
                                      .getBytes(StandardCharsets.UTF_8);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("cannot render actions.json", e);
        }
    }
}
