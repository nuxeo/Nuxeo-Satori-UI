/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

import org.nuxeo.agentic.assets.share.ShareLinkService.Answer;
import org.nuxeo.agentic.assets.share.ShareLinkService.Busy;
import org.nuxeo.agentic.assets.share.ShareLinkService.Page;
import org.nuxeo.agentic.assets.share.ShareLinkService.Served;

/**
 * What {@code /agentic-share/} answers, with no servlet in it, so that it is tested as it is.
 *
 * <pre>
 * GET /nuxeo/agentic-share/&lt;token&gt;/                the link's page
 * GET /nuxeo/agentic-share/&lt;token&gt;/original        its original, marked
 * GET /nuxeo/agentic-share/&lt;token&gt;/view/&lt;title&gt;    one of its views, marked
 * </pre>
 *
 * <ul>
 * <li><strong>GET only.</strong> Any other method is answered 405.</li>
 * <li><strong>One refusal for everything:</strong> a token that is not one, a link that does not
 * exist, is revoked or has ended, an item it does not list, rights that refuse it: each is the same
 * 404, byte for byte, so that an answer says nothing about which. A request the server is too busy
 * to mark now is answered 503.</li>
 * <li><strong>Every answer is kept by no cache, sent with no referrer and framed by no page:</strong>
 * {@code Cache-Control: no-store}, {@code Referrer-Policy: no-referrer}, a content security policy
 * that lets the page load only its own pictures and run no script, {@code X-Frame-Options: DENY},
 * {@code X-Robots-Tag: noindex}, {@code nosniff}, and {@code Cross-Origin-Resource-Policy:
 * same-origin}.</li>
 * <li><strong>The page is the server's,</strong> in English, with no script, no style sheet and
 * nothing from another address: until the outside-user portal of the architecture is built, it is
 * the share-link view. Everything written in it from the link or the document is escaped.</li>
 * </ul>
 */
public class ShareEndpoint {

    /** Where the servlet is mapped, below the context path. */
    public static final String PATH = "/agentic-share/";

    static final String VIEW = "view/";

    static final Map<String, String> COMMON = commonHeaders();

    static final String PAGE_POLICY = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; "
            + "form-action 'none'; frame-ancestors 'none'";

    static final String FILE_POLICY = "default-src 'none'; frame-ancestors 'none'; sandbox";

    private static final DateTimeFormatter LONG_DAY = DateTimeFormatter.ofPattern("d MMMM uuuu", Locale.ENGLISH);

    /** What the servlet writes. */
    public record Response(int status, Map<String, String> headers, byte[] body) {
    }

    private final ShareLinkService service;

    public ShareEndpoint(ShareLinkService service) {
        this.service = service;
    }

    /**
     * @param method the request's method
     * @param pathInfo the path below {@link #PATH}, decoded, as the servlet container gives it
     * @param contextPath the server's context path, such as {@code /nuxeo}
     */
    public Response respond(String method, String pathInfo, String contextPath) {
        if (!"GET".equals(method)) {
            Map<String, String> headers = new LinkedHashMap<>(COMMON);
            headers.put("Allow", "GET");
            headers.put("Content-Type", "text/plain; charset=UTF-8");
            return new Response(405, headers, new byte[0]);
        }
        if (service == null || pathInfo == null || !pathInfo.startsWith("/")) {
            return notAvailable();
        }
        String path = pathInfo.substring(1);
        int slash = path.indexOf('/');
        String token = slash < 0 ? path : path.substring(0, slash);
        String rest = slash < 0 ? "" : path.substring(slash + 1);
        if (!ShareToken.wellFormed(token)) {
            return notAvailable();
        }
        if (rest.isEmpty()) {
            return answer(service.page(token), contextPath, token);
        }
        if (rest.equals(ShareItem.ORIGINAL)) {
            return answer(service.serve(token, ShareItem.ORIGINAL), contextPath, token);
        }
        if (rest.startsWith(VIEW) && rest.length() > VIEW.length()) {
            return answer(service.serve(token, ShareItem.VIEW_PREFIX + rest.substring(VIEW.length())), contextPath,
                    token);
        }
        return notAvailable();
    }

    private Response answer(Answer answer, String contextPath, String token) {
        if (answer instanceof Page page) {
            Map<String, String> headers = new LinkedHashMap<>(COMMON);
            headers.put("Content-Type", "text/html; charset=UTF-8");
            headers.put("Content-Security-Policy", PAGE_POLICY);
            return new Response(200, headers, html(page, contextPath, token).getBytes(StandardCharsets.UTF_8));
        }
        if (answer instanceof Served served) {
            Map<String, String> headers = new LinkedHashMap<>(COMMON);
            headers.put("Content-Type", served.mimeType());
            headers.put("Content-Security-Policy", FILE_POLICY);
            headers.put("Content-Disposition", "inline; filename=\"" + filename(served) + "\"");
            return new Response(200, headers, served.bytes());
        }
        if (answer instanceof Busy) {
            Map<String, String> headers = new LinkedHashMap<>(COMMON);
            headers.put("Content-Type", "text/plain; charset=UTF-8");
            headers.put("Retry-After", "10");
            return new Response(503, headers, "Busy: try again in a moment.\n".getBytes(StandardCharsets.UTF_8));
        }
        return notAvailable();
    }

    /** The one refusal: the same answer, whatever the reason. */
    public static Response notAvailable() {
        Map<String, String> headers = new LinkedHashMap<>(COMMON);
        headers.put("Content-Type", "text/html; charset=UTF-8");
        headers.put("Content-Security-Policy", PAGE_POLICY);
        String body = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"robots\" "
                + "content=\"noindex, nofollow\"><title>Not available</title></head><body><main><h1>This link is not "
                + "available</h1><p>It may have ended or been revoked. Ask whoever sent it for a new one.</p></main>"
                + "</body></html>";
        return new Response(404, headers, body.getBytes(StandardCharsets.UTF_8));
    }

    private static Map<String, String> commonHeaders() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Cache-Control", "no-store, max-age=0");
        headers.put("Pragma", "no-cache");
        headers.put("Expires", "0");
        headers.put("Referrer-Policy", "no-referrer");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("X-Frame-Options", "DENY");
        headers.put("X-Robots-Tag", "noindex, nofollow, noarchive");
        headers.put("Cross-Origin-Resource-Policy", "same-origin");
        return Map.copyOf(headers);
    }

    /** The page: the link's items, each shown and linked, marked as every byte it serves is. */
    static String html(Page page, String contextPath, String token) {
        String base = (contextPath == null ? "" : contextPath) + PATH + token + "/";
        StringBuilder html = new StringBuilder(1024);
        html.append("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">")
            .append("<meta name=\"referrer\" content=\"no-referrer\">")
            .append("<meta name=\"robots\" content=\"noindex, nofollow\">")
            .append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">")
            .append("<title>Shared files</title><style>")
            .append("body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#f5f5f5;color:#1a1a1a}")
            .append("main{max-width:1100px;margin:0 auto}ul{list-style:none;padding:0;display:grid;gap:16px;")
            .append("grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}li{background:#fff;padding:12px;")
            .append("border-radius:8px}img{display:block;max-width:100%;height:auto;margin-bottom:8px}")
            .append("a{color:#0b57d0}</style></head><body><main><h1>Shared files</h1><p>Shared through link ")
            .append(escape(page.link().label()))
            .append(", until the end of ")
            .append(escape(LONG_DAY.format(page.link().lastDay())))
            .append(" (UTC). Every file carries a watermark.</p><ul>");
        for (ShareItem item : page.items()) {
            String href = base + (item.isOriginal() ? ShareItem.ORIGINAL : VIEW + segment(item.title()));
            String name = item.isOriginal() ? "Original" : item.title();
            html.append("<li><img src=\"")
                .append(escape(href))
                .append("\" alt=\"")
                .append(escape(name))
                .append("\" loading=\"lazy\"><a href=\"")
                .append(escape(href))
                .append("\">")
                .append(escape(name))
                .append("</a></li>");
        }
        return html.append("</ul></main></body></html>").toString();
    }

    /** A title as a path segment: encoded, a space as {@code %20}. */
    static String segment(String title) {
        return URLEncoder.encode(title, StandardCharsets.UTF_8).replace("+", "%20");
    }

    /** {@code share-<label>-<item>.jpg}, with nothing but letters, digits, dots, dashes and underscores. */
    static String filename(Served served) {
        String item = served.item().isOriginal() ? ShareItem.ORIGINAL : served.item().title();
        return "share-" + served.link().label() + "-" + item.replaceAll("[^A-Za-z0-9._-]", "_") + ".jpg";
    }

    static String escape(String text) {
        StringBuilder out = new StringBuilder(text.length() + 16);
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
            case '&' -> out.append("&amp;");
            case '<' -> out.append("&lt;");
            case '>' -> out.append("&gt;");
            case '"' -> out.append("&quot;");
            case '\'' -> out.append("&#39;");
            default -> out.append(c);
            }
        }
        return out.toString();
    }
}
