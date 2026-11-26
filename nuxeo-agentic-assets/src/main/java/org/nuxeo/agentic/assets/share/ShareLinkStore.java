/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * Where share links and their downloads are kept. Every read is of the store itself, never of a
 * copy held in memory: a revocation is seen by the next request, on any node.
 */
public interface ShareLinkStore {

    /** Keep a new link. */
    void create(ShareLink link);

    /** The link of this id, which is its token's hash. */
    Optional<ShareLink> find(String id);

    /** The links of a document, newest first, at most {@code limit}. */
    List<ShareLink> forDocument(String document, int limit);

    /**
     * Revoke a link, if it is not revoked already.
     *
     * @return the link as it is now, or empty when there is none of this id
     */
    Optional<ShareLink> revoke(String id, Instant at, String by);

    /** Log a download. */
    void logDownload(ShareDownload download);

    /** A document's downloads, newest first: at most {@code limit}, and whether there were more. */
    Downloads downloads(String document, int limit);

    /** Some of a document's downloads, newest first. */
    record Downloads(List<ShareDownload> downloads, boolean truncated) {

        public Downloads {
            downloads = List.copyOf(downloads);
        }
    }
}
