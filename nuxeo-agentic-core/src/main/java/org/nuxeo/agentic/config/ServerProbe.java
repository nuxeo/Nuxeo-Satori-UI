package org.nuxeo.agentic.config;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Properties;
import java.util.Set;
import java.util.stream.Collectors;

import org.nuxeo.ecm.automation.AutomationService;
import org.nuxeo.ecm.automation.OperationType;
import org.nuxeo.ecm.core.schema.SchemaManager;
import org.nuxeo.runtime.api.Framework;

/**
 * What the diagnostics page reads of the server beyond the configuration ({@link DiagnosticsReport}):
 * a property, whether a facet is registered, the operations Automation has, the package manager's
 * directory and this bundle's own build. Read only; an interface so that the report is tested
 * without a running Nuxeo, and {@link #live} is the server's.
 */
interface ServerProbe {

    /** The server property, or {@code null}. Only those the report names are read. */
    String property(String name);

    /** Whether the server's schema manager has the facet, which is how an add-on is known to be there. */
    boolean hasFacet(String name);

    /** The ids of the operations and chains Automation has; empty when it is not running. */
    Set<String> operations();

    /** The package manager's directory, {@code nuxeo.mp.dir}, or {@code null}. */
    Path packagesDirectory();

    /** This bundle's build version, from the Maven descriptor in its jar, or {@code null}. */
    String coreVersion();

    /** Whether the operation allow-list's component is there and its operations are still this module's. */
    boolean allowListIntact();

    /** How many operations the allow-list in force lets an app's buttons run. */
    int allowListSize();

    /** The package manager's directory property. */
    String PACKAGES_PROPERTY = "nuxeo.mp.dir";

    /** The server's own: Nuxeo's {@code configuration.properties} carries both. */
    String PRODUCT_NAME_PROPERTY = "org.nuxeo.ecm.product.name";

    String PRODUCT_VERSION_PROPERTY = "org.nuxeo.ecm.product.version";

    String CORE_DESCRIPTOR = "/META-INF/maven/org.nuxeo.agentic/nuxeo-agentic-core/pom.properties";

    /** The running server's. */
    static ServerProbe live() {
        return new ServerProbe() {
            @Override
            public String property(String name) {
                return Framework.getProperty(name);
            }

            @Override
            public boolean hasFacet(String name) {
                SchemaManager schemas = Framework.getService(SchemaManager.class);
                return schemas != null && schemas.getFacet(name) != null;
            }

            @Override
            public Set<String> operations() {
                AutomationService automation = Framework.getService(AutomationService.class);
                if (automation == null) {
                    return Set.of();
                }
                return Arrays.stream(automation.getOperations()).map(OperationType::getId).collect(Collectors.toSet());
            }

            @Override
            public Path packagesDirectory() {
                String directory = Framework.getProperty(PACKAGES_PROPERTY);
                return directory == null || directory.isBlank() ? null : Path.of(directory);
            }

            @Override
            public String coreVersion() {
                try (InputStream in = ServerProbe.class.getResourceAsStream(CORE_DESCRIPTOR)) {
                    if (in == null) {
                        return null;
                    }
                    Properties descriptor = new Properties();
                    descriptor.load(in);
                    return descriptor.getProperty("version");
                } catch (IOException e) {
                    return null;
                }
            }

            @Override
            public boolean allowListIntact() {
                OperationAllowListService service = Framework.getService(OperationAllowListService.class);
                return service != null && service.intact();
            }

            @Override
            public int allowListSize() {
                return AgenticUiAppsServlet.allowList().operations().size();
            }
        };
    }
}
