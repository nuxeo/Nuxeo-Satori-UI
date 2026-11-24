package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.ComponentName;
import org.nuxeo.runtime.model.RuntimeContext;

class AgenticUiConfigComponentTest {

    /** A contributor whose bundle holds one resource, which blocks until {@code release} opens. */
    private static ComponentInstance contributor(String name, URL resource, CountDownLatch reading,
            CountDownLatch release) {
        RuntimeContext context = (RuntimeContext) Proxy.newProxyInstance(RuntimeContext.class.getClassLoader(),
                new Class<?>[] { RuntimeContext.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getLocalResource" -> {
                    reading.countDown();
                    assertTrue(release.await(10, TimeUnit.SECONDS));
                    yield resource;
                }
                case "getBundle" -> null;
                default -> throw new UnsupportedOperationException(method.getName());
                });
        return (ComponentInstance) Proxy.newProxyInstance(ComponentInstance.class.getClassLoader(),
                new Class<?>[] { ComponentInstance.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getName" -> new ComponentName(name);
                case "getContext" -> context;
                default -> throw new UnsupportedOperationException(method.getName());
                });
    }

    private static FragmentDescriptor fragment(String name, String src, String json) {
        FragmentDescriptor fragment = new FragmentDescriptor();
        fragment.name = name;
        fragment.layer = ConfigScope.BOOTSTRAP;
        fragment.src = src;
        fragment.json = json;
        return fragment;
    }

    @Test
    void aContributionRegisteredDuringABuildIsInTheNextSnapshot(@TempDir Path dir) throws Exception {
        Path file = dir.resolve("ours.json");
        Files.writeString(file, "{\"branding\":{\"applicationTitle\":\"Hyland Nuxeo\"}}");
        CountDownLatch reading = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AgenticUiConfigComponent component = new AgenticUiConfigComponent();
        component.registerContribution(fragment("defaults", "ours.json", null), AgenticUiConfigComponent.XP_CONFIGURATION,
                contributor("ours", file.toUri().toURL(), reading, release));

        Thread build = new Thread(component::getSnapshot);
        build.start();
        assertTrue(reading.await(10, TimeUnit.SECONDS), "the build never read the fragment");
        Thread reload = new Thread(() -> component.registerContribution(fragment("acme", null, "{}"),
                AgenticUiConfigComponent.XP_CONFIGURATION, contributor("acme", null, new CountDownLatch(1),
                        new CountDownLatch(0))));
        reload.start();
        reload.join(200);
        release.countDown();
        build.join(10_000);
        reload.join(10_000);

        List<String> names = component.getSnapshot()
                                      .fragments(ConfigScope.BOOTSTRAP)
                                      .stream()
                                      .map(ConfigSnapshot.Fragment::name)
                                      .toList();
        assertEquals(List.of("defaults", "acme"), names);
    }

    /** A contributor whose bundle holds the files under {@code dir}, by their path in it. */
    private static ComponentInstance bundle(String name, Path dir, List<String> asked) {
        RuntimeContext context = (RuntimeContext) Proxy.newProxyInstance(RuntimeContext.class.getClassLoader(),
                new Class<?>[] { RuntimeContext.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getLocalResource" -> {
                    asked.add((String) args[0]);
                    Path file = dir.resolve((String) args[0]);
                    yield Files.isRegularFile(file) ? file.toUri().toURL() : null;
                }
                case "getBundle" -> null;
                default -> throw new UnsupportedOperationException(method.getName());
                });
        return (ComponentInstance) Proxy.newProxyInstance(ComponentInstance.class.getClassLoader(),
                new Class<?>[] { ComponentInstance.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getName" -> new ComponentName(name);
                case "getContext" -> context;
                default -> throw new UnsupportedOperationException(method.getName());
                });
    }

    @Test
    void anAppsFilesAreReadFromItsBundleBelowTheDirectoryThatHoldsItsAppJson(@TempDir Path dir) throws Exception {
        Path root = Files.createDirectories(dir.resolve("kit/agentic-ui-config/queues"));
        Files.writeString(root.resolve("../app.json"),
                TestContributions.appJson("payers-claims", "claims-adjusters"));
        Files.writeString(root.resolve("../home.json"), "{\"version\":2,\"cards\":[]}");
        Files.writeString(root.resolve("open.json"), "{\"version\":2}");
        // Beside the bundle's root, not below the app's: a path that climbed out would read this.
        Files.writeString(dir.resolve("kit/home.json"), "{\"wrong\":true}");
        AppDescriptor app = new AppDescriptor();
        app.id = "payers-claims";
        app.src = "kit/agentic-ui-config/app.json";
        app.files = List.of("home.json", "queues/open.json", "navigation.json");
        List<String> asked = new java.util.ArrayList<>();
        AgenticUiConfigComponent component = new AgenticUiConfigComponent();

        component.registerContribution(app, AgenticUiConfigComponent.XP_CONFIGURATION,
                bundle("nuxeo.config.payers", dir, asked));
        ConfigSnapshot snapshot = component.getSnapshot();

        assertEquals(List.of("kit/agentic-ui-config/app.json", "kit/agentic-ui-config/home.json",
                "kit/agentic-ui-config/queues/open.json", "kit/agentic-ui-config/navigation.json"), asked);
        assertEquals(1, snapshot.apps().size());
        ConfigSnapshot.App payers = snapshot.apps().get(0);
        assertEquals("nuxeo.config.payers", payers.provenance().component());
        assertEquals("kit/agentic-ui-config/app.json", payers.provenance().source());
        assertEquals(List.of("home.json", "queues/open.json"), List.copyOf(payers.files().keySet()));
        assertEquals("{\"version\":2,\"cards\":[]}", new String(payers.files().get("home.json").bytes()));
        // navigation.json is named and the bundle does not have it: left out, and said.
        assertEquals(List.of("unreadable"), snapshot.diagnostics().stream().map(Diagnostic::code).toList());
        assertEquals("apps/payers-claims", snapshot.diagnostics().get(0).scope());
        assertTrue(snapshot.diagnostics().get(0).message().contains("kit/agentic-ui-config/navigation.json"));

        component.unregisterContribution(app, AgenticUiConfigComponent.XP_CONFIGURATION, null);
        assertTrue(component.getSnapshot().apps().isEmpty());
    }
}
