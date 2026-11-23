/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.lifecycle;

/**
 * One lifecycle transition the current user may follow on a document now.
 *
 * @param name the transition's name in the lifecycle policy, which is what
 *            {@code Document.FollowLifecycleTransition} takes as its {@code value}
 * @param destinationState the state the document is in once it has followed the transition, as the
 *            policy declares it. Never {@code null}: a transition with no destination is not listed
 */
public record AllowedTransition(String name, String destinationState) {
}
