package org.nuxeo.agentic.connectors;

import org.nuxeo.ecm.core.work.AbstractWork;
import org.nuxeo.runtime.api.Framework;

/**
 * One attempt of one delivery, in the work manager's queue {@value #CATEGORY}: it holds the
 * delivery's id and nothing else, so that what the work manager keeps or serializes holds no
 * payload, no address and no secret. {@link WebhookService#deliver} claims the delivery before it
 * sends anything, so a work run twice sends once.
 *
 * <p>Its failures are the delivery's, recorded and retried by the add-on ({@link WebhookComponent}),
 * never the work manager's: the work itself does not fail, and the work manager never retries it.
 */
public class WebhookWork extends AbstractWork {

    private static final long serialVersionUID = 1L;

    static final String CATEGORY = "agenticWebhooks";

    protected final String delivery;

    WebhookWork(String delivery, int attempts) {
        super("agentic-webhook-" + delivery + "-" + attempts);
        this.delivery = delivery;
    }

    @Override
    public String getCategory() {
        return CATEGORY;
    }

    @Override
    public String getTitle() {
        return "Webhook delivery";
    }

    @Override
    public void work() {
        WebhookService webhooks = Framework.getService(WebhookService.class);
        if (webhooks != null) {
            webhooks.deliver(delivery);
        }
    }
}
