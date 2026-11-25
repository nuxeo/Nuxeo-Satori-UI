package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.Serializable;
import java.lang.reflect.Proxy;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.nuxeo.ecm.core.schema.DocumentType;
import org.nuxeo.ecm.core.schema.DocumentTypeImpl;
import org.nuxeo.ecm.core.schema.Namespace;
import org.nuxeo.ecm.core.schema.TypeProvider;
import org.nuxeo.ecm.core.schema.types.ComplexTypeImpl;
import org.nuxeo.ecm.core.schema.types.CompositeType;
import org.nuxeo.ecm.core.schema.types.CompositeTypeImpl;
import org.nuxeo.ecm.core.schema.types.ListTypeImpl;
import org.nuxeo.ecm.core.schema.types.Schema;
import org.nuxeo.ecm.core.schema.types.SchemaImpl;
import org.nuxeo.ecm.core.schema.types.SimpleTypeImpl;
import org.nuxeo.ecm.core.schema.types.constraints.Constraint;
import org.nuxeo.ecm.core.schema.types.primitives.LongType;
import org.nuxeo.ecm.core.schema.types.primitives.StringType;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The server's content model in the shape the model reader reads, written from the schema
 * manager's types, and read by the validator the server runs.
 */
class ServerContentModelTest {

    private static Constraint directory(String name) {
        return (Constraint) Proxy.newProxyInstance(Constraint.class.getClassLoader(), new Class<?>[] { Constraint.class },
                (proxy, method, args) -> switch (method.getName()) {
                case "getDescription" -> new Constraint.Description("directoryResolver",
                        Map.<String, Serializable> of("directory", name));
                case "hashCode" -> System.identityHashCode(proxy);
                case "equals" -> proxy == args[0];
                default -> throw new UnsupportedOperationException(method.getName());
                });
    }

    private static TypeProvider types() {
        SchemaImpl claim = new SchemaImpl("claim", new Namespace("http://example.com/claim", "claim"));
        claim.addField("number", StringType.INSTANCE, null, 0, List.of());
        claim.addField("status", StringType.INSTANCE, null, 0, List.of(directory("PayersClaimStatus")));
        claim.addField("amount", LongType.INSTANCE, null, 0, List.of());
        SimpleTypeImpl code = new SimpleTypeImpl(StringType.INSTANCE, "http://example.com/claim", "codeType");
        claim.addField("code", code, null, 0, List.of());
        claim.addField("tags", new ListTypeImpl("http://example.com/claim", "tagList", StringType.INSTANCE), null, 0,
                List.of());
        ComplexTypeImpl line = new ComplexTypeImpl(null, "http://example.com/claim", "line");
        line.addField("label", StringType.INSTANCE, null, 0, List.of());
        claim.addField("lines", new ListTypeImpl("http://example.com/claim", "lineList", line), null, 0, List.of());
        claim.addField("party", line, null, 0, List.of());
        ComplexTypeImpl content = new ComplexTypeImpl(null, "http://www.nuxeo.org/ecm/schemas/core/external-references/",
                "content");
        content.addField("name", StringType.INSTANCE, null, 0, List.of());
        claim.addField("scan", content, null, 0, List.of());
        SchemaImpl file = new SchemaImpl("file", new Namespace("http://www.nuxeo.org/ecm/schemas/file/", ""));
        file.addField("content", content, null, 0, List.of());
        SchemaImpl dublincore = new SchemaImpl("dublincore", new Namespace("http://www.nuxeo.org/dublincore/", "dc"));
        dublincore.addField("title", StringType.INSTANCE, null, 0, List.of());
        CompositeType tagged = new CompositeTypeImpl(null, "http://example.com/", "Tagged", List.of(claim));
        CompositeType marker = new CompositeTypeImpl(null, "http://example.com/", "Marker", List.of());
        DocumentType document = new DocumentTypeImpl("Document");
        DocumentType claimType = new DocumentTypeImpl("Claim", document, List.of(dublincore, claim), Set.of("Marker"),
                null);
        Schema[] schemas = { dublincore, claim, file };
        DocumentType[] doctypes = { claimType, document };
        CompositeType[] facets = { tagged, marker };
        return (TypeProvider) Proxy.newProxyInstance(TypeProvider.class.getClassLoader(),
                new Class<?>[] { TypeProvider.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getSchemas" -> schemas.clone();
                case "getDocumentTypes" -> doctypes.clone();
                case "getFacets" -> facets.clone();
                default -> throw new UnsupportedOperationException(method.getName());
                });
    }

    @Test
    void writesTypesFacetsAndSchemasAsTheRestApiDoes() {
        ObjectNode model = ServerContentModel.of(types());

        JsonNode claim = model.get("doctypes").get("Claim");
        assertEquals("Document", claim.get("parent").asText());
        assertEquals("[\"Marker\"]", claim.get("facets").toString());
        assertEquals("[\"claim\",\"dublincore\"]", claim.get("schemas").toString());
        assertEquals(ServerContentModel.NO_PARENT, model.get("doctypes").get("Document").get("parent").asText());

        JsonNode facets = model.get("facets");
        assertEquals("Marker", facets.get(0).get("name").asText());
        assertFalse(facets.get(0).has("schemas"));
        assertEquals("claim", facets.get(1).get("schemas").get(0).get("name").asText());

        JsonNode schemas = model.get("schemas");
        JsonNode claimSchema = schemas.get(0);
        assertEquals("claim", claimSchema.get("name").asText());
        assertEquals("claim", claimSchema.get("@prefix").asText());
        JsonNode fields = claimSchema.get("fields");
        assertEquals("string", fields.get("number").get("type").asText());
        assertEquals("long", fields.get("amount").get("type").asText());
        assertEquals("string", fields.get("code").get("type").asText());
        assertEquals("string[]", fields.get("tags").get("type").asText());
        assertEquals("PayersClaimStatus",
                fields.get("status").get("constraints").get(0).get("parameters").get("directory").asText());
        assertEquals("complex[]", fields.get("lines").get("type").asText());
        assertEquals("string", fields.get("lines").get("fields").get("label").get("type").asText());
        assertEquals("complex", fields.get("party").get("type").asText());
        assertEquals("blob", fields.get("scan").asText());
        JsonNode fileSchema = schemas.get(2);
        assertFalse(fileSchema.has("@prefix"));
        assertEquals("blob", fileSchema.get("fields").get("content").asText());
    }

    @Test
    void theValidatorTheServerRunsReadsItAndHoldsALayoutToIt() {
        ObjectNode model = ServerContentModel.of(types());
        DeploymentValidator validator = new NashornDeploymentValidator(() -> model, LayerFixtures.ON);
        ObjectNode layout = ConfigSnapshot.JSON.createObjectNode().put("version", 2);
        ObjectNode card = layout.putArray("cards").addObject().put("id", "main");
        card.putArray("fields").add("dc:title").add("claim:number").add("claim:status").add("claim:tags");

        assertTrue(validator.validate("layouts/Claim/view.layout.json", layout, null, null).passes());

        ((com.fasterxml.jackson.databind.node.ArrayNode) card.get("fields")).add("claim:nope");
        DeploymentValidator.Answer refused = validator.validate("layouts/Claim/view.layout.json", layout, null, null);
        assertTrue(refused.refused() == null && refused.findings().size() == 1, refused.toString());
        assertTrue(refused.findings().get(0).get("message").asText().contains("claim:nope"));
    }
}
