package org.nuxeo.agentic.embedded;

import java.io.Serializable;
import java.lang.reflect.InvocationTargetException;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.SystemPrincipal;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.impl.UnboundEventContext;
import org.nuxeo.ecm.platform.audit.api.AuditLogger;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.ecm.platform.usermanager.UserManager;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Writes the exchange's entries to the platform's audit: an event per exchange, which the audit
 * builds its entry from as it builds its own ({@code buildEntryFromEvent}), with the event's
 * {@code category} and {@code comment}, and adds at once, in a transaction of its own.
 *
 * <p>
 * Where the audit is, as {@code nuxeo-agentic-records}' {@code AuditAccess} reaches it: LTS 2025's
 * {@code org.nuxeo.audit.service.AuditService} and its {@code default} store when the server has it,
 * else the platform's {@code AuditLogger}. An entry issued names the user as its principal; one
 * refused, the system, since a refusal may be for no user. The comment holds the host, the scope,
 * the token's id and end, the host's subject for an issued token, and a fixed reason for a refused
 * one; never a token, an assertion or a secret. A failure to write is logged, and the exchange's
 * answer does not change: the audit is a record, not a gate.
 */
public final class PlatformExchangeAudit implements ExchangeAudit {

    private static final Logger log = LogManager.getLogger(PlatformExchangeAudit.class);

    static final String AUDIT_SERVICE = "org.nuxeo.audit.service.AuditService";

    @Override
    public void issued(String host, String username, String subject, String scope, String tokenId,
            Instant expiresAt) {
        write(ISSUED, username, "host=" + host + " subject=" + subject + " scope=" + scope.replace(' ', '+')
                + " token=" + tokenId + " expires=" + expiresAt);
    }

    @Override
    public void refused(String host, String reason) {
        write(REFUSED, null, "host=" + host + " reason=" + reason);
    }

    private void write(String eventName, String username, String comment) {
        try {
            TransactionHelper.runInTransaction(() -> {
                NuxeoPrincipal principal = principal(username);
                Map<String, Serializable> properties = new HashMap<>();
                properties.put("category", CATEGORY);
                properties.put("comment", comment);
                Event event = new UnboundEventContext(principal, properties).newEvent(eventName);
                AuditLogger logger = logger();
                @SuppressWarnings("unchecked")
                LogEntry entry = logger.buildEntryFromEvent(event);
                if (entry != null) {
                    logger.addLogEntries(List.of(entry));
                }
            });
        } catch (RuntimeException e) {
            log.error("Embedded panels: the audit entry {} ({}) could not be written", eventName, comment, e);
        }
    }

    private static NuxeoPrincipal principal(String username) {
        if (username != null) {
            UserManager users = Framework.getService(UserManager.class);
            NuxeoPrincipal principal = users == null ? null : users.getPrincipal(username);
            if (principal != null) {
                return principal;
            }
        }
        return new SystemPrincipal(null);
    }

    static AuditLogger logger() {
        Class<?> service;
        try {
            service = Class.forName(AUDIT_SERVICE, true, PlatformExchangeAudit.class.getClassLoader());
        } catch (ClassNotFoundException e) {
            return required(Framework.getService(AuditLogger.class));
        }
        Object instance = Framework.getService(service);
        if (instance == null) {
            return required(Framework.getService(AuditLogger.class));
        }
        try {
            return required((AuditLogger) service.getMethod("getAuditBackend", String.class).invoke(instance,
                    "default"));
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
