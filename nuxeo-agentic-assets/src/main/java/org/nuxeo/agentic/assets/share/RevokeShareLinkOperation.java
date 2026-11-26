/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import org.nuxeo.ecm.automation.core.annotations.Context;
import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.automation.core.annotations.Param;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;

/** {@code ShareLink.Revoke}: one of the input document's share links stops opening, from the next request on. */
@Operation(id = RevokeShareLinkOperation.ID, category = "Share links", label = "Revoke a share link",
        description = "Revokes one of the input document's share links, by its id. Needs WriteSecurity on the "
                + "document. Returns the link as JSON.")
public class RevokeShareLinkOperation {

    public static final String ID = "ShareLink.Revoke";

    @Context
    protected CoreSession session;

    @Context
    protected ShareLinkService shareLinks;

    @Param(name = "link", description = "The link's id, as ShareLink.List answers it")
    protected String link;

    @OperationMethod
    public Blob run(DocumentModel document) {
        return Blobs.createJSONBlob(ShareLinkJson.revoked(shareLinks.revoke(session, document, link), shareLinks.now()));
    }
}
