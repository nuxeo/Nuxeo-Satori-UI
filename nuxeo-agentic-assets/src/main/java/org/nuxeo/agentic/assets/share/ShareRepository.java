/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import java.util.function.Function;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.platform.usermanager.UserManager;
import org.nuxeo.runtime.api.Framework;

/**
 * The repository, as a request through a share link reads it: one document, by the id its link
 * holds, with a system session, since the visitor is no one Nuxeo knows; and whether the link's
 * creator, with their groups, may still share it.
 */
public interface ShareRepository {

    /**
     * Runs {@code code} on the document of this id, read with a system session, inside that session.
     * {@code code} gets {@code null} when there is no such document.
     */
    <T> T withDocument(String repository, String id, Function<DocumentModel, T> code);

    /**
     * Whether {@code username}, as the user directory has them now, with their groups, holds
     * {@code permission} on the document and is an administrator or a member of one of
     * {@code sharingGroups}. {@code false} for a user who is no longer there, and when it cannot be
     * told.
     */
    boolean mayShare(String repository, String document, String username, String permission,
            java.util.Set<String> sharingGroups);

    /** The server's repository, through {@link CoreInstance#doPrivileged} and the {@link UserManager}. */
    final class Nuxeo implements ShareRepository {

        private static final Logger log = LogManager.getLogger(Nuxeo.class);

        @Override
        public <T> T withDocument(String repository, String id, Function<DocumentModel, T> code) {
            return CoreInstance.doPrivileged(repository, (Function<CoreSession, T>) session -> {
                IdRef ref = new IdRef(id);
                return code.apply(session.exists(ref) ? session.getDocument(ref) : null);
            });
        }

        @Override
        public boolean mayShare(String repository, String document, String username, String permission,
                java.util.Set<String> sharingGroups) {
            try {
                NuxeoPrincipal principal = Framework.doPrivileged(
                        () -> Framework.getService(UserManager.class).getPrincipal(username));
                if (!ShareLinkComponent.isSharer(principal, sharingGroups)) {
                    return false;
                }
                return CoreInstance.doPrivileged(repository,
                        (Function<CoreSession, Boolean>) session -> session.hasPermission(principal,
                                new IdRef(document), permission));
            } catch (RuntimeException e) {
                log.error("Share links: whether {} may still share {} could not be told, so it is refused", username,
                        document, e);
                return false;
            }
        }
    }
}
