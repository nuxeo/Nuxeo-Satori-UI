package org.nuxeo.agentic.connectors;

import java.io.IOException;
import java.io.InputStream;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.runtime.api.Framework;

/**
 * Takes change events from systems of record at {@code /nuxeo/agentic-connectors/events/<connector>}
 * ({@link ChangeEvents}).
 *
 * <p><strong>No authentication filter is mapped on this path,</strong> on purpose
 * ({@code OSGI-INF/deployment-fragment.xml}): a system of record has no Nuxeo account, and the
 * connector's events secret is what authenticates it, checked by {@link ChangeEvents} before
 * anything is done. No session is opened, no document read and none written, and no transaction is
 * begun: an event only drops answers kept in memory. The filters the server's {@code web.xml} maps on
 * every path, its CORS and CSRF filter among them, apply here too; the tests run this servlet
 * without them, through a bridge, so how they treat a system's {@code POST} is not tested here.
 *
 * <ul>
 * <li>{@code POST} only: anything else is 405;</li>
 * <li>a path that is not one connector id is 404;</li>
 * <li>a body over {@value ChangeEvents#MAX_BODY_BYTES} bytes is 413, by its {@code Content-Length} or
 * as it is read, and the rest of it is not read;</li>
 * <li>then {@link ChangeEvents#receive}'s status, with no body.</li>
 * </ul>
 */
public class ChangeEventServlet extends HttpServlet {

    private static final long serialVersionUID = 1L;

    private static final Logger log = LogManager.getLogger(ChangeEventServlet.class);

    @Override
    protected void service(HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setHeader("Cache-Control", "no-store");
        if (!"POST".equals(request.getMethod())) {
            response.setHeader("Allow", "POST");
            response.setStatus(HttpServletResponse.SC_METHOD_NOT_ALLOWED);
            return;
        }
        String connector = connectorOf(request.getPathInfo());
        if (connector == null) {
            response.setStatus(HttpServletResponse.SC_NOT_FOUND);
            return;
        }
        if (request.getContentLengthLong() > ChangeEvents.MAX_BODY_BYTES) {
            response.setStatus(ChangeEvents.Outcome.TOO_LARGE.status);
            return;
        }
        byte[] body;
        try (InputStream in = request.getInputStream()) {
            body = in.readNBytes(ChangeEvents.MAX_BODY_BYTES + 1);
        }
        if (body.length > ChangeEvents.MAX_BODY_BYTES) {
            response.setStatus(ChangeEvents.Outcome.TOO_LARGE.status);
            return;
        }
        int status;
        try {
            status = Framework.getService(ConnectorService.class)
                              .changed(connector, request.getHeader(ChangeEvents.TIMESTAMP_HEADER),
                                      request.getHeader(ChangeEvents.NONCE_HEADER),
                                      request.getHeader(ChangeEvents.SIGNATURE_HEADER), body)
                              .outcome().status;
        } catch (RuntimeException e) {
            // The cause's class only: its message could hold what the request sent.
            log.error("Connectors: a change event could not be handled, so it is refused ({})",
                    e.getClass().getSimpleName());
            status = ChangeEvents.Outcome.BUSY.status;
        }
        response.setStatus(status);
    }

    /** The connector id a path names, {@code /<id>}, or {@code null} for any other path. */
    static String connectorOf(String pathInfo) {
        if (pathInfo == null || !pathInfo.startsWith("/")) {
            return null;
        }
        String id = pathInfo.substring(1);
        return Connector.ID.matcher(id).matches() ? id : null;
    }
}
