/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.StringWriter;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.assets.rights.Decision.Reason;
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
 * A video's files as a policy names them, through XMap as the runtime reads a policy: a transcoded
 * video as the rendition of its conversion's name, every storyboard frame as the storyboard, in
 * their canonical forms only, and what the enricher says of them.
 */
class VideoPolicyTest {

    private static RightsPolicyDescriptor descriptor(String policyXml) throws Exception {
        String component = """
                <component name="test">
                  <extension target="org.nuxeo.agentic.assets.rights" point="policies">
                %s
                  </extension>
                </component>
                """.formatted(policyXml);
        List<RightsPolicyDescriptor> policies = RightsPolicyTest.contributed(component.getBytes(StandardCharsets.UTF_8));
        assertEquals(1, policies.size());
        return policies.get(0);
    }

    private static final String POLICY = """
            <policy type="AcmeVideo">
              <rightsEnd xpath="dc:expired" />
              <channels xpath="acmeasset:channels" />
              <original channel="Print" />
              <rendition name="MP4 480p" channel="E-commerce" />
              <storyboard channel="Social" />
            </policy>
            """;

    private static Fakes.Doc video(String... channels) {
        Fakes.Doc doc = new Fakes.Doc().rightsEnd("2027-12-31").channels(channels).original("original-digest");
        doc.type = "AcmeVideo";
        doc.schemas.add("video");
        return doc.transcoded("WebM 480p", "MP4 480p").storyboard(3);
    }

    @Test
    void xmapReadsTheStoryboardAsOneUseWithAChannelOrAsAPreview() throws Exception {
        RightsPolicy social = RightsPolicy.of(descriptor(POLICY));
        assertEquals(List.of(), social.problems());
        assertEquals(new RightsPolicy.Rule("Social"), social.rule(Use.STORYBOARD));

        RightsPolicy preview = RightsPolicy.of(descriptor(POLICY.replace("<storyboard channel=\"Social\" />",
                "<storyboard preview=\"true\" />")));
        assertTrue(preview.rule(Use.STORYBOARD).preview());

        // Both, or neither, is a mistake, and refuses.
        RightsPolicy both = RightsPolicy.of(descriptor(POLICY.replace("<storyboard channel=\"Social\" />",
                "<storyboard channel=\"Social\" preview=\"true\" />")));
        assertNull(both.rule(Use.STORYBOARD));
        assertEquals(1, both.problems().size());
    }

    /** A rule by place for a video's conversions or frames would never be read: it is left out, and said. */
    @Test
    void aBlobRuleAtAVideosConversionOrFrameIsLeftOutAndSaid() throws Exception {
        RightsPolicy policy = RightsPolicy.of(descriptor(POLICY.replace("<storyboard channel=\"Social\" />", """
                <blob xpath="vid:storyboard/0/content" preview="true" />
                <blob xpath="vid:transcodedVideos/0/content" channel="E-commerce" />
                <blob xpath="vid:storyboard/01/content" preview="true" />
                <blob xpath="video:transcodedVideos/0/content" channel="E-commerce" />
                <blob xpath="/vid:storyboard/0/content" preview="true" />
                <blob xpath="transcodedVideos/0/content" channel="E-commerce" />
                <blob xpath="files:files/0/file" channel="Print" />
                """)));
        assertEquals(6, policy.problems().size(), policy.problems()::toString);
        assertNull(policy.rule(Use.blob("video:transcodedVideos/0/content")));
        assertNull(policy.rule(Use.blob("/vid:storyboard/0/content")));
        assertNull(policy.rule(Use.blob("transcodedVideos/0/content")));
        assertNull(policy.rule(Use.blob("vid:storyboard/0/content")));
        assertNull(policy.rule(Use.blob("vid:transcodedVideos/0/content")));
        assertNull(policy.rule(Use.blob("vid:storyboard/01/content")));
        assertNull(policy.rule(Use.STORYBOARD));
        assertEquals(new RightsPolicy.Rule("Print"), policy.rule(Use.blob("files:files/0/file")));
    }

    @Test
    void aTranscodedVideoIsTheRenditionOfItsConversionsNameInItsCanonicalFormOnly() throws Exception {
        RightsPolicy policy = RightsPolicy.of(descriptor(POLICY));
        Fakes.Doc doc = video("E-commerce").transcoded("WebM 480p", "MP4 480p", " ");
        DocumentModel model = doc.model();

        assertEquals(Use.rendition("WebM 480p"), DownloadUse.classify(model, policy, "vid:transcodedVideos/0/content", null, null));
        assertEquals(Use.rendition("MP4 480p"), DownloadUse.classify(model, policy, "vid:transcodedVideos/1/content", null, null));
        assertEquals(Use.rendition("MP4 480p"), DownloadUse.classify(model, policy, "vid;transcodedVideos/1/content", null, null));
        // No name, a place it does not have, another form: not named, so never listed.
        assertEquals(Use.unknown("vid:transcodedVideos/2/content"),
                DownloadUse.classify(model, policy, "vid:transcodedVideos/2/content", null, null));
        assertEquals(Use.unknown("vid:transcodedVideos/7/content"),
                DownloadUse.classify(model, policy, "vid:transcodedVideos/7/content", null, null));
        assertEquals(Use.blob("vid:transcodedVideos/01/content"),
                DownloadUse.classify(model, policy, "vid:transcodedVideos/01/content", null, null));
        assertEquals(Use.blob("vid:transcodedVideos/item[2]/content"),
                DownloadUse.classify(model, policy, "vid:transcodedVideos/item[2]/content", null, null));
        assertEquals(Use.blob("transcodedVideos/1/content"),
                DownloadUse.classify(model, policy, "transcodedVideos/1/content", null, null));
    }

    @Test
    void everyStoryboardFrameTheVideoHasIsTheStoryboardInItsCanonicalFormOnly() throws Exception {
        RightsPolicy policy = RightsPolicy.of(descriptor(POLICY));
        DocumentModel model = video("Social").model();

        for (int frame = 0; frame < 3; frame++) {
            assertEquals(Use.STORYBOARD, DownloadUse.classify(model, policy, "vid:storyboard/" + frame + "/content", null, null));
        }
        assertEquals(Use.STORYBOARD, DownloadUse.classify(model, policy, "vid;storyboard/2/content", null, null));
        assertEquals(Use.unknown("vid:storyboard/3/content"),
                DownloadUse.classify(model, policy, "vid:storyboard/3/content", null, null));
        assertEquals(Use.blob("vid:storyboard/02/content"),
                DownloadUse.classify(model, policy, "vid:storyboard/02/content", null, null));
        assertEquals(Use.blob("vid:storyboard/1/timecode"),
                DownloadUse.classify(model, policy, "vid:storyboard/1/timecode", null, null));
    }

    @Test
    void theStoryboardIsDecidedByItsRuleAndRefusedWithNone() throws Exception {
        AssetRightsComponent social = Fakes.component(descriptor(POLICY));
        assertEquals(Decision.allow(Reason.CLEARED, "Social"),
                social.decideDownload(video("Social").model(), "vid:storyboard/1/content", null, null).decision());
        assertEquals(Decision.refuse(Reason.CHANNEL_NOT_COVERED, "Social", null),
                social.decideDownload(video("Print").model(), "vid:storyboard/1/content", null, null).decision());

        AssetRightsComponent none = Fakes.component(descriptor(POLICY.replace("<storyboard channel=\"Social\" />", "")));
        assertEquals(Decision.refuse(Reason.NOT_CLEARED),
                none.decideDownload(video("Social").model(), "vid:storyboard/1/content", null, null).decision());
    }

    /** The enricher names the storyboard {@code "storyboard"}, with no name, and each conversion the video has. */
    @Test
    void theEnricherWritesTheConversionsAndTheStoryboard() throws Exception {
        DocumentModel model = video("E-commerce", "Social").model();
        AssetRightsComponent component = Fakes.component(descriptor(POLICY));
        AssetRightsJsonEnricher enricher = new AssetRightsJsonEnricher(() -> component);
        RenderingContext ctx = RenderingContext.CtxBuilder.param(AbstractJsonEnricher.ENTITY_ENRICHER_NAME,
                AssetRightsJsonEnricher.NAME).get();
        Field field = AbstractJsonWriter.class.getDeclaredField("ctx");
        field.setAccessible(true);
        field.set(enricher, ctx);
        ObjectMapper json = new ObjectMapper();
        StringWriter out = new StringWriter();
        try (JsonGenerator jg = new JsonFactory(json).createGenerator(out)) {
            jg.writeStartObject();
            enricher.write(new Enriched<>(model), jg);
            jg.writeEndObject();
        }
        JsonNode uses = json.readTree(out.toString()).get("assetRights").get("uses");
        assertEquals(json.readTree("""
                [
                  { "use": "original", "name": null, "allowed": false, "reason": "channel-not-covered", "channel": "Print" },
                  { "use": "rendition", "name": "WebM 480p", "allowed": false, "reason": "not-cleared" },
                  { "use": "rendition", "name": "MP4 480p", "allowed": true, "reason": "cleared", "channel": "E-commerce" },
                  { "use": "storyboard", "name": null, "allowed": true, "reason": "cleared", "channel": "Social" }
                ]
                """), uses);
    }
}
