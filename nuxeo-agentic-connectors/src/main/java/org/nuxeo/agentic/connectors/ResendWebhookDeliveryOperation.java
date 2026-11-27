package org.nuxeo.agentic.connectors;

import org.nuxeo.ecm.automation.core.annotations.Context;
import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.automation.core.annotations.Param;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreSession;

import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * {@code Webhook.Resend}: a dead letter sent again, for an administrator.
 *
 * <pre>
 * POST /nuxeo/api/v1/automation/Webhook.Resend
 * { "params": { "delivery": "&lt;32 hexadecimal digits&gt;" } }
 * </pre>
 *
 * The delivery is sent again from its first attempt, its id and payload as they were, signed afresh,
 * to the address the server sets for its webhook now. 404 for an id that is not a dead letter's,
 * 409 for one whose payload was never kept or that is already being sent again.
 * <b>Administrators only:</b> anyone else is refused with 403, and nothing is sent
 * ({@link WebhookService#resend}).
 */
@Operation(id = ResendWebhookDeliveryOperation.ID, category = "Connectors", label = "Resend a webhook delivery",
        description = "Administrators only. Sends an outbound webhook's dead letter again, from its first attempt.")
public class ResendWebhookDeliveryOperation {

    public static final String ID = "Webhook.Resend";

    @Context
    protected CoreSession session;

    @Context
    protected WebhookService webhooks;

    @Param(name = "delivery", description = "The dead letter's delivery id: 32 hexadecimal digits")
    protected String delivery;

    @OperationMethod
    public Blob run() {
        ObjectNode answer = WebhookDelivery.JSON.createObjectNode();
        answer.set("delivery", webhooks.resend(session.getPrincipal(), delivery));
        return Blobs.createJSONBlob(answer.toString());
    }
}
