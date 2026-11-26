/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import org.junit.runners.model.FrameworkMethod;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.core.test.annotations.Granularity;
import org.nuxeo.ecm.core.test.annotations.RepositoryConfig;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.test.runner.RunnerFeature;

/**
 * The add-on in a real Nuxeo runtime and repository, VCS on H2, with its events, permissions,
 * transactions, key/value store, the Automation service the AI provider calls through, and the
 * platform's audit; the kit-like types and profiles of {@code test-capture-contrib.xml}, and
 * stand-ins for the AI package's operations. The repository is emptied between tests, and every
 * capture setting is cleared before each.
 */
@Features({ CoreFeature.class, CaptureAuditFeature.class })
@RepositoryConfig(cleanup = Granularity.METHOD)
@Deploy("org.nuxeo.ecm.automation.core")
@Deploy("org.nuxeo.agentic.capture")
@Deploy("org.nuxeo.agentic.capture.test:OSGI-INF/test-capture-contrib.xml")
@Deploy("org.nuxeo.agentic.capture.test:OSGI-INF/test-ai-operations-contrib.xml")
public class CaptureFeature implements RunnerFeature {

    @Override
    public void beforeSetup(FeaturesRunner runner, FrameworkMethod method, Object test) {
        Mailroom.settings(null, null);
        ScriptedProvider.reset();
        TestAiOperations.reset();
    }
}
