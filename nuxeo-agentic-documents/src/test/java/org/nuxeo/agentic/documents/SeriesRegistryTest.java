/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * Contributions in the order the runtime registers them: the last for an id is in force, a broken
 * one leaves none in force rather than an earlier one, and {@code enabled="false"} removes it.
 */
public class SeriesRegistryTest {

    private static NumberSeriesDescriptor series(String id, String digits, boolean enabled) {
        return new NumberSeriesDescriptor(id, digits, null, enabled);
    }

    @Test
    public void aLaterSeriesReplacesAnEarlierOneWhole() {
        ControlledDocumentComponent component = new ControlledDocumentComponent();
        component.register(series("DWG", "5", true), "kit");
        component.register(series("DWG", "7", true), "customer");
        assertEquals(7, component.series("DWG").digits());
    }

    @Test
    public void aBrokenSeriesLeavesNoneInForce() {
        ControlledDocumentComponent component = new ControlledDocumentComponent();
        component.register(series("DWG", "5", true), "kit");
        component.register(series("DWG", "99", true), "customer");
        assertNull(component.series("DWG"));
    }

    @Test
    public void aDisabledSeriesIsRemovedAndUnregisteringRestoresTheEarlier() {
        ControlledDocumentComponent component = new ControlledDocumentComponent();
        NumberSeriesDescriptor kit = series("DWG", "5", true);
        NumberSeriesDescriptor off = series("DWG", null, false);
        component.register(kit, "kit");
        component.register(off, "customer");
        assertNull(component.series("DWG"));
        component.unregisterContribution(off, ControlledDocumentComponent.XP_SERIES, null);
        assertEquals(5, component.series("DWG").digits());
        assertNull(component.series(null));
        assertNull(component.series("SPEC"));
    }
}
