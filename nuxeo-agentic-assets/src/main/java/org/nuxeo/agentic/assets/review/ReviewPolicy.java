/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.review;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import org.nuxeo.ecm.core.api.security.SecurityConstants;

/**
 * A review policy as the server applies it: the document type, and the reviewer groups, read once
 * from its descriptor. A mistake never widens it: a group that is not a group's name, or that names
 * everyone, is left out and said in {@link #problems()}; a policy left with no group lets no one
 * decide a review of its type.
 *
 * @param type the document type it covers, exactly: a subtype is not covered by its parent's
 * @param groups the reviewer groups, in their order
 * @param problems each mistake read from the descriptor, for the server log
 */
public record ReviewPolicy(String type, Set<String> groups, List<String> problems) {

    /** A group's name, as Nuxeo's group directory writes one: letters, digits and {@code @ . _ + -}. */
    static final Pattern GROUP = Pattern.compile("[A-Za-z0-9@._+-]{1,128}");

    public ReviewPolicy {
        groups = java.util.Collections.unmodifiableSet(new LinkedHashSet<>(groups));
        problems = List.copyOf(problems);
    }

    /** The policy a descriptor describes; {@code null} for one with no type. */
    public static ReviewPolicy of(ReviewPolicyDescriptor descriptor) {
        String type = trimmed(descriptor.getType());
        if (type == null) {
            return null;
        }
        List<String> problems = new ArrayList<>();
        Set<String> groups = new LinkedHashSet<>();
        for (String written : descriptor.getGroups()) {
            String group = trimmed(written);
            if (group == null) {
                problems.add("a <reviewer> with no group is left out");
            } else if (!GROUP.matcher(group).matches()) {
                problems.add("<reviewer group=\"" + group + "\"> is not a group's name, and is left out");
            } else if (SecurityConstants.EVERYONE.equalsIgnoreCase(group)
                    || SecurityConstants.SYSTEM_USERNAME.equalsIgnoreCase(group)) {
                problems.add("<reviewer group=\"" + group + "\"> names no group of people, and is left out");
            } else {
                groups.add(group);
            }
        }
        if (groups.isEmpty()) {
            problems.add("no reviewer group: no one may decide a review of " + type);
        }
        return new ReviewPolicy(type, groups, problems);
    }

    private static String trimmed(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
