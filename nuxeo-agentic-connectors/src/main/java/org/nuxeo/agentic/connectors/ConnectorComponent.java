package org.nuxeo.agentic.connectors;

import java.time.InstantSource;
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
 * contribution with the same id replaces it whole, and {@code enabled="false"} removes it; either
 * drops the answers kept for that id ({@link ConnectorCache}).
 *
 * Addresses, credentials, times to live and events secrets are read from the server's properties
 * and the environment when a connector is called ({@link ConnectorSettings}), so a contribution
 * never holds any of them.
 */
public class ConnectorComponent extends DefaultComponent implements ConnectorService {

    private static final Logger log = LogManager.getLogger(ConnectorComponent.class);

    static final String XP_CONNECTORS = "connectors";

    private final Map<String, Connector> connectors = new ConcurrentHashMap<>();

    /** The descriptor each registered connector came from, so that unregistering another one keeps it. */
    private final Map<String, ConnectorDescriptor> sources = new ConcurrentHashMap<>();

    private volatile SystemOfRecordClient client;

    private volatile ConnectorCache cache;

    private volatile ConnectorReader reader;

    private volatile ChangeEvents events;

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
                forget(descriptor.getId());
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
        String envPrefix = Connector.envPrefix(connector.id());
        for (Connector other : connectors.values()) {
            if (!other.id().equals(connector.id()) && Connector.envPrefix(other.id()).equals(envPrefix)) {
                log.error("A connector contributed by {} is not registered: its id {} and the registered {} share "
                        + "the environment variables {}*", component, connector.id(), other.id(), envPrefix);
                return;
            }
        }
        connectors.put(connector.id(), connector);
        sources.put(connector.id(), descriptor);
        forget(connector.id());
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
            forget(id);
        }
    }

    /** Drops the answers kept for a connector id whose definition changed or went. */
    private void forget(String id) {
        ConnectorCache running = cache;
        if (running != null) {
            running.forget(id);
        }
    }

    @Override
    public void start(ComponentContext context) {
        start(new ConnectorSettings(Framework::getProperty, System::getenv), InstantSource.system(),
                new ConnectorMetrics());
    }

    void start(ConnectorSettings settings, InstantSource clock, ConnectorMetrics metrics) {
        client = new SystemOfRecordClient(settings);
        cache = new ConnectorCache(settings, clock);
        reader = new ConnectorReader(connectors::get, client, cache, metrics);
        events = new ChangeEvents(connectors::get, settings, cache, metrics);
    }

    @Override
    public void stop(ComponentContext context) {
        SystemOfRecordClient running = client;
        ConnectorCache kept = cache;
        reader = null;
        events = null;
        cache = null;
        client = null;
        if (kept != null) {
            kept.clear();
        }
        if (running != null) {
            running.close();
        }
    }

    /** For tests, which move the cache's clock on rather than wait. */
    void clock(InstantSource clock) {
        ConnectorCache running = cache;
        if (running != null) {
            running.clock(clock);
        }
    }

    /** For tests: the cache, once started. */
    ConnectorCache cache() {
        return cache;
    }

    /** For tests: the change events, once started. */
    ChangeEvents events() {
        return events;
    }

    @Override
    public Connector getConnector(String id) {
        return id == null ? null : connectors.get(id);
    }

    @Override
    public ConnectorAnswer read(CoreSession session, DocumentModel document, String connectorId, boolean refresh) {
        ConnectorReader running = reader;
        if (running == null) {
            throw new ConnectorException(ConnectorException.Kind.NOT_CONFIGURED);
        }
        return running.read(session, document, connectorId, refresh);
    }

    @Override
    public ChangeEvents.Result changed(String connectorId, String timestamp, String nonce, String signature,
            byte[] body) {
        ChangeEvents running = events;
        if (running == null) {
            // Not started: nothing is kept to drop, and nothing is said of why.
            return new ChangeEvents.Result(ChangeEvents.Reason.UNKNOWN_CONNECTOR, 0);
        }
        return running.receive(connectorId, timestamp, nonce, signature, body);
    }
}
