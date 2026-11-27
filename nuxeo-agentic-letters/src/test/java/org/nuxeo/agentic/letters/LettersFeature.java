/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.core.test.annotations.Granularity;
import org.nuxeo.ecm.core.test.annotations.RepositoryConfig;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.RunnerFeature;

/**
 * The add-on in a real Nuxeo runtime and repository, VCS on H2, with its events, permissions and
 * transactions, Automation, and the platform's Template Rendering as its own jar contributes it:
 * its template document types and schemas, its template processor service, its adapters, its
 * listeners and its parameters' serializer. Not its own processors, whose engines the tests do not
 * load, nor its operations, renditions or user interface. The kit-like types are
 * {@code test-letters-contrib.xml}'s. The repository is emptied between tests.
 */
@Features(CoreFeature.class)
@RepositoryConfig(cleanup = Granularity.METHOD)
@Deploy("org.nuxeo.ecm.automation.core")
@Deploy("org.nuxeo.template.manager:OSGI-INF/core-types-contrib.xml")
@Deploy("org.nuxeo.template.manager:OSGI-INF/life-cycle-contrib.xml")
@Deploy("org.nuxeo.template.manager:OSGI-INF/templateprocessor-service.xml")
@Deploy("org.nuxeo.template.manager:OSGI-INF/adapter-contrib.xml")
@Deploy("org.nuxeo.template.manager:OSGI-INF/listener-contrib.xml")
@Deploy("org.nuxeo.template.manager:OSGI-INF/serializer-service.xml")
@Deploy("org.nuxeo.template.manager:OSGI-INF/serializer-service-contribution.xml")
@Deploy("org.nuxeo.agentic.letters")
@Deploy("org.nuxeo.agentic.letters.test:OSGI-INF/test-letters-contrib.xml")
public class LettersFeature implements RunnerFeature {
}
