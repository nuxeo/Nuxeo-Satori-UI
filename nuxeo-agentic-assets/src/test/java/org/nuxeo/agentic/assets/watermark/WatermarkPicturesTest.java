/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.Serializable;
import java.io.StringWriter;
import java.io.UncheckedIOException;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;

import javax.imageio.ImageIO;
import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.agentic.assets.rights.AssetRightsJsonEnricher;
import org.nuxeo.agentic.assets.rights.Watermark;
import org.nuxeo.agentic.assets.share.Watermarker;
import org.nuxeo.ecm.automation.AutomationService;
import org.nuxeo.ecm.automation.OperationContext;
import org.nuxeo.ecm.automation.OperationException;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.impl.UserPrincipal;
import org.nuxeo.ecm.core.api.impl.blob.ByteArrayBlob;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.io.download.DownloadService;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.core.test.annotations.Granularity;
import org.nuxeo.ecm.core.test.annotations.RepositoryConfig;
import org.nuxeo.runtime.api.login.LoginComponent;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.transaction.TransactionHelper;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * A picture's watermark, in a real Nuxeo runtime and repository: the platform's download service
 * evaluating the add-on's permission through Nashorn with the person downloading, the add-on's
 * {@code Asset.GetWatermarked} run through Automation, and a policy whose watermark marks an
 * {@code AcmeAsset}'s Medium view, a preview, and every download, for anyone outside brand-team
 * ({@code test-watermark-policy-contrib.xml}).
 */
@RunWith(FeaturesRunner.class)
@Features(CoreFeature.class)
@RepositoryConfig(cleanup = Granularity.METHOD)
@Deploy("org.nuxeo.ecm.automation.core")
@Deploy("org.nuxeo.ecm.platform.tag:OSGI-INF/faceted-tag-service-core-types.xml")
@Deploy("org.nuxeo.ecm.platform.picture.core:OSGI-INF/picture-schemas-contrib.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-rights-service.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-rights-download-permission.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-watermark-operations-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-asset-model-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-watermark-policy-contrib.xml")
public class WatermarkPicturesTest {

    static final String TEXT = "ACME OUTDOOR · %s · %s";

    private static final NuxeoPrincipal OUTSIDER = new UserPrincipal("olga", List.of("members"), false, false);

    private static final NuxeoPrincipal STAFF = new UserPrincipal("sam", List.of("members", "brand-team"), false,
            false);

    private static final NuxeoPrincipal ADMINISTRATOR = new UserPrincipal("Administrator", List.of("administrators"),
            false, true);

    @Inject
    protected CoreSession session;

    @Inject
    protected DownloadService downloads;

    @Inject
    protected AutomationService automation;

    private final LocalDate today = LocalDate.now(ZoneOffset.UTC);

    private String asset;

    @Before
    public void setUp() {
        DocumentModel folder = session.createDocument(session.createDocumentModel("/", "assets", "Folder"));
        ACP acp = folder.getACP();
        ACL local = acp.getOrCreateACL();
        local.add(new ACE("members", "Read", true));
        session.setACP(folder.getRef(), acp, true);
        asset = asset("ast-501", List.of("Print", "E-commerce"), 30, jpeg(640, 400)).getId();
        commit();
    }

    // ------------------------------------------------------------------ refused unmarked

    @Test
    public void aMarkedUseIsRefusedUnmarkedToAnyoneOutsideTheExemptGroupAndServedAsItIsToIt() {
        assertFalse("a marked preview", downloads(OUTSIDER, "picture:views/0/content"));
        assertTrue("a preview it does not mark", downloads(OUTSIDER, "picture:views/1/content"));
        assertFalse("every download is marked", downloads(OUTSIDER, "picture:views/2/content"));
        assertFalse("the original too", downloads(OUTSIDER, "file:content"));
        assertFalse("an administrator is not exempt", downloads(ADMINISTRATOR, "picture:views/0/content"));
        assertFalse(downloads(ADMINISTRATOR, "file:content"));
        assertTrue("brand-team is exempt", downloads(STAFF, "picture:views/0/content"));
        assertTrue(downloads(STAFF, "picture:views/2/content"));
        assertTrue(downloads(STAFF, "file:content"));
    }

    @Test
    public void theEnricherSaysWatermarkRequiredForTheReaderAndNotForTheExempt() throws Exception {
        JsonNode outsider = enriched(OUTSIDER);
        assertEquals("watermark-required", use(outsider, "view", "Medium").get("reason").asText());
        assertFalse(use(outsider, "view", "Medium").get("allowed").asBoolean());
        assertEquals("watermark-required", use(outsider, "view", "FullHD").get("reason").asText());
        assertEquals("E-commerce", use(outsider, "view", "FullHD").get("channel").asText());
        assertEquals("preview", use(outsider, "view", "Thumbnail").get("reason").asText());
        JsonNode staff = enriched(STAFF);
        assertEquals("preview", use(staff, "view", "Medium").get("reason").asText());
        assertEquals("cleared", use(staff, "view", "FullHD").get("reason").asText());
    }

    // ------------------------------------------------------------------ served marked

    @Test
    public void theMarkedFileIsMadeOnDemandAndNamesItsReader() throws Exception {
        Blob medium = view(0);
        Blob forOlga = marked(OUTSIDER, "view:Medium");
        assertEquals("image/jpeg", forOlga.getMimeType());
        assertEquals("medium-watermarked.jpg", forOlga.getFilename());
        // The text drawn names its reader and the day: the same picture marked so, byte for byte.
        assertArrayEquals(expected(medium, "olga"), forOlga.getByteArray());
        Blob forSam = marked(STAFF, "view:Medium");
        assertArrayEquals(expected(medium, "sam"), forSam.getByteArray());
        assertFalse(java.util.Arrays.equals(forOlga.getByteArray(), forSam.getByteArray()));
        assertFalse(java.util.Arrays.equals(medium.getByteArray(), forOlga.getByteArray()));
        BufferedImage picture = ImageIO.read(new ByteArrayInputStream(forOlga.getByteArray()));
        assertEquals(640, picture.getWidth());
        assertEquals(400, picture.getHeight());
        // The original, a PNG, is marked as every download is: as a new JPEG.
        Blob original = marked(OUTSIDER, "original");
        assertEquals("image/jpeg", original.getMimeType());
        assertNotNull(ImageIO.read(new ByteArrayInputStream(original.getByteArray())));
    }

    @Test
    public void whatTheWatermarkDoesNotMarkIsNotServedHere() {
        assertEquals(404, refused(OUTSIDER, "view:Thumbnail").getStatusCode());
        assertEquals(404, refused(OUTSIDER, "rendition:thumbnail").getStatusCode());
        assertEquals(404, refused(OUTSIDER, "view:Unlisted").getStatusCode());
        assertEquals(400, refused(OUTSIDER, "picture:views/0/content").getStatusCode());
        assertEquals(400, refused(OUTSIDER, "view:").getStatusCode());
    }

    @Test
    public void theRightsStillDecideAMarkedFile() {
        DocumentModel noWeb = asset("ast-503", List.of("Print"), 30, jpeg(320, 200));
        DocumentModel ended = asset("ast-505", List.of("Print", "E-commerce"), -1, jpeg(320, 200));
        commit();
        assertEquals(403, refused(OUTSIDER, noWeb.getId(), "view:FullHD").getStatusCode());
        assertEquals(403, refused(OUTSIDER, ended.getId(), "view:FullHD").getStatusCode());
        assertEquals(403, refused(OUTSIDER, ended.getId(), "original").getStatusCode());
        // A preview is served whatever the rights, marked.
        assertNotNull(marked(OUTSIDER, ended.getId(), "view:Medium"));
    }

    @Test
    public void aFileThatCannotBeMarkedIsRefusedAndNeverServedUnmarked() throws Exception {
        DocumentModel doc = session.getDocument(new org.nuxeo.ecm.core.api.IdRef(asset));
        @SuppressWarnings("unchecked")
        List<Map<String, Serializable>> views = new ArrayList<>(
                (List<Map<String, Serializable>>) doc.getPropertyValue("picture:views"));
        Map<String, Serializable> fullHd = new HashMap<>(views.get(2));
        Blob words = new ByteArrayBlob("not a picture".getBytes(), "text/plain");
        words.setFilename("fullhd.txt");
        fullHd.put("content", (Serializable) words);
        views.set(2, fullHd);
        doc.setPropertyValue("picture:views", (Serializable) views);
        session.saveDocument(doc);
        commit();
        assertEquals(409, refused(OUTSIDER, "view:FullHD").getStatusCode());
        assertFalse(downloads(OUTSIDER, "picture:views/2/content"));
    }

    // ------------------------------------------------------------------ helpers

    private DocumentModel asset(String name, List<String> channels, int rightsForDays, byte[] original) {
        DocumentModel doc = session.createDocumentModel("/assets", name, "AcmeAsset");
        doc.setPropertyValue("dc:title", name);
        doc.setPropertyValue("acmeasset:channels", (Serializable) channels);
        doc.setPropertyValue("dc:expired", midnightUtc(today.plusDays(rightsForDays)));
        Blob file = new ByteArrayBlob(png(640, 400), "image/png");
        file.setFilename(name + ".png");
        doc.setPropertyValue("file:content", (Serializable) file);
        doc.setPropertyValue("picture:views", (Serializable) List.of(viewOf("Medium", original),
                viewOf("Thumbnail", jpeg(100, 62)), viewOf("FullHD", original)));
        return session.createDocument(doc);
    }

    private static Map<String, Serializable> viewOf(String title, byte[] bytes) {
        Blob content = new ByteArrayBlob(bytes, "image/jpeg");
        content.setFilename(title.toLowerCase() + ".jpg");
        Map<String, Serializable> view = new HashMap<>();
        view.put("title", title);
        view.put("filename", title.toLowerCase() + ".jpg");
        view.put("content", (Serializable) content);
        return view;
    }

    private Blob view(int index) {
        return (Blob) session.getDocument(new org.nuxeo.ecm.core.api.IdRef(asset))
                             .getPropertyValue("picture:views/" + index + "/content");
    }

    private byte[] expected(Blob file, String reader) throws Exception {
        Watermarker watermarker = new Watermarker();
        return watermarker.watermark(watermarker.read(file), String.format(TEXT, reader, today),
                Watermark.Placement.TILED);
    }

    private boolean downloads(NuxeoPrincipal person, String xpath) {
        DocumentModel doc = session.getDocument(new org.nuxeo.ecm.core.api.IdRef(asset));
        Blob blob = (Blob) doc.getPropertyValue(xpath);
        LoginComponent.pushPrincipal(person);
        try {
            return downloads.checkPermission(doc, xpath, blob, "download", Map.of());
        } finally {
            LoginComponent.popPrincipal();
        }
    }

    private Blob marked(NuxeoPrincipal person, String use) {
        return marked(person, asset, use);
    }

    private Blob marked(NuxeoPrincipal person, String id, String use) {
        try {
            return run(person, id, use);
        } catch (OperationException e) {
            throw new AssertionError(e);
        }
    }

    private NuxeoException refused(NuxeoPrincipal person, String use) {
        return refused(person, asset, use);
    }

    private NuxeoException refused(NuxeoPrincipal person, String id, String use) {
        try {
            run(person, id, use);
        } catch (OperationException e) {
            Throwable cause = e;
            while (cause != null && !(cause instanceof NuxeoException)) {
                cause = cause.getCause();
            }
            if (cause != null) {
                return (NuxeoException) cause;
            }
            throw new AssertionError(e);
        } catch (NuxeoException e) {
            return e;
        }
        fail("served: " + use);
        return null;
    }

    private Blob run(NuxeoPrincipal person, String id, String use) throws OperationException {
        CoreSession as = CoreInstance.getCoreSession(session.getRepositoryName(), person);
        try (OperationContext ctx = new OperationContext(as)) {
            ctx.setInput(as.getDocument(new org.nuxeo.ecm.core.api.IdRef(id)));
            Map<String, Object> params = new HashMap<>();
            params.put("use", use);
            return (Blob) automation.run(ctx, GetWatermarkedOperation.ID, params);
        }
    }

    private JsonNode enriched(NuxeoPrincipal person) throws Exception {
        CoreSession as = CoreInstance.getCoreSession(session.getRepositoryName(), person);
        DocumentModel doc = as.getDocument(new org.nuxeo.ecm.core.api.IdRef(asset));
        StringWriter out = new StringWriter();
        try (JsonGenerator jg = new JsonFactory().createGenerator(out)) {
            jg.writeStartObject();
            new AssetRightsJsonEnricher().write(jg, doc);
            jg.writeEndObject();
        }
        return new ObjectMapper().readTree(out.toString()).get(AssetRightsJsonEnricher.NAME);
    }

    private static JsonNode use(JsonNode rights, String kind, String name) {
        for (JsonNode use : rights.get("uses")) {
            if (kind.equals(use.get("use").asText()) && name.equals(use.get("name").asText())) {
                return use;
            }
        }
        throw new AssertionError(kind + " " + name + " is not in " + rights);
    }

    static byte[] jpeg(int width, int height) {
        return drawn(width, height, "jpeg");
    }

    static byte[] png(int width, int height) {
        return drawn(width, height, "png");
    }

    private static byte[] drawn(int width, int height, String format) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        try {
            g.setPaint(new GradientPaint(0, 0, new Color(40, 90, 60), width, height, new Color(200, 210, 230)));
            g.fillRect(0, 0, width, height);
        } finally {
            g.dispose();
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            ImageIO.write(image, format, out);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return out.toByteArray();
    }

    private static Calendar midnightUtc(LocalDate day) {
        GregorianCalendar calendar = new GregorianCalendar(TimeZone.getTimeZone("UTC"));
        calendar.clear();
        calendar.set(day.getYear(), day.getMonthValue() - 1, day.getDayOfMonth());
        return calendar;
    }

    private void commit() {
        session.save();
        TransactionHelper.commitOrRollbackTransaction();
        TransactionHelper.startTransaction();
    }
}
