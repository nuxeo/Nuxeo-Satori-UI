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
 *   &lt;storyboard preview="true" /&gt;
 * &lt;/policy&gt;
 * </pre>
 *
 * {@code <storyboard>}, for a video type, decides every frame of its storyboard.
 *
 * <p>A policy with territories, for media rights, names two more fields, and may name a delivery
 * package:
 *
 * <pre>
 * &lt;territories xpath="fver:territories" /&gt;
 * &lt;windows xpath="film:windows" document="fver:film" type="Film" /&gt;
 * &lt;delivery&gt;
 *   &lt;original /&gt;
 *   &lt;blob xpath="files:files/1/file" /&gt;
 * &lt;/delivery&gt;
 * </pre>
 *
 * {@code territories} names a text or list property: where the asset may be delivered.
 * {@code windows} names a complex list of release windows, each a {@code territory}, a
 * {@code channel}, a {@code from} day and an {@code until} day; with {@code document}, it is read
 * from the document whose id that property of the asset holds, such as a localised version's film.
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

    /** Every frame of a video's storyboard, {@code vid:storyboard/<n>/content}, as one use. */
    @XNode("storyboard")
    protected UseDescriptor storyboard;

    /** Where the asset may be delivered: a text or list property. */
    @XNode("territories@xpath")
    protected String territoriesXpath;

    /** Its release windows: a complex list of territory, channel, from and until. */
    @XNode("windows@xpath")
    protected String windowsXpath;

    /** The property holding the id of the document the windows are read from, when not the asset. */
    @XNode("windows@document")
    protected String windowsDocumentXpath;

    /** With {@link #windowsDocumentXpath}: the type that document must be, such as {@code Film}. */
    @XNode("windows@type")
    protected String windowsDocumentType;

    /** The files a delivery of the type carries. */
    @XNode("delivery")
    protected DeliveryDescriptor delivery;

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

    public UseDescriptor getStoryboard() {
        return storyboard;
    }

    public String getTerritoriesXpath() {
        return territoriesXpath;
    }

    public String getWindowsXpath() {
        return windowsXpath;
    }

    public String getWindowsDocumentXpath() {
        return windowsDocumentXpath;
    }

    public String getWindowsDocumentType() {
        return windowsDocumentType;
    }

    public DeliveryDescriptor getDelivery() {
        return delivery;
    }
}
