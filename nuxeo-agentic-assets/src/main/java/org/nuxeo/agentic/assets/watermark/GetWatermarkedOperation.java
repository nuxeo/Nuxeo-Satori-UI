/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import org.nuxeo.ecm.automation.core.Constants;
import org.nuxeo.ecm.automation.core.annotations.Context;
import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.automation.core.annotations.Param;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * {@code Asset.GetWatermarked}, since 0.5.0: a use of an asset its rights policy's watermark marks,
 * served marked for the person signed in ({@link WatermarkedFiles}), where the download endpoints
 * refuse it unmarked, {@code watermark-required}. The asset page asks for a view this way once the
 * server has refused it unmarked. Not a button: it reads, and changes nothing.
 */
@Operation(id = GetWatermarkedOperation.ID, category = Constants.CAT_BLOB, label = "Get a watermarked file",
        description = "A use of an asset, marked as its rights policy's watermark requires, for the person signed in:"
                + " original, view:<title>, rendition:<name>, blob:<xpath> or storyboard:<n>.")
public class GetWatermarkedOperation {

    public static final String ID = "Asset.GetWatermarked";

    @Context
    protected CoreSession session;

    @Param(name = "use", required = true)
    protected String use;

    @OperationMethod
    public Blob run(DocumentModel document) {
        return new WatermarkedFiles().serve(document, use, session.getPrincipal());
    }
}
