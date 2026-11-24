package org.nuxeo.agentic.assets.rights;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import javax.xml.parsers.DocumentBuilderFactory;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.assets.rights.Decision.Reason;
import org.nuxeo.agentic.assets.rights.RightsPolicy.Rule;
import org.nuxeo.common.xmap.XMap;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * A policy as the server reads it, from XML through XMap as the runtime reads a contribution, and
 * what each mistake in one means: a refusal.
 */
class RightsPolicyTest {

    /** The brand kit's own component, read where the kit keeps it. */
    static final Path KIT_COMPONENT = Path.of("..", "business-apps", "packages", "brand-assets-demo", "bundle",
            "OSGI-INF", "brand-assets-demo-rights.xml");

    /** Every policy an XML component contributes to this add-on's point, read as the runtime reads them. */
    static List<RightsPolicyDescriptor> contributed(byte[] component) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        org.w3c.dom.Document xml = factory.newDocumentBuilder().parse(new ByteArrayInputStream(component));
        XMap xmap = new XMap();
        xmap.register(RightsPolicyDescriptor.class);
        List<RightsPolicyDescriptor> policies = new ArrayList<>();
        NodeList extensions = xml.getDocumentElement().getElementsByTagName("extension");
        for (int i = 0; i < extensions.getLength(); i++) {
            Element extension = (Element) extensions.item(i);
            if ("org.nuxeo.agentic.assets.rights".equals(extension.getAttribute("target"))
                    && "policies".equals(extension.getAttribute("point"))) {
                for (Object each : xmap.loadAll(extension)) {
                    policies.add((RightsPolicyDescriptor) each);
                }
            }
        }
        return policies;
    }

    private static RightsPolicy parse(String policyXml) throws Exception {
        String component = """
                <component name="test">
                  <extension target="org.nuxeo.agentic.assets.rights" point="policies">
                %s
                  </extension>
                </component>
                """.formatted(policyXml);
        List<RightsPolicyDescriptor> policies = contributed(component.getBytes(StandardCharsets.UTF_8));
        assertEquals(1, policies.size());
        return RightsPolicy.of(policies.get(0));
    }

    @Test
    void xmapReadsEveryElementOfAPolicy() throws Exception {
        RightsPolicy policy = parse("""
                <policy type="AcmeAsset">
                  <rightsEnd xpath="dc:expired" />
                  <channels xpath="acmeasset:channels" />
                  <original channel="Print" />
                  <view name="Medium" preview="true" />
                  <view name="FullHD" channel="E-commerce" />
                  <rendition name="thumbnail" preview="true" />
                  <blob xpath="files:files/0/file" channel="Wholesale" />
                </policy>
                """);

        assertEquals("AcmeAsset", policy.type());
        assertEquals("dc:expired", policy.rightsEndXpath());
        assertEquals("acmeasset:channels", policy.channelsXpath());
        assertEquals("file:content", policy.originalXpath());
        assertFalse(policy.broken());
        assertEquals(List.of(), policy.problems());
        assertEquals(new Rule("Print"), policy.rule(Use.ORIGINAL));
        assertTrue(policy.rule(Use.view("Medium")).preview());
        assertEquals(new Rule("E-commerce"), policy.rule(Use.view("FullHD")));
        assertTrue(policy.rule(Use.rendition("thumbnail")).preview());
        assertEquals(new Rule("Wholesale"), policy.rule(Use.blob("files:files/0/file")));
        assertEquals(5, policy.rules().size());
    }

    @Test
    void aPolicyWithNoRightsEndOrNoChannelsIsBroken() throws Exception {
        RightsPolicy noEnd = parse("""
                <policy type="AcmeAsset"><channels xpath="acmeasset:channels" /><view name="Medium" preview="true" /></policy>
                """);
        RightsPolicy noChannels = parse("""
                <policy type="AcmeAsset"><rightsEnd xpath="dc:expired" /><view name="Medium" preview="true" /></policy>
                """);

        assertTrue(noEnd.broken());
        assertTrue(noChannels.broken());
        assertEquals(1, noEnd.problems().size());
        assertEquals(Decision.refuse(Reason.POLICY_ERROR),
                AssetRights.decide(noEnd, new AssetFacts(null, Set.of()), Use.view("Medium"), LocalDate.MAX));
    }

    @Test
    void aUseWithBothOrNeitherIsLeftOutSoItIsRefused() throws Exception {
        RightsPolicy policy = parse("""
                <policy type="AcmeAsset">
                  <rightsEnd xpath="dc:expired" />
                  <channels xpath="acmeasset:channels" />
                  <original />
                  <view name="Medium" preview="true" channel="Social" />
                  <view />
                  <rendition name=" " preview="true" />
                </policy>
                """);

        assertNull(policy.rule(Use.ORIGINAL));
        assertNull(policy.rule(Use.view("Medium")));
        assertTrue(policy.rules().isEmpty());
        assertEquals(4, policy.problems().size());
    }

    @Test
    void aUseListedTwiceKeepsTheStricterRule() throws Exception {
        RightsPolicy policy = parse("""
                <policy type="AcmeAsset">
                  <rightsEnd xpath="dc:expired" />
                  <channels xpath="acmeasset:channels" />
                  <view name="FullHD" preview="true" />
                  <view name="FullHD" channel="E-commerce" />
                  <view name="Medium" channel="Social" />
                  <view name="Medium" preview="true" />
                </policy>
                """);

        assertEquals(new Rule("E-commerce"), policy.rule(Use.view("FullHD")));
        assertEquals(new Rule("Social"), policy.rule(Use.view("Medium")));
        assertEquals(2, policy.problems().size());
    }

    @Test
    void anOriginalMayNameItsXpath() throws Exception {
        RightsPolicy policy = parse("""
                <policy type="Contract">
                  <rightsEnd xpath="dc:expired" /><channels xpath="ct:channels" />
                  <original xpath="files:files/0/file" channel="Print" />
                </policy>
                """);

        assertEquals("files:files/0/file", policy.originalXpath());
    }

    @Test
    void enabledFalseIsRead() throws Exception {
        String component = """
                <component name="test">
                  <extension target="org.nuxeo.agentic.assets.rights" point="policies">
                    <policy type="AcmeAsset" enabled="false" />
                  </extension>
                </component>
                """;
        List<RightsPolicyDescriptor> policies = contributed(component.getBytes(StandardCharsets.UTF_8));
        assertFalse(policies.get(0).isEnabled());
    }

    /**
     * The brand kit's own component, read from where the kit keeps it, decides the plan's demo step 2
     * as the demo expects: its policy is the one these tests describe.
     */
    @Test
    void theBrandKitsPolicyIsReadWholeAndDecidesTheDemo() throws Exception {
        assertTrue(Files.isRegularFile(KIT_COMPONENT), KIT_COMPONENT + " is where the kit keeps its policy");
        List<RightsPolicyDescriptor> policies = contributed(Files.readAllBytes(KIT_COMPONENT));
        assertEquals(1, policies.size());
        RightsPolicy kit = RightsPolicy.of(policies.get(0));
        assertNotNull(kit);
        assertEquals(List.of(), kit.problems());
        assertEquals(RightsPolicy.of(Fakes.kitPolicy()).rules(), kit.rules());
        assertEquals("dc:expired", kit.rightsEndXpath());
        assertEquals("acmeasset:channels", kit.channelsXpath());
        assertEquals("AcmeAsset", kit.type());
    }
}
