package org.nuxeo.agentic.records;

import static org.nuxeo.agentic.records.Fixtures.commit;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import javax.inject.Inject;

import org.junit.After;
import org.junit.Before;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.core.test.annotations.Granularity;
import org.nuxeo.ecm.core.test.annotations.RepositoryConfig;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * The add-on in Nuxeo's own test framework: a real repository, with the platform's retention and
 * hold, its security and its transactions, the add-on's bundle as it ships, and the retention
 * module's model read from its published jar.
 */
@RunWith(FeaturesRunner.class)
@Features(CoreFeature.class)
@RepositoryConfig(cleanup = Granularity.METHOD)
@Deploy("org.nuxeo.agentic.records")
@Deploy("org.nuxeo.agentic.records:OSGI-INF/test-retention-types.xml")
@Deploy("org.nuxeo.agentic.records:OSGI-INF/test-failures.xml")
public abstract class DispositionTestCase {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature coreFeature;

    protected DocumentModel folder;

    /** A rule under review: no end action. */
    protected DocumentModel rule;

    @Before
    public void setUpRepository() {
        TestHooks.reset();
        folder = Fixtures.runsFolder(session);
        Fixtures.recordsFolder(session);
        rule = Fixtures.rule(session, "Claims seven years");
        commit(session);
    }

    @After
    public void resetHooks() {
        TestHooks.reset();
    }

    protected List<String> uids(DocumentModel run) {
        List<String> uids = new ArrayList<>();
        for (Map<String, Serializable> record : Dispositions.records(session.getDocument(run.getRef()))) {
            uids.add(String.valueOf(record.get("uid")));
        }
        return uids;
    }

    protected List<String> approvers(DocumentModel run) {
        List<String> names = new ArrayList<>();
        for (Map<String, Serializable> approval : Dispositions.approvals(session.getDocument(run.getRef()))) {
            names.add(String.valueOf(approval.get("by")));
        }
        return names;
    }

    protected long certificates() {
        return session.query("SELECT * FROM " + Disposition.CERTIFICATE_TYPE).size();
    }
}
