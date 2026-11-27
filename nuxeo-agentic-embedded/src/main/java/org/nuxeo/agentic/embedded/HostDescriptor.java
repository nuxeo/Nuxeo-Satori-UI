package org.nuxeo.agentic.embedded;

import java.util.ArrayList;
import java.util.List;

import org.nuxeo.common.xmap.annotation.XNode;
import org.nuxeo.common.xmap.annotation.XNodeList;
import org.nuxeo.common.xmap.annotation.XObject;

/**
 * One host application that may exchange its assertion of a user for a panel's token, as the
 * server's administrators register it in a file of {@code nxserver/config/}.
 *
 * <pre>
 * &lt;host id="crm"&gt;
 *   &lt;assertion algorithm="RS256" issuer="https://crm.example.com" /&gt;
 *   &lt;origin&gt;https://crm.example.com&lt;/origin&gt;
 *   &lt;user subject="u-1042"&gt;jsmith&lt;/user&gt;
 *   &lt;group&gt;crm_panel_users&lt;/group&gt;
 *   &lt;allowAdministrators&gt;false&lt;/allowAdministrators&gt;
 *   &lt;scope&gt;read&lt;/scope&gt;
 *   &lt;operation&gt;Connector.Read&lt;/operation&gt;
 *   &lt;tokenLifetime&gt;300&lt;/tokenLifetime&gt;
 * &lt;/host&gt;
 * </pre>
 *
 * Nothing here is a secret. The host's client secret and the key its assertions are verified with
 * are server properties, or environment variables, with names that follow from the host's id
 * ({@link Host#clientSecretProperty()}), read at each exchange: a contribution never holds either,
 * and cannot name another of the server's settings. {@link Host#of} checks every element, and a host
 * that fails a check is not registered.
 */
@XObject("host")
public class HostDescriptor {

    /** A subject of the host's that the configuration maps to one Nuxeo user. */
    @XObject("user")
    public static class UserDescriptor {

        @XNode("@subject")
        protected String subject;

        @XNode("")
        protected String username;

        public String getSubject() {
            return subject;
        }

        public String getUsername() {
            return username;
        }
    }

    @XNode("@id")
    protected String id;

    @XNode("@enabled")
    protected boolean enabled = true;

    @XNode("assertion@algorithm")
    protected String algorithm;

    @XNode("assertion@issuer")
    protected String issuer;

    @XNodeList(value = "origin", type = ArrayList.class, componentType = String.class)
    protected List<String> origins = new ArrayList<>();

    @XNodeList(value = "user", type = ArrayList.class, componentType = UserDescriptor.class)
    protected List<UserDescriptor> users = new ArrayList<>();

    @XNodeList(value = "group", type = ArrayList.class, componentType = String.class)
    protected List<String> groups = new ArrayList<>();

    @XNode("allowAdministrators")
    protected String allowAdministrators;

    @XNodeList(value = "scope", type = ArrayList.class, componentType = String.class)
    protected List<String> scopes = new ArrayList<>();

    @XNodeList(value = "operation", type = ArrayList.class, componentType = String.class)
    protected List<String> operations = new ArrayList<>();

    @XNode("tokenLifetime")
    protected String tokenLifetime;

    public String getId() {
        return id;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public String getAlgorithm() {
        return algorithm;
    }

    public String getIssuer() {
        return issuer;
    }

    public List<String> getOrigins() {
        return origins;
    }

    public List<UserDescriptor> getUsers() {
        return users;
    }

    public List<String> getGroups() {
        return groups;
    }

    public String getAllowAdministrators() {
        return allowAdministrators;
    }

    public List<String> getScopes() {
        return scopes;
    }

    public List<String> getOperations() {
        return operations;
    }

    public String getTokenLifetime() {
        return tokenLifetime;
    }
}
