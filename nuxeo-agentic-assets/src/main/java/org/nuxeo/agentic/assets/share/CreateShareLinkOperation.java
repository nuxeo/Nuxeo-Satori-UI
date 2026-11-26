/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import org.nuxeo.ecm.automation.core.annotations.Context;
import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.automation.core.annotations.Param;
import org.nuxeo.ecm.automation.core.util.StringList;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.runtime.api.Framework;

/**
 * {@code ShareLink.Create}: a share link to the input document, for the items listed, until a day.
 *
 * <pre>
 * POST /nuxeo/api/v1/automation/ShareLink.Create
 * { "input": "doc:&lt;id&gt;", "params": { "renditions": ["view:FullHD", "original"], "end": "2026-12-14" } }
 * </pre>
 *
 * Answers {@link ShareLinkJson#creation}: the link, with its token and the path it opens at, which
 * is the only time the token is ever answered; or the items the rights refuse, and no link.
 */
@Operation(id = CreateShareLinkOperation.ID, category = "Share links", label = "Create a share link",
        description = "Creates a share link to the input document for the listed items ('original', or "
                + "'view:<title>'), opening until the end of 'end' (yyyy-MM-dd, UTC), for someone who is not signed "
                + "in. Needs WriteSecurity on the document. Returns the link and its token, once, as JSON.")
public class CreateShareLinkOperation {

    public static final String ID = "ShareLink.Create";

    @Context
    protected CoreSession session;

    @Context
    protected ShareLinkService shareLinks;

    @Param(name = "renditions", description = "The items: 'original', or 'view:<title>' for a picture view")
    protected StringList renditions;

    @Param(name = "end", description = "The link's last day, yyyy-MM-dd, in UTC")
    protected String end;

    @OperationMethod
    public Blob run(DocumentModel document) {
        ShareLinkService.Creation creation = shareLinks.create(session, document, renditions, end);
        return Blobs.createJSONBlob(ShareLinkJson.creation(creation, shareLinks.now(),
                Framework.getProperty("org.nuxeo.ecm.contextPath", "/nuxeo")));
    }
}
