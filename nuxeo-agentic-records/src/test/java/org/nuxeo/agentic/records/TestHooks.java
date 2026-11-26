package org.nuxeo.agentic.records;

import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.TimeUnit;

import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;

/** Test-only listeners, contributed by OSGI-INF/test-failures.xml. Each does nothing until a test arms it. */
public final class TestHooks {

    /** The title of a record whose deletion fails, while armed. */
    static volatile String failOnRemove;

    /** The barrier two requests wait at, as they are filed, while armed. */
    static volatile CyclicBarrier filing;

    /** Whether recording a view fails, while armed. */
    static volatile boolean failOnView;

    static void reset() {
        failOnRemove = null;
        filing = null;
        failOnView = false;
    }

    /** A failure while a view is recorded: a listener of the view's event throws, and says it must bubble. */
    public static class FailOnView implements EventListener {
        @Override
        public void handleEvent(Event event) {
            if (failOnView) {
                event.markBubbleException();
                throw new NuxeoException("The test's failure, recording a view");
            }
        }
    }

    /** A failure partway through a disposal: the deletion of one record throws. */
    public static class FailOnRemove implements EventListener {
        @Override
        public void handleEvent(Event event) {
            String title = failOnRemove;
            if (title != null && event.getContext() instanceof DocumentEventContext context) {
                DocumentModel doc = context.getSourceDocument();
                if (doc != null && title.equals(doc.getTitle())) {
                    event.markBubbleException();
                    throw new NuxeoException("The test's failure, deleting " + title);
                }
            }
        }
    }

    /**
     * Holds each request as it is filed, before the add-on sees it, until another has been filed too,
     * so that two requests reach the add-on at the same time.
     */
    public static class FilingBarrier implements EventListener {
        @Override
        public void handleEvent(Event event) {
            CyclicBarrier barrier = filing;
            if (barrier != null && event.getContext() instanceof DocumentEventContext context) {
                DocumentModel doc = context.getSourceDocument();
                if (doc != null && (Disposition.REQUEST_TYPE.equals(doc.getType())
                        || Physical.REQUEST_TYPE.equals(doc.getType()))) {
                    try {
                        barrier.await(20, TimeUnit.SECONDS);
                    } catch (Exception e) {
                        throw new IllegalStateException("The other request was never filed", e);
                    }
                }
            }
        }
    }

    private TestHooks() {
    }
}
