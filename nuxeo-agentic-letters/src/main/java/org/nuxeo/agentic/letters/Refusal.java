/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.RecoverableClientException;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * A refusal the person is told of, with the status the REST API answers: 400, 403, 404 or 409. A
 * {@code RecoverableClientException}, which the event service logs at {@code INFO} rather than as an
 * error with its stack, as the other add-ons' refusals are, so a person who may write could not fill
 * the server's log. Its message names no value of a record.
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

    static NuxeoException notFound(String message) {
        return new Refusal(message, 404);
    }

    static NuxeoException conflict(String message) {
        return new Refusal(message, 409);
    }

    /**
     * Mark the transaction for rollback, and have the event service throw the refusal on to the
     * caller rather than swallow it. Logged at {@code INFO}: the event, the document, its type, the
     * user and the reason.
     */
    static NuxeoException refuse(Logger log, Event event, DocumentEventContext context, DocumentModel doc,
            NuxeoException refusal) {
        TransactionHelper.setTransactionRollbackOnly();
        event.markBubbleException();
        log.info("Letters: {} of {} ({}) by {} refused: {}", event.getName(), doc.getId(), doc.getType(),
                actingUser(context.getPrincipal(), "?"), refusal.getMessage());
        return refusal;
    }

    /** Who is acting, or {@code otherwise} when no one can be named. */
    static String actingUser(NuxeoPrincipal principal, String otherwise) {
        if (principal == null) {
            return otherwise;
        }
        String acting = principal.getActingUser();
        return acting == null || acting.isBlank() ? otherwise : acting;
    }

    /**
     * Whether an administrator is acting: one signed in, or server code of its own. Not a
     * privileged session opened on a person's behalf, which the platform makes an administrator's.
     */
    static boolean isAdministrator(NuxeoPrincipal principal) {
        if (principal == null || !principal.isAdministrator()) {
            return false;
        }
        String originating = principal.getOriginatingUser();
        return originating == null || originating.isBlank() || originating.equals(principal.getName());
    }
}
