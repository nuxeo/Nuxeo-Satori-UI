/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.ecm.core.test.annotations.Granularity;
import org.nuxeo.ecm.core.test.annotations.RepositoryConfig;
import org.nuxeo.runtime.test.runner.Deploy;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.RunnerFeature;

/**
 * The add-on in a real Nuxeo runtime and repository, VCS on H2, with its events, permissions,
 * versions and transactions, the kit-like types of {@code test-signature-contrib.xml}, and the
 * stand-in provider talking to a stub of the stand-in service on the loopback interface
 * ({@link StandInStub}). The repository is emptied between tests.
 */
@Features(CoreFeature.class)
@RepositoryConfig(cleanup = Granularity.METHOD)
@Deploy("org.nuxeo.agentic.signature")
@Deploy("org.nuxeo.agentic.signature.test:OSGI-INF/test-signature-contrib.xml")
public class SignatureFeature implements RunnerFeature {
}
