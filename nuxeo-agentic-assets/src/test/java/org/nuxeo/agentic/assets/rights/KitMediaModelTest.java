/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.xml.parsers.DocumentBuilderFactory;

import org.junit.jupiter.api.Test;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * The test runtime's media model is the kit's: {@code MediaDeliveryTest} registers the kit's own
 * schemas, which the build copies, under types of its own, since the kit's component requires a
 * marker the test runtime does not have. Each type here has the kit's parent and schemas, in the
 * same order, and each schema the kit's prefix, so that a type changed in the kit and not here
 * fails.
 */
class KitMediaModelTest {

    static final Path KIT_MODEL = Path.of("..", "business-apps", "packages", "media-demo", "bundle", "OSGI-INF",
            "media-demo-model.xml");

    private static org.w3c.dom.Document parse(byte[] xml) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        return factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml));
    }

    /** Each doctype: its parent, then its schemas, in order. */
    private static Map<String, List<String>> doctypes(org.w3c.dom.Document xml) {
        Map<String, List<String>> types = new LinkedHashMap<>();
        NodeList doctypes = xml.getElementsByTagName("doctype");
        for (int i = 0; i < doctypes.getLength(); i++) {
            Element doctype = (Element) doctypes.item(i);
            List<String> shape = new java.util.ArrayList<>();
            shape.add("extends " + doctype.getAttribute("extends"));
            NodeList schemas = doctype.getElementsByTagName("schema");
            for (int j = 0; j < schemas.getLength(); j++) {
                shape.add(((Element) schemas.item(j)).getAttribute("name"));
            }
            types.put(doctype.getAttribute("name"), shape);
        }
        return types;
    }

    /** Each schema the component registers, by name: its prefix and its file's name. */
    private static Map<String, String> schemas(org.w3c.dom.Document xml) {
        Map<String, String> schemas = new LinkedHashMap<>();
        NodeList all = xml.getElementsByTagName("schema");
        for (int i = 0; i < all.getLength(); i++) {
            Element schema = (Element) all.item(i);
            if (schema.hasAttribute("src")) {
                String src = schema.getAttribute("src");
                schemas.put(schema.getAttribute("name"),
                        schema.getAttribute("prefix") + " " + src.substring(src.lastIndexOf('/') + 1));
            }
        }
        return schemas;
    }

    @Test
    void theTestRuntimesMediaModelIsTheKits() throws Exception {
        assertTrue(Files.isRegularFile(KIT_MODEL), KIT_MODEL + " is where the kit keeps its model");
        org.w3c.dom.Document kit = parse(Files.readAllBytes(KIT_MODEL));
        org.w3c.dom.Document test;
        try (InputStream in = KitMediaModelTest.class.getClassLoader()
                                                     .getResourceAsStream("OSGI-INF/test-media-model-contrib.xml")) {
            test = parse(in.readAllBytes());
        }
        assertEquals(doctypes(kit), doctypes(test));
        assertEquals(schemas(kit), schemas(test));
        for (String file : List.of("film.xsd", "filmversion.xsd")) {
            try (InputStream in = KitMediaModelTest.class.getClassLoader().getResourceAsStream("schemas/kit/" + file)) {
                assertTrue(in != null, file + " is copied from the kit by the build");
                assertEquals(Files.readString(KIT_MODEL.getParent().resolveSibling("schemas").resolve(file)),
                        new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8), file);
            }
        }
    }
}
