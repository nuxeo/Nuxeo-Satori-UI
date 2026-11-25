package org.nuxeo.agentic.config;

import java.util.ArrayList;
import java.util.List;

import org.nuxeo.common.xmap.annotation.XNode;
import org.nuxeo.common.xmap.annotation.XNodeList;
import org.nuxeo.common.xmap.annotation.XObject;

/**
 * One Automation operation or chain that this server lets an app's buttons run, contributed to
 * {@code org.nuxeo.agentic.ui.operations}'s {@code allowList} point by the deployment, never by an
 * app's configuration (plan decision 3, on its recommendation: a per-deployment allow-list).
 *
 * <pre>
 * &lt;operation id="Payers.RequestMedicalRecords" permission="Write"&gt;
 *   &lt;app&gt;payers-claims&lt;/app&gt;
 *   &lt;group&gt;claims-adjusters&lt;/group&gt;
 *   &lt;type&gt;Claim&lt;/type&gt;
 *   &lt;state&gt;inReview&lt;/state&gt;
 *   &lt;param name="provider" type="string" source="field:claim:provider" /&gt;
 *   &lt;param name="urgent" type="boolean" source="input" /&gt;
 *   &lt;param name="note" type="string" maxLength="500" source="input" required="true" /&gt;
 * &lt;/operation&gt;
 * </pre>
 *
 * {@code permission} is the one the reader needs on the record, {@code Write} when left out. Each of
 * {@code app}, {@code group}, {@code type} and {@code state}, when there is one, narrows who may run
 * it, from where and on what: the app whose button it is, a group the reader is in, the record's
 * type and its lifecycle state. Each {@code param} is a parameter an app may give the operation,
 * with its type, where its value may come from, and whether it must have one. An app's action that
 * gives any other is not served, and not run. A later contribution with the same id replaces it whole, and
 * {@code enabled="false"} removes it. {@link AllowedOperation#of} says what is refused.
 */
@XObject("operation")
public class AllowedOperationDescriptor {

    @XNode("@id")
    protected String id;

    @XNode("@enabled")
    protected boolean enabled = true;

    @XNode("@permission")
    protected String permission;

    @XNodeList(value = "group", type = ArrayList.class, componentType = String.class)
    protected List<String> groups = new ArrayList<>();

    @XNodeList(value = "app", type = ArrayList.class, componentType = String.class)
    protected List<String> apps = new ArrayList<>();

    @XNodeList(value = "type", type = ArrayList.class, componentType = String.class)
    protected List<String> types = new ArrayList<>();

    @XNodeList(value = "state", type = ArrayList.class, componentType = String.class)
    protected List<String> states = new ArrayList<>();

    @XNodeList(value = "param", type = ArrayList.class, componentType = ParameterDescriptor.class)
    protected List<ParameterDescriptor> parameters = new ArrayList<>();

    public String getId() {
        return id;
    }

    public boolean isEnabled() {
        return enabled;
    }

    /** A parameter the operation may be given, and what its value must be. */
    @XObject("param")
    public static class ParameterDescriptor {

        @XNode("@name")
        protected String name;

        /** {@code string}, {@code boolean}, {@code long} or {@code double}. */
        @XNode("@type")
        protected String type;

        /** For a {@code string}: its longest length, in characters. */
        @XNode("@maxLength")
        protected String maxLength;

        /**
         * Where its value may come from: {@code input}, the action's form; {@code literal}, the app's
         * file; or {@code field:<prefix>:<name>}, that property of the stored record. Any of them
         * when left out.
         */
        @XNode("@source")
        protected String source;

        /** Whether the operation must be given a value: a form field left empty is then refused. */
        @XNode("@required")
        protected boolean required;
    }
}
