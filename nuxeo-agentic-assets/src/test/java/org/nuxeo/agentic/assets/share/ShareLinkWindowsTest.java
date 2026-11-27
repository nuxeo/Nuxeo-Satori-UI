/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.nuxeo.agentic.assets.share.ShareFakes.OWNER;

import java.awt.Color;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Semaphore;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.assets.rights.TestRights;
import org.nuxeo.agentic.assets.share.ShareFakes.Asset;
import org.nuxeo.agentic.assets.share.ShareLinkService.Created;
import org.nuxeo.agentic.assets.share.ShareLinkService.NotCreated;
import org.nuxeo.agentic.assets.share.ShareLinkService.Refusal;
import org.nuxeo.agentic.assets.share.ShareLinkService.Refused;
import org.nuxeo.agentic.assets.share.ShareLinkService.Served;
import org.nuxeo.agentic.assets.share.ShareLinkService.Why;
import org.nuxeo.ecm.core.api.CoreSession;

/**
 * Share links of an asset under a policy with territories and release windows: decided as a
 * download, which names no territory, when the link is made and at every request. A window that
 * closes refuses the items of its channel from the next request on; a preview stays served.
 */
class ShareLinkWindowsTest {

    private ShareFakes.MovingClock clock;

    private ShareFakes.Store store;

    private ShareLinkComponent links;

    private Asset asset;

    private final CoreSession owner = ShareFakes.session(OWNER, true);

    @BeforeEach
    void setUp() {
        clock = new ShareFakes.MovingClock();
        store = new ShareFakes.Store();
        ShareFakes.Repository repository = new ShareFakes.Repository();
        links = ShareFakes.component(clock, store, repository, TestRights.territorialKit(clock), new Semaphore(2));
        asset = repository.add(new Asset("asset-w", new Color(30, 120, 200)));
        asset.properties.put("acmeasset:territories", new String[] { "FR" });
        windows("FR", "E-commerce", "2026-11-01", "2026-12-31");
    }

    private void windows(String territory, String channel, String from, String until) {
        Map<String, Serializable> window = new HashMap<>();
        window.put("territory", territory);
        window.put("channel", channel);
        window.put("from", ShareFakes.midnightUtc(from));
        window.put("until", ShareFakes.midnightUtc(until));
        asset.properties.put("acmeasset:windows", new ArrayList<>(List.of(window)));
    }

    @Test
    void aLinksItemIsServedWhileItsChannelsWindowIsOpenAndRefusedOnceItCloses() {
        Created created = assertInstanceOf(Created.class,
                links.create(owner, asset.model(), List.of("view:FullHD", "view:Medium"), "2026-12-14"));
        assertInstanceOf(Served.class, links.serve(created.token(), "view:FullHD"));

        // The window closed yesterday: the E-commerce view is refused from the next request on.
        windows("FR", "E-commerce", "2026-11-01", "2026-11-23");
        assertEquals(new Refused(Why.RIGHTS_REFUSED), links.serve(created.token(), "view:FullHD"));
        assertInstanceOf(Served.class, links.serve(created.token(), "view:Medium"), "a preview stays served");
        assertEquals(1, store.downloads.stream().filter(each -> each.item().equals("view:FullHD")).count());
    }

    @Test
    void noLinkIsMadeForAnItemOutsideItsWindowOrTerritory() {
        windows("FR", "E-commerce", "2026-11-25", "2026-12-31");
        assertEquals(new NotCreated(List.of(new Refusal("view:FullHD", "outside-window"))),
                links.create(owner, asset.model(), List.of("view:FullHD"), "2026-12-14"));

        windows("FR", "E-commerce", "2026-11-01", "2026-12-31");
        asset.properties.put("acmeasset:territories", new String[0]);
        assertEquals(new NotCreated(List.of(new Refusal("view:FullHD", "territory-not-covered"))),
                links.create(owner, asset.model(), List.of("view:FullHD"), "2026-12-14"));
        assertEquals(0, store.links.size());
    }
}
