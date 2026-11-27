/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.io.IOException;
import java.io.Serializable;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.nuxeo.ecm.automation.AutomationService;
import org.nuxeo.ecm.automation.OperationContext;
import org.nuxeo.ecm.automation.OperationException;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.impl.blob.ByteArrayBlob;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.io.download.DownloadService;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.api.login.LoginComponent;

/**
 * What the two video watermark tests share: an {@code AcmeVideo} whose original is the brand assets
 * kit's own generated test pattern, {@code demo/videos/ast-511.webm}, read where the kit keeps it,
 * under a policy whose watermark marks every download of the original
 * ({@code test-watermark-policy-contrib.xml}); a download asked of the platform's download service as
 * a person; and {@code Asset.GetWatermarked} run through Automation.
 */
final class VideoWatermarks {

    static final Path KIT_VIDEO = Path.of("..", "business-apps", "packages", "brand-assets-demo", "demo", "videos",
            "ast-511.webm");

    private VideoWatermarks() {
    }

    static Blob kitVideo() {
        try {
            Blob video = new ByteArrayBlob(Files.readAllBytes(KIT_VIDEO), "video/webm");
            video.setFilename("ast-511.webm");
            return video;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static DocumentModel video(CoreSession session) {
        DocumentModel folder = session.createDocument(session.createDocumentModel("/", "videos", "Folder"));
        ACP acp = folder.getACP();
        ACL local = acp.getOrCreateACL();
        local.add(new ACE("members", "Read", true));
        session.setACP(folder.getRef(), acp, true);
        DocumentModel video = session.createDocumentModel("/videos", "ast-511", "AcmeVideo");
        video.setPropertyValue("dc:title", "Trailhead Rain Jacket, a walk");
        video.setPropertyValue("acmeasset:channels", (Serializable) List.of("Print", "E-commerce"));
        video.setPropertyValue("file:content", (Serializable) kitVideo());
        video = session.createDocument(video);
        session.save();
        return video;
    }

    static boolean downloads(CoreSession session, String id, NuxeoPrincipal person) {
        DocumentModel doc = session.getDocument(new IdRef(id));
        Blob blob = (Blob) doc.getPropertyValue("file:content");
        LoginComponent.pushPrincipal(person);
        try {
            return Framework.getService(DownloadService.class).checkPermission(doc, "file:content", blob, "download",
                    Map.of());
        } finally {
            LoginComponent.popPrincipal();
        }
    }

    static Blob marked(String repository, String id, NuxeoPrincipal person) throws OperationException {
        CoreSession as = CoreInstance.getCoreSession(repository, person);
        try (OperationContext ctx = new OperationContext(as)) {
            ctx.setInput(as.getDocument(new IdRef(id)));
            Map<String, Object> params = new HashMap<>();
            params.put("use", "original");
            return (Blob) Framework.getService(AutomationService.class).run(ctx, GetWatermarkedOperation.ID, params);
        }
    }

    /** The refusal {@code Asset.GetWatermarked} answers, unwrapped from Automation's. */
    static NuxeoException refused(String repository, String id, NuxeoPrincipal person) {
        try {
            marked(repository, id, person);
        } catch (OperationException e) {
            for (Throwable cause = e; cause != null; cause = cause.getCause()) {
                if (cause instanceof NuxeoException refusal) {
                    return refusal;
                }
            }
            throw new AssertionError(e);
        } catch (NuxeoException e) {
            return e;
        }
        throw new AssertionError("served unmarked or marked, where it should be refused");
    }
}
