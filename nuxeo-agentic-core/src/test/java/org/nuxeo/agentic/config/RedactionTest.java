package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * The second line before a message reaches the diagnostics page's "copy for support" text. Every
 * key-shaped string here is made at run time, so that none is committed.
 */
class RedactionTest {

    private static String keyShaped(int length) {
        StringBuilder key = new StringBuilder();
        for (int i = 0; key.length() < length; i++) {
            key.append((char) ('a' + i % 26)).append(i % 10);
        }
        return key.substring(0, length);
    }

    @Test
    void theConfigurationsOwnWordsAreKept() {
        for (String message : new String[] {
                "payers-claims queues/open.json is not valid JSON: Unexpected character ('n' (code 110))",
                "org.nuxeo.agentic.ui.config.defaults replaced acme-outdoor-brand-assets-config-defaults",
                "agentic-ui-config/layouts/AcmeAsset/view.layout.json is 2097153 bytes; the limit is 1048576." }) {
            assertEquals(message, Redaction.clean(message));
        }
    }

    @Test
    void anAddressIsReplaced() {
        String address = "dana.reyes" + "@" + "claims.example.invalid";
        assertEquals("sent to " + Redaction.EMAIL + " twice", Redaction.clean("sent to " + address + " twice"));
    }

    @Test
    void aUrlLosesWhoItSignsInAsAndItsQuery() {
        String url = "https://svc:" + keyShaped(30) + "@core.example.invalid/v2/claims?token=" + keyShaped(40)
                + "#frag";
        assertEquals("calling https://core.example.invalid/v2/claims failed",
                Redaction.clean("calling " + url + " failed"));
    }

    @Test
    void aHomeDirectorysOwnerIsReplaced() {
        assertEquals("/home/[user]/x.json", Redaction.clean("/home/dreyes/x.json"));
        assertEquals("/Users/[user]/Desktop/x.json", Redaction.clean("/Users/dana.reyes/Desktop/x.json"));
        assertEquals("C:\\Users\\[user]\\x.json", Redaction.clean("C:\\Users\\dreyes\\x.json"));
        assertEquals("/var/lib/nuxeo/agentic-ui-config-dev/a.json",
                Redaction.clean("/var/lib/nuxeo/agentic-ui-config-dev/a.json"));
    }

    @Test
    void aKeyShapedStringIsReplacedAndAShortOrWordyOneIsNot() {
        assertEquals("key " + Redaction.SECRET + " refused", Redaction.clean("key " + keyShaped(32) + " refused"));
        assertEquals("key " + Redaction.SECRET, Redaction.clean("key " + keyShaped(Redaction.TOKEN_LENGTH)));
        String short_ = keyShaped(Redaction.TOKEN_LENGTH - 1);
        assertEquals("key " + short_, Redaction.clean("key " + short_));
        // Long, but no digit: a name, not a key.
        assertEquals("payers-claims-demo-operations-config", Redaction.clean("payers-claims-demo-operations-config"));
    }

    @Test
    void controlCharactersAndLengthAreBounded() {
        assertEquals("a b c", Redaction.clean("a\nb\u0007c"));
        String cleaned = Redaction.clean("x".repeat(Redaction.MAX_LENGTH * 3));
        assertEquals(Redaction.MAX_LENGTH, cleaned.codePointCount(0, cleaned.length()));
        assertTrue(cleaned.endsWith("…"));
        assertEquals("", Redaction.clean(null));
        assertFalse(Redaction.clean("plain").contains(Redaction.SECRET));
    }
}
