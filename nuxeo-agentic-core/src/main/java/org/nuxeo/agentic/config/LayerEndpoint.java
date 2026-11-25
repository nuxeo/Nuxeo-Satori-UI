package org.nuxeo.agentic.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The deployment layer's addresses, below the app registry's, {@code /nuxeo/agentic-ui-apps/}, for
 * administrators ({@link LayerService}):
 *
 * <ul>
 * <li>{@code GET layer.json}: every app's files whose override is in force, with their versions,
 * for the upgrade check;</li>
 * <li>{@code GET apps/<id>/layer.json}: one app's layer, file by file;</li>
 * <li>{@code GET apps/<id>/layer/<path>}: one file's package, live and draft versions, its versions
 * and its trail, and what the person asking may do with it;</li>
 * <li>{@code POST apps/<id>/layer/<path>}: one change, {@code { "action", "revision", "content"?,
 * "to"? }}, answered with the file as it is then.</li>
 * </ul>
 *
 * A change is accepted only as {@code application/json} and with the header {@value #CHANGE_HEADER},
 * which a page on another site can send only after a CORS preflight, and this path answers no
 * preflight: a form or a link elsewhere cannot make one with an administrator's session cookie. Its
 * body is at most {@value #MAX_BODY_BYTES} bytes, JSON nested at most {@value #MAX_DEPTH} deep, with
 * no repeated key. Every answer is JSON and {@code no-store}: drafts and versions are not to sit in
 * any cache.
 */
final class LayerEndpoint {

    static final String EXPORT_PATH = "/layer.json";

    static final String CHANGE_HEADER = "X-Agentic-Layer-Change";

    static final int MAX_BODY_BYTES = ConfigSnapshot.MAX_JSON_BYTES + 64 * 1024;

    static final int MAX_DEPTH = 512;

    static final String ALLOWED = "GET, HEAD, POST";

    private static final Pattern APP_LAYER = Pattern.compile("/apps/([a-z][a-z0-9-]{0,62})/layer(\\.json|/(.+))");

    private final LayerService service;

    LayerEndpoint(LayerService service) {
        this.service = service;
    }

    /** Whether the deployment layer answers this path, rather than the registry. */
    static boolean answers(String path) {
        return path != null && (EXPORT_PATH.equals(path) || APP_LAYER.matcher(path).matches());
    }

    /**
     * @param method the request's method
     * @param path the path below {@code /agentic-ui-apps}, as the container decoded it
     * @param contentType the request's {@code Content-Type}, or {@code null}
     * @param changeHeader the request's {@value #CHANGE_HEADER}, or {@code null}
     * @param body the request's body, read up to one byte over {@value #MAX_BODY_BYTES}
     */
    AppRegistryEndpoint.Response respond(String method, String path, AppRegistryEndpoint.Viewer viewer,
            String contentType, String changeHeader, byte[] body) {
        boolean read = "GET".equals(method) || "HEAD".equals(method);
        if (!read && !"POST".equals(method)) {
            Map<String, String> headers = headers();
            headers.put("Allow", ALLOWED);
            return new AppRegistryEndpoint.Response(405, headers, new byte[0]);
        }
        if (EXPORT_PATH.equals(path)) {
            return read ? answer(service.export(viewer)) : notAllowed("GET, HEAD");
        }
        Matcher matcher = APP_LAYER.matcher(path);
        if (!matcher.matches()) {
            return answer(LayerService.error(404, "not-found", "No such address."));
        }
        String app = matcher.group(1);
        String file = matcher.group(3);
        if (file == null) {
            return read ? answer(service.summary(app, viewer)) : notAllowed("GET, HEAD");
        }
        if (read) {
            return answer(service.state(app, file, viewer));
        }
        // Who may change, and what, before the body is looked at: `act` refuses it again, the same
        // way, and logs the refusal with who asked.
        if (service.refusal(viewer, app, file) != null) {
            return answer(service.act(app, file, viewer, null));
        }
        if (!isJson(contentType)) {
            return answer(LayerService.error(415, "not-json", "A change is sent as application/json."));
        }
        if (changeHeader == null || changeHeader.isBlank()) {
            return answer(LayerService.error(403, "no-change-header",
                    "A change carries the " + CHANGE_HEADER + " header, which a page on another site cannot send."));
        }
        if (body == null || body.length > MAX_BODY_BYTES) {
            return answer(LayerService.error(413, "too-large",
                    "A change is at most " + MAX_BODY_BYTES + " bytes."));
        }
        JsonNode request;
        try {
            request = parse(body);
        } catch (IOException e) {
            return answer(LayerService.error(400, "bad-request", "The change is not JSON: " + firstLine(e)));
        }
        return answer(service.act(app, file, viewer, request));
    }

    /**
     * The body, parsed strictly: no repeated key, nothing after the value, and nested no deeper than
     * {@value #MAX_DEPTH}, which is checked token by token before a tree is built, so that a deep body
     * cannot exhaust a stack here or in the validator.
     */
    static JsonNode parse(byte[] body) throws IOException {
        try (JsonParser parser = ConfigSnapshot.JSON.getFactory().createParser(body)) {
            int depth = 0;
            for (JsonToken token = parser.nextToken(); token != null; token = parser.nextToken()) {
                if (token == JsonToken.START_OBJECT || token == JsonToken.START_ARRAY) {
                    if (++depth > MAX_DEPTH) {
                        throw new IOException("it is nested deeper than " + MAX_DEPTH + " levels");
                    }
                } else if (token == JsonToken.END_OBJECT || token == JsonToken.END_ARRAY) {
                    depth--;
                }
            }
        }
        return ConfigSnapshot.JSON.readTree(new String(body, StandardCharsets.UTF_8));
    }

    private static boolean isJson(String contentType) {
        if (contentType == null) {
            return false;
        }
        String type = contentType.split(";", 2)[0].strip().toLowerCase(Locale.ROOT);
        return "application/json".equals(type);
    }

    private static String firstLine(IOException e) {
        String message = e instanceof JsonProcessingException json ? json.getOriginalMessage() : e.getMessage();
        return message == null ? e.getClass().getSimpleName() : message.lines().findFirst().orElse("");
    }

    private static AppRegistryEndpoint.Response notAllowed(String allowed) {
        Map<String, String> headers = headers();
        headers.put("Allow", allowed);
        return new AppRegistryEndpoint.Response(405, headers, new byte[0]);
    }

    private static AppRegistryEndpoint.Response answer(LayerService.Outcome outcome) {
        Map<String, String> headers = headers();
        headers.put("Content-Type", ConfigEndpoint.JSON_TYPE);
        ObjectNode body = outcome.body();
        byte[] bytes;
        try {
            bytes = ConfigSnapshot.JSON.writeValueAsBytes(body);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("cannot render a deployment layer answer", e);
        }
        return new AppRegistryEndpoint.Response(outcome.status(), headers, bytes);
    }

    private static Map<String, String> headers() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy", ConfigEndpoint.CONTENT_SECURITY_POLICY);
        return headers;
    }
}
