package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.nuxeo.agentic.config.ActionFixtures.REQUEST_RECORDS;
import static org.nuxeo.agentic.config.ActionFixtures.requestRecords;

import java.lang.reflect.Proxy;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.nuxeo.ecm.automation.AutomationService;
import org.nuxeo.ecm.automation.OperationNotFoundException;
import org.nuxeo.ecm.automation.OperationType;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.ComponentName;
import org.nuxeo.runtime.model.RuntimeContext;

/** How contributions make the allow-list, and that each change publishes a new one. */
class OperationAllowListComponentTest {

    @Test
    void allowsNothingUntilTheDeploymentContributes() {
        assertSame(AllowList.EMPTY, new OperationAllowListComponent().getAllowList());
        assertNull(AllowList.EMPTY.get(REQUEST_RECORDS));
    }

    @Test
    void aContributionAllowsItsOperationAndPublishesANewList() {
        OperationAllowListComponent component = new OperationAllowListComponent();
        AllowList before = component.getAllowList();
        component.register(requestRecords(), "deployment");
        AllowList after = component.getAllowList();
        assertNotSame(before, after);
        assertEquals("Write", after.get(REQUEST_RECORDS).permission());
        // The list a reader holds does not change under it.
        assertNull(before.get(REQUEST_RECORDS));
    }

    @Test
    void anEntryThatFailsACheckIsLeftOutAndTakesTheOneBeforeWithIt() {
        OperationAllowListComponent component = new OperationAllowListComponent();
        component.register(requestRecords(), "deployment");
        // Meant to narrow the entry to supervisors, with a typo: the wider one must not stay.
        AllowedOperationDescriptor broken = requestRecords();
        broken.groups = new java.util.ArrayList<>(List.of(" claims-supervisors"));
        component.register(broken, "later");
        assertNull(component.getAllowList().get(REQUEST_RECORDS));

        // One that fails a check for an id nobody allowed changes nothing.
        component.register(requestRecords(), "deployment");
        AllowList before = component.getAllowList();
        AllowedOperationDescriptor other = requestRecords();
        other.id = "Payers.Other";
        other.permission = "not a permission";
        component.register(other, "later");
        assertSame(before, component.getAllowList());
    }

    /** A component as the runtime hands one over, deployed in {@code context}. */
    private static ComponentInstance contributor(String name, RuntimeContext context) {
        return (ComponentInstance) Proxy.newProxyInstance(OperationAllowListComponentTest.class.getClassLoader(),
                new Class<?>[] { ComponentInstance.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getName" -> new ComponentName(name);
                case "getContext" -> context;
                case "toString" -> name;
                case "hashCode" -> System.identityHashCode(proxy);
                case "equals" -> proxy == args[0];
                default -> throw new UnsupportedOperationException(method.getName());
                });
    }

    private static RuntimeContext context(String bundle) {
        return (RuntimeContext) Proxy.newProxyInstance(OperationAllowListComponentTest.class.getClassLoader(),
                new Class<?>[] { RuntimeContext.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getBundle" -> null;
                case "toString" -> bundle;
                case "hashCode" -> System.identityHashCode(proxy);
                case "equals" -> proxy == args[0];
                default -> throw new UnsupportedOperationException(method.getName());
                });
    }

    @Test
    void takesAContributionOnlyFromTheServersConfigurationDirectory() {
        RuntimeContext configuration = context("the runtime's own, which deploys nxserver/config/");
        OperationAllowListComponent component = new OperationAllowListComponent();
        component.configuration = () -> configuration;

        // A package's bundle, which the pipeline would refuse, and the server refuses too.
        component.registerContribution(requestRecords(), "allowList",
                contributor("nuxeo.config.payers-claims-demo.operations", context("a package's bundle")));
        assertNull(component.getAllowList().get(REQUEST_RECORDS));
        // And a disabled entry from one, which would remove the deployment's.
        component.registerContribution(requestRecords(), "allowList",
                contributor("payers-claims-demo.deployment.operations", configuration));
        AllowedOperationDescriptor off = new AllowedOperationDescriptor();
        off.id = REQUEST_RECORDS;
        off.enabled = false;
        component.registerContribution(off, "allowList", contributor("a.package", context("another bundle")));
        assertEquals("Write", component.getAllowList().get(REQUEST_RECORDS).permission());

        // With no runtime, nothing is the configuration directory's.
        OperationAllowListComponent bare = new OperationAllowListComponent();
        bare.configuration = () -> null;
        bare.registerContribution(requestRecords(), "allowList", contributor("x", configuration));
        assertNull(bare.getAllowList().get(REQUEST_RECORDS));
    }

    @Test
    void aLaterOneReplacesItWholeAndDisabledRemovesIt() {
        OperationAllowListComponent component = new OperationAllowListComponent();
        component.register(requestRecords(), "deployment");
        AllowedOperationDescriptor narrower = requestRecords();
        narrower.parameters.clear();
        narrower.permission = "ReadWrite";
        component.register(narrower, "later");
        AllowedOperation replaced = component.getAllowList().get(REQUEST_RECORDS);
        assertEquals("ReadWrite", replaced.permission());
        assertEquals(List.of(), List.copyOf(replaced.parameters().keySet()));

        AllowedOperationDescriptor off = new AllowedOperationDescriptor();
        off.id = REQUEST_RECORDS;
        off.enabled = false;
        component.register(off, "last");
        assertNull(component.getAllowList().get(REQUEST_RECORDS));
    }

    @Test
    void unregisteringAContributionThatWasReplacedKeepsTheReplacement() {
        OperationAllowListComponent component = new OperationAllowListComponent();
        AllowedOperationDescriptor first = requestRecords();
        AllowedOperationDescriptor second = requestRecords();
        second.permission = "ReadWrite";
        component.register(first, "deployment");
        component.register(second, "later");
        component.unregister(first);
        assertEquals("ReadWrite", component.getAllowList().get(REQUEST_RECORDS).permission());
        component.unregister(second);
        assertNull(component.getAllowList().get(REQUEST_RECORDS));
    }

    /** An Automation whose registry holds {@code types}, each id under the class it runs. */
    private static AutomationService automation(Map<String, Class<?>> types) {
        ClassLoader loader = OperationAllowListComponentTest.class.getClassLoader();
        return (AutomationService) Proxy.newProxyInstance(loader, new Class<?>[] { AutomationService.class },
                (proxy, method, args) -> {
                    if (!method.getName().equals("getOperation")) {
                        throw new UnsupportedOperationException(method.getName());
                    }
                    Class<?> type = types.get((String) args[0]);
                    if (type == null) {
                        throw new OperationNotFoundException((String) args[0]);
                    }
                    return Proxy.newProxyInstance(loader, new Class<?>[] { OperationType.class },
                            (operation, called, none) -> {
                                if (!called.getName().equals("getType")) {
                                    throw new UnsupportedOperationException(called.getName());
                                }
                                return type;
                            });
                });
    }

    @Test
    void thePlatformIsIntactOnlyWhileBothItsOperationsAreItsOwn() {
        assertTrue(OperationAllowListComponent.ours(automation(Map.of(RunAppActionOperation.ID,
                RunAppActionOperation.class, RequireRunActionOperation.ID, RequireRunActionOperation.class))));
        // A chain, a scripted operation or an alias registered later under either id runs another class.
        assertFalse(OperationAllowListComponent.ours(automation(Map.of(RunAppActionOperation.ID, Object.class,
                RequireRunActionOperation.ID, RequireRunActionOperation.class))));
        assertFalse(OperationAllowListComponent.ours(automation(Map.of(RunAppActionOperation.ID,
                RunAppActionOperation.class, RequireRunActionOperation.ID, Object.class))));
        assertFalse(OperationAllowListComponent.ours(automation(Map.of(RunAppActionOperation.ID,
                RunAppActionOperation.class))));
        assertFalse(OperationAllowListComponent.ours(null));
    }
}
