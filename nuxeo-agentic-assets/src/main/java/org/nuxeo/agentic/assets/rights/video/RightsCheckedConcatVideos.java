/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights.video;

import java.io.IOException;

import org.nuxeo.ecm.automation.core.annotations.Context;
import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.automation.core.annotations.Param;
import org.nuxeo.ecm.automation.core.util.BlobList;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentModelList;
import org.nuxeo.ecm.platform.commandline.executor.api.CommandNotAvailable;
import org.nuxeo.ecm.platform.video.tools.operations.ConcatVideos;

/**
 * {@code Video.Concat}, in place of the platform's: every input document's video, and a stored file given as its input,
 * decided by the asset's rights first ({@link VideoOperationRights}), one refused refusing the whole join, then the platform's own
 * operation, with the same parameters, inputs and answers.
 */
@Operation(id = ConcatVideos.ID, category = "Files", label = "Joins two or more videos sequentially.",
        description = "Merge 2-n videos in one. A document's video, or its stored file given as an input, is "
                + "refused, 403, when its asset's rights would refuse a download of it.")
public class RightsCheckedConcatVideos {

    /** The caller's session, from which a stored blob's holders are looked for. */
    @Context
    protected CoreSession session;

    @Param(name = "xpath", required = false)
    protected String xpath;

    @OperationMethod
    public Blob run(BlobList input) throws IOException, CommandNotAvailable {
        for (Blob blob : input) {
            VideoOperationRights.checkStored(ConcatVideos.ID, session, blob);
        }
        return platform().run(input);
    }

    @OperationMethod
    public Blob run(DocumentModelList input) throws IOException, CommandNotAvailable {
        for (DocumentModel document : input) {
            VideoOperationRights.check(ConcatVideos.ID, session, document, xpath);
        }
        return platform().run(input);
    }

    /** The platform's operation, given these parameters. */
    private ConcatVideos platform() {
        String path = xpath;
        return new ConcatVideos() {
            {
                this.xpath = path;
            }
        };
    }
}
