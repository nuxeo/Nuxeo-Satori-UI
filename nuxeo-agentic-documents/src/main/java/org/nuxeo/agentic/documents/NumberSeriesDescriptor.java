/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import org.nuxeo.common.xmap.annotation.XNode;
import org.nuxeo.common.xmap.annotation.XObject;

/**
 * One number series, as a package contributes it to {@code org.nuxeo.agentic.documents}, point
 * {@code series}:
 *
 * <pre>
 * &lt;series id="DWG" digits="5" revisions="letters" /&gt;
 * &lt;series id="TR" digits="5" for="transmittals" /&gt;
 * </pre>
 *
 * {@link NumberSeries#of} reads it, and refuses what it cannot number safely.
 */
@XObject("series")
public class NumberSeriesDescriptor {

    @XNode("@id")
    protected String id;

    @XNode("@digits")
    protected String digits;

    @XNode("@revisions")
    protected String revisions;

    /** {@code documents}, the default, or {@code transmittals}: what the series numbers. */
    @XNode("@for")
    protected String use;

    @XNode("@enabled")
    protected boolean enabled = true;

    public NumberSeriesDescriptor() {
    }

    /** For tests, which contribute no XML. */
    NumberSeriesDescriptor(String id, String digits, String revisions, boolean enabled) {
        this.id = id;
        this.digits = digits;
        this.revisions = revisions;
        this.enabled = enabled;
    }

    public String getId() {
        return id == null ? null : id.trim();
    }

    public String getDigits() {
        return digits;
    }

    public String getRevisions() {
        return revisions;
    }

    /** What the series numbers, trimmed, or {@code null} when not given: controlled documents. */
    public String getFor() {
        return use == null || use.isBlank() ? null : use.trim();
    }

    /** For tests: a series that numbers transmittals. */
    NumberSeriesDescriptor forTransmittals() {
        this.use = "transmittals";
        return this;
    }

    public boolean isEnabled() {
        return enabled;
    }
}
