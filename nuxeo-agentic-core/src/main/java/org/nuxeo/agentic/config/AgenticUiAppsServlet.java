package org.nuxeo.agentic.config;

import java.io.IOException;
import java.io.InputStream;
import java.security.Principal;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.runtime.api.Framework;

/**
 * The app registry, at {@code /nuxeo/agentic-ui-apps/}: the apps a signed-in person may see, and
 * each one's files ({@link AppRegistryEndpoint}), with each app's deployment layer in force; and,
 * below it, the deployment layer's own addresses, for administrators ({@link LayerEndpoint}).
 *
 * After sign-in, unlike the configuration servlet: the deployment fragment maps Nuxeo's
 * authentication filter on this path, and {@code auth-config-agentic.xml} gives it the REST API's
 * chain's plugins, so a request that does not authenticate is answered 401 rather than sent to the
 * login page. On a server that defines an anonymous user, the chain's last plugin makes a request
 * with no credentials {@code Anonymous}, who is in none of an app's groups unless an app names one
 * of theirs, and gets an empty list. A request that reaches this servlet with no Nuxeo principal at
 * all, which the filter mapping rules out, is 401 too, and reads nothing.
 *
 * Which apps a person sees is not a security control ({@link AppRegistryEndpoint}). The registry
 * reads what packages contributed and, when the deployment layer is switched on, its live files;
 * the layer's addresses read and write the layer, for administrators alone ({@link LayerService}).
 *
 * GET and HEAD, and POST to a deployment layer's file: every other method, and POST anywhere else,
 * is answered 405.
 */
public class AgenticUiAppsServlet extends HttpServlet {

    private static final long serialVersionUID = 1L;

    static final String READ_METHODS = "GET, HEAD";

    @Override
    protected void service(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String method = request.getMethod();
        boolean read = "GET".equals(method) || "HEAD".equals(method);
        if (!read) {
            boolean layer = LayerEndpoint.answers(request.getPathInfo());
            if (!layer || !"POST".equals(method)) {
                response.setHeader("Allow", layer ? LayerEndpoint.ALLOWED : READ_METHODS);
                response.setStatus(HttpServletResponse.SC_METHOD_NOT_ALLOWED);
                response.setContentLength(0);
                return;
            }
        }
        AppRegistryEndpoint.Viewer viewer = viewer(request.getUserPrincipal());
        if (viewer == null) {
            response.setHeader("Cache-Control", "no-store");
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentLength(0);
            return;
        }
        String path = request.getPathInfo();
        AppRegistryEndpoint.Response answer;
        if (LayerEndpoint.answers(path)) {
            LayerService layer = layer();
            // The body is read only for an administrator, on a server whose layer is switched on:
            // anyone else is refused before the server reads or parses a byte of it.
            byte[] body = read || !viewer.administrator() || !layer.enabled() ? new byte[0] : body(request);
            answer = new LayerEndpoint(layer).respond(method, path, viewer, request.getContentType(),
                    request.getHeader(LayerEndpoint.CHANGE_HEADER), body);
        } else {
            answer = endpoint().respond(path, viewer, request.getHeader("If-None-Match"));
        }
        response.setStatus(answer.status());
        for (Map.Entry<String, String> header : answer.headers().entrySet()) {
            if ("Content-Type".equals(header.getKey())) {
                response.setContentType(header.getValue());
            } else {
                response.setHeader(header.getKey(), header.getValue());
            }
        }
        response.setContentLength(answer.body().length);
        if (!"HEAD".equals(method) && answer.body().length > 0) {
            response.getOutputStream().write(answer.body());
        }
    }

    /**
     * The request's body, read up to one byte over the limit, so that {@link LayerEndpoint} refuses
     * one over it without this reading more; {@code null} when it says it is over the limit.
     */
    static byte[] body(HttpServletRequest request) throws IOException {
        if (request.getContentLengthLong() > LayerEndpoint.MAX_BODY_BYTES) {
            return null;
        }
        try (InputStream in = request.getInputStream()) {
            return in.readNBytes(LayerEndpoint.MAX_BODY_BYTES + 1);
        }
    }

    /**
     * The person a request is from, or {@code null} when it carries no Nuxeo principal.
     *
     * Every group Nuxeo counts them in: {@code getAllGroups} holds the nested and virtual groups,
     * {@code members} among them for every user but the anonymous one, which is what lets an app
     * written for {@code "members"} reach everyone signed in.
     */
    static AppRegistryEndpoint.Viewer viewer(Principal principal) {
        if (!(principal instanceof NuxeoPrincipal nuxeo)) {
            return null;
        }
        List<String> groups = nuxeo.getAllGroups();
        return new AppRegistryEndpoint.Viewer(nuxeo.getName(),
                groups == null ? Set.of() : groups.stream().filter(Objects::nonNull).collect(Collectors.toSet()),
                nuxeo.isAdministrator());
    }

    /** The configuration component's deployment layer, or one switched off when there is none. */
    static LayerService layer() {
        AgenticUiConfigService service = Framework.getService(AgenticUiConfigService.class);
        return service instanceof AgenticUiConfigComponent component ? component.layerService()
                : LayerService.SWITCHED_OFF;
    }

    /**
     * Rendered once per snapshot, allow-list and live deployment layer, so file bodies and ETags
     * change only when one of them does. The one {@code AgenticUi.RunAction} reads too, so that it
     * runs only what this serves.
     */
    private static AppRegistryEndpoint endpoint() {
        ConfigSnapshot snapshot = Framework.getService(AgenticUiConfigService.class).getSnapshot();
        return AppRegistryEndpoint.current(snapshot, allowList(), layer().live());
    }

    /**
     * The allow-list in force, or none when its component is not there, or when the platform's own
     * operations have been replaced on this server: an app's actions that run an operation are then
     * left out, rather than served unchecked. A deployment layer's queues are checked against the
     * actions it serves ({@link LayerService}).
     */
    static AllowList allowList() {
        OperationAllowListService service = Framework.getService(OperationAllowListService.class);
        return service == null || !service.intact() ? AllowList.EMPTY : service.getAllowList();
    }
}
