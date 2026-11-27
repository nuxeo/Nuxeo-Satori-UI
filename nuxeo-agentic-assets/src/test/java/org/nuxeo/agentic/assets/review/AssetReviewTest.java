/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.review;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.StringWriter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.PermissionProvider;
import org.nuxeo.ecm.core.query.sql.model.OrderByExprs;
import org.nuxeo.ecm.core.query.sql.model.Predicates;
import org.nuxeo.ecm.core.query.sql.model.QueryBuilder;
import org.nuxeo.ecm.core.security.SecurityService;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.core.test.annotations.Granularity;
import org.nuxeo.ecm.core.test.annotations.RepositoryConfig;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.ecm.platform.usermanager.UserManager;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.test.runner.TransactionalFeature;
import org.nuxeo.runtime.transaction.TransactionHelper;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * An asset's review decided on the server, in a real Nuxeo runtime and repository: the add-on's
 * review service and listener, the brand assets kit's own review policy, copied from the kit by the
 * build, the user manager with its test directories, and the platform's audit.
 *
 * <pre>
 * group creative-review: rita, carol     group brand-team: bob
 * /assets: brand-team ReadWrite, creative-review Read and ReviewAsset, bob ReviewAsset
 * /other:  creative-review Read, carol Everything
 * </pre>
 *
 * Annotations are written as the platform's comment manager writes them ({@link ReviewAnnotations}).
 */
@RunWith(FeaturesRunner.class)
@Features({ CoreFeature.class, AssetsAuditFeature.class })
@RepositoryConfig(cleanup = Granularity.METHOD)
@Deploy("org.nuxeo.ecm.platform.tag:OSGI-INF/faceted-tag-service-core-types.xml")
@Deploy("org.nuxeo.ecm.platform.picture.core:OSGI-INF/picture-schemas-contrib.xml")
@Deploy("org.nuxeo.ecm.platform.comment:OSGI-INF/comment-schemas-contrib.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-review-service.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-review-listener.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-asset-model-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/kit/brand-assets-demo-review.xml")
public class AssetReviewTest {

    static final String REVIEWERS = "creative-review";

    static final String BRAND = "brand-team";

    /** A reviewer: in creative-review, which is granted ReviewAsset on /assets. */
    static final String RITA = "rita";

    /** In creative-review, on a folder where nobody is granted ReviewAsset, and holding Everything there. */
    static final String CAROL = "carol";

    /** Writes the assets, is granted ReviewAsset on /assets by name, and is in no reviewer group. */
    static final String BOB = "bob";

    static final String ADMINISTRATOR = "Administrator";

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    @Inject
    protected TransactionalFeature transactions;

    private String repository;

    private String asset;

    private String elsewhere;

    @Before
    public void setUp() {
        repository = core.getRepositoryName();
        people();
        folder("assets", List.of(new ACE(BRAND, "ReadWrite", true), new ACE(REVIEWERS, "Read", true),
                new ACE(REVIEWERS, AssetReviews.PERMISSION, true), new ACE(BOB, AssetReviews.PERMISSION, true)));
        folder("other", List.of(new ACE(REVIEWERS, "Read", true), new ACE(CAROL, "Everything", true)));
        asset = picture("/assets", "ast-501", "AcmeAsset");
        elsewhere = picture("/other", "ast-502", "AcmeAsset");
        transactions.nextTransaction();
    }

    // ------------------------------------------------------------------ who may decide

    @Test
    public void theAddOnsPermissionIsRegisteredAndShown() {
        PermissionProvider permissions = Framework.getService(SecurityService.class).getPermissionProvider();
        assertTrue(Arrays.asList(permissions.getPermissions()).contains(AssetReviews.PERMISSION));
        assertTrue(permissions.getUserVisiblePermissionDescriptors()
                              .stream()
                              .anyMatch(p -> AssetReviews.PERMISSION.equals(p.getPermission())));
    }

    @Test
    public void aReviewerSendsARoundBackAndApprovesAndEachDecisionIsAudited() {
        String back = write(RITA, asset, ReviewAnnotations.sendBack(1));
        String approved = write(RITA, asset, ReviewAnnotations.decision(2, "approved"));
        // The server's author, whatever the request wrote.
        assertEquals(RITA, stored(back).getPropertyValue("comment:author"));
        assertEquals(RITA, stored(approved).getPropertyValue("comment:author"));

        transactions.nextTransaction();
        List<LogEntry> entries = entries(asset);
        assertEquals(2, entries.size());
        assertEquals(RITA, entries.get(0).getPrincipalName());
        assertEquals("assetReview", entries.get(0).getCategory());
        assertEquals("Review round 1: sent back", entries.get(0).getComment());
        Map<String, Object> first = AuditAccess.extended(entries.get(0));
        assertEquals("sent-back", first.get("decision"));
        assertEquals(1L, ((Number) first.get("round")).longValue());
        assertEquals(back, first.get("annotation"));
        assertEquals(RITA, first.get("by"));
        Map<String, Object> second = AuditAccess.extended(entries.get(1));
        assertEquals("approved", second.get("decision"));
        assertEquals(approved, second.get("annotation"));
    }

    @Test
    public void theServerWritesTheAuthorWhateverTheRequestSaid() {
        String id = inTransaction(RITA, s -> ReviewAnnotations.write(s, asset, AssetReviews.XPATH, AssetReviews.ORIGIN,
                ReviewAnnotations.sendBack(1), "note", "someone-else").getId());
        assertEquals(RITA, stored(id).getPropertyValue("comment:author"));
    }

    @Test
    public void aRejectionConcludesTheReviewToo() {
        write(RITA, asset, ReviewAnnotations.decision(1, "rejected"));
        ReviewRefusal refusal = refused(RITA, asset, ReviewAnnotations.decision(1, "approved"));
        assertEquals(409, refusal.getStatusCode());
        assertEquals("concluded", refusal.getCode());
        assertEquals(409, refused(RITA, asset, ReviewAnnotations.sendBack(1)).getStatusCode());
    }

    @Test
    public void theAddOnsPermissionWithoutAReviewerGroupIsRefused() {
        // bob is granted ReviewAsset on /assets by name, and may write the asset: neither is enough.
        ReviewRefusal refusal = refused(BOB, asset, ReviewAnnotations.decision(1, "approved"));
        assertEquals(403, refusal.getStatusCode());
        assertEquals("not-a-reviewer", refusal.getCode());
        assertTrue(refusal.getMessage(), refusal.getMessage().contains("ReviewAsset"));
        assertTrue(refusal.getMessage(), refusal.getMessage().contains(REVIEWERS));
        assertEquals(403, refused(BOB, asset, ReviewAnnotations.sendBack(1)).getStatusCode());
        nothingAudited(asset);
    }

    @Test
    public void aReviewerGroupWithoutThePermissionIsRefusedAndEverythingDoesNotGrantIt() {
        // carol is in creative-review, and holds Everything on /other, where no one is granted ReviewAsset.
        ReviewRefusal refusal = refused(CAROL, elsewhere, ReviewAnnotations.decision(1, "approved"));
        assertEquals(403, refusal.getStatusCode());
        assertEquals("not-a-reviewer", refusal.getCode());
        // On /assets, where her group is granted it, she may.
        assertNotNull(write(CAROL, asset, ReviewAnnotations.sendBack(1)));
    }

    @Test
    public void anAdministratorIsRefusedUntilGranted() {
        assertEquals("not-a-reviewer", refused(ADMINISTRATOR, asset, ReviewAnnotations.sendBack(1)).getCode());
        // Granted: in the reviewer group, which holds the permission on /assets.
        join(ADMINISTRATOR, REVIEWERS);
        assertNotNull(write(ADMINISTRATOR, asset, ReviewAnnotations.sendBack(1)));
    }

    @Test
    public void aGrantAboveABlockedInheritanceIsNotHeld() {
        // Nuxeo refuses a denial but its own block, Everyone denied Everything, met first.
        DocumentModel sealed = session.createDocument(session.createDocumentModel("/assets", "sealed", "Folder"));
        ACP acp = sealed.getACP();
        ACL local = acp.getOrCreateACL();
        local.add(new ACE(REVIEWERS, "Read", true));
        local.add(ACE.BLOCK);
        session.setACP(sealed.getRef(), acp, true);
        session.save();
        String inside = picture("/assets/sealed", "ast-503", "AcmeAsset");
        transactions.nextTransaction();
        assertEquals("not-a-reviewer", refused(RITA, inside, ReviewAnnotations.sendBack(1)).getCode());
    }

    @Test
    public void aTypeWithNoReviewPolicyIsNotReviewable() {
        String plain = picture("/assets", "plain", "Picture");
        transactions.nextTransaction();
        ReviewRefusal refusal = refused(RITA, plain, ReviewAnnotations.decision(1, "approved"));
        assertEquals(403, refusal.getStatusCode());
        assertEquals("not-reviewable", refusal.getCode());
    }

    // ------------------------------------------------------------------ pins, and what is not a pin

    @Test
    public void aPinStaysAnyonesWhoMayCommentAndAnythingElseOfTheReviewsOriginIsHeld() {
        assertNotNull(write(BOB, asset, ReviewAnnotations.pin(1, 0.25, 0.5)));
        // Spelled otherwise, it is no pin: held as a decision, and bob may decide none.
        for (String entity : List.of("{\"kind\":\"pin\",\"version\":2,\"round\":1,\"x\":0.1,\"y\":0.1}",
                // A key written twice, its last a pin's, is read strictly, not as its last: no pin.
                "{\"kind\":\"decision\",\"decision\":\"approved\",\"version\":1,\"round\":1,\"x\":0.1,\"y\":0.1,\"kind\":\"pin\"}",
                "{\"kind\":\"pin\",\"version\":1,\"round\":1,\"x\":2,\"y\":0.1}", "not json",
                "{\"kind\":\"approve\",\"version\":1,\"round\":1}")) {
            assertEquals(entity, "not-a-reviewer", refused(BOB, asset, entity).getCode());
        }
        // Of another origin, or on another file, it is not the review's.
        assertNotNull(written(BOB, asset, AssetReviews.XPATH, "someone-else", ReviewAnnotations.sendBack(1)));
        nothingAudited(asset);
    }

    @Test
    public void aDecisionMustBeOfTheReviewsFormOnTheAssetsViews() {
        ReviewRefusal refusal = refused(RITA, asset, "{\"kind\":\"decision\",\"version\":1,\"round\":1,\"decision\":\"maybe\"}");
        assertEquals(400, refusal.getStatusCode());
        assertEquals("invalid", refusal.getCode());
        ReviewRefusal elsewhereFile = refusedOn(RITA, asset, "file:content", ReviewAnnotations.sendBack(1));
        assertEquals(400, elsewhereFile.getStatusCode());
    }

    // ------------------------------------------------------------------ a decision kept

    @Test
    public void aDecisionIsKeptAsItWasWrittenAndAPinIsNotTurnedIntoOne() {
        String decided = write(RITA, asset, ReviewAnnotations.sendBack(1));
        // As the comment manager updates a comment for its author, in a privileged session.
        ReviewRefusal changed = refusedTo(RITA, s -> CoreInstance.doPrivileged(s, (CoreSession privileged) -> {
            DocumentModel doc = privileged.getDocument(new IdRef(decided));
            doc.setPropertyValue("externalEntity:entity", ReviewAnnotations.decision(1, "approved"));
            return privileged.saveDocument(doc);
        }));
        assertEquals("kept", changed.getCode());
        // Its note is Nuxeo's to allow.
        inTransaction(ADMINISTRATOR, s -> {
            DocumentModel doc = s.getDocument(new IdRef(decided));
            doc.setPropertyValue("comment:text", "Sent back: the hood's seam");
            return s.saveDocument(doc);
        });
        String pin = write(BOB, asset, ReviewAnnotations.pin(2, 0.5, 0.5));
        ReviewRefusal turned = refusedTo(ADMINISTRATOR, s -> {
            DocumentModel doc = s.getDocument(new IdRef(pin));
            doc.setPropertyValue("externalEntity:entity", ReviewAnnotations.decision(2, "approved"));
            return s.saveDocument(doc);
        });
        assertEquals("kept", turned.getCode());
    }

    @Test
    public void aDecisionIsDeletedByAnAdministratorAlone() {
        String decided = write(RITA, asset, ReviewAnnotations.sendBack(1));
        ReviewRefusal refusal = refusedTo(RITA, s -> CoreInstance.doPrivileged(s, (CoreSession privileged) -> {
            // As the comment manager deletes a comment for its author.
            privileged.removeDocument(new IdRef(decided));
            return null;
        }));
        assertEquals("kept", refusal.getCode());
        inTransaction(ADMINISTRATOR, s -> {
            s.removeDocument(new IdRef(decided));
            return null;
        });
        assertFalse(TransactionHelper.runInTransaction(
                () -> CoreInstance.doPrivileged(repository, (CoreSession s) -> s.exists(new IdRef(decided)))));
    }

    // ------------------------------------------------------------------ what the page is told

    @Test
    public void theEnricherSaysWhoMayDecide() throws Exception {
        assertEquals("{\"type\":\"AcmeAsset\",\"mayDecide\":true,\"reason\":null,\"permission\":\"ReviewAsset\"}",
                enriched(RITA, asset).toString());
        assertEquals("not-a-reviewer", enriched(BOB, asset).get("reason").asText());
        assertFalse(enriched(ADMINISTRATOR, asset).get("mayDecide").asBoolean());
        assertFalse(enriched(CAROL, elsewhere).get("mayDecide").asBoolean());
        String plain = picture("/assets", "plain", "Picture");
        transactions.nextTransaction();
        assertTrue(enriched(RITA, plain).isNull());
    }

    // ------------------------------------------------------------------ helpers

    private void people() {
        UserManager users = Framework.getService(UserManager.class);
        Framework.doPrivileged(() -> {
            for (String group : List.of(REVIEWERS, BRAND)) {
                if (users.getGroup(group) == null) {
                    DocumentModel model = users.getBareGroupModel();
                    model.setProperty(users.getGroupSchemaName(), "groupname", group);
                    users.createGroup(model);
                }
            }
            person(users, RITA, List.of(REVIEWERS));
            person(users, CAROL, List.of(REVIEWERS));
            person(users, BOB, List.of(BRAND));
        });
    }

    private static void person(UserManager users, String name, List<String> groups) {
        DocumentModel existing = users.getUserModel(name);
        if (existing != null) {
            existing.setProperty(users.getUserSchemaName(), "groups", new ArrayList<>(groups));
            users.updateUser(existing);
            return;
        }
        DocumentModel model = users.getBareUserModel();
        model.setProperty(users.getUserSchemaName(), "username", name);
        model.setProperty(users.getUserSchemaName(), "groups", new ArrayList<>(groups));
        users.createUser(model);
    }

    private void join(String user, String group) {
        UserManager users = Framework.getService(UserManager.class);
        Framework.doPrivileged(() -> {
            DocumentModel model = users.getUserModel(user);
            @SuppressWarnings("unchecked")
            List<String> groups = new ArrayList<>((List<String>) model.getProperty(users.getUserSchemaName(), "groups"));
            groups.add(group);
            model.setProperty(users.getUserSchemaName(), "groups", groups);
            users.updateUser(model);
        });
    }

    private static NuxeoPrincipal principal(String user) {
        UserManager users = Framework.getService(UserManager.class);
        return Framework.doPrivileged(() -> users.getPrincipal(user));
    }

    private void folder(String name, List<ACE> aces) {
        DocumentModel folder = session.createDocument(session.createDocumentModel("/", name, "Folder"));
        ACP acp = folder.getACP();
        ACL local = acp.getOrCreateACL();
        local.addAll(aces);
        session.setACP(folder.getRef(), acp, true);
        session.save();
    }

    private String picture(String folder, String name, String type) {
        DocumentModel doc = session.createDocumentModel(folder, name, type);
        doc.setPropertyValue("dc:title", name);
        return session.createDocument(doc).getId();
    }

    private <T> T inTransaction(String user, Function<CoreSession, T> work) {
        if (TransactionHelper.isTransactionActiveOrMarkedRollback()) {
            TransactionHelper.commitOrRollbackTransaction();
        }
        try {
            return TransactionHelper.runInTransaction(
                    () -> work.apply(CoreInstance.getCoreSession(repository, principal(user))));
        } finally {
            TransactionHelper.startTransaction();
        }
    }

    private String write(String user, String id, String entity) {
        return written(user, id, AssetReviews.XPATH, AssetReviews.ORIGIN, entity);
    }

    private String written(String user, String id, String xpath, String origin, String entity) {
        return inTransaction(user, s -> ReviewAnnotations.write(s, id, xpath, origin, entity, "note").getId());
    }

    private ReviewRefusal refused(String user, String id, String entity) {
        return refusedOn(user, id, AssetReviews.XPATH, entity);
    }

    private ReviewRefusal refusedOn(String user, String id, String xpath, String entity) {
        long before = annotations(id);
        ReviewRefusal refusal = refusedTo(user,
                s -> ReviewAnnotations.write(s, id, xpath, AssetReviews.ORIGIN, entity, "note"));
        assertEquals("nothing of a refused decision is written", before, annotations(id));
        return refusal;
    }

    private ReviewRefusal refusedTo(String user, Function<CoreSession, ?> work) {
        try {
            inTransaction(user, work);
        } catch (ReviewRefusal refusal) {
            return refusal;
        }
        fail("not refused");
        return null;
    }

    /** How many annotations of the review's origin the document has, that are not pins. */
    private long annotations(String id) {
        return TransactionHelper.runInTransaction(
                () -> CoreInstance.doPrivileged(repository, (CoreSession s) -> s.query(
                        "SELECT * FROM Annotation WHERE ecm:ancestorId = '" + id + "' AND externalEntity:origin = '"
                                + AssetReviews.ORIGIN + "'")
                                                                                  .stream()
                                                                                  .filter(AssetReviews::isHeld)
                                                                                  .count()));
    }

    private DocumentModel stored(String id) {
        return TransactionHelper.runInTransaction(
                () -> CoreInstance.doPrivileged(repository, (CoreSession s) -> s.getDocument(new IdRef(id))));
    }

    private static List<LogEntry> entries(String id) {
        QueryBuilder query = new QueryBuilder();
        query.predicate(Predicates.eq("eventId", ReviewAudit.EVENT));
        query.and(Predicates.eq("docUUID", id));
        query.order(OrderByExprs.asc("id"));
        List<LogEntry> entries = new ArrayList<>();
        for (Object entry : TransactionHelper.runInTransaction(() -> AuditAccess.reader().queryLogs(query))) {
            entries.add((LogEntry) entry);
        }
        return entries;
    }

    private void nothingAudited(String id) {
        transactions.nextTransaction();
        assertEquals(List.of(), entries(id));
    }

    private JsonNode enriched(String user, String id) throws Exception {
        return inTransaction(user, s -> {
            DocumentModel doc = s.getDocument(new IdRef(id));
            StringWriter out = new StringWriter();
            try (JsonGenerator jg = new JsonFactory().createGenerator(out)) {
                jg.writeStartObject();
                new AssetReviewJsonEnricher(() -> Framework.getService(AssetReviewService.class)).write(jg, doc);
                jg.writeEndObject();
            } catch (java.io.IOException e) {
                throw new java.io.UncheckedIOException(e);
            }
            try {
                return new ObjectMapper().readTree(out.toString()).get(AssetReviewJsonEnricher.NAME);
            } catch (java.io.IOException e) {
                throw new java.io.UncheckedIOException(e);
            }
        });
    }
}
