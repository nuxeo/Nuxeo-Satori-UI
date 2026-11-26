package org.nuxeo.agentic.embedded;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * A host application, as {@link #of} accepts it from a {@link HostDescriptor}: every value checked,
 * every list bounded, and defaults applied. Immutable.
 *
 * @param id what the host authenticates as, and the names of its settings follow from
 * @param algorithm what its assertions are signed with
 * @param issuer the {@code iss} its assertions carry
 * @param origins the pages' origins a panel is shown on for it, exactly as a browser sends them
 * @param users the host's subjects the configuration maps to a Nuxeo user, by subject
 * @param groups when not empty, a subject not in {@code users} is taken as a Nuxeo username, of a
 *            member of one of these groups only
 * @param allowAdministrators whether an exchange may be for an administrator: never by default
 * @param scopes what its tokens may be given: {@code read}, and {@code write} only if named
 * @param operations the Automation operations a {@code read} token may run, all reads
 * @param tokenLifetime how long a token lives, in seconds
 */
public record Host(String id, Algorithm algorithm, String issuer, Set<String> origins, Map<String, String> users,
        Set<String> groups, boolean allowAdministrators, Set<String> scopes, Set<String> operations,
        int tokenLifetime) {

    /** What a host signs its assertions with: an HMAC with a shared key, or a key pair. */
    public enum Algorithm {
        HS256, RS256, ES256
    }

    public static final String READ = "read";

    public static final String WRITE = "write";

    /** The operation a panel's card from another system runs: a read, by its contract. */
    public static final String CONNECTOR_READ = "Connector.Read";

    static final int DEFAULT_TOKEN_LIFETIME = 300;

    static final int MIN_TOKEN_LIFETIME = 60;

    static final int MAX_TOKEN_LIFETIME = 900;

    static final int MAX_ORIGINS = 20;

    static final int MAX_USERS = 1000;

    static final int MAX_GROUPS = 50;

    static final int MAX_OPERATIONS = 20;

    /**
     * Lower-case letters, digits and dashes, starting with a letter: so that the names of its
     * settings, {@code nuxeo.agentic.embedded.<id>.*} and {@code NUXEO_EMBEDDED_<ID>_*}, are one
     * host's each, and no two ids give the same environment variable.
     */
    static final Pattern ID = Pattern.compile("[a-z][a-z0-9-]{0,31}");

    /** An identifier from another system: printable, no space, bounded. */
    static final Pattern IDENTIFIER = Pattern.compile("[\\x21-\\x7E]{1,256}");

    static final Pattern OPERATION = Pattern.compile("[A-Za-z][A-Za-z0-9_.-]{0,127}");

    static final Set<String> LOOPBACK = Set.of("localhost", "127.0.0.1", "[::1]");

    public Host {
        origins = Collections.unmodifiableSet(new LinkedHashSet<>(origins));
        users = Collections.unmodifiableMap(new LinkedHashMap<>(users));
        groups = Collections.unmodifiableSet(new LinkedHashSet<>(groups));
        scopes = Collections.unmodifiableSet(new LinkedHashSet<>(scopes));
        operations = Collections.unmodifiableSet(new LinkedHashSet<>(operations));
    }

    /** The server property that holds the secret the host authenticates with. */
    public String clientSecretProperty() {
        return "nuxeo.agentic.embedded." + id + ".clientSecret";
    }

    /** The environment variable that may hold it instead. */
    public String clientSecretEnv() {
        return envPrefix() + "CLIENT_SECRET";
    }

    /** The server property that holds the key the host's assertions are verified with. */
    public String assertionKeyProperty() {
        return "nuxeo.agentic.embedded." + id + ".assertionKey";
    }

    /** The environment variable that may hold it instead. */
    public String assertionKeyEnv() {
        return envPrefix() + "ASSERTION_KEY";
    }

    private String envPrefix() {
        return "NUXEO_EMBEDDED_" + id.toUpperCase(Locale.ROOT).replace('-', '_') + "_";
    }

    /** The scope a token of this host's is given for a request's {@code scope}, or {@code null}. */
    public String grantedScope(String requested) {
        if (requested == null || requested.isBlank()) {
            return READ;
        }
        Set<String> asked = new LinkedHashSet<>(List.of(requested.trim().split(" +")));
        for (String scope : asked) {
            if (!scopes.contains(scope)) {
                return null;
            }
        }
        return asked.contains(WRITE) ? READ + " " + WRITE : READ;
    }

    /**
     * Checks a contribution and builds the host from it.
     *
     * @throws IllegalArgumentException naming every problem, when one is found
     */
    public static Host of(HostDescriptor descriptor) {
        List<String> problems = new ArrayList<>();
        String id = trim(descriptor.getId());
        if (id == null || !ID.matcher(id).matches()) {
            problems.add("id must be 1 to 32 lower-case letters, digits or dashes, starting with a letter");
        }
        Algorithm algorithm = null;
        String named = trim(descriptor.getAlgorithm());
        if (named == null) {
            problems.add("assertion@algorithm is required: HS256, RS256 or ES256");
        } else {
            try {
                algorithm = Algorithm.valueOf(named);
            } catch (IllegalArgumentException e) {
                problems.add("assertion@algorithm must be HS256, RS256 or ES256, not " + named);
            }
        }
        String issuer = trim(descriptor.getIssuer());
        if (issuer == null || !IDENTIFIER.matcher(issuer).matches()) {
            problems.add("assertion@issuer is required: 1 to 256 printable characters, no space");
        }

        Set<String> origins = new LinkedHashSet<>();
        if (descriptor.getOrigins().isEmpty() || descriptor.getOrigins().size() > MAX_ORIGINS) {
            problems.add("between 1 and " + MAX_ORIGINS + " origins are required");
        }
        for (String each : descriptor.getOrigins()) {
            String origin = origin(each);
            if (origin == null) {
                problems.add("origin " + each + " is not an origin: https://host or https://host:port, with no path, "
                        + "and plain http only for localhost, 127.0.0.1 or [::1]");
            } else if (!origins.add(origin)) {
                problems.add("origin " + origin + " is named twice");
            }
        }

        Map<String, String> users = new LinkedHashMap<>();
        if (descriptor.getUsers().size() > MAX_USERS) {
            problems.add("at most " + MAX_USERS + " users are mapped");
        }
        for (HostDescriptor.UserDescriptor user : descriptor.getUsers()) {
            String subject = trim(user.getSubject());
            String username = trim(user.getUsername());
            if (subject == null || !IDENTIFIER.matcher(subject).matches()) {
                problems.add("a user's subject must be 1 to 256 printable characters, no space");
            } else if (username == null || username.length() > 256) {
                problems.add("the user mapped from subject " + subject + " must name a Nuxeo user");
            } else if (users.putIfAbsent(subject, username) != null) {
                problems.add("subject " + subject + " is mapped twice");
            }
        }
        Set<String> groups = new LinkedHashSet<>();
        if (descriptor.getGroups().size() > MAX_GROUPS) {
            problems.add("at most " + MAX_GROUPS + " groups are named");
        }
        for (String each : descriptor.getGroups()) {
            String group = trim(each);
            if (group == null || group.length() > 256) {
                problems.add("a group must be named");
            } else {
                groups.add(group);
            }
        }
        if (descriptor.getUsers().isEmpty() && descriptor.getGroups().isEmpty()) {
            problems.add("it maps no user: name a user by subject, or a group whose members it may sign in");
        }

        boolean allowAdministrators = false;
        String admins = trim(descriptor.getAllowAdministrators());
        if (admins != null) {
            if ("true".equals(admins)) {
                allowAdministrators = true;
            } else if (!"false".equals(admins)) {
                problems.add("allowAdministrators must be true or false");
            }
        }

        Set<String> scopes = new LinkedHashSet<>();
        scopes.add(READ);
        for (String each : descriptor.getScopes()) {
            String scope = trim(each);
            if (READ.equals(scope) || WRITE.equals(scope)) {
                scopes.add(scope);
            } else {
                problems.add("scope must be read or write, not " + scope);
            }
        }

        Set<String> operations = new LinkedHashSet<>();
        if (descriptor.getOperations().size() > MAX_OPERATIONS) {
            problems.add("at most " + MAX_OPERATIONS + " operations are named");
        }
        for (String each : descriptor.getOperations()) {
            String operation = trim(each);
            if (operation == null || !OPERATION.matcher(operation).matches()) {
                problems.add("operation " + each + " is not an operation's id");
            } else {
                operations.add(operation);
            }
        }
        if (operations.isEmpty()) {
            operations.add(CONNECTOR_READ);
        }

        int tokenLifetime = DEFAULT_TOKEN_LIFETIME;
        String lifetime = trim(descriptor.getTokenLifetime());
        if (lifetime != null) {
            try {
                tokenLifetime = Integer.parseInt(lifetime);
            } catch (NumberFormatException e) {
                tokenLifetime = -1;
            }
            if (tokenLifetime < MIN_TOKEN_LIFETIME || tokenLifetime > MAX_TOKEN_LIFETIME) {
                problems.add("tokenLifetime must be " + MIN_TOKEN_LIFETIME + " to " + MAX_TOKEN_LIFETIME
                        + " seconds");
            }
        }

        if (!problems.isEmpty()) {
            throw new IllegalArgumentException(
                    (id == null ? "a host" : "host " + id) + ": " + String.join("; ", problems));
        }
        return new Host(id, algorithm, issuer, origins, users, groups, allowAdministrators, scopes, operations,
                tokenLifetime);
    }

    /**
     * An origin as a browser sends it, {@code scheme://host[:port]} with the default port left out,
     * or {@code null} when the value is not one this accepts: https, or http on the loopback
     * interface only; a host; no user, path, query or fragment; no wildcard.
     */
    static String origin(String value) {
        String trimmed = trim(value);
        if (trimmed == null || trimmed.length() > 256 || trimmed.contains("*")) {
            return null;
        }
        URI uri;
        try {
            uri = new URI(trimmed);
        } catch (URISyntaxException e) {
            return null;
        }
        String scheme = uri.getScheme() == null ? null : uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost() == null ? null : uri.getHost().toLowerCase(Locale.ROOT);
        if (host == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null
                || uri.getRawFragment() != null || (uri.getRawPath() != null && !uri.getRawPath().isEmpty())) {
            return null;
        }
        int port = uri.getPort();
        if ("https".equals(scheme)) {
            return "https://" + host + (port == -1 || port == 443 ? "" : ":" + port);
        }
        if ("http".equals(scheme) && LOOPBACK.contains(host)) {
            return "http://" + host + (port == -1 || port == 80 ? "" : ":" + port);
        }
        return null;
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
