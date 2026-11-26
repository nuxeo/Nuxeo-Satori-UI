package org.nuxeo.agentic.embedded;

import java.util.List;
import java.util.Map;

/** The hosts this server registers, the token exchange, and the rule a panel's token is held to. */
public interface EmbeddedPanelService {

    /** The registered host with this id, or {@code null}. */
    Host getHost(String id);

    /** {@link TokenExchange#exchange}, with the server's settings, users, signer and audit. */
    TokenExchange.Result exchange(String clientId, String clientSecret, Map<String, List<String>> parameters);

    /** {@link PanelTokenGuard#check}, with the registered hosts and the platform's signer. */
    PanelTokenGuard.Decision check(PanelTokenGuard.Request request);
}
