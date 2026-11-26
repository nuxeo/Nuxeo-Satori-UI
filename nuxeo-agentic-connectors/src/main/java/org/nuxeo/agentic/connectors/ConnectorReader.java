package org.nuxeo.agentic.connectors;

import static org.nuxeo.ecm.core.api.security.SecurityConstants.READ;

import java.io.Serializable;
import java.util.function.Function;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.connectors.ConnectorException.Kind;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.PropertyException;

/**
 * {@link ConnectorService#read}, in the order that keeps a call from leaving the server before it
 * may, and a kept answer from reaching a reader before they may have it: the reader's {@code Read}
 * on the document, the connector, its own permission if it asks for more, an administrator for a
 * read past the cache, the document as the repository stores it, its type, its key, and only then
 * the cache and the call.
 *
 * <p>The key is read from the stored document, never from the model the request gave: Automation
 * builds an input document from a JSON entity, and applies the entity's properties to it in memory,
 * so a reader could otherwise send any key with a document they may only read.
 *
 * <p>The cache is asked last, with the stored document's id and key ({@link ConnectorCache}), so
 * every refusal above holds for a kept answer exactly as for a call.
 */
final class ConnectorReader {

    private static final Logger log = LogManager.getLogger(ConnectorReader.class);

    private final Function<String, Connector> connectors;

    private final SystemOfRecordClient client;

    private final ConnectorCache cache;

    private final ConnectorMetrics metrics;

    ConnectorReader(Function<String, Connector> connectors, SystemOfRecordClient client, ConnectorCache cache,
            ConnectorMetrics metrics) {
        this.connectors = connectors;
        this.client = client;
        this.cache = cache;
        this.metrics = metrics;
    }

    ConnectorAnswer read(CoreSession session, DocumentModel document, String connectorId, boolean refresh) {
        DocumentRef ref = document == null ? null : document.getRef();
        // Asked of the session, as the user: an administrator holds every permission, as Nuxeo decides.
        // Read first, so that no one learns which connectors exist from a record they may not read.
        if (ref == null || !session.hasPermission(ref, READ)) {
            throw refused(READ);
        }
        Connector connector = connectorId == null || !Connector.ID.matcher(connectorId).matches() ? null
                : connectors.apply(connectorId);
        if (connector == null) {
            throw new ConnectorException(Kind.UNKNOWN_CONNECTOR);
        }
        if (!READ.equals(connector.permission()) && !session.hasPermission(ref, connector.permission())) {
            throw refused(connector.permission());
        }
        if (refresh && !isAdministrator(session)) {
            throw new ConnectorException(Kind.REFRESH_NOT_ALLOWED);
        }
        DocumentModel stored = session.getDocument(ref);
        if (!connector.types().contains(stored.getType())) {
            log.info("Connector {}: document {} is a {}, which it does not read", connector.id(), stored.getId(),
                    stored.getType());
            return ConnectorAnswer.without(connector.id(), ConnectorAnswer.Status.NO_KEY);
        }
        String key = keyOf(stored, connector.keyXpath());
        if (!SystemOfRecordClient.sendable(key)) {
            if (key != null) {
                // The key is the record's data, possibly personal: it is not logged.
                log.info("Connector {}: document {} holds a key that is not sent: not one path segment of letters, "
                        + "digits, '.', '_' or '-'", connector.id(), stored.getId());
            }
            return ConnectorAnswer.without(connector.id(), ConnectorAnswer.Status.NO_KEY);
        }
        boolean cached = cache.ttl(connector) != null;
        if (refresh) {
            if (cached) {
                metrics.refresh(connector);
            }
            log.debug("Connector {}: an administrator reads past the cache for document {}", connector.id(),
                    stored.getId());
        } else if (cached) {
            ConnectorCache.Hit hit = cache.get(connector, stored.getId(), key);
            if (hit != null) {
                metrics.hit(connector, hit.age());
                log.debug("Connector {}: answered from the cache for document {}, {} s old", connector.id(),
                        stored.getId(), hit.age().toSeconds());
                return hit.answer().aged(hit.age().toSeconds());
            }
            metrics.miss(connector);
            log.debug("Connector {}: nothing kept for document {}", connector.id(), stored.getId());
        }
        log.debug("Connector {}: reading for document {}", connector.id(), stored.getId());
        // Before the call: a change event that comes while it is on its way keeps its answer out.
        ConnectorCache.Ticket asked = cache.ticket();
        ConnectorAnswer answer = client.fetch(connector, key);
        cache.put(connector, stored.getId(), key, answer, asked);
        return answer.aged(0);
    }

    private static boolean isAdministrator(CoreSession session) {
        NuxeoPrincipal principal = session.getPrincipal();
        return principal != null && principal.isAdministrator();
    }

    private static DocumentSecurityException refused(String permission) {
        return new DocumentSecurityException(
                "Reading this connector needs the " + permission + " permission on the document");
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
