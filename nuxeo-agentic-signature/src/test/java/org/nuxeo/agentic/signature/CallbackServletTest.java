/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.junit.Test;

/**
 * The servlet on its own, with no Nuxeo runtime: the body's bound, by its declared length unread
 * and by what arrives, and the headers it gives the endpoint, by lower-case name, bounded. What
 * the endpoint decides is {@link CallbackTest}'s.
 */
public class CallbackServletTest {

    /** A request of the method, headers and body; {@code read} says whether the body was read at all. */
    private static HttpServletRequest request(String method, Map<String, String> headers, long declared, byte[] body,
            AtomicBoolean read) {
        InputStream bytes = new ByteArrayInputStream(body);
        ServletInputStream in = new ServletInputStream() {
            @Override
            public int read() throws IOException {
                read.set(true);
                return bytes.read();
            }

            @Override
            public int read(byte[] b, int off, int len) throws IOException {
                read.set(true);
                return bytes.read(b, off, len);
            }

            @Override
            public boolean isFinished() {
                return false;
            }

            @Override
            public boolean isReady() {
                return true;
            }

            @Override
            public void setReadListener(ReadListener listener) {
                // Not asynchronous.
            }
        };
        return (HttpServletRequest) Proxy.newProxyInstance(CallbackServletTest.class.getClassLoader(),
                new Class<?>[] { HttpServletRequest.class }, (proxy, m, args) -> switch (m.getName()) {
                    case "getMethod" -> method;
                    case "getPathInfo" -> "/callback/standin";
                    case "getContentLengthLong" -> declared;
                    case "getInputStream" -> in;
                    case "getHeaderNames" -> Collections.enumeration(headers.keySet());
                    case "getHeader" -> headers.get((String) args[0]);
                    default -> null;
                });
    }

    /** A response that keeps its status and its body. */
    private static HttpServletResponse response(AtomicInteger status, ByteArrayOutputStream body) {
        ServletOutputStream out = new ServletOutputStream() {
            @Override
            public void write(int b) {
                body.write(b);
            }

            @Override
            public boolean isReady() {
                return true;
            }

            @Override
            public void setWriteListener(WriteListener listener) {
                // Not asynchronous.
            }
        };
        return (HttpServletResponse) Proxy.newProxyInstance(CallbackServletTest.class.getClassLoader(),
                new Class<?>[] { HttpServletResponse.class }, (proxy, m, args) -> {
                    if ("setStatus".equals(m.getName())) {
                        status.set((Integer) args[0]);
                    }
                    return "getOutputStream".equals(m.getName()) ? out : null;
                });
    }

    @Test
    public void aBodyDeclaredLargerThanTheBoundIsRefusedUnread() throws Exception {
        AtomicBoolean read = new AtomicBoolean();
        AtomicInteger status = new AtomicInteger();
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        new CallbackServlet().service(request("POST", Map.of(), CallbackEndpoint.MAX_BODY + 1L,
                new byte[CallbackEndpoint.MAX_BODY + 1], read), response(status, body));
        assertEquals(413, status.get());
        assertEquals(false, read.get());
        assertArrayEquals(CallbackEndpoint.TOO_LARGE.bytes(), body.toByteArray());
    }

    @Test
    public void aBodyLargerThanTheBoundAsItArrivesIsRefused() throws Exception {
        AtomicInteger status = new AtomicInteger();
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        // No length declared, as a chunked request has none.
        new CallbackServlet().service(request("POST", Map.of(), -1L, new byte[CallbackEndpoint.MAX_BODY + 1],
                new AtomicBoolean()), response(status, body));
        assertEquals(413, status.get());
        assertNull(CallbackServlet.read(new ByteArrayInputStream(new byte[CallbackEndpoint.MAX_BODY + 1])));
        assertEquals(CallbackEndpoint.MAX_BODY,
                CallbackServlet.read(new ByteArrayInputStream(new byte[CallbackEndpoint.MAX_BODY])).length);
    }

    @Test
    public void headersReachTheEndpointByLowerCaseNameAndBounded() {
        Map<String, String> sent = new LinkedHashMap<>();
        sent.put("X-StandIn-Signature", "t=1,v1=" + "a".repeat(64));
        sent.put("Content-Type", "application/json");
        sent.put("X-Long", "x".repeat(CallbackServlet.MAX_HEADER_LENGTH + 1));
        for (int i = 0; i < 100; i++) {
            sent.put("X-Filler-" + i, "v");
        }
        Map<String, String> headers = CallbackServlet.headers(request("POST", sent, 0, new byte[0],
                new AtomicBoolean()));
        assertEquals("t=1,v1=" + "a".repeat(64), headers.get("x-standin-signature"));
        assertEquals("application/json", headers.get("content-type"));
        assertTrue(!headers.containsKey("x-long"));
        assertTrue(headers.size() <= CallbackServlet.MAX_HEADERS);
        // And the endpoint's callback reads them in any case.
        assertEquals("application/json", new Callback(new HashMap<>(headers), new byte[0]).header("Content-Type"));
    }

    @Test
    public void anUnforeseenFailureIsTheOneRefusalNotTheContainersPage() throws Exception {
        AtomicInteger status = new AtomicInteger();
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        // No Nuxeo runtime here, so no service: the servlet answers its one refusal.
        new CallbackServlet().service(request("POST", Map.of(), 2, "{}".getBytes(StandardCharsets.UTF_8),
                new AtomicBoolean()), response(status, body));
        assertEquals(503, status.get());
        assertArrayEquals(CallbackEndpoint.UNAVAILABLE.bytes(), body.toByteArray());
    }
}
