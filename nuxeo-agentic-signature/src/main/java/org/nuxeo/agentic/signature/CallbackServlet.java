/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import java.io.IOException;
import java.io.InputStream;
import java.time.Clock;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.repository.RepositoryManager;
import org.nuxeo.runtime.api.Framework;

/**
 * Answers providers' callbacks at {@code /nuxeo/agentic-signature/callback/<provider id>}, with no
 * sign-in ({@code OSGI-INF/deployment-fragment.xml}): {@link CallbackEndpoint} decides, by the
 * provider's authentication alone. The servlet reads at most {@value CallbackEndpoint#MAX_BODY}
 * bytes of a body, and refuses a larger one, by its declared length unread; it gives the endpoint
 * the headers, by lower-case name, and the default repository, where requests are looked for.
 */
public class CallbackServlet extends HttpServlet {

    private static final long serialVersionUID = 1L;

    private static final Logger log = LogManager.getLogger(CallbackServlet.class);

    /** The most headers taken, and the longest name and value: a callback needs a few short ones. */
    static final int MAX_HEADERS = 64;

    static final int MAX_HEADER_LENGTH = 4096;

    @Override
    protected void service(HttpServletRequest request, HttpServletResponse response) throws IOException {
        CallbackEndpoint.Response answer;
        try {
            if (request.getContentLengthLong() > CallbackEndpoint.MAX_BODY) {
                answer = CallbackEndpoint.TOO_LARGE;
            } else {
                byte[] body = read(request.getInputStream());
                if (body == null) {
                    answer = CallbackEndpoint.TOO_LARGE;
                } else {
                    String repository = Framework.getService(RepositoryManager.class).getDefaultRepositoryName();
                    answer = new CallbackEndpoint(Framework.getService(SignatureService.class), Clock.systemUTC(),
                            repository).respond(request.getMethod(), request.getPathInfo(), headers(request), body);
                }
            }
        } catch (RuntimeException | Error e) {
            // Nothing is acted on, and the provider gets the one refusal, not the container's error page.
            log.error("E-signature: a callback could not be answered ({})", e.getClass().getSimpleName());
            answer = CallbackEndpoint.UNAVAILABLE;
        }
        byte[] bytes = answer.bytes();
        response.setStatus(answer.status());
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control", "no-store");
        response.setContentLength(bytes.length);
        response.getOutputStream().write(bytes);
    }

    /** The body, whole, or {@code null} when it is larger than the bound. */
    static byte[] read(InputStream in) throws IOException {
        if (in == null) {
            return new byte[0];
        }
        byte[] body = in.readNBytes(CallbackEndpoint.MAX_BODY + 1);
        return body.length > CallbackEndpoint.MAX_BODY ? null : body;
    }

    private static Map<String, String> headers(HttpServletRequest request) {
        Map<String, String> headers = new HashMap<>();
        if (request.getHeaderNames() == null) {
            return headers;
        }
        for (String name : Collections.list(request.getHeaderNames())) {
            if (headers.size() >= MAX_HEADERS) {
                break;
            }
            String value = request.getHeader(name);
            if (name.length() <= MAX_HEADER_LENGTH && value != null && value.length() <= MAX_HEADER_LENGTH) {
                headers.putIfAbsent(name.toLowerCase(Locale.ROOT), value);
            }
        }
        return headers;
    }
}
