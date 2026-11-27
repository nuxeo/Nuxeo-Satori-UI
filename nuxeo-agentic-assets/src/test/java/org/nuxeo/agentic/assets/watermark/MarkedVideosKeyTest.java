/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.function.UnaryOperator;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.assets.rights.Watermark.Placement;
import org.nuxeo.agentic.assets.watermark.MarkedVideos.Order;
import org.nuxeo.agentic.assets.watermark.MarkedVideos.Purpose;
import org.nuxeo.agentic.assets.watermark.WatermarkedCopies.Copy;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.impl.blob.ByteArrayBlob;

/**
 * What a kept copy's key names, with no runtime: the document, the place and digest of its file, the
 * watermark, why it is marked, the text drawn, and the person and the territory exactly where the
 * text names them; and a copy found under a key held to what it records.
 */
class MarkedVideosKeyTest {

    private static Blob file(String digest) {
        Blob blob = new ByteArrayBlob("STAND-IN VIDEO".getBytes(StandardCharsets.UTF_8), "video/mp4");
        blob.setDigest(digest);
        return blob;
    }

    private static Order order(String template, String text, String recipient, String user, String territory) {
        return new Order("default", "doc-1", "AcmeVideo", "file:content", "original", file("digest-1"), text,
                Placement.BOTTOM_RIGHT, template, "fingerprint-1", recipient, user, territory, Purpose.DOWNLOAD);
    }

    private static Order with(Order order, UnaryOperator<Order> change) {
        return change.apply(order);
    }

    private static final Order OLGA = order("ACME · {recipient}", "ACME · olga", "olga", "olga", "");

    @Test
    void theKeyIsTheSha256InHex() {
        assertTrue(WatermarkedCopies.KEY_FORM.matcher(MarkedVideosComponent.key(OLGA)).matches());
        assertEquals(MarkedVideosComponent.key(OLGA), MarkedVideosComponent.key(order("ACME · {recipient}",
                "ACME · olga", "olga", "olga", "")));
    }

    @Test
    void eachPartOfWhatIsMarkedChangesTheKey() {
        String key = MarkedVideosComponent.key(OLGA);
        assertNotEquals(key, MarkedVideosComponent.key(with(OLGA, o -> new Order(o.repository(), "doc-2", o.type(),
                o.xpath(), o.use(), o.file(), o.text(), o.placement(), o.template(), o.fingerprint(), o.recipient(),
                o.user(), o.territory(), o.purpose()))), "the document");
        assertNotEquals(key, MarkedVideosComponent.key(with(OLGA, o -> new Order(o.repository(), o.document(), o.type(),
                "files:files/0/file", o.use(), o.file(), o.text(), o.placement(), o.template(), o.fingerprint(),
                o.recipient(), o.user(), o.territory(), o.purpose()))), "the file's place");
        assertNotEquals(key, MarkedVideosComponent.key(with(OLGA, o -> new Order(o.repository(), o.document(), o.type(),
                o.xpath(), o.use(), file("digest-2"), o.text(), o.placement(), o.template(), o.fingerprint(),
                o.recipient(), o.user(), o.territory(), o.purpose()))), "the file's digest: a changed source");
        assertNotEquals(key, MarkedVideosComponent.key(with(OLGA, o -> new Order(o.repository(), o.document(), o.type(),
                o.xpath(), o.use(), o.file(), o.text(), o.placement(), o.template(), "fingerprint-2", o.recipient(),
                o.user(), o.territory(), o.purpose()))), "the watermark: a changed policy");
        assertNotEquals(key, MarkedVideosComponent.key(with(OLGA, o -> new Order(o.repository(), o.document(), o.type(),
                o.xpath(), o.use(), o.file(), o.text(), o.placement(), o.template(), o.fingerprint(), o.recipient(),
                o.user(), o.territory(), Purpose.DELIVERY))), "why it is marked");
        assertNotEquals(key, MarkedVideosComponent.key(with(OLGA, o -> new Order(o.repository(), o.document(), o.type(),
                o.xpath(), o.use(), o.file(), "ACME · olga · 2026-11-28", o.placement(), o.template(), o.fingerprint(),
                o.recipient(), o.user(), o.territory(), o.purpose()))), "the text drawn, its day");
    }

    @Test
    void thePersonIsInTheKeyWhereTheTextNamesThem() {
        // Two people whose names the text, cut to 100 characters, draws alike: two keys all the same.
        String long1 = "a".repeat(100) + "-one";
        String long2 = "a".repeat(100) + "-two";
        String drawn = "ACME · " + "a".repeat(100);
        assertNotEquals(MarkedVideosComponent.key(order("ACME · {recipient}", drawn, long1, long1, "")),
                MarkedVideosComponent.key(order("ACME · {recipient}", drawn, long2, long2, "")));
        assertNotEquals(MarkedVideosComponent.key(order("ACME · {user}", drawn, "x", long1, "")),
                MarkedVideosComponent.key(order("ACME · {user}", drawn, "x", long2, "")));
        // A text that names no one: one copy for everyone it marks alike.
        assertEquals(MarkedVideosComponent.key(order("ACME OUTDOOR", "ACME OUTDOOR", "olga", "olga", "")),
                MarkedVideosComponent.key(order("ACME OUTDOOR", "ACME OUTDOOR", "pablo", "pablo", "")));
        assertNotEquals(MarkedVideosComponent.key(order("ACME · {territory}", "ACME · FR", "d", "d", "FR")),
                MarkedVideosComponent.key(order("ACME · {territory}", "ACME · FR", "d", "d", "FR ")));
    }

    @Test
    void aCopyIsHeldToWhatItRecords() {
        Calendar made = new GregorianCalendar();
        Copy olgas = new Copy("c1", file("marked"), "digest-1", "fingerprint-1", "download", "olga", "olga", "",
                "ACME · olga", made);
        assertTrue(MarkedVideosComponent.matches(olgas, OLGA));
        Order pablo = order("ACME · {recipient}", "ACME · olga", "pablo", "pablo", "");
        assertFalse(MarkedVideosComponent.matches(olgas, pablo), "another person");
        assertFalse(MarkedVideosComponent.matches(new Copy("c1", file("marked"), "digest-0", "fingerprint-1", "download",
                "olga", "olga", "", "ACME · olga", made), OLGA), "another file");
        assertFalse(MarkedVideosComponent.matches(new Copy("c1", file("marked"), "digest-1", "fingerprint-0", "download",
                "olga", "olga", "", "ACME · olga", made), OLGA), "another watermark");
        assertFalse(MarkedVideosComponent.matches(new Copy("c1", file("marked"), "digest-1", "fingerprint-1", "delivery",
                "olga", "olga", "", "ACME · olga", made), OLGA), "another purpose");
        assertFalse(MarkedVideosComponent.matches(new Copy("c1", file("marked"), "digest-1", "fingerprint-1", "download",
                "olga", "olga", "", "ACME · pablo", made), OLGA), "another text");
        assertFalse(MarkedVideosComponent.matches(new Copy("c1", null, "digest-1", "fingerprint-1", "download", "olga",
                "olga", "", "ACME · olga", made), OLGA), "no file");
    }

    @Test
    void aMarkerSaysWhenItWasQueued() {
        assertEquals(1234L, MarkedVideosComponent.queuedAt(MarkedVideosComponent.QUEUED + "1234"));
        assertEquals(-1L, MarkedVideosComponent.queuedAt("queued"));
        assertEquals(-1L, MarkedVideosComponent.queuedAt(null));
        assertEquals(-1L, MarkedVideosComponent.queuedAt(MarkedVideosComponent.QUEUED + "soon"));
    }
}
