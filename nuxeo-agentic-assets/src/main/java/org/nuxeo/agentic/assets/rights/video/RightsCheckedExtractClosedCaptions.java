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
import org.nuxeo.ecm.platform.video.tools.operations.ExtractClosedCaptionsFromVideo;

/**
 * {@code Video.ExtractClosedCaptions}, in place of the platform's: each input document's video, and a stored file given as its input,
 * decided by the asset's rights first ({@link VideoOperationRights}), then the platform's own
 * operation, with the same parameters, inputs and answers.
 */
@Operation(id = ExtractClosedCaptionsFromVideo.ID, category = "Conversion", label = "Extracts closed captions from the video.",
        description = "Extracts the closed captions from the whole video or from a part of it when startAt and end time "
                + "is provided. The output format references how the output is generated, and xpath can be used to "
                + "indicate the video blob when using documents. A document's video, or its stored file given as the input, is "
                + "refused, 403, when its asset's rights would refuse a download of it.")
public class RightsCheckedExtractClosedCaptions {

    /** The caller's session, from which a stored blob's holders are looked for. */
    @Context
    protected CoreSession session;

    @Param(name = "outFormat", required = false, values = { "ttxt", "srt", "txt" })
    protected String outFormat;

    @Param(name = "startAt", required = false)
    protected String startAt;

    @Param(name = "endAt", required = false)
    protected String endAt;

    @Param(name = "xpath", required = false)
    protected String xpath;

    @OperationMethod
    public Blob run(DocumentModel input) throws OperationException {
        VideoOperationRights.check(ExtractClosedCaptionsFromVideo.ID, session, input, xpath);
        return platform().run(input);
    }

    @OperationMethod
    public BlobList run(DocumentModelList input) throws OperationException {
        // The platform's reads each document as run(DocumentModel) does.
        for (DocumentModel document : input) {
            VideoOperationRights.check(ExtractClosedCaptionsFromVideo.ID, session, document, xpath);
        }
        return platform().run(input);
    }

    @OperationMethod(collector = BlobCollector.class)
    public Blob run(Blob input) throws OperationException {
        VideoOperationRights.checkStored(ExtractClosedCaptionsFromVideo.ID, session, input);
        return platform().run(input);
    }

    /** The platform's operation, given these parameters. */
    private ExtractClosedCaptionsFromVideo platform() {
        String format = outFormat;
        String start = startAt;
        String end = endAt;
        String path = xpath;
        return new ExtractClosedCaptionsFromVideo() {
            {
                this.outFormat = format;
                this.startAt = start;
                this.endAt = end;
                this.xpath = path;
            }
        };
    }
}
