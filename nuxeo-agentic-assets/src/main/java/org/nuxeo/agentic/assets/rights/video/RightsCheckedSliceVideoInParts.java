/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights.video;

import org.nuxeo.ecm.automation.OperationException;
import org.nuxeo.ecm.automation.core.annotations.Context;
import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.automation.core.annotations.Param;
import org.nuxeo.ecm.automation.core.util.BlobList;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.platform.video.tools.operations.SliceVideoInParts;

/**
 * {@code Video.SliceInParts}, in place of the platform's: the input document's video, and a stored file given as its input,
 * decided by the asset's rights first ({@link VideoOperationRights}), then the platform's own
 * operation, with the same parameters, inputs and answers.
 */
@Operation(id = SliceVideoInParts.ID, category = "Conversion", label = "SliceVideo a Video in Parts with equal duration.",
        description = "Slices the video in n parts of approximately the same duration each. A document's video, or its "
                + "stored file given as the input, is refused, 403, when its asset's rights would refuse a download of "
                + "it.")
public class RightsCheckedSliceVideoInParts {

    /** The caller's session, from which a stored blob's holders are looked for. */
    @Context
    protected CoreSession session;

    @Param(name = "duration", required = false)
    protected String duration;

    @Param(name = "xpath", required = false)
    protected String xpath;

    @OperationMethod
    public BlobList run(DocumentModel input) throws OperationException {
        VideoOperationRights.check(SliceVideoInParts.ID, session, input, xpath);
        return platform().run(input);
    }

    @OperationMethod
    public BlobList run(Blob input) throws OperationException {
        VideoOperationRights.checkStored(SliceVideoInParts.ID, session, input);
        return platform().run(input);
    }

    /** The platform's operation, given these parameters. */
    private SliceVideoInParts platform() {
        String length = duration;
        String path = xpath;
        return new SliceVideoInParts() {
            {
                this.duration = length;
                this.xpath = path;
            }
        };
    }
}
