package org.nuxeo.agentic.lifecycle;

import static org.nuxeo.ecm.core.api.security.SecurityConstants.READ_LIFE_CYCLE;
import static org.nuxeo.ecm.core.api.security.SecurityConstants.WRITE_LIFE_CYCLE;
import static org.nuxeo.ecm.core.api.security.SecurityConstants.WRITE_PROPERTIES;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.LifeCycleException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.lifecycle.LifeCycle;
import org.nuxeo.ecm.core.lifecycle.LifeCycleTransition;

/**
 * One document, one user and one lifecycle policy, answering as Nuxeo 2025 does.
 *
 * <p>The session, the document, the principal and the policy are {@link Proxy} fakes over the
 * Nuxeo interfaces, so the module's tests keep running with no Nuxeo runtime, as the rest of them
 * do. Every one answers only the calls listed here and throws on any other, so a change that reads
 * something these do not model fails a test rather than reading a default.
 *
 * <p>{@link #followTransition} is the server's own decision, transcribed from the bytecode of
 * {@code AbstractSession.followTransition} and {@code LifeCycleServiceImpl.followTransition} in
 * {@code nuxeo-core-2025.10.18.jar}: {@code WriteLifeCycle}, then {@code WriteProperties} for the
 * check-out of a checked-in live document, then a lifecycle for the document's type, a transition
 * it allows from the current state, and that transition's destination, which the service reads with
 * no null check. {@code checkPermission} lets an administrator through before it asks for a
 * permission.
 * {@link #getAllowedStateTransitions} needs {@code ReadLifeCycle}, and throws without it, as the
 * server does.
 */
final class FakeRepository {

    static final DocumentRef REF = new IdRef("7f0c4a0e-claim");

    boolean exists = true;

    /** False for a document model with no reference, such as an empty one for a creation form. */
    boolean saved = true;

    boolean administrator;

    final Set<String> granted = new HashSet<>();

    boolean version;

    boolean proxy;

    boolean checkedOut = true;

    String type = "Claim";

    /** The lifecycle the service maps {@link #type} to, or {@code null} for none. */
    String policy = "claim";

    String state = "submitted";

    /** Transition name to destination, for every transition the policy declares. */
    final Map<String, String> transitions = new LinkedHashMap<>();

    /** State to the transitions the policy allows from it, in the policy's order. */
    final Map<String, List<String>> allowedFrom = new LinkedHashMap<>();

    /** Every permission the session was asked about, in order. */
    final List<String> permissionsAsked = new ArrayList<>();

    FakeRepository() {
        transitions.put("approve", "approved");
        transitions.put("deny", "denied");
        transitions.put("reopen", "submitted");
        allowedFrom.put("submitted", List.of("approve", "deny"));
        allowedFrom.put("approved", List.of("reopen"));
        allowedFrom.put("denied", List.of("reopen"));
        // A state may list a transition the policy never declares.
        allowedFrom.put("review", List.of("approve", "escalate"));
    }

    FakeRepository grant(String... permissions) {
        granted.addAll(List.of(permissions));
        return this;
    }

    /** What a user who may change the document's lifecycle and its properties holds. */
    FakeRepository grantEverythingNeeded() {
        return grant(READ_LIFE_CYCLE, WRITE_LIFE_CYCLE, WRITE_PROPERTIES);
    }

    CoreSession session() {
        return fake(CoreSession.class, (name, args) -> switch (name) {
        case "exists" -> exists && REF.equals(args[0]);
        case "getPrincipal" -> principal();
        case "hasPermission" -> {
            if (args.length != 2 || !(args[1] instanceof String permission)) {
                throw new UnsupportedOperationException("hasPermission with a principal");
            }
            permissionsAsked.add(permission);
            yield granted.contains(permission);
        }
        case "getAllowedStateTransitions" -> getAllowedStateTransitions();
        default -> null;
        });
    }

    DocumentModel document() {
        return fake(DocumentModel.class, (name, args) -> switch (name) {
        case "getRef" -> saved ? REF : null;
        case "isVersion" -> version;
        case "isProxy" -> proxy;
        case "isCheckedOut" -> checkedOut;
        case "getType" -> type;
        case "getCoreSession" -> session();
        default -> null;
        });
    }

    /** The lifecycle the service applies to a document type: this document's, for its type only. */
    LifeCycle lifeCycleOfType(String documentType) {
        if (policy == null || !type.equals(documentType)) {
            return null;
        }
        return fake(LifeCycle.class, (method, args) -> switch (method) {
        case "getTransitionByName" -> transitions.containsKey(args[0]) ? transition((String) args[0]) : null;
        default -> null;
        });
    }

    /** {@code AbstractSession.getAllowedStateTransitions} on Nuxeo 2025. */
    List<String> getAllowedStateTransitions() {
        checkPermission(READ_LIFE_CYCLE);
        return new ArrayList<>(allowedFrom.getOrDefault(state, List.of()));
    }

    /**
     * Whether the server accepts {@code Document.FollowLifecycleTransition} with this transition,
     * without changing anything.
     */
    boolean followTransition(String transition) {
        try {
            checkPermission(WRITE_LIFE_CYCLE);
            if (!version && !proxy && !checkedOut) {
                // AbstractSession.checkOut
                checkPermission(WRITE_PROPERTIES);
            }
            // LifeCycleServiceImpl.followTransition
            if (policy == null || !allowedFrom.getOrDefault(state, List.of()).contains(transition)) {
                throw new LifeCycleException("Not allowed to follow transition <" + transition + "> from state <"
                        + state + ">");
            }
            // getTransitionByName(transition).getDestinationStateName(), with no null check.
            if (transitions.get(transition) == null) {
                throw new NullPointerException("no transition " + transition + " in " + policy);
            }
            return true;
        } catch (DocumentSecurityException | LifeCycleException | NullPointerException refused) {
            return false;
        }
    }

    private void checkPermission(String permission) {
        if (administrator) {
            return;
        }
        if (!granted.contains(permission)) {
            throw new DocumentSecurityException("Privilege '" + permission + "' is not granted");
        }
    }

    private NuxeoPrincipal principal() {
        return fake(NuxeoPrincipal.class, (name, args) -> switch (name) {
        case "isAdministrator" -> administrator;
        case "getName" -> administrator ? "Administrator" : "adjuster";
        default -> null;
        });
    }

    private LifeCycleTransition transition(String name) {
        return fake(LifeCycleTransition.class, (method, args) -> switch (method) {
        case "getName" -> name;
        case "getDestinationStateName" -> transitions.get(name);
        default -> null;
        });
    }

    @FunctionalInterface
    interface Answer {
        /** The answer to a call, or {@code null} when the fake does not model it. */
        Object answer(String method, Object[] args);
    }

    @SuppressWarnings("unchecked")
    static <T> T fake(Class<T> type, Answer answer) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] { type }, (self, method, args) -> {
            Object[] arguments = args == null ? new Object[0] : args;
            switch (method.getName()) {
            case "toString":
                return "fake " + type.getSimpleName();
            case "hashCode":
                return System.identityHashCode(self);
            case "equals":
                return self == arguments[0];
            default:
                Object result = answer.answer(method.getName(), arguments);
                if (result == null && !answersNull(type, method.getName())) {
                    throw new UnsupportedOperationException(
                            type.getSimpleName() + "." + method.getName() + " is not modelled by this fake");
                }
                return result;
            }
        });
    }

    /** The calls whose real answer may be {@code null}. */
    private static boolean answersNull(Class<?> type, String method) {
        return (type == LifeCycle.class && method.equals("getTransitionByName"))
                || (type == LifeCycleTransition.class && method.equals("getDestinationStateName"))
                || (type == DocumentModel.class && method.equals("getRef"));
    }
}
