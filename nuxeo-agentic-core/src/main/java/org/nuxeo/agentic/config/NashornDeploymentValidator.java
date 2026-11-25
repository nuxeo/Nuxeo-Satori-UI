package org.nuxeo.agentic.config;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.function.Supplier;

import javax.script.Invocable;
import javax.script.ScriptEngine;

import org.openjdk.nashorn.api.scripting.NashornScriptEngineFactory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The app definition's validator, run on the server: {@code agentic-ui-validator/validator.js},
 * built from {@code libs/shared/app-definition/src/server-validator.ts} by
 * {@code server-validator-build.mjs}, so that it is the pipeline's and the designer's check, not a
 * second one. {@code DeploymentValidatorParityTest} holds this run of a set of files to the
 * findings the TypeScript gives for them.
 *
 * <ul>
 * <li><b>The engine</b> is Nashorn 15.7, which Nuxeo LTS 2025 ships in {@code nxserver/lib}, with
 * {@code --language=es6}. The script reaches no Java: {@code --no-java} takes {@code Java} and the
 * packages away, and the class filter refuses every class, so even an engine option that put them
 * back would find none. It is given JSON text and gives JSON text back.</li>
 * <li><b>The content model</b> is the server's own, read when a file is checked
 * ({@link ServerContentModel}), so a file is held to the types, schemas and facets the server has
 * now, as the designer holds it to what {@code /api/v1/config} answers.</li>
 * <li><b>What the deployment registers</b> beyond the platform is {@link LayerSettings}'.</li>
 * <li><b>Fails closed:</b> a script that cannot be read or run, or an answer that is not the
 * validator's, refuses the file.</li>
 * </ul>
 *
 * One engine, created on the first check and kept; checks are made one at a time, since an engine
 * is not to be shared between threads, and writes to a layer are few.
 */
final class NashornDeploymentValidator implements DeploymentValidator {

    static final String SCRIPT = "agentic-ui-validator/validator.js";

    static final String GLOBAL_NAME = "agenticUiValidator";

    /** Nashorn with the syntax the script is built for, and no way to reach Java. */
    static final String[] ENGINE_OPTIONS = { "--language=es6", "--no-java", "--no-syntax-extensions" };

    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;

    private final Supplier<JsonNode> model;

    private final LayerSettings settings;

    private ScriptEngine engine;

    private Object validator;

    /**
     * @param model the server's content model, {@code { doctypes, facets, schemas }}, read for each
     *            check
     */
    NashornDeploymentValidator(Supplier<JsonNode> model, LayerSettings settings) {
        this.model = model;
        this.settings = settings;
    }

    @Override
    public synchronized Answer validate(String path, JsonNode content, JsonNode app, JsonNode actions) {
        JsonNode currentModel;
        try {
            currentModel = model.get();
        } catch (RuntimeException e) {
            return new Answer(null, "the server's content model could not be read: " + e.getMessage());
        }
        ObjectNode request = NODES.objectNode();
        request.put("path", path);
        request.set("content", content);
        request.set("model", currentModel);
        request.set("app", app == null ? NODES.nullNode() : app);
        request.set("actions", actions == null ? NODES.nullNode() : actions);
        ObjectNode registered = request.putObject("registered");
        ids(registered.putArray("rules"), settings.rules());
        ids(registered.putArray("rowActions"), settings.rowActions());
        ids(registered.putArray("bulkActions"), settings.bulkActions());
        Object answer;
        try {
            if (engine == null) {
                start();
            }
            answer = ((Invocable) engine).invokeMethod(validator, "validate",
                    ConfigSnapshot.JSON.writeValueAsString(request));
        } catch (Exception | StackOverflowError e) {
            return new Answer(null, "the validator could not run: " + e);
        }
        return read(answer);
    }

    private void start() throws Exception {
        String script;
        try (InputStream in = NashornDeploymentValidator.class.getClassLoader().getResourceAsStream(SCRIPT)) {
            if (in == null) {
                throw new IOException(SCRIPT + " is not in the bundle");
            }
            script = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        ScriptEngine created = new NashornScriptEngineFactory().getScriptEngine(ENGINE_OPTIONS,
                NashornDeploymentValidator.class.getClassLoader(), className -> false);
        created.eval(script);
        Object entry = created.get(GLOBAL_NAME);
        if (entry == null) {
            throw new IllegalStateException(SCRIPT + " defines no " + GLOBAL_NAME);
        }
        engine = created;
        validator = entry;
    }

    /** The script's answer, or a refusal when it is not one. */
    static Answer read(Object answer) {
        if (!(answer instanceof String text)) {
            return new Answer(null, "the validator gave no answer");
        }
        JsonNode parsed;
        try {
            parsed = ConfigSnapshot.JSON.readTree(text);
        } catch (IOException e) {
            return new Answer(null, "the validator's answer is not JSON");
        }
        if (parsed != null && parsed.path("refused").isTextual()) {
            return new Answer(null, parsed.get("refused").asText());
        }
        JsonNode findings = parsed == null ? null : parsed.get("findings");
        if (!(findings instanceof ArrayNode list)) {
            return new Answer(null, "the validator's answer has no findings");
        }
        for (JsonNode finding : list) {
            if (!finding.path("message").isTextual() || !finding.path("kind").isTextual()
                    || !finding.path("path").isTextual()) {
                return new Answer(null, "the validator's answer is not a list of findings");
            }
        }
        return new Answer(list, null);
    }

    private static void ids(ArrayNode into, List<String> ids) {
        ids.forEach(into::add);
    }
}
