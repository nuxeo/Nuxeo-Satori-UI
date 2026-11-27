/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.List;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.impl.UserPrincipal;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.core.test.annotations.Granularity;
import org.nuxeo.ecm.core.test.annotations.RepositoryConfig;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * A video a policy marks, on a server without ffmpeg, in a real Nuxeo runtime: the platform's video
 * tools stand in as a server without ffmpeg has them, no tool available. The original is refused
 * unmarked at the download endpoints, {@code watermark-required}, to everyone, an administrator
 * included; and {@code Asset.GetWatermarked} refuses it, 409, {@code watermark-unavailable}, without
 * asking the tools to run: the unmarked video is never served in its place.
 */
@RunWith(FeaturesRunner.class)
@Features(CoreFeature.class)
@RepositoryConfig(cleanup = Granularity.METHOD)
@Deploy("org.nuxeo.ecm.automation.core")
@Deploy("org.nuxeo.ecm.platform.tag:OSGI-INF/faceted-tag-service-core-types.xml")
@Deploy("org.nuxeo.ecm.platform.picture.core:OSGI-INF/picture-schemas-contrib.xml")
@Deploy("org.nuxeo.ecm.platform.video:OSGI-INF/core-types-contrib.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-rights-service.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-rights-download-permission.xml")
@Deploy("org.nuxeo.agentic.assets:OSGI-INF/asset-watermark-operations-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-video-model-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-video-tools-unavailable-contrib.xml")
@Deploy("org.nuxeo.agentic.assets.test:OSGI-INF/test-watermark-policy-contrib.xml")
public class VideoWatermarkRefusedTest {

    private static final NuxeoPrincipal READER = new UserPrincipal("olga", List.of("members"), false, false);

    private static final NuxeoPrincipal ADMINISTRATOR = new UserPrincipal("Administrator", List.of("administrators"),
            false, true);

    @Inject
    protected CoreSession session;

    private String video;

    @Before
    public void setUp() {
        video = VideoWatermarks.video(session).getId();
        TransactionHelper.commitOrRollbackTransaction();
        TransactionHelper.startTransaction();
        UnavailableVideoTools.calls = 0;
    }

    @Test
    public void anUnmarkedVideoIsRefusedAtTheDownloadEndpointsToEveryone() {
        assertFalse(VideoWatermarks.downloads(session, video, READER));
        assertFalse("an administrator is not exempt", VideoWatermarks.downloads(session, video, ADMINISTRATOR));
    }

    @Test
    public void withoutFfmpegTheMarkedVideoIsRefusedAndTheOriginalIsNotServedInItsPlace() {
        NuxeoException refusal = VideoWatermarks.refused(session.getRepositoryName(), video, READER);
        assertEquals(409, refusal.getStatusCode());
        assertTrue(refusal.getMessage(), refusal.getMessage().contains("watermark-unavailable"));
        assertEquals("the tools are asked whether they can, and are not asked to run", 0, UnavailableVideoTools.calls);
    }
}
