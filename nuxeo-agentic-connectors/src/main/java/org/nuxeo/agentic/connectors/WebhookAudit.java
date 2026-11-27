package org.nuxeo.agentic.connectors;

import java.io.Serializable;
import java.lang.reflect.InvocationTargetException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.SystemPrincipal;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.impl.UnboundEventContext;
import org.nuxeo.ecm.platform.audit.api.AuditLogger;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Where each delivery's outcome is recorded: the platform's audit, in the category {@value #CATEGORY}.
 *
 * <ul>
 * <li>{@value #DELIVERED}: an attempt the receiver answered {@code 2xx};</li>
 * <li>{@value #RETRYING}: an attempt that failed, and will be made again;</li>
 * <li>{@value #DEAD_LETTERED}: a delivery given up on;</li>
 * <li>{@value #RESENT}: a dead letter an administrator sent again.</li>
 * </ul>
 *
 * The comment names the webhook, the delivery, the event, the document's id and type, the attempt,
 * the outcome and the receiver's status, and for a resend, the administrator: <b>never</b> the
 * secret, the signature, the nonce, the address, or any field's value. A failure to write is
 * logged, and the delivery goes on: the audit is a record, not a gate.
 */
interface WebhookAudit {

    String CATEGORY = "agenticWebhooks";

    String DELIVERED = "webhookDelivered";

    String RETRYING = "webhookRetrying";

    String DEAD_LETTERED = "webhookDeadLettered";

    String RESENT = "webhookResent";

    void record(String event, String comment);

    /**
     * The comment of an entry about this delivery, as it is now: {@code reason}, when there is one,
     * is the kind of address refused, the setting missing or the class of the failure, never a value.
     */
    static String comment(WebhookDelivery delivery, String by, String reason) {
        StringBuilder comment = new StringBuilder();
        comment.append("webhook=").append(delivery.webhook());
        comment.append(" delivery=").append(delivery.id());
        comment.append(" event=").append(delivery.event());
        comment.append(" document=").append(delivery.document());
        comment.append(" type=").append(delivery.type());
        comment.append(" attempt=").append(delivery.attempts());
        if (delivery.outcome() != null) {
            comment.append(" outcome=").append(delivery.outcome());
        }
        if (delivery.status() > 0) {
            comment.append(" status=").append(delivery.status());
        }
        if (reason != null) {
            comment.append(" reason=").append(reason);
        }
        if (by != null) {
            comment.append(" by=").append(by);
        }
        return comment.toString();
    }

    /**
     * The platform's audit, reached as {@code nuxeo-agentic-embedded}'s {@code PlatformExchangeAudit}
     * reaches it: LTS 2025's {@code org.nuxeo.audit.service.AuditService} and its {@code default}
     * store when the server has it, else the platform's {@code AuditLogger}. Each entry is built by
     * the audit from an event of its own, with the system as its principal, as the audit builds its
     * own entries, and added at once, in the caller's transaction or one of its own.
     */
    final class Platform implements WebhookAudit {

        private static final Logger log = LogManager.getLogger(WebhookAudit.class);

        static final String AUDIT_SERVICE = "org.nuxeo.audit.service.AuditService";

        @Override
        public void record(String event, String comment) {
            try {
                TransactionHelper.runInTransaction(() -> write(event, comment));
            } catch (RuntimeException e) {
                failed(event, comment, e);
            }
        }

        /** Caught here, so that the caller's transaction, a delivery's, is not marked for rollback. */
        private static void write(String event, String comment) {
            try {
                Map<String, Serializable> properties = new HashMap<>();
                properties.put("category", CATEGORY);
                properties.put("comment", comment);
                Event entryEvent = new UnboundEventContext(new SystemPrincipal(null), properties).newEvent(event);
                AuditLogger logger = logger();
                LogEntry entry = logger.buildEntryFromEvent(entryEvent);
                if (entry != null) {
                    logger.addLogEntries(List.of(entry));
                }
            } catch (RuntimeException e) {
                failed(event, comment, e);
            }
        }

        private static void failed(String event, String comment, RuntimeException e) {
            // The cause's class only; the comment holds nothing that is not already in the server's log.
            log.error("Webhooks: the audit entry {} could not be written ({}): {}", event,
                    e.getClass().getSimpleName(), comment);
        }

        static AuditLogger logger() {
            Class<?> service;
            try {
                service = Class.forName(AUDIT_SERVICE, true, WebhookAudit.class.getClassLoader());
            } catch (ClassNotFoundException e) {
                return required(Framework.getService(AuditLogger.class));
            }
            Object instance = Framework.getService(service);
            if (instance == null) {
                return required(Framework.getService(AuditLogger.class));
            }
            try {
                return required((AuditLogger) service.getMethod("getAuditBackend", String.class)
                                                      .invoke(instance, "default"));
            } catch (InvocationTargetException e) {
                throw new IllegalStateException("The audit could not be reached", e.getCause());
            } catch (ReflectiveOperationException | ClassCastException e) {
                throw new IllegalStateException("The audit service has no default store", e);
            }
        }

        private static AuditLogger required(AuditLogger logger) {
            if (logger == null) {
                throw new IllegalStateException("The server has no audit");
            }
            return logger;
        }
    }
}
