package org.nuxeo.agentic.connectors;

import java.util.ArrayList;
import java.util.List;

import org.nuxeo.common.xmap.annotation.XNode;
import org.nuxeo.common.xmap.annotation.XNodeList;
import org.nuxeo.common.xmap.annotation.XObject;

/**
 * One connector to a system of record, as a kit's package contributes it.
 *
 * <pre>
 * &lt;connector id="payers.claimPayments"&gt;
 *   &lt;type&gt;Claim&lt;/type&gt;
 *   &lt;address property="nuxeo.agentic.connectors.payers.claimPayments.address" /&gt;
 *   &lt;path&gt;/claims/{key}&lt;/path&gt;
 *   &lt;key xpath="claim:number" /&gt;
 *   &lt;permission&gt;Read&lt;/permission&gt;
 *   &lt;credential header="Authorization" prefix="Bearer "
 *               property="nuxeo.agentic.connectors.payers.claimPayments.token"
 *               env="NUXEO_CONNECTOR_PAYERS_CLAIMPAYMENTS_TOKEN" /&gt;
 *   &lt;connectTimeout&gt;2000&lt;/connectTimeout&gt;
 *   &lt;timeout&gt;5000&lt;/timeout&gt;
 *   &lt;maxBytes&gt;262144&lt;/maxBytes&gt;
 *   &lt;maxConcurrent&gt;8&lt;/maxConcurrent&gt;
 *   &lt;field name="paymentStatus" /&gt;
 *   &lt;field name="paidAmount" pointer="/payment/amount" /&gt;
 * &lt;/connector&gt;
 * </pre>
 *
 * Nothing here is a secret, and nothing here comes from a client: the address is named by a
 * server property, not written here, so that each server points the kit's connector at its own
 * system, and the credential is named by a server property or an environment variable, read when
 * the connector is called. Both names are the connector's own, under
 * {@code nuxeo.agentic.connectors.<id>.<name>} and {@code NUXEO_CONNECTOR_<ID>_<NAME>}, so a contribution cannot
 * have another setting of the server's, a database password say, sent to its address.
 * {@link Connector#of} checks every element, and a connector that fails a check is not
 * registered.
 *
 * A later contribution with the same id replaces the connector whole, and {@code enabled="false"}
 * removes it.
 */
@XObject("connector")
public class ConnectorDescriptor {

    /** One field the connector may return: its name, and where it is in the system's answer. */
    @XObject("field")
    public static class FieldDescriptor {

        @XNode("@name")
        protected String name;

        @XNode("@pointer")
        protected String pointer;

        public String getName() {
            return name;
        }

        public String getPointer() {
            return pointer;
        }
    }

    @XNode("@id")
    protected String id;

    @XNode("@enabled")
    protected boolean enabled = true;

    @XNode("address@property")
    protected String addressProperty;

    @XNode("path")
    protected String path;

    @XNode("key@xpath")
    protected String keyXpath;

    @XNode("permission")
    protected String permission;

    @XNode("credential@header")
    protected String credentialHeader;

    // Not trimmed: "Bearer " ends in the space the header needs.
    @XNode(value = "credential@prefix", trim = false)
    protected String credentialPrefix;

    @XNode("credential@property")
    protected String credentialProperty;

    @XNode("credential@env")
    protected String credentialEnv;

    @XNode("connectTimeout")
    protected Integer connectTimeout;

    @XNode("timeout")
    protected Integer timeout;

    @XNode("maxBytes")
    protected Integer maxBytes;

    @XNode("maxConcurrent")
    protected Integer maxConcurrent;

    @XNodeList(value = "type", type = ArrayList.class, componentType = String.class)
    protected List<String> types = new ArrayList<>();

    @XNodeList(value = "field", type = ArrayList.class, componentType = FieldDescriptor.class)
    protected List<FieldDescriptor> fields = new ArrayList<>();

    public String getId() {
        return id;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public String getAddressProperty() {
        return addressProperty;
    }

    public String getPath() {
        return path;
    }

    public String getKeyXpath() {
        return keyXpath;
    }

    public String getPermission() {
        return permission;
    }

    public String getCredentialHeader() {
        return credentialHeader;
    }

    public String getCredentialPrefix() {
        return credentialPrefix;
    }

    public String getCredentialProperty() {
        return credentialProperty;
    }

    public String getCredentialEnv() {
        return credentialEnv;
    }

    public Integer getConnectTimeout() {
        return connectTimeout;
    }

    public Integer getTimeout() {
        return timeout;
    }

    public Integer getMaxBytes() {
        return maxBytes;
    }

    public Integer getMaxConcurrent() {
        return maxConcurrent;
    }

    public List<String> getTypes() {
        return types;
    }

    public List<FieldDescriptor> getFields() {
        return fields;
    }
}
