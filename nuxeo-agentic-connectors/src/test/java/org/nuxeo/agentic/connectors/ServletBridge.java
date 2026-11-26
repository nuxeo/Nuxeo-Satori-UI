package org.nuxeo.agentic.connectors;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Proxy;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executors;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * The change events' servlet, {@link ChangeEventServlet}, served over HTTP on the loopback interface
 * as Nuxeo maps it, {@code /nuxeo/agentic-connectors/events/*}, so that the stand-in core system
 * sends its events as it would to a server. The test runtime has no servlet container: this hands
 * each request to the servlet's own {@code service}, with the method, the path after the mapping,
 * the headers, the declared length and the body as a container gives them, and sends back the
 * status and headers it sets. Only what the servlet asks of a request is answered.
 */
final class ServletBridge implements AutoCloseable {

    static final String CONTEXT = "/nuxeo/agentic-connectors/events";

    private final HttpServer server;

    private final ChangeEventServlet servlet = new ChangeEventServlet();

    /** How many bytes of its body the servlet read, for the last request: a bound is what it reads. */
    final java.util.concurrent.atomic.AtomicLong lastRead = new java.util.concurrent.atomic.AtomicLong();

    ServletBridge() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.setExecutor(Executors.newCachedThreadPool());
        server.createContext(CONTEXT, this::handle);
        server.start();
    }

    /** Where events are sent: {@code http://127.0.0.1:<port>/nuxeo/agentic-connectors/events}. */
    String events() {
        return "http://" + server.getAddress().getHostString() + ":" + server.getAddress().getPort() + CONTEXT;
    }

    private void handle(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        String pathInfo = path.length() > CONTEXT.length() ? path.substring(CONTEXT.length()) : null;
        String length = exchange.getRequestHeaders().getFirst("Content-Length");
        InputStream body = exchange.getRequestBody();
        lastRead.set(0);
        ServletInputStream in = new ServletInputStream() {
            private boolean finished;

            @Override
            public int read() throws IOException {
                int b = body.read();
                finished = b < 0;
                if (!finished) {
                    lastRead.incrementAndGet();
                }
                return b;
            }

            @Override
            public int read(byte[] buffer, int offset, int count) throws IOException {
                int n = body.read(buffer, offset, count);
                finished = n < 0;
                if (n > 0) {
                    lastRead.addAndGet(n);
                }
                return n;
            }

            @Override
            public boolean isFinished() {
                return finished;
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
        HttpServletRequest request = (HttpServletRequest) Proxy.newProxyInstance(getClass().getClassLoader(),
                new Class<?>[] { HttpServletRequest.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getMethod" -> exchange.getRequestMethod();
                case "getPathInfo" -> pathInfo;
                case "getHeader" -> exchange.getRequestHeaders().getFirst((String) args[0]);
                case "getContentLengthLong" -> length == null ? -1L : Long.parseLong(length);
                case "getInputStream" -> in;
                default -> throw new UnsupportedOperationException(method.getName());
                });
        int[] status = { 200 };
        Map<String, String> headers = new LinkedHashMap<>();
        HttpServletResponse response = (HttpServletResponse) Proxy.newProxyInstance(getClass().getClassLoader(),
                new Class<?>[] { HttpServletResponse.class }, (proxy, method, args) -> switch (method.getName()) {
                case "setStatus" -> {
                    status[0] = (Integer) args[0];
                    yield null;
                }
                case "setHeader" -> {
                    headers.put((String) args[0], (String) args[1]);
                    yield null;
                }
                default -> throw new UnsupportedOperationException(method.getName());
                });
        try {
            servlet.service(request, response);
        } catch (RuntimeException e) {
            status[0] = 500;
        }
        headers.forEach((name, value) -> exchange.getResponseHeaders().set(name, value));
        exchange.sendResponseHeaders(status[0], -1);
        exchange.close();
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
