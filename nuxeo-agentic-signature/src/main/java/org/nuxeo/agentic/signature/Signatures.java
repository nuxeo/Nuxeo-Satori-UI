/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import java.io.Serializable;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * The add-on's names: its facets, schemas and properties, a request's statuses, and the forms of
 * the values it takes from outside.
 */
public final class Signatures {

    private Signatures() {
    }

    // ------------------------------------------------------------------ a signature request

    /** The facet of a kit's signature request type, which brings {@value #REQUEST_SCHEMA}. */
    public static final String REQUEST_FACET = "SignatureRequest";

    public static final String REQUEST_SCHEMA = "signature_request";

    public static final String REQUEST_PREFIX = "sigreq";

    /** Given by the requester: the record, by id. */
    public static final String DOCUMENT = "sigreq:document";

    /** Given by the requester: an attachment's file name, or none for {@code file:content}. */
    public static final String FILE_NAME = "sigreq:fileName";

    /** Given by the requester: the signers, each {@code name} and {@code email}. */
    public static final String SIGNERS = "sigreq:signers";

    /** Given by the requester: what the signers are told. */
    public static final String MESSAGE = "sigreq:message";

    public static final String STATUS = "sigreq:status";

    public static final String PROVIDER = "sigreq:provider";

    public static final String ENVELOPE = "sigreq:envelope";

    public static final String FILE = "sigreq:file";

    public static final String SENT_FILE_NAME = "sigreq:sentFileName";

    public static final String SENT_DIGEST = "sigreq:sentDigest";

    public static final String REQUESTED_BY = "sigreq:requestedBy";

    public static final String REQUESTED_AT = "sigreq:requestedAt";

    public static final String COMPLETED_AT = "sigreq:completedAt";

    public static final String DECLINE_REASON = "sigreq:declineReason";

    public static final String CANCELLED_BY = "sigreq:cancelledBy";

    public static final String SIGNED_FILE = "sigreq:signedFile";

    public static final String SIGNED_DIGEST = "sigreq:signedDigest";

    public static final String EVIDENCE = "sigreq:evidence";

    public static final String EVIDENCE_DIGEST = "sigreq:evidenceDigest";

    public static final String SIGNED_VERSION = "sigreq:signedVersion";

    public static final String EVENT = "sigreq:event";

    /** What the requester gives. */
    public static final List<String> REQUESTER_PROPERTIES = List.of(DOCUMENT, FILE_NAME, SIGNERS, MESSAGE);

    /** What the server writes, and no one else. */
    public static final List<String> SERVER_PROPERTIES = List.of(STATUS, PROVIDER, ENVELOPE, FILE, SENT_FILE_NAME,
            SENT_DIGEST, REQUESTED_BY, REQUESTED_AT, COMPLETED_AT, DECLINE_REASON, CANCELLED_BY, SIGNED_FILE,
            SIGNED_DIGEST, EVIDENCE, EVIDENCE_DIGEST, SIGNED_VERSION, EVENT);

    public static final List<String> REQUEST_PROPERTIES = Stream.concat(REQUESTER_PROPERTIES.stream(),
            SERVER_PROPERTIES.stream()).toList();

    // ------------------------------------------------------------------ a record that can be signed

    /** The facet of a kit's record type whose files may be sent, which brings {@value #SIGNABLE_SCHEMA}. */
    public static final String SIGNABLE_FACET = "Signable";

    public static final String SIGNABLE_SCHEMA = "signable";

    public static final String SIGNABLE_PREFIX = "sgn";

    public static final String SGN_STATUS = "sgn:status";

    public static final String SGN_REQUEST = "sgn:request";

    public static final String SGN_SIGNERS = "sgn:signers";

    public static final String SGN_SENT_AT = "sgn:sentAt";

    public static final String SGN_COMPLETED_AT = "sgn:completedAt";

    public static final String SGN_FILE = "sgn:file";

    public static final String SGN_FILE_DIGEST = "sgn:fileDigest";

    public static final String SGN_EVIDENCE = "sgn:evidence";

    public static final List<String> SIGNABLE_PROPERTIES = List.of(SGN_STATUS, SGN_REQUEST, SGN_SIGNERS, SGN_SENT_AT,
            SGN_COMPLETED_AT, SGN_FILE, SGN_FILE_DIGEST, SGN_EVIDENCE);

    // ------------------------------------------------------------------ statuses

    /** Sent to the provider, and awaiting its signers. */
    public static final String SENT = "sent";

    public static final String SIGNED = "signed";

    public static final String DECLINED = "declined";

    /** Called off by its requester or an administrator while it was out. */
    public static final String CANCELLED = "cancelled";

    // ------------------------------------------------------------------ limits and forms

    public static final int MAX_SIGNERS = 10;

    public static final int MAX_NAME = 200;

    public static final int MAX_TITLE = 200;

    public static final int MAX_MESSAGE = 1000;

    public static final int MAX_REASON = 1000;

    /** The main file of a record that has Nuxeo's {@code file} schema. */
    public static final String MAIN_FILE = "file:content";

    /** An attachment's file, by its place in Nuxeo's {@code files} schema. */
    public static final Pattern ATTACHMENT = Pattern.compile("files:files/(0|[1-9][0-9]{0,3})/file");

    /** A document's id, as Nuxeo writes one. */
    public static final Pattern DOCUMENT_ID = Pattern.compile("[0-9A-Za-z][0-9A-Za-z-]{0,63}");

    /** A provider's id, which its callback's path names. */
    public static final Pattern PROVIDER_ID = Pattern.compile("[a-z][a-z0-9-]{0,31}");

    /** An envelope's or a callback's id at a provider: one path segment, never {@code .} or {@code ..}. */
    public static final Pattern EXTERNAL_ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,127}");

    /**
     * An email address, as the add-on takes one: a plain local part and a host of at least two
     * labels, 254 characters at most. Narrower than the standard on purpose: it is sent to an
     * outside service, which mails it.
     */
    public static final Pattern EMAIL = Pattern.compile(
            "(?=.{3,254}$)[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
                    + "@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+");

    /** Whether the add-on writes and guards this document under {@code facet}: a live one with it. */
    public static boolean isLive(DocumentModel doc, String facet) {
        return doc != null && doc.hasFacet(facet) && !doc.isProxy() && !doc.isVersion();
    }

    /** A text property, trimmed; {@code null} when empty. */
    public static String text(DocumentModel doc, String xpath) {
        Serializable value = doc.getPropertyValue(xpath);
        if (value == null) {
            return null;
        }
        String text = value.toString().trim();
        return text.isEmpty() ? null : text;
    }

    /** Whether {@code text} holds a control character other than a tab or a line break. */
    public static boolean hasControl(String text, boolean lineBreaks) {
        return text.chars().anyMatch(c -> (c < 0x20 && !(lineBreaks && (c == '\n' || c == '\r' || c == '\t')))
                || c == 0x7f || (c >= 0x80 && c < 0xa0) || c == 0x2028 || c == 0x2029);
    }
}
