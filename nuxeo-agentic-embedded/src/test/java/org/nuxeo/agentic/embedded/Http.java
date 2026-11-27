package org.nuxeo.agentic.embedded;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/** A request and a response, as the servlet and the filter read and write them, with no container. */
final class Http {

    private Http() {
    }

    /** A request: its method, its paths, its headers, its address's parameters and its body. */
    static final class Request {

        String method = "GET";

        String servletPath = "/agentic-embedded";

        String pathInfo;

        String requestUri;

        String query;

        String contentType;

        byte[] body = new byte[0];

        final Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);

        final Map<String, String> parameters = new LinkedHashMap<>();

        boolean parametersRead;

        Request header(String name, String value) {
            headers.put(name, value);
            return this;
        }

        HttpServletRequest proxy() {
            return (HttpServletRequest) Proxy.newProxyInstance(Http.class.getClassLoader(),
                    new Class<?>[] { HttpServletRequest.class }, (self, call, args) -> switch (call.getName()) {
                    case "getMethod" -> method;
                    case "getServletPath" -> servletPath;
                    case "getPathInfo" -> pathInfo;
                    case "getRequestURI" -> requestUri != null ? requestUri : "/nuxeo" + servletPath + pathInfo;
                    case "getQueryString" -> query;
                    case "getContentType" -> contentType;
                    case "getContentLengthLong" -> (long) body.length;
                    case "getContentLength" -> body.length;
                    case "getHeader" -> headers.get((String) args[0]);
                    case "getParameter" -> {
                        parametersRead = true;
                        yield parameters.get((String) args[0]);
                    }
                    case "getInputStream" -> input(body);
                    case "toString" -> method + " " + servletPath + pathInfo;
                    default -> throw new UnsupportedOperationException(call.getName());
                    });
        }
    }

    /** A response: its status, its headers and its body. */
    static final class Response {

        int status = 200;

        final Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);

        final ByteArrayOutputStream body = new ByteArrayOutputStream();

        String body() {
            return body.toString(StandardCharsets.UTF_8);
        }

        HttpServletResponse proxy() {
            return (HttpServletResponse) Proxy.newProxyInstance(Http.class.getClassLoader(),
                    new Class<?>[] { HttpServletResponse.class }, (self, call, args) -> switch (call.getName()) {
                    case "setStatus" -> {
                        status = (Integer) args[0];
                        yield null;
                    }
                    case "setHeader" -> {
                        headers.put((String) args[0], (String) args[1]);
                        yield null;
                    }
                    case "setContentType" -> {
                        headers.put("Content-Type", (String) args[0]);
                        yield null;
                    }
                    case "setCharacterEncoding" -> null;
                    case "getOutputStream" -> output(body);
                    case "toString" -> "response " + status;
                    default -> throw new UnsupportedOperationException(call.getName());
                    });
        }
    }

    static ServletInputStream input(byte[] bytes) {
        ByteArrayInputStream in = new ByteArrayInputStream(bytes);
        return new ServletInputStream() {
            @Override
            public int read() {
                return in.read();
            }

            @Override
            public boolean isFinished() {
                return in.available() == 0;
            }

            @Override
            public boolean isReady() {
                return true;
            }

            @Override
            public void setReadListener(ReadListener listener) {
                throw new UnsupportedOperationException();
            }
        };
    }

    static ServletOutputStream output(ByteArrayOutputStream out) {
        return new ServletOutputStream() {
            @Override
            public void write(int b) {
                out.write(b);
            }

            @Override
            public boolean isReady() {
                return true;
            }

            @Override
            public void setWriteListener(WriteListener listener) {
                throw new UnsupportedOperationException();
            }
        };
    }
}
