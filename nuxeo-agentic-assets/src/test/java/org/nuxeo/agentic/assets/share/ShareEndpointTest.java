package org.nuxeo.agentic.assets.share;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.assets.share.ShareEndpoint.Response;
import org.nuxeo.agentic.assets.share.ShareLinkStore.Downloads;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;

/** What /agentic-share/ answers: GET only, one refusal for everything, and no cache, referrer or frame. */
class ShareEndpointTest {

    private static final String TOKEN = ShareToken.generate(new SecureRandom());

    private static final ShareLink LINK = new ShareLink(ShareToken.hash(TOKEN), "default", "asset-a",
            List.of("view:FullHD"), Map.of("view:FullHD", "d1"), Map.of("view:FullHD", "s1"), LocalDate.of(2026, 12, 14), Instant.parse("2026-11-24T12:00:00Z"), "brand.manager",
            null, null);

    /** A service that answers what the test sets, and records what it was asked. */
    private static final class Answering implements ShareLinkService {
        ShareLinkService.Answer answer = new Refused(Why.UNKNOWN);

        final List<String> asked = new ArrayList<>();

        @Override
        public Answer page(String token) {
            asked.add(token + " page");
            return answer;
        }

        @Override
        public Answer serve(String token, String item) {
            asked.add(token + " " + item);
            return answer;
        }

        @Override
        public Instant now() {
            throw new UnsupportedOperationException();
        }

        @Override
        public Creation create(CoreSession session, DocumentModel document, List<String> items, String lastDay) {
            throw new UnsupportedOperationException();
        }

        @Override
        public List<ShareLink> list(CoreSession session, DocumentModel document) {
            throw new UnsupportedOperationException();
        }

        @Override
        public ShareLink revoke(CoreSession session, DocumentModel document, String link) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Downloads downloads(CoreSession session, DocumentModel document) {
            throw new UnsupportedOperationException();
        }
    }

    private final Answering service = new Answering();

    private final ShareEndpoint endpoint = new ShareEndpoint(service);

    private Response get(String pathInfo) {
        return endpoint.respond("GET", pathInfo, "/nuxeo");
    }

    private static String body(Response response) {
        return new String(response.body(), StandardCharsets.UTF_8);
    }

    private static void common(Response response) {
        Map<String, String> headers = response.headers();
        assertEquals("no-store, max-age=0", headers.get("Cache-Control"));
        assertEquals("no-cache", headers.get("Pragma"));
        assertEquals("0", headers.get("Expires"));
        assertEquals("no-referrer", headers.get("Referrer-Policy"));
        assertEquals("nosniff", headers.get("X-Content-Type-Options"));
        assertEquals("DENY", headers.get("X-Frame-Options"));
        assertEquals("noindex, nofollow, noarchive", headers.get("X-Robots-Tag"));
        assertEquals("same-origin", headers.get("Cross-Origin-Resource-Policy"));
    }

    @Test
    void onlyGetIsAnswered() {
        for (String method : List.of("POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "TRACE")) {
            Response response = endpoint.respond(method, "/" + TOKEN + "/view/FullHD", "/nuxeo");
            assertEquals(405, response.status(), method);
            assertEquals("GET", response.headers().get("Allow"));
            assertEquals(ShareEndpoint.FILE_POLICY, response.headers().get("Content-Security-Policy"));
            common(response);
        }
        assertTrue(service.asked.isEmpty());
    }

    @Test
    void thePathNamesThePageTheOriginalOrAViewAndNothingElse() {
        service.answer = new ShareLinkService.Page(LINK, List.of(ShareItem.parse("view:FullHD")));
        get("/" + TOKEN);
        get("/" + TOKEN + "/");
        get("/" + TOKEN + "/original");
        get("/" + TOKEN + "/view/FullHD");
        get("/" + TOKEN + "/view/Web view: 2");
        get("/" + TOKEN + "/view/a/../b");
        assertEquals(List.of(TOKEN + " page", TOKEN + " page", TOKEN + " original", TOKEN + " view:FullHD",
                TOKEN + " view:Web view: 2", TOKEN + " view:a/../b"), service.asked);

        service.asked.clear();
        for (String path : new String[] { null, "", "/", "//", "/" + TOKEN + "/view", "/" + TOKEN + "/view/",
                "/" + TOKEN + "/rendition/FullHD", "/" + TOKEN + "/original/", "/" + TOKEN + "/../x",
                "/" + TOKEN + "x/original", "/" + TOKEN.substring(1) + "/original", "/../api/v1/id/asset-b",
                "/" + LINK.id() + "/view/FullHD", "/" + TOKEN + "/blob/file:content", TOKEN + "/original" }) {
            Response response = get(path);
            assertEquals(404, response.status(), String.valueOf(path));
            common(response);
        }
        assertTrue(service.asked.isEmpty(), service.asked::toString);
    }

    /** Whatever the reason, the visitor gets the same answer, byte for byte. */
    @Test
    void everyRefusalIsTheSameAnswer() {
        Response first = get("/not-a-token/original");
        for (ShareLinkService.Why why : ShareLinkService.Why.values()) {
            service.answer = new ShareLinkService.Refused(why);
            Response response = get("/" + TOKEN + "/view/FullHD");
            assertEquals(404, response.status(), why::name);
            assertEquals(first.headers(), response.headers(), why::name);
            assertArrayEquals(first.body(), response.body(), why::name);
        }
        Response noService = new ShareEndpoint(null).respond("GET", "/" + TOKEN + "/", "/nuxeo");
        assertArrayEquals(first.body(), noService.body());
        assertEquals(first.headers(), noService.headers());
        common(first);
        assertEquals(ShareEndpoint.PAGE_POLICY, first.headers().get("Content-Security-Policy"));
    }

    @Test
    void anItemIsServedAsTheMarkedBytesUnderAFileNameOfSafeCharacters() {
        byte[] marked = { 1, 2, 3 };
        service.answer = new ShareLinkService.Served(LINK, ShareItem.parse("view:Web \"view\" 2;x"), marked,
                "image/jpeg");
        Response response = get("/" + TOKEN + "/view/FullHD");
        assertEquals(200, response.status());
        assertArrayEquals(marked, response.body());
        assertEquals("image/jpeg", response.headers().get("Content-Type"));
        assertEquals("inline; filename=\"share-" + LINK.label() + "-Web__view__2_x.jpg\"",
                response.headers().get("Content-Disposition"));
        assertEquals(ShareEndpoint.FILE_POLICY, response.headers().get("Content-Security-Policy"));
        common(response);
    }

    @Test
    void busyIsTryAgainLater() {
        service.answer = new ShareLinkService.Busy();
        Response response = get("/" + TOKEN + "/view/FullHD");
        assertEquals(503, response.status());
        assertEquals("10", response.headers().get("Retry-After"));
        assertEquals(ShareEndpoint.FILE_POLICY, response.headers().get("Content-Security-Policy"));
        common(response);
    }

    @Test
    void thePageEscapesWhatItWritesAndLoadsNothingFromElsewhere() {
        service.answer = new ShareLinkService.Page(LINK,
                List.of(ShareItem.parse("original"), ShareItem.parse("view:<img src=x onerror=alert(1)>\"'&"),
                        ShareItem.parse("view:FullHD")));
        Response response = get("/" + TOKEN + "/");
        assertEquals(200, response.status());
        assertEquals("text/html; charset=UTF-8", response.headers().get("Content-Type"));
        assertEquals(ShareEndpoint.PAGE_POLICY, response.headers().get("Content-Security-Policy"));
        common(response);
        String html = body(response);

        assertFalse(html.contains("<img src=x"), html);
        assertTrue(html.contains("&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;"), html);
        assertTrue(html.contains("src=\"/nuxeo/agentic-share/" + TOKEN + "/original\""), html);
        assertTrue(html.contains("src=\"/nuxeo/agentic-share/" + TOKEN + "/view/FullHD\""), html);
        assertTrue(html.contains("/view/%3Cimg%20src%3Dx%20onerror%3Dalert%281%29%3E%22%27%26\""), html);
        assertTrue(html.contains("<meta name=\"referrer\" content=\"no-referrer\">"), html);
        assertTrue(html.contains("Shared through link " + LINK.label() + ", until the end of 14 December 2026 (UTC)"),
                html);
        assertFalse(html.contains("<script"), html);
        assertFalse(html.contains("http:") || html.contains("https:") || html.contains("//nuxeo"), html);
        // Nothing of the document but the items: not its id, not who made the link.
        assertFalse(html.contains("asset-a"), html);
        assertFalse(html.contains("brand.manager"), html);
        assertFalse(html.contains(LINK.id()), html);
    }
}
