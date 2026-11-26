package org.nuxeo.agentic.embedded;

import java.util.List;
import java.util.Map;

import org.nuxeo.ecm.platform.api.login.UserIdentificationInfo;
import org.nuxeo.ecm.platform.ui.web.auth.interfaces.NuxeoAuthenticationPlugin;
import org.nuxeo.runtime.api.Framework;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Signs the user of a panel's token in: {@code AGENTIC_EMBEDDED_AUTH}, a plugin of the platform's
 * authentication service, in the REST API's chain alone ({@code embedded-panels-auth-contrib.xml}), so that
 * a panel's token signs no one in anywhere else.
 *
 * It reads the {@code Authorization: Bearer} header only, and answers for a token that claims to be a
 * panel's: the user it names, once {@link PanelTokenGuard} lets the request through, as the filter
 * did before it; and no one, for any other, which the chain then answers 401. Any other bearer token
 * is left to the plugins before it. It is declared stateless, so no session is kept for it.
 */
public class PanelTokenAuthenticator implements NuxeoAuthenticationPlugin {

    /** The plugin's name in the platform's chains. */
    public static final String NAME = "AGENTIC_EMBEDDED_AUTH";

    /** The service; package-private for tests, which have no runtime. */
    EmbeddedPanelService service;

    EmbeddedPanelService service() {
        return service != null ? service : Framework.getService(EmbeddedPanelService.class);
    }

    @Override
    public UserIdentificationInfo handleRetrieveIdentity(HttpServletRequest request, HttpServletResponse response) {
        PanelTokenGuard.Request read = PanelTokenFilter.read(request);
        if (!PanelTokenGuard.claimsAHost(PanelTokenGuard.bearer(read.authorization()))) {
            return null;
        }
        EmbeddedPanelService panels = service();
        if (panels == null) {
            return null;
        }
        PanelTokenGuard.Decision decision = panels.check(read);
        return decision.passes() && decision.username() != null ? new UserIdentificationInfo(decision.username())
                : null;
    }

    @Override
    public Boolean handleLoginPrompt(HttpServletRequest request, HttpServletResponse response, String baseURL) {
        return Boolean.FALSE;
    }

    @Override
    public Boolean needLoginPrompt(HttpServletRequest request) {
        return Boolean.FALSE;
    }

    @Override
    public void initPlugin(Map<String, String> parameters) {
        // Nothing to set: the hosts and the key are the service's.
    }

    @Override
    public List<String> getUnAuthenticatedURLPrefix() {
        return null;
    }
}
