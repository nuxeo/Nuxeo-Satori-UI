package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.nuxeo.agentic.config.ActionFixtures.REQUEST_RECORDS;
import static org.nuxeo.agentic.config.ActionFixtures.requestRecords;

import java.util.List;

import org.junit.jupiter.api.Test;

/** How contributions make the allow-list, and that each change publishes a new one. */
class OperationAllowListComponentTest {

    @Test
    void allowsNothingUntilTheDeploymentContributes() {
        assertSame(AllowList.EMPTY, new OperationAllowListComponent().getAllowList());
        assertNull(AllowList.EMPTY.get(REQUEST_RECORDS));
    }

    @Test
    void aContributionAllowsItsOperationAndPublishesANewList() {
        OperationAllowListComponent component = new OperationAllowListComponent();
        AllowList before = component.getAllowList();
        component.register(requestRecords(), "deployment");
        AllowList after = component.getAllowList();
        assertNotSame(before, after);
        assertEquals("Write", after.get(REQUEST_RECORDS).permission());
        // The list a reader holds does not change under it.
        assertNull(before.get(REQUEST_RECORDS));
    }

    @Test
    void anEntryThatFailsACheckIsLeftOutAndTheOneBeforeStays() {
        OperationAllowListComponent component = new OperationAllowListComponent();
        component.register(requestRecords(), "deployment");
        AllowList before = component.getAllowList();
        AllowedOperationDescriptor broken = requestRecords();
        broken.permission = "not a permission";
        component.register(broken, "later");
        assertSame(before, component.getAllowList());
        assertEquals("Write", component.getAllowList().get(REQUEST_RECORDS).permission());
    }

    @Test
    void aLaterOneReplacesItWholeAndDisabledRemovesIt() {
        OperationAllowListComponent component = new OperationAllowListComponent();
        component.register(requestRecords(), "deployment");
        AllowedOperationDescriptor narrower = requestRecords();
        narrower.parameters.clear();
        narrower.permission = "ReadWrite";
        component.register(narrower, "later");
        AllowedOperation replaced = component.getAllowList().get(REQUEST_RECORDS);
        assertEquals("ReadWrite", replaced.permission());
        assertEquals(List.of(), List.copyOf(replaced.parameters().keySet()));

        AllowedOperationDescriptor off = new AllowedOperationDescriptor();
        off.id = REQUEST_RECORDS;
        off.enabled = false;
        component.register(off, "last");
        assertNull(component.getAllowList().get(REQUEST_RECORDS));
    }

    @Test
    void unregisteringAContributionThatWasReplacedKeepsTheReplacement() {
        OperationAllowListComponent component = new OperationAllowListComponent();
        AllowedOperationDescriptor first = requestRecords();
        AllowedOperationDescriptor second = requestRecords();
        second.permission = "ReadWrite";
        component.register(first, "deployment");
        component.register(second, "later");
        component.unregister(first);
        assertEquals("ReadWrite", component.getAllowList().get(REQUEST_RECORDS).permission());
        component.unregister(second);
        assertNull(component.getAllowList().get(REQUEST_RECORDS));
    }
}
