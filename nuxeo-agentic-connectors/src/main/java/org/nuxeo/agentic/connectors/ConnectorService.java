package org.nuxeo.agentic.connectors;

import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * Connectors to systems of record, as the packages installed on this server contribute them.
 *
 * Reading goes through {@link #read} only, which checks the reader's permission on the document
 * before anything is sent or given from the cache: there is no way, through this service, to call a
 * system, or to have one of its kept answers, without a document the caller may read.
 */
public interface ConnectorService {

    /** The connector with this id, or {@code null} when none is registered. */
    Connector getConnector(String id);

    /**
     * The record the connector reads for the document's key, as the session's user.
     *
     * <ol>
     * <li>The user must hold {@code Read} on the document, and then the connector's own permission
     * if it asks for more: without either, a {@code DocumentSecurityException}, and nothing is
     * sent.</li>
     * <li>An unknown connector is a {@link ConnectorException} with status 404.</li>
     * <li>{@code refresh}, a read past the cache, is an administrator's only: anyone else's is a
     * {@link ConnectorException} with status 403, and nothing is sent.</li>
     * <li>The document is read again as the repository stores it, and its key is read from that,
     * never from the model given: a request can hand Automation a document with properties of its
     * own choosing.</li>
     * <li>A document of a type the connector does not read, or with no key it can send, answers
     * {@code no-key}, and nothing is sent.</li>
     * <li>Then the answer kept for this document and key, if the server keeps the connector's and it
     * is young enough ({@link ConnectorCache}); else the system is called, within the connector's
     * bounds, and its answer kept.</li>
     * </ol>
     */
    ConnectorAnswer read(CoreSession session, DocumentModel document, String connectorId, boolean refresh);

    /** {@link #read(CoreSession, DocumentModel, String, boolean)}, from the cache where it may. */
    default ConnectorAnswer read(CoreSession session, DocumentModel document, String connectorId) {
        return read(session, document, connectorId, false);
    }

    /**
     * A change event from a connector's system of record ({@link ChangeEvents}): once its signature,
     * timestamp and nonce hold, the answers kept for the record it names are dropped. Nothing else.
     */
    ChangeEvents.Result changed(String connectorId, String timestamp, String nonce, String signature, byte[] body);
}
