package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.nuxeo.agentic.config.ActionFixtures.parameter;
import static org.nuxeo.agentic.config.ActionFixtures.requestRecords;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;

/** What the allow-list accepts as an entry, and what a parameter's value must be. */
class AllowedOperationTest {

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    private static String refusal(AllowedOperationDescriptor descriptor) {
        return assertThrows(IllegalArgumentException.class, () -> AllowedOperation.of(descriptor)).getMessage();
    }

    @Test
    void anEntryNeedsAWritePermissionWhenItNamesNone() {
        AllowedOperation operation = AllowedOperation.of(requestRecords());
        assertEquals("Payers.RequestMedicalRecords", operation.id());
        assertEquals("Write", operation.permission());
        assertEquals(Set.of(), operation.groups());
        assertEquals(List.of("provider", "urgent", "note", "channel"), List.copyOf(operation.parameters().keySet()));
        assertEquals(AllowedOperation.Type.BOOLEAN, operation.parameters().get("urgent").type());
        assertEquals(20, operation.parameters().get("note").maxLength());
        assertEquals(1000, operation.parameters().get("provider").maxLength());
    }

    @Test
    void keepsThePermissionAndGroupsItNames() {
        AllowedOperationDescriptor d = requestRecords();
        d.permission = "ReadWrite";
        d.groups = new ArrayList<>(List.of("claims-adjusters", "claims-supervisors"));
        AllowedOperation operation = AllowedOperation.of(d);
        assertEquals("ReadWrite", operation.permission());
        assertEquals(Set.of("claims-adjusters", "claims-supervisors"), operation.groups());
    }

    @Test
    void refusesAnIdThatIsNotAnOperations() {
        for (String id : new String[] { null, "", "1Payers", "Payers RequestRecords", "Payers/../x", "x".repeat(129) }) {
            AllowedOperationDescriptor d = requestRecords();
            d.id = id;
            assertTrue(refusal(d).contains("its id is not an operation's"), String.valueOf(id));
        }
    }

    @Test
    void refusesTheRunEndpointItself() {
        AllowedOperationDescriptor d = requestRecords();
        d.id = RunAppActionOperation.ID;
        assertTrue(refusal(d).contains("the endpoint that runs the allow-list"));
    }

    @Test
    void refusesAPermissionOrAGroupThatIsNotOne() {
        AllowedOperationDescriptor d = requestRecords();
        d.permission = "Write; Everything";
        assertTrue(refusal(d).contains("not a permission's name"));
        d = requestRecords();
        d.groups = new ArrayList<>(List.of(" claims-adjusters"));
        assertTrue(refusal(d).contains("a group is empty, or has spaces around it"));
    }

    @Test
    void refusesAParameterWithNoTypeANameTwiceOrABadLength() {
        AllowedOperationDescriptor d = requestRecords();
        d.parameters.add(parameter("amount", "money", null));
        assertTrue(refusal(d).contains("the parameter amount has no type"));

        d = requestRecords();
        d.parameters.add(parameter("note", "string", null));
        assertTrue(refusal(d).contains("the parameter note is listed twice"));

        d = requestRecords();
        d.parameters.add(parameter("$where", "string", null));
        assertTrue(refusal(d).contains("a parameter's name is not one"));

        for (String length : new String[] { "0", "10001", "many" }) {
            d = requestRecords();
            d.parameters.add(parameter("comment", "string", length));
            assertTrue(refusal(d).contains("maxLength is not from 1 to 10000"), length);
        }

        d = requestRecords();
        d.parameters.add(parameter("count", "long", "5"));
        assertTrue(refusal(d).contains("is not a string, and has a maxLength"));
    }

    @Test
    void aStringIsATextNoLongerThanItsMaximumWithNoControlCharacter() {
        AllowedOperation.Parameter note = new AllowedOperation.Parameter("note", AllowedOperation.Type.STRING, 5);
        assertEquals("line\n", note.fromJson(JSON.textNode("line\n")));
        // Five characters, counted as a person counts them: an emoji is one.
        assertEquals("ab😀cd", note.fromJson(JSON.textNode("ab😀cd")));
        assertTrue(assertThrows(IllegalArgumentException.class, () -> note.fromJson(JSON.textNode("sixsix")))
                                                                                                    .getMessage()
                                                                                                    .contains("longer than 5"));
        assertThrows(IllegalArgumentException.class, () -> note.fromJson(JSON.textNode("a\u0000b")));
        assertThrows(IllegalArgumentException.class, () -> note.fromJson(JSON.numberNode(5)));
        assertThrows(IllegalArgumentException.class, () -> note.fromJson(JSON.booleanNode(true)));
        assertNull(note.fromJson(JSON.nullNode()));
        assertNull(note.fromJson(null));
    }

    @Test
    void numbersAndFlagsAreOfTheirOwnTypeOnly() {
        AllowedOperation.Parameter count = new AllowedOperation.Parameter("count", AllowedOperation.Type.LONG, 0);
        AllowedOperation.Parameter amount = new AllowedOperation.Parameter("amount", AllowedOperation.Type.DOUBLE, 0);
        AllowedOperation.Parameter urgent = new AllowedOperation.Parameter("urgent", AllowedOperation.Type.BOOLEAN, 0);
        assertEquals(3L, count.fromJson(JSON.numberNode(3)));
        assertThrows(IllegalArgumentException.class, () -> count.fromJson(JSON.numberNode(3.5)));
        assertThrows(IllegalArgumentException.class, () -> count.fromJson(JSON.textNode("3")));
        assertEquals(3.5, amount.fromJson(JSON.numberNode(3.5)));
        assertEquals(3.0, amount.fromJson(JSON.numberNode(3)));
        assertThrows(IllegalArgumentException.class, () -> amount.fromJson(JSON.textNode("3.5")));
        assertSame(Boolean.TRUE, urgent.fromJson(JSON.booleanNode(true)));
        assertThrows(IllegalArgumentException.class, () -> urgent.fromJson(JSON.textNode("true")));
    }

    @Test
    void aPropertyIsGivenAsTheTypeTheAllowListSays() {
        AllowedOperation.Parameter provider = new AllowedOperation.Parameter("provider", AllowedOperation.Type.STRING,
                100);
        AllowedOperation.Parameter amount = new AllowedOperation.Parameter("amount", AllowedOperation.Type.DOUBLE, 0);
        AllowedOperation.Parameter count = new AllowedOperation.Parameter("count", AllowedOperation.Type.LONG, 0);
        assertEquals("provider-0042", provider.fromProperty("provider-0042"));
        assertThrows(IllegalArgumentException.class, () -> provider.fromProperty(42L));
        assertThrows(IllegalArgumentException.class, () -> provider.fromProperty(new String[] { "a" }));
        assertEquals(12.5, amount.fromProperty(12.5));
        assertEquals(12.0, amount.fromProperty(12L));
        assertThrows(IllegalArgumentException.class, () -> amount.fromProperty(Double.NaN));
        assertEquals(7L, count.fromProperty(7));
        assertThrows(IllegalArgumentException.class, () -> count.fromProperty(7.5));
        assertNull(count.fromProperty(null));
    }
}
