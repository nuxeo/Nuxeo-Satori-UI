package org.nuxeo.agentic.embedded;

import java.util.LinkedHashSet;
import java.util.Set;

import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.platform.usermanager.UserManager;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * The server's users, through the platform's {@code UserManager}: whether a user exists, whether
 * Nuxeo counts them as an administrator, and every group it counts them in. Read in a transaction of
 * its own, since the exchange's servlet runs outside the request controller's.
 */
public final class PlatformUserDirectory implements UserDirectory {

    @Override
    public User find(String username) {
        if (username == null || SecurityConstants.SYSTEM_USERNAME.equals(username)) {
            return username == null ? null : new User(username, true, true, Set.of());
        }
        return TransactionHelper.runInTransaction(() -> {
            UserManager users = Framework.getService(UserManager.class);
            NuxeoPrincipal principal = users == null ? null : users.getPrincipal(username);
            if (principal == null) {
                return null;
            }
            boolean special = principal.isAnonymous() || principal.isTransient()
                    || username.equals(users.getAnonymousUserId());
            Set<String> groups = new LinkedHashSet<>();
            if (principal.getAllGroups() != null) {
                groups.addAll(principal.getAllGroups());
            }
            return new User(principal.getName(), principal.isAdministrator(), special, groups);
        });
    }
}
