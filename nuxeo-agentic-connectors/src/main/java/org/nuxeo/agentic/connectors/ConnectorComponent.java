package org.nuxeo.agentic.connectors;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.model.ComponentContext;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.DefaultComponent;

/**
 * Holds the connectors packages contribute, and reads through them.
 *
 * A connector is registered only once {@link Connector#of} accepts it; one that does not is
 * logged and left out, and a connector registered earlier with the same id stays. A later valid
 * contribution with the same id replaces it whole, and {@code enabled="false"} removes it.
 *
 * Addresses and credentials are read from the server's properties and the environment when a
 * connector is called ({@link ConnectorSettings}), so a contribution never holds either.
 */
public class ConnectorComponent extends DefaultComponent implements ConnectorService {

    private static final Logger log = LogManager.getLogger(ConnectorComponent.class);

    static final String XP_CONNECTORS = "connectors";

    private final Map<String, Connector> connectors = new ConcurrentHashMap<>();

    /** The descriptor each registered connector came from, so that unregistering another one keeps it. */
    private final Map<String, ConnectorDescriptor> sources = new ConcurrentHashMap<>();

    private volatile SystemOfRecordClient client;

    private volatile ConnectorReader reader;

    @Override
    public void registerContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        if (!XP_CONNECTORS.equals(extensionPoint) || !(contribution instanceof ConnectorDescriptor descriptor)) {
            log.warn("Unknown contribution to {}: {}", extensionPoint, contribution);
            return;
        }
        register(descriptor, contributor.getName().getName());
    }

    /** Package-private for tests, which have no runtime to contribute through. */
    void register(ConnectorDescriptor descriptor, String component) {
        if (!descriptor.isEnabled()) {
            if (descriptor.getId() != null && connectors.remove(descriptor.getId()) != null) {
                sources.remove(descriptor.getId());
                log.info("Connector {} removed by {}", descriptor.getId(), component);
            }
            return;
        }
        Connector connector;
        try {
            connector = Connector.of(descriptor);
        } catch (IllegalArgumentException e) {
            log.error("A connector contributed by {} is not registered: {}", component, e.getMessage());
            return;
        }
        connectors.put(connector.id(), connector);
        sources.put(connector.id(), descriptor);
    }

    @Override
    public void unregisterContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        if (contribution instanceof ConnectorDescriptor descriptor) {
            unregister(descriptor);
        }
    }

    void unregister(ConnectorDescriptor descriptor) {
        String id = descriptor.getId();
        if (id != null && sources.get(id) == descriptor) {
            sources.remove(id);
            connectors.remove(id);
        }
    }

    @Override
    public void start(ComponentContext context) {
        start(new ConnectorSettings(Framework::getProperty, System::getenv));
    }

    void start(ConnectorSettings settings) {
        client = new SystemOfRecordClient(settings);
        reader = new ConnectorReader(connectors::get, client);
    }

    @Override
    public void stop(ComponentContext context) {
        SystemOfRecordClient running = client;
        reader = null;
        client = null;
        if (running != null) {
            running.close();
        }
    }

    @Override
    public Connector getConnector(String id) {
        return id == null ? null : connectors.get(id);
    }

    @Override
    public ConnectorAnswer read(CoreSession session, DocumentModel document, String connectorId) {
        ConnectorReader running = reader;
        if (running == null) {
            throw new ConnectorException(ConnectorException.Kind.NOT_CONFIGURED);
        }
        return running.read(session, document, connectorId);
    }
}
