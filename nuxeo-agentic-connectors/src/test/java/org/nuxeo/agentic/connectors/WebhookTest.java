package org.nuxeo.agentic.connectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

/** {@link Webhook#of}: every rule a webhook's contribution is held to, and the names it reads. */
class WebhookTest {

    static WebhookDescriptor descriptor() {
        WebhookDescriptor d = new WebhookDescriptor();
        d.id = "payers.claimUpdates";
        d.events = new ArrayList<>(List.of("created", "modified", "transitioned", "taskCompleted"));
        d.types = new ArrayList<>(List.of("Claim"));
        d.fields = new ArrayList<>(List.of(field("claimNumber", "claim:number"),
                field("state", Webhook.LIFECYCLE_STATE)));
        return d;
    }

    static WebhookDescriptor.FieldDescriptor field(String name, String xpath) {
        WebhookDescriptor.FieldDescriptor field = new WebhookDescriptor.FieldDescriptor();
        field.name = name;
        field.xpath = xpath;
        return field;
    }

    private static String problems(WebhookDescriptor d) {
        return assertThrows(IllegalArgumentException.class, () -> Webhook.of(d)).getMessage();
    }

    @Test
    void aSoundWebhookIsRegisteredWithItsDefaults() {
        Webhook webhook = Webhook.of(descriptor());
        assertEquals("payers.claimUpdates", webhook.id());
        assertEquals(List.of(Webhook.Trigger.CREATED, Webhook.Trigger.MODIFIED, Webhook.Trigger.TRANSITIONED,
                Webhook.Trigger.TASK_COMPLETED), webhook.triggers());
        assertEquals(6, webhook.maxAttempts());
        assertEquals(Duration.ofSeconds(2), webhook.connectTimeout());
        assertEquals(Duration.ofSeconds(10), webhook.timeout());
        assertTrue(webhook.sends(Webhook.Trigger.MODIFIED, "Claim"));
        assertFalse(webhook.sends(Webhook.Trigger.MODIFIED, "Folder"));
    }

    @Test
    void itsServerSettingsAreUnderItsOwnPrefixAndNoConnectorsOne() {
        Webhook webhook = Webhook.of(descriptor());
        assertEquals("nuxeo.agentic.webhooks.payers.claimUpdates.address", webhook.addressProperty());
        assertEquals("nuxeo.agentic.webhooks.payers.claimUpdates.secret", webhook.secretProperty());
        assertEquals("nuxeo.agentic.webhooks.payers.claimUpdates.http.allowed", webhook.httpAllowedProperty());
        assertEquals("nuxeo.agentic.webhooks.payers.claimUpdates.private.allowed", webhook.privateAllowedProperty());
        // A connector's own names are under nuxeo.agentic.connectors.: none of them is a webhook's.
        for (String name : List.of(webhook.addressProperty(), webhook.secretProperty())) {
            assertFalse(name.startsWith(Connector.PROPERTY_PREFIX), name);
        }
    }

    @Test
    void theTriggersAreTheFourDocumentEvents() {
        assertEquals(Webhook.Trigger.CREATED, Webhook.Trigger.ofEvent("documentCreated"));
        assertEquals(Webhook.Trigger.MODIFIED, Webhook.Trigger.ofEvent("documentModified"));
        assertEquals(Webhook.Trigger.TRANSITIONED, Webhook.Trigger.ofEvent("lifecycle_transition_event"));
        assertEquals(Webhook.Trigger.TASK_COMPLETED, Webhook.Trigger.ofEvent("workflowTaskCompleted"));
        assertNull(Webhook.Trigger.ofEvent("documentRemoved"));
        assertNull(Webhook.Trigger.ofEvent("aboutToCreate"));
    }

    @Test
    void anIdThatIsNotOneIsRefused() {
        for (String id : new String[] { null, "", "1starts.with.a.digit", "has space", "a".repeat(65), "slash/id" }) {
            WebhookDescriptor d = descriptor();
            d.id = id;
            assertTrue(problems(d).contains("its id must be"), String.valueOf(id));
        }
    }

    @Test
    void itNeedsEventsItKnowsEachOnce() {
        for (List<String> events : List.of(List.<String> of(), List.of("deleted"), List.of("created", "created"),
                List.of("documentCreated"))) {
            WebhookDescriptor d = descriptor();
            d.events = new ArrayList<>(events);
            assertTrue(problems(d).contains("<event>"), events.toString());
        }
    }

    @Test
    void itNeedsTypes() {
        WebhookDescriptor d = descriptor();
        d.types = new ArrayList<>();
        assertTrue(problems(d).contains("<type>"));
        d.types = new ArrayList<>(List.of("Not a type"));
        assertTrue(problems(d).contains("<type>"));
    }

    @Test
    void aFieldNamesOneDocumentPropertyAndNeverAFile() {
        assertNotNull(Webhook.of(withField("title", "dc:title")));
        assertTrue(problems(withField("content", "file:content")).contains("never sends a file"));
        assertTrue(problems(withField("files", "files:files")).contains("never sends a file"));
        for (String xpath : new String[] { null, "title", "dc:title/sub", "files:files/0/file", "ecm:path",
                "ecm:uuid", "ECM:acl", "dc:title,dc:description" }) {
            assertTrue(problems(withField("f", xpath)).contains("must name a document property"), xpath);
        }
        assertTrue(problems(withField("has-dash", "dc:title")).contains("<field name>"));
        WebhookDescriptor twice = withField("claimNumber", "dc:title");
        assertTrue(problems(twice).contains("named twice"));
    }

    @Test
    void noFieldsIsAPayloadOfTheDocumentsIdTypeAndEventOnly() {
        WebhookDescriptor d = descriptor();
        d.fields = new ArrayList<>();
        assertEquals(List.of(), Webhook.of(d).fields());
    }

    @Test
    void itsBoundsAreHeld() {
        WebhookDescriptor d = descriptor();
        d.maxAttempts = 0;
        assertTrue(problems(d).contains("<maxAttempts>"));
        d.maxAttempts = 11;
        assertTrue(problems(d).contains("<maxAttempts>"));
        d = descriptor();
        d.timeout = 30_001;
        assertTrue(problems(d).contains("<timeout>"));
        d = descriptor();
        d.connectTimeout = 99;
        assertTrue(problems(d).contains("<connectTimeout>"));
    }

    @Test
    void everyProblemIsNamedAtOnce() {
        WebhookDescriptor d = new WebhookDescriptor();
        String message = problems(d);
        assertTrue(message.contains("its id"));
        assertTrue(message.contains("<event>"));
        assertTrue(message.contains("<type>"));
    }

    private static WebhookDescriptor withField(String name, String xpath) {
        WebhookDescriptor d = descriptor();
        d.fields.add(field(name, xpath));
        return d;
    }
}
