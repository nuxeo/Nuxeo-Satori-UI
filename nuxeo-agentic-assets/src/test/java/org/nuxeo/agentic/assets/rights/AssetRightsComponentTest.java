package org.nuxeo.agentic.assets.rights;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.assets.rights.AssetRightsService.DownloadDecision;
import org.nuxeo.agentic.assets.rights.Decision.Reason;
import org.nuxeo.ecm.core.api.DocumentModel;

/** The policies in force, and the decision for a download as the permission asks for it. */
class AssetRightsComponentTest {

    @Test
    void todayIsTheServersDayInUtc() {
        assertEquals(LocalDate.of(2026, 11, 24), Fakes.component().today());
    }

    @Test
    void aDocumentOfATypeNoPolicyCoversIsNotDecided() {
        AssetRightsComponent component = Fakes.component(Fakes.kitPolicy());
        Fakes.Doc file = Fakes.asset();
        file.type = "File";

        assertNull(component.decideDownload(file.model(), "file:content", null, null));
        assertNull(component.decideDownload(null, "file:content", null, null));
        // Nothing of the document is read beyond its type.
        assertTrue(file.read.isEmpty());
    }

    @Test
    void aCoveredDocumentIsDecidedFromItsOwnFields() {
        AssetRightsComponent component = Fakes.component(Fakes.kitPolicy());
        DocumentModel noPrint = Fakes.asset().channels("E-commerce", "Social").model();

        DownloadDecision print = component.decideDownload(noPrint, "picture:views/4/content", null, null);
        assertEquals(Use.view("OriginalJpeg"), print.use());
        assertEquals(Reason.CHANNEL_NOT_COVERED, print.decision().reason());

        DownloadDecision web = component.decideDownload(noPrint, null, null, "FullHD");
        assertEquals(Use.rendition("FullHD"), web.use());
        assertTrue(web.decision().allowed());
    }

    @Test
    void rightsThatCannotBeReadRefuse() {
        AssetRightsComponent component = Fakes.component(Fakes.kitPolicy());
        Fakes.Doc noSchema = Fakes.asset();
        noSchema.properties.remove("acmeasset:channels");
        Fakes.Doc wrongKind = Fakes.asset();
        wrongKind.properties.put("dc:expired", "2027-01-01");

        assertEquals(Decision.refuse(Reason.POLICY_ERROR),
                component.decideDownload(noSchema.model(), "picture:views/2/content", null, null).decision());
        assertEquals(Decision.refuse(Reason.POLICY_ERROR),
                component.decideDownload(wrongKind.model(), "file:content", null, null).decision());
    }

    @Test
    void aDocumentWhoseTypeCannotBeReadIsRefused() {
        AssetRightsComponent component = Fakes.component(Fakes.kitPolicy());
        DocumentModel broken = (DocumentModel) java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),
                new Class<?>[] { DocumentModel.class }, (proxy, method, args) -> {
                    throw new IllegalStateException("closed session");
                });

        DownloadDecision decided = component.decideDownload(broken, "file:content", null, null);
        assertNotNull(decided);
        assertFalse(decided.decision().allowed());
    }

    @Test
    void aLaterPolicyForTheSameTypeReplacesItWholeAndDisabledRemovesIt() {
        RightsPolicyDescriptor first = Fakes.kitPolicy();
        RightsPolicyDescriptor second = new RightsPolicyDescriptor();
        second.type = "AcmeAsset";
        second.rightsEndXpath = "dc:expired";
        second.channelsXpath = "acmeasset:channels";
        second.views.add(Fakes.preview("OriginalJpeg"));
        AssetRightsComponent component = Fakes.component(first, second);

        RightsPolicy inForce = component.policyFor("AcmeAsset");
        assertTrue(inForce.rule(Use.view("OriginalJpeg")).preview());
        assertNull(inForce.rule(Use.view("Medium")), "replaced whole, not merged");

        RightsPolicyDescriptor off = new RightsPolicyDescriptor();
        off.type = "AcmeAsset";
        off.enabled = false;
        component.register(off, "test");
        assertNull(component.policyFor("AcmeAsset"));

        component.unregisterContribution(off, AssetRightsComponent.XP_POLICIES, null);
        assertNotNull(component.policyFor("AcmeAsset"));
        component.unregisterContribution(second, AssetRightsComponent.XP_POLICIES, null);
        assertNotNull(component.policyFor("AcmeAsset").rule(Use.view("Medium")));
    }

    @Test
    void aPolicyWithNoTypeIsLeftOut() {
        RightsPolicyDescriptor untyped = Fakes.kitPolicy();
        untyped.type = "  ";
        AssetRightsComponent component = Fakes.component(untyped);

        assertNull(component.policyFor("  "));
        assertNull(component.policyFor(""));
    }

    /** A broken policy still covers its type: it refuses, rather than leaving the type uncovered. */
    @Test
    void aBrokenPolicyStillCoversItsTypeAndRefusesEveryUse() {
        RightsPolicyDescriptor broken = Fakes.kitPolicy();
        broken.rightsEndXpath = "";
        AssetRightsComponent component = Fakes.component(broken);

        DownloadDecision decided = component.decideDownload(Fakes.asset().model(), "picture:views/0/content", null,
                null);
        assertEquals(Decision.refuse(Reason.POLICY_ERROR), decided.decision());
    }
}
