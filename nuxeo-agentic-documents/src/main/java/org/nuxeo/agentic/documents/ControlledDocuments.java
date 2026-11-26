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

    /**
     * What a document id named in {@value #SUPERSEDES} may be before it is looked up: the letters,
     * digits and hyphens of the repository's ids, a UUID by default, and a whole number where a
     * repository is set to number its documents.
     */
    private static final Pattern DOCUMENT_ID = Pattern.compile("[A-Za-z0-9-]{1,64}");

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
}
