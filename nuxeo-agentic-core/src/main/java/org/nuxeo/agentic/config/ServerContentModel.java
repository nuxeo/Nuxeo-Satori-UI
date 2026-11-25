package org.nuxeo.agentic.config;

import java.io.Serializable;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import org.nuxeo.ecm.core.schema.DocumentType;
import org.nuxeo.ecm.core.schema.TypeProvider;
import org.nuxeo.ecm.core.schema.types.ComplexType;
import org.nuxeo.ecm.core.schema.types.CompositeType;
import org.nuxeo.ecm.core.schema.types.Field;
import org.nuxeo.ecm.core.schema.types.ListType;
import org.nuxeo.ecm.core.schema.types.Schema;
import org.nuxeo.ecm.core.schema.types.PrimitiveType;
import org.nuxeo.ecm.core.schema.types.Type;
import org.nuxeo.ecm.core.schema.types.constraints.Constraint;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The server's content model, {@code { doctypes, facets, schemas }}, in the shape the app
 * definition's model reader reads ({@code libs/shared/app-definition/src/lib/content-model.ts}):
 * what the designer reads from {@code /api/v1/config/types}, {@code /config/facets} and
 * {@code /config/schemas/<name>} with {@code fetch-schema: fields}, written here from the schema
 * manager rather than through the REST API, as the REST API's writers write it.
 *
 * Transcribed from {@code SchemaJsonWriter} in {@code nuxeo-core-io-2025.10.18.jar}, read with
 * {@code javap} from the local server's {@code nxserver/bundles}, read only:
 * <ul>
 * <li>a schema is {@code name}, {@code @prefix} and {@code prefix} when it has one, and its
 * {@code fields} by local name;</li>
 * <li>a field of the complex type {@code content} is {@code "blob"}, and a list of them
 * {@code "blob[]"}; any other complex field is {@code { "type": "complex", "fields" }}, and a list
 * of them {@code { "type": "complex[]", "fields" }};</li>
 * <li>any other field is {@code { "type" }}, the name of the first primitive type among its type
 * and its super types, and {@code []} after it for a list; with its
 * {@code constraints}, and a list's item's as {@code itemConstraints}.</li>
 * </ul>
 * Only the constraints the reader reads are written: a directory a {@code directoryResolver} binds
 * the value to. A type's {@code parent} is its super type, or {@code None!!!} for one with none, as
 * {@code DocumentTypesWriter} writes it.
 */
final class ServerContentModel {

    static final String NO_PARENT = "None!!!";

    static final String DIRECTORY_RESOLVER = "directoryResolver";

    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;

    private ServerContentModel() {
    }

    static ObjectNode of(TypeProvider types) {
        ObjectNode model = NODES.objectNode();
        ObjectNode doctypes = model.putObject("doctypes");
        DocumentType[] documentTypes = types.getDocumentTypes();
        Arrays.sort(documentTypes, Comparator.comparing(DocumentType::getName));
        for (DocumentType type : documentTypes) {
            ObjectNode entry = doctypes.putObject(type.getName());
            Type parent = type.getSuperType();
            entry.put("parent", parent == null ? NO_PARENT : parent.getName());
            ArrayNode facets = entry.putArray("facets");
            new TreeSet<>(type.getFacets()).forEach(facets::add);
            ArrayNode schemas = entry.putArray("schemas");
            String[] names = type.getSchemaNames().clone();
            Arrays.sort(names);
            for (String name : names) {
                schemas.add(name);
            }
        }
        ArrayNode facets = model.putArray("facets");
        CompositeType[] facetTypes = types.getFacets();
        Arrays.sort(facetTypes, Comparator.comparing(CompositeType::getName));
        for (CompositeType facet : facetTypes) {
            ObjectNode entry = facets.addObject().put("name", facet.getName());
            if (facet.hasSchemas()) {
                ArrayNode brought = entry.putArray("schemas");
                facet.getSchemas()
                     .stream()
                     .sorted(Comparator.comparing(Schema::getName))
                     .forEach(schema -> brought.add(schema(schema)));
            }
        }
        ArrayNode schemas = model.putArray("schemas");
        Schema[] schemaTypes = types.getSchemas();
        Arrays.sort(schemaTypes, Comparator.comparing(Schema::getName));
        for (Schema schema : schemaTypes) {
            schemas.add(schema(schema));
        }
        return model;
    }

    static ObjectNode schema(Schema schema) {
        ObjectNode entry = NODES.objectNode().put("name", schema.getName());
        String prefix = schema.getNamespace() == null ? null : schema.getNamespace().prefix;
        if (prefix != null && !prefix.isBlank()) {
            entry.put("prefix", prefix);
            entry.put("@prefix", prefix);
        }
        fields(entry.putObject("fields"), schema);
        return entry;
    }

    private static void fields(ObjectNode into, ComplexType type) {
        type.getFields()
            .stream()
            .sorted(Comparator.comparing(field -> field.getName().getLocalName()))
            .forEach(field -> field(into, field));
    }

    private static void field(ObjectNode into, Field field) {
        String name = field.getName().getLocalName();
        Type type = field.getType();
        if (type.isListType()) {
            Type item = ((ListType) type).getFieldType();
            if (item.isComplexType()) {
                if ("content".equals(item.getName())) {
                    into.put(name, "blob[]");
                    return;
                }
                ObjectNode entry = into.putObject(name).put("type", "complex[]");
                fields(entry.putObject("fields"), (ComplexType) item);
                return;
            }
            ObjectNode entry = into.putObject(name).put("type", typeName(item) + "[]");
            constraints(entry, "constraints", field.getConstraints());
            constraints(entry, "itemConstraints", item.getConstraints());
            return;
        }
        if (type.isComplexType()) {
            if ("content".equals(type.getName())) {
                into.put(name, "blob");
                return;
            }
            ObjectNode entry = into.putObject(name).put("type", "complex");
            fields(entry.putObject("fields"), (ComplexType) type);
            return;
        }
        ObjectNode entry = into.putObject(name).put("type", typeName(type));
        constraints(entry, "constraints", field.getConstraints());
    }

    /**
     * A simple type's name, as the REST API writes it: the first primitive type among it and its
     * super types, so that a restricted string is {@code string}.
     */
    static String typeName(Type type) {
        Type current = type;
        while (current != null && !(current instanceof PrimitiveType)) {
            current = current.getSuperType();
        }
        return current == null ? type.getName() : current.getName();
    }

    private static void constraints(ObjectNode entry, String key, Set<Constraint> constraints) {
        if (constraints == null) {
            return;
        }
        ArrayNode list = null;
        for (Constraint constraint : constraints) {
            Constraint.Description description = constraint == null ? null : constraint.getDescription();
            if (description == null || !DIRECTORY_RESOLVER.equals(description.getName())) {
                continue;
            }
            Map<String, Serializable> parameters = description.getParameters();
            Serializable directory = parameters == null ? null : parameters.get("directory");
            if (directory == null) {
                continue;
            }
            if (list == null) {
                list = entry.putArray(key);
            }
            list.addObject()
                .put("name", DIRECTORY_RESOLVER)
                .putObject("parameters")
                .put("directory", directory.toString());
        }
    }
}
