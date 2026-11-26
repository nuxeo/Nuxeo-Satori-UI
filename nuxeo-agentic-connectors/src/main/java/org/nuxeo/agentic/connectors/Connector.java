package org.nuxeo.agentic.connectors;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

import com.fasterxml.jackson.core.JsonPointer;

/**
 * A connector as the server uses it: a {@link ConnectorDescriptor} that has passed every check.
 *
 * <ul>
 * <li>{@code id} names it, for a layout's {@code external} card and the operation;</li>
 * <li>{@code types} are the document types it reads a key from, and the only ones;</li>
 * <li>{@code addressProperty} names the server property that holds the system's address, read
 * when the connector is called: the address itself is never in a contribution, a document, a
 * layout or a request. The name is under {@code nuxeo.agentic.connectors.<id>.};</li>
 * <li>{@code path} is appended to the address, its {@code {key}} replaced by the record's key, one
 * path segment;</li>
 * <li>{@code keyXpath} is the document property that holds the key;</li>
 * <li>{@code permission} is what the reader must hold on the document before the system is
 * called, {@code Read} unless the contribution asks for more;</li>
 * <li>{@code credential}, if any, names where its value is read: a server property under the same
 * prefix, else an environment variable {@code NUXEO_CONNECTOR_<ID>_<NAME>}, and the header it is
 * sent in;</li>
 * <li>the two timeouts, {@code maxBytes} and {@code maxConcurrent} bound each call, and how many
 * run at once;</li>
 * <li>{@code fields} is the allow-list: the only fields the operation returns.</li>
 * </ul>
 */
public record Connector(String id, List<String> types, String addressProperty, String path, String keyXpath,
        String permission, Credential credential, Duration connectTimeout, Duration timeout, int maxBytes,
        int maxConcurrent, List<Field> fields) {

    /** One field the operation may return, and where it is read in the system's answer. */
    public record Field(String name, JsonPointer pointer) {
    }

    /**
     * Where a connector's credential is read, and how it is sent: {@code header: prefix + value}.
     * It holds names only, never the value, so printing it prints no secret.
     */
    public record Credential(String header, String prefix, String property, String env) {
    }

    public static final String KEY_PLACEHOLDER = "{key}";

    public static final String DEFAULT_PERMISSION = "Read";

    public static final int DEFAULT_CONNECT_TIMEOUT_MS = 2_000;

    public static final int MAX_CONNECT_TIMEOUT_MS = 10_000;

    public static final int DEFAULT_TIMEOUT_MS = 5_000;

    public static final int MAX_TIMEOUT_MS = 30_000;

    public static final int MIN_TIMEOUT_MS = 100;

    public static final int DEFAULT_MAX_BYTES = 256 * 1024;

    public static final int MIN_MAX_BYTES = 1024;

    public static final int MAX_MAX_BYTES = 1024 * 1024;

    public static final int MAX_FIELDS = 50;

    public static final int DEFAULT_MAX_CONCURRENT = 8;

    public static final int MAX_MAX_CONCURRENT = 64;

    public static final int MAX_TYPES = 20;

    /** What every server property a connector reads starts with, before its id and a dot. */
    public static final String PROPERTY_PREFIX = "nuxeo.agentic.connectors.";

    /** What every environment variable a connector reads starts with. */
    public static final String ENV_PREFIX = "NUXEO_CONNECTOR_";

    /** A document type's name. */
    static final Pattern TYPE = Pattern.compile("[A-Za-z][A-Za-z0-9_-]{0,127}");

    /** A connector's id, as a layout's {@code external.connector} names it. */
    public static final Pattern ID = Pattern.compile("[A-Za-z][A-Za-z0-9._-]{0,63}");

    /** A field's name, as a layout names it: never a property's {@code prefix:name}. */
    public static final Pattern FIELD_NAME = Pattern.compile("[A-Za-z][A-Za-z0-9_]{0,63}");

    /** A server property's name, or an environment variable's. */
    static final Pattern PROPERTY = Pattern.compile("[A-Za-z][A-Za-z0-9._-]{0,127}");

    static final Pattern ENV = Pattern.compile("[A-Z_][A-Z0-9_]{0,127}");

    /** A document property, {@code prefix:name}, as layouts write one. */
    static final Pattern XPATH = Pattern.compile("[A-Za-z_][A-Za-z0-9_-]*:[A-Za-z_][A-Za-z0-9_-]*");

    static final Pattern PERMISSION = Pattern.compile("[A-Za-z][A-Za-z0-9_-]{0,63}");

    /** The path around its placeholder: segments of unreserved characters only, no query. */
    private static final Pattern PATH_PART = Pattern.compile("[A-Za-z0-9/._~-]*");

    static final Pattern HEADER = Pattern.compile("[A-Za-z0-9-]{1,64}");

    /**
     * Headers a connector may not send its credential in: the ones Java's client refuses, and
     * those that would change where or how the request goes rather than who sends it.
     */
    private static final Set<String> FORBIDDEN_HEADERS = Set.of("connection", "content-length", "expect", "host",
            "upgrade", "transfer-encoding", "te", "trailer", "keep-alive", "proxy-authorization",
            "proxy-connection", "accept", "cookie", "content-type");

    /**
     * The connector a descriptor describes, or why it cannot be used. Every problem is named, so a
     * kit's author can fix them in one go; none of them quotes a value that could be a secret,
     * since a contribution holds none.
     */
    public static Connector of(ConnectorDescriptor d) {
        List<String> problems = new ArrayList<>();
        String id = d.getId();
        // Not ending ".http", ".cache" or ".events": that connector's own names would hold one of the
        // server's settings for another, its http switch, its cache or its events secret.
        if (id == null || !ID.matcher(id).matches() || endsInServerSegment(id)) {
            problems.add("its id must be 1 to 64 letters, digits, '.', '_' or '-', starting with a letter, and not"
                    + " end in .http, .cache or .events");
        }
        String own = PROPERTY_PREFIX + id + ".";
        List<String> types = d.getTypes() == null ? List.of() : List.copyOf(d.getTypes());
        if (types.isEmpty() || types.size() > MAX_TYPES || !types.stream().allMatch(t -> TYPE.matcher(t).matches())) {
            problems.add("it needs 1 to " + MAX_TYPES + " <type> elements: the document types it reads a key from");
        }
        String addressProperty = d.getAddressProperty();
        if (addressProperty == null || !ownProperty(addressProperty, own)) {
            problems.add("<address property=\"...\"/> must name the server property that holds the system's address, "
                    + own + "<name>");
        }
        String path = d.getPath();
        if (!soundPath(path)) {
            problems.add("<path> must start with '/', hold " + KEY_PLACEHOLDER
                    + " once, and otherwise only letters, digits and '/', '.', '_', '~' or '-', with no empty, '.' or"
                    + " '..' segment and no query");
        }
        String keyXpath = d.getKeyXpath();
        if (keyXpath == null || !XPATH.matcher(keyXpath).matches()) {
            problems.add("<key xpath=\"...\"/> must name the document property holding the key, as prefix:name");
        }
        String permission = d.getPermission() == null || d.getPermission().isBlank() ? DEFAULT_PERMISSION
                : d.getPermission();
        if (!PERMISSION.matcher(permission).matches()) {
            problems.add("<permission> must be the name of a Nuxeo permission, such as Read");
        }
        Credential credential = credential(d, own, problems);
        Duration connectTimeout = millis("connectTimeout", d.getConnectTimeout(), DEFAULT_CONNECT_TIMEOUT_MS,
                MIN_TIMEOUT_MS, MAX_CONNECT_TIMEOUT_MS, problems);
        Duration timeout = millis("timeout", d.getTimeout(), DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS,
                problems);
        int maxBytes = d.getMaxBytes() == null ? DEFAULT_MAX_BYTES : d.getMaxBytes();
        if (maxBytes < MIN_MAX_BYTES || maxBytes > MAX_MAX_BYTES) {
            problems.add("<maxBytes> must be from " + MIN_MAX_BYTES + " to " + MAX_MAX_BYTES);
        }
        int maxConcurrent = d.getMaxConcurrent() == null ? DEFAULT_MAX_CONCURRENT : d.getMaxConcurrent();
        if (maxConcurrent < 1 || maxConcurrent > MAX_MAX_CONCURRENT) {
            problems.add("<maxConcurrent> must be from 1 to " + MAX_MAX_CONCURRENT);
        }
        List<Field> fields = fields(d.getFields(), problems);
        if (!problems.isEmpty()) {
            throw new IllegalArgumentException(
                    "connector " + (id == null ? "with no id" : '"' + id + '"') + ": " + String.join("; ", problems));
        }
        return new Connector(id, types, addressProperty, path, keyXpath, permission, credential, connectTimeout,
                timeout, maxBytes, maxConcurrent, List.copyOf(fields));
    }

    /** The server property that, set to {@code true}, lets this connector call a plain http address. */
    public String httpAllowedProperty() {
        return PROPERTY_PREFIX + id + ".http.allowed";
    }

    /**
     * The server property that turns this connector's cache on: how long, in whole seconds, an answer
     * is kept ({@link ConnectorCache}). Unset, nothing is kept. The server's alone: no contribution and
     * no request sets it.
     */
    public String cacheTtlProperty() {
        return PROPERTY_PREFIX + id + ".cache.ttl";
    }

    /** The server property that bounds how many answers this connector's cache keeps. */
    public String cacheMaxEntriesProperty() {
        return PROPERTY_PREFIX + id + ".cache.maxEntries";
    }

    /**
     * The server property that holds the secret this connector's system of record signs its change
     * events with ({@link ChangeEvents}). Unset, the connector takes no events.
     */
    public String eventsSecretProperty() {
        return PROPERTY_PREFIX + id + ".events.secret";
    }

    /**
     * The first of the two names under a connector's prefix that the server's own settings for it
     * use: {@code <id>.http.allowed}, {@code <id>.cache.ttl}, {@code <id>.cache.maxEntries} and
     * {@code <id>.events.secret}. A contribution names one name after its own prefix, so a connector
     * whose id ended in one of these, {@code payers.events} say, could name {@code payers}'s
     * {@code events.secret} as its credential and have it sent to its own address. No id ends in one.
     */
    static final Set<String> SERVER_SEGMENTS = Set.of("http", "cache", "events");

    static boolean endsInServerSegment(String id) {
        int dot = id.lastIndexOf('.');
        return dot >= 0 && SERVER_SEGMENTS.contains(id.substring(dot + 1));
    }

    /** One name after a connector's own prefix: never a dot, so never another connector's setting. */
    private static final Pattern OWN_NAME = Pattern.compile("[A-Za-z0-9_-]{1,64}");

    private static final Pattern OWN_ENV_NAME = Pattern.compile("[A-Z0-9]{1,64}");

    /**
     * A property of the connector's own: its prefix, then one name. Ids may hold dots, so a prefix
     * alone would let {@code payers} name {@code payers.claimPayments}'s token; one name after it
     * cannot reach another connector's, whose names are a segment further down.
     */
    private static boolean ownProperty(String name, String own) {
        return PROPERTY.matcher(name).matches() && name.startsWith(own)
                && OWN_NAME.matcher(name.substring(own.length())).matches();
    }

    /**
     * Where this connector's environment variables start: {@code NUXEO_CONNECTOR_}, its id in capitals
     * with {@code .} and {@code -} as {@code _}, and {@code _}. Two ids that map to one prefix,
     * {@code a.b} and {@code a_b}, are refused together when registered.
     */
    public static String envPrefix(String id) {
        return ENV_PREFIX + id.toUpperCase(Locale.ROOT).replace('.', '_').replace('-', '_') + "_";
    }

    /** A variable of the connector's own: its prefix, then one name of capitals and digits, no {@code _}. */
    private static boolean ownEnv(String name, String id) {
        String prefix = envPrefix(id);
        return ENV.matcher(name).matches() && name.startsWith(prefix)
                && OWN_ENV_NAME.matcher(name.substring(prefix.length())).matches();
    }

    static boolean soundPath(String path) {
        if (path == null || path.length() > 256 || !path.startsWith("/")) {
            return false;
        }
        int at = path.indexOf(KEY_PLACEHOLDER);
        if (at < 0 || path.indexOf(KEY_PLACEHOLDER, at + 1) >= 0) {
            return false;
        }
        String around = path.substring(0, at) + "k" + path.substring(at + KEY_PLACEHOLDER.length());
        if (!PATH_PART.matcher(around).matches()) {
            return false;
        }
        // The first part is empty: the path starts with '/'.
        String[] segments = around.substring(1).split("/", -1);
        for (String segment : segments) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) {
                return false;
            }
        }
        return true;
    }

    private static Credential credential(ConnectorDescriptor d, String own, List<String> problems) {
        String header = d.getCredentialHeader();
        boolean named = d.getCredentialProperty() != null || d.getCredentialEnv() != null
                || d.getCredentialPrefix() != null;
        if (header == null) {
            if (named) {
                problems.add("<credential> needs the header it is sent in");
            }
            return null;
        }
        if (!HEADER.matcher(header).matches() || FORBIDDEN_HEADERS.contains(header.toLowerCase(Locale.ROOT))
                || header.toLowerCase(Locale.ROOT).startsWith("proxy-")) {
            problems.add("<credential header> must be a header such as Authorization or X-Api-Key");
        }
        String prefix = d.getCredentialPrefix() == null ? "" : d.getCredentialPrefix();
        if (prefix.length() > 32 || !prefix.chars().allMatch(c -> c >= 0x20 && c < 0x7f)) {
            problems.add("<credential prefix> must be up to 32 printable characters, such as \"Bearer \"");
        }
        String property = d.getCredentialProperty();
        String env = d.getCredentialEnv();
        if (property == null && env == null) {
            problems.add("<credential> must name a server property or an environment variable that holds it");
        }
        if (property != null && !ownProperty(property, own)) {
            problems.add("<credential property> must be the name of a server property of the connector's own, " + own
                    + "<name>");
        }
        String id = d.getId();
        if (env != null && (id == null || !ownEnv(env, id))) {
            problems.add("<credential env> must be an environment variable of the connector's own: "
                    + (id == null ? ENV_PREFIX + "<ID>_" : envPrefix(id)) + "<NAME>, in capitals and digits");
        }
        return new Credential(header, prefix, property, env);
    }

    private static Duration millis(String element, Integer given, int fallback, int min, int max,
            List<String> problems) {
        int value = given == null ? fallback : given;
        if (value < min || value > max) {
            problems.add("<" + element + "> must be from " + min + " to " + max + " milliseconds");
        }
        return Duration.ofMillis(value);
    }

    private static List<Field> fields(List<ConnectorDescriptor.FieldDescriptor> given, List<String> problems) {
        List<Field> fields = new ArrayList<>();
        if (given == null || given.isEmpty()) {
            problems.add("it needs at least one <field>: the fields it may return");
            return fields;
        }
        if (given.size() > MAX_FIELDS) {
            problems.add("it may return at most " + MAX_FIELDS + " fields");
        }
        Set<String> names = new HashSet<>();
        for (ConnectorDescriptor.FieldDescriptor field : given) {
            String name = field.getName();
            if (name == null || !FIELD_NAME.matcher(name).matches()) {
                problems.add("a <field name> must be 1 to 64 letters, digits or '_', starting with a letter");
                continue;
            }
            if (!names.add(name)) {
                problems.add("the field \"" + name + "\" is named twice");
                continue;
            }
            String pointer = field.getPointer() == null ? "/" + name : field.getPointer();
            try {
                if (!pointer.startsWith("/") || pointer.length() > 256) {
                    throw new IllegalArgumentException();
                }
                fields.add(new Field(name, JsonPointer.compile(pointer)));
            } catch (IllegalArgumentException e) {
                problems.add("the field \"" + name + "\" has a pointer that is not a JSON pointer, such as /payment/amount");
            }
        }
        return fields;
    }
}
