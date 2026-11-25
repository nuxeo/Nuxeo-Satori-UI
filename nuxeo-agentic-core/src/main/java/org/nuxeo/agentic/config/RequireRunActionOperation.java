package org.nuxeo.agentic.config;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.config.AppActionException.Kind;
import org.nuxeo.ecm.automation.OperationContext;
import org.nuxeo.ecm.automation.core.annotations.Context;
import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.automation.core.annotations.Param;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * {@code AgenticUi.RequireRunAction}: the first step of a chain meant for an app's button, which
 * refuses to let the chain go on unless {@code AgenticUi.RunAction} is running it, as the operation
 * it names, on this thread.
 *
 * <pre>
 * &lt;chain id="Payers.RequestMedicalRecords"&gt;
 *   &lt;operation id="AgenticUi.RequireRunAction"&gt;
 *     &lt;param type="string" name="operation"&gt;Payers.RequestMedicalRecords&lt;/param&gt;
 *   &lt;/operation&gt;
 *   ...
 * &lt;/chain&gt;
 * </pre>
 *
 * The allow-list decides what a button may run; it does not stop Nuxeo's own Automation endpoint,
 * {@code /nuxeo/api/v1/automation/}, which runs any chain a user may run, directly or through a
 * dispatcher such as {@code RunOperation}, past any REST binding the chain has. This closes that
 * way for the chain that begins with it, for everyone, administrators included: only
 * {@link AppActionRunner} marks a run, server-side, where nothing a request carries can set it.
 * It passes the input through unchanged.
 */
@Operation(id = RequireRunActionOperation.ID, category = "Agentic UI", label = "Require an app's button",
        description = "Lets the chain it begins go on only when AgenticUi.RunAction runs it, as the operation named by "
                + "the 'operation' parameter, for an app's button. Refuses every other way of running it. Passes its "
                + "input through.")
public class RequireRunActionOperation {

    public static final String ID = "AgenticUi.RequireRunAction";

    private static final Logger log = LogManager.getLogger(RequireRunActionOperation.class);

    @Context
    protected OperationContext context;

    @Param(name = "operation", description = "The id of the chain this begins, as the allow-list names it")
    protected String operation;

    @OperationMethod
    public DocumentModel run(DocumentModel document) {
        check();
        return document;
    }

    @OperationMethod
    public void run() {
        check();
    }

    void check() {
        if (!AppActionRunner.running(operation)) {
            log.warn("Agentic UI: {} was run other than through an app's button, by {}; refused",
                    AppActionRunner.loggable(operation),
                    context == null || context.getPrincipal() == null ? "(no one)"
                            : AppActionRunner.loggable(context.getPrincipal().getName()));
            throw new AppActionException(Kind.NOT_THROUGH_A_BUTTON);
        }
    }
}
