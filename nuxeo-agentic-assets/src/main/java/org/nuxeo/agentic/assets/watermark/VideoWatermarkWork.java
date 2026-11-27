/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.watermark.MarkedVideos.Job;
import org.nuxeo.ecm.core.work.AbstractWork;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * One long video's marked copy, made in the work manager's queue {@value #CATEGORY}, since 0.6.0. It
 * holds the {@link Job}, text only, never a file, and its id is the copy's key, so that the work
 * manager queues one per key on a node; {@link MarkedVideosComponent#run} holds the key's lease across
 * the cluster, and makes nothing when another job holds it.
 *
 * <p>The work manager's transaction is released for the length of the marking, as the platform's own
 * video conversions keep theirs short: the component opens one to read the source and another to keep
 * the copy. Its failures are the job's, recorded, audited and answered by the add-on; the work itself
 * does not fail, and the work manager never retries it.
 */
public class VideoWatermarkWork extends AbstractWork {

    private static final long serialVersionUID = 1L;

    private static final Logger log = LogManager.getLogger(VideoWatermarkWork.class);

    public static final String CATEGORY = "agenticVideoWatermark";

    protected final Job job;

    VideoWatermarkWork(Job job) {
        super("agentic-watermark-" + job.key());
        this.job = job;
        setOriginatingUsername(job.user());
    }

    @Override
    public String getCategory() {
        return CATEGORY;
    }

    @Override
    public String getTitle() {
        return "Watermarked video copy";
    }

    @Override
    public void work() {
        TransactionHelper.commitOrRollbackTransaction();
        try {
            if (Framework.getService(MarkedVideos.class) instanceof MarkedVideosComponent videos) {
                videos.run(job);
            } else {
                log.error("Asset rights: the marked videos' service is not running, so the copy {} is not made",
                        MarkedVideosComponent.brief(job.key()));
            }
        } finally {
            TransactionHelper.startTransaction();
        }
    }
}
