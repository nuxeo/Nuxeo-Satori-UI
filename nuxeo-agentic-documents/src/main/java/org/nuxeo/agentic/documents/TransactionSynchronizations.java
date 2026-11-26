/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.List;
import java.util.function.Consumer;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Something to run when the current transaction ends: without committing, or either way.
 *
 * <p>{@code TransactionHelper.registerSynchronization} takes a {@code javax.transaction.Synchronization}
 * on Nuxeo 11.5, which this bundle compiles against, and a {@code jakarta.transaction.Synchronization}
 * on LTS 2025, which it runs on: a call compiled against one is not found on the other. So the
 * method and the interface are looked up as the server has them, jakarta's first, and the
 * synchronization is a proxy of whichever it is. Both define {@code STATUS_COMMITTED} as 3.
 */
final class TransactionSynchronizations {

    private static final Logger log = LogManager.getLogger(TransactionSynchronizations.class);

    private static final List<String> INTERFACES = List.of("jakarta.transaction.Synchronization",
            "javax.transaction.Synchronization");

    /** {@code Status.STATUS_COMMITTED}, the same in javax and jakarta. */
    static final int STATUS_COMMITTED = 3;

    private TransactionSynchronizations() {
    }

    /**
     * Run {@code action} once the current transaction has ended, unless it committed. Returns
     * {@code false}, running nothing, when there is no active transaction or no way to register.
     */
    static boolean unlessCommitted(Runnable action) {
        return whenEnded(committed -> {
            if (!committed) {
                action.run();
            }
        });
    }

    /**
     * Run {@code action} once the current transaction has ended, told whether it committed.
     * Returns {@code false}, running nothing, when there is no active transaction or no way to
     * register.
     */
    static boolean whenEnded(Consumer<Boolean> action) {
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
                            run(() -> action.accept(args[0] instanceof Integer status && status == STATUS_COMMITTED));
                            yield null;
                        }
                        case "hashCode" -> System.identityHashCode(proxy);
                        case "equals" -> proxy == args[0];
                        case "toString" -> "controlled documents: after the transaction";
                        default -> null;
                    });
            try {
                register.invoke(null, synchronization);
                return true;
            } catch (IllegalAccessException | InvocationTargetException e) {
                log.warn("Controlled documents: could not register with the transaction through {}", name, e);
                return false;
            }
        }
        return false;
    }

    /**
     * The current transaction, as an object to tell it apart from another by identity, or
     * {@code null} when there is none. {@code TransactionHelper.lookupTransactionManager()} returns a
     * javax {@code TransactionManager} on 11.5 and a jakarta one on LTS 2025, so it and
     * {@code getTransaction()} are called by reflection.
     */
    static Object current() {
        if (!TransactionHelper.isTransactionActiveOrMarkedRollback()) {
            return null;
        }
        try {
            Method lookup = TransactionHelper.class.getMethod("lookupTransactionManager");
            Object manager = lookup.invoke(null);
            if (manager == null) {
                return null;
            }
            // Through the interface the lookup declares: the manager's own class need not be public.
            return lookup.getReturnType().getMethod("getTransaction").invoke(manager);
        } catch (ReflectiveOperationException | RuntimeException e) {
            log.warn("Controlled documents: could not read the current transaction", e);
            return null;
        }
    }

    private static void run(Runnable action) {
        try {
            action.run();
        } catch (RuntimeException e) {
            log.warn("Controlled documents: could not release a claim after its transaction ended; it expires "
                    + "on its own", e);
        }
    }
}
