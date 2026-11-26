/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import java.io.Serializable;
import java.util.List;
import java.util.regex.Pattern;

import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * The controlled document's facet, its schema's properties, and how they are read.
 *
 * <p>A controlled document is any document whose type has the {@value #FACET} facet. Its six
 * properties are the add-on's to write ({@link ControlledDocumentListener}): a creator chooses the
 * series of a new document, or names the revision a new one supersedes, and nothing else.
 */
public final class ControlledDocuments {

    /** The facet a kit's document type carries to be controlled. */
    public static final String FACET = "ControlledDocument";

    /** The facet's schema, and its prefix. */
    public static final String SCHEMA = "controlled_document";

    public static final String PREFIX = "docctl";

    /** The number series, chosen by the creator of a document's first revision. */
    public static final String SERIES = PREFIX + ":series";

    /** The document number, given from the series on the first revision, carried by the others. */
    public static final String NUMBER = PREFIX + ":number";

    /** The revision, given: the series' first, then the next after the one superseded. */
    public static final String REVISION = PREFIX + ":revision";

    /** {@value #CURRENT} or {@value #SUPERSEDED}. */
    public static final String STATUS = PREFIX + ":status";

    /** The id of the revision this one supersedes, named by its creator; empty for a first revision. */
    public static final String SUPERSEDES = PREFIX + ":supersedes";

    /** The id of the revision that superseded this one; empty while it is current. */
    public static final String SUPERSEDED_BY = PREFIX + ":supersededBy";

    public static final String CURRENT = "current";

    public static final String SUPERSEDED = "superseded";

    /** Every property of the schema, in the order a refusal names them. */
    public static final List<String> PROPERTIES = List.of(SERIES, NUMBER, REVISION, STATUS, SUPERSEDES,
            SUPERSEDED_BY);

    // ------------------------------------------------------------------ the review record

    /**
     * The controlled document's second schema, prefix {@value #REVIEW_PREFIX}: the review cycles
     * closed on the revision, which the add-on writes when one closes.
     */
    public static final String REVIEW_SCHEMA = "controlled_review";

    public static final String REVIEW_PREFIX = "docrev";

    /** Each closed cycle: {@code cycle}, {@code closedBy}, {@code closedAt}, {@code comments}. */
    public static final String REVIEW_CYCLES = REVIEW_PREFIX + ":cycles";

    // ------------------------------------------------------------------ the export-control mark

    /**
     * The controlled document's third schema, prefix {@value #MARK_PREFIX}, since 0.3.0: the
     * revision's export-control mark ({@link ExportMarks}).
     */
    public static final String MARK_SCHEMA = "export_mark";

    public static final String MARK_PREFIX = "docmark";

    /** Written by a holder of {@value ExportMarks#PERMISSION}: the classification, such as {@code EC-2}. */
    public static final String MARK_CLASSIFICATION = MARK_PREFIX + ":classification";

    /** Written with it: the groups that may receive the revision, a member of any one of them. */
    public static final String MARK_GROUPS = MARK_PREFIX + ":groups";

    /** The server's: who last set, changed or removed the mark. */
    public static final String MARK_MARKED_BY = MARK_PREFIX + ":markedBy";

    /** The server's: when. */
    public static final String MARK_MARKED_AT = MARK_PREFIX + ":markedAt";

    /** Every property of the mark's schema, in the order a refusal names them. */
    public static final List<String> MARK_PROPERTIES = List.of(MARK_CLASSIFICATION, MARK_GROUPS, MARK_MARKED_BY,
            MARK_MARKED_AT);

    // ------------------------------------------------------------------ transmittals

    /** The facet a kit's transmittal type carries. */
    public static final String TRANSMITTAL_FACET = "Transmittal";

    public static final String TRANSMITTAL_SCHEMA = "transmittal";

    public static final String TRANSMITTAL_PREFIX = "trm";

    /** Given from the series registered for transmittals. */
    public static final String TRM_NUMBER = TRANSMITTAL_PREFIX + ":number";

    /** The issuer's: each a document number or id; the server writes back each revision's id. */
    public static final String TRM_DOCUMENTS = TRANSMITTAL_PREFIX + ":documents";

    /** Given: each listed revision's id, number, revision and title, as they were when issued. */
    public static final String TRM_ITEMS = TRANSMITTAL_PREFIX + ":items";

    /** The issuer's: the user names it is sent to. */
    public static final String TRM_RECIPIENTS = TRANSMITTAL_PREFIX + ":recipients";

    /** The issuer's: {@value #FOR_REVIEW}, {@value #FOR_CONSTRUCTION} or {@value #FOR_INFORMATION}. */
    public static final String TRM_PURPOSE = TRANSMITTAL_PREFIX + ":purpose";

    /** The issuer's: the day the recipients are to answer by. */
    public static final String TRM_DUE_DATE = TRANSMITTAL_PREFIX + ":dueDate";

    public static final String TRM_ISSUED_BY = TRANSMITTAL_PREFIX + ":issuedBy";

    public static final String TRM_ISSUED_AT = TRANSMITTAL_PREFIX + ":issuedAt";

    public static final List<String> TRANSMITTAL_PROPERTIES = List.of(TRM_NUMBER, TRM_DOCUMENTS, TRM_ITEMS,
            TRM_RECIPIENTS, TRM_PURPOSE, TRM_DUE_DATE, TRM_ISSUED_BY, TRM_ISSUED_AT);

    public static final String FOR_REVIEW = "review";

    public static final String FOR_CONSTRUCTION = "construction";

    public static final String FOR_INFORMATION = "information";

    public static final List<String> PURPOSES = List.of(FOR_REVIEW, FOR_CONSTRUCTION, FOR_INFORMATION);

    /** The facet of one recipient's receipt of a transmittal, which the add-on creates. */
    public static final String RECEIPT_FACET = "TransmittalReceipt";

    public static final String RECEIPT_SCHEMA = "transmittal_receipt";

    public static final String RECEIPT_PREFIX = "trr";

    public static final String TRR_TRANSMITTAL = RECEIPT_PREFIX + ":transmittal";

    public static final String TRR_NUMBER = RECEIPT_PREFIX + ":number";

    public static final String TRR_RECIPIENT = RECEIPT_PREFIX + ":recipient";

    public static final String TRR_PURPOSE = RECEIPT_PREFIX + ":purpose";

    public static final String TRR_DUE_DATE = RECEIPT_PREFIX + ":dueDate";

    public static final String TRR_ISSUED_BY = RECEIPT_PREFIX + ":issuedBy";

    /** {@value #AWAITING}, then the recipient's {@value #ACKNOWLEDGED} or {@value #RETURNED}. */
    public static final String TRR_STATUS = RECEIPT_PREFIX + ":status";

    /** The recipient's comment, with their answer; required with a return. */
    public static final String TRR_COMMENT = RECEIPT_PREFIX + ":comment";

    public static final String TRR_RESPONDED_AT = RECEIPT_PREFIX + ":respondedAt";

    public static final List<String> RECEIPT_PROPERTIES = List.of(TRR_TRANSMITTAL, TRR_NUMBER, TRR_RECIPIENT,
            TRR_PURPOSE, TRR_DUE_DATE, TRR_ISSUED_BY, TRR_STATUS, TRR_COMMENT, TRR_RESPONDED_AT);

    public static final String AWAITING = "awaiting";

    public static final String ACKNOWLEDGED = "acknowledged";

    public static final String RETURNED = "returned";

    // ------------------------------------------------------------------ review cycles

    /** The facet a kit's review cycle type carries. */
    public static final String CYCLE_FACET = "ReviewCycle";

    public static final String CYCLE_SCHEMA = "review_cycle";

    public static final String CYCLE_PREFIX = "rvw";

    /** The opener's: the id of the revision reviewed. */
    public static final String RVW_DOCUMENT = CYCLE_PREFIX + ":document";

    public static final String RVW_NUMBER = CYCLE_PREFIX + ":number";

    public static final String RVW_REVISION = CYCLE_PREFIX + ":revision";

    /** The opener's: the user names who review it. */
    public static final String RVW_REVIEWERS = CYCLE_PREFIX + ":reviewers";

    /** The opener's, optional. */
    public static final String RVW_DUE_DATE = CYCLE_PREFIX + ":dueDate";

    /** {@value #OPEN}, then {@value #CLOSED}, which the opener asks for. */
    public static final String RVW_STATUS = CYCLE_PREFIX + ":status";

    public static final String RVW_OPENED_BY = CYCLE_PREFIX + ":openedBy";

    public static final String RVW_OPENED_AT = CYCLE_PREFIX + ":openedAt";

    public static final String RVW_CLOSED_BY = CYCLE_PREFIX + ":closedBy";

    public static final String RVW_CLOSED_AT = CYCLE_PREFIX + ":closedAt";

    /** How many comments the cycle had to resolve when it closed. */
    public static final String RVW_COMMENTS = CYCLE_PREFIX + ":comments";

    public static final List<String> CYCLE_PROPERTIES = List.of(RVW_DOCUMENT, RVW_NUMBER, RVW_REVISION,
            RVW_REVIEWERS, RVW_DUE_DATE, RVW_STATUS, RVW_OPENED_BY, RVW_OPENED_AT, RVW_CLOSED_BY, RVW_CLOSED_AT,
            RVW_COMMENTS);

    public static final String OPEN = "open";

    public static final String CLOSED = "closed";

    /**
     * The facet the add-on gives a Nuxeo comment written in a review cycle, at its creation: a
     * document's own facet, not its type's, so Nuxeo's {@code Comment} type is not changed.
     */
    public static final String COMMENT_FACET = "ReviewComment";

    public static final String COMMENT_SCHEMA = "review_comment";

    public static final String COMMENT_PREFIX = "rvwc";

    /** The cycle the comment was written in, its own or its thread's. */
    public static final String RVWC_CYCLE = COMMENT_PREFIX + ":cycle";

    /** A thread's first comment: {@value #OPEN} or {@value #RESOLVED}. Empty on a reply. */
    public static final String RVWC_STATUS = COMMENT_PREFIX + ":status";

    /** The cycle's opener's note, with a resolution. */
    public static final String RVWC_RESOLUTION = COMMENT_PREFIX + ":resolution";

    public static final String RVWC_RESOLVED_BY = COMMENT_PREFIX + ":resolvedBy";

    public static final String RVWC_RESOLVED_AT = COMMENT_PREFIX + ":resolvedAt";

    public static final List<String> COMMENT_PROPERTIES = List.of(RVWC_CYCLE, RVWC_STATUS, RVWC_RESOLUTION,
            RVWC_RESOLVED_BY, RVWC_RESOLVED_AT);

    public static final String RESOLVED = "resolved";

    /** Nuxeo's comment schema, which every comment and annotation has. */
    public static final String NUXEO_COMMENT_SCHEMA = "comment";

    /** Every facet of the add-on: a document holding one is not copied, nor restored over. */
    public static final List<String> FACETS = List.of(FACET, TRANSMITTAL_FACET, RECEIPT_FACET, CYCLE_FACET,
            COMMENT_FACET);

    /**
     * What a document id named in {@value #SUPERSEDES} may be before it is looked up: the letters,
     * digits and hyphens of the repository's ids, a UUID by default, and a whole number where a
     * repository is set to number its documents.
     */
    private static final Pattern DOCUMENT_ID = Pattern.compile("[A-Za-z0-9-]{1,64}");

    /**
     * A user name a transmittal or a cycle may name: letters, digits and {@code @ . _ + -}, as
     * Nuxeo's user directory and an email address write them, 128 characters at most. The server
     * does not check that such a user exists.
     */
    private static final Pattern USER_NAME = Pattern.compile("[A-Za-z0-9@._+-]{1,128}");

    private ControlledDocuments() {
    }

    /** Whether the add-on numbers and guards this document: a live one, with the facet. */
    public static boolean isControlled(DocumentModel doc) {
        return doc != null && doc.hasFacet(FACET) && !doc.isProxy() && !doc.isVersion();
    }

    /** A text property, trimmed, with {@code null} for an empty one. */
    public static String text(DocumentModel doc, String xpath) {
        Serializable value = doc.getPropertyValue(xpath);
        if (value == null) {
            return null;
        }
        String text = value.toString().trim();
        return text.isEmpty() ? null : text;
    }

    /** Whether {@code value} may be looked up as a document's id. */
    public static boolean isDocumentId(String value) {
        return value != null && DOCUMENT_ID.matcher(value).matches();
    }

    /**
     * Whether {@code value} has a user name's form, and is not {@code system}, the name Nuxeo gives
     * server code that acts for no one, which no person may be named as.
     */
    public static boolean isUserName(String value) {
        return value != null && USER_NAME.matcher(value).matches() && !"system".equalsIgnoreCase(value);
    }

    /** Whether the add-on writes and guards this document under {@code facet}: a live one with it. */
    public static boolean isLive(DocumentModel doc, String facet) {
        return doc != null && doc.hasFacet(facet) && !doc.isProxy() && !doc.isVersion();
    }
}
