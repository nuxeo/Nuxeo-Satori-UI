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
 * A policy's delivery package, as XML writes it: the files a delivery of a document of its type
 * carries, each named as its rule names it, and decided by that rule.
 *
 * <pre>
 * &lt;delivery&gt;
 *   &lt;original /&gt;
 *   &lt;blob xpath="files:files/1/file" /&gt;
 *   &lt;view name="FullHD" /&gt;
 * &lt;/delivery&gt;
 * </pre>
 *
 * An entry takes no channel and no {@code preview}: its channel is its rule's. A rendition and the
 * storyboard are read only to be refused: a delivery carries files the document holds.
 */
@XObject("delivery")
public class DeliveryDescriptor {

    @XNode("original")
    protected UseDescriptor original;

    @XNodeList(value = "view", type = ArrayList.class, componentType = UseDescriptor.class)
    protected List<UseDescriptor> views = new ArrayList<>();

    @XNodeList(value = "blob", type = ArrayList.class, componentType = UseDescriptor.class)
    protected List<UseDescriptor> blobs = new ArrayList<>();

    /** Not a file the document holds: read only so that a package naming one is refused, not shortened. */
    @XNodeList(value = "rendition", type = ArrayList.class, componentType = UseDescriptor.class)
    protected List<UseDescriptor> renditions = new ArrayList<>();

    /** As {@link #renditions}. */
    @XNode("storyboard")
    protected UseDescriptor storyboard;

    public UseDescriptor getOriginal() {
        return original;
    }

    public List<UseDescriptor> getViews() {
        return views;
    }

    public List<UseDescriptor> getBlobs() {
        return blobs;
    }

    public List<UseDescriptor> getRenditions() {
        return renditions;
    }

    public UseDescriptor getStoryboard() {
        return storyboard;
    }
}
