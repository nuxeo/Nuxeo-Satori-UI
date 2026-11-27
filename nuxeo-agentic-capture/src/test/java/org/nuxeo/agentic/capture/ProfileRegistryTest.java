/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.lang.reflect.Proxy;

import org.junit.Test;
import org.nuxeo.runtime.model.ComponentInstance;
import org.nuxeo.runtime.model.ComponentName;

/**
 * The profiles' registry, with no runtime: a profile refused, for a rule or for another profile's
 * inbox and item types, takes the earlier one of its id with it, so that a broken change never
 * leaves the profile it meant to replace capturing.
 */
public class ProfileRegistryTest {

    private static final ComponentInstance KIT = (ComponentInstance) Proxy.newProxyInstance(
            ComponentInstance.class.getClassLoader(), new Class<?>[] { ComponentInstance.class },
            (proxy, method, args) -> "getName".equals(method.getName()) ? new ComponentName("test.kit") : null);

    private static ProfileDescriptor profile(String id, String inboxType, String itemType) {
        ProfileDescriptor d = ProfileTest.sound();
        d.id = id;
        d.inboxType = inboxType;
        d.itemType = itemType;
        return d;
    }

    @Test
    public void aReplacementRefusedForAnotherProfilesTypesTakesTheEarlierOneWithIt() {
        CaptureComponent registry = new CaptureComponent();
        registry.registerContribution(profile("letters", "InboxA", "MailA"), "profiles", KIT);
        registry.registerContribution(profile("parcels", "InboxB", "MailB"), "profiles", KIT);
        assertEquals("letters", registry.profileFor("InboxA", "MailA").id());
        // The kit changes letters to capture what parcels does: refused, and letters is gone.
        registry.registerContribution(profile("letters", "InboxB", "MailB"), "profiles", KIT);
        assertNull(registry.profile("letters"));
        assertNull(registry.profileFor("InboxA", "MailA"));
        assertEquals("parcels", registry.profileFor("InboxB", "MailB").id());
    }

    @Test
    public void aReplacementRefusedForARuleTakesTheEarlierOneWithIt() {
        CaptureComponent registry = new CaptureComponent();
        registry.registerContribution(profile("letters", "InboxA", "MailA"), "profiles", KIT);
        ProfileDescriptor broken = profile("letters", "InboxA", "MailA");
        broken.threshold = "0.2";
        registry.registerContribution(broken, "profiles", KIT);
        assertNull(registry.profile("letters"));
    }
}
