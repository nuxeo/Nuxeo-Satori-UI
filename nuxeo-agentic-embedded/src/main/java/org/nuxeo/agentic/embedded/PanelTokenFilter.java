package org.nuxeo.agentic.embedded;

import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.runtime.api.Framework;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Holds every request to the REST API that carries a panel's token to {@link PanelTokenGuard}'s rule,
 * before the request reaches it. Mapped on {@code /api/*}, where the REST API is asked, and on
 * {@code /site/*}, for a request and a forward, where the server forwards it and authenticates it: so
 * on every path the platform's JWT authenticator would sign a panel's token in on. A request with no
 * panel's token passes untouched.
 *
 * It reads the same places the authenticator reads a token from: the {@code Authorization: Bearer}
 * header, and the {@code access_token} parameter, of the address always, and of a form body when the
 * request has no {@code Authorization} header, which is when the authenticator reads it.
 */
public class PanelTokenFilter implements Filter {

    private static final Logger log = LogManager.getLogger(PanelTokenFilter.class);

    static final List<String> METHOD_OVERRIDES = List.of("X-HTTP-Method-Override", "X-HTTP-Method",
            "X-Method-Override");

    /** The service; package-private for tests, which have no runtime. */
    EmbeddedPanelService service;

    EmbeddedPanelService service() {
        return service != null ? service : Framework.getService(EmbeddedPanelService.class);
    }

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain chain)
            throws IOException, ServletException {
        if (!(servletRequest instanceof HttpServletRequest request)
                || !(servletResponse instanceof HttpServletResponse response)) {
            chain.doFilter(servletRequest, servletResponse);
            return;
        }
        PanelTokenGuard.Request read = read(request);
        EmbeddedPanelService panels = service();
        PanelTokenGuard.Decision decision;
        if (panels != null) {
            decision = panels.check(read);
        } else {
            boolean panelToken = PanelTokenGuard.claimsAHost(PanelTokenGuard.bearer(read.authorization()))
                    || PanelTokenGuard.claimsAHost(read.queryToken()) || PanelTokenGuard.claimsAHost(read.formToken());
            decision = panelToken ? new PanelTokenGuard.Decision(503, "the server is starting")
                    : PanelTokenGuard.Decision.PASS;
        }
        if (decision.passes()) {
            chain.doFilter(request, response);
            return;
        }
        log.debug("Embedded panels: {} {} refused, {}: {}", read.method(), read.path(), decision.status(),
                decision.reason());
        if (decision.status() == 401) {
            response.setHeader("WWW-Authenticate", "Bearer error=\"invalid_token\"");
        } else if (decision.status() == 403) {
            response.setHeader("WWW-Authenticate", "Bearer error=\"insufficient_scope\"");
        }
        EmbeddedPanelServlet.write(response, decision.status(),
                Map.of("status", decision.status(), "message", "refused for an embedded panel's token"));
    }

    static PanelTokenGuard.Request read(HttpServletRequest request) {
        String path = (request.getServletPath() == null ? "" : request.getServletPath())
                + (request.getPathInfo() == null ? "" : request.getPathInfo());
        String authorization = request.getHeader("Authorization");
        String formToken = null;
        String type = request.getContentType();
        if (authorization == null && "POST".equals(request.getMethod()) && type != null
                && type.toLowerCase(Locale.ROOT).startsWith(EmbeddedPanelServlet.FORM)) {
            formToken = request.getParameter("access_token");
        }
        boolean override = METHOD_OVERRIDES.stream().anyMatch(name -> request.getHeader(name) != null)
                || queryParameter(request.getQueryString(), "_method") != null;
        return new PanelTokenGuard.Request(request.getMethod(), path, request.getRequestURI(), authorization,
                queryParameter(request.getQueryString(), "access_token"), formToken, request.getHeader("Origin"),
                override);
    }

    /** A parameter of the address, decoded, read without the servlet's parameter parsing. */
    static String queryParameter(String query, String name) {
        if (query == null) {
            return null;
        }
        for (String pair : query.split("&")) {
            int equals = pair.indexOf('=');
            String key = equals < 0 ? pair : pair.substring(0, equals);
            try {
                if (name.equals(URLDecoder.decode(key, StandardCharsets.UTF_8))) {
                    return equals < 0 ? "" : URLDecoder.decode(pair.substring(equals + 1), StandardCharsets.UTF_8);
                }
            } catch (IllegalArgumentException e) {
                // Not decodable: the servlet would not read it as this parameter either.
            }
        }
        return null;
    }
}
