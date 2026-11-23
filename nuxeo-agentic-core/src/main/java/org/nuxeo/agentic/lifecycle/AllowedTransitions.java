/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.lifecycle;

import static org.nuxeo.ecm.core.api.security.SecurityConstants.READ_LIFE_CYCLE;
import static org.nuxeo.ecm.core.api.security.SecurityConstants.WRITE_LIFE_CYCLE;
import static org.nuxeo.ecm.core.api.security.SecurityConstants.WRITE_PROPERTIES;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.function.Function;

import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.lifecycle.LifeCycle;
import org.nuxeo.ecm.core.lifecycle.LifeCycleTransition;

/**
 * The lifecycle transitions a user may follow on a document now: what its lifecycle allows from
 * its current state, kept only when the server would let this user follow them.
 *
 * <p>The checks are the ones {@code AbstractSession.followTransition} makes on Nuxeo 2025, read
 * from its bytecode, so that the interface never offers a transition the server refuses:
 *
 * <ol>
 * <li>{@code WriteLifeCycle} on the document;
 * <li>on a live document that is checked in, {@code WriteProperties} too, because following a
 * transition checks the document out first and {@code checkOut} asks for it;
 * <li>the transition is one {@code getAllowedStateTransitions} lists, which itself needs
 * {@code ReadLifeCycle}. The lifecycle service refuses any other;
 * <li>the lifecycle declares the transition, with a destination. A state may list a transition
 * the policy does not declare, and {@code LifeCycleServiceImpl.followTransition} then fails on its
 * missing destination. The lifecycle is found as the service finds it, by the document's type.
 * </ol>
 *
 * <p>Each permission is asked of the session, so the security policies answer as they do for the
 * operation. The default lock policy denies anything {@code Write} includes, {@code WriteLifeCycle}
 * among them, to everyone but the lock's owner, so a document someone else has locked lists none
 * here and is refused there. An administrator passes every check, as {@code checkPermission} lets
 * them through before asking the policies.
 *
 * <p>This decides what the interface offers. It grants nothing: the operation still checks every
 * permission itself when it runs.
 */
public final class AllowedTransitions {

    private AllowedTransitions() {
    }

    /**
     * The transitions {@code session}'s user may follow on {@code document}, in the order the
     * lifecycle lists them from the current state.
     *
     * @param lifeCycleOfType finds the lifecycle the lifecycle service applies to a document type,
     *            or {@code null}
     * @return an empty list when the document does not exist in the session, has no lifecycle, or
     *         the user may follow none of its transitions
     */
    public static List<AllowedTransition> of(CoreSession session, DocumentModel document,
            Function<String, LifeCycle> lifeCycleOfType) {
        DocumentRef ref = document.getRef();
        if (ref == null || !session.exists(ref)) {
            return List.of();
        }
        if (!granted(session, ref, READ_LIFE_CYCLE) || !granted(session, ref, WRITE_LIFE_CYCLE)) {
            return List.of();
        }
        if (checksOutFirst(document) && !granted(session, ref, WRITE_PROPERTIES)) {
            return List.of();
        }
        Collection<String> names = session.getAllowedStateTransitions(ref);
        if (names == null || names.isEmpty()) {
            return List.of();
        }
        LifeCycle lifeCycle = lifeCycleOfType.apply(document.getType());
        if (lifeCycle == null) {
            // The service refuses every transition on a document whose type has no lifecycle.
            return List.of();
        }
        List<AllowedTransition> transitions = new ArrayList<>();
        for (String name : new LinkedHashSet<>(names)) {
            String destination = name == null || name.isEmpty() ? null : destinationOf(lifeCycle, name);
            if (destination != null) {
                transitions.add(new AllowedTransition(name, destination));
            }
        }
        return List.copyOf(transitions);
    }

    /**
     * {@code followTransition} checks a document out before it moves it, unless it is a version, a
     * proxy or already checked out.
     */
    static boolean checksOutFirst(DocumentModel document) {
        return !document.isVersion() && !document.isProxy() && !document.isCheckedOut();
    }

    /**
     * {@code checkPermission} on Nuxeo 2025: an administrator passes; anyone else needs the
     * permission, as the security service and its policies grant it.
     */
    private static boolean granted(CoreSession session, DocumentRef ref, String permission) {
        NuxeoPrincipal principal = session.getPrincipal();
        if (principal != null && principal.isAdministrator()) {
            return true;
        }
        return session.hasPermission(ref, permission);
    }

    /** The transition's destination, or {@code null} when the policy cannot say where it leads. */
    private static String destinationOf(LifeCycle lifeCycle, String name) {
        LifeCycleTransition transition = lifeCycle.getTransitionByName(name);
        String destination = transition == null ? null : transition.getDestinationStateName();
        return destination == null || destination.isEmpty() ? null : destination;
    }
}
