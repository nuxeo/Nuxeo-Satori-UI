/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import java.io.IOException;
import java.util.Map;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.share.ShareEndpoint.Response;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Serves share links at {@code /nuxeo/agentic-share/}, to visitors who are not signed in.
 *
 * <p><strong>No authentication filter is mapped on this path,</strong> on purpose
 * ({@code OSGI-INF/deployment-fragment.xml}): the visitor has no account, and a signed-in user's
 * session is neither read nor needed. Nothing is decided by who the visitor is: only by the token,
 * through {@link ShareLinkService}, which reads the link's own document and nothing else. That
 * reading needs the system's rights, so each request runs with {@link Framework#doPrivileged}, in
 * a transaction of its own: the download is logged in it, and a request whose transaction does not
 * commit is answered with the refusal, not with the bytes.
 */
public class ShareLinkServlet extends HttpServlet {

    private static final long serialVersionUID = 1L;

    private static final Logger log = LogManager.getLogger(ShareLinkServlet.class);

    @Override
    protected void service(HttpServletRequest request, HttpServletResponse response) throws IOException {
        Response answer;
        try {
            ShareLinkService service = Framework.getService(ShareLinkService.class);
            ShareEndpoint endpoint = new ShareEndpoint(service);
            answer = TransactionHelper.runInTransaction(() -> Framework.doPrivileged(
                    () -> endpoint.respond(request.getMethod(), request.getPathInfo(), request.getContextPath())));
        } catch (RuntimeException | Error e) {
            // An Error too, such as running out of memory while decoding: nothing is served, and the
            // visitor gets the one refusal, not the container's error page.
            log.error("Share links: a request could not be answered, so it is refused", e);
            answer = ShareEndpoint.notAvailable();
        }
        write(answer, response);
    }

    static void write(Response answer, HttpServletResponse response) throws IOException {
        response.setStatus(answer.status());
        for (Map.Entry<String, String> header : answer.headers().entrySet()) {
            if ("Content-Type".equals(header.getKey())) {
                response.setContentType(header.getValue());
            } else {
                response.setHeader(header.getKey(), header.getValue());
            }
        }
        response.setContentLength(answer.body().length);
        if (answer.body().length > 0) {
            response.getOutputStream().write(answer.body());
        }
    }
}
