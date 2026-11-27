/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.review;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.impl.ACLImpl;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;

/**
 * What a review decision is decided on, with no runtime: the permission read from an asset's
 * permissions in the platform's order, a denial or a block met first refusing even where Nuxeo's
 * repository is configured to keep a denial; the payload read as the page reads it, strictly; and a
 * review policy whose mistakes never widen it.
 */
class AssetReviewsTest {

    private static final Set<String> RITA = Set.of("rita", "creative-review", "members", "Everyone");

    private static ACP acp(List<ACE> local, List<ACE> inherited) {
        ACP acp = new ACPImpl();
        ACL own = new ACLImpl(ACL.LOCAL_ACL);
        own.addAll(local);
        acp.addACL(own);
        ACL above = new ACLImpl(ACL.INHERITED_ACL);
        above.addAll(inherited);
        acp.addACL(above);
        return acp;
    }

    @Test
    void theFirstEntryThatNamesThePersonDecides() {
        ACE grant = new ACE("creative-review", AssetReviews.PERMISSION, true);
        assertTrue(AssetReviews.holdsPermission(acp(List.of(), List.of(grant)), RITA));
        // A denial of it, or of Everything, read first, refuses whatever is granted after.
        assertFalse(AssetReviews.holdsPermission(
                acp(List.of(new ACE("rita", AssetReviews.PERMISSION, false)), List.of(grant)), RITA));
        assertFalse(AssetReviews.holdsPermission(acp(List.of(ACE.BLOCK), List.of(grant)), RITA));
        // Granted first, a later denial does not take it back.
        assertTrue(AssetReviews.holdsPermission(acp(List.of(grant, ACE.BLOCK), List.of()), RITA));
    }

    @Test
    void everythingAndOtherPeoplesGrantsDoNotHoldIt() {
        assertFalse(AssetReviews.holdsPermission(acp(List.of(new ACE("rita", "Everything", true)), List.of()), RITA));
        assertFalse(AssetReviews.holdsPermission(
                acp(List.of(new ACE("brand-team", AssetReviews.PERMISSION, true)), List.of()), RITA));
        assertFalse(AssetReviews.holdsPermission(null, RITA));
    }

    @Test
    void thePayloadIsReadAsThePageReadsItAndStrictly() {
        assertTrue(ReviewPayload.read(ReviewAnnotations.pin(1, 0.5, 0.25)).isPin());
        assertEquals("sent-back", ReviewPayload.read(ReviewAnnotations.sendBack(3)).code());
        assertEquals(3, ReviewPayload.read(ReviewAnnotations.sendBack(3)).round());
        assertEquals("approved", ReviewPayload.read(ReviewAnnotations.decision(2, "approved")).code());
        assertEquals("rejected", ReviewPayload.read(ReviewAnnotations.decision(2, "rejected")).code());
        for (String none : List.of("{\"kind\":\"pin\",\"version\":1,\"round\":1,\"x\":0.5}",
                "{\"kind\":\"pin\",\"version\":1,\"round\":0,\"x\":0.5,\"y\":0.5}",
                "{\"kind\":\"pin\",\"version\":1,\"round\":1000,\"x\":0.5,\"y\":0.5}",
                "{\"kind\":\"pin\",\"version\":1.5,\"round\":1,\"x\":0.5,\"y\":0.5}",
                "{\"kind\":\"pin\",\"version\":\"1\",\"round\":1,\"x\":0.5,\"y\":0.5}",
                "{\"kind\":\"decision\",\"version\":1,\"round\":1,\"decision\":\"Approved\"}",
                "{\"kind\":\"decision\",\"version\":1,\"round\":1,\"x\":0.5,\"y\":0.5,\"kind\":\"pin\"}", "[]", "",
                "{\"kind\":\"round-closed\",\"version\":1,\"round\":1}x")) {
            assertNull(ReviewPayload.read(none), none);
        }
    }

    @Test
    void aPolicysMistakesNeverWidenIt() {
        ReviewPolicy policy = ReviewPolicy.of(new ReviewPolicyDescriptor("AcmeAsset",
                List.of(" creative-review ", "Everyone", "two words", "", "brand-leads", "members")));
        assertEquals(Set.of("creative-review", "brand-leads"), policy.groups());
        assertEquals(4, policy.problems().size(), policy.problems()::toString);
        ReviewPolicy none = ReviewPolicy.of(new ReviewPolicyDescriptor("AcmeAsset", List.of("Everyone")));
        assertTrue(none.groups().isEmpty());
        assertNull(ReviewPolicy.of(new ReviewPolicyDescriptor(" ", List.of("creative-review"))));
    }
}
