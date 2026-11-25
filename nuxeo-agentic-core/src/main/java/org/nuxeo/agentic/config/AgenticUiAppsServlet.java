package org.nuxeo.agentic.config;

import java.io.IOException;
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
 * each one's files ({@link AppRegistryEndpoint}).
 *
 * After sign-in, unlike the configuration servlet: the deployment fragment maps Nuxeo's
 * authentication filter on this path, and {@code auth-config-agentic.xml} gives it the REST API's
 * chain's plugins, so a request that does not authenticate is answered 401 rather than sent to the
 * login page. On a server that defines an anonymous user, the chain's last plugin makes a request
 * with no credentials {@code Anonymous}, who is in none of an app's groups unless an app names one
 * of theirs, and gets an empty list. A request that reaches this servlet with no Nuxeo principal at
 * all, which the filter mapping rules out, is 401 too, and reads nothing.
 *
 * Which apps a person sees is not a security control ({@link AppRegistryEndpoint}). The servlet
 * reads only what packages contributed; it touches neither the repository nor the filesystem.
 *
 * GET and HEAD only: every other method is answered 405.
 */
public class AgenticUiAppsServlet extends HttpServlet {

    private static final long serialVersionUID = 1L;

    @Override
    protected void service(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String method = request.getMethod();
        boolean withBody = "GET".equals(method);
        if (!withBody && !"HEAD".equals(method)) {
            response.setHeader("Allow", AgenticUiConfigServlet.ALLOWED_METHODS);
            response.setStatus(HttpServletResponse.SC_METHOD_NOT_ALLOWED);
            response.setContentLength(0);
            return;
        }
        AppRegistryEndpoint.Viewer viewer = viewer(request.getUserPrincipal());
        if (viewer == null) {
            response.setHeader("Cache-Control", "no-store");
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentLength(0);
            return;
        }
        AppRegistryEndpoint.Response answer = endpoint().respond(request.getPathInfo(), viewer,
                request.getHeader("If-None-Match"));
        response.setStatus(answer.status());
        for (Map.Entry<String, String> header : answer.headers().entrySet()) {
            if ("Content-Type".equals(header.getKey())) {
                response.setContentType(header.getValue());
            } else {
                response.setHeader(header.getKey(), header.getValue());
            }
        }
        response.setContentLength(answer.body().length);
        if (withBody && answer.body().length > 0) {
            response.getOutputStream().write(answer.body());
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

    /**
     * Rendered once per snapshot and allow-list, so file bodies and ETags change only when one of
     * them does. The one {@code AgenticUi.RunAction} reads too, so that it runs only what this
     * serves.
     */
    private static AppRegistryEndpoint endpoint() {
        ConfigSnapshot snapshot = Framework.getService(AgenticUiConfigService.class).getSnapshot();
        return AppRegistryEndpoint.current(snapshot, allowList());
    }

    /**
     * The allow-list in force, or none when its component is not there: an app's actions that run an
     * operation are then left out, rather than served unchecked.
     */
    static AllowList allowList() {
        OperationAllowListService service = Framework.getService(OperationAllowListService.class);
        return service == null ? AllowList.EMPTY : service.getAllowList();
    }
}
