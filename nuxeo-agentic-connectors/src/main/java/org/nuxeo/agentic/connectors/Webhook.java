package org.nuxeo.agentic.connectors;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * An outbound webhook as the server uses it: a {@link WebhookDescriptor} that has passed every check.
 *
 * <ul>
 * <li>{@code id} names it, in the server properties that point it at its receiver and hold its
 * secret, in the payload's signature and in the {@code X-Nuxeo-Webhook} header;</li>
 * <li>{@code triggers} are the document events it sends, and the only ones;</li>
 * <li>{@code types} are the document types it sends them for, and the only ones;</li>
 * <li>{@code fields} are the document properties the payload carries, each under its name, and the
 * only ones: with the document's id, its type and the event, nothing else of the document is
 * sent;</li>
 * <li>{@code maxAttempts}, the two timeouts: how often and how long a delivery is tried.</li>
 * </ul>
 *
 * Where it sends and what it signs with are server properties, read when a delivery is sent, never
 * in a contribution: {@code nuxeo.agentic.webhooks.<id>.address} and {@code .secret}, and the two
 * switches {@code .http.allowed} and {@code .private.allowed}. None of these names is chosen by a
 * contribution, so a contribution cannot point a webhook at another of the server's settings, and
 * none is under {@code nuxeo.agentic.connectors.}, so no connector can name one as its credential.
 */
public record Webhook(String id, List<Trigger> triggers, List<String> types, List<Field> fields, int maxAttempts,
        Duration connectTimeout, Duration timeout) {

    /** A document event a webhook may send, by the name a contribution and the payload use. */
    public enum Trigger {
        /** {@code documentCreated}. */
        CREATED("created", "documentCreated"),
        /** {@code documentModified}. */
        MODIFIED("modified", "documentModified"),
        /** {@code lifecycle_transition_event}: a lifecycle transition was followed. */
        TRANSITIONED("transitioned", "lifecycle_transition_event"),
        /** {@code workflowTaskCompleted}: a workflow task on the document was done. */
        TASK_COMPLETED("taskCompleted", "workflowTaskCompleted");

        /** The name in a contribution and in the payload. */
        public final String id;

        /** The repository's event. */
        public final String event;

        Trigger(String id, String event) {
            this.id = id;
            this.event = event;
        }

        /** The trigger a contribution names, or {@code null}. */
        static Trigger named(String id) {
            for (Trigger trigger : values()) {
                if (trigger.id.equals(id)) {
                    return trigger;
                }
            }
            return null;
        }

        /** The trigger of a repository event, or {@code null}. */
        static Trigger ofEvent(String event) {
            for (Trigger trigger : values()) {
                if (trigger.event.equals(event)) {
                    return trigger;
                }
            }
            return null;
        }
    }

    /** One field of the payload: its name, and the document property it is read from. */
    public record Field(String name, String xpath) {
    }

    /** What every server property a webhook reads starts with, before its id and a dot. */
    public static final String PROPERTY_PREFIX = "nuxeo.agentic.webhooks.";

    /** The one system property a field may read, besides a schema's: the document's lifecycle state. */
    public static final String LIFECYCLE_STATE = "ecm:currentLifeCycleState";

    public static final int DEFAULT_MAX_ATTEMPTS = 6;

    public static final int MAX_MAX_ATTEMPTS = 10;

    public static final int DEFAULT_CONNECT_TIMEOUT_MS = 2_000;

    public static final int MAX_CONNECT_TIMEOUT_MS = 10_000;

    public static final int DEFAULT_TIMEOUT_MS = 10_000;

    public static final int MAX_TIMEOUT_MS = 30_000;

    public static final int MIN_TIMEOUT_MS = 100;

    public static final int MAX_FIELDS = 50;

    public static final int MAX_TYPES = 20;

    /** A webhook's id: the same shape as a connector's. */
    public static final Pattern ID = Connector.ID;

    static final Pattern FIELD_NAME = Connector.FIELD_NAME;

    /**
     * A schema property, {@code prefix:name}, at the top of its schema: never a path into a complex
     * property or a list, so a field names one value.
     */
    static final Pattern XPATH = Pattern.compile("[A-Za-z_][A-Za-z0-9_-]*:[A-Za-z_][A-Za-z0-9_-]*");

    /**
     * The properties that hold files on every server: refused by name, so that a contribution that
     * names one fails at once. Any other property whose value is a file, or anything but text, a
     * number, a boolean, a date or a list of those, is withheld when the payload is built
     * ({@link WebhookPayload}).
     */
    static final Set<String> FILE_PROPERTIES = Set.of("file:content", "files:files");

    /**
     * The webhook a descriptor describes, or why it cannot be used. Every problem is named, so a
     * contribution's author can fix them in one go.
     */
    public static Webhook of(WebhookDescriptor d) {
        List<String> problems = new ArrayList<>();
        String id = d.getId();
        if (id == null || !ID.matcher(id).matches()) {
            problems.add("its id must be 1 to 64 letters, digits, '.', '_' or '-', starting with a letter");
        }
        List<Trigger> triggers = triggers(d.getEvents(), problems);
        List<String> types = d.getTypes() == null ? List.of() : List.copyOf(d.getTypes());
        if (types.isEmpty() || types.size() > MAX_TYPES
                || !types.stream().allMatch(t -> Connector.TYPE.matcher(t).matches())) {
            problems.add("it needs 1 to " + MAX_TYPES + " <type> elements: the document types it sends events for");
        }
        List<Field> fields = fields(d.getFields(), problems);
        int maxAttempts = d.getMaxAttempts() == null ? DEFAULT_MAX_ATTEMPTS : d.getMaxAttempts();
        if (maxAttempts < 1 || maxAttempts > MAX_MAX_ATTEMPTS) {
            problems.add("<maxAttempts> must be from 1 to " + MAX_MAX_ATTEMPTS);
        }
        Duration connectTimeout = millis("connectTimeout", d.getConnectTimeout(), DEFAULT_CONNECT_TIMEOUT_MS,
                MAX_CONNECT_TIMEOUT_MS, problems);
        Duration timeout = millis("timeout", d.getTimeout(), DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, problems);
        if (!problems.isEmpty()) {
            throw new IllegalArgumentException(
                    "webhook " + (id == null ? "with no id" : '"' + id + '"') + ": " + String.join("; ", problems));
        }
        return new Webhook(id, triggers, types, fields, maxAttempts, connectTimeout, timeout);
    }

    /** The server property that holds the receiver's address. Unset, the webhook sends nothing. */
    public String addressProperty() {
        return PROPERTY_PREFIX + id + ".address";
    }

    /** The server property that holds the secret its deliveries are signed with. Unset, it sends nothing. */
    public String secretProperty() {
        return PROPERTY_PREFIX + id + ".secret";
    }

    /** The server property that, set to {@code true}, lets this webhook send to a plain http address. */
    public String httpAllowedProperty() {
        return PROPERTY_PREFIX + id + ".http.allowed";
    }

    /**
     * The server property that, set to {@code true}, lets this webhook send to a private or loopback
     * address ({@link WebhookAddresses}). Link-local, multicast, unspecified and reserved addresses
     * are refused whatever it says.
     */
    public String privateAllowedProperty() {
        return PROPERTY_PREFIX + id + ".private.allowed";
    }

    /** Whether it sends this trigger for a document of this type. */
    boolean sends(Trigger trigger, String type) {
        return triggers.contains(trigger) && types.contains(type);
    }

    private static List<Trigger> triggers(List<String> given, List<String> problems) {
        Set<Trigger> triggers = new LinkedHashSet<>();
        boolean sound = given != null && !given.isEmpty();
        if (sound) {
            for (String name : given) {
                Trigger trigger = Trigger.named(name == null ? null : name.trim());
                if (trigger == null || !triggers.add(trigger)) {
                    sound = false;
                }
            }
        }
        if (!sound) {
            problems.add("it needs 1 to 4 different <event> elements, each one of created, modified, transitioned"
                    + " or taskCompleted");
        }
        return List.copyOf(triggers);
    }

    private static List<Field> fields(List<WebhookDescriptor.FieldDescriptor> given, List<String> problems) {
        List<Field> fields = new ArrayList<>();
        if (given == null) {
            return fields;
        }
        if (given.size() > MAX_FIELDS) {
            problems.add("it may send at most " + MAX_FIELDS + " fields");
        }
        Set<String> names = new HashSet<>();
        for (WebhookDescriptor.FieldDescriptor field : given) {
            String name = field.getName();
            if (name == null || !FIELD_NAME.matcher(name).matches()) {
                problems.add("a <field name> must be 1 to 64 letters, digits or '_', starting with a letter");
                continue;
            }
            if (!names.add(name)) {
                problems.add("the field \"" + name + "\" is named twice");
                continue;
            }
            String xpath = field.getXpath();
            if (xpath == null || !(LIFECYCLE_STATE.equals(xpath) || XPATH.matcher(xpath).matches())
                    || (xpath.toLowerCase(Locale.ROOT).startsWith("ecm:") && !LIFECYCLE_STATE.equals(xpath))) {
                problems.add("the field \"" + name + "\" must name a document property as prefix:name, or "
                        + LIFECYCLE_STATE);
                continue;
            }
            if (FILE_PROPERTIES.contains(xpath)) {
                problems.add("the field \"" + name + "\" names a file property, " + xpath
                        + ": a webhook never sends a file");
                continue;
            }
            fields.add(new Field(name, xpath));
        }
        return List.copyOf(fields);
    }

    private static Duration millis(String element, Integer given, int fallback, int max, List<String> problems) {
        int value = given == null ? fallback : given;
        if (value < MIN_TIMEOUT_MS || value > max) {
            problems.add("<" + element + "> must be from " + MIN_TIMEOUT_MS + " to " + max + " milliseconds");
        }
        return Duration.ofMillis(value);
    }
}
