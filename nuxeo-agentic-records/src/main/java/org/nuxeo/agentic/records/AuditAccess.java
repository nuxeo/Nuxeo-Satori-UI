package org.nuxeo.agentic.records;

import java.io.Serializable;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Map;
import java.util.TreeMap;

import org.nuxeo.ecm.platform.audit.api.AuditLogger;
import org.nuxeo.ecm.platform.audit.api.AuditReader;
import org.nuxeo.ecm.platform.audit.api.ExtendedInfo;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.runtime.api.Framework;

/**
 * The platform's audit, as the add-on reaches it on the LTS 2025 server it targets and on the 11.5
 * platform its tests run on. Both have the names the add-on is compiled against,
 * {@code org.nuxeo.ecm.platform.audit.api}, and they differ in two places, which this class alone
 * knows:
 * <ul>
 * <li><b>Where the audit is.</b> On LTS 2025, {@code Framework.getService(AuditLogger.class)} still
 * answers, and logs a deprecation warning each time; its audit service,
 * {@code org.nuxeo.audit.service.AuditService}, names the same store, {@code default}, and is asked
 * first. On 11.5 there is no such service, and the platform's own lookup is the audit.</li>
 * <li><b>An entry's extended information.</b> On LTS 2025 an entry is immutable, its
 * {@code getExtendedInfos()} refuses, and {@code getExtended()}, which the 2025 interface declares and
 * the 11.5 one the add-on is compiled against does not, holds its values: so it is called by
 * reflection. On 11.5, {@code getExtendedInfos()} holds them.</li>
 * </ul>
 * Everything else the add-on calls, {@code buildEntryFromEvent}, {@code addLogEntries} and
 * {@code queryLogs}, has the same name and erasure on both.
 */
final class AuditAccess {

    /** LTS 2025's audit service. */
    static final String AUDIT_SERVICE = "org.nuxeo.audit.service.AuditService";

    /** The store every entry of the platform's goes to. */
    static final String DEFAULT_BACKEND = "default";

    private AuditAccess() {
    }

    static AuditLogger logger() {
        return (AuditLogger) backend(AUDIT_SERVICE, AuditLogger.class);
    }

    static AuditReader reader() {
        return (AuditReader) backend(AUDIT_SERVICE, AuditReader.class);
    }

    /**
     * The audit's store: through {@code serviceName}'s {@code getAuditBackend("default")} when the
     * server has that service, else the platform's lookup of {@code legacy}.
     */
    static Object backend(String serviceName, Class<?> legacy) {
        Class<?> service;
        try {
            service = Class.forName(serviceName, true, AuditAccess.class.getClassLoader());
        } catch (ClassNotFoundException e) {
            return required(Framework.getService(legacy), legacy.getSimpleName());
        }
        Object instance = required(Framework.getService(service), service.getSimpleName());
        try {
            return required(service.getMethod("getAuditBackend", String.class).invoke(instance, DEFAULT_BACKEND),
                    "the audit's " + DEFAULT_BACKEND + " store");
        } catch (InvocationTargetException e) {
            throw new IllegalStateException("The audit could not be reached", e.getCause());
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("The audit service has no getAuditBackend(String)", e);
        }
    }

    private static Object required(Object found, String what) {
        if (found == null) {
            throw new IllegalStateException("The server has no " + what + ": is the platform's audit installed?");
        }
        return found;
    }

    /** An entry's extended information, by key, in their order: its values, as the audit gives them. */
    static Map<String, Object> extended(LogEntry entry) {
        Map<String, Object> values = new TreeMap<>();
        Method getExtended = method(entry.getClass(), "getExtended");
        if (getExtended != null) {
            try {
                if (getExtended.invoke(entry) instanceof Map<?, ?> map) {
                    map.forEach((key, value) -> {
                        if (key != null && value != null) {
                            values.put(String.valueOf(key), value);
                        }
                    });
                }
                return values;
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException("An audit entry's extended information could not be read", e);
            }
        }
        Map<String, ExtendedInfo> infos = entry.getExtendedInfos();
        if (infos != null) {
            infos.forEach((key, info) -> {
                Serializable value = info == null ? null : info.getSerializableValue();
                if (key != null && value != null) {
                    values.put(key, value);
                }
            });
        }
        return values;
    }

    private static Method method(Class<?> type, String name) {
        try {
            Method method = type.getMethod(name);
            return Map.class.isAssignableFrom(method.getReturnType()) ? method : null;
        } catch (NoSuchMethodException e) {
            return null;
        }
    }
}
