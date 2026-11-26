/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;

/**
 * What the download permission's script calls: may this person have this file, or this rendition,
 * of a marked revision?
 *
 * <p>The platform's {@code DownloadService} evaluates every contributed permission's {@code run()}
 * with the globals {@code Document}, {@code XPath}, {@code Blob}, {@code Reason}, {@code Infos},
 * {@code Rendition} and {@code CurrentUser}, and refuses the download, 403, when one returns
 * {@code false}; it reads a script that throws, or answers anything but a boolean, as not refused.
 * So the script only calls {@link #allows}, inside a {@code try} that answers {@code false}, and this
 * method never throws: every failure refuses, as the assets add-on's permission does.
 *
 * <p>A download with no document, which is how the platform hands over a blob it does not tie to
 * one, is not this add-on's to refuse.
 */
public final class ExportMarkDownloadPermission {

    private static final Logger log = LogManager.getLogger(ExportMarkDownloadPermission.class);

    private ExportMarkDownloadPermission() {
    }

    /**
     * @param document the {@code Document} global: a {@link DocumentModel}, or {@code null}
     * @param rendition the {@code Rendition} global: the rendition's name, or {@code null} for a file
     * @param reason the {@code Reason} global, such as {@code download} or {@code rendition}: logged
     * @param currentUser the {@code CurrentUser} global: the person signed in
     * @return whether this permission lets the download through
     */
    public static boolean allows(Object document, Object rendition, Object reason, Object currentUser) {
        try {
            if (document == null) {
                return true;
            }
            if (!(document instanceof DocumentModel doc)) {
                log.error("Controlled documents: a download's document is a {}, so it is refused", document.getClass());
                return false;
            }
            NuxeoPrincipal person = currentUser instanceof NuxeoPrincipal p ? p : NuxeoPrincipal.getCurrent();
            String name = rendition == null ? null : rendition.toString();
            ExportMarks.Decision decided = ExportMarks.decide(doc, name, person);
            if (decided.allowed()) {
                return true;
            }
            log.info("Controlled documents: refused the {} of {} ({}) to {}, through {}: {}",
                    name == null ? "file" : "rendition " + name, id(doc), doc.getType(),
                    person == null ? "?" : Refusal.actingUser(person, person.getName()), reason, decided.reason().code);
            return false;
        } catch (RuntimeException | Error e) {
            if (e instanceof VirtualMachineError fatal) {
                throw fatal;
            }
            log.error("Controlled documents: a download could not be decided against its export-control mark, so "
                    + "it is refused", e);
            return false;
        }
    }

    private static String id(DocumentModel doc) {
        try {
            return doc.getId();
        } catch (RuntimeException e) {
            return "?";
        }
    }
}
