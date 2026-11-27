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

    /** A credential's name, then its value: whatever the value's shape, it is not kept. */
    @Test
    void whatFollowsACredentialsNameIsReplaced() {
        String short_ = "Summer" + 2024 + "!";
        for (String name : new String[] { "password", "Password", "db.passwd", "pwd", "secret", "token", "apiKey",
                "api_key", "access-key", "client.credential", "private_key" }) {
            assertEquals("set " + name + "=" + Redaction.SECRET + " and retry",
                    Redaction.clean("set " + name + "=" + short_ + " and retry"), name);
            assertEquals("set " + name + ": " + Redaction.SECRET, Redaction.clean("set " + name + ": " + short_), name);
        }
        // Not a credential's value: the word alone, with nothing assigned to it.
        assertEquals("the events secret is shorter than 32 characters",
                Redaction.clean("the events secret is shorter than 32 characters"));
    }

    /** An Authorization header's value, and a scheme's credential, however short. */
    @Test
    void anAuthorizationHeaderAndASchemesCredentialAreReplaced() {
        String basic = java.util.Base64.getEncoder()
                                       .encodeToString(("svc" + ":" + keyShaped(9)).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertEquals("sent Authorization: " + Redaction.SECRET + " to the core system",
                Redaction.clean("sent Authorization: Basic " + basic + " to the core system"));
        assertEquals("with Bearer " + Redaction.SECRET, Redaction.clean("with Bearer " + keyShaped(12)));
        assertEquals("with basic " + Redaction.SECRET, Redaction.clean("with basic " + basic));
        // A scheme's name in a sentence, followed by a word with no digit or base64 sign: kept.
        assertEquals("a basic templates folder", Redaction.clean("a basic templates folder"));
    }

    /** A key in base64's own alphabet, with a slash, which the shorter rule's pieces would miss. */
    @Test
    void aBase64KeyWithSlashesIsReplacedAndAPathIsNot() {
        String key = mixedCase(20) + "/" + mixedCase(19);
        assertEquals("key " + Redaction.SECRET + " refused", Redaction.clean("key " + key + " refused"));
        // A path: its hyphens and dots break the run.
        assertEquals("agentic-ui-config/layouts/Acme2Asset/view.layout.json",
                Redaction.clean("agentic-ui-config/layouts/Acme2Asset/view.layout.json"));
    }

    /** A version or a name the report gives as a value of its own is held to its form, not cleaned. */
    @Test
    void aTimestampedVersionIsKeptWholeAndSomethingElseIsNotAVersion() {
        String build = "2026.0.2-" + "20261126114747" + "-BUILD-local";
        assertEquals("2026.0.[redacted]", Redaction.clean(build), "the token rule would take it for a key");
        assertEquals(build, Redaction.version(build));
        assertEquals(">=0.2.0 <1.0.0", Redaction.version(">=0.2.0 <1.0.0"));
        assertEquals("Nuxeo Platform", Redaction.version("Nuxeo Platform"));
        assertEquals("nuxeo-agentic-ui", Redaction.identifier("nuxeo-agentic-ui"));
        assertEquals(null, Redaction.version("2026 \"x\""));
        assertEquals(null, Redaction.version("1.0" + "@" + "b.invalid"));
        assertEquals(null, Redaction.identifier("payers claims"));
        assertEquals(null, Redaction.identifier("a" + "@" + "b.invalid"));
        assertEquals(null, Redaction.version(null));
    }

    private static String mixedCase(int length) {
        StringBuilder key = new StringBuilder();
        for (int i = 0; key.length() < length; i++) {
            key.append((char) ((i % 3 == 0 ? 'A' : 'a') + i % 26)).append(i % 10);
        }
        return key.substring(0, length);
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
