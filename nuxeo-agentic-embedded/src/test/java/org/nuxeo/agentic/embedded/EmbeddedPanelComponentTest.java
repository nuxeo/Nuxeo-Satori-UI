package org.nuxeo.agentic.embedded;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.ComponentName;
import org.nuxeo.runtime.model.RuntimeContext;

/** Which contributions register a host, and what a refused or removed one does to the host before it. */
class EmbeddedPanelComponentTest {

    private static final RuntimeContext CONFIGURATION = context();

    private static final RuntimeContext A_BUNDLE = context();

    private EmbeddedPanelComponent component;

    @BeforeEach
    void setUp() {
        component = new EmbeddedPanelComponent();
        component.configuration = () -> CONFIGURATION;
    }

    private static RuntimeContext context() {
        return (RuntimeContext) Proxy.newProxyInstance(EmbeddedPanelComponentTest.class.getClassLoader(),
                new Class<?>[] { RuntimeContext.class }, (self, call, args) -> switch (call.getName()) {
                case "getBundle" -> null;
                case "hashCode" -> System.identityHashCode(self);
                case "equals" -> self == args[0];
                default -> throw new UnsupportedOperationException(call.getName());
                });
    }

    private static ComponentInstance contributor(RuntimeContext context) {
        return (ComponentInstance) Proxy.newProxyInstance(EmbeddedPanelComponentTest.class.getClassLoader(),
                new Class<?>[] { ComponentInstance.class }, (self, call, args) -> switch (call.getName()) {
                case "getName" -> new ComponentName("nuxeo.config.crm-host");
                case "getContext" -> context;
                default -> throw new UnsupportedOperationException(call.getName());
                });
    }

    @Test
    void aHostIsTakenFromTheServersConfigurationOnly() {
        component.registerContribution(Fixtures.descriptor(), "hosts", contributor(A_BUNDLE));
        assertNull(component.getHost("crm"), "a package's bundle registers no host");

        component.registerContribution(Fixtures.descriptor(), "hosts", contributor(CONFIGURATION));
        assertNotNull(component.getHost("crm"));
    }

    @Test
    void aRefusedReplacementTakesTheEarlierHostOutWithIt() {
        component.register(Fixtures.descriptor(), "first");
        HostDescriptor broken = Fixtures.descriptor();
        broken.origins = new ArrayList<>(List.of("http://crm.example.com"));
        component.register(broken, "second");
        assertNull(component.getHost("crm"));
    }

    @Test
    void aLaterContributionReplacesTheHostWholeAndDisabledRemovesIt() {
        component.register(Fixtures.descriptor(), "first");
        HostDescriptor narrower = Fixtures.descriptor();
        narrower.tokenLifetime = "60";
        component.register(narrower, "second");
        assertEquals(60, component.getHost("crm").tokenLifetime());

        HostDescriptor disabled = new HostDescriptor();
        disabled.id = "crm";
        disabled.enabled = false;
        component.register(disabled, "third");
        assertNull(component.getHost("crm"));
    }

    @Test
    void unregisteringAnotherContributionKeepsTheHost() {
        HostDescriptor first = Fixtures.descriptor();
        component.register(first, "first");
        component.unregister(Fixtures.descriptor());
        assertNotNull(component.getHost("crm"));
        component.unregister(first);
        assertNull(component.getHost("crm"));
    }

    @Test
    void notStartedItRefusesAPanelsTokenAndPassesAnythingElse() {
        Fixtures.RecordingCodec tokens = new Fixtures.RecordingCodec(Fixtures.properties(Fixtures.host()), Fixtures.clock(Fixtures.NOW));
        String token = tokens.issue(new TokenCodec.Grant("crm", "jsmith", "read", "t-1", Fixtures.NOW,
                300));
        PanelTokenGuard.Request panel = new PanelTokenGuard.Request("GET", "api/v1/id/x", "/nuxeo/api/v1/id/x",
                "Bearer " + token, null, null, null, false);
        assertEquals(503, component.check(panel).status());
        PanelTokenGuard.Request other = new PanelTokenGuard.Request("GET", "api/v1/id/x", "/nuxeo/api/v1/id/x",
                "Basic dXNlcjpwYXNz", null, null, null, false);
        assertEquals(0, component.check(other).status());
        assertEquals(503, component.exchange("crm", "x", java.util.Map.of()).status());
    }
}
