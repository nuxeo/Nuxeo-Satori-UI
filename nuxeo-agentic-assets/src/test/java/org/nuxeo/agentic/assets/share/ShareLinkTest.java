package org.nuxeo.agentic.assets.share;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.assets.rights.Use;

/** A link's state in time, in UTC, and the items a link may list. */
class ShareLinkTest {

    private static ShareLink link(String lastDay, Instant revoked) {
        return new ShareLink("ab12cd34" + "0".repeat(56), "default", "asset-a", List.of("view:FullHD"),
                java.util.Map.of("view:FullHD", "d1"), java.util.Map.of("view:FullHD", "s1"), LocalDate.parse(lastDay), Instant.parse("2026-11-24T12:00:00Z"), "brand.manager", revoked,
                revoked == null ? null : "brand.manager");
    }

    @Test
    void aLinkOpensUntilTheEndOfItsLastDayInUtc() {
        ShareLink link = link("2026-12-14", null);
        assertEquals(Instant.parse("2026-12-15T00:00:00Z"), link.endsAt());
        assertEquals(ShareLink.State.ACTIVE, link.state(Instant.parse("2026-12-14T23:59:59.999Z")));
        assertEquals(ShareLink.State.EXPIRED, link.state(Instant.parse("2026-12-15T00:00:00Z")));
        assertEquals(ShareLink.State.EXPIRED, link.state(Instant.parse("2027-01-01T00:00:00Z")));
    }

    @Test
    void revokedIsRevokedWhateverTheTime() {
        ShareLink link = link("2026-12-14", Instant.parse("2026-11-25T08:00:00Z"));
        assertEquals(ShareLink.State.REVOKED, link.state(Instant.parse("2026-11-24T00:00:00Z")));
        assertEquals(ShareLink.State.REVOKED, link.state(Instant.parse("2027-01-01T00:00:00Z")));
    }

    @Test
    void aLinksLabelIsTheFirstEightCharactersOfItsId() {
        assertEquals("ab12cd34", link("2026-12-14", null).label());
    }

    @Test
    void anItemIsTheOriginalOrAViewByItsExactTitle() {
        assertEquals(Use.ORIGINAL, ShareItem.parse("original").use());
        assertEquals(Use.view("FullHD"), ShareItem.parse("view:FullHD").use());
        assertEquals(Use.view("Web view: 2"), ShareItem.parse("view:Web view: 2").use());
        assertEquals("FullHD", ShareItem.parse("view:FullHD").title());
        assertTrue(ShareItem.parse("original").isOriginal());
        for (String wrong : new String[] { null, "", "Original", "view:", "view: x", "view:x ", "view:a\nb",
                "view:a\u200eb", "view:a/b", "view:a\\b", "view:" + "x".repeat(65), "rendition:FullHD", "blob:file:content", "views:FullHD" }) {
            assertThrows(IllegalArgumentException.class, () -> ShareItem.parse(wrong), String.valueOf(wrong));
        }
        ShareItem.parse("view:" + "x".repeat(64));
    }
}
