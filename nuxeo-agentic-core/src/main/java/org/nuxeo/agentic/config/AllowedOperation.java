package org.nuxeo.agentic.config;

import java.io.Serializable;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * An operation or chain on this server's allow-list, as {@link #of} accepted it: what an app's
 * button may run, who may run it, and the parameters it may be given.
 *
 * @param permission the permission the reader needs on the record, besides {@code Read}
 * @param groups the groups the reader must be in one of; none means any reader with the permission
 * @param parameters each parameter an app's action may give, by its name
 * @param apps the apps whose buttons may run it; none means any app
 * @param types the types of record it runs on; none means any
 * @param states the lifecycle states the record must be in; none means any
 */
public record AllowedOperation(String id, String permission, Set<String> groups,
        Map<String, Parameter> parameters, Set<String> apps, Set<String> types, Set<String> states) {

    /**
     * Operations that run another operation, a script or as another user, by a name or a text they
     * are given: on the allow-list, any of them would allow everything. Never allowed.
     */
    static final Set<String> NEVER = Set.of("RunOperation", "Context.RunOperation", "RunOperationOnList",
            "Context.RunOperationOnList", "RunOperationOnListInNewTx", "Context.RunOperationOnListInNewTx",
            "RunDocumentOperation", "Context.RunDocumentOperation", "Context.RunDocumentOperationInNewTx",
            "RunFileOperation", "Context.RunFileOperation", "RunOperationOnProvider",
            "Context.RunOperationOnProvider", "RunInputScript", "Context.RunInputScript", "RunScript",
            "Context.RunScript", "Context.RestoreDocumentInputFromScript", "Context.RestoreDocumentsInputFromScript",
            "Context.RestoreBlobInputFromScript", "Context.RestoreBlobsInputFromScript", "Auth.LoginAs",
            "Auth.Logout");

    /** A name a record's type, a state or an app may have: letters, digits, `.`, `_` and `-`. */
    static final Pattern NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,127}");

    /** A field source: `field:<prefix>:<name>`, as a field reference writes the property. */
    static final Pattern FIELD_SOURCE = Pattern.compile("field:([A-Za-z_][A-Za-z0-9_-]*:[A-Za-z_][A-Za-z0-9_-]*)");

    /** As the validator and {@code actions.schema.json} write an operation's id. */
    static final Pattern ID = Pattern.compile("[A-Za-z][A-Za-z0-9_.-]{0,127}");

    /** As the validator writes a parameter's name. */
    static final Pattern PARAMETER = Pattern.compile("[A-Za-z][A-Za-z0-9_]{0,63}");

    /** A Nuxeo permission's name, such as {@code Write} or {@code ReadWrite}. */
    static final Pattern PERMISSION = Pattern.compile("[A-Za-z][A-Za-z0-9_]{0,63}");

    static final String DEFAULT_PERMISSION = "Write";

    static final int MAX_PARAMETERS = 64;

    static final int DEFAULT_MAX_LENGTH = 1000;

    static final int MAX_LENGTH = 10_000;

    public AllowedOperation {
        groups = Set.copyOf(groups);
        parameters = java.util.Collections.unmodifiableMap(new LinkedHashMap<>(parameters));
        apps = Set.copyOf(apps);
        types = Set.copyOf(types);
        states = Set.copyOf(states);
    }

    /** With no app, type or state to narrow it. */
    public AllowedOperation(String id, String permission, Set<String> groups, Map<String, Parameter> parameters) {
        this(id, permission, groups, parameters, Set.of(), Set.of(), Set.of());
    }

    /** The type of a parameter's value, as the operation is given it. */
    public enum Type {
        /** A {@link String}, at most the parameter's {@code maxLength} characters, with no control character but tab and line breaks. */
        STRING,
        /** A {@link Boolean}. */
        BOOLEAN,
        /** A {@link Long}: a whole number. */
        LONG,
        /** A {@link Double}: a finite number. */
        DOUBLE;

        String label() {
            return name().toLowerCase(Locale.ROOT);
        }

        static Type of(String type) {
            for (Type candidate : values()) {
                if (candidate.label().equals(type)) {
                    return candidate;
                }
            }
            return null;
        }
    }

    /**
     * A parameter an app may give the operation, and what its value must be.
     *
     * @param source where its value may come from: `input`, `literal` or `field:<xpath>`; any,
     *            when {@code null}
     * @param required whether the operation must be given a value
     */
    public record Parameter(String name, Type type, int maxLength, String source, boolean required) {

        /** From anywhere, and not required. */
        public Parameter(String name, Type type, int maxLength) {
            this(name, type, maxLength, null, false);
        }

        /** Whether its value may come from {@code from}, as an app's action gives it. */
        boolean admits(RunnableAction.Source from) {
            if (source == null) {
                return true;
            }
            return switch (from) {
                case RunnableAction.Input input -> "input".equals(source);
                case RunnableAction.Literal literal -> "literal".equals(source);
                case RunnableAction.Field field -> source.equals("field:" + field.xpath());
            };
        }

        /**
         * A value from JSON, an app's literal or what the person entered, as the operation is given
         * it; {@code null} for a JSON {@code null}, which gives the operation nothing.
         *
         * @throws IllegalArgumentException naming why the value is not one of this parameter's
         */
        Object fromJson(JsonNode value) {
            if (value == null || value.isNull()) {
                return null;
            }
            return switch (type) {
                case STRING -> {
                    if (!value.isTextual()) {
                        throw new IllegalArgumentException("is not a text");
                    }
                    yield text(value.textValue());
                }
                case BOOLEAN -> {
                    if (!value.isBoolean()) {
                        throw new IllegalArgumentException("is not true or false");
                    }
                    yield value.booleanValue();
                }
                case LONG -> {
                    if (!value.isIntegralNumber() || !value.canConvertToLong()) {
                        throw new IllegalArgumentException("is not a whole number");
                    }
                    yield value.longValue();
                }
                case DOUBLE -> {
                    if (!value.isNumber() || !Double.isFinite(value.doubleValue())) {
                        throw new IllegalArgumentException("is not a number");
                    }
                    yield value.doubleValue();
                }
            };
        }

        /**
         * A property's value as the repository stores it, read from the record, as the operation is
         * given it; {@code null} for none, which gives the operation nothing.
         *
         * @throws IllegalArgumentException naming why the value is not one of this parameter's
         */
        Object fromProperty(Serializable value) {
            if (value == null) {
                return null;
            }
            return switch (type) {
                case STRING -> {
                    if (!(value instanceof String text)) {
                        throw new IllegalArgumentException("is not a text on the record");
                    }
                    yield text(text);
                }
                case BOOLEAN -> {
                    if (!(value instanceof Boolean flag)) {
                        throw new IllegalArgumentException("is not true or false on the record");
                    }
                    yield flag;
                }
                case LONG -> {
                    if (!(value instanceof Long || value instanceof Integer || value instanceof Short)) {
                        throw new IllegalArgumentException("is not a whole number on the record");
                    }
                    yield ((Number) value).longValue();
                }
                case DOUBLE -> {
                    if (!(value instanceof Double || value instanceof Float || value instanceof Long
                            || value instanceof Integer || value instanceof Short)
                            || !Double.isFinite(((Number) value).doubleValue())) {
                        throw new IllegalArgumentException("is not a number on the record");
                    }
                    yield ((Number) value).doubleValue();
                }
            };
        }

        private String text(String text) {
            if (text.codePointCount(0, text.length()) > maxLength) {
                throw new IllegalArgumentException("is longer than " + maxLength + " characters");
            }
            for (int i = 0; i < text.length(); i++) {
                char c = text.charAt(i);
                if (Character.isISOControl(c) && c != '\t' && c != '\n' && c != '\r') {
                    throw new IllegalArgumentException("holds a control character");
                }
            }
            return text;
        }
    }

    /**
     * The allow-list's entry a descriptor makes, once it passes every check.
     *
     * @throws IllegalArgumentException naming the first check it fails
     */
    static AllowedOperation of(AllowedOperationDescriptor descriptor) {
        String id = descriptor.id;
        if (id == null || !ID.matcher(id).matches()) {
            throw new IllegalArgumentException(
                    "its id is not an operation's: 1 to 128 letters, digits, '.', '_' or '-', starting with a letter");
        }
        if (id.startsWith("AgenticUi.")) {
            throw new IllegalArgumentException(id + " is the platform's own, which runs the allow-list, not an operation on it");
        }
        if (NEVER.contains(id)) {
            throw new IllegalArgumentException(
                    id + " runs another operation, a script or as another user, so it would allow everything");
        }
        String permission = descriptor.permission == null || descriptor.permission.isBlank() ? DEFAULT_PERMISSION
                : descriptor.permission;
        if (!PERMISSION.matcher(permission).matches()) {
            throw new IllegalArgumentException(id + ": its permission is not a permission's name: " + permission);
        }
        Set<String> groups = new LinkedHashSet<>();
        for (String group : descriptor.groups) {
            if (group == null || group.isBlank() || !group.equals(group.strip())) {
                throw new IllegalArgumentException(id + ": a group is empty, or has spaces around it");
            }
            groups.add(group);
        }
        Set<String> apps = names(id, "an app", descriptor.apps);
        for (String app : apps) {
            if (!ConfigScope.APP_ID.matcher(app).matches()) {
                throw new IllegalArgumentException(id + ": the app " + app + " is not an app's id");
            }
        }
        Set<String> types = names(id, "a type", descriptor.types);
        Set<String> states = names(id, "a state", descriptor.states);
        if (descriptor.parameters.size() > MAX_PARAMETERS) {
            throw new IllegalArgumentException(id + ": more than " + MAX_PARAMETERS + " parameters");
        }
        Map<String, Parameter> parameters = new LinkedHashMap<>();
        for (AllowedOperationDescriptor.ParameterDescriptor parameter : descriptor.parameters) {
            String name = parameter.name;
            if (name == null || !PARAMETER.matcher(name).matches()) {
                throw new IllegalArgumentException(
                        id + ": a parameter's name is not one: a letter, then up to 63 letters, digits or '_'");
            }
            if (parameters.containsKey(name)) {
                throw new IllegalArgumentException(id + ": the parameter " + name + " is listed twice");
            }
            Type type = Type.of(parameter.type);
            if (type == null) {
                throw new IllegalArgumentException(
                        id + ": the parameter " + name + " has no type: string, boolean, long or double");
            }
            int maxLength = DEFAULT_MAX_LENGTH;
            if (parameter.maxLength != null && !parameter.maxLength.isBlank()) {
                if (type != Type.STRING) {
                    throw new IllegalArgumentException(id + ": the parameter " + name + " is not a string, and has a maxLength");
                }
                try {
                    maxLength = Integer.parseInt(parameter.maxLength.strip());
                } catch (NumberFormatException e) {
                    maxLength = -1;
                }
                if (maxLength < 1 || maxLength > MAX_LENGTH) {
                    throw new IllegalArgumentException(
                            id + ": the parameter " + name + "'s maxLength is not from 1 to " + MAX_LENGTH);
                }
            }
            String source = parameter.source == null || parameter.source.isBlank() ? null : parameter.source.strip();
            if (source != null && !"input".equals(source) && !"literal".equals(source)
                    && !FIELD_SOURCE.matcher(source).matches()) {
                throw new IllegalArgumentException(id + ": the parameter " + name
                        + "'s source is not input, literal or field:<prefix>:<name>");
            }
            parameters.put(name, new Parameter(name, type, maxLength, source, parameter.required));
        }
        return new AllowedOperation(id, permission, groups, parameters, apps, types, states);
    }

    /** Each of {@code values}, a name of the kind {@code what}, or a refusal naming the first that is not. */
    private static Set<String> names(String id, String what, java.util.List<String> values) {
        Set<String> names = new LinkedHashSet<>();
        for (String value : values) {
            if (value == null || !NAME.matcher(value).matches()) {
                throw new IllegalArgumentException(id + ": " + what + " is empty, or not a name");
            }
            names.add(value);
        }
        return names;
    }
}
