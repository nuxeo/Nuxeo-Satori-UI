package org.nuxeo.agentic.config;

import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.function.UnaryOperator;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.model.ComponentContext;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.DefaultComponent;
import org.nuxeo.runtime.model.RuntimeContext;

/**
 * Collects the configuration packages contribute and builds the snapshot the servlet serves.
 *
 * Registration order is dependency order — Nuxeo registers a component's contributions after those
 * of every component it {@code <require>}s — and the registry keeps it. The snapshot is built in
 * {@link #start}, once every contribution is in, and rebuilt only if contributions change after
 * that, which outside a dev-mode hot reload they do not.
 *
 * One server setting changes that, and only that one: with {@code nuxeo.agentic.ui.config.dev}
 * set, {@link DevOverrides} is consulted on every call and the snapshot is rebuilt whenever the
 * override directory has changed, so a configuration edit needs no restart. With the property
 * unset — every production server — {@link #overrides} is {@code null} and {@link #getSnapshot}
 * runs the path above and nothing else.
 */
public class AgenticUiConfigComponent extends DefaultComponent implements AgenticUiConfigService {

    private static final Logger log = LogManager.getLogger(AgenticUiConfigComponent.class);

    static final String XP_CONFIGURATION = "configuration";

    private final ContributionRegistry registry = new ContributionRegistry();

    private volatile ConfigSnapshot snapshot;

    /**
     * The development override directory, or {@code null} — which is what a server that has not
     * set {@code nuxeo.agentic.ui.config.dev} holds, and is what makes the override path
     * unreachable there rather than merely unused.
     */
    private volatile DevOverrides overrides;

    /** The state of the override directory {@link #snapshot} was built from. */
    private volatile String overrideStamp;

    @Override
    public void registerContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        if (!XP_CONFIGURATION.equals(extensionPoint)) {
            log.warn("Unknown extension point: {}", extensionPoint);
            return;
        }
        String component = contributor.getName().getName();
        RuntimeContext context = contributor.getContext();
        String bundle = context.getBundle() == null ? component : context.getBundle().getSymbolicName();
        Contribution entry;
        if (contribution instanceof FragmentDescriptor fragment) {
            entry = Contribution.fragment(fragment.getLayer(), fragment.getName(), fragment.isEnabled(),
                    new Provenance(component, bundle, source(fragment.getSrc())),
                    content(context, fragment.getSrc(), fragment.getJson()), fragment);
        } else if (contribution instanceof LayoutDescriptor layout) {
            entry = Contribution.layout(layout.getType(), layout.getMode(), layout.isEnabled(),
                    new Provenance(component, bundle, source(layout.getSrc())),
                    content(context, layout.getSrc(), layout.getJson()), layout);
        } else if (contribution instanceof AssetDescriptor asset) {
            entry = Contribution.asset(asset.getName(), asset.isEnabled(),
                    new Provenance(component, bundle, source(asset.getSrc())),
                    content(context, asset.getSrc(), null), asset);
        } else {
            log.warn("Unknown contribution to {}: {}", XP_CONFIGURATION, contribution);
            return;
        }
        // The same lock as the build: a hot reload must not interleave with one, or the build
        // would publish a snapshot of contributions that have since changed.
        synchronized (this) {
            registry.add(entry);
            snapshot = null;
        }
    }

    @Override
    public void unregisterContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        synchronized (this) {
            if (registry.remove(contribution)) {
                snapshot = null;
            }
        }
    }

    @Override
    public void start(ComponentContext context) {
        activateDevOverrides(Framework::getProperty);
        getSnapshot();
    }

    /**
     * Decide, once, whether the development override directory is consulted.
     *
     * Takes the property lookup rather than calling {@code Framework} itself so that the decision
     * — including the {@code null} the unset property produces, which is the production one — can
     * be exercised without a running Nuxeo. A test that reached past this and set the field
     * directly would assert the override path and leave the thing that actually keeps it off
     * untested.
     */
    void activateDevOverrides(UnaryOperator<String> properties) {
        overrides = DevOverrides.ifEnabled(properties);
        if (overrides != null) {
            log.warn("Agentic UI configuration: DEVELOPMENT OVERRIDES ARE ACTIVE. {} is set, so {} is read on "
                    + "every request and its fragments are applied after every package's. Unset {} on any server "
                    + "that is not a development or demo box.", DevOverrides.ENABLED_PROPERTY, overrides.directory(),
                    DevOverrides.ENABLED_PROPERTY);
        }
    }

    @Override
    public void stop(ComponentContext context) {
        snapshot = null;
        overrides = null;
        overrideStamp = null;
    }

    @Override
    public ConfigSnapshot getSnapshot() {
        DevOverrides active = overrides;
        return active == null ? packagedSnapshot() : overriddenSnapshot(active);
    }

    /**
     * The snapshot of what packages contributed, built once and cached until a contribution
     * changes.
     *
     * This is the whole of the production path and it is unchanged: with
     * {@code nuxeo.agentic.ui.config.dev} unset, {@link #overrides} is {@code null} and nothing in
     * {@link DevOverrides} is reached — no path is built, no directory is stat-ed, no file is
     * read. A server that has not switched the overrides on behaves as it did before they
     * existed, and {@code AgenticUiConfigComponentTest} asserts that by writing a fragment into
     * the directory and showing the response byte for byte identical.
     */
    private ConfigSnapshot packagedSnapshot() {
        ConfigSnapshot current = snapshot;
        if (current == null) {
            synchronized (this) {
                current = snapshot;
                if (current == null) {
                    current = ConfigSnapshot.build(registry.resolve());
                    report(current);
                    snapshot = current;
                }
            }
        }
        return current;
    }

    /**
     * The same snapshot with the override directory's fragments appended, rebuilt whenever the
     * directory has changed since the cached one was built.
     *
     * The scan is a directory walk reading names, sizes and modification times — it reads no
     * body, so an unchanged directory costs one walk and returns the cached instance. Returning
     * the <em>same instance</em> is what keeps the servlet's rendered bodies and their ETags
     * alive across requests: {@link AgenticUiConfigServlet} re-renders only when the snapshot
     * identity changes, so an unchanged override directory still answers 304, and a changed one
     * gets a new ETag and therefore a fresh body in the browser rather than a cached one.
     */
    private ConfigSnapshot overriddenSnapshot(DevOverrides active) {
        DevOverrides.Scan scan = active.scan();
        synchronized (this) {
            ConfigSnapshot current = snapshot;
            if (current != null && scan.stamp().equals(overrideStamp)) {
                return current;
            }
            current = ConfigSnapshot.build(registry.resolve(scan.contributions(), scan.diagnostics()));
            report(current);
            snapshot = current;
            overrideStamp = scan.stamp();
            return current;
        }
    }

    private static void report(ConfigSnapshot snapshot) {
        for (Diagnostic diagnostic : snapshot.diagnostics()) {
            switch (diagnostic.level()) {
            case ERROR -> log.error("Agentic UI configuration: {}", diagnostic.message());
            case WARNING -> log.warn("Agentic UI configuration: {}", diagnostic.message());
            default -> log.info("Agentic UI configuration: {}", diagnostic.message());
            }
        }
    }

    private static String source(String src) {
        return src != null && !src.isBlank() ? src : Provenance.INLINE;
    }

    /**
     * The body of a contribution, read when the snapshot is built: from the contributing bundle for
     * {@code src}, which is where the package that declared it ships it, or the inline JSON.
     */
    private static Contribution.Content content(RuntimeContext context, String src, String json) {
        boolean hasSrc = src != null && !src.isBlank();
        boolean hasJson = json != null && !json.isBlank();
        if (hasSrc && hasJson) {
            return () -> {
                throw new IOException("it has both a src and inline JSON; use one");
            };
        }
        if (hasJson) {
            byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            return () -> bytes;
        }
        if (!hasSrc) {
            return null;
        }
        return () -> {
            URL url = context.getLocalResource(src);
            if (url == null) {
                throw new FileNotFoundException(src + " is not in the contributing bundle");
            }
            try (InputStream in = url.openStream()) {
                return in.readNBytes(ConfigSnapshot.MAX_ASSET_BYTES + 1);
            }
        };
    }
}
