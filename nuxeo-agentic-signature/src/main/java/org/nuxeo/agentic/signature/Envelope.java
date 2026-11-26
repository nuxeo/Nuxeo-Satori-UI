/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import java.util.List;

/**
 * What is sent for signature: one file, as the record held it, and who signs it.
 *
 * @param reference the add-on's own id for the send, random, which a provider may keep beside its envelope
 * @param subject the request's title, which the signers see
 * @param message what the signers are told, or {@code null}
 * @param signers who signs, in order
 * @param fileName the file's name
 * @param mimeType its type
 * @param content its bytes
 * @param sha256 their SHA-256, in lower-case hexadecimal
 */
public record Envelope(String reference, String subject, String message, List<Signer> signers, String fileName,
        String mimeType, byte[] content, String sha256) {

    /** A signer: a name and an email address, which the provider mails. */
    public record Signer(String name, String email) {
    }

    /** Never the content, nor the signers' addresses: a record's {@code toString} could be logged. */
    @Override
    public String toString() {
        return "Envelope[" + reference + ", " + signers.size() + " signer(s), " + content.length + " bytes]";
    }
}
