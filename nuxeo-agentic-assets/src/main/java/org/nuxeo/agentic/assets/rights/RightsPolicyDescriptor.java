/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.util.ArrayList;
import java.util.List;

import org.nuxeo.common.xmap.annotation.XNode;
import org.nuxeo.common.xmap.annotation.XNodeList;
import org.nuxeo.common.xmap.annotation.XObject;

/**
 * A rights policy for one document type, as a package contributes it to
 * {@code org.nuxeo.agentic.assets.rights}, point {@code policies}.
 *
 * <pre>
 * &lt;policy type="AcmeAsset"&gt;
 *   &lt;rightsEnd xpath="dc:expired" /&gt;
 *   &lt;channels xpath="acmeasset:channels" /&gt;
 *   &lt;original channel="Print" /&gt;
 *   &lt;view name="Medium" preview="true" /&gt;
 *   &lt;view name="OriginalJpeg" channel="Print" /&gt;
 *   &lt;rendition name="thumbnail" preview="true" /&gt;
 * &lt;/policy&gt;
 * </pre>
 *
 * {@link RightsPolicy#of} reads it, and decides what a mistake in it means: always a refusal.
 */
@XObject("policy")
public class RightsPolicyDescriptor {

    @XNode("@type")
    protected String type;

    @XNode("@enabled")
    protected boolean enabled = true;

    @XNode("rightsEnd@xpath")
    protected String rightsEndXpath;

    @XNode("channels@xpath")
    protected String channelsXpath;

    @XNode("original")
    protected UseDescriptor original;

    @XNodeList(value = "view", type = ArrayList.class, componentType = UseDescriptor.class)
    protected List<UseDescriptor> views = new ArrayList<>();

    @XNodeList(value = "rendition", type = ArrayList.class, componentType = UseDescriptor.class)
    protected List<UseDescriptor> renditions = new ArrayList<>();

    @XNodeList(value = "blob", type = ArrayList.class, componentType = UseDescriptor.class)
    protected List<UseDescriptor> blobs = new ArrayList<>();

    public String getType() {
        return type;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public String getRightsEndXpath() {
        return rightsEndXpath;
    }

    public String getChannelsXpath() {
        return channelsXpath;
    }

    public UseDescriptor getOriginal() {
        return original;
    }

    public List<UseDescriptor> getViews() {
        return views;
    }

    public List<UseDescriptor> getRenditions() {
        return renditions;
    }

    public List<UseDescriptor> getBlobs() {
        return blobs;
    }
}
