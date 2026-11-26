/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights.video;

import org.nuxeo.ecm.automation.OperationException;
import org.nuxeo.ecm.automation.core.annotations.Context;
import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.automation.core.annotations.Param;
import org.nuxeo.ecm.automation.core.collectors.BlobCollector;
import org.nuxeo.ecm.automation.core.util.BlobList;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentModelList;
import org.nuxeo.ecm.platform.video.tools.operations.SliceVideo;

/**
 * {@code Video.Slice}, in place of the platform's: each input document's video, and a stored file given as its input,
 * decided by the asset's rights first ({@link VideoOperationRights}), then the platform's own
 * operation, with the same parameters, inputs and answers.
 */
@Operation(id = SliceVideo.ID, category = "Conversion", label = "SliceVideo the video for a given duration and startAt time.",
        description = "SliceVideo the input blob starting at startAt, for a certain duration. The duration and startAt "
                + "arguments are optional, but not simultaneously. A specific converter can be used. A document's video, "
                + "or its stored file given as the input, is refused, 403, when its asset's rights would refuse a "
                + "download of it.")
public class RightsCheckedSliceVideo {

    /** The caller's session, from which a stored blob's holders are looked for. */
    @Context
    protected CoreSession session;

    @Param(name = "startAt", required = false)
    protected String startAt;

    @Param(name = "duration", required = false)
    protected String duration;

    @Param(name = "encode", required = false, values = { "true" })
    protected boolean encode = true;

    @Param(name = "xpath", required = false)
    protected String xpath;

    @OperationMethod
    public Blob run(DocumentModel input) throws OperationException {
        VideoOperationRights.check(SliceVideo.ID, session, input, xpath);
        return platform().run(input);
    }

    @OperationMethod
    public BlobList run(DocumentModelList input) throws OperationException {
        // The platform's slices each document as run(DocumentModel) does.
        for (DocumentModel document : input) {
            VideoOperationRights.check(SliceVideo.ID, session, document, xpath);
        }
        return platform().run(input);
    }

    @OperationMethod(collector = BlobCollector.class)
    public Blob run(Blob input) throws OperationException {
        VideoOperationRights.checkStored(SliceVideo.ID, session, input);
        return platform().run(input);
    }

    /** The platform's operation, given these parameters. */
    private SliceVideo platform() {
        String start = startAt;
        String length = duration;
        boolean reencode = encode;
        String path = xpath;
        return new SliceVideo() {
            {
                this.startAt = start;
                this.duration = length;
                this.encode = reencode;
                this.xpath = path;
            }
        };
    }
}
