/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.time.LocalDate;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.DocumentModel;

/** The rights policies in force, and the decision for a download. */
public interface AssetRightsService {

    /** The policy for documents of {@code type}, or {@code null} when none covers it. */
    RightsPolicy policyFor(String type);

    /** Today, as the rights read it: the server's day in UTC. */
    LocalDate today();

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
