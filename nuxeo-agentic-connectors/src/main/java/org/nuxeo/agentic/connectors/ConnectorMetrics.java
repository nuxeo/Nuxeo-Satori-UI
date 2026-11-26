package org.nuxeo.agentic.connectors;

import java.time.Duration;

import org.nuxeo.runtime.metrics.MetricsService;

import io.dropwizard.metrics5.MetricName;
import io.dropwizard.metrics5.MetricRegistry;
import io.dropwizard.metrics5.SharedMetricRegistries;

/**
 * The connectors' metrics, in the platform's registry, the one Nuxeo's own metrics and its reporters
 * use, each tagged with the connector's id:
 *
 * <ul>
 * <li>{@code nuxeo.connectors.cache.hits} and {@code .misses}: reads answered from the cache, and
 * reads the cache could not answer while it was on. A connector with no time to live counts
 * neither;</li>
 * <li>{@code nuxeo.connectors.cache.age}: a histogram of how old, in seconds, each answer from the
 * cache was;</li>
 * <li>{@code nuxeo.connectors.cache.refreshes}: an administrator's reads past the cache;</li>
 * <li>{@code nuxeo.connectors.cache.invalidated}: answers a change event dropped;</li>
 * <li>{@code nuxeo.connectors.events.accepted}, and {@code .refused} tagged with the reason too.
 * A refused event for a connector the server does not have is tagged {@code (unknown)}, which no
 * connector id can be, never with what the request named.</li>
 * <li>{@code .refreshes} is counted only while the connector's cache is on.</li>
 * </ul>
 *
 * Nothing here is a key, a credential, a secret or anything a request sent.
 */
final class ConnectorMetrics {

    /** The tag of a refused event's connector when the server has none by that id: no id can be it. */
    static final String UNKNOWN = "(unknown)";

    private final MetricRegistry registry;

    ConnectorMetrics() {
        this(SharedMetricRegistries.getOrCreate(MetricsService.class.getName()));
    }

    ConnectorMetrics(MetricRegistry registry) {
        this.registry = registry;
    }

    static MetricName name(String group, String metric, String connector) {
        return MetricName.build("nuxeo", "connectors", group, metric).tagged("connector", connector);
    }

    void hit(Connector connector, Duration age) {
        registry.counter(name("cache", "hits", connector.id())).inc();
        registry.histogram(name("cache", "age", connector.id())).update(age.toSeconds());
    }

    void miss(Connector connector) {
        registry.counter(name("cache", "misses", connector.id())).inc();
    }

    void refresh(Connector connector) {
        registry.counter(name("cache", "refreshes", connector.id())).inc();
    }

    void invalidated(Connector connector, int answers) {
        registry.counter(name("cache", "invalidated", connector.id())).inc(answers);
    }

    void accepted(Connector connector) {
        registry.counter(name("events", "accepted", connector.id())).inc();
    }

    void refused(Connector connector, ChangeEvents.Reason reason) {
        registry.counter(name("events", "refused", connector == null ? UNKNOWN : connector.id())
                .tagged("reason", reason.name().toLowerCase(java.util.Locale.ROOT))).inc();
    }

    MetricRegistry registry() {
        return registry;
    }
}
