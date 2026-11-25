package org.nuxeo.agentic.config;

import org.nuxeo.ecm.core.api.NuxeoException;

/**
 * Why {@code AgenticUi.RunAction} ran nothing, with the HTTP status it fails with.
 *
 * Its message is one of the neutral sentences below, and nothing else: never a value the person
 * entered, nor a property of the record. The server's log says which app, action and operation,
 * and why.
 */
public class AppActionException extends NuxeoException {

    private static final long serialVersionUID = 1L;

    public enum Kind {
        /** The request names no record. */
        NO_RECORD(400, "An app's action runs on one record, and the request names none"),
        /**
         * No app the reader may see serves the action: the app is not there or not theirs, its
         * {@code actions.json} does not have it, the registry left it out, or it runs no operation.
         */
        UNKNOWN_ACTION(404, "No app of yours serves this action on this server"),
        /** It runs in bulk only, and this runs an action on one record. */
        NOT_ON_A_RECORD(400, "This action runs on a selection of records, not on one"),
        /** Its operation, or one of its parameters, is not on this server's allow-list now. */
        NOT_ALLOWED(403, "This server's allow-list does not let this action run"),
        /** The record is not of a type, or not in a lifecycle state, the allow-list names. */
        NOT_FOR_THIS_RECORD(403, "This server's allow-list does not let this action run on this record"),
        /**
         * A chain meant for an app's button, which begins with {@code AgenticUi.RequireRunAction}, was
         * run some other way: through Nuxeo's own Automation endpoint, or a dispatcher such as
         * {@code RunOperation}.
         */
        NOT_THROUGH_A_BUTTON(403, "This chain runs only from an app's button"),
        /** The allow-list names groups for its operation, and the reader is in none of them. */
        NOT_IN_GROUP(403, "This server lets only some groups run this action, and you are in none of them"),
        /** What the person entered is not a JSON object of values, or is too large. */
        UNREADABLE_VALUES(400, "The values entered for this action could not be read"),
        /** A value is entered for a field the action's form does not send. */
        UNKNOWN_VALUE(400, "A value is entered for a field this action does not send"),
        /** A parameter's value is not of the type the allow-list gives it. */
        INVALID_VALUE(400, "A value of this action is not one its operation may be given");

        final int status;

        final String message;

        Kind(int status, String message) {
            this.status = status;
            this.message = message;
        }
    }

    private final Kind kind;

    public AppActionException(Kind kind) {
        super(kind.message, kind.status);
        this.kind = kind;
    }

    public Kind getKind() {
        return kind;
    }
}
