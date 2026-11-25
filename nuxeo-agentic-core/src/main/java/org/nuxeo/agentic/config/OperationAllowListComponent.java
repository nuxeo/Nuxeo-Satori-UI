package org.nuxeo.agentic.config;

import java.util.LinkedHashMap;
import java.util.Map;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.automation.AutomationService;
import org.nuxeo.ecm.automation.OperationContext;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.DefaultComponent;

/**
 * Holds this server's allow-list of the operations an app's buttons may run
 * ({@code org.nuxeo.agentic.ui.operations}), and runs them.
 *
 * An entry is registered only once {@link AllowedOperation#of} accepts it; one that does not is
 * logged and left out, and an entry registered earlier with the same id stays. A later valid
 * contribution with the same id replaces it whole, and {@code enabled="false"} removes it. Each
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

    @Override
    public void registerContribution(Object contribution, String extensionPoint, ComponentInstance contributor) {
        if (!XP_ALLOW_LIST.equals(extensionPoint) || !(contribution instanceof AllowedOperationDescriptor descriptor)) {
            log.warn("Unknown contribution to {}: {}", extensionPoint, contribution);
            return;
        }
        register(descriptor, contributor.getName().getName());
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
        AppRegistryEndpoint registry = AppRegistryEndpoint.current(config.getSnapshot(), allowList);
        return new AppActionRunner(registry, this::getAllowList, OperationAllowListComponent::automation).run(session,
                input, app, action, values);
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
