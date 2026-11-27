package org.nuxeo.agentic.connectors;

import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.RunnerFeature;

/**
 * The add-on's webhooks in a real Nuxeo runtime and repository: everything {@link ConnectorsFeature}
 * deploys, the platform's key/value service the deliveries are kept in, and a server's webhook
 * configuration ({@code test-webhooks-contrib.xml}). The documents' events reach the webhooks'
 * listener after their transaction commits, and their attempts run in the work manager.
 */
@Features(ConnectorsFeature.class)
@Deploy("org.nuxeo.runtime.kv")
@Deploy("org.nuxeo.agentic.connectors.test:OSGI-INF/test-webhooks-contrib.xml")
public class WebhooksFeature implements RunnerFeature {
}
