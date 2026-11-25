package org.nuxeo.agentic.assets.rights;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * Which use a download is, from what the platform's download permissions are given. Only the
 * canonical forms are named; any other is a use no policy lists.
 */
class DownloadUseTest {

    private static final RightsPolicy KIT = RightsPolicy.of(Fakes.kitPolicy());

    private static Use classify(String xpath, String rendition) {
        DocumentModel doc = Fakes.asset().model();
        return DownloadUse.classify(doc, KIT, xpath, null, rendition);
    }

    @Test
    void theOriginalIsItsXpathAndTheAliasesThatReturnItsBlob() {
        DocumentModel doc = Fakes.asset().model();
        assertEquals(Use.ORIGINAL, classify("file:content", null));
        assertEquals(Use.ORIGINAL, classify("file;content", null));
        assertEquals(Use.ORIGINAL,
                DownloadUse.classify(doc, KIT, "blobholder:0", Fakes.blob("original-digest"), null));
        assertEquals(Use.ORIGINAL, DownloadUse.classify(doc, KIT, null, Fakes.blob("original-digest"), "mainBlob"));
    }

    /** An alias whose blob cannot be compared is not the original: a use no policy lists. */
    @Test
    void anAliasWithNoComparableBlobIsNotTheOriginal() {
        assertEquals(Use.blob("blobholder:0"), classify("blobholder:0", null));
        assertEquals(Use.rendition("mainBlob"), classify(null, "mainBlob"));
        DocumentModel doc = Fakes.asset().model();
        assertEquals(Use.blob("blobholder:0"), DownloadUse.classify(doc, KIT, "blobholder:0", Fakes.blob(null), null));
    }

    /**
     * The review's case: the policy's original is another blob than the main one. Each alias
     * returns the main blob, `file:content`, which the policy does not list: it is not the original,
     * and so is refused, as the explicit xpath is.
     */
    @Test
    void anAliasThatReturnsAnotherBlobThanThePoliciesOriginalIsNotTheOriginal() {
        RightsPolicyDescriptor descriptor = Fakes.kitPolicy();
        descriptor.original = new UseDescriptor(null, "files:files/0/file", "Print", false);
        RightsPolicy policy = RightsPolicy.of(descriptor);
        Fakes.Doc asset = Fakes.asset().original("main-digest");
        asset.properties.put("files:files/0/file", (java.io.Serializable) Fakes.blob("attachment-digest"));
        DocumentModel doc = asset.model();
        org.nuxeo.ecm.core.api.Blob main = Fakes.blob("main-digest");
        org.nuxeo.ecm.core.api.Blob attachment = Fakes.blob("attachment-digest");

        assertEquals(Use.blob("blobholder:0"), DownloadUse.classify(doc, policy, "blobholder:0", main, null));
        assertEquals(Use.rendition("mainBlob"), DownloadUse.classify(doc, policy, null, main, "mainBlob"));
        assertEquals(Use.blob("file:content"), DownloadUse.classify(doc, policy, "file:content", main, null));
        // The configured original itself, through its xpath or an alias that returns it.
        assertEquals(Use.ORIGINAL, DownloadUse.classify(doc, policy, "files:files/0/file", attachment, null));
        assertEquals(Use.ORIGINAL, DownloadUse.classify(doc, policy, "blobholder:0", attachment, null));

        // And so refused, on an asset whose rights cover Print.
        AssetRightsComponent component = Fakes.component(descriptor);
        for (Object[] download : new Object[][] { { "blobholder:0", null }, { null, "mainBlob" },
                { "file:content", null } }) {
            assertEquals(Decision.Reason.NOT_CLEARED,
                    component.decideDownload(doc, (String) download[0], main, (String) download[1]).decision().reason(),
                    java.util.Arrays.toString(download));
        }
        assertEquals(true, component.decideDownload(doc, "files:files/0/file", attachment, null).decision().allowed());
    }

    @Test
    void aViewIsNamedByTheTitleTheDocumentGivesItsPlace() {
        assertEquals(Use.view("Thumbnail"), classify("picture:views/0/content", null));
        assertEquals(Use.view("OriginalJpeg"), classify("picture:views/4/content", null));
        assertEquals(Use.view("FullHD"), classify("picture;views/3/content", null));
    }

    /** A view's place the document does not have, or one written another way, is not named. */
    @Test
    void aViewAddressedAnyOtherWayIsNotNamedAsAView() {
        assertEquals(Use.unknown("picture:views/9/content"), classify("picture:views/9/content", null));
        assertEquals(Use.blob("picture:views/04/content"), classify("picture:views/04/content", null));
        assertEquals(Use.blob("picture:views/item[5]/content"), classify("picture:views/item[5]/content", null));
        assertEquals(Use.blob("picture:views/4/content/"), classify("picture:views/4/content/", null));
        assertEquals(Use.blob("views/4/content"), classify("views/4/content", null));
        // A Picture's later blob holder places are its views: not the original, and not named.
        assertEquals(Use.blob("blobholder:3"), classify("blobholder:3", null));
    }

    @Test
    void aRenditionIsNamedByItsNameWhateverTheXpath() {
        assertEquals(Use.rendition("OriginalJpeg"), classify(null, "OriginalJpeg"));
        assertEquals(Use.rendition("pdf"), classify("file:content", "pdf"));
        assertEquals(Use.rendition(""), classify(null, ""));
    }

    @Test
    void anotherXpathIsABlobNamedByIt() {
        assertEquals(Use.blob("files:files/0/file"), classify("files:files/0/file", null));
    }

    /** Blob.BulkDownload's form: no xpath, the main blob. Only a blob with its digest is the original. */
    @Test
    void withNoXpathOnlyTheMainBlobIsTheOriginal() {
        DocumentModel doc = Fakes.asset().model();

        assertEquals(Use.ORIGINAL, DownloadUse.classify(doc, KIT, null, Fakes.blob("original-digest"), null));
        assertEquals(Use.unknown(null), DownloadUse.classify(doc, KIT, null, Fakes.blob("view-4"), null));
        assertEquals(Use.unknown(null), DownloadUse.classify(doc, KIT, null, Fakes.blob(null), null));
        assertEquals(Use.unknown(null), DownloadUse.classify(doc, KIT, null, null, null));
    }

    @Test
    void aPolicyMayNameAnotherXpathForTheOriginal() {
        RightsPolicyDescriptor descriptor = Fakes.kitPolicy();
        descriptor.original = new UseDescriptor(null, "files:files/0/file", "Print", false);
        RightsPolicy policy = RightsPolicy.of(descriptor);
        DocumentModel doc = Fakes.asset().model();

        assertEquals(Use.ORIGINAL, DownloadUse.classify(doc, policy, "files:files/0/file", null, null));
        assertEquals(Use.blob("file:content"), DownloadUse.classify(doc, policy, "file:content", null, null));
    }
}
