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

/** {@code ShareLink.List}: the input document's share links, newest first, with no token. */
@Operation(id = ListShareLinksOperation.ID, category = "Share links", label = "List share links",
        description = "Lists the input document's share links, newest first. Needs WriteSecurity on the document.")
public class ListShareLinksOperation {

    public static final String ID = "ShareLink.List";

    @Context
    protected CoreSession session;

    @Context
    protected ShareLinkService shareLinks;

    @OperationMethod
    public Blob run(DocumentModel document) {
        return Blobs.createJSONBlob(ShareLinkJson.links(shareLinks.list(session, document), shareLinks.now()));
    }
}
