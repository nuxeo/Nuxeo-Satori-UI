package org.nuxeo.agentic.connectors;

import org.nuxeo.ecm.automation.core.annotations.Context;
import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.automation.core.annotations.Param;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreSession;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * {@code Webhook.Deliveries}: the most recent webhook deliveries, for an administrator.
 *
 * <pre>
 * POST /nuxeo/api/v1/automation/Webhook.Deliveries
 * { "params": { "state": "dead", "limit": 50 } }
 * </pre>
 *
 * {@code state} is {@code pending}, {@code delivered} or {@code dead}, or none for all; {@code limit}
 * is 1 to 200, 50 by default. Each delivery is its id, webhook, event, document id and type, state,
 * attempts, last outcome and status, and when: never its payload, so never a field's value.
 * <b>Administrators only:</b> anyone else is refused with 403, before anything is read
 * ({@link WebhookService#deliveries}).
 */
@Operation(id = ListWebhookDeliveriesOperation.ID, category = "Connectors", label = "List webhook deliveries",
        description = "Administrators only. Lists the most recent outbound webhook deliveries, newest first: pending,"
                + " delivered or dead letters, by the 'state' parameter, or all; never their payloads.")
public class ListWebhookDeliveriesOperation {

    public static final String ID = "Webhook.Deliveries";

    @Context
    protected CoreSession session;

    @Context
    protected WebhookService webhooks;

    @Param(name = "state", required = false, description = "pending, delivered or dead; none for all")
    protected String state;

    @Param(name = "limit", required = false, description = "1 to 200; 50 by default")
    protected int limit;

    @OperationMethod
    public Blob run() {
        ObjectNode answer = WebhookDelivery.JSON.createObjectNode();
        ArrayNode list = answer.putArray("deliveries");
        webhooks.deliveries(session.getPrincipal(), state, limit).forEach(list::add);
        return Blobs.createJSONBlob(answer.toString());
    }
}
