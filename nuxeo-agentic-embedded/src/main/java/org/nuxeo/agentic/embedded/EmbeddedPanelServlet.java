package org.nuxeo.agentic.embedded;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.nuxeo.runtime.api.Framework;

import com.fasterxml.jackson.databind.ObjectMapper;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * The embedded panels' two addresses, below {@code /nuxeo/agentic-embedded/}, outside Nuxeo's
 * authentication filter: neither is called as a Nuxeo user.
 *
 * <ul>
 * <li><b>{@code POST v1/token}</b>, the token exchange ({@link TokenExchange}), which a host's server
 * calls, never a browser: it answers with no CORS header, so no page can read its answer. The host
 * authenticates with HTTP Basic, its id and its client secret, and the parameters are a form body
 * of at most 16 KiB: none in the address, each once, no client secret in the body. Every answer has
 * {@code Cache-Control: no-store}.</li>
 * <li><b>{@code GET v1/hosts/<id>}</b>, what a panel reads before it asks its page for a token: the
 * host's origins, to the host's pages only. Answered when the request's {@code Origin} is one of the
 * host's; else 404, the same for a host that is not registered and for a page that is not the host's,
 * so the address tells another page nothing but that it is not one. The page that asked may read
 * either answer (CORS), so that a panel on another page says it is refused.</li>
 * </ul>
 */
public class EmbeddedPanelServlet extends HttpServlet {

    private static final long serialVersionUID = 1L;

    static final int MAX_BODY = 16 * 1024;

    static final String FORM = "application/x-www-form-urlencoded";

    private static final ObjectMapper JSON = new ObjectMapper();

    /** The service; package-private for tests, which have no runtime. */
    transient EmbeddedPanelService service;

    EmbeddedPanelService service() {
        return service != null ? service : Framework.getService(EmbeddedPanelService.class);
    }

    @Override
    protected void service(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String path = request.getPathInfo() == null ? "" : request.getPathInfo();
        if ("/v1/token".equals(path)) {
            if (!"POST".equals(request.getMethod())) {
                response.setHeader("Allow", "POST");
                write(response, 405, Map.of("error", "invalid_request", "error_description", "POST only"));
                return;
            }
            token(request, response);
            return;
        }
        if (path.startsWith("/v1/hosts/")) {
            if (!"GET".equals(request.getMethod())) {
                response.setHeader("Allow", "GET");
                write(response, 405, Map.of("error", "invalid_request", "error_description", "GET only"));
                return;
            }
            host(path.substring("/v1/hosts/".length()), request, response);
            return;
        }
        write(response, 404, Map.of("error", "not_found"));
    }

    private void token(HttpServletRequest request, HttpServletResponse response) throws IOException {
        EmbeddedPanelService panels = service();
        if (panels == null) {
            write(response, 503, Map.of("error", "server_error", "error_description", "the server is starting"));
            return;
        }
        if (request.getQueryString() != null) {
            write(response, 400, Map.of("error", "invalid_request", "error_description",
                    "the parameters are a form body, never in the address"));
            return;
        }
        String type = request.getContentType();
        if (type == null || !type.toLowerCase(Locale.ROOT).startsWith(FORM)) {
            write(response, 400,
                    Map.of("error", "invalid_request", "error_description", "the body is " + FORM));
            return;
        }
        Map<String, List<String>> parameters;
        try {
            parameters = form(request);
        } catch (IllegalArgumentException e) {
            write(response, 400, Map.of("error", "invalid_request", "error_description", e.getMessage()));
            return;
        }
        if (parameters.containsKey("client_secret") || parameters.containsKey("client_id")) {
            write(response, 401, Map.of("error", "invalid_client", "error_description",
                    "the client authenticates with HTTP Basic, never in the body"));
            return;
        }
        String[] credentials = basic(request.getHeader("Authorization"));
        TokenExchange.Result result = panels.exchange(credentials == null ? null : credentials[0],
                credentials == null ? null : credentials[1], parameters);
        if (result.status() == 401) {
            response.setHeader("WWW-Authenticate", "Basic realm=\"agentic-embedded\"");
        }
        write(response, result.status(), result.body());
    }

    private void host(String id, HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setHeader("Vary", "Origin");
        EmbeddedPanelService panels = service();
        String origin = request.getHeader("Origin");
        Host host = panels == null || !Host.ID.matcher(id).matches() ? null : panels.getHost(id);
        if (origin != null && Host.origin(origin) != null) {
            // The page that asked may read the answer, a refusal too, so that a panel on a page its host
            // does not name says so rather than failing on CORS. A refusal holds nothing: the same 404
            // for a host that is not registered and for a page that is not the host's.
            response.setHeader("Access-Control-Allow-Origin", origin);
        }
        if (host == null || origin == null || !host.origins().contains(origin)) {
            write(response, 404, Map.of("error", "not_found"));
            return;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("host", host.id());
        body.put("origins", new ArrayList<>(host.origins()));
        write(response, 200, body);
    }

    /** The form body's parameters, each with every value it was given, read up to {@link #MAX_BODY}. */
    static Map<String, List<String>> form(HttpServletRequest request) throws IOException {
        if (request.getContentLengthLong() > MAX_BODY) {
            throw new IllegalArgumentException("the body is larger than " + MAX_BODY + " bytes");
        }
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        try (InputStream in = request.getInputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = in.read(buffer)) != -1) {
                body.write(buffer, 0, read);
                if (body.size() > MAX_BODY) {
                    throw new IllegalArgumentException("the body is larger than " + MAX_BODY + " bytes");
                }
            }
        }
        return parse(body.toString(StandardCharsets.US_ASCII));
    }

    static Map<String, List<String>> parse(String body) {
        Map<String, List<String>> parameters = new LinkedHashMap<>();
        if (body.isEmpty()) {
            return parameters;
        }
        for (String pair : body.split("&")) {
            if (pair.isEmpty()) {
                continue;
            }
            int equals = pair.indexOf('=');
            String name = decode(equals < 0 ? pair : pair.substring(0, equals));
            String value = equals < 0 ? "" : decode(pair.substring(equals + 1));
            parameters.computeIfAbsent(name, k -> new ArrayList<>()).add(value);
        }
        return parameters;
    }

    private static String decode(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("the body is not a form");
        }
    }

    /**
     * The id and secret of an {@code Authorization: Basic} header, each form-decoded as RFC 6749,
     * section 2.3.1, says, or {@code null}.
     */
    static String[] basic(String authorization) {
        if (authorization == null || !authorization.regionMatches(true, 0, "Basic ", 0, 6)) {
            return null;
        }
        String decoded;
        try {
            decoded = new String(Base64.getDecoder().decode(authorization.substring(6).trim()),
                    StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return null;
        }
        int colon = decoded.indexOf(':');
        if (colon <= 0) {
            return null;
        }
        try {
            return new String[] { URLDecoder.decode(decoded.substring(0, colon), StandardCharsets.UTF_8),
                    URLDecoder.decode(decoded.substring(colon + 1), StandardCharsets.UTF_8) };
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    static void write(HttpServletResponse response, int status, Map<String, ?> body) throws IOException {
        response.setStatus(status);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Pragma", "no-cache");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getOutputStream().write(JSON.writeValueAsBytes(body));
    }
}
