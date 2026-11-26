/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import org.nuxeo.ecm.automation.core.annotations.Context;
import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;

/** {@code ShareLink.Downloads}: the downloads through the input document's share links, newest first. */
@Operation(id = ShareLinkDownloadsOperation.ID, category = "Share links", label = "Share link downloads",
        description = "Lists the downloads through the input document's share links, newest first, at most 200: when, "
                + "through which link, of which item. Needs WriteSecurity on the document.")
public class ShareLinkDownloadsOperation {

    public static final String ID = "ShareLink.Downloads";

    @Context
    protected CoreSession session;

    @Context
    protected ShareLinkService shareLinks;

    @OperationMethod
    public Blob run(DocumentModel document) {
        return Blobs.createJSONBlob(ShareLinkJson.downloads(shareLinks.downloads(session, document)));
    }
}
