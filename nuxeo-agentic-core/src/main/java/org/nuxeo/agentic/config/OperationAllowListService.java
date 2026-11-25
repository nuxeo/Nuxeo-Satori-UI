package org.nuxeo.agentic.config;

import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * The operations an app's buttons may run on this server, and the one way they are run.
 *
 * The allow-list is the deployment's: contributed to {@code org.nuxeo.agentic.ui.operations}'s
 * {@code allowList} point by a contribution the server's administrators install, such as a file in
 * {@code nxserver/config/}. An app's configuration, its {@code actions.json}, can name only what is
 * on it: the app registry leaves any other action out, and {@link #runAction} refuses it.
 */
public interface OperationAllowListService {

    /** The allow-list in force. Never {@code null}: {@link AllowList#EMPTY} when nothing is allowed. */
    AllowList getAllowList();

    /**
     * Runs one action of an app, as {@code AgenticUi.RunAction} is asked to, and answers what it did.
     *
     * @param session the reader's session: every check, and the operation, run as them
     * @param input the record, as the request named it; it is read again from the repository
     * @param app the app's id
     * @param action the action's id in the app's {@code actions.json}
     * @param values what the person entered in the action's form, as a JSON object, or {@code null}
     */
    AppActionRunner.Result runAction(CoreSession session, DocumentModel input, String app, String action, String values);
}
