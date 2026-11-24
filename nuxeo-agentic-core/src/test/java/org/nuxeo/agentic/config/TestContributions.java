package org.nuxeo.agentic.config;

import java.io.FileNotFoundException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Builders for contributions as the component would make them, without a running Nuxeo. */
final class TestContributions {

    private TestContributions() {
    }

    static Provenance from(String component) {
        return new Provenance(component, component + ".bundle", "agentic-ui-config/" + component + ".json");
    }

    /**
     * Provenance as the runtime gives it for our own packaged contributions: the component that
     * declares the defaults, inside the bundle that ships them.
     *
     * {@link #from} synthesises the bundle as {@code <component>.bundle}, so a contribution built
     * with it is never recognised as ours however the component is named — which is the point for
     * every other test here, and a trap for the ones about displacing a packaged default
     * (NXSAT-747). Use this builder for those, or the test exercises the customer-on-customer
     * branch and passes for the wrong reason.
     */
    static Provenance packaged() {
        return new Provenance("org.nuxeo.agentic.ui.config.defaults", Provenance.PACKAGED_BUNDLE,
                "agentic-ui-config/bootstrap.defaults.json");
    }

    static Contribution packagedFragment(String layer, String name, String body) {
        return Contribution.fragment(layer, name, true, packaged(), json(body), new Object());
    }

    static Contribution packagedLayout(String type, String mode, String body) {
        return Contribution.layout(type, mode, true, packaged(), json(body), new Object());
    }

    static Contribution.Content json(String body) {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        return () -> bytes;
    }

    static Contribution fragment(String component, String layer, String name, String body) {
        return Contribution.fragment(layer, name, true, from(component), json(body), new Object());
    }

    static Contribution disabledFragment(String component, String layer, String name) {
        return Contribution.fragment(layer, name, false, from(component), null, new Object());
    }

    static Contribution layout(String component, String type, String mode, String body) {
        return Contribution.layout(type, mode, true, from(component), json(body), new Object());
    }

    static Contribution asset(String component, String name, byte[] bytes) {
        return Contribution.asset(name, true, from(component), () -> bytes, new Object());
    }

    /** An {@code app.json} for {@code id}, for {@code groups}, as a package writes one. */
    static String appJson(String id, String... groups) {
        StringBuilder list = new StringBuilder();
        for (String group : groups) {
            list.append(list.isEmpty() ? "" : ",").append('"').append(group).append('"');
        }
        return "{\"version\":2,\"id\":\"" + id + "\",\"label\":\"" + id + "\",\"packageVersion\":\"1.0.0\","
                + "\"platform\":\">=0.1.0 <1.0.0\",\"groups\":[" + list + "]}";
    }

    /**
     * An app as a package contributes one: its {@code app.json} at {@code agentic-ui-config/app.json}
     * in the bundle, and each of {@code files} below it, read from the map. A path the map does not
     * hold is a file the bundle does not have, as {@code getLocalResource} answers {@code null}.
     */
    static Contribution app(String component, String id, String appJson, Map<String, String> files) {
        return app(component, id, "agentic-ui-config/app.json", appJson, List.copyOf(files.keySet()), files);
    }

    static Contribution app(String component, String id, String src, String appJson, List<String> paths,
            Map<String, String> bodies) {
        Map<String, byte[]> bytes = new LinkedHashMap<>();
        bodies.forEach((path, body) -> bytes.put(path, body.getBytes(StandardCharsets.UTF_8)));
        String root = src.substring(0, src.lastIndexOf('/') + 1);
        Contribution.Files reader = new Contribution.Files() {
            @Override
            public Contribution.Content file(String path) {
                return () -> {
                    byte[] body = bytes.get(path);
                    if (body == null) {
                        throw new FileNotFoundException(root + path + " is not in the contributing bundle");
                    }
                    return body;
                };
            }

            @Override
            public String source(String path) {
                return root + path;
            }
        };
        Provenance provenance = new Provenance(component, component + ".bundle", src);
        return Contribution.app(id, true, provenance, json(appJson), paths, reader, new Object());
    }

    static Contribution disabledApp(String component, String id) {
        return Contribution.app(id, false, new Provenance(component, component + ".bundle", Provenance.INLINE), null,
                List.of(), null, new Object());
    }
}
