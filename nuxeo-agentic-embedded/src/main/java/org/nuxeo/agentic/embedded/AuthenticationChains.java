package org.nuxeo.agentic.embedded;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Whether the chains the server resolved hold the panel's authenticator: the REST API's two,
 * {@code RestAPI} and {@code Automation}, which the platform replaces whole, so that a later
 * contribution of either, an upgrade's or a server's own configuration, drops the plugin with no
 * error of the platform's. Read from the platform's authentication service once it has started, by
 * reflection, since its descriptors carry servlet types the module is not built against; a server
 * whose service reads otherwise is told so, and nothing else changes.
 */
final class AuthenticationChains {

    static final String SERVICE = "org.nuxeo.ecm.platform.ui.web.auth.service.PluggableAuthenticationService";

    /** The chains a panel's token is signed in through, by the platform's names. */
    static final List<String> CHAINS = List.of("RestAPI", "Automation");

    private AuthenticationChains() {
    }

    /**
     * The chains of {@link #CHAINS} that the service resolved without the panel's authenticator, or
     * a sentence saying the service could not be read.
     *
     * @param service the platform's authentication service, as the runtime holds it
     */
    static List<String> lacking(Object service) {
        Map<?, ?> chains;
        try {
            Field field = field(service.getClass(), "specificAuthChains");
            field.setAccessible(true);
            chains = (Map<?, ?>) field.get(service);
        } catch (ReflectiveOperationException | RuntimeException e) {
            return List.of("(the authentication service's chains could not be read: " + e.getClass().getSimpleName()
                    + ")");
        }
        List<String> lacking = new ArrayList<>();
        for (String name : CHAINS) {
            Object chain = chains == null ? null : chains.get(name);
            if (chain == null || !replacementChain(chain).contains(PanelTokenAuthenticator.NAME)) {
                lacking.add(name);
            }
        }
        return lacking;
    }

    private static List<?> replacementChain(Object descriptor) {
        try {
            Method method = descriptor.getClass().getMethod("getReplacementChain");
            Object chain = method.invoke(descriptor);
            return chain instanceof List<?> list ? list : List.of();
        } catch (ReflectiveOperationException | RuntimeException e) {
            return List.of();
        }
    }

    private static Field field(Class<?> type, String name) throws NoSuchFieldException {
        for (Class<?> each = type; each != null; each = each.getSuperclass()) {
            try {
                return each.getDeclaredField(name);
            } catch (NoSuchFieldException e) {
                // Up the hierarchy.
            }
        }
        throw new NoSuchFieldException(name);
    }
}
