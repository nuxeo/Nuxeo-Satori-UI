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
 * One occasion of a policy's watermark, {@code <previews>}, {@code <downloads>} or
 * {@code <deliveries>}, and the uses it marks, each named as its rule names it. With none named, it
 * marks every use of the occasion.
 *
 * <pre>
 * &lt;deliveries&gt;
 *   &lt;original /&gt;
 *   &lt;blob xpath="files:files/2/file" /&gt;
 * &lt;/deliveries&gt;
 * </pre>
 */
@XObject("uses")
public class WatermarkUsesDescriptor {

    @XNode("original")
    protected UseDescriptor original;

    @XNodeList(value = "view", type = ArrayList.class, componentType = UseDescriptor.class)
    protected List<UseDescriptor> views = new ArrayList<>();

    @XNodeList(value = "rendition", type = ArrayList.class, componentType = UseDescriptor.class)
    protected List<UseDescriptor> renditions = new ArrayList<>();

    @XNodeList(value = "blob", type = ArrayList.class, componentType = UseDescriptor.class)
    protected List<UseDescriptor> blobs = new ArrayList<>();

    @XNode("storyboard")
    protected UseDescriptor storyboard;

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

    public UseDescriptor getStoryboard() {
        return storyboard;
    }
}
