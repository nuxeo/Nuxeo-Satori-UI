package org.nuxeo.agentic.connectors;

import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * Connectors to systems of record, as the packages installed on this server contribute them.
 *
 * Reading goes through {@link #read} only, which checks the reader's permission on the document
 * before anything is sent: there is no way, through this service, to call a system without a
 * document the caller may read.
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
     * <li>The document is read again as the repository stores it, and its key is read from that,
     * never from the model given: a request can hand Automation a document with properties of its
     * own choosing.</li>
     * <li>A document of a type the connector does not read, or with no key it can send, answers
     * {@code no-key}, and nothing is sent.</li>
     * <li>Then the system is called, within the connector's bounds.</li>
     * </ol>
     */
    ConnectorAnswer read(CoreSession session, DocumentModel document, String connectorId);
}
