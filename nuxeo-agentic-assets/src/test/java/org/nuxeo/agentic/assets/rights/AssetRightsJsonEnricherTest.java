package org.nuxeo.agentic.assets.rights;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.StringWriter;
import java.lang.reflect.Field;
import java.util.List;

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

/** What the {@code assetRights} enricher writes, through the entry point the marshaller registry calls. */
class AssetRightsJsonEnricherTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static JsonNode written(AssetRightsService service, DocumentModel document) throws Exception {
        AssetRightsJsonEnricher enricher = new AssetRightsJsonEnricher(() -> service);
        RenderingContext ctx = RenderingContext.CtxBuilder.param(AbstractJsonEnricher.ENTITY_ENRICHER_NAME,
                AssetRightsJsonEnricher.NAME).get();
        // The registry injects `ctx`; there is no registry here.
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

    @Test
    void anAssetWithNoPrintChannelIsExplainedUseByUse() throws Exception {
        DocumentModel noPrint = Fakes.asset().rightsEnd("2026-12-14").channels("E-commerce", "Social").model();

        JsonNode written = written(Fakes.component(Fakes.kitPolicy()), noPrint);

        assertEquals(JSON.readTree("""
                { "assetRights": {
                    "type": "AcmeAsset",
                    "today": "2026-11-24",
                    "rightsEnd": "2026-12-14",
                    "ended": false,
                    "channels": ["E-commerce", "Social"],
                    "uses": [
                      { "use": "original", "name": null, "allowed": false, "reason": "channel-not-covered", "channel": "Print" },
                      { "use": "view", "name": "Thumbnail", "allowed": true, "reason": "preview" },
                      { "use": "view", "name": "Small", "allowed": true, "reason": "preview" },
                      { "use": "view", "name": "Medium", "allowed": true, "reason": "preview" },
                      { "use": "view", "name": "FullHD", "allowed": true, "reason": "cleared", "channel": "E-commerce" },
                      { "use": "view", "name": "OriginalJpeg", "allowed": false, "reason": "channel-not-covered", "channel": "Print" },
                      { "use": "rendition", "name": "thumbnail", "allowed": true, "reason": "preview" },
                      { "use": "rendition", "name": "Thumbnail", "allowed": true, "reason": "preview" },
                      { "use": "rendition", "name": "Small", "allowed": true, "reason": "preview" },
                      { "use": "rendition", "name": "Medium", "allowed": true, "reason": "preview" },
                      { "use": "rendition", "name": "FullHD", "allowed": true, "reason": "cleared", "channel": "E-commerce" },
                      { "use": "rendition", "name": "OriginalJpeg", "allowed": false, "reason": "channel-not-covered", "channel": "Print" }
                    ],
                    "otherwise": { "allowed": false, "reason": "not-cleared" }
                } }
                """), written);
    }

    @Test
    void anEndedAssetSaysTheDayItsRightsEnded() throws Exception {
        DocumentModel ended = Fakes.asset().rightsEnd("2026-11-14").views("Medium", "OriginalJpeg").model();

        JsonNode rights = written(Fakes.component(Fakes.kitPolicy()), ended).get("assetRights");

        assertTrue(rights.get("ended").asBoolean());
        assertEquals(JSON.readTree("""
                { "use": "view", "name": "OriginalJpeg", "allowed": false, "reason": "rights-ended", "channel": "Print", "rightsEnd": "2026-11-14" }
                """), rights.get("uses").get(2));
        assertEquals("preview", rights.get("uses").get(1).get("reason").asText());
    }

    @Test
    void aDocumentNoPolicyCoversIsNull() throws Exception {
        Fakes.Doc file = Fakes.asset();
        file.type = "File";

        assertEquals(JSON.readTree("{ \"assetRights\": null }"), written(Fakes.component(Fakes.kitPolicy()), file.model()));
        assertEquals(JSON.readTree("{ \"assetRights\": null }"), written(null, Fakes.asset().model()));
    }

    /**
     * Rights it cannot read are explained as the permission decides them: each use that needs them
     * refused with policy-error, the previews still served, and any other use not cleared.
     */
    @Test
    void unreadableRightsRefuseTheUsesThatNeedThemAndNotThePreviews() throws Exception {
        Fakes.Doc unreadable = Fakes.asset();
        unreadable.properties.put("acmeasset:channels", 42);
        AssetRightsComponent component = Fakes.component(Fakes.kitPolicy());

        JsonNode rights = written(component, unreadable.model()).get("assetRights");

        assertTrue(rights.get("channels").isNull());
        for (JsonNode use : rights.get("uses")) {
            String name = use.get("name").asText();
            Use asked = "original".equals(use.get("use").asText()) ? Use.ORIGINAL
                    : "view".equals(use.get("use").asText()) ? Use.view(name) : Use.rendition(name);
            String served = component.decideDownload(unreadable.model(),
                    asked.kind() == Use.Kind.ORIGINAL ? "file:content"
                            : asked.kind() == Use.Kind.VIEW ? "picture:views/" + List.of("Thumbnail", "Small",
                                    "Medium", "FullHD", "OriginalJpeg").indexOf(name) + "/content" : null,
                    null, asked.kind() == Use.Kind.RENDITION ? name : null).decision().reason().code();
            assertEquals(served, use.get("reason").asText(), "as the permission decides it: " + use);
        }
        assertEquals("preview", rights.get("uses").get(3).get("reason").asText());
        assertEquals("policy-error", rights.get("uses").get(4).get("reason").asText());
        assertEquals("not-cleared", rights.get("otherwise").get("reason").asText());
    }

    /** A proxy's rights are its live document's: their fields and days are not written. */
    @Test
    void aProxyIsExplainedWithoutItsLiveDocumentsFields() throws Exception {
        Fakes.Doc proxy = Fakes.asset().rightsEnd("2026-11-14");
        proxy.proxy = true;

        JsonNode rights = written(Fakes.component(Fakes.kitPolicy()), proxy.model()).get("assetRights");

        assertTrue(rights.get("rightsEnd").isNull());
        assertTrue(rights.get("ended").isNull());
        assertTrue(rights.get("channels").isNull());
        JsonNode print = rights.get("uses").get(5);
        assertEquals("OriginalJpeg", print.get("name").asText());
        assertEquals("rights-ended", print.get("reason").asText());
        assertTrue(print.get("rightsEnd") == null, print::toString);
    }

    @Test
    void aDocumentWithNoPictureSchemaListsNoViews() throws Exception {
        Fakes.Doc noPicture = Fakes.asset();
        noPicture.schemas.remove("picture");

        JsonNode uses = written(Fakes.component(Fakes.kitPolicy()), noPicture.model()).get("assetRights").get("uses");

        for (JsonNode use : uses) {
            assertTrue(!"view".equals(use.get("use").asText()), use::toString);
        }
    }
}
