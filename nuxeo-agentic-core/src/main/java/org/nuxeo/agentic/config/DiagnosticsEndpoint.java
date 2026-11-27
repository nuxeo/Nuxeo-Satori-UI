package org.nuxeo.agentic.config;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The diagnostics page's address, {@code GET /nuxeo/agentic-ui-apps/diagnostics.json}, below the
 * app registry's servlet, so after sign-in ({@link AgenticUiAppsServlet}): for administrators only,
 * and read only.
 *
 * <ul>
 * <li><b>{@code GET} only.</b> Any other method, {@code HEAD} included, is 405 with {@code Allow:
 * GET}, before the person asking is looked at: the address changes nothing, and takes no body.</li>
 * <li><b>Administrators only, decided on the server.</b> Whoever is not one, by Nuxeo's own {@code
 * isAdministrator}, is answered 403, before the report is built: nothing of the server is read for
 * them. The page's own route guard is for the menu, not the control.</li>
 * <li>Every answer is JSON and {@code no-store}, as the deployment layer's are: the report names the
 * server's packages and configuration, and is not to sit in a cache.</li>
 * </ul>
 *
 * What the report holds, and what it leaves out, is {@link DiagnosticsReport}'s.
 */
final class DiagnosticsEndpoint {

    static final String PATH = "/diagnostics.json";

    static final String ALLOWED = "GET";

    private DiagnosticsEndpoint() {
    }

    /** Whether this answers the path, rather than the registry. */
    static boolean answers(String path) {
        return PATH.equals(path);
    }

    /** The answer to any method but {@code GET}, which is given before the person is looked at. */
    static AppRegistryEndpoint.Response methodNotAllowed() {
        Map<String, String> headers = headers();
        headers.put("Allow", ALLOWED);
        return new AppRegistryEndpoint.Response(405, headers, new byte[0]);
    }

    /**
     * @param viewer the person signed in
     * @param report builds the report; asked only for an administrator
     */
    static AppRegistryEndpoint.Response respond(AppRegistryEndpoint.Viewer viewer, Supplier<ObjectNode> report) {
        if (viewer == null || !viewer.administrator()) {
            return answer(403, LayerService.error(403, "forbidden",
                    "The diagnostics page is for administrators.").body());
        }
        return answer(200, report.get());
    }

    private static AppRegistryEndpoint.Response answer(int status, ObjectNode body) {
        Map<String, String> headers = headers();
        headers.put("Content-Type", ConfigEndpoint.JSON_TYPE);
        try {
            return new AppRegistryEndpoint.Response(status, headers,
                    ConfigSnapshot.JSON.writer(SerializationFeature.INDENT_OUTPUT).writeValueAsBytes(body));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("cannot render the diagnostics report", e);
        }
    }

    private static Map<String, String> headers() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy", ConfigEndpoint.CONTENT_SECURITY_POLICY);
        return headers;
    }
}
