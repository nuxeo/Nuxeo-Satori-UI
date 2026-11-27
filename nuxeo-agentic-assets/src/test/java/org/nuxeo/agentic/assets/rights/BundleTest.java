package org.nuxeo.agentic.assets.rights;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.List;
import java.util.jar.Attributes;
import java.util.jar.Manifest;

import javax.xml.parsers.DocumentBuilderFactory;

import org.junit.jupiter.api.Test;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * The bundle as the runtime loads it: every component its manifest names is in it and is XML the
 * runtime can read, its classes are the ones the components name, and the package's version is
 * the manifest's.
 */
class BundleTest {

    private static final String SYMBOLIC_NAME = "org.nuxeo.agentic.assets";

    private static Attributes manifest() throws Exception {
        Enumeration<URL> manifests = BundleTest.class.getClassLoader().getResources("META-INF/MANIFEST.MF");
        while (manifests.hasMoreElements()) {
            try (InputStream in = manifests.nextElement().openStream()) {
                Attributes main = new Manifest(in).getMainAttributes();
                String name = main.getValue("Bundle-SymbolicName");
                if (name != null && name.startsWith(SYMBOLIC_NAME + ";")) {
                    return main;
                }
            }
        }
        throw new AssertionError("no manifest of " + SYMBOLIC_NAME + " on the classpath");
    }

    private static List<String> components() throws Exception {
        String header = manifest().getValue("Nuxeo-Component");
        assertNotNull(header, "Nuxeo-Component");
        return Arrays.stream(header.split(",")).map(String::trim).filter(c -> !c.isEmpty()).toList();
    }

    private static org.w3c.dom.Document parse(byte[] xml) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        return factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml));
    }

    private static byte[] resource(String path) throws Exception {
        try (InputStream in = BundleTest.class.getClassLoader().getResourceAsStream(path)) {
            assertNotNull(in, path + " is not in the bundle");
            return in.readAllBytes();
        }
    }

    @Test
    void everyComponentTheManifestNamesIsInTheBundleAndWellFormed() throws Exception {
        List<String> components = components();
        assertEquals(List.of("OSGI-INF/asset-rights-service.xml", "OSGI-INF/asset-rights-download-permission.xml",
                "OSGI-INF/asset-rights-enricher-contrib.xml", "OSGI-INF/share-links-directories.xml",
                "OSGI-INF/share-links-service.xml", "OSGI-INF/share-links-operations-contrib.xml",
                "OSGI-INF/asset-rights-video-operations-contrib.xml", "OSGI-INF/media-delivery-types.xml",
                "OSGI-INF/media-delivery-listener.xml", "OSGI-INF/asset-watermark-operations-contrib.xml",
                "OSGI-INF/asset-review-service.xml", "OSGI-INF/asset-review-listener.xml",
                "OSGI-INF/asset-video-marker.xml", "OSGI-INF/asset-watermarked-copies-types.xml",
                "OSGI-INF/asset-video-watermark-service.xml"), components);
        for (String component : components) {
            byte[] xml = resource(component);
            assertDoesNotThrow(() -> parse(xml),
                    () -> component + " is not well-formed XML:\n" + new String(xml, StandardCharsets.UTF_8));
        }
    }

    /** Every class a component names loads: an implementation, a service, a descriptor, a marshaller. */
    @Test
    void everyClassTheComponentsNameLoads() throws Exception {
        List<String> classes = new ArrayList<>();
        for (String component : components()) {
            org.w3c.dom.Document xml = parse(resource(component));
            collect(xml.getElementsByTagName("implementation"), "class", classes);
            collect(xml.getElementsByTagName("provide"), "interface", classes);
            collect(xml.getElementsByTagName("object"), "class", classes);
            collect(xml.getElementsByTagName("register"), "class", classes);
            collect(xml.getElementsByTagName("operation"), "class", classes);
            collect(xml.getElementsByTagName("listener"), "class", classes);
        }
        assertEquals(29, classes.size(), classes::toString);
        for (String name : classes) {
            assertDoesNotThrow(() -> Class.forName(name), name);
        }
        String script = parse(resource("OSGI-INF/asset-rights-download-permission.xml")).getElementsByTagName("script")
                                                                                       .item(0)
                                                                                       .getTextContent();
        assertTrue(script.contains("\"" + AssetRightsDownloadPermission.class.getName() + "\""), script);
        // Since 0.5.0, the person downloading, whom a watermark may exempt.
        assertTrue(script.contains(".allows(Document, XPath, Blob, Reason, Rendition, Infos, CurrentUser)"), script);
    }

    /**
     * Since 0.5.0: the review's component has the name and point a kit's review policy targets, the
     * add-on's permission is registered and shown, and its listener is synchronous, before the commit,
     * on the events this list names, beside the audit writer, after it. What each does is
     * AssetReviewTest's, in a runtime.
     */
    @Test
    void theReviewIsHeldByASynchronousListenerAndAPermissionOfItsOwn() throws Exception {
        org.w3c.dom.Document service = parse(resource("OSGI-INF/asset-review-service.xml"));
        assertEquals("org.nuxeo.agentic.assets.review", service.getDocumentElement().getAttribute("name"));
        NodeList points = service.getElementsByTagName("extension-point");
        assertEquals(1, points.getLength());
        assertEquals("policies", ((Element) points.item(0)).getAttribute("name"));
        NodeList permissions = service.getElementsByTagName("permission");
        assertEquals(1, permissions.getLength());
        assertEquals("ReviewAsset", ((Element) permissions.item(0)).getAttribute("name"));
        assertEquals("ReviewAsset", service.getElementsByTagName("item").item(0).getTextContent());

        org.w3c.dom.Document xml = parse(resource("OSGI-INF/asset-review-listener.xml"));
        NodeList listeners = xml.getElementsByTagName("listener");
        assertEquals(2, listeners.getLength());
        Element listener = (Element) listeners.item(0);
        assertEquals("false", listener.getAttribute("async"));
        assertEquals("false", listener.getAttribute("postCommit"));
        assertEquals("org.nuxeo.agentic.assets.review.AssetReviewListener", listener.getAttribute("class"));
        List<String> events = new ArrayList<>();
        NodeList named = listener.getElementsByTagName("event");
        for (int i = 0; i < named.getLength(); i++) {
            events.add(named.item(i).getTextContent());
        }
        assertEquals(List.of("aboutToCreate", "documentCreated", "beforeDocumentModification", "aboutToRemove",
                "documentTrashed", "aboutToMove", "aboutToCopy", "aboutToImport"), events);
        Element writer = (Element) listeners.item(1);
        assertEquals("true", writer.getAttribute("async"));
        assertEquals("true", writer.getAttribute("postCommit"));
        assertEquals("assetReviewDecided", writer.getElementsByTagName("event").item(0).getTextContent());
    }

    private static void collect(NodeList elements, String attribute, List<String> into) {
        for (int i = 0; i < elements.getLength(); i++) {
            String value = ((Element) elements.item(i)).getAttribute(attribute);
            if (!value.isEmpty()) {
                into.add(value);
            }
        }
    }

    /** The component that contributes policies is the one the kit requires, and the point is the one it names. */
    @Test
    void theServiceComponentHasTheNameAndPointPackagesContributeTo() throws Exception {
        org.w3c.dom.Document xml = parse(resource("OSGI-INF/asset-rights-service.xml"));
        assertEquals("org.nuxeo.agentic.assets.rights", xml.getDocumentElement().getAttribute("name"));
        NodeList points = xml.getElementsByTagName("extension-point");
        assertEquals(1, points.getLength());
        assertEquals(AssetRightsComponent.XP_POLICIES, ((Element) points.item(0)).getAttribute("name"));
    }

    /**
     * The delivery listener is synchronous, before the commit, on the events this list names, so that
     * one dropped from the component is seen; and a delivery is not versionable. What it does on
     * each is MediaDeliveryTest's, in a runtime.
     */
    @Test
    void theDeliveryListenerIsSynchronousOnTheEventsItDecides() throws Exception {
        org.w3c.dom.Document xml = parse(resource("OSGI-INF/media-delivery-listener.xml"));
        NodeList listeners = xml.getElementsByTagName("listener");
        assertEquals(1, listeners.getLength());
        Element listener = (Element) listeners.item(0);
        assertEquals("false", listener.getAttribute("async"));
        assertEquals("false", listener.getAttribute("postCommit"));
        assertEquals("org.nuxeo.agentic.assets.delivery.DeliveryListener", listener.getAttribute("class"));
        List<String> events = new ArrayList<>();
        NodeList named = listener.getElementsByTagName("event");
        for (int i = 0; i < named.getLength(); i++) {
            events.add(named.item(i).getTextContent());
        }
        assertEquals(List.of("aboutToCreate", "aboutToImport", "beforeDocumentModification", "aboutToRemove",
                "aboutToMove", "aboutToCopy", "documentCreatedByCopy", "aboutToCheckIn", "beforeRestoringDocument",
                "documentTrashed"), events);

        org.w3c.dom.Document types = parse(resource("OSGI-INF/media-delivery-types.xml"));
        Element doctype = (Element) types.getElementsByTagName("doctype").item(0);
        assertEquals("MediaDelivery", doctype.getAttribute("name"));
        assertEquals(0, doctype.getElementsByTagName("facet").getLength());
        // The filed three, the server's three, and each delivered file's fields.
        assertEquals(List.of("version", "distributor", "territory", "deliveredAt", "deliveredBy", "files", "file", "use",
                "name", "channel", "filename", "mimeType", "length", "digest", "watermarked", "watermarkedFor",
                "watermark", "watermarkedFile"), fields("schemas/media_delivery.xsd"));
    }

    /**
     * Since 0.6.0: long videos marked in a queue of their own, one at a time on a node; their copies'
     * listener and the failures' audit writer both after the commit, in the background; the copy's
     * type hidden, with the fields a job writes; and the marker its own service, so that a runtime
     * without ffmpeg stands in for it. What each does is VideoWatermarkBackgroundTest's, in a runtime.
     */
    @Test
    void longVideosAreMarkedInAQueueOfTheirOwnAndKeptAsCopies() throws Exception {
        org.w3c.dom.Document service = parse(resource("OSGI-INF/asset-video-watermark-service.xml"));
        assertEquals("org.nuxeo.agentic.assets.watermark.videos", service.getDocumentElement().getAttribute("name"));
        Element queue = (Element) service.getElementsByTagName("queue").item(0);
        assertEquals("agenticVideoWatermark", queue.getAttribute("id"));
        assertEquals("1", queue.getElementsByTagName("maxThreads").item(0).getTextContent());
        assertEquals("agenticVideoWatermark", queue.getElementsByTagName("category").item(0).getTextContent());
        assertEquals("agenticVideoWatermark", org.nuxeo.agentic.assets.watermark.VideoWatermarkWork.CATEGORY);
        NodeList listeners = service.getElementsByTagName("listener");
        assertEquals(2, listeners.getLength());
        Element copies = (Element) listeners.item(0);
        assertEquals("true", copies.getAttribute("async"));
        assertEquals("true", copies.getAttribute("postCommit"));
        List<String> events = new ArrayList<>();
        NodeList named = copies.getElementsByTagName("event");
        for (int i = 0; i < named.getLength(); i++) {
            events.add(named.item(i).getTextContent());
        }
        assertEquals(List.of("documentModified", "documentRemoved", "documentRestored"), events);
        Element writer = (Element) listeners.item(1);
        assertEquals("true", writer.getAttribute("async"));
        assertEquals("true", writer.getAttribute("postCommit"));
        assertEquals("assetWatermarkFailed", writer.getElementsByTagName("event").item(0).getTextContent());

        org.w3c.dom.Document types = parse(resource("OSGI-INF/asset-watermarked-copies-types.xml"));
        NodeList doctypes = types.getElementsByTagName("doctype");
        assertEquals(2, doctypes.getLength());
        for (int i = 0; i < doctypes.getLength(); i++) {
            Element doctype = (Element) doctypes.item(i);
            NodeList facets = doctype.getElementsByTagName("facet");
            assertEquals(1, facets.getLength(), doctype.getAttribute("name"));
            assertEquals("HiddenInNavigation", ((Element) facets.item(0)).getAttribute("name"));
        }
        assertEquals(AssetRightsComponent.COPY_TYPE, ((Element) doctypes.item(1)).getAttribute("name"));
        assertEquals(List.of("key", "source", "sourceType", "xpath", "use", "digest", "fingerprint", "purpose",
                "recipient", "user", "territory", "watermark", "made", "content"), fields("schemas/watermarked_copy.xsd"));

        org.w3c.dom.Document marker = parse(resource("OSGI-INF/asset-video-marker.xml"));
        assertEquals("org.nuxeo.agentic.assets.watermark.VideoMarker",
                ((Element) marker.getElementsByTagName("provide").item(0)).getAttribute("interface"));
    }

    /** package.xml's version is the module's property, and the manifest's Bundle-Version repeats it. */
    @Test
    void thePackageVersionIsTheManifestsBundleVersion() throws Exception {
        String version = System.getProperty("assets.package.version");
        assertNotNull(version, "surefire passes assets.package.version from the pom");
        assertFalse(version.isBlank());
        assertEquals(version, manifest().getValue("Bundle-Version"));
        String packageXml = Files.readString(Path.of("src", "main", "package", "package.xml"));
        assertTrue(packageXml.contains("name=\"nuxeo-agentic-assets\" version=\"@assets.package.version@\""),
                packageXml);
    }

    /**
     * The share links' servlet is mapped on /agentic-share/* with no authentication filter: the
     * fragment maps no filter at all, and its servlet is the class that serves the links.
     */
    @Test
    void theShareLinksServletIsMappedWithNoAuthenticationFilter() throws Exception {
        org.w3c.dom.Document xml = parse(resource("OSGI-INF/deployment-fragment.xml"));
        assertEquals(0, xml.getElementsByTagName("filter-mapping").getLength());
        assertEquals(0, xml.getElementsByTagName("filter").getLength());
        NodeList servlets = xml.getElementsByTagName("servlet");
        assertEquals(1, servlets.getLength());
        String servletClass = ((Element) servlets.item(0)).getElementsByTagName("servlet-class")
                                                          .item(0)
                                                          .getTextContent();
        assertEquals("org.nuxeo.agentic.assets.share.ShareLinkServlet", servletClass);
        assertDoesNotThrow(() -> Class.forName(servletClass));
        NodeList patterns = xml.getElementsByTagName("url-pattern");
        assertEquals(1, patterns.getLength());
        assertEquals("/agentic-share/*", patterns.item(0).getTextContent());
    }

    /**
     * The two directories, as Nuxeo keeps its own tokens: of the system type, readable by
     * __Nobody__ only, with no cache, and no field that could hold a token or the visitor.
     */
    @Test
    void theShareLinksDirectoriesAreReadableByNobodyAndCacheNothing() throws Exception {
        org.w3c.dom.Document xml = parse(resource("OSGI-INF/share-links-directories.xml"));
        NodeList directories = xml.getElementsByTagName("directory");
        assertEquals(2, directories.getLength());
        List<String> names = new ArrayList<>();
        for (int i = 0; i < directories.getLength(); i++) {
            Element directory = (Element) directories.item(i);
            names.add(directory.getAttribute("name"));
            assertEquals("template-directory", directory.getAttribute("extends"));
            assertEquals("system", directory.getElementsByTagName("type").item(0).getTextContent());
            NodeList permissions = directory.getElementsByTagName("permission");
            assertEquals(1, permissions.getLength());
            Element read = (Element) permissions.item(0);
            assertEquals("Read", read.getAttribute("name"));
            NodeList groups = read.getElementsByTagName("group");
            assertEquals(1, groups.getLength());
            assertEquals("__Nobody__", groups.item(0).getTextContent());
            assertEquals(0, read.getElementsByTagName("user").getLength());
            for (String cache : List.of("cacheTimeout", "cacheMaxSize", "cacheEntryName",
                    "cacheEntryWithoutReferencesName")) {
                assertEquals(0, directory.getElementsByTagName(cache).getLength(), cache);
            }
        }
        assertEquals(List.of("agenticShareLinks", "agenticShareDownloads"), names);
        assertEquals(List.of("id", "repository", "document", "items", "digests", "sha256", "lastDay", "created", "createdBy", "revoked",
                "revokedBy"), fields("schemas/agenticsharelink.xsd"));
        assertEquals(List.of("id", "time", "link", "document", "item"), fields("schemas/agenticsharedownload.xsd"));
    }

    private static List<String> fields(String schema) throws Exception {
        NodeList elements = parse(resource(schema)).getElementsByTagNameNS("http://www.w3.org/2001/XMLSchema",
                "element");
        List<String> names = new ArrayList<>();
        for (int i = 0; i < elements.getLength(); i++) {
            names.add(((Element) elements.item(i)).getAttribute("name"));
        }
        return names;
    }

    /**
     * Each of the platform's five Video.* operations replaced by one of the same id, registered
     * after the platform's own, with the same parameters and the same inputs, each answering the
     * platform's own type of answer.
     */
    @Test
    void theVideoOperationsReplaceThePlatformsOfTheSameIds() throws Exception {
        org.w3c.dom.Document xml = parse(resource("OSGI-INF/asset-rights-video-operations-contrib.xml"));
        List<String> requires = new ArrayList<>();
        NodeList required = xml.getElementsByTagName("require");
        for (int i = 0; i < required.getLength(); i++) {
            requires.add(required.item(i).getTextContent().trim());
        }
        assertEquals(List.of("org.nuxeo.ecm.video.tools.operations", "org.nuxeo.agentic.assets.rights"), requires);
        List<String> platform = List.of("AddWatermarkToVideo", "ConcatVideos", "ExtractClosedCaptionsFromVideo",
                "SliceVideo", "SliceVideoInParts");
        NodeList operations = xml.getElementsByTagName("operation");
        assertEquals(platform.size(), operations.getLength());
        for (int i = 0; i < operations.getLength(); i++) {
            Element operation = (Element) operations.item(i);
            assertEquals("true", operation.getAttribute("replace"));
            Class<?> ours = Class.forName(operation.getAttribute("class"));
            Class<?> theirs = Class.forName("org.nuxeo.ecm.platform.video.tools.operations." + platform.get(i));
            org.nuxeo.ecm.automation.core.annotations.Operation op = org.nuxeo.ecm.automation.core.annotations.Operation.class.cast(
                    ours.getAnnotation(org.nuxeo.ecm.automation.core.annotations.Operation.class));
            assertEquals(theirs.getField("ID").get(null), op.id(), ours.getName());
            assertEquals(params(theirs), params(ours), ours.getName());
            assertEquals(methods(theirs), methods(ours), ours.getName());
        }
    }

    /** Each parameter's name, Java type and whether it is required. */
    private static List<String> params(Class<?> type) {
        List<String> params = new ArrayList<>();
        for (java.lang.reflect.Field field : type.getDeclaredFields()) {
            org.nuxeo.ecm.automation.core.annotations.Param param = field.getAnnotation(
                    org.nuxeo.ecm.automation.core.annotations.Param.class);
            if (param != null) {
                params.add(param.name() + " " + field.getType().getName() + " " + param.required() + " "
                        + Arrays.toString(param.values()));
            }
        }
        params.sort(null);
        return params;
    }

    /** Each operation method's input and answer, and its collector. */
    private static List<String> methods(Class<?> type) {
        List<String> methods = new ArrayList<>();
        for (java.lang.reflect.Method method : type.getMethods()) {
            org.nuxeo.ecm.automation.core.annotations.OperationMethod annotation = method.getAnnotation(
                    org.nuxeo.ecm.automation.core.annotations.OperationMethod.class);
            if (annotation != null) {
                methods.add(Arrays.toString(method.getParameterTypes()) + " -> " + method.getReturnType().getName() + " "
                        + annotation.collector().getName());
            }
        }
        methods.sort(null);
        return methods;
    }

    /** The four operations the asset page calls, each the class the contribution names. */
    @Test
    void theShareLinksOperationsAreTheFourThePageCalls() throws Exception {
        org.w3c.dom.Document xml = parse(resource("OSGI-INF/share-links-operations-contrib.xml"));
        List<String> ids = new ArrayList<>();
        NodeList operations = xml.getElementsByTagName("operation");
        for (int i = 0; i < operations.getLength(); i++) {
            Class<?> type = Class.forName(((Element) operations.item(i)).getAttribute("class"));
            ids.add(type.getAnnotation(org.nuxeo.ecm.automation.core.annotations.Operation.class).id());
        }
        assertEquals(List.of("ShareLink.Create", "ShareLink.List", "ShareLink.Revoke", "ShareLink.Downloads"), ids);
    }
}
