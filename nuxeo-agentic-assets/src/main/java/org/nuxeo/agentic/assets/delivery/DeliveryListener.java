/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.delivery;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DataModel;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.event.DocumentEventTypes;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Delivery packages' one way in, and their guard: a synchronous listener on the repository's
 * document events, run in the thread of the person who caused them.
 *
 * <ul>
 * <li><b>A {@code MediaDelivery} filed</b> is decided before it is created ({@link Deliveries}):
 * delivered, with the server's record of it, or refused whole, and then not created.</li>
 * <li><b>Everything else</b> on a delivery is refused: a change to a property of its schema, an
 * import, a copy, a move, a check-in, a restore and a trash; and a deletion, but an
 * administrator's. Its title and description are Nuxeo's to allow.</li>
 * </ul>
 *
 * A refusal throws, after marking the person's transaction for rollback, so that nothing of the
 * request is written.
 */
public class DeliveryListener implements EventListener {

    private static final Logger log = LogManager.getLogger(DeliveryListener.class);

    static final String DOCUMENT_TRASHED = "documentTrashed";

    private final Deliveries deliveries;

    public DeliveryListener() {
        this(new Deliveries());
    }

    DeliveryListener(Deliveries deliveries) {
        this.deliveries = deliveries;
    }

    @Override
    public void handleEvent(Event event) {
        if (!(event.getContext() instanceof DocumentEventContext context)) {
            return;
        }
        DocumentModel doc = context.getSourceDocument();
        if (doc == null || !Deliveries.TYPE.equals(doc.getType())) {
            return;
        }
        CoreSession session = context.getCoreSession();
        try {
            handle(event.getName(), session, doc);
        } catch (DeliveryRefusal refusal) {
            log.info("Media deliveries: {} of a delivery by {} refused, {}: {}", event.getName(), who(session),
                    refusal.getStatusCode(), refusal.getCode());
            fail(event);
            throw refusal;
        } catch (RuntimeException e) {
            log.error("Media deliveries: {} of a delivery by {} failed; nothing of it is kept", event.getName(),
                    who(session), e);
            fail(event);
            throw e;
        }
    }

    private static void fail(Event event) {
        TransactionHelper.setTransactionRollbackOnly();
        event.markBubbleException();
    }

    private void handle(String event, CoreSession session, DocumentModel doc) {
        switch (event) {
        case DocumentEventTypes.ABOUT_TO_CREATE -> deliveries.deliver(session, doc);
        case DocumentEventTypes.BEFORE_DOC_UPDATE -> {
            DataModel own = doc.getDataModel(Deliveries.SCHEMA);
            if (own != null && own.isDirty()) {
                throw new DeliveryRefusal(403, "kept", "A delivery's record is written by the server alone, once.");
            }
        }
        case DocumentEventTypes.ABOUT_TO_REMOVE -> {
            if (!administrator(session)) {
                throw new DeliveryRefusal(403, "kept", "A delivery is kept: only an administrator deletes one.");
            }
            log.warn("Media deliveries: {} deletes the delivery {}", who(session), doc.getId());
        }
        case DocumentEventTypes.ABOUT_TO_MOVE, DOCUMENT_TRASHED -> {
            if (!administrator(session)) {
                throw new DeliveryRefusal(403, "kept", "A delivery stays where it was filed.");
            }
        }
        case DocumentEventTypes.ABOUT_TO_IMPORT -> throw new DeliveryRefusal(403, "server-only",
                "A delivery is decided by the server when it is filed, not imported.");
        default -> throw new DeliveryRefusal(403, "kept", "A delivery is not copied, checked in or restored.");
        }
    }

    private static boolean administrator(CoreSession session) {
        NuxeoPrincipal principal = session == null ? null : session.getPrincipal();
        return principal != null && principal.isAdministrator();
    }

    private static String who(CoreSession session) {
        NuxeoPrincipal principal = session == null ? null : session.getPrincipal();
        return principal == null ? "nobody" : principal.getName();
    }
}
