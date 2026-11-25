package org.nuxeo.agentic.config;

import org.nuxeo.ecm.automation.core.annotations.Context;
import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.automation.core.annotations.Param;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * {@code AgenticUi.RunAction}: runs one action of an app's {@code actions.json} on the input record,
 * the one way an app's operation button runs (docs/business-apps/app-definition-v2.md, section 5).
 *
 * <pre>
 * POST /nuxeo/api/v1/automation/AgenticUi.RunAction
 * { "input": "doc:&lt;id&gt;", "params": { "app": "payers-claims", "action": "payers.claim.requestRecords",
 *   "values": "{\"note\":\"...\"}" } }
 * </pre>
 *
 * The request names the app, the action and the record, and what the person entered in the action's
 * form, as a JSON object in a text. It never names the operation, nor its other parameters: those
 * are the app's, as the registry serves them, and the allow-list is checked again before anything
 * runs ({@link AppActionRunner}). The request's own Automation {@code context} is never handed on.
 * The answer is {@link AppActionRunner.Result#toJson}, as {@code application/json}.
 *
 * Reached through Nuxeo's REST API, so with its authentication, its transaction, and its CSRF filter
 * ({@code NuxeoCorsCsrfFilter}, on every path): a POST from another origin is refused unless the
 * server's CORS configuration allows that origin.
 */
@Operation(id = RunAppActionOperation.ID, category = "Agentic UI", label = "Run an app's action",
        description = "Runs one action of a business app's actions.json on the input document, as the app registry "
                + "serves it to the user: only an operation on this server's allow-list, with the parameters the "
                + "allow-list gives it, after checking the user's permission on the document. Returns JSON.")
public class RunAppActionOperation {

    public static final String ID = "AgenticUi.RunAction";

    @Context
    protected CoreSession session;

    @Context
    protected OperationAllowListService actions;

    @Param(name = "app", description = "The id of the app, as its app.json names it")
    protected String app;

    @Param(name = "action", description = "The id of the action in the app's actions.json")
    protected String action;

    @Param(name = "values", required = false,
            description = "What the user entered in the action's form: a JSON object of each var: field's name to its value")
    protected String values;

    @OperationMethod
    public Blob run(DocumentModel document) {
        return Blobs.createJSONBlob(actions.runAction(session, document, app, action, values).toJson());
    }
}
