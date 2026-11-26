/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.core.test.annotations.Granularity;
import org.nuxeo.ecm.core.test.annotations.RepositoryConfig;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.RunnerFeature;

/**
 * The add-on in a real Nuxeo runtime and repository: VCS on H2 by default, as the local server is,
 * with the sequencer and key/value store the server has, two series and two controlled types
 * ({@code test-documents-contrib.xml}). The repository is emptied between tests; the sequencer is
 * not, so each test that counts resets the series it counts in ({@link Library#resetSeries}).
 */
@Features(CoreFeature.class)
@RepositoryConfig(cleanup = Granularity.METHOD)
@Deploy("org.nuxeo.agentic.documents")
@Deploy("org.nuxeo.agentic.documents.test:OSGI-INF/test-documents-contrib.xml")
public class ControlledDocumentsFeature implements RunnerFeature {
}
