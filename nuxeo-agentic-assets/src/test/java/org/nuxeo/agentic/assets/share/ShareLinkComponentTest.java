package org.nuxeo.agentic.assets.share;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.nuxeo.agentic.assets.share.ShareFakes.NOW;
import static org.nuxeo.agentic.assets.share.ShareFakes.OWNER;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Semaphore;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.assets.rights.AssetFacts;
import org.nuxeo.agentic.assets.rights.AssetRightsComponent;
import org.nuxeo.agentic.assets.rights.AssetRightsService;
import org.nuxeo.agentic.assets.rights.RightsPolicy;
import org.nuxeo.agentic.assets.rights.TestRights;
import org.nuxeo.agentic.assets.share.ShareFakes.Asset;
import org.nuxeo.agentic.assets.share.ShareLinkService.Answer;
import org.nuxeo.agentic.assets.share.ShareLinkService.Busy;
import org.nuxeo.agentic.assets.share.ShareLinkService.Created;
import org.nuxeo.agentic.assets.share.ShareLinkService.NotCreated;
import org.nuxeo.agentic.assets.share.ShareLinkService.Page;
import org.nuxeo.agentic.assets.share.ShareLinkService.Refusal;
import org.nuxeo.agentic.assets.share.ShareLinkService.Refused;
import org.nuxeo.agentic.assets.share.ShareLinkService.Served;
import org.nuxeo.agentic.assets.share.ShareLinkService.Why;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.NuxeoException;

/** Share links made, opened, refused and revoked, deciding with the brand kit's own rights policy. */
class ShareLinkComponentTest {

    private ShareFakes.MovingClock clock;

    private ShareFakes.Store store;

    private ShareFakes.Repository repository;

    private ShareLinkComponent links;

    private Asset asset;

    private final CoreSession owner = ShareFakes.session(OWNER, true);

    @BeforeEach
    void setUp() {
        clock = new ShareFakes.MovingClock();
        store = new ShareFakes.Store();
        repository = new ShareFakes.Repository();
        links = ShareFakes.component(clock, store, repository);
        asset = repository.add(new Asset("asset-a", new Color(200, 30, 30)));
    }

    private Created make(Asset on, String lastDay, String... items) {
        return assertInstanceOf(Created.class, links.create(owner, on.model(), List.of(items), lastDay));
    }

    private static Served served(Answer answer) {
        return assertInstanceOf(Served.class, answer, () -> "served, not " + answer);
    }

    private static void refused(Why why, Answer answer) {
        assertEquals(new Refused(why), answer);
    }

    private static BufferedImage decode(byte[] bytes) throws IOException {
        BufferedImage image = ImageIO.read(new ByteArrayInputStream(bytes));
        assertNotNull(image, "the bytes served are a picture");
        return image;
    }

    // ----- Making a link -----

    @Test
    void aUserWhoMayNotManagePermissionsMakesNoLink() {
        CoreSession reader = ShareFakes.session("reader", false);
        assertThrows(DocumentSecurityException.class,
                () -> links.create(reader, asset.model(), List.of("view:FullHD"), "2026-12-14"));
        assertThrows(DocumentSecurityException.class, () -> links.list(reader, asset.model()));
        assertThrows(DocumentSecurityException.class, () -> links.downloads(reader, asset.model()));
        assertThrows(DocumentSecurityException.class, () -> links.revoke(reader, asset.model(), "0".repeat(64)));
        assertTrue(store.links.isEmpty());
    }

    @Test
    void aLinkIsBoundToItsDocumentItsItemsAndItsLastDayAndKeepsOnlyItsTokensHash() {
        Created created = make(asset, "2026-12-14", "view:FullHD", "view:Medium");
        String token = created.token();

        assertTrue(ShareToken.wellFormed(token));
        assertEquals(ShareToken.hash(token), created.link().id());
        ShareLink kept = store.links.get(created.link().id());
        assertEquals(created.link(), kept);
        assertEquals("asset-a", kept.document());
        assertEquals("default", kept.repository());
        assertEquals(List.of("view:FullHD", "view:Medium"), kept.items());
        assertEquals(LocalDate.of(2026, 12, 14), kept.lastDay());
        assertEquals(NOW, kept.created());
        assertEquals(OWNER, kept.createdBy());
        // Nothing kept holds the token.
        assertFalse(kept.toString().contains(token));
        assertFalse(store.links.containsKey(token));
    }

    @Test
    void eachLinkHasATokenOfItsOwn() {
        Created first = make(asset, "2026-12-14", "view:FullHD");
        Created second = make(asset, "2026-12-14", "view:FullHD");
        assertFalse(first.token().equals(second.token()));
        assertFalse(first.link().id().equals(second.link().id()));
    }

    @Test
    void theItemsAreCheckedBeforeAnythingIsMade() {
        List<List<String>> wrong = new ArrayList<>(List.of(List.of(), List.of("view:"), List.of("view: FullHD"),
                List.of("view:FullHD "), List.of("rendition:FullHD"), List.of("blob:file:content"),
                List.of("file:content"), List.of("picture:views/3/content"), List.of("ORIGINAL"),
                List.of("view:FullHD", "view:FullHD"), List.of("view:" + "x".repeat(65))));
        List<String> eleven = new ArrayList<>();
        for (int i = 0; i < 11; i++) {
            eleven.add("view:V" + i);
        }
        wrong.add(eleven);
        for (List<String> items : wrong) {
            NuxeoException e = assertThrows(NuxeoException.class,
                    () -> links.create(owner, asset.model(), items, "2026-12-14"), items::toString);
            assertEquals(400, e.getStatusCode(), items::toString);
        }
        assertTrue(store.links.isEmpty());
    }

    @Test
    void theLastDayIsFromTodayToNinetyDaysAfterItInUtc() {
        for (String day : List.of("2026-11-23", "2027-02-23", "2026-12-1", "2026-02-30", "14/12/2026", "", "tomorrow")) {
            NuxeoException e = assertThrows(NuxeoException.class,
                    () -> links.create(owner, asset.model(), List.of("view:FullHD"), day), day);
            assertEquals(400, e.getStatusCode(), day);
        }
        assertThrows(NuxeoException.class, () -> links.create(owner, asset.model(), List.of("view:FullHD"), null));
        // Today, and 90 days after it, in UTC: 24 November 2026 and 22 February 2027.
        make(asset, "2026-11-24", "view:FullHD");
        make(asset, "2027-02-22", "view:FullHD");
        // Late on the 24th in UTC, already the 25th east of it: the day is UTC's.
        clock.now = Instant.parse("2026-11-24T23:30:00Z");
        make(asset, "2026-11-24", "view:FullHD");
    }

    @Test
    void aVersionAProxyADocumentInTheTrashOrATypeNoPolicyCoversIsNotShared() {
        for (Runnable change : List.<Runnable> of(() -> asset.version = true, () -> asset.proxy = true,
                () -> asset.trashed = true, () -> asset.type = "Picture")) {
            Asset other = repository.add(new Asset("asset-x", Color.BLUE));
            asset = other;
            change.run();
            NuxeoException e = assertThrows(NuxeoException.class,
                    () -> links.create(owner, other.model(), List.of("view:FullHD"), "2026-12-14"));
            assertEquals(400, e.getStatusCode());
        }
        assertTrue(store.links.isEmpty());
    }

    @Test
    void itemsTheRightsRefuseNowMakeNoLinkAndSayWhy() {
        asset.channels("E-commerce", "Social");
        NotCreated noPrint = assertInstanceOf(NotCreated.class, links.create(owner, asset.model(),
                List.of("original", "view:FullHD", "view:OriginalJpeg", "view:Medium"), "2026-12-14"));
        assertEquals(List.of(new Refusal("original", "channel-not-covered"),
                new Refusal("view:OriginalJpeg", "channel-not-covered")), noPrint.refused());

        asset.channels("E-commerce", "Wholesale", "Social", "Print").rightsEnd("2026-11-23");
        NotCreated ended = assertInstanceOf(NotCreated.class,
                links.create(owner, asset.model(), List.of("view:FullHD", "view:Medium"), "2026-12-14"));
        // A preview too: an ended right ends every share.
        assertEquals(List.of(new Refusal("view:FullHD", "rights-ended"), new Refusal("view:Medium", "rights-ended")),
                ended.refused());

        asset.rightsEnd("2027-12-31").views("Thumbnail", "Small", "Medium", "Poster");
        NotCreated unknown = assertInstanceOf(NotCreated.class,
                links.create(owner, asset.model(), List.of("view:Poster", "view:FullHD"), "2026-12-14"));
        assertEquals(List.of(new Refusal("view:Poster", "not-cleared"), new Refusal("view:FullHD", "no-such-rendition")),
                unknown.refused());

        asset.properties.remove("acmeasset:channels");
        NotCreated unreadable = assertInstanceOf(NotCreated.class,
                links.create(owner, asset.model(), List.of("view:Medium"), "2026-12-14"));
        assertEquals(List.of(new Refusal("view:Medium", "policy-error")), unreadable.refused());

        assertTrue(store.links.isEmpty());
    }

    @Test
    void aDocumentHasAtMostAHundredOpenLinks() {
        for (int i = 0; i < ShareLinkService.MAX_OPEN_LINKS; i++) {
            make(asset, "2026-12-14", "view:FullHD");
        }
        NuxeoException e = assertThrows(NuxeoException.class,
                () -> links.create(owner, asset.model(), List.of("view:FullHD"), "2026-12-14"));
        assertEquals(400, e.getStatusCode());
        // Revoking one makes room.
        ShareLink first = store.links.values().iterator().next();
        links.revoke(owner, asset.model(), first.id());
        make(asset, "2026-12-14", "view:FullHD");
    }

    // ----- Opening a link -----

    @Test
    void anOpenLinkServesItsItemMarkedAndLogsTheDownload() throws IOException {
        Created created = make(asset, "2026-12-14", "view:FullHD");
        clock.now = NOW.plusSeconds(60);

        Served served = served(links.serve(created.token(), "view:FullHD"));

        assertEquals("image/jpeg", served.mimeType());
        assertEquals("view:FullHD", served.item().id());
        byte[] file = ((org.nuxeo.ecm.core.api.Blob) asset.properties.get("picture:views/3/content")).getByteArray();
        assertFalse(java.util.Arrays.equals(file, served.bytes()), "the file itself is never served");
        BufferedImage picture = decode(served.bytes());
        assertEquals(190, picture.getWidth());
        assertEquals(150, picture.getHeight());
        assertEquals(List.of(new ShareDownload(NOW.plusSeconds(60), created.link().id(), "asset-a", "view:FullHD")),
                store.downloads);
    }

    @Test
    void theOriginalIsServedOnlyWhenTheLinkListsItAndTheRightsAllowIt() throws IOException {
        Created web = make(asset, "2026-12-14", "view:FullHD");
        refused(Why.NOT_LISTED, links.serve(web.token(), "original"));

        Created withOriginal = make(asset, "2026-12-14", "original");
        decode(served(links.serve(withOriginal.token(), "original")).bytes());

        asset.channels("E-commerce", "Social");
        refused(Why.RIGHTS_REFUSED, links.serve(withOriginal.token(), "original"));
        assertEquals(1, store.downloads.size());
    }

    @Test
    void anExpiredLinkOpensNothingFromTheFirstInstantAfterItsLastDayInUtc() {
        Created created = make(asset, "2026-11-30", "view:FullHD");
        clock.now = Instant.parse("2026-11-30T23:59:59.999Z");
        served(links.serve(created.token(), "view:FullHD"));
        assertInstanceOf(Page.class, links.page(created.token()));

        clock.now = Instant.parse("2026-12-01T00:00:00Z");
        refused(Why.EXPIRED, links.serve(created.token(), "view:FullHD"));
        refused(Why.EXPIRED, links.page(created.token()));
        assertEquals(1, store.downloads.size());
    }

    @Test
    void aRevokedLinkOpensNothingFromTheNextRequestOn() {
        Created created = make(asset, "2026-12-14", "view:FullHD");
        served(links.serve(created.token(), "view:FullHD"));

        ShareLink revoked = links.revoke(owner, asset.model(), created.link().id());
        assertEquals(NOW, revoked.revoked());
        assertEquals(OWNER, revoked.revokedBy());

        refused(Why.REVOKED, links.serve(created.token(), "view:FullHD"));
        refused(Why.REVOKED, links.page(created.token()));
        // Even once the clock is back before it was revoked: revoked is revoked.
        clock.now = NOW.minusSeconds(3600);
        refused(Why.REVOKED, links.serve(created.token(), "view:FullHD"));
        assertEquals(1, store.downloads.size());
    }

    @Test
    void anItemTheLinkDoesNotListIsRefusedBeforeTheDocumentIsRead() {
        Created created = make(asset, "2026-12-14", "view:FullHD");
        repository.read.clear();
        for (String item : List.of("view:OriginalJpeg", "view:Medium", "view:fullhd", "view:FullHD ", "original",
                "rendition:FullHD", "", "view:FullHD/../OriginalJpeg", "view:" + "picture:views/4/content")) {
            refused(Why.NOT_LISTED, links.serve(created.token(), item));
        }
        assertTrue(repository.read.isEmpty(), repository.read::toString);
        assertTrue(store.downloads.isEmpty());
    }

    @Test
    void aLinkReachesItsOwnDocumentOnlyWhateverElseTheRepositoryHolds() throws IOException {
        Asset other = repository.add(new Asset("asset-b", new Color(30, 30, 200)));
        Created toA = make(asset, "2026-12-14", "view:FullHD");
        Created toB = make(other, "2026-12-14", "view:FullHD");
        repository.read.clear();

        BufferedImage fromA = decode(served(links.serve(toA.token(), "view:FullHD")).bytes());
        BufferedImage fromB = decode(served(links.serve(toB.token(), "view:FullHD")).bytes());

        assertEquals(List.of("asset-a", "asset-b"), repository.read);
        // Each link's pixels are its own document's: red for A, blue for B, under the watermark.
        assertTrue(red(fromA.getRGB(5, 5)) > blue(fromA.getRGB(5, 5)));
        assertTrue(blue(fromB.getRGB(5, 5)) > red(fromB.getRGB(5, 5)));
        assertEquals(List.of("asset-a", "asset-b"), store.downloads.stream().map(ShareDownload::document).toList());
    }

    /** The document read must be the link's own: one handed over for its id that is another is refused. */
    @Test
    void aDocumentThatIsNotTheLinksOwnIsNeverServed() {
        Asset other = repository.add(new Asset("asset-b", new Color(30, 30, 200)));
        Created toA = make(asset, "2026-12-14", "view:FullHD");
        repository.answersWith.put("asset-a", other.id);
        refused(Why.DOCUMENT_GONE, links.serve(toA.token(), "view:FullHD"));
        refused(Why.DOCUMENT_GONE, links.page(toA.token()));
        assertTrue(store.downloads.isEmpty());
    }

    @Test
    void endedRightsEndTheLinkForEveryItemPreviewsIncluded() {
        Created created = make(asset, "2026-12-14", "view:FullHD", "view:Medium", "view:Thumbnail");
        asset.rightsEnd("2026-11-23");

        refused(Why.RIGHTS_ENDED, links.serve(created.token(), "view:FullHD"));
        refused(Why.RIGHTS_ENDED, links.serve(created.token(), "view:Medium"));
        refused(Why.RIGHTS_ENDED, links.page(created.token()));

        // On their last day, in UTC, they still run.
        asset.rightsEnd("2026-11-24");
        served(links.serve(created.token(), "view:Medium"));
        // From the next day, in UTC, they have ended.
        clock.now = Instant.parse("2026-11-25T00:00:00Z");
        refused(Why.RIGHTS_ENDED, links.serve(created.token(), "view:Medium"));
    }

    @Test
    void aChannelTakenOffTheAssetRefusesTheItemsItCovered() {
        Created created = make(asset, "2026-12-14", "view:FullHD", "view:OriginalJpeg");
        asset.channels("Print");
        refused(Why.RIGHTS_REFUSED, links.serve(created.token(), "view:FullHD"));
        served(links.serve(created.token(), "view:OriginalJpeg"));
    }

    @Test
    void aPolicyNoLongerInForceOrRightsThatCannotBeReadEndTheLink() {
        Created created = make(asset, "2026-12-14", "view:FullHD");

        AssetRightsComponent kit = TestRights.kit(clock);
        // As the server answers once the kit's policy is removed, by a hot reload or a package uninstalled.
        AssetRightsService none = new AssetRightsService() {
            @Override
            public RightsPolicy policyFor(String type) {
                return null;
            }

            @Override
            public LocalDate today() {
                return kit.today();
            }

            @Override
            public AssetFacts facts(DocumentModel document, RightsPolicy policy) {
                return kit.facts(document, policy);
            }

            @Override
            public DownloadDecision decideDownload(DocumentModel document, String xpath, Blob blob, String rendition) {
                return null;
            }
        };
        ShareLinkComponent withoutPolicy = ShareFakes.component(clock, store, repository, none, new Semaphore(2));
        refused(Why.NOT_COVERED, withoutPolicy.serve(created.token(), "view:FullHD"));
        refused(Why.NOT_COVERED, withoutPolicy.page(created.token()));

        ShareLinkComponent noService = new ShareLinkComponent(clock, store, repository, () -> null, new Watermarker(),
                new java.security.SecureRandom(), new Semaphore(2), () -> java.util.Set.of(ShareFakes.SHARERS));
        refused(Why.NOT_COVERED, noService.serve(created.token(), "view:FullHD"));

        asset.properties.put("dc:expired", "not a date");
        refused(Why.RIGHTS_REFUSED, links.serve(created.token(), "view:FullHD"));
        assertTrue(store.downloads.isEmpty());
    }

    @Test
    void aCreatorWhoMayNoLongerShareTheDocumentEndsTheLink() {
        Created created = make(asset, "2026-12-14", "view:FullHD");
        repository.mayShare.get(OWNER).remove("asset-a");
        refused(Why.CREATOR_MAY_NOT_SHARE, links.serve(created.token(), "view:FullHD"));
        refused(Why.CREATOR_MAY_NOT_SHARE, links.page(created.token()));
    }

    @Test
    void aDocumentGoneInTheTrashOrReplacedEndsTheLink() {
        Created created = make(asset, "2026-12-14", "view:FullHD");
        asset.trashed = true;
        refused(Why.DOCUMENT_GONE, links.serve(created.token(), "view:FullHD"));
        asset.trashed = false;
        asset.proxy = true;
        refused(Why.DOCUMENT_GONE, links.serve(created.token(), "view:FullHD"));
        asset.proxy = false;
        repository.documents.remove("asset-a");
        refused(Why.DOCUMENT_GONE, links.serve(created.token(), "view:FullHD"));
        refused(Why.DOCUMENT_GONE, links.page(created.token()));
    }

    @Test
    void aTokenThatIsNotOneIsRefusedBeforeTheStoreIsRead() {
        Created created = make(asset, "2026-12-14", "view:FullHD");
        String token = created.token();
        store.finds = 0;
        for (String wrong : new String[] { null, "", token.substring(1), token + "A", token.replace(token.charAt(5), '+'),
                created.link().id(), token.substring(0, 42) + "=", "../../api/v1/id/asset-b" }) {
            refused(Why.MALFORMED, links.serve(wrong, "view:FullHD"));
            refused(Why.MALFORMED, links.page(wrong));
        }
        assertEquals(0, store.finds);

        // A token of the right form that no link has.
        refused(Why.UNKNOWN, links.serve(ShareToken.generate(new java.security.SecureRandom()), "view:FullHD"));
        assertEquals(1, store.finds);
    }

    @Test
    void aStoreThatFindsALinkByAHashOtherThanItsOwnIsNotTrusted() {
        Created created = make(asset, "2026-12-14", "view:FullHD");
        // As a database whose collation ignores case would answer an id written in capitals.
        ShareLink loose = created.link();
        ShareLink upper = new ShareLink(loose.id().toUpperCase(), loose.repository(), loose.document(), loose.items(),
                loose.digests(), loose.lastDay(), loose.created(), loose.createdBy(), null, null);
        store.links.put(loose.id(), upper);
        refused(Why.UNKNOWN, links.serve(created.token(), "view:FullHD"));
    }

    @Test
    void thePageListsOnlyWhatMayBeServedNowAndServesNoBytes() {
        Created created = make(asset, "2026-12-14", "original", "view:FullHD", "view:Medium");
        asset.channels("E-commerce");

        Page page = assertInstanceOf(Page.class, links.page(created.token()));
        assertEquals(List.of("view:FullHD", "view:Medium"), page.items().stream().map(ShareItem::id).toList());
        assertTrue(store.downloads.isEmpty());

        // When nothing it lists may be served, it opens nothing, not an empty page.
        Created printOnly = make(asset.channels("Print"), "2026-12-14", "original");
        asset.channels("E-commerce");
        refused(Why.RIGHTS_REFUSED, links.page(printOnly.token()));
    }

    @Test
    void aFileTheWatermarkCannotBeDrawnOnIsNotServed() {
        asset.viewFile(3, ShareFakes.blob("GIF89a not really".getBytes(), "image/gif"));
        asset.viewFile(2, ShareFakes.blob(ShareFakes.picture(20, 20, Color.GREEN, "gif",
                BufferedImage.TYPE_INT_RGB), "image/gif"));
        Created created = make(asset, "2026-12-14", "view:FullHD", "view:Medium");
        refused(Why.NOT_AN_IMAGE, links.serve(created.token(), "view:FullHD"));
        refused(Why.NOT_AN_IMAGE, links.serve(created.token(), "view:Medium"));
        assertTrue(store.downloads.isEmpty());
    }

    @Test
    void tooManyMarkedAtOnceIsTryAgainNotTheFile() {
        Created created = make(asset, "2026-12-14", "view:FullHD");
        ShareLinkComponent full = ShareFakes.component(clock, store, repository, TestRights.kit(clock),
                new Semaphore(0));
        assertInstanceOf(Busy.class, full.serve(created.token(), "view:FullHD"));
        assertTrue(store.downloads.isEmpty());
    }

    @Test
    void aDownloadThatCannotBeLoggedIsNotServed() {
        Created created = make(asset, "2026-12-14", "view:FullHD");
        store.failLogging = true;
        refused(Why.ERROR, links.serve(created.token(), "view:FullHD"));
    }

    // ----- Bound to the files, the sharers and one turn per link -----

    /**
     * A user who may write the asset renames its views, so that the title a link lists names the
     * print view: the link was made for another file, and serves nothing for that item.
     */
    @Test
    void aViewRenamedOrReplacedEndsTheLinkForIt() throws IOException {
        Created created = make(asset, "2026-12-14", "view:Small", "view:Medium");
        decode(served(links.serve(created.token(), "view:Small")).bytes());

        asset.properties.put("picture:views/1/title", "Small-old");
        asset.properties.put("picture:views/4/title", "Small");
        refused(Why.CHANGED, links.serve(created.token(), "view:Small"));
        // Put back, the same file is served again.
        asset.properties.put("picture:views/1/title", "Small");
        asset.properties.put("picture:views/4/title", "OriginalJpeg");
        served(links.serve(created.token(), "view:Small"));

        // The picture replaced: its views are other files.
        asset.viewFile(2, ShareFakes.blob(ShareFakes.jpeg(180, 140, Color.BLACK), "image/jpeg"));
        refused(Why.CHANGED, links.serve(created.token(), "view:Medium"));
        // And the page no longer lists it.
        assertEquals(List.of("view:Small"),
                assertInstanceOf(Page.class, links.page(created.token())).items().stream().map(ShareItem::id).toList());
    }

    @Test
    void theOriginalReplacedEndsTheLinkForIt() {
        Created created = make(asset, "2026-12-14", "original");
        asset.properties.put("file:content",
                (java.io.Serializable) ShareFakes.blob(ShareFakes.jpeg(320, 240, Color.BLACK), "image/jpeg"));
        refused(Why.CHANGED, links.serve(created.token(), "original"));
    }

    @Test
    void aFileWithNoDigestIsNotShared() {
        asset.viewFile(3, ShareFakes.undigested(ShareFakes.jpeg(190, 150, Color.RED), "image/jpeg"));
        NotCreated none = assertInstanceOf(NotCreated.class,
                links.create(owner, asset.model(), List.of("view:FullHD"), "2026-12-14"));
        assertEquals(List.of(new Refusal("view:FullHD", "no-such-rendition")), none.refused());
    }

    /**
     * WriteSecurity is everyone's on their own workspace, and on a copy of any asset they may read
     * put there: making a link needs the sharing group too, or an administrator.
     */
    @Test
    void onlyAnAdministratorOrAMemberOfASharingGroupMakesALink() {
        CoreSession manager = ShareFakes.session("workspace.owner", true);
        DocumentSecurityException e = assertThrows(DocumentSecurityException.class,
                () -> links.create(manager, asset.model(), List.of("view:FullHD"), "2026-12-14"));
        assertTrue(e.getMessage().contains(ShareLinkService.SHARING_GROUPS_PROPERTY), e.getMessage());
        CoreSession otherGroup = ShareFakes.session("workspace.owner", true, false, List.of("members"));
        assertThrows(DocumentSecurityException.class,
                () -> links.create(otherGroup, asset.model(), List.of("view:FullHD"), "2026-12-14"));
        assertTrue(store.links.isEmpty());

        // The same user still lists, revokes and reads the downloads: stopping a link is not sharing.
        Created created = make(asset, "2026-12-14", "view:FullHD");
        assertEquals(1, links.list(manager, asset.model()).size());
        links.downloads(manager, asset.model());
        links.revoke(manager, asset.model(), created.link().id());
        refused(Why.REVOKED, links.serve(created.token(), "view:FullHD"));

        CoreSession administrator = ShareFakes.session("Administrator", true, true, List.of());
        assertInstanceOf(Created.class,
                links.create(administrator, asset.model(), List.of("view:FullHD"), "2026-12-14"));
    }

    @Test
    void aCreatorNoLongerInASharingGroupEndsTheLink() {
        Created created = make(asset, "2026-12-14", "view:FullHD");
        repository.groups.get(OWNER).remove(ShareFakes.SHARERS);
        refused(Why.CREATOR_MAY_NOT_SHARE, links.serve(created.token(), "view:FullHD"));
        repository.administrators.add(OWNER);
        served(links.serve(created.token(), "view:FullHD"));
    }

    @Test
    void theSharingGroupsAreTheCommaSeparatedNamesOfTheProperty() {
        assertEquals(java.util.Set.of(), ShareLinkComponent.groups(null));
        assertEquals(java.util.Set.of(), ShareLinkComponent.groups(""));
        assertEquals(java.util.Set.of(), ShareLinkComponent.groups(" , "));
        assertEquals(java.util.Set.of("brand-sharers", "legal"), ShareLinkComponent.groups(" brand-sharers ,legal,"));
    }

    /** Every open link is listed however many newer closed ones there are, and counted towards the limit. */
    @Test
    void everyOpenLinkIsListedAndCountedHoweverOld() {
        Created old = make(asset, "2026-12-14", "view:FullHD");
        for (int i = 0; i < ShareLinkService.MAX_LISTED + 50; i++) {
            clock.now = NOW.plusSeconds(i + 1);
            Created newer = make(asset, "2026-12-14", "view:Medium");
            links.revoke(owner, asset.model(), newer.link().id());
        }
        List<ShareLink> listed = links.list(owner, asset.model());
        assertEquals(ShareLinkService.MAX_LISTED, listed.size());
        assertTrue(listed.stream().anyMatch(link -> link.id().equals(old.link().id())), "the open link is listed");
        // Newest first still.
        assertEquals(old.link().id(), listed.get(listed.size() - 1).id());
    }

    /** One link's items are marked one at a time: a second request through it waits for nothing and is told to try again. */
    @Test
    void oneLinkMarksOneItemAtATimeAndLeavesTheOtherTurnToOthers() throws Exception {
        java.util.concurrent.CountDownLatch inside = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        Watermarker slow = new Watermarker() {
            @Override
            public byte[] watermark(org.nuxeo.ecm.core.api.Blob blob, String text) throws WatermarkException {
                if (text.contains(slowLabel)) {
                    inside.countDown();
                    try {
                        release.await();
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }
                return super.watermark(blob, text);
            }
        };
        Asset other = repository.add(new Asset("asset-b", Color.BLUE));
        ShareLinkComponent shared = ShareFakes.component(clock, store, repository, TestRights.kit(clock),
                new Semaphore(2), slow);
        Created busy = assertInstanceOf(Created.class,
                shared.create(owner, asset.model(), List.of("view:FullHD", "view:Medium"), "2026-12-14"));
        Created calm = assertInstanceOf(Created.class,
                shared.create(owner, other.model(), List.of("view:Small"), "2026-12-14"));
        slowLabel = busy.link().label();

        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newSingleThreadExecutor();
        try {
            java.util.concurrent.Future<Answer> first = pool.submit(() -> shared.serve(busy.token(), "view:FullHD"));
            assertTrue(inside.await(10, java.util.concurrent.TimeUnit.SECONDS));
            long started = System.nanoTime();
            assertInstanceOf(Busy.class, shared.serve(busy.token(), "view:Medium"));
            assertTrue(System.nanoTime() - started < 1_000_000_000L, "told at once, not after a wait");
            served(shared.serve(calm.token(), "view:Small"));
            release.countDown();
            served(first.get(10, java.util.concurrent.TimeUnit.SECONDS));
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
        // Its turn given back, the link marks again.
        served(shared.serve(busy.token(), "view:Medium"));
    }

    private volatile String slowLabel = "none";

    // ----- Managing a document's links -----

    @Test
    void revokingAnotherDocumentsLinkOrOneThatIsNotThereIsNotFound() {
        Asset other = repository.add(new Asset("asset-b", Color.BLUE));
        Created toB = make(other, "2026-12-14", "view:FullHD");

        NuxeoException another = assertThrows(NuxeoException.class,
                () -> links.revoke(owner, asset.model(), toB.link().id()));
        assertEquals(404, another.getStatusCode());
        NuxeoException none = assertThrows(NuxeoException.class, () -> links.revoke(owner, asset.model(), "a".repeat(64)));
        assertEquals(404, none.getStatusCode());
        NuxeoException token = assertThrows(NuxeoException.class, () -> links.revoke(owner, other.model(), toB.token()));
        assertEquals(400, token.getStatusCode());
        // B's link still opens.
        served(links.serve(toB.token(), "view:FullHD"));
    }

    @Test
    void revokingTwiceKeepsTheFirstRevocation() {
        Created created = make(asset, "2026-12-14", "view:FullHD");
        links.revoke(owner, asset.model(), created.link().id());
        clock.now = NOW.plusSeconds(300);
        ShareLink again = links.revoke(ShareFakes.session("someone.else", true), asset.model(), created.link().id());
        assertEquals(NOW, again.revoked());
        assertEquals(OWNER, again.revokedBy());
    }

    @Test
    void aDocumentsLinksAndDownloadsAreItsOwnNewestFirst() {
        Asset other = repository.add(new Asset("asset-b", Color.BLUE));
        Created first = make(asset, "2026-12-14", "view:FullHD");
        clock.now = NOW.plusSeconds(10);
        Created second = make(asset, "2026-12-14", "view:Medium");
        make(other, "2026-12-14", "view:FullHD");

        assertEquals(List.of(second.link().id(), first.link().id()),
                links.list(owner, asset.model()).stream().map(ShareLink::id).toList());

        served(links.serve(first.token(), "view:FullHD"));
        clock.now = NOW.plusSeconds(20);
        served(links.serve(second.token(), "view:Medium"));
        assertEquals(List.of("view:Medium", "view:FullHD"),
                links.downloads(owner, asset.model()).downloads().stream().map(ShareDownload::item).toList());
        assertTrue(links.downloads(owner, other.model()).downloads().isEmpty());
    }

    @Test
    void theWatermarkNamesTheLinkAndItsLastDay() {
        Created created = make(asset, "2026-12-14", "view:FullHD");
        assertEquals("SHARED " + created.link().id().substring(0, 8) + " UNTIL 2026-12-14 UTC",
                ShareLinkComponent.watermarkText(created.link()));
    }

    @Test
    void theSameItemServedTwiceIsMarkedTheSameWayAndLoggedTwice() {
        Created created = make(asset, "2026-12-14", "view:FullHD");
        byte[] once = served(links.serve(created.token(), "view:FullHD")).bytes();
        byte[] twice = served(links.serve(created.token(), "view:FullHD")).bytes();
        assertArrayEquals(once, twice);
        assertEquals(2, store.downloads.size());
    }

    private static int red(int rgb) {
        return (rgb >> 16) & 0xff;
    }

    private static int blue(int rgb) {
        return rgb & 0xff;
    }
}
