package org.nuxeo.agentic.records;

import org.nuxeo.ecm.automation.core.annotations.Context;
import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.automation.core.annotations.Param;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * {@code Records.ReleaseLegalHold}: releases the input document's legal hold, saying why.
 *
 * <pre>
 * POST /nuxeo/api/v1/automation/Records.ReleaseLegalHold
 * { "input": "&lt;document id&gt;", "params": { "reason": "The dispute is settled." } }
 * </pre>
 *
 * <p>
 * <b>Why it exists.</b> Placing a hold is the retention module's: {@code Document.Hold} takes a
 * {@code description}, which the platform keeps as the comment of its {@code afterSetLegalHold}
 * audit entry. The module's {@code Document.Unhold} takes nothing, and releases the hold with no
 * comment, so a release would carry no reason in the platform's {@code afterRemoveLegalHold} entry,
 * which the add-on's audit export reads as the hold's description, and the record page's holds card
 * shows. This operation releases it the same way, through {@code CoreSession.setLegalHold}, with the
 * reason as that comment, and nothing else.
 *
 * <p>
 * <b>As the person, never as the add-on.</b> It runs with the session Automation gives it, so the
 * platform checks the person's {@code ManageLegalHold} on the record, and refuses with a 403
 * otherwise. Refused, with nothing written: a reason that is empty or white space alone, longer than
 * {@value #MAX_REASON} characters or holding a control character other than a tab or a line break,
 * 400; a record that is under no legal hold, 409. It is meant for an operation button, decision 3's,
 * which the deployment's allow-list names, never a package.
 */
@Operation(id = ReleaseLegalHoldOperation.ID, category = "Retention", label = "Release legal hold, with a reason",
        description = "Removes the legal hold on the input document, with the reason given as the comment the "
                + "platform audits it with (afterRemoveLegalHold). Needs ManageLegalHold on the document. Refuses an "
                + "empty reason, and a document under no legal hold. Returns the document.")
public class ReleaseLegalHoldOperation {

    public static final String ID = "Records.ReleaseLegalHold";

    /** The longest reason taken, as an operation button's allow-list takes 1000 characters by default. */
    static final int MAX_REASON = 1000;

    @Context
    protected CoreSession session;

    @Param(name = "reason", description = "Why the hold is released, kept in the audit as the release's comment")
    protected String reason;

    @OperationMethod
    public DocumentModel run(DocumentModel doc) {
        return release(session, doc, reason);
    }

    /** The release itself, with {@code session}'s permissions. */
    static DocumentModel release(CoreSession session, DocumentModel doc, String reason) {
        String why = checked(reason);
        if (!session.hasLegalHold(doc.getRef())) {
            throw new DispositionRefusal(409, "not-held", "This record is under no legal hold.");
        }
        session.setLegalHold(doc.getRef(), false, why);
        return session.getDocument(doc.getRef());
    }

    /** The reason as kept: stripped, and refused when empty, too long or holding a control character. */
    static String checked(String reason) {
        String why = reason == null ? "" : reason.strip();
        if (why.isEmpty()) {
            throw new DispositionRefusal(400, "reason", "Say why the hold is released.");
        }
        if (why.length() > MAX_REASON) {
            throw new DispositionRefusal(400, "reason",
                    "A reason is at most " + MAX_REASON + " characters.");
        }
        for (int index = 0; index < why.length(); index++) {
            char c = why.charAt(index);
            if (Character.isISOControl(c) && c != '\t' && c != '\n' && c != '\r') {
                throw new DispositionRefusal(400, "reason",
                        "A reason holds no control character but a tab or a line break.");
            }
        }
        return why;
    }
}
