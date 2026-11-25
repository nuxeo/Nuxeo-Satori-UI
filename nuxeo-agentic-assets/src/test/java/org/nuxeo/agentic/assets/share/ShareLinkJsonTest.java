package org.nuxeo.agentic.assets.share;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.assets.share.ShareLinkService.Created;
import org.nuxeo.agentic.assets.share.ShareLinkService.NotCreated;
import org.nuxeo.agentic.assets.share.ShareLinkService.Refusal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** What the operations answer: the contract the asset page reads, and the token in Create's answer only. */
class ShareLinkJsonTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final Instant NOW = Instant.parse("2026-11-24T12:00:00Z");

    private static final String TOKEN = ShareToken.generate(new SecureRandom());

    private static final ShareLink LINK = new ShareLink(ShareToken.hash(TOKEN), "default", "asset-a",
            List.of("view:FullHD", "original"), LocalDate.of(2026, 12, 14), NOW, "brand.manager", null, null);

    private static Set<String> keys(JsonNode node) {
        return Set.copyOf(iterable(node.fieldNames()));
    }

    private static List<String> iterable(java.util.Iterator<String> names) {
        java.util.ArrayList<String> list = new java.util.ArrayList<>();
        names.forEachRemaining(list::add);
        return list;
    }

    @Test
    void aLinkIsWrittenWithItsHashForAnIdAndNoToken() throws Exception {
        JsonNode link = JSON.readTree(ShareLinkJson.revoked(LINK, NOW)).get("link");
        assertEquals(Set.of("id", "document", "renditions", "end", "created", "createdBy", "revoked", "revokedBy",
                "state"), keys(link));
        assertEquals(LINK.id(), link.get("id").asText());
        assertEquals("asset-a", link.get("document").asText());
        assertEquals("[\"view:FullHD\",\"original\"]", link.get("renditions").toString());
        assertEquals("2026-12-14", link.get("end").asText());
        assertEquals("2026-11-24T12:00:00.000Z", link.get("created").asText());
        assertTrue(link.get("revoked").isNull());
        assertEquals("active", link.get("state").asText());
        assertFalse(link.toString().contains(TOKEN));

        assertEquals("expired", JSON.readTree(ShareLinkJson.links(List.of(LINK), Instant.parse("2026-12-15T00:00:00Z")))
                                    .get("links")
                                    .get(0)
                                    .get("state")
                                    .asText());
        ShareLink revoked = LINK.revokedAt(Instant.parse("2026-11-25T08:00:00Z"), "brand.manager");
        JsonNode revokedNode = JSON.readTree(ShareLinkJson.revoked(revoked, NOW)).get("link");
        assertEquals("revoked", revokedNode.get("state").asText());
        assertEquals("2026-11-25T08:00:00.000Z", revokedNode.get("revoked").asText());
    }

    @Test
    void createAnswersTheTokenAndItsPathOnceOrTheRefusals() throws Exception {
        JsonNode created = JSON.readTree(ShareLinkJson.creation(new Created(LINK, TOKEN), NOW, "/nuxeo"));
        assertEquals(Set.of("link", "token", "path"), keys(created));
        assertEquals(TOKEN, created.get("token").asText());
        assertEquals("/nuxeo/agentic-share/" + TOKEN + "/", created.get("path").asText());

        JsonNode refused = JSON.readTree(ShareLinkJson.creation(
                new NotCreated(List.of(new Refusal("original", "channel-not-covered"))), NOW, "/nuxeo"));
        assertEquals(Set.of("refused"), keys(refused));
        assertEquals("{\"rendition\":\"original\",\"reason\":\"channel-not-covered\"}",
                refused.get("refused").get(0).toString());
    }

    @Test
    void downloadsSayWhenWhichLinkAndWhichItemAndNothingElse() throws Exception {
        JsonNode downloads = JSON.readTree(ShareLinkJson.downloads(new ShareLinkStore.Downloads(
                List.of(new ShareDownload(NOW, LINK.id(), "asset-a", "view:FullHD")), true)));
        assertEquals(Set.of("downloads", "truncated"), keys(downloads));
        assertTrue(downloads.get("truncated").asBoolean());
        JsonNode one = downloads.get("downloads").get(0);
        assertEquals(Set.of("time", "link", "rendition"), keys(one));
        assertEquals("2026-11-24T12:00:00.000Z", one.get("time").asText());
    }
}
