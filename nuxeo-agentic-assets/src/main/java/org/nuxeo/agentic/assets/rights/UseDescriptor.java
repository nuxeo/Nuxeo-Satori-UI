/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import org.nuxeo.common.xmap.annotation.XNode;
import org.nuxeo.common.xmap.annotation.XObject;

/**
 * One use a rights policy covers, as XML writes it: an {@code <original>}, a {@code <view>}, a
 * {@code <rendition>} or a {@code <blob>}, with either the channel that covers it or
 * {@code preview="true"}.
 *
 * <pre>
 * &lt;view name="FullHD" channel="E-commerce" /&gt;
 * &lt;view name="Medium" preview="true" /&gt;
 * &lt;blob xpath="files:files/0/file" channel="Print" /&gt;
 * &lt;original xpath="file:content" channel="Print" /&gt;
 * </pre>
 */
@XObject("use")
public class UseDescriptor {

    /** A view's title or a rendition's name. */
    @XNode("@name")
    protected String name;

    /** A blob's xpath, or the original's when it is not {@code file:content}. */
    @XNode("@xpath")
    protected String xpath;

    @XNode("@channel")
    protected String channel;

    @XNode("@preview")
    protected boolean preview;

    public UseDescriptor() {
    }

    UseDescriptor(String name, String xpath, String channel, boolean preview) {
        this.name = name;
        this.xpath = xpath;
        this.channel = channel;
        this.preview = preview;
    }

    public String getName() {
        return name;
    }

    public String getXpath() {
        return xpath;
    }

    public String getChannel() {
        return channel;
    }

    public boolean isPreview() {
        return preview;
    }
}
