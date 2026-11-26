/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.Serializable;
import java.io.StringWriter;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.io.marshallers.json.AbstractJsonWriter;
import org.nuxeo.ecm.core.io.marshallers.json.enrichers.AbstractJsonEnricher;
import org.nuxeo.ecm.core.io.marshallers.json.enrichers.Enriched;
import org.nuxeo.ecm.core.io.registry.context.RenderingContext;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * What the {@code assetRights} enricher writes under a policy with territories: where the asset
 * may be delivered, its windows when they are its own and not another document's, and a
 * download's decisions, which name no territory.
 */
class TerritoriesEnricherTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static JsonNode written(AssetRightsService service, DocumentModel document) throws Exception {
        AssetRightsJsonEnricher enricher = new AssetRightsJsonEnricher(() -> service);
        RenderingContext ctx = RenderingContext.CtxBuilder.param(AbstractJsonEnricher.ENTITY_ENRICHER_NAME,
                AssetRightsJsonEnricher.NAME).get();
        Field field = AbstractJsonWriter.class.getDeclaredField("ctx");
        field.setAccessible(true);
        field.set(enricher, ctx);
        StringWriter out = new StringWriter();
        try (JsonGenerator jg = new JsonFactory(JSON).createGenerator(out)) {
            jg.writeStartObject();
            enricher.write(new Enriched<>(document), jg);
            jg.writeEndObject();
        }
        return JSON.readTree(out.toString());
    }

    private static RightsPolicyDescriptor policy(String windows) throws Exception {
        String component = """
                <component name="test">
                  <extension target="org.nuxeo.agentic.assets.rights" point="policies">
                    <policy type="FilmVersion">
                      <rightsEnd xpath="dc:expired" />
                      <channels xpath="fver:channels" />
                      <territories xpath="fver:territories" />
                      %s
                      <original xpath="files:files/0/file" channel="SVOD" />
                      <blob xpath="files:files/2/file" channel="Marketing" />
                      <rendition name="thumbnail" preview="true" />
                    </policy>
                  </extension>
                </component>
                """.formatted(windows);
        return RightsPolicyTest.contributed(component.getBytes(StandardCharsets.UTF_8)).get(0);
    }

    private static ArrayList<Map<String, Serializable>> windows() {
        Map<String, Serializable> svod = new HashMap<>();
        svod.put("territory", "FR");
        svod.put("channel", "SVOD");
        svod.put("from", Fakes.midnightUtc("2026-11-01"));
        svod.put("until", Fakes.midnightUtc("2027-04-30"));
        return new ArrayList<>(List.of(svod));
    }

    private static DocumentModel version() {
        Fakes.Doc version = Fakes.asset();
        version.type = "FilmVersion";
        version.schemas.clear();
        version.schemas.add("filmversion");
        version.rightsEnd("2027-12-31");
        version.properties.put("fver:channels", new String[] { "SVOD", "Marketing" });
        version.properties.put("fver:territories", new String[] { "FR", "BE" });
        version.properties.put("fver:film", "film-id");
        version.properties.put("film:windows", windows());
        return version.model();
    }

    /** The film's windows decide, and are not written: the version's reader may not read the film. */
    @Test
    void windowsReadFromAnotherDocumentDecideAndAreNotWritten() throws Exception {
        AssetRightsComponent component = new AssetRightsComponent(Fakes.CLOCK, document -> document,
                (container, types) -> false, (asset, policy) -> windows());
        component.register(policy("<windows xpath=\"film:windows\" document=\"fver:film\" />"), "test");

        assertEquals(JSON.readTree("""
                { "assetRights": {
                    "type": "FilmVersion",
                    "today": "2026-11-24",
                    "rightsEnd": "2027-12-31",
                    "ended": false,
                    "channels": ["SVOD", "Marketing"],
                    "territories": ["FR", "BE"],
                    "windows": null,
                    "uses": [
                      { "use": "original", "name": null, "allowed": true, "reason": "cleared", "channel": "SVOD" },
                      { "use": "rendition", "name": "thumbnail", "allowed": true, "reason": "preview" },
                      { "use": "blob", "name": "files:files/2/file", "allowed": false, "reason": "outside-window", "channel": "Marketing" }
                    ],
                    "otherwise": { "allowed": false, "reason": "not-cleared" }
                } }
                """), written(component, version()));
    }

    /** The asset's own windows are written, each with its territory, channel and days. */
    @Test
    void theAssetsOwnWindowsAreWritten() throws Exception {
        AssetRightsComponent component = Fakes.component(policy("<windows xpath=\"film:windows\" />"));
        JsonNode rights = written(component, version()).get("assetRights");
        assertEquals(JSON.readTree("""
                [ { "territory": "FR", "channel": "SVOD", "from": "2026-11-01", "until": "2027-04-30" } ]
                """), rights.get("windows"));
        assertEquals(JSON.readTree("[\"FR\", \"BE\"]"), rights.get("territories"));
    }
}
