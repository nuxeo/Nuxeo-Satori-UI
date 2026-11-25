package org.nuxeo.agentic.config;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.automation.AutomationService;
import org.nuxeo.ecm.automation.OperationContext;
import org.nuxeo.ecm.automation.OperationNotFoundException;
import org.nuxeo.ecm.automation.server.AutomationServer;
import org.nuxeo.ecm.automation.server.RestBinding;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.DefaultComponent;
import org.nuxeo.runtime.model.RuntimeContext;

/**
 * Holds this server's allow-list of the operations an app's buttons may run
 * ({@code org.nuxeo.agentic.ui.operations}), and runs them.
 *
 * <b>Only from the server's configuration directory.</b> A contribution is taken only from a file in
 * {@code nxserver/config/}, which the runtime deploys in its own context
 * ({@code OSGiRuntimeService.loadConfig}, Nuxeo 2025.10.18): one from a bundle, a package's among
 * them, is refused and logged, whatever it says. So a package's own components cannot widen the
 * allow-list. A package can still write a file into {@code nxserver/config/} when it is installed,
 * through its {@code install.xml} or a deployment fragment: the package pipeline refuses both, and
 * one it did not build is checked by nothing but the administrators who install it.
 *
 * An entry is registered only once {@link AllowedOperation#of} accepts it. One that does not is
 * logged and left out, and takes an entry registered earlier with the same id out with it: a
 * contribution that meant to narrow an entry and failed a check must not leave the wider one in
 * force. A later valid contribution with the same id replaces it whole, and {@code enabled="false"}
 * removes it. Each
 * change publishes a new {@link AllowList}, so the app registry, which serves an app's
 * {@code actions.json} with only the actions it allows, and the run, which checks it again, read
 * one version whole.
 */
public class OperationAllowListComponent extends DefaultComponent implements OperationAllowListService {

    private static final Logger log = LogManager.getLogger(OperationAllowListComponent.class);

    static final String XP_ALLOW_LIST = "allowList";

    private final Map<String, AllowedOperation> operations = new LinkedHashMap<>();

    /** The descriptor each entry came from, so that unregistering another one keeps it. */
    private final Map<String, AllowedOperationDescriptor> sources = new LinkedHashMap<>();

    private volatile AllowList allowList = AllowList.EMPTY;

    /**
     * The context the runtime deploys the configuration directory's files in. Package-private for
     * tests, which have no runtime.
     */
    Supplier<RuntimeContext> configuration = () -> Framework.getRuntime() == null ? null
            : Framework.getRuntime().getContext();

    @Override
    public void registerContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        if (!XP_ALLOW_LIST.equals(extensionPoint) || !(contribution instanceof AllowedOperationDescriptor descriptor)) {
            log.warn("Unknown contribution to {}: {}", extensionPoint, contribution);
            return;
        }
        String component = contributor.getName().getName();
        RuntimeContext context = contributor.getContext();
        RuntimeContext expected = configuration.get();
        if (context == null || context != expected) {
            String bundle = context == null || context.getBundle() == null ? "no bundle"
                    : context.getBundle().getSymbolicName();
            log.error("Agentic UI allow-list: {}, from {}, is refused: the allow-list is the deployment's, and is "
                    + "read only from a file in nxserver/config/, never from a bundle", component, bundle);
            return;
        }
        register(descriptor, component);
    }

    /** Package-private for tests, which have no runtime to contribute through. */
    synchronized void register(AllowedOperationDescriptor descriptor, String component) {
        if (!descriptor.isEnabled()) {
            if (descriptor.getId() != null && operations.remove(descriptor.getId()) != null) {
                sources.remove(descriptor.getId());
                log.info("Agentic UI allow-list: {} removed by {}", descriptor.getId(), component);
                publish();
            }
            return;
        }
        AllowedOperation operation;
        try {
            operation = AllowedOperation.of(descriptor);
        } catch (IllegalArgumentException e) {
            log.error("Agentic UI allow-list: an operation contributed by {} is not allowed: {}", component,
                    e.getMessage());
            // Fail closed: an entry meant to replace one, a narrower one, takes the earlier one with it.
            if (descriptor.getId() != null && operations.remove(descriptor.getId()) != null) {
                sources.remove(descriptor.getId());
                log.error("Agentic UI allow-list: {} is removed, since the entry that replaced it is refused",
                        descriptor.getId());
                publish();
            }
            return;
        }
        operations.put(operation.id(), operation);
        sources.put(operation.id(), descriptor);
        log.info("Agentic UI allow-list: {} allowed by {}, for the {} permission{}", operation.id(), component,
                operation.permission(), operation.groups().isEmpty() ? "" : " and the groups " + operation.groups());
        publish();
    }

    @Override
    public void unregisterContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        if (contribution instanceof AllowedOperationDescriptor descriptor) {
            unregister(descriptor);
        }
    }

    synchronized void unregister(AllowedOperationDescriptor descriptor) {
        String id = descriptor.getId();
        if (id != null && sources.get(id) == descriptor) {
            sources.remove(id);
            operations.remove(id);
            publish();
        }
    }

    private void publish() {
        allowList = new AllowList(operations);
    }

    @Override
    public AllowList getAllowList() {
        return allowList;
    }

    @Override
    public AppActionRunner.Result runAction(CoreSession session, DocumentModel input, String app, String action,
            String values) {
        AgenticUiConfigService config = Framework.getService(AgenticUiConfigService.class);
        // The registry the servlet serves, its deployment layer included, so that the two share one.
        AppRegistryEndpoint registry = AppRegistryEndpoint.current(config.getSnapshot(), allowList,
                AgenticUiAppsServlet.layer().live());
        return new AppActionRunner(registry, this::getAllowList, OperationAllowListComponent::automation, PLATFORM)
                                                                                                         .run(session,
                                                                                                                 input,
                                                                                                                 app,
                                                                                                                 action,
                                                                                                                 values);
    }

    @Override
    public boolean intact() {
        return PLATFORM.intact();
    }

    /** The server's Automation, as {@link AppActionRunner} asks it. */
    static final AppActionRunner.Platform PLATFORM = new AppActionRunner.Platform() {
        @Override
        public boolean intact() {
            boolean intact = ours(Framework.getService(AutomationService.class));
            if (!intact) {
                log.error("Agentic UI: {} or {} is not nuxeo-agentic-core's operation on this server: a chain or an "
                        + "alias of its id replaced it. No app button runs, and none that runs an operation is served.",
                        RunAppActionOperation.ID, RequireRunActionOperation.ID);
            }
            return intact;
        }

        @Override
        public boolean bindingAdmits(String operation, NuxeoPrincipal principal) {
            AutomationServer server = Framework.getService(AutomationServer.class);
            if (server == null) {
                return true;
            }
            return admits(server.getOperationBinding(operation), principal)
                    && admits(server.getChainBinding(operation), principal);
        }
    };

    /**
     * Whether the server's Automation still runs this module's two operations under their ids: a
     * chain, a scripted operation or an alias registered later under either id replaces it.
     */
    static boolean ours(AutomationService automation) {
        return automation != null && isOurs(automation, RunAppActionOperation.ID, RunAppActionOperation.class)
                && isOurs(automation, RequireRunActionOperation.ID, RequireRunActionOperation.class);
    }

    private static boolean isOurs(AutomationService automation, String id, Class<?> type) {
        try {
            return automation.getOperation(id).getType() == type;
        } catch (OperationNotFoundException e) {
            return false;
        }
    }

    /**
     * Whether a REST binding lets {@code principal} run what it binds, as Nuxeo's Automation endpoint
     * decides ({@code AutomationServerComponent.accept}, Nuxeo 2025.10.18): not when it is disabled,
     * and, when it names administrators or groups, only for an administrator it allows or a member of
     * one of the groups. Its {@code secure} flag, HTTPS only, is the request's, not checked here.
     */
    static boolean admits(RestBinding binding, NuxeoPrincipal principal) {
        if (binding == null) {
            return true;
        }
        if (binding.isDisabled) {
            return false;
        }
        if (!binding.isAdministrator && !binding.hasGroups()) {
            return true;
        }
        if (binding.isAdministrator && principal.isAdministrator()) {
            return true;
        }
        if (binding.hasGroups()) {
            for (String group : binding.groups) {
                if (principal.isMemberOf(group)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Runs an operation as Automation runs a chain's step: in a context of its own, built here, never
     * the request's, so that nothing a request carries reaches the operation but its parameters.
     */
    private static Object automation(CoreSession session, DocumentModel input, String operation,
            Map<String, Object> parameters) throws Exception {
        try (OperationContext context = new OperationContext(session)) {
            context.setInput(input);
            return Framework.getService(AutomationService.class).run(context, operation, parameters);
        }
    }
}
