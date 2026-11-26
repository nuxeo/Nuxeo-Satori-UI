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
import org.nuxeo.ecm.platform.video.tools.operations.AddWatermarkToVideo;

/**
 * {@code Video.AddWatermark}, in place of the platform's: each input document's video, a stored file
 * given as its input, and the watermark document's {@code file:content}, which the platform draws
 * into the video it answers, decided by their assets' rights first ({@link VideoOperationRights}),
 * then the platform's own operation, with the same parameters, inputs and answers.
 */
@Operation(id = AddWatermarkToVideo.ID, category = "Files", label = "Watermarks a Video with a Picture",
        description = "Watermark the video with the picture stored in file:content of watermark, at the position(x, y) "
                + "from the left-top corner of the picture. A document's video, its stored file given as the input, "
                + "or the watermark's picture, is refused, 403, when its asset's rights would refuse a download of it.")
public class RightsCheckedAddWatermarkToVideo {

    /** The file of the watermark document the platform reads, whatever the input. */
    static final String WATERMARK_XPATH = "file:content";

    /** The caller's session, from which a stored blob's holders are looked for. */
    @Context
    protected CoreSession session;

    @Param(name = "watermark")
    protected DocumentModel watermark;

    @Param(name = "x", required = false, values = { "0" })
    protected String x;

    @Param(name = "y", required = false, values = { "0" })
    protected String y;

    @Param(name = "xpath", required = false)
    protected String xpath;

    @OperationMethod
    public Blob run(DocumentModel input) throws OperationException {
        VideoOperationRights.check(AddWatermarkToVideo.ID, session, watermark, WATERMARK_XPATH);
        VideoOperationRights.check(AddWatermarkToVideo.ID, session, input, xpath);
        return platform().run(input);
    }

    @OperationMethod
    public BlobList run(DocumentModelList input) throws OperationException {
        VideoOperationRights.check(AddWatermarkToVideo.ID, session, watermark, WATERMARK_XPATH);
        // The platform reads each document's file:content when no xpath is given, not its blob holder.
        String path = xpath == null || xpath.isEmpty() ? "file:content" : xpath;
        for (DocumentModel document : input) {
            VideoOperationRights.check(AddWatermarkToVideo.ID, session, document, path);
        }
        return platform().run(input);
    }

    @OperationMethod(collector = BlobCollector.class)
    public Blob run(Blob input) throws OperationException {
        VideoOperationRights.check(AddWatermarkToVideo.ID, session, watermark, WATERMARK_XPATH);
        VideoOperationRights.checkStored(AddWatermarkToVideo.ID, session, input);
        return platform().run(input);
    }

    /** The platform's operation, given these parameters. */
    private AddWatermarkToVideo platform() {
        DocumentModel mark = watermark;
        String left = x;
        String top = y;
        String path = xpath;
        return new AddWatermarkToVideo() {
            {
                this.watermark = mark;
                this.x = left;
                this.y = top;
                this.xpath = path;
            }
        };
    }
}
