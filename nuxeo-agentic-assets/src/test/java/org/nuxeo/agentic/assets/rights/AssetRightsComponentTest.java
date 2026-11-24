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
                component.decideDownload(noSchema.model(), "picture:views/3/content", null, null).decision());
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

    /**
     * A version keeps the rights it had when it was made: its live document's, narrowed since,
     * decide. Here the version still holds Print, and the live asset no longer does.
     */
    @Test
    void aVersionOrAProxyIsDecidedByItsLiveDocumentsRights() {
        DocumentModel live = Fakes.asset().channels("E-commerce").model();
        Fakes.Doc version = Fakes.asset();
        version.version = true;
        Fakes.Doc proxy = Fakes.asset();
        proxy.proxy = true;
        AssetRightsComponent component = Fakes.component(
                document -> document.isVersion() || document.isProxy() ? live : document,
                (container, types) -> false, Fakes.kitPolicy());

        for (DocumentModel copy : new DocumentModel[] { version.model(), proxy.model() }) {
            DownloadDecision decided = component.decideDownload(copy, "file:content", null, null);
            assertEquals(Reason.CHANNEL_NOT_COVERED, decided.decision().reason(), copy::toString);
        }
        assertTrue(component.decideDownload(Fakes.asset().model(), "file:content", null, null).decision().allowed(),
                "the live document, which still holds Print here, is served");
    }

    @Test
    void aVersionWhoseLiveDocumentCannotBeFoundIsRefused() {
        Fakes.Doc version = Fakes.asset();
        version.version = true;
        AssetRightsComponent component = Fakes.component(document -> {
            throw new IllegalStateException("no live document");
        }, (container, types) -> false, Fakes.kitPolicy());

        assertEquals(Decision.refuse(Reason.POLICY_ERROR),
                component.decideDownload(version.model(), "file:content", null, null).decision());
    }

    /** The live lookup itself: the document is its own source, and a version with no session refuses. */
    @Test
    void theLiveDocumentOfALiveDocumentIsItselfAndAVersionNeedsASession() {
        DocumentModel live = Fakes.asset().model();
        assertTrue(AssetRightsComponent.liveDocument(live) == live);

        Fakes.Doc version = Fakes.asset();
        version.version = true;
        DocumentModel detached = version.model();
        org.junit.jupiter.api.Assertions.assertThrows(RuntimeException.class,
                () -> AssetRightsComponent.liveDocument(detached));
    }

    /** A preview is served without its rights being read: a mistake in them does not reach the thumbnails. */
    @Test
    void aPreviewIsServedWithoutReadingTheRights() {
        Fakes.Doc unreadable = Fakes.asset();
        unreadable.properties.remove("dc:expired");
        AssetRightsComponent component = Fakes.component(Fakes.kitPolicy());

        assertTrue(component.decideDownload(unreadable.model(), "picture:views/2/content", null, null)
                            .decision()
                            .allowed());
        assertTrue(unreadable.read.stream().noneMatch(xpath -> xpath.startsWith("dc:") || xpath.startsWith("acmeasset:")),
                unreadable.read::toString);
        assertEquals(Reason.POLICY_ERROR,
                component.decideDownload(unreadable.model(), "picture:views/3/content", null, null).decision().reason());
    }

    /** A folder's tree export holds every asset in it, under the folder's own type. */
    @Test
    void aContainerHoldingACoveredAssetIsRefusedItsRenditionsButItsThumbnail() {
        java.util.List<java.util.Set<String>> asked = new java.util.ArrayList<>();
        AssetRightsComponent component = Fakes.component(document -> document, (container, types) -> {
            asked.add(types);
            return true;
        }, Fakes.kitPolicy());
        Fakes.Doc folder = new Fakes.Doc();
        folder.type = "Folder";
        folder.folder = true;
        Fakes.Doc collection = new Fakes.Doc();
        collection.type = "Collection";
        collection.facets.add("Collection");

        for (DocumentModel container : new DocumentModel[] { folder.model(), collection.model() }) {
            for (String rendition : new String[] { "zipTreeExport", "containerDefaultRendition", "xmlExport" }) {
                DownloadDecision decided = component.decideDownload(container, null, null, rendition);
                assertEquals(Decision.refuse(Reason.CONTAINS_ASSETS), decided.decision(), rendition);
            }
            assertNull(component.decideDownload(container, null, null, "thumbnail"));
        }
        assertEquals(java.util.Set.of("AcmeAsset"), asked.get(0));
    }

    @Test
    void aContainerHoldingNoCoveredAssetAndAnyOtherDocumentAreNotDecided() {
        AssetRightsComponent component = Fakes.component(document -> document, (container, types) -> false,
                Fakes.kitPolicy());
        Fakes.Doc folder = new Fakes.Doc();
        folder.type = "Folder";
        folder.folder = true;
        Fakes.Doc file = new Fakes.Doc();
        file.type = "File";

        assertNull(component.decideDownload(folder.model(), null, null, "zipTreeExport"));
        assertNull(component.decideDownload(file.model(), null, null, "zipExport"));
        assertNull(component.decideDownload(folder.model(), "file:content", null, null));
        // With no policy in force at all, nothing is asked.
        assertNull(Fakes.component(document -> document, (container, types) -> {
            throw new AssertionError("asked");
        }).decideDownload(folder.model(), null, null, "zipTreeExport"));
    }

    @Test
    void aContainerWhoseContentsCannotBeAskedIsRefused() {
        AssetRightsComponent component = Fakes.component(document -> document, (container, types) -> {
            throw new IllegalStateException("query failed");
        }, Fakes.kitPolicy());
        Fakes.Doc folder = new Fakes.Doc();
        folder.type = "Folder";
        folder.folder = true;

        assertEquals(Decision.refuse(Reason.POLICY_ERROR),
                component.decideDownload(folder.model(), null, null, "zipTreeExport").decision());
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
