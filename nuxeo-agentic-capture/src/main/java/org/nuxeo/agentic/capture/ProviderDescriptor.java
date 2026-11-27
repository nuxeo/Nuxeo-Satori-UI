/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import org.nuxeo.common.xmap.annotation.XNode;
import org.nuxeo.common.xmap.annotation.XObject;

/** {@code <provider id="..." class="..." enabled="true" />} at {@code org.nuxeo.agentic.capture}'s {@code providers}. */
@XObject("provider")
public class ProviderDescriptor {

    @XNode("@id")
    protected String id;

    @XNode("@class")
    protected Class<?> klass;

    @XNode("@enabled")
    protected boolean enabled = true;

    public String getId() {
        return id;
    }

    public Class<?> getKlass() {
        return klass;
    }

    public boolean isEnabled() {
        return enabled;
    }
}
