/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * A rights policy as the server applies it: read once from its descriptor, then never changed.
 *
 * <p>Every mistake a package can make in a policy is read as a refusal, never as a use let
 * through:
 * <ul>
 * <li>a policy with no {@code rightsEnd} or no {@code channels} is <em>broken</em>, and refuses
 * every use of its type;</li>
 * <li>a use with both a channel and {@code preview="true"}, or with neither, is refused as one the
 * policy does not list, whatever other declaration of the same use comes before or after it;</li>
 * <li>a use listed twice keeps the stricter of the two: a channel over a preview, and the first
 * channel over a later one.</li>
 * </ul>
 * {@link #problems()} lists each one, for the server log.
 */
public final class RightsPolicy {

    /** The original's xpath when the policy names none: the main blob of a Picture or a File. */
    public static final String DEFAULT_ORIGINAL_XPATH = "file:content";

    /** What clears one use: the channel that covers it, or {@code null} for a preview. */
    public record Rule(String channel) {

        static final Rule PREVIEW = new Rule(null);

        public boolean preview() {
            return channel == null;
        }
    }

    private final String type;

    private final String rightsEndXpath;

    private final String channelsXpath;

    private final String originalXpath;

    private final Map<Use, Rule> rules;

    private final List<String> problems;

    private final boolean broken;

    private RightsPolicy(String type, String rightsEndXpath, String channelsXpath, String originalXpath,
            Map<Use, Rule> rules, List<String> problems, boolean broken) {
        this.type = type;
        this.rightsEndXpath = rightsEndXpath;
        this.channelsXpath = channelsXpath;
        this.originalXpath = originalXpath;
        this.rules = Collections.unmodifiableMap(rules);
        this.problems = List.copyOf(problems);
        this.broken = broken;
    }

    /** The policy a descriptor describes, with each of its mistakes read as a refusal. */
    public static RightsPolicy of(RightsPolicyDescriptor descriptor) {
        List<String> problems = new ArrayList<>();
        String type = trimmed(descriptor.getType());
        String rightsEnd = trimmed(descriptor.getRightsEndXpath());
        String channels = trimmed(descriptor.getChannelsXpath());
        boolean broken = false;
        if (rightsEnd == null) {
            problems.add("no <rightsEnd xpath=\"...\">: every use is refused");
            broken = true;
        }
        if (channels == null) {
            problems.add("no <channels xpath=\"...\">: every use is refused");
            broken = true;
        }
        Map<Use, Rule> rules = new LinkedHashMap<>();
        Set<Use> malformed = new LinkedHashSet<>();
        String originalXpath = DEFAULT_ORIGINAL_XPATH;
        UseDescriptor original = descriptor.getOriginal();
        if (original != null) {
            String xpath = trimmed(original.getXpath());
            if (xpath != null) {
                originalXpath = xpath;
            }
            put(rules, malformed, problems, Use.ORIGINAL, original);
        }
        for (UseDescriptor view : descriptor.getViews()) {
            String name = trimmed(view.getName());
            if (name == null) {
                problems.add("a <view> with no name is left out");
            } else {
                put(rules, malformed, problems, Use.view(name), view);
            }
        }
        for (UseDescriptor rendition : descriptor.getRenditions()) {
            String name = trimmed(rendition.getName());
            if (name == null) {
                problems.add("a <rendition> with no name is left out");
            } else {
                put(rules, malformed, problems, Use.rendition(name), rendition);
            }
        }
        for (UseDescriptor blob : descriptor.getBlobs()) {
            String xpath = trimmed(blob.getXpath());
            if (xpath == null) {
                problems.add("a <blob> with no xpath is left out");
            } else {
                put(rules, malformed, problems, Use.blob(xpath), blob);
            }
        }
        // A use declared wrongly once is refused, whatever else declares it, before or after.
        rules.keySet().removeAll(malformed);
        return new RightsPolicy(type, rightsEnd, channels, originalXpath, rules, problems, broken);
    }

    private static void put(Map<Use, Rule> rules, Set<Use> malformed, List<String> problems, Use use,
            UseDescriptor descriptor) {
        String channel = trimmed(descriptor.getChannel());
        boolean preview = descriptor.isPreview();
        if (channel != null && preview) {
            problems.add(use + " has both a channel and preview=\"true\": it is refused, whatever else declares it");
            malformed.add(use);
            return;
        }
        if (channel == null && !preview) {
            problems.add(use + " has neither a channel nor preview=\"true\": it is refused, whatever else declares it");
            malformed.add(use);
            return;
        }
        Rule rule = preview ? Rule.PREVIEW : new Rule(channel);
        Rule earlier = rules.get(use);
        if (earlier == null) {
            rules.put(use, rule);
        } else if (!earlier.equals(rule)) {
            problems.add(use + " is listed twice: the stricter rule is kept");
            if (earlier.preview()) {
                rules.put(use, rule);
            }
        }
    }

    private static String trimmed(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    public String type() {
        return type;
    }

    public String rightsEndXpath() {
        return rightsEndXpath;
    }

    public String channelsXpath() {
        return channelsXpath;
    }

    /** Where the original is: {@code file:content}, unless the policy's {@code <original>} says. */
    public String originalXpath() {
        return originalXpath;
    }

    /** What clears {@code use}, or {@code null} when the policy does not list it. */
    public Rule rule(Use use) {
        return rules.get(use);
    }

    /** Every use the policy lists, in its order. */
    public Map<Use, Rule> rules() {
        return rules;
    }

    /** A policy with no rights end or no channels: it refuses every use of its type. */
    public boolean broken() {
        return broken;
    }

    /** Each mistake read from the descriptor, and what it means. Empty for a sound policy. */
    public List<String> problems() {
        return problems;
    }
}
