/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.time.LocalDate;
import java.util.Set;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.DocumentModel;

/** The rights policies in force, and the decision for a download. */
public interface AssetRightsService {

    /** The policy for documents of {@code type}, or {@code null} when none covers it. */
    RightsPolicy policyFor(String type);

    /**
     * Every type a policy in force covers.
     *
     * @throws UnsupportedOperationException from an implementation that cannot list them: a caller
     *             deciding a stored file then refuses it
     */
    default Set<String> coveredTypes() {
        throw new UnsupportedOperationException("the covered types are not listed");
    }

    /** Today, as the rights read it: the server's day in UTC. */
    LocalDate today();

    /**
     * The rights of {@code document} under {@code policy}: its own fields, or its live document's
     * for a version or a proxy.
     *
     * @throws RuntimeException when they cannot be read; the caller refuses
     */
    AssetFacts facts(DocumentModel document, RightsPolicy policy);

    /**
     * What the rights decide for this download, or {@code null} when no policy covers the
     * document, which this add-on then never refuses. Never throws: a policy or a document that
     * cannot be read gives a {@code policy-error} refusal.
     *
     * @param rendition the rendition's name, or {@code null} when the download is not of one
     */
    DownloadDecision decideDownload(DocumentModel document, String xpath, Blob blob, String rendition);

    /** A decision with the use it is about. */
    record DownloadDecision(Use use, Decision decision) {
    }
}
