/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture.ai;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.nuxeo.agentic.capture.CaptureProvider;
import org.nuxeo.agentic.capture.CaptureProviderException;
import org.nuxeo.agentic.capture.CaptureProviderException.Kind;
import org.nuxeo.agentic.capture.CaptureSettings;
import org.nuxeo.agentic.capture.Profile.CaptureClass;
import org.nuxeo.agentic.capture.Profile.CaptureField;
import org.nuxeo.ecm.automation.AutomationService;
import org.nuxeo.ecm.automation.OperationContext;
import org.nuxeo.ecm.automation.OperationException;
import org.nuxeo.ecm.automation.OperationNotFoundException;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The AI package's provider: classification and extraction through the AI package's own
 * Automation operations, in the server's process, as the app's AI features reach them. The AI
 * package holds the model provider, its credentials and its prompts; this class holds none, and
 * adds no client, SDK or address of its own.
 *
 * <p><strong>Off until the server turns it on:</strong> it is used only when the server names it,
 * {@code nuxeo.agentic.capture.provider=ai}, <em>and</em> sets
 * {@value #ENABLED_PROPERTY}{@code =true}, which is to be done only once the AI data terms are
 * approved, since the AI package then sends the item's content to its model provider. Without the
 * second setting, {@link #configured()} is {@code false}, nothing is sent, and every item waits for
 * a person.
 *
 * <p>What it sends each operation: the item's id, {@code docId}, from which the AI package reads the
 * item as the system; and the profile's own definitions, the classes' names, labels and
 * descriptions, or a class's fields', as JSON. No value of the item's, no setting and no
 * credential. What it takes back is checked as any provider's answer is
 * ({@code ConfidenceRule}): at most {@value #MAX_ANSWER} bytes, a class of the profile, fields of
 * the class, confidences from 0 to 1.
 *
 * <ul>
 * <li>{@value #CLASSIFY_PROPERTY}, by default {@value #DEFAULT_CLASSIFY}: given {@code docId} and
 * {@code classesJson}, answers {@code {"class": "<name>" or null, "confidence": <0 to 1>}}.</li>
 * <li>{@value #EXTRACT_PROPERTY}, by default {@value #DEFAULT_EXTRACT}: given {@code docId},
 * {@code class} and {@code fieldsJson}, answers
 * {@code {"fields": [{"name": "<field>", "value": "<text>", "confidence": <0 to 1>}]}}.</li>
 * </ul>
 * An operation's id must begin {@code AI.}: a setting that names another is not used, so this
 * provider can call nothing but the AI package's.
 */
public class AiPackageProvider implements CaptureProvider {

    public static final String ENABLED_PROPERTY = "nuxeo.agentic.capture.ai.enabled";

    public static final String CLASSIFY_PROPERTY = "nuxeo.agentic.capture.ai.classifyOperation";

    public static final String EXTRACT_PROPERTY = "nuxeo.agentic.capture.ai.extractOperation";

    public static final String DEFAULT_CLASSIFY = "AI.CaptureClassify";

    public static final String DEFAULT_EXTRACT = "AI.CaptureExtract";

    static final Pattern OPERATION = Pattern.compile("AI\\.[A-Za-z][A-Za-z0-9]{0,63}");

    static final int MAX_ANSWER = 256 * 1024;

    private static final ObjectMapper JSON = new ObjectMapper();

    private CaptureSettings settings;

    @Override
    public void init(String id, CaptureSettings settings) {
        this.settings = settings;
    }

    @Override
    public boolean configured() {
        return settings != null && settings.isTrue(ENABLED_PROPERTY) && operation(CLASSIFY_PROPERTY, DEFAULT_CLASSIFY) != null
                && operation(EXTRACT_PROPERTY, DEFAULT_EXTRACT) != null;
    }

    /** The operation a setting names, or the default; {@code null} for one that is not the AI package's. */
    String operation(String property, String otherwise) {
        String named = settings.property(property);
        String id = named == null ? otherwise : named;
        return OPERATION.matcher(id).matches() ? id : null;
    }

    @Override
    public Classification classify(Submission submission) throws CaptureProviderException {
        ArrayNode classes = JSON.createArrayNode();
        for (CaptureClass captureClass : submission.profile().classes()) {
            ObjectNode entry = classes.addObject();
            entry.put("name", captureClass.name());
            entry.put("label", captureClass.label());
            if (captureClass.description() != null) {
                entry.put("description", captureClass.description());
            }
        }
        Map<String, Object> params = new HashMap<>();
        params.put("docId", submission.item().getId());
        params.put("classesJson", classes.toString());
        JsonNode answer = call(submission, operation(CLASSIFY_PROPERTY, DEFAULT_CLASSIFY), params);
        JsonNode name = answer.get("class");
        JsonNode confidence = answer.get("confidence");
        return new Classification(name != null && name.isTextual() ? name.asText() : null,
                confidence != null && confidence.isNumber() ? confidence.asDouble() : 0);
    }

    @Override
    public Extraction extract(Submission submission, CaptureClass captureClass) throws CaptureProviderException {
        ArrayNode fields = JSON.createArrayNode();
        for (CaptureField field : captureClass.fields()) {
            ObjectNode entry = fields.addObject();
            entry.put("name", field.name());
            entry.put("label", field.label());
            if (field.description() != null) {
                entry.put("description", field.description());
            }
            if (field.format() != null) {
                entry.put("format", field.format().pattern());
            }
        }
        Map<String, Object> params = new HashMap<>();
        params.put("docId", submission.item().getId());
        params.put("class", captureClass.name());
        params.put("fieldsJson", fields.toString());
        JsonNode answer = call(submission, operation(EXTRACT_PROPERTY, DEFAULT_EXTRACT), params);
        List<ExtractedField> extracted = new ArrayList<>();
        JsonNode list = answer.get("fields");
        if (list != null && list.isArray()) {
            for (JsonNode entry : list) {
                JsonNode name = entry.get("name");
                JsonNode value = entry.get("value");
                JsonNode confidence = entry.get("confidence");
                if (name != null && name.isTextual() && value != null && value.isTextual()) {
                    extracted.add(new ExtractedField(name.asText(), value.asText(),
                            confidence != null && confidence.isNumber() ? confidence.asDouble() : 0));
                }
            }
        }
        return new Extraction(extracted);
    }

    /**
     * The operation run as the system, in a transaction of its own, its answer read as a JSON
     * object. Its own, because Automation marks the transaction it runs in for rollback when an
     * operation fails: the capture's must still commit, to set the item waiting for a person.
     */
    private JsonNode call(Submission submission, String operationId, Map<String, Object> params)
            throws CaptureProviderException {
        if (!configured() || operationId == null) {
            throw new CaptureProviderException(Kind.UNAVAILABLE);
        }
        String repository = submission.item().getRepositoryName();
        Object[] result = new Object[1];
        Kind[] failed = new Kind[1];
        try {
            TransactionHelper.runInNewTransaction(() -> CoreInstance.doPrivileged(repository, (CoreSession system) -> {
                try (OperationContext context = new OperationContext(system)) {
                    Object answer = Framework.getService(AutomationService.class).run(context, operationId, params);
                    // Read within the transaction: a file's stream may need it.
                    result[0] = answer instanceof Blob blob ? bytes(blob) : answer;
                } catch (OperationNotFoundException e) {
                    failed[0] = Kind.UNAVAILABLE;
                } catch (OperationException e) {
                    failed[0] = Kind.FAILED;
                } catch (CaptureProviderException e) {
                    failed[0] = e.kind();
                }
            }));
        } catch (RuntimeException e) {
            throw new CaptureProviderException(failed[0] != null ? failed[0] : Kind.FAILED);
        }
        if (failed[0] != null) {
            throw new CaptureProviderException(failed[0]);
        }
        String text = read(result[0]);
        try {
            JsonNode answer = JSON.readTree(text);
            if (answer == null || !answer.isObject()) {
                throw new CaptureProviderException(Kind.UNREADABLE);
            }
            return answer;
        } catch (IOException e) {
            throw new CaptureProviderException(Kind.UNREADABLE);
        }
    }

    /** A file's bytes, {@value #MAX_ANSWER} at most: one larger is not read on. */
    private static byte[] bytes(Blob blob) throws CaptureProviderException {
        try (InputStream in = blob.getStream()) {
            byte[] bytes = in.readNBytes(MAX_ANSWER + 1);
            if (bytes.length > MAX_ANSWER) {
                throw new CaptureProviderException(Kind.UNREADABLE);
            }
            return bytes;
        } catch (IOException e) {
            throw new CaptureProviderException(Kind.UNREADABLE);
        }
    }

    private static String read(Object result) throws CaptureProviderException {
        if (result instanceof String text) {
            if (text.length() > MAX_ANSWER) {
                throw new CaptureProviderException(Kind.UNREADABLE);
            }
            return text;
        }
        if (result instanceof byte[] bytes) {
            return new String(bytes, StandardCharsets.UTF_8);
        }
        throw new CaptureProviderException(Kind.UNREADABLE);
    }
}
