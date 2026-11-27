package org.nuxeo.agentic.embedded;

import java.util.Set;

/** What the exchange asks of the server's users: whether one exists, and what they are. */
public interface UserDirectory {

    /**
     * A Nuxeo user, as an exchange needs to know them.
     *
     * @param username the user's name, as Nuxeo signs them in
     * @param administrator whether Nuxeo counts them as an administrator
     * @param special the system user, the anonymous user, or a transient one: never exchanged for
     * @param groups every group Nuxeo counts them in, nested and virtual ones too
     */
    record User(String username, boolean administrator, boolean special, Set<String> groups) {
    }

    /** The user, or {@code null} when the server has none by that name. */
    User find(String username);
}
