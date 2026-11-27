package org.nuxeo.agentic.connectors;

import java.util.List;

import org.nuxeo.ecm.core.api.NuxeoPrincipal;

import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Outbound webhooks, as the server's configuration contributes them: a document event on a
 * document of a webhook's types is sent, signed, to the receiver the server names, once its
 * transaction has committed, in the background ({@link WebhookComponent}).
 *
 * The deliveries are an administrator's to see and to send again, and no one else's: each method
 * below that reads or acts on them refuses anyone else with a 403, before it reads anything.
 */
public interface WebhookService {

    /** The webhook with this id, or {@code null} when none is registered. */
    Webhook getWebhook(String id);

    /**
     * The most recent deliveries, newest first, at most {@code limit} (1 to 200), in one state or all:
     * {@code pending}, {@code delivered} or {@code dead}, or {@code null} for every one. Each as
     * {@link WebhookDelivery#listing}: never its payload. An administrator's only.
     */
    List<ObjectNode> deliveries(NuxeoPrincipal who, String state, int limit);

    /**
     * A dead letter sent again, from its first attempt: its id and payload as they were, its attempts
     * counted afresh. An administrator's only. 404 for a delivery that is not a dead letter, 409 for
     * one whose payload was never kept.
     */
    ObjectNode resend(NuxeoPrincipal who, String delivery);

    /**
     * One attempt of an in-flight delivery, as the work manager runs it: claimed first, so that no
     * attempt is made twice; nothing when it is not due, or already claimed.
     */
    void deliver(String delivery);

    /** Schedules every in-flight delivery that is due, and answers how many. */
    int retryDue();
}
