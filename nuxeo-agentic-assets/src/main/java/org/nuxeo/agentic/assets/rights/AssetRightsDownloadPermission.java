/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.util.function.Supplier;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.rights.AssetRightsService.DownloadDecision;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.runtime.api.Framework;

/**
 * What the download permission's script calls: may this blob be downloaded?
 *
 * <p>{@code DownloadServiceImpl.checkPermission} evaluates every contributed permission's
 * {@code run()} with the globals {@code Document}, {@code XPath}, {@code Blob}, {@code Reason},
 * {@code Infos}, {@code Rendition} and {@code CurrentUser}, and refuses the download, with 403,
 * when one returns {@code false}. It reads a script that throws, or that returns anything but a
 * boolean, as "not refused". So the script does nothing but call {@link #allows}, inside a
 * {@code try} that answers {@code false}, and this method never throws: every failure is a
 * refusal, not a download let through.
 *
 * <p>A download with no document, which is how the platform hands over a blob it does not tie to
 * one, is not this add-on's to refuse; nor is a document of a type no policy covers.
 */
public final class AssetRightsDownloadPermission {

    private static final Logger log = LogManager.getLogger(AssetRightsDownloadPermission.class);

    /**
     * Where the service is found. Only a test of this package replaces it: the tests run the
     * contributed script with no Nuxeo runtime to look the service up in.
     */
    static volatile Supplier<AssetRightsService> service = () -> Framework.getService(AssetRightsService.class);

    private AssetRightsDownloadPermission() {
    }

    /**
     * @param document the {@code Document} global: a {@link DocumentModel}, or {@code null}
     * @param xpath the {@code XPath} global
     * @param blob the {@code Blob} global
     * @param reason the {@code Reason} global, such as {@code download} or {@code rendition}: logged
     *            only, since the use is read from the other three
     * @param rendition the {@code Rendition} global: the rendition's name, or {@code null}
     * @param infos the {@code Infos} global: not read
     * @return whether this permission lets the download through
     */
    public static boolean allows(Object document, Object xpath, Object blob, Object reason, Object rendition,
            Object infos) {
        try {
            if (document == null) {
                return true;
            }
            if (!(document instanceof DocumentModel model)) {
                log.error("Asset rights: a download's document is a {}, so it is refused", document.getClass());
                return false;
            }
            AssetRightsService rights = service.get();
            if (rights == null) {
                log.error("Asset rights: the service is not running, so a download of {} is refused",
                        AssetRightsComponent.id(model));
                return false;
            }
            DownloadDecision decided = rights.decideDownload(model, text(xpath),
                    blob instanceof Blob b ? b : null, text(rendition));
            if (decided == null || decided.decision().allowed()) {
                return true;
            }
            log.info("Asset rights: refused the {} of {} ({}) to {}, through {}: {}", decided.use(),
                    AssetRightsComponent.id(model), model.getType(), user(), reason, decided.decision().reason().code());
            return false;
        } catch (RuntimeException | Error e) {
            if (e instanceof VirtualMachineError fatal) {
                throw fatal;
            }
            log.error("Asset rights: a download could not be decided, so it is refused", e);
            return false;
        }
    }

    private static String text(Object value) {
        return value == null ? null : value.toString();
    }

    private static String user() {
        try {
            NuxeoPrincipal principal = NuxeoPrincipal.getCurrent();
            return principal == null ? "?" : principal.getName();
        } catch (RuntimeException e) {
            return "?";
        }
    }
}
