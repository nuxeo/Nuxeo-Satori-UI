/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.delivery;

import java.util.Set;
import java.util.function.Function;
import java.util.regex.Pattern;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreInstance;
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
 * import, a copy, a check-in and a restore, whoever asks; and a move, a trash and a deletion, but
 * an administrator's. Its title and description are Nuxeo's to allow.</li>
 * <li><b>A folder holding a delivery</b> is not removed, moved, trashed or copied, but by an
 * administrator: the platform does any of those to the folder's documents with no event of their
 * own, so the delivery would go, or be copied, without this listener hearing it.</li>
 * </ul>
 *
 * A refusal throws, after marking the person's transaction for rollback, so that nothing of the
 * request is written.
 */
public class DeliveryListener implements EventListener {

    private static final Logger log = LogManager.getLogger(DeliveryListener.class);

    static final String DOCUMENT_TRASHED = "documentTrashed";

    static final String DOCUMENT_CREATED_BY_COPY = "documentCreatedByCopy";

    /** What a folder's documents undergo with it, with no event of their own. */
    static final Set<String> CONTAINER_EVENTS = Set.of(DocumentEventTypes.ABOUT_TO_REMOVE,
            DocumentEventTypes.ABOUT_TO_MOVE, DOCUMENT_TRASHED, DOCUMENT_CREATED_BY_COPY);

    /** What a folder's id may be, to be written into a query: anything else refuses. */
    private static final Pattern QUERY_SAFE = Pattern.compile("[A-Za-z0-9_.:-]+");

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
        if (doc == null) {
            return;
        }
        boolean delivery = Deliveries.TYPE.equals(doc.getType());
        if (!delivery && !(CONTAINER_EVENTS.contains(event.getName()) && doc.isFolder())) {
            return;
        }
        CoreSession session = context.getCoreSession();
        try {
            if (delivery) {
                handle(event.getName(), session, doc);
            } else {
                container(session, doc);
            }
        } catch (DeliveryRefusal refusal) {
            log.info("Media deliveries: {} of a {} by {} refused, {}: {}", event.getName(), doc.getType(),
                    who(session), refusal.getStatusCode(), refusal.getCode());
            fail(event);
            throw refusal;
        } catch (RuntimeException e) {
            log.error("Media deliveries: {} of a {} by {} failed; nothing of it is kept", event.getName(),
                    doc.getType(), who(session), e);
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
                throw new DeliveryRefusal(403, "kept", "A delivery stays where it was filed, but for an administrator.");
            }
        }
        case DocumentEventTypes.ABOUT_TO_IMPORT -> throw new DeliveryRefusal(403, "server-only",
                "A delivery is decided by the server when it is filed, not imported.");
        default -> throw new DeliveryRefusal(403, "kept", "A delivery is not copied, checked in or restored.");
        }
    }

    /**
     * A folder removed, moved, trashed or copied: refused, but an administrator's, when a delivery is
     * below it, or below its copy. Looked for with the system's rights, since the person may not read
     * every delivery the folder holds.
     */
    private static void container(CoreSession session, DocumentModel folder) {
        if (administrator(session)) {
            return;
        }
        if (session == null) {
            throw new DeliveryRefusal(403, "kept", "A folder is changed by a person signed in.");
        }
        String id = folder.getId();
        if (id == null || !QUERY_SAFE.matcher(id).matches()) {
            throw new DeliveryRefusal(403, "kept", "A folder that may hold deliveries is not changed so.");
        }
        String query = "SELECT ecm:uuid FROM " + Deliveries.TYPE + " WHERE ecm:ancestorId = '" + id + "'";
        boolean holds = CoreInstance.doPrivileged(session,
                (Function<CoreSession, Boolean>) privileged -> !privileged.queryProjection(query, 1, 0).isEmpty());
        if (holds) {
            throw new DeliveryRefusal(403, "kept",
                    "A folder holding deliveries is not removed, moved, trashed or copied, but by an administrator.");
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
