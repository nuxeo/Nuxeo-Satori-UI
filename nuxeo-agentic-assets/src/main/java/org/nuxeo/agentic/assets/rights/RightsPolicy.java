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
import java.util.regex.Pattern;

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
 * channel over a later one;</li>
 * <li>a {@code <blob>} at a video's transcoded video or storyboard frame is left out: those places
 * are decided by their conversion's {@code <rendition>} and by {@code <storyboard>}, so a rule by
 * place would never be read;</li>
 * <li>a policy with {@code <territories>} and no {@code <windows>}, or the other way round, is
 * <em>broken</em>: a territory with no window, or a window with no territory, decides nothing;</li>
 * <li>a {@code <delivery>} in a policy with no territories, or one that is empty, names a use its
 * policy does not list, a preview, a rendition or the storyboard, or gives an entry a channel or
 * {@code preview}, is <em>broken</em>: every delivery of the type is refused.</li>
 * </ul>
 * {@link #problems()} lists each one, for the server log.
 */
public final class RightsPolicy {

    /** The original's xpath when the policy names none: the main blob of a Picture or a File. */
    public static final String DEFAULT_ORIGINAL_XPATH = "file:content";

    /**
     * A video's places that {@link DownloadUse} names otherwise than by xpath: a transcoded video's
     * file, and a storyboard frame's, with the schema's prefix or its name or neither, a leading
     * slash or not, so that no {@code <blob>} rule stands for one in any of the forms the platform
     * reads.
     */
    private static final Pattern VIDEO_PLACE = Pattern.compile(
            "/?(?:(?:vid|video)[:;])?(?:transcodedVideos|storyboard)(?:/.*)?");

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

    private final String territoriesXpath;

    private final String windowsXpath;

    private final String windowsDocumentXpath;

    /** The delivery package's files, in its order; {@code null} when the policy has none. */
    private final List<Use> delivery;

    private final boolean deliveryBroken;

    private RightsPolicy(String type, String rightsEndXpath, String channelsXpath, String originalXpath,
            Map<Use, Rule> rules, List<String> problems, boolean broken, String territoriesXpath, String windowsXpath,
            String windowsDocumentXpath, List<Use> delivery, boolean deliveryBroken) {
        this.type = type;
        this.rightsEndXpath = rightsEndXpath;
        this.channelsXpath = channelsXpath;
        this.originalXpath = originalXpath;
        this.rules = Collections.unmodifiableMap(rules);
        this.problems = List.copyOf(problems);
        this.broken = broken;
        this.territoriesXpath = territoriesXpath;
        this.windowsXpath = windowsXpath;
        this.windowsDocumentXpath = windowsDocumentXpath;
        this.delivery = delivery == null ? null : List.copyOf(delivery);
        this.deliveryBroken = deliveryBroken;
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
            } else if (VIDEO_PLACE.matcher(xpath).matches()) {
                problems.add("<blob xpath=\"" + xpath + "\"> is left out: a transcoded video is decided by its"
                        + " conversion's <rendition name>, and a storyboard frame by <storyboard>");
            } else {
                put(rules, malformed, problems, Use.blob(xpath), blob);
            }
        }
        UseDescriptor storyboard = descriptor.getStoryboard();
        if (storyboard != null) {
            put(rules, malformed, problems, Use.STORYBOARD, storyboard);
        }
        // A use declared wrongly once is refused, whatever else declares it, before or after.
        rules.keySet().removeAll(malformed);

        String territories = trimmed(descriptor.getTerritoriesXpath());
        String windows = trimmed(descriptor.getWindowsXpath());
        String windowsDocument = trimmed(descriptor.getWindowsDocumentXpath());
        if (territories != null && windows == null) {
            problems.add("<territories> with no <windows xpath=\"...\">: every use is refused");
            broken = true;
        } else if (territories == null && windows != null) {
            problems.add("<windows> with no <territories xpath=\"...\">: every use is refused");
            broken = true;
        } else if (territories == null && windowsDocument != null) {
            problems.add("<windows document=\"...\"> with no xpath: every use is refused");
            broken = true;
        }
        boolean territorial = territories != null && windows != null;

        List<Use> delivery = null;
        boolean deliveryBroken = false;
        DeliveryDescriptor packaged = descriptor.getDelivery();
        if (packaged != null) {
            delivery = new ArrayList<>();
            deliveryBroken = !delivery(packaged, rules, territorial, delivery, problems);
        }
        return new RightsPolicy(type, rightsEnd, channels, originalXpath, rules, problems, broken,
                territorial ? territories : null, territorial ? windows : null, territorial ? windowsDocument : null,
                delivery, deliveryBroken);
    }

    /**
     * Reads a delivery package into {@code files}, each use once, in its order. Answers whether it is
     * sound: a mistake in it refuses every delivery, and is said in {@code problems}.
     */
    private static boolean delivery(DeliveryDescriptor descriptor, Map<Use, Rule> rules, boolean territorial,
            List<Use> files, List<String> problems) {
        boolean sound = true;
        if (!territorial) {
            problems.add("a <delivery> in a policy with no <territories> and <windows>: every delivery is refused");
            sound = false;
        }
        List<UseDescriptor> entries = new ArrayList<>();
        List<Use> uses = new ArrayList<>();
        if (descriptor.getOriginal() != null) {
            entries.add(descriptor.getOriginal());
            uses.add(Use.ORIGINAL);
        }
        for (UseDescriptor view : descriptor.getViews()) {
            String name = trimmed(view.getName());
            entries.add(view);
            uses.add(name == null ? null : Use.view(name));
        }
        for (UseDescriptor blob : descriptor.getBlobs()) {
            String xpath = trimmed(blob.getXpath());
            entries.add(blob);
            uses.add(xpath == null ? null : Use.blob(xpath));
        }
        if (!descriptor.getRenditions().isEmpty() || descriptor.getStoryboard() != null) {
            problems.add("a <delivery> names a rendition or the storyboard, which are not files the document holds:"
                    + " every delivery is refused");
            sound = false;
        }
        for (int i = 0; i < uses.size(); i++) {
            Use use = uses.get(i);
            UseDescriptor entry = entries.get(i);
            if (use == null) {
                problems.add("a <delivery> entry with no name or xpath: every delivery is refused");
                sound = false;
                continue;
            }
            if (trimmed(entry.getChannel()) != null || entry.isPreview()) {
                problems.add("the <delivery> entry " + use + " has a channel or preview=\"true\", which its rule gives:"
                        + " every delivery is refused");
                sound = false;
            }
            if (use.equals(Use.ORIGINAL) && trimmed(entry.getXpath()) != null) {
                problems.add("the <delivery> entry original has an xpath, which the policy's <original> gives:"
                        + " every delivery is refused");
                sound = false;
            }
            Rule rule = rules.get(use);
            if (rule == null || rule.preview()) {
                problems.add("the <delivery> entry " + use + " is not a use the policy clears for a channel:"
                        + " every delivery is refused");
                sound = false;
            }
            if (files.contains(use)) {
                problems.add("the <delivery> entry " + use + " is listed twice: it is delivered once");
            } else {
                files.add(use);
            }
        }
        if (files.isEmpty()) {
            problems.add("a <delivery> with no file: every delivery is refused");
            sound = false;
        }
        return sound;
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

    /**
     * Whether the policy reads territories and release windows: then a use with a channel is
     * cleared only in a territory the asset holds, while a window for its channel is open there.
     */
    public boolean territorial() {
        return territoriesXpath != null;
    }

    /** Where the asset may be delivered, or {@code null} for a policy with no territories. */
    public String territoriesXpath() {
        return territoriesXpath;
    }

    /** Its release windows, or {@code null} for a policy with no territories. */
    public String windowsXpath() {
        return windowsXpath;
    }

    /**
     * The property of the asset holding the id of the document its windows are read from, or
     * {@code null} when they are read from the asset itself.
     */
    public String windowsDocumentXpath() {
        return windowsDocumentXpath;
    }

    /** The delivery package's files, in its order; {@code null} when the policy has no {@code <delivery>}. */
    public List<Use> delivery() {
        return delivery;
    }

    /** A delivery package with a mistake in it: every delivery of the type is refused. */
    public boolean deliveryBroken() {
        return deliveryBroken;
    }
}
