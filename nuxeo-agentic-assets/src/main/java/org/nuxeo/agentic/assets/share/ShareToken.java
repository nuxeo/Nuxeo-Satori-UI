/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.regex.Pattern;

/**
 * A share link's token: what its address carries, and what the server never keeps.
 *
 * <ul>
 * <li><strong>256 bits from a CSPRNG,</strong> {@link SecureRandom}, written as 43 characters of
 * base64url with no padding, so that it travels in an address unescaped.</li>
 * <li><strong>The server keeps its SHA-256 only,</strong> as 64 lowercase hexadecimal characters:
 * the link's id. A token of 256 random bits needs no salt or key: its hash cannot be reversed or
 * searched for, so a copy of the store opens no link.</li>
 * <li><strong>A token is checked for its form before anything is looked up,</strong> so that a
 * request with anything else in its place costs no read of the store. Only the canonical form is
 * accepted: the 43rd character carries 4 bits, and one of the 16 characters that leave the 2
 * unused bits zero.</li>
 * <li><strong>Hashes are compared in constant time</strong> ({@link MessageDigest#isEqual}), after
 * the store has found the link by its hash: the store's own lookup is by a hash the caller cannot
 * choose the bits of, and the comparison guards a store that matches more loosely, such as a
 * database whose collation ignores case.</li>
 * </ul>
 */
public final class ShareToken {

    /** 256 bits. */
    static final int BYTES = 32;

    /** 32 bytes in base64url with no padding. */
    static final int LENGTH = 43;

    private static final Pattern FORM = Pattern.compile("[A-Za-z0-9_-]{" + LENGTH + "}");

    /** A link's id: the SHA-256 of its token, in lowercase hexadecimal. */
    private static final Pattern HASH = Pattern.compile("[0-9a-f]{64}");

    private ShareToken() {
    }

    /** A new token, from {@code random}. */
    public static String generate(SecureRandom random) {
        byte[] bytes = new byte[BYTES];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** Whether {@code token} has a token's form: 43 base64url characters, in their canonical form. */
    public static boolean wellFormed(String token) {
        if (token == null || token.length() != LENGTH || !FORM.matcher(token).matches()) {
            return false;
        }
        // A token is written in one way only: decoded and encoded again, it is the same text.
        byte[] bytes = Base64.getUrlDecoder().decode(token);
        return bytes.length == BYTES && Base64.getUrlEncoder().withoutPadding().encodeToString(bytes).equals(token);
    }

    /** The token's SHA-256, in lowercase hexadecimal: the link's id, and all the server keeps of it. */
    public static String hash(String token) {
        try {
            MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(sha256.digest(token.getBytes(StandardCharsets.US_ASCII)));
        } catch (NoSuchAlgorithmException e) {
            // Every Java platform has SHA-256.
            throw new IllegalStateException(e);
        }
    }

    /** Whether {@code id} has a link id's form: 64 lowercase hexadecimal characters. */
    public static boolean isLinkId(String id) {
        return id != null && HASH.matcher(id).matches();
    }

    /** Whether two link ids are the same, in time that does not depend on where they differ. */
    public static boolean sameHash(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.US_ASCII), b.getBytes(StandardCharsets.US_ASCII));
    }
}
