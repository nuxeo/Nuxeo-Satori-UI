package org.nuxeo.agentic.connectors;

import java.util.ArrayList;
import java.util.List;

import org.nuxeo.common.xmap.annotation.XNode;
import org.nuxeo.common.xmap.annotation.XNodeList;
import org.nuxeo.common.xmap.annotation.XObject;

/**
 * One outbound webhook, as the server's configuration contributes it, in {@code nxserver/config/}.
 *
 * <pre>
 * &lt;webhook id="payers.claimUpdates"&gt;
 *   &lt;event&gt;created&lt;/event&gt;
 *   &lt;event&gt;modified&lt;/event&gt;
 *   &lt;event&gt;transitioned&lt;/event&gt;
 *   &lt;event&gt;taskCompleted&lt;/event&gt;
 *   &lt;type&gt;Claim&lt;/type&gt;
 *   &lt;field name="claimNumber" xpath="claim:number" /&gt;
 *   &lt;field name="state" xpath="ecm:currentLifeCycleState" /&gt;
 *   &lt;maxAttempts&gt;6&lt;/maxAttempts&gt;
 *   &lt;connectTimeout&gt;2000&lt;/connectTimeout&gt;
 *   &lt;timeout&gt;10000&lt;/timeout&gt;
 * &lt;/webhook&gt;
 * </pre>
 *
 * Nothing here is an address or a secret: the receiver's address and the signing secret are the
 * server properties {@code nuxeo.agentic.webhooks.<id>.address} and {@code .secret}, which no
 * contribution names, so a contribution alone sends nothing anywhere. {@link Webhook#of} checks
 * every element, and a webhook that fails a check is not registered.
 *
 * A later contribution with the same id replaces the webhook whole, and {@code enabled="false"}
 * removes it.
 */
@XObject("webhook")
public class WebhookDescriptor {

    /** One field the payload carries: its name in the payload, and the document property it is read from. */
    @XObject("field")
    public static class FieldDescriptor {

        @XNode("@name")
        protected String name;

        @XNode("@xpath")
        protected String xpath;

        public String getName() {
            return name;
        }

        public String getXpath() {
            return xpath;
        }
    }

    @XNode("@id")
    protected String id;

    @XNode("@enabled")
    protected boolean enabled = true;

    @XNodeList(value = "event", type = ArrayList.class, componentType = String.class)
    protected List<String> events = new ArrayList<>();

    @XNodeList(value = "type", type = ArrayList.class, componentType = String.class)
    protected List<String> types = new ArrayList<>();

    @XNodeList(value = "field", type = ArrayList.class, componentType = FieldDescriptor.class)
    protected List<FieldDescriptor> fields = new ArrayList<>();

    @XNode("maxAttempts")
    protected Integer maxAttempts;

    @XNode("connectTimeout")
    protected Integer connectTimeout;

    @XNode("timeout")
    protected Integer timeout;

    public String getId() {
        return id;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public List<String> getEvents() {
        return events;
    }

    public List<String> getTypes() {
        return types;
    }

    public List<FieldDescriptor> getFields() {
        return fields;
    }

    public Integer getMaxAttempts() {
        return maxAttempts;
    }

    public Integer getConnectTimeout() {
        return connectTimeout;
    }

    public Integer getTimeout() {
        return timeout;
    }
}
