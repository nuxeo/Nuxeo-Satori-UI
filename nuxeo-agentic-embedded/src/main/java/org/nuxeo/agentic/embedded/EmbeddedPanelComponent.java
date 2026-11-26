package org.nuxeo.agentic.embedded;

import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.model.ComponentContext;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.DefaultComponent;
import org.nuxeo.runtime.model.RuntimeContext;

/**
 * Holds the host applications this server registers ({@code org.nuxeo.agentic.embedded}, point
 * {@code hosts}), and runs the token exchange and the guard with them.
 *
 * <b>Only from the server's configuration directory.</b> Which systems may sign this server's users
 * in is the deployment's to decide, as the operations allow-list is in {@code nuxeo-agentic-core}: a
 * contribution is taken only from a file in {@code nxserver/config/}, which the runtime deploys in its
 * own context; one from a bundle, a package's among them, is refused and logged, whatever it says.
 *
 * A host is registered only once {@link Host#of} accepts it. One that does not is logged and left
 * out, and takes a host registered earlier with the same id out with it, so that a contribution
 * meant to narrow a host and failing a check does not leave the wider one in force. A later valid
 * contribution with the same id replaces it whole, and {@code enabled="false"} removes it, which
 * ends its tokens at once: the guard refuses a token whose host is not registered.
 *
 * The secrets and keys are read from the server's properties and the environment at each exchange
 * ({@link EmbeddedSettings}), so that a contribution never holds one.
 */
public class EmbeddedPanelComponent extends DefaultComponent implements EmbeddedPanelService {

    private static final Logger log = LogManager.getLogger(EmbeddedPanelComponent.class);

    static final String XP_HOSTS = "hosts";

    private final Map<String, Host> hosts = new ConcurrentHashMap<>();

    /** The descriptor each registered host came from, so that unregistering another one keeps it. */
    private final Map<String, HostDescriptor> sources = new ConcurrentHashMap<>();

    /**
     * The context the runtime deploys the configuration directory's files in. Package-private for
     * tests, which have no runtime.
     */
    Supplier<RuntimeContext> configuration = () -> Framework.getRuntime() == null ? null
            : Framework.getRuntime().getContext();

    private volatile TokenExchange exchange;

    private volatile PanelTokenGuard guard;

    @Override
    public void registerContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        if (!XP_HOSTS.equals(extensionPoint) || !(contribution instanceof HostDescriptor descriptor)) {
            log.warn("Unknown contribution to {}: {}", extensionPoint, contribution);
            return;
        }
        String component = contributor.getName().getName();
        RuntimeContext context = contributor.getContext();
        RuntimeContext expected = configuration.get();
        if (context == null || context != expected) {
            String bundle = context == null || context.getBundle() == null ? "no bundle"
                    : context.getBundle().getSymbolicName();
            log.error("Embedded panels: {}, from {}, is refused: the hosts are the deployment's, and are read only "
                    + "from a file in nxserver/config/, never from a bundle", component, bundle);
            return;
        }
        register(descriptor, component);
    }

    /** Package-private for tests, which have no runtime to contribute through. */
    synchronized void register(HostDescriptor descriptor, String component) {
        if (!descriptor.isEnabled()) {
            if (descriptor.getId() != null && hosts.remove(descriptor.getId()) != null) {
                sources.remove(descriptor.getId());
                log.info("Embedded panels: host {} removed by {}", descriptor.getId(), component);
            }
            return;
        }
        Host host;
        try {
            host = Host.of(descriptor);
        } catch (IllegalArgumentException e) {
            log.error("Embedded panels: a host contributed by {} is not registered: {}", component, e.getMessage());
            // Fail closed: an entry meant to replace one takes the earlier one with it.
            if (descriptor.getId() != null && hosts.remove(descriptor.getId()) != null) {
                sources.remove(descriptor.getId());
                log.error("Embedded panels: host {} is removed, since the entry that replaced it is refused",
                        descriptor.getId());
            }
            return;
        }
        hosts.put(host.id(), host);
        sources.put(host.id(), descriptor);
        log.info("Embedded panels: host {} registered by {}, for {} origin(s), scopes {}{}", host.id(), component,
                host.origins().size(), host.scopes(), host.allowAdministrators() ? ", administrators allowed" : "");
    }

    @Override
    public void unregisterContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        if (contribution instanceof HostDescriptor descriptor) {
            unregister(descriptor);
        }
    }

    synchronized void unregister(HostDescriptor descriptor) {
        String id = descriptor.getId();
        if (id != null && sources.get(id) == descriptor) {
            sources.remove(id);
            hosts.remove(id);
        }
    }

    @Override
    public void start(ComponentContext context) {
        start(new EmbeddedSettings(Framework::getProperty, System::getenv), new KeyValueReplayGuard(),
                new PlatformUserDirectory(), new PlatformTokenCodec(), new PlatformExchangeAudit(),
                Clock.systemUTC());
    }

    /** Package-private for tests. */
    void start(EmbeddedSettings settings, ReplayGuard replays, UserDirectory users, TokenCodec tokens,
            ExchangeAudit audit, Clock clock) {
        exchange = new TokenExchange(this::getHost, settings, replays, users, tokens, audit, clock,
                () -> UUID.randomUUID().toString());
        guard = new PanelTokenGuard(this::getHost, tokens, clock);
    }

    @Override
    public void stop(ComponentContext context) {
        exchange = null;
        guard = null;
    }

    @Override
    public Host getHost(String id) {
        return id == null ? null : hosts.get(id);
    }

    @Override
    public TokenExchange.Result exchange(String clientId, String clientSecret, Map<String, List<String>> parameters) {
        TokenExchange running = exchange;
        if (running == null) {
            return TokenExchange.Result.error(503, "server_error", "the server is starting");
        }
        return running.exchange(clientId, clientSecret, parameters);
    }

    @Override
    public PanelTokenGuard.Decision check(PanelTokenGuard.Request request) {
        PanelTokenGuard running = guard;
        if (running == null) {
            // Not started: a panel's token is refused, anything else passes.
            return PanelTokenGuard.claimsAHost(PanelTokenGuard.bearer(request.authorization()))
                    || PanelTokenGuard.claimsAHost(request.queryToken())
                    || PanelTokenGuard.claimsAHost(request.formToken())
                            ? new PanelTokenGuard.Decision(503, "the server is starting")
                            : PanelTokenGuard.Decision.PASS;
        }
        return running.check(request);
    }
}
