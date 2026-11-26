package org.nuxeo.agentic.connectors;

import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.core.test.annotations.Granularity;
import org.nuxeo.ecm.core.test.annotations.RepositoryConfig;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.RunnerFeature;

/**
 * The add-on in a real Nuxeo runtime and repository: VCS on H2 by default, the Automation service
 * {@code Connector.Read} runs in, the bundle's two components as its manifest names them, and a
 * kit's Claim type and connector ({@code test-connectors-contrib.xml}). The repository is emptied
 * between tests; the component, its cache and its nonces live as long as the runtime, so each test
 * empties the cache ({@link Claims#reset}).
 */
@Features(CoreFeature.class)
@RepositoryConfig(cleanup = Granularity.METHOD)
@Deploy("org.nuxeo.ecm.automation.core")
@Deploy("org.nuxeo.agentic.connectors")
@Deploy("org.nuxeo.agentic.connectors.test:OSGI-INF/test-connectors-contrib.xml")
public class ConnectorsFeature implements RunnerFeature {
}
