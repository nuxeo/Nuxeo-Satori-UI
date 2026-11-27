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
 * A rights policy's watermark, as XML writes it:
 *
 * <pre>
 * &lt;watermark text="ACME PICTURES · FOR {recipient} · {day}" placement="tiled"&gt;
 *   &lt;previews&gt;&lt;blob xpath="files:files/3/file" /&gt;&lt;/previews&gt;
 *   &lt;downloads /&gt;
 *   &lt;deliveries&gt;&lt;blob xpath="files:files/2/file" /&gt;&lt;/deliveries&gt;
 *   &lt;except group="media-rights" /&gt;
 * &lt;/watermark&gt;
 * </pre>
 *
 * {@link Watermark#of} reads it, and a mistake in it breaks the policy: every use is refused.
 */
@XObject("watermark")
public class WatermarkDescriptor {

    @XNode("@text")
    protected String text;

    @XNode("@placement")
    protected String placement;

    @XNode("previews")
    protected WatermarkUsesDescriptor previews;

    @XNode("downloads")
    protected WatermarkUsesDescriptor downloads;

    @XNode("deliveries")
    protected WatermarkUsesDescriptor deliveries;

    /** The groups whose members get previews and downloads unmarked. */
    @XNodeList(value = "except@group", type = ArrayList.class, componentType = String.class)
    protected List<String> except = new ArrayList<>();

    public String getText() {
        return text;
    }

    public String getPlacement() {
        return placement;
    }

    public WatermarkUsesDescriptor getPreviews() {
        return previews;
    }

    public WatermarkUsesDescriptor getDownloads() {
        return downloads;
    }

    public WatermarkUsesDescriptor getDeliveries() {
        return deliveries;
    }

    public List<String> getExcept() {
        return except;
    }
}
