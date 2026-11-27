package org.nuxeo.agentic.embedded;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The servlet's two addresses: the exchange, and a host's origins for its panels. */
class EmbeddedPanelServletTest {

    private EmbeddedPanelServlet servlet;

    private final AtomicReference<Map<String, List<String>>> received = new AtomicReference<>();

    private final AtomicReference<String[]> credentials = new AtomicReference<>();

    @BeforeEach
    void setUp() {
        servlet = new EmbeddedPanelServlet();
        Host host = Fixtures.host();
        servlet.service = new EmbeddedPanelService() {
            @Override
            public Host getHost(String id) {
                return host.id().equals(id) ? host : null;
            }

            @Override
            public TokenExchange.Result exchange(String clientId, String clientSecret,
                    Map<String, List<String>> parameters) {
                credentials.set(new String[] { clientId, clientSecret });
                received.set(parameters);
                return clientId == null ? TokenExchange.Result.error(401, "invalid_client", "no")
                        : new TokenExchange.Result(200, Map.of("access_token", "t"));
            }

            @Override
            public PanelTokenGuard.Decision check(PanelTokenGuard.Request request) {
                throw new UnsupportedOperationException();
            }
        };
    }

    private static Http.Request tokenRequest(String body) {
        Http.Request request = new Http.Request();
        request.method = "POST";
        request.pathInfo = "/v1/token";
        request.contentType = "application/x-www-form-urlencoded; charset=UTF-8";
        request.body = body.getBytes(StandardCharsets.US_ASCII);
        request.header("Authorization", "Basic " + Base64.getEncoder()
                                                       .encodeToString(("crm:" + Fixtures.CLIENT_SECRET).getBytes(
                                                               StandardCharsets.UTF_8)));
        return request;
    }

    private Http.Response send(Http.Request request) throws Exception {
        Http.Response response = new Http.Response();
        servlet.service(request.proxy(), response.proxy());
        return response;
    }

    @Test
    void theExchangeReadsBasicCredentialsAndAFormBody() throws Exception {
        String assertion = "a.b.c";
        Http.Response response = send(tokenRequest("grant_type=" + URLEncoder.encode(TokenExchange.GRANT_TYPE,
                StandardCharsets.UTF_8) + "&subject_token=" + assertion + "&scope=read+write"));
        assertEquals(200, response.status);
        assertEquals("no-store", response.headers.get("Cache-Control"));
        assertNull(response.headers.get("Access-Control-Allow-Origin"), "no page may read the exchange's answer");
        assertArrayEquals(new String[] { "crm", Fixtures.CLIENT_SECRET }, credentials.get());
        assertEquals(List.of(TokenExchange.GRANT_TYPE), received.get().get("grant_type"));
        assertEquals(List.of("read write"), received.get().get("scope"));
        assertEquals(List.of(assertion), received.get().get("subject_token"));
    }

    @Test
    void theExchangeTakesNothingFromTheAddressAndNoSecretFromTheBody() throws Exception {
        Http.Request query = tokenRequest("grant_type=x");
        query.query = "subject_token=a.b.c";
        Http.Response response = send(query);
        assertEquals(400, response.status);
        assertNull(received.get());

        Http.Response secret = send(tokenRequest("grant_type=x&client_secret=" + Fixtures.CLIENT_SECRET));
        assertEquals(401, secret.status);
        assertNull(received.get());

        Http.Request json = tokenRequest("{}");
        json.contentType = "application/json";
        assertEquals(400, send(json).status);

        Http.Response large = send(tokenRequest("subject_token=" + "a".repeat(EmbeddedPanelServlet.MAX_BODY)));
        assertEquals(400, large.status);
        assertNull(received.get());

        Http.Request get = tokenRequest("");
        get.method = "GET";
        assertEquals(405, send(get).status);
    }

    @Test
    void aRequestWithNoCredentialsIsAskedForThem() throws Exception {
        Http.Request request = tokenRequest("grant_type=x");
        request.headers.remove("Authorization");
        Http.Response response = send(request);
        assertEquals(401, response.status);
        assertEquals("Basic realm=\"agentic-embedded\"", response.headers.get("WWW-Authenticate"));
    }

    @Test
    void basicCredentialsAreFormDecodedAsRfc6749Says() {
        assertArrayEquals(new String[] { "crm", "s:e cret" },
                EmbeddedPanelServlet.basic("Basic " + Base64.getEncoder().encodeToString(
                        "crm:s%3Ae+cret".getBytes(StandardCharsets.UTF_8))));
        assertNull(EmbeddedPanelServlet.basic("Bearer x"));
        assertNull(EmbeddedPanelServlet.basic("Basic !!!"));
        assertNull(EmbeddedPanelServlet.basic("Basic " + Base64.getEncoder().encodeToString("nocolon".getBytes())));
        assertNull(EmbeddedPanelServlet.basic(null));
    }

    @Test
    void aFormKeepsEveryValueOfAParameterSoThatADuplicateIsSeen() {
        Map<String, List<String>> form = EmbeddedPanelServlet.parse("a=1&a=2&b=%7E&c");
        assertEquals(List.of("1", "2"), form.get("a"));
        assertEquals(List.of("~"), form.get("b"));
        assertEquals(List.of(""), form.get("c"));
    }

    private Http.Request hostRequest(String id, String origin) {
        Http.Request request = new Http.Request();
        request.pathInfo = "/v1/hosts/" + id;
        if (origin != null) {
            request.header("Origin", origin);
        }
        return request;
    }

    @Test
    void aHostsOriginsAreGivenToItsOwnPagesOnly() throws Exception {
        Http.Response own = send(hostRequest("crm", "https://crm.example.com"));
        assertEquals(200, own.status);
        assertEquals("https://crm.example.com", own.headers.get("Access-Control-Allow-Origin"));
        assertEquals("Origin", own.headers.get("Vary"));
        assertTrue(own.body().contains("\"origins\":[\"https://crm.example.com\"]"), own.body());

        for (Http.Request request : List.of(hostRequest("crm", "https://elsewhere.example"), hostRequest("crm", null),
                hostRequest("erp", "https://crm.example.com"), hostRequest("../crm", "https://crm.example.com"))) {
            Http.Response refused = send(request);
            assertEquals(404, refused.status);
            assertEquals("{\"error\":\"not_found\"}", refused.body(), "a refusal holds nothing");
        }
        // The page that asked may read its refusal, and only that page.
        assertEquals("https://elsewhere.example",
                send(hostRequest("crm", "https://elsewhere.example")).headers.get("Access-Control-Allow-Origin"));
        assertNull(send(hostRequest("crm", null)).headers.get("Access-Control-Allow-Origin"));
        assertNull(send(hostRequest("crm", "null")).headers.get("Access-Control-Allow-Origin"));
    }

    @Test
    void anyOtherAddressIsNotFound() throws Exception {
        Http.Request request = new Http.Request();
        request.pathInfo = "/v2/token";
        assertEquals(404, send(request).status);
        request.pathInfo = null;
        assertEquals(404, send(request).status);
    }
}
