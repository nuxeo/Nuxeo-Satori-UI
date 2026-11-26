/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.RecoverableClientException;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * A refusal the user is told of: the event service logs a {@code RecoverableClientException} at
 * {@code INFO}, where it logs any other a synchronous listener throws at {@code ERROR}, with its
 * stack, so a user who may create or write could otherwise fill the server's log. The status, 400,
 * 403 or 409, is the one the REST API answers with. An unforeseen failure stays a plain
 * {@link NuxeoException}, logged as the error it is.
 */
final class Refusal extends RecoverableClientException {

    private static final long serialVersionUID = 1L;

    Refusal(String message, int status) {
        super(message, message, null);
        this.statusCode = status;
    }

    static NuxeoException invalid(String message) {
        return new Refusal(message, 400);
    }

    static NuxeoException forbidden(String message) {
        return new Refusal(message, 403);
    }

    static NuxeoException conflict(String message) {
        return new Refusal(message, 409);
    }

    /**
     * Mark the transaction for rollback, and have the event service throw the refusal on to the
     * caller rather than log it: the platform swallows a synchronous listener's exception
     * otherwise. Logged at {@code INFO}, with the event, the document, its type, the user and the
     * reason.
     */
    static NuxeoException refuse(Logger log, String what, Event event, DocumentEventContext context, DocumentModel doc,
            NuxeoException refusal) {
        TransactionHelper.setTransactionRollbackOnly();
        event.markBubbleException();
        log.info("{}: {} of {} ({}) by {} refused: {}", what, event.getName(), doc.getId(), doc.getType(),
                actingUser(context.getPrincipal(), "?"), refusal.getMessage());
        return refusal;
    }

    /**
     * Who is acting: the user, or, for a privileged session that server code opened on a user's
     * behalf, as Nuxeo's comment manager does, the user it acts for. {@code otherwise} when no
     * one can be named.
     */
    static String actingUser(NuxeoPrincipal principal, String otherwise) {
        if (principal == null) {
            return otherwise;
        }
        String acting = principal.getActingUser();
        return acting == null || acting.isBlank() ? otherwise : acting;
    }

    /**
     * Whether an administrator is acting: one signed in, or server code of its own. Not a
     * privileged session opened on a user's behalf, which the platform makes an administrator's,
     * as Nuxeo's comment manager opens one to delete a comment for its author.
     */
    static boolean isAdministrator(NuxeoPrincipal principal) {
        if (principal == null || !principal.isAdministrator()) {
            return false;
        }
        String originating = principal.getOriginatingUser();
        return originating == null || originating.isBlank() || originating.equals(principal.getName());
    }
}
