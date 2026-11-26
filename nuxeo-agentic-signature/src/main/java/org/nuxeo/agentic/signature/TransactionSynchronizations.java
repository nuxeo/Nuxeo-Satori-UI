/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.List;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Something to run when the current transaction ends without committing: a claim released, an
 * envelope whose request was never saved voided at its provider.
 *
 * <p>{@code TransactionHelper.registerSynchronization} takes a {@code javax.transaction.Synchronization}
 * on Nuxeo 11.5, which this bundle compiles against, and a {@code jakarta.transaction.Synchronization}
 * on LTS 2025, which it runs on: a call compiled against one is not found on the other. So the
 * method and the interface are looked up as the server has them, jakarta's first, and the
 * synchronization is a proxy of whichever it is, as nuxeo-agentic-documents does. Both define
 * {@code STATUS_COMMITTED} as 3.
 */
final class TransactionSynchronizations {

    private static final Logger log = LogManager.getLogger(TransactionSynchronizations.class);

    private static final List<String> INTERFACES = List.of("jakarta.transaction.Synchronization",
            "javax.transaction.Synchronization");

    static final int STATUS_COMMITTED = 3;

    private TransactionSynchronizations() {
    }

    /**
     * Run {@code action} once the current transaction has ended, unless it committed. Returns
     * {@code false}, running nothing, when there is no active transaction or no way to register.
     */
    static boolean unlessCommitted(Runnable action) {
        return whenEnded(false, action);
    }

    /**
     * Run {@code action} once the current transaction has committed. Returns {@code false}, running
     * nothing, when there is no active transaction or no way to register.
     */
    static boolean whenCommitted(Runnable action) {
        return whenEnded(true, action);
    }

    private static boolean whenEnded(boolean onCommit, Runnable action) {
        if (!TransactionHelper.isTransactionActive()) {
            return false;
        }
        for (String name : INTERFACES) {
            Class<?> type;
            Method register;
            try {
                type = Class.forName(name, false, TransactionHelper.class.getClassLoader());
                register = TransactionHelper.class.getMethod("registerSynchronization", type);
            } catch (ClassNotFoundException | NoSuchMethodException e) {
                continue;
            }
            Object synchronization = Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] { type },
                    (proxy, method, args) -> switch (method.getName()) {
                        case "afterCompletion" -> {
                            boolean committed = args[0] instanceof Integer status && status == STATUS_COMMITTED;
                            if (committed == onCommit) {
                                run(action);
                            }
                            yield null;
                        }
                        case "hashCode" -> System.identityHashCode(proxy);
                        case "equals" -> proxy == args[0];
                        case "toString" -> onCommit ? "e-signature: once the transaction commits"
                                : "e-signature: unless the transaction commits";
                        default -> null;
                    });
            try {
                register.invoke(null, synchronization);
                return true;
            } catch (IllegalAccessException | InvocationTargetException e) {
                log.warn("E-signature: could not register with the transaction through {}", name, e);
                return false;
            }
        }
        return false;
    }

    private static void run(Runnable action) {
        try {
            action.run();
        } catch (RuntimeException e) {
            log.warn("E-signature: what was to run once a transaction ended did not ({})",
                    e.getClass().getSimpleName());
        }
    }
}
