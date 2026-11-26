/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import java.time.Instant;
import java.util.List;

import org.nuxeo.agentic.assets.share.ShareLinkService.Created;
import org.nuxeo.agentic.assets.share.ShareLinkService.Creation;
import org.nuxeo.agentic.assets.share.ShareLinkService.NotCreated;
import org.nuxeo.agentic.assets.share.ShareLinkService.Refusal;
import org.nuxeo.agentic.assets.share.ShareLinkStore.Downloads;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * What the share link operations answer, as JSON.
 *
 * <pre>
 * Link:     { "id", "document", "renditions": [item], "end": "yyyy-MM-dd", "created", "createdBy",
 *             "revoked", "revokedBy", "state": "active" | "expired" | "revoked" }
 * Create:   { "link": Link, "token", "path" }  or  { "refused": [{ "rendition", "reason" }] }
 * List:     { "links": [Link] }
 * Revoke:   { "link": Link }
 * Downloads: { "downloads": [{ "time", "link", "rendition" }], "truncated" }
 * </pre>
 *
 * A link's id is its token's hash, never the token: the token is in Create's answer only, once.
 * Instants are UTC, to the millisecond; {@code end} is the link's last day, in UTC.
 */
public final class ShareLinkJson {

    private static final ObjectMapper JSON = new ObjectMapper();

    private ShareLinkJson() {
    }

    static ObjectNode link(ShareLink link, Instant now) {
        ObjectNode node = JSON.createObjectNode();
        node.put("id", link.id());
        node.put("document", link.document());
        ArrayNode items = node.putArray("renditions");
        link.items().forEach(items::add);
        node.put("end", link.lastDay().toString());
        node.put("created", DirectoryShareLinkStore.INSTANT.format(link.created()));
        node.put("createdBy", link.createdBy());
        node.put("revoked", link.revoked() == null ? null : DirectoryShareLinkStore.INSTANT.format(link.revoked()));
        node.put("revokedBy", link.revokedBy());
        node.put("state", link.state(now).code());
        return node;
    }

    /** Create's answer. {@code contextPath} is the server's, such as {@code /nuxeo}. */
    public static String creation(Creation creation, Instant now, String contextPath) {
        ObjectNode node = JSON.createObjectNode();
        if (creation instanceof Created created) {
            node.set("link", link(created.link(), now));
            node.put("token", created.token());
            node.put("path", contextPath + ShareEndpoint.PATH + created.token() + "/");
        } else if (creation instanceof NotCreated notCreated) {
            ArrayNode refused = node.putArray("refused");
            for (Refusal refusal : notCreated.refused()) {
                refused.addObject().put("rendition", refusal.item()).put("reason", refusal.reason());
            }
        }
        return node.toString();
    }

    public static String links(List<ShareLink> links, Instant now) {
        ObjectNode node = JSON.createObjectNode();
        ArrayNode array = node.putArray("links");
        links.forEach(link -> array.add(link(link, now)));
        return node.toString();
    }

    public static String revoked(ShareLink link, Instant now) {
        ObjectNode node = JSON.createObjectNode();
        node.set("link", link(link, now));
        return node.toString();
    }

    public static String downloads(Downloads downloads) {
        ObjectNode node = JSON.createObjectNode();
        ArrayNode array = node.putArray("downloads");
        for (ShareDownload download : downloads.downloads()) {
            array.addObject()
                 .put("time", DirectoryShareLinkStore.INSTANT.format(download.time()))
                 .put("link", download.link())
                 .put("rendition", download.item());
        }
        node.put("truncated", downloads.truncated());
        return node.toString();
    }
}
