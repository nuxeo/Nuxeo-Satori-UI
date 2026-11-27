/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;

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
     * for a version or a proxy; and, under a policy whose {@code <windows>} names a
     * {@code document}, the release windows of the document that property names.
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

    /**
     * As {@link #decideDownload(DocumentModel, String, Blob, String)}, for {@code person}: since 0.5.0,
     * a use the rights allow and the policy's watermark marks for them is refused unmarked,
     * {@code watermark-required}. With no person, no one is exempt from the watermark, which is how the
     * four-argument form decides. An implementation that does not read the person decides as that form.
     */
    default DownloadDecision decideDownload(DocumentModel document, String xpath, Blob blob, String rendition,
            NuxeoPrincipal person) {
        return decideDownload(document, xpath, blob, rendition);
    }

    /**
     * What the rights decide for a delivery of {@code document}'s package to {@code territory}: each
     * file its policy's {@code <delivery>} lists, decided by its rule for that territory, and found
     * on the document. Never throws: a document, a policy or rights that cannot be read give a
     * refusal of the whole package.
     *
     * @throws UnsupportedOperationException from an implementation that cannot decide one: the
     *             caller then refuses the delivery
     */
    default DeliveryDecision decideDelivery(DocumentModel document, String territory) {
        throw new UnsupportedOperationException("deliveries are not decided here");
    }

    /** A decision with the use it is about. */
    record DownloadDecision(Use use, Decision decision) {
    }

    /**
     * One file of a delivery's package: its use, what the rights decide for it, and, when they allow
     * it, the file the document holds for it.
     */
    record PackageFile(Use use, Decision decision, Blob blob) {
    }

    /**
     * What a delivery's package is decided as: refused whole for a reason of its own, or file by file.
     *
     * @param refused the package's own refusal, such as no policy, a broken one or rights that cannot
     *            be read; {@code null} when it was decided file by file
     * @param files each file, in the package's order; empty when {@code refused} is set
     */
    record DeliveryDecision(Decision refused, List<PackageFile> files) {

        public DeliveryDecision {
            files = List.copyOf(files);
        }

        /** Delivered only whole: every file allowed and found, and no refusal of the package's own. */
        public boolean delivered() {
            return refused == null && !files.isEmpty()
                    && files.stream().allMatch(file -> file.decision().allowed() && file.blob() != null);
        }
    }
}
