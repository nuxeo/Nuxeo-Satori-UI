package org.nuxeo.agentic.connectors;

import java.io.Serializable;
import java.util.function.Function;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.connectors.ConnectorException.Kind;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.PropertyException;

/**
 * {@link ConnectorService#read}, in the order that keeps a call from leaving the server before it
 * may: the connector, then the reader's permission on the document, then the key, then the call.
 */
final class ConnectorReader {

    private static final Logger log = LogManager.getLogger(ConnectorReader.class);

    private final Function<String, Connector> connectors;

    private final SystemOfRecordClient client;

    ConnectorReader(Function<String, Connector> connectors, SystemOfRecordClient client) {
        this.connectors = connectors;
        this.client = client;
    }

    ConnectorAnswer read(CoreSession session, DocumentModel document, String connectorId) {
        Connector connector = connectorId == null || !Connector.ID.matcher(connectorId).matches() ? null
                : connectors.apply(connectorId);
        if (connector == null) {
            throw new ConnectorException(Kind.UNKNOWN_CONNECTOR);
        }
        DocumentRef ref = document == null ? null : document.getRef();
        // Asked of the session, as the user: an administrator holds every permission, as Nuxeo decides.
        if (ref == null || !session.hasPermission(ref, connector.permission())) {
            throw new DocumentSecurityException(
                    "Reading this connector needs the " + connector.permission() + " permission on the document");
        }
        String key = keyOf(document, connector.keyXpath());
        if (!SystemOfRecordClient.sendable(key)) {
            if (key != null) {
                // The key is the record's data, possibly personal: it is not logged.
                log.info("Connector {}: document {} holds a key that is not sent: not one path segment of letters, "
                        + "digits, '.', '_' or '-'", connector.id(), document.getId());
            }
            return ConnectorAnswer.without(connector.id(), ConnectorAnswer.Status.NO_KEY);
        }
        return client.fetch(connector, key);
    }

    /** The document's key as text: a text or a whole number, trimmed; {@code null} for anything else or none. */
    static String keyOf(DocumentModel document, String xpath) {
        Serializable value;
        try {
            value = document.getPropertyValue(xpath);
        } catch (PropertyException e) {
            // A document without the property: a type the connector was not written for.
            return null;
        }
        if (value instanceof String text) {
            String trimmed = text.trim();
            return trimmed.isEmpty() ? null : trimmed;
        }
        if (value instanceof Long || value instanceof Integer) {
            return value.toString();
        }
        return null;
    }
}
