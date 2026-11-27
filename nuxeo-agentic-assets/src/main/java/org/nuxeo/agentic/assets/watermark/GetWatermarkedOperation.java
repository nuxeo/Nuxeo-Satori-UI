/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.lang.reflect.Method;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.automation.OperationContext;
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
 * server has refused it unmarked. Not a button: it reads, and changes nothing the person can see.
 *
 * <p>Since 0.6.0, a long video is marked in the background: until its copy is ready the operation
 * answers 202, with a short JSON, {@code {"status": "preparing", "retryAfter": <seconds>}}, and the
 * same request, asked again, is how the page learns it is ready. Automation lets an operation set its
 * answer's status, through the REST API's operation context, but not its headers, so there is no
 * {@code Location}: the operation is its own status.
 */
@Operation(id = GetWatermarkedOperation.ID, category = Constants.CAT_BLOB, label = "Get a watermarked file",
        description = "A use of an asset, marked as its rights policy's watermark requires, for the person signed in:"
                + " original, view:<title>, rendition:<name>, blob:<xpath> or storyboard:<n>. A long video is"
                + " marked in the background: until it is ready, 202 and {\"status\": \"preparing\"}; ask again.")
public class GetWatermarkedOperation {

    private static final Logger log = LogManager.getLogger(GetWatermarkedOperation.class);

    public static final String ID = "Asset.GetWatermarked";

    /** Accepted, and being prepared. */
    static final int ACCEPTED = 202;

    @Context
    protected CoreSession session;

    @Context
    protected OperationContext context;

    @Param(name = "use", required = true)
    protected String use;

    @OperationMethod
    public Blob run(DocumentModel document) {
        WatermarkedFiles.Answer answer = new WatermarkedFiles().answer(document, use, session.getPrincipal());
        if (answer.preparing()) {
            accepted(context);
        }
        return answer.file();
    }

    /**
     * The answer's status set to 202, where the context is the REST API's: its class, whose package
     * is not the same on 11.5 and on LTS 2025, has {@code setHttpStatus(int)}, read by the REST API
     * when it writes the answer. Any other context, as Automation run from Java, has no status.
     */
    static boolean accepted(OperationContext context) {
        if (context == null) {
            return false;
        }
        try {
            Method status = context.getClass().getMethod("setHttpStatus", int.class);
            status.invoke(context, ACCEPTED);
            return true;
        } catch (NoSuchMethodException e) {
            return false;
        } catch (ReflectiveOperationException | RuntimeException e) {
            log.warn("Asset rights: the answer's status could not be set to 202; its body says it is being prepared", e);
            return false;
        }
    }
}
