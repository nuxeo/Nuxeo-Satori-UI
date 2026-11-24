package org.nuxeo.agentic.config;

import java.util.ArrayList;
import java.util.List;

import org.nuxeo.common.xmap.annotation.XNode;
import org.nuxeo.common.xmap.annotation.XNodeList;
import org.nuxeo.common.xmap.annotation.XObject;

/**
 * One business app's definition, contributed by its package for the app registry.
 *
 * <pre>
 * &lt;app id="payers-claims" src="agentic-ui-config/app.json"&gt;
 *   &lt;file path="home.json" /&gt;
 *   &lt;file path="navigation.json" /&gt;
 *   &lt;file path="queues/unassigned-claims.json" /&gt;
 *   &lt;file path="labels/en.json" /&gt;
 *   &lt;file path="tasks/claimReview.determine.layout.json" /&gt;
 *   &lt;file path="actions.json" /&gt;
 * &lt;/app&gt;
 * </pre>
 *
 * {@code src} is the app's {@code app.json}, read from the contributing bundle as a layout's is. The
 * directory that holds it is the app's root, as a package lays one out
 * (docs/business-apps/app-definition-v2.md, section 1), and each {@code file} is a path below that
 * root: its place says what it is, so the path is all the registry needs. Every file is named,
 * because a bundle's directories cannot be listed reliably, and because a package that names its
 * files is one the pipeline can hold to what it ships.
 *
 * An app is replaced whole, never merged, as a layout is: a later contribution with the same id
 * wins outright, and {@code enabled="false"} removes the one in force. There is no inline form:
 * an app is a package, built and checked by the pipeline.
 */
@XObject("app")
public class AppDescriptor {

    @XNode("@id")
    protected String id;

    @XNode("@src")
    protected String src;

    @XNode("@enabled")
    protected boolean enabled = true;

    @XNodeList(value = "file@path", type = ArrayList.class, componentType = String.class)
    protected List<String> files = new ArrayList<>();

    public String getId() {
        return id;
    }

    public String getSrc() {
        return src;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public List<String> getFiles() {
        return files;
    }
}
