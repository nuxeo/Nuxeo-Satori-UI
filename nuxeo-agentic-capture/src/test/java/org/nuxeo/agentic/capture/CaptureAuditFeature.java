/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

import javax.persistence.EntityManager;

import org.junit.runners.model.FrameworkMethod;
import org.nuxeo.ecm.core.api.impl.UserPrincipal;
import org.nuxeo.ecm.core.event.EventService;
import org.nuxeo.ecm.core.event.impl.EventContextImpl;
import org.nuxeo.ecm.core.persistence.PersistenceProvider;
import org.nuxeo.ecm.core.persistence.PersistenceProviderFactory;
import org.nuxeo.ecm.core.query.sql.model.Predicates;
import org.nuxeo.ecm.core.query.sql.model.QueryBuilder;
import org.nuxeo.ecm.core.work.api.WorkManager;
import org.nuxeo.ecm.platform.audit.api.AuditReader;
import org.nuxeo.ecm.platform.test.PlatformFeature;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.management.ManagementFeature;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.test.runner.RunnerFeature;
import org.nuxeo.runtime.test.runner.TransactionalFeature;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * The platform's audit in the tests, as the platform's own {@code AuditFeature} deploys it: its
 * service, its listener, its stream writer and its store, an H2 database.
 *
 * <p>
 * Not that feature itself: its waiter reads the audit stream's lag, which the Chronicle Queue the
 * tests pin for Java 21 does not report, so it waits its whole timeout at every transaction. This one
 * waits for an entry of its own instead: the audit's writer takes its stream in order, so once its own
 * entry is written, every entry before it is too. It also empties the audit before each test.
 *
 * <p>The records and documents add-ons' own, as it is: the add-ons' tests run the
 * platform's audit the same way.
 */
@Features({ ManagementFeature.class, PlatformFeature.class })
@Deploy("org.nuxeo.runtime.datasource")
@Deploy("org.nuxeo.runtime.metrics")
@Deploy("org.nuxeo.ecm.core.persistence")
@Deploy("org.nuxeo.ecm.platform.audit")
@Deploy("org.nuxeo.ecm.platform.audit:nxaudit-ds.xml")
@Deploy("org.nuxeo.ecm.platform.audit:nxaudit-directories-remove.xml")
public class CaptureAuditFeature implements RunnerFeature {

    /** The event the waiter fires and waits for: audited by the platform, with no document. */
    static final String SENTINEL = "loginSuccess";

    @Override
    public void initialize(FeaturesRunner runner) {
        runner.getFeature(TransactionalFeature.class).addWaiter(CaptureAuditFeature::awaitAudit);
    }

    @Override
    public void beforeSetup(FeaturesRunner runner, FrameworkMethod method, Object test) {
        clear();
    }

    /** Waits for the audit's writer to have written everything committed before it was asked. */
    static boolean awaitAudit(Duration timeout) throws InterruptedException {
        long deadline = System.nanoTime() + timeout.toNanos();
        WorkManager works = Framework.getService(WorkManager.class);
        if (!works.awaitCompletion(timeout.toMillis(), java.util.concurrent.TimeUnit.MILLISECONDS)) {
            return false;
        }
        String marker = "sentinel-" + UUID.randomUUID();
        boolean active = TransactionHelper.isTransactionActive();
        if (active) {
            TransactionHelper.commitOrRollbackTransaction();
        }
        try {
            // Fired from a thread of its own: the platform's audit listener keeps what a transaction
            // collects in the thread's locals, and a test's thread is not to be relied on for it.
            Thread fire = new Thread(() -> TransactionHelper.runInTransaction(() -> {
                EventContextImpl context = new EventContextImpl(null, new UserPrincipal("system", List.of(), false, false));
                context.setProperty("comment", marker);
                Framework.getService(EventService.class).fireEvent(context.newEvent(SENTINEL));
            }), "capture-audit-sentinel");
            fire.start();
            fire.join(timeout.toMillis());
            while (System.nanoTime() < deadline) {
                QueryBuilder query = new QueryBuilder();
                query.predicate(Predicates.eq("eventId", SENTINEL));
                query.and(Predicates.eq("comment", marker));
                List<?> found = TransactionHelper.runInTransaction(
                        () -> Framework.getService(AuditReader.class).queryLogs(query));
                if (!found.isEmpty()) {
                    return true;
                }
                Thread.sleep(20);
            }
            return false;
        } finally {
            if (active) {
                TransactionHelper.startTransaction();
            }
        }
    }

    /** Every entry of the audit, removed, as the platform's own feature removes them after a class. */
    static void clear() {
        boolean active = TransactionHelper.isTransactionActive();
        if (!active) {
            TransactionHelper.startTransaction();
        }
        try {
            PersistenceProvider provider = Framework.getService(PersistenceProviderFactory.class)
                                                    .newProvider("nxaudit-logs");
            EntityManager em = provider.acquireEntityManager();
            try {
                em.createNativeQuery("delete from nxp_logs_mapextinfos").executeUpdate();
                em.createNativeQuery("delete from nxp_logs_extinfo").executeUpdate();
                em.createNativeQuery("delete from nxp_logs").executeUpdate();
            } finally {
                em.close();
            }
        } finally {
            if (!active) {
                TransactionHelper.commitOrRollbackTransaction();
            }
        }
    }
}
