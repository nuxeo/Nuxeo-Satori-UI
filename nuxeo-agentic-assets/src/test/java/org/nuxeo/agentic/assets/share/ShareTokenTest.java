package org.nuxeo.agentic.assets.share;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HashSet;
import java.util.Set;

import org.junit.jupiter.api.Test;

/** A token: 256 bits from the generator it is given, one form only, and kept as its SHA-256. */
class ShareTokenTest {

    @Test
    void aTokenIs256BitsAs43CharactersOfBase64Url() {
        String token = ShareToken.generate(new SecureRandom());
        assertEquals(43, token.length());
        assertTrue(token.matches("[A-Za-z0-9_-]{43}"), token);
        assertEquals(32, Base64.getUrlDecoder().decode(token).length);
        assertTrue(ShareToken.wellFormed(token));
    }

    /** Drawn from the generator: the same seed gives the same token, so nothing else is mixed in or left out. */
    @Test
    void aTokenIsDrawnFromTheGeneratorItIsGiven() throws NoSuchAlgorithmException {
        SecureRandom first = SecureRandom.getInstance("SHA1PRNG");
        first.setSeed(42L);
        SecureRandom second = SecureRandom.getInstance("SHA1PRNG");
        second.setSeed(42L);
        assertEquals(ShareToken.generate(first), ShareToken.generate(second));
    }

    /** A rough check that every one of the 256 bits varies: one fixed, or a shorter draw, fails it. */
    @Test
    void everyBitOfATokenVaries() {
        SecureRandom random = new SecureRandom();
        int tokens = 4000;
        int[] set = new int[256];
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < tokens; i++) {
            String token = ShareToken.generate(random);
            assertTrue(seen.add(token), "a token came twice");
            byte[] bytes = Base64.getUrlDecoder().decode(token);
            for (int bit = 0; bit < 256; bit++) {
                if ((bytes[bit / 8] >> (bit % 8) & 1) == 1) {
                    set[bit]++;
                }
            }
        }
        for (int bit = 0; bit < 256; bit++) {
            assertTrue(set[bit] > tokens * 0.4 && set[bit] < tokens * 0.6, "bit " + bit + " is set " + set[bit] + " times");
        }
    }

    @Test
    void onlyATokensOneFormIsWellFormed() {
        String token = ShareToken.generate(new SecureRandom());
        for (String wrong : new String[] { null, "", token.substring(1), token + "A", token.substring(0, 42) + "+",
                token.substring(0, 42) + "/", token.substring(0, 42) + "=", token + "=", " " + token.substring(1),
                ShareToken.hash(token) }) {
            assertFalse(ShareToken.wellFormed(wrong), String.valueOf(wrong));
        }
        // The 43rd character carries 4 bits: the 48 characters that set the 2 unused bits are refused.
        String canonical = "AEIMQUYcgkosw048";
        String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        for (char last : alphabet.toCharArray()) {
            String variant = token.substring(0, 42) + last;
            assertEquals(canonical.indexOf(last) >= 0, ShareToken.wellFormed(variant), variant);
        }
    }

    @Test
    void aTokensHashIsItsSha256InLowercaseHex() {
        // The FIPS 180-2 test vector.
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", ShareToken.hash("abc"));
        String token = ShareToken.generate(new SecureRandom());
        assertTrue(ShareToken.isLinkId(ShareToken.hash(token)));
        assertFalse(ShareToken.hash(token).contains(token));
    }

    @Test
    void aLinkIdIs64LowercaseHexCharacters() {
        assertTrue(ShareToken.isLinkId("0".repeat(64)));
        for (String wrong : new String[] { null, "", "0".repeat(63), "0".repeat(65), "A".repeat(64), "g".repeat(64) }) {
            assertFalse(ShareToken.isLinkId(wrong), String.valueOf(wrong));
        }
    }

    @Test
    void hashesAreTheSameOnlyWhenEveryCharacterIs() {
        String hash = ShareToken.hash("abc");
        assertTrue(ShareToken.sameHash(hash, new String(hash)));
        assertFalse(ShareToken.sameHash(hash, hash.toUpperCase()));
        assertFalse(ShareToken.sameHash(hash, hash.substring(0, 63) + "0"));
        assertFalse(ShareToken.sameHash(hash, hash.substring(1)));
        assertFalse(ShareToken.sameHash(hash, null));
        assertFalse(ShareToken.sameHash(null, hash));
    }
}
