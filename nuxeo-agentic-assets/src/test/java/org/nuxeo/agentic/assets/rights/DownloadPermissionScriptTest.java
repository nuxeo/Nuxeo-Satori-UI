package org.nuxeo.agentic.assets.rights;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;

import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import javax.script.Invocable;
import javax.script.ScriptContext;
import javax.script.ScriptEngine;
import javax.script.ScriptEngineManager;
import javax.xml.parsers.DocumentBuilderFactory;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * The download permission as the platform runs it: the script this bundle contributes, evaluated
 * the way {@code DownloadServiceImpl.checkPermission} evaluates every permission in
 * {@code nuxeo-core-io-2025.10.18.jar}, with the engine Nuxeo LTS 2025 ships, nashorn-core 15.7.
 *
 * <p>From that method's bytecode: a new {@code ScriptEngineManager}'s engine for the permission's
 * language, {@code eval} of the script, then the seven globals put into the engine scope, then
 * {@code invokeFunction("run")}. A {@code java.lang.Boolean} {@code false} refuses the download
 * with 403. Anything else lets it through: {@code true}, a result that is not a {@code Boolean}
 * (logged), and a {@code ScriptException} (logged). So each case here checks that the result is a
 * {@code Boolean}, not just that it is false.
 */
class DownloadPermissionScriptTest {

    private static final String COMPONENT = "OSGI-INF/asset-rights-download-permission.xml";

    private final Supplier<AssetRightsService> original = AssetRightsDownloadPermission.service;

    @AfterEach
    void restore() {
        AssetRightsDownloadPermission.service = original;
    }

    /** The permission's element, as the bundle contributes it. */
    private static Element permission() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        try (InputStream in = DownloadPermissionScriptTest.class.getClassLoader().getResourceAsStream(COMPONENT)) {
            assertNotNull(in, COMPONENT);
            org.w3c.dom.Document xml = factory.newDocumentBuilder().parse(in);
            NodeList extensions = xml.getDocumentElement().getElementsByTagName("extension");
            assertEquals(1, extensions.getLength());
            Element extension = (Element) extensions.item(0);
            // download-service.xml in nuxeo-core-io 2025.10.18: the component and its point.
            assertEquals("org.nuxeo.ecm.core.io.download.DownloadService", extension.getAttribute("target"));
            assertEquals("permissions", extension.getAttribute("point"));
            NodeList permissions = extension.getElementsByTagName("permission");
            assertEquals(1, permissions.getLength());
            return (Element) permissions.item(0);
        }
    }

    private static String script() throws Exception {
        Element script = (Element) permission().getElementsByTagName("script").item(0);
        // DownloadPermissionDescriptor: "JavaScript" when the language is not given.
        String language = script.getAttribute("language");
        assertEquals("JavaScript", language.isEmpty() ? "JavaScript" : language);
        return script.getTextContent();
    }

    /** {@code checkPermission}'s steps, in its order, for one permission. */
    private static Object run(String script, Object document, String xpath, Object blob, String reason,
            String rendition) throws Exception {
        ScriptEngine engine = new ScriptEngineManager().getEngineByName("JavaScript");
        assertNotNull(engine, "no JavaScript engine: nashorn-core is not on the test classpath");
        engine.eval(script);
        Map<String, Object> context = new HashMap<>();
        Map<String, Object> infos = rendition == null ? Map.of() : Map.of("rendition", rendition);
        context.put("Document", document);
        context.put("XPath", xpath);
        context.put("Blob", blob);
        context.put("Reason", reason);
        context.put("Infos", infos);
        context.put("Rendition", infos.get("rendition"));
        context.put("CurrentUser", null);
        engine.getBindings(ScriptContext.ENGINE_SCOPE).putAll(context);
        return ((Invocable) engine).invokeFunction("run");
    }

    private static void useKitPolicy() {
        AssetRightsComponent component = Fakes.component(Fakes.kitPolicy());
        AssetRightsDownloadPermission.service = () -> component;
    }

    @Test
    void thePermissionHasTheNameItIsKnownBy() throws Exception {
        assertEquals("agenticAssetRights", permission().getAttribute("name"));
    }

    @Test
    void aRefusedUseAnswersBooleanFalse() throws Exception {
        useKitPolicy();
        DocumentModel noPrint = Fakes.asset().channels("E-commerce", "Social").model();

        assertSame(Boolean.FALSE, run(script(), noPrint, "picture:views/4/content", null, "download", null));
        assertSame(Boolean.FALSE, run(script(), noPrint, null, null, "rendition", "OriginalJpeg"));
        assertSame(Boolean.FALSE, run(script(), noPrint, "file:content", null, "download", null));
        assertSame(Boolean.FALSE, run(script(), noPrint, null, null, "rendition", "zipExport"));
    }

    @Test
    void aServedUseAnswersBooleanTrue() throws Exception {
        useKitPolicy();
        DocumentModel noPrint = Fakes.asset().channels("E-commerce", "Social").model();
        DocumentModel cleared = Fakes.asset().model();

        assertSame(Boolean.TRUE, run(script(), noPrint, "picture:views/3/content", null, "download", null));
        assertSame(Boolean.TRUE, run(script(), noPrint, null, null, "rendition", "thumbnail"));
        assertSame(Boolean.TRUE, run(script(), cleared, "picture:views/4/content", null, "download", null));
        assertSame(Boolean.TRUE, run(script(), cleared, "file:content", null, "download", null));
    }

    @Test
    void anEndedAssetIsRefusedItsUsesAndServedItsPreviews() throws Exception {
        useKitPolicy();
        DocumentModel ended = Fakes.asset().rightsEnd("2026-11-14").model();

        assertSame(Boolean.FALSE, run(script(), ended, "picture:views/3/content", null, "download", null));
        assertSame(Boolean.TRUE, run(script(), ended, "picture:views/2/content", null, "download", null));
    }

    @Test
    void aDownloadWithNoDocumentOrOfAnotherTypeIsLetThrough() throws Exception {
        useKitPolicy();
        Fakes.Doc file = Fakes.asset();
        file.type = "File";

        assertSame(Boolean.TRUE, run(script(), null, null, null, "download", null));
        assertSame(Boolean.TRUE, run(script(), file.model(), "file:content", null, "download", null));
    }

    @Test
    void aServiceThatIsNotRunningOrThatThrowsRefuses() throws Exception {
        DocumentModel asset = Fakes.asset().model();

        AssetRightsDownloadPermission.service = () -> null;
        assertSame(Boolean.FALSE, run(script(), asset, "picture:views/2/content", null, "download", null));

        AssetRightsDownloadPermission.service = () -> {
            throw new IllegalStateException("runtime not initialized");
        };
        assertSame(Boolean.FALSE, run(script(), asset, "picture:views/2/content", null, "download", null));
    }

    /** The script's own catch: a class that does not load refuses, rather than throwing, which the platform would let through. */
    @Test
    void aScriptWhoseClassDoesNotLoadRefuses() throws Exception {
        String script = script();
        String missing = script.replace("AssetRightsDownloadPermission", "NoSuchClass");
        assertEquals(false, missing.equals(script), "the script names the class");

        assertSame(Boolean.FALSE, run(missing, null, null, null, "download", null));
    }

    /** The script is the one-line hand-over the class documents: every global goes to it, in its order. */
    @Test
    void theScriptHandsEveryGlobalToTheClass() throws Exception {
        List<Object> seen = new java.util.ArrayList<>();
        AssetRightsDownloadPermission.service = () -> new AssetRightsService() {
            @Override
            public RightsPolicy policyFor(String type) {
                return null;
            }

            @Override
            public java.time.LocalDate today() {
                return null;
            }

            @Override
            public DownloadDecision decideDownload(DocumentModel document, String xpath, org.nuxeo.ecm.core.api.Blob blob,
                    String rendition) {
                seen.add(document);
                seen.add(xpath);
                seen.add(blob);
                seen.add(rendition);
                return null;
            }
        };
        DocumentModel asset = Fakes.asset().model();
        org.nuxeo.ecm.core.api.Blob blob = Fakes.blob("d");

        assertSame(Boolean.TRUE, run(script(), asset, "picture:views/1/content", blob, "rendition", "Small"));
        assertEquals(List.of(asset, "picture:views/1/content", blob, "Small"), seen);
    }
}
