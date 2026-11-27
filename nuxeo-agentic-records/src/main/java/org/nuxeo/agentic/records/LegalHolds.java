package org.nuxeo.agentic.records;

import java.util.List;

import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.model.Property;

/**
 * What a legal hold keeps, beyond what the platform keeps itself.
 *
 * <p>
 * The platform's hold, {@code CoreSession.setLegalHold}, keeps a held document as follows. Its
 * security policy takes {@code Remove} away from everyone on it, so a person's deletion and trash
 * are refused, 403, before any event. An administrator's trash is not: it is a property, and the
 * trash asks only whether an administrator may remove, which it does not refuse. The repository
 * refuses the removal itself of a held document, or of a folder holding one, an administrator's
 * included ("Cannot remove ..., it is under retention / hold"); and the removal of its main file.
 * It does not keep its attachments, nor its main file from being replaced outside a record-mode
 * blob provider, nor a folder holding one out of the trash, whose records it then fails to put in
 * the trash after it, one by one, in the background.
 *
 * <p>
 * So the add-on refuses, for everyone and with a 409 and a sentence a person can act on
 * ({@link HoldListener}): a held document's trash, and its removal, before the repository; a folder's
 * that holds one; and a change to its files. A held record's other properties stay editable, as the
 * platform keeps them: a hold keeps what the record holds, not how it is described.
 */
final class LegalHolds {

    /** The refusals' code, for a client and a test. */
    static final String HELD = "held";

    static final String RECORD_HELD = "This record is under a legal hold: it cannot be put in the trash or deleted "
            + "until the hold is released.";

    static final String FOLDER_HELD = "A record in this folder is under a legal hold: the folder cannot be put in "
            + "the trash or deleted until the hold is released.";

    static final String FILES_HELD = "This record is under a legal hold: its files cannot be changed until the hold "
            + "is released.";

    /** A record's files, by the schema that holds each: the main file, and the attachments. */
    private static final List<String[]> FILES = List.of(new String[] { "file", "file:content" },
            new String[] { "files", "files:files" });

    private LegalHolds() {
    }

    /** Whether the repository holds {@code doc} under a legal hold, as it stores it now. */
    static boolean held(CoreSession session, DocumentModel doc) {
        return CoreInstance.doPrivileged(session, (CoreSession privileged) -> privileged.exists(doc.getRef())
                && privileged.hasLegalHold(doc.getRef()));
    }

    /**
     * Whether a document below {@code folder}, at any depth, is under a legal hold: read with the
     * add-on's session, since a removal or a trash takes the whole tree, what its user may not read
     * included. A folder whose id is not one is taken as holding one.
     */
    static boolean holdsHeld(CoreSession session, DocumentModel folder) {
        String id = folder.getId();
        if (id == null || !DueRecords.ID.matcher(id).matches()) {
            return true;
        }
        return CoreInstance.doPrivileged(session, (CoreSession privileged) -> !privileged.queryProjection(
                "SELECT ecm:uuid FROM Document WHERE ecm:ancestorId = '" + id
                        + "' AND ecm:hasLegalHold = 1 AND ecm:isProxy = 0",
                1, 0).isEmpty());
    }

    /** Whether a change to {@code doc} writes one of its files: its main file or its attachments. */
    static boolean filesChange(DocumentModel doc) {
        for (String[] file : FILES) {
            if (doc.hasSchema(file[0])) {
                Property property = doc.getProperty(file[1]);
                if (property != null && property.isDirty()) {
                    return true;
                }
            }
        }
        return false;
    }

    static DispositionRefusal refusal(String message) {
        return new DispositionRefusal(409, HELD, message);
    }
}
