/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

import org.junit.Test;

/** A profile's rules, alone: each broken once, and refused with the rule it breaks. */
public class ProfileTest {

    static ProfileDescriptor sound() {
        ProfileDescriptor d = new ProfileDescriptor();
        d.id = "pc-claims-mail";
        d.inboxType = "PropertyClaimInbox";
        d.itemType = "PropertyClaimMail";
        d.recordType = "PropertyClaim";
        d.recordPath = "/default-domain/workspaces/pc-claims-demo";
        ProfileDescriptor.ClassDescriptor c = new ProfileDescriptor.ClassDescriptor();
        c.name = "claimLetter";
        c.label = "Claim letter";
        c.keywords = new ArrayList<>(List.of("claim number"));
        ProfileDescriptor.FieldDescriptor key = new ProfileDescriptor.FieldDescriptor();
        key.name = "claimNumber";
        key.label = "Claim number";
        key.match = "pclaim:number";
        key.format = "PC-[0-9]{5}";
        c.fields = new ArrayList<>(List.of(key));
        d.classes = new ArrayList<>(List.of(c));
        return d;
    }

    private static String refused(Consumer<ProfileDescriptor> breakIt) {
        ProfileDescriptor d = sound();
        breakIt.accept(d);
        return assertThrows(Profile.InvalidProfileException.class, () -> Profile.of(d)).getMessage();
    }

    @Test
    public void aSoundProfileIsMadeWithTheDefaultThreshold() {
        Profile p = Profile.of(sound());
        assertEquals(0.85, p.threshold(), 0);
        assertEquals("pclaim:number", p.classes().get(0).keys().get(0).match());
        assertTrue(p.classes().get(0).keys().get(0).fits("PC-24001"));
        assertTrue(!p.classes().get(0).keys().get(0).fits("PC-24001x"));
        ProfileDescriptor anywhere = sound();
        anywhere.recordPath = null;
        assertNull(Profile.of(anywhere).recordPath());
    }

    @Test
    public void aThresholdBelowAHalfOrAboveOneIsRefused() {
        for (String threshold : new String[] { "0.49", "0", "-1", "1.01", "NaN", "high" }) {
            String message = refused(d -> d.threshold = threshold);
            assertTrue(threshold + ": " + message, message.contains("threshold"));
        }
        ProfileDescriptor edge = sound();
        edge.threshold = "0.5";
        assertEquals(0.5, Profile.of(edge).threshold(), 0);
        edge.threshold = "1";
        assertEquals(1, Profile.of(edge).threshold(), 0);
    }

    @Test
    public void namesTypesPathsAndPatternsAreChecked() {
        assertTrue(refused(d -> d.id = "PC Claims").contains("id"));
        assertTrue(refused(d -> d.inboxType = "Inbox'; DROP").contains("inboxType"));
        assertTrue(refused(d -> d.recordType = d.itemType).contains("three types"));
        assertTrue(refused(d -> d.recordPath = "/a' OR ecm:path STARTSWITH '/").contains("recordPath"));
        assertTrue(refused(d -> d.recordPath = "relative/path").contains("recordPath"));
        assertTrue(refused(d -> d.classes.get(0).fields.get(0).match = "pclaim:number = 'x' OR 1").contains("match"));
        assertTrue(refused(d -> d.classes.get(0).fields.get(0).format = "PC-[0-9").contains("format"));
        assertTrue(refused(d -> d.classes.clear()).contains("classes"));
        assertTrue(refused(d -> d.classes.add(d.classes.get(0))).contains("twice"));
        assertTrue(refused(d -> d.classes.get(0).fields.add(d.classes.get(0).fields.get(0))).contains("twice"));
        assertTrue(refused(d -> d.classes.get(0).fields.clear()).contains("fields"));
        assertTrue(refused(d -> d.classes.get(0).label = "x".repeat(201)).contains("label"));
    }
}
