package org.nuxeo.ecm.platform.ui.web.auth.interfaces;

import java.util.List;
import java.util.Map;

import org.nuxeo.ecm.platform.api.login.UserIdentificationInfo;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * <b>A compile-time copy, never shipped.</b> The platform's interface of an authentication plugin as
 * Nuxeo LTS 2025.10.18 declares it in {@code nuxeo-platform-web-common}, with Jakarta servlet types:
 * the 11.5 artifacts this module builds against declare it with {@code javax} ones, and the 2025
 * artifacts are not on the public repository. The module's {@code pom.xml} keeps this package out of
 * the jar, so the server's own interface is the one {@code PanelTokenAuthenticator} implements at run
 * time; {@code PlatformInterfaceCopyTest} holds this copy to the 2025 signatures, as read from the
 * 2025.10.18 jar with {@code javap}, and the jar's contents to the exclusion.
 */
public interface NuxeoAuthenticationPlugin {

    Boolean handleLoginPrompt(HttpServletRequest request, HttpServletResponse response, String baseURL);

    UserIdentificationInfo handleRetrieveIdentity(HttpServletRequest request, HttpServletResponse response);

    Boolean needLoginPrompt(HttpServletRequest request);

    void initPlugin(Map<String, String> parameters);

    List<String> getUnAuthenticatedURLPrefix();
}
