package org.nuxeo.agentic.connectors;

import java.util.HashSet;
import java.util.Set;

import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventBundle;
import org.nuxeo.ecm.core.event.PostCommitFilteringEventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.runtime.api.Framework;

/**
 * The document events webhooks send, taken once their transaction has committed: an asynchronous,
 * post-commit listener ({@code OSGI-INF/connectors-webhooks-service.xml}). A transaction that rolls
 * back gives it nothing, so nothing of it is ever sent.
 *
 * <ul>
 * <li>{@link #acceptEvent}, as the transaction commits: an event of one of the four
 * {@link Webhook.Trigger}s, on a document, not a version or a proxy, of a type a registered webhook
 * sends that trigger for. Every other event is left out of the bundle.</li>
 * <li>{@link #handleEvent}, in the background: one delivery per webhook, per document and per
 * trigger, however many times the transaction fired it ({@link WebhookComponent#enqueue}).</li>
 * </ul>
 */
public class WebhookListener implements PostCommitFilteringEventListener {

    @Override
    public boolean acceptEvent(Event event) {
        Webhook.Trigger trigger = Webhook.Trigger.ofEvent(event.getName());
        if (trigger == null || !(event.getContext() instanceof DocumentEventContext context)) {
            return false;
        }
        DocumentModel document = context.getSourceDocument();
        WebhookComponent webhooks = webhooks();
        return document != null && webhooks != null && !document.isVersion() && !document.isProxy()
                && document.getId() != null && webhooks.sends(trigger, document.getType());
    }

    @Override
    public void handleEvent(EventBundle events) {
        WebhookComponent webhooks = webhooks();
        if (webhooks == null) {
            return;
        }
        Set<String> seen = new HashSet<>();
        for (Event event : events) {
            if (!acceptEvent(event)) {
                continue;
            }
            Webhook.Trigger trigger = Webhook.Trigger.ofEvent(event.getName());
            DocumentModel document = ((DocumentEventContext) event.getContext()).getSourceDocument();
            String repository = document.getRepositoryName() != null ? document.getRepositoryName()
                    : event.getContext().getRepositoryName();
            if (seen.add(trigger + " " + repository + " " + document.getId())) {
                webhooks.enqueue(trigger, repository, document.getId(), document.getType());
            }
        }
    }

    private static WebhookComponent webhooks() {
        return Framework.getService(WebhookService.class) instanceof WebhookComponent component ? component : null;
    }
}
