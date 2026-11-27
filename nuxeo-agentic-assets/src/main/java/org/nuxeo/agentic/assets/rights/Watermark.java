/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.nuxeo.agentic.assets.rights.RightsPolicy.Rule;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.security.SecurityConstants;

/**
 * The watermark a rights policy requires, since 0.5.0: its text and placement, the occasions it
 * marks, and the groups exempt from it.
 *
 * <ul>
 * <li><strong>Occasions.</strong> {@code previews}: a use the policy marks as a preview, at the
 * download endpoints; {@code downloads}: a use cleared for a channel, at the download endpoints;
 * {@code deliveries}: a file of a delivery package. Each marks the uses it names, or, naming none,
 * every use of its occasion.</li>
 * <li><strong>Exempt:</strong> a member of a group {@code <except>} names gets previews and downloads
 * unmarked. Nobody else, an administrator included, nor the system acting for no one. A delivery's
 * files are marked whoever files it: they go to a distributor, not to the filer, and the text must
 * name the filer too, {@code {user}}, since the distributor's name is the filer's to write.</li>
 * <li><strong>The text</strong> may name, in braces, {@code recipient}: the person downloading, or a
 * delivery's distributor; {@code user}: the person downloading, or filing the delivery;
 * {@code day}: the server's day in UTC; and {@code territory}: a delivery's, empty for a download.
 * Each value is cut to {@value #MAX_VALUE} characters, its control characters dropped, and is drawn as
 * pixels: it is never written to a command line.</li>
 * <li><strong>Placement:</strong> {@code tiled}, across the whole picture at an angle, which is the
 * default, or once, at the {@code center} or a corner: {@code top-left}, {@code top-right},
 * {@code bottom-left}, {@code bottom-right}.</li>
 * </ul>
 *
 * A mistake breaks the policy, so that every use of its type is refused rather than one served
 * unmarked: a second {@code <watermark>}, no text, a text over {@value #MAX_TEXT} characters or with
 * a control character or a name in braces it does not know, a placement it does not know, no
 * occasion, an occasion naming a use the policy does not list for it, or deliveries marked with no
 * {@code {user}} in the text. An {@code <except>} that names no group, everyone, every user's
 * {@code members} or the system's {@code administrators}, is left out: that marks more, never less.
 */
public final class Watermark {

    /** The longest text a policy may write, before its names are filled in. */
    public static final int MAX_TEXT = 200;

    /** The longest a name's value may be, once filled in. */
    public static final int MAX_VALUE = 100;

    /** Where the mark goes on a picture or a video's frame. */
    public enum Placement {
        TILED("tiled"), CENTER("center"), TOP_LEFT("top-left"), TOP_RIGHT("top-right"), BOTTOM_LEFT("bottom-left"),
        BOTTOM_RIGHT("bottom-right");

        private final String code;

        Placement(String code) {
            this.code = code;
        }

        public String code() {
            return code;
        }

        /** The placement written so, exactly, or {@code null}. */
        public static Placement of(String code) {
            for (Placement placement : values()) {
                if (placement.code.equals(code)) {
                    return placement;
                }
            }
            return null;
        }
    }

    /** When a file is to carry the mark. */
    public enum Occasion {
        PREVIEW("previews"), DOWNLOAD("downloads"), DELIVERY("deliveries");

        private final String element;

        Occasion(String element) {
            this.element = element;
        }

        public String element() {
            return element;
        }
    }

    /** The names a text may hold in braces. */
    static final Set<String> NAMES = Set.of("recipient", "user", "day", "territory");

    private static final Pattern NAME = Pattern.compile("\\{([^{}]*)\\}");

    private static final Pattern GROUP = Pattern.compile("[A-Za-z0-9@._+-]{1,128}");

    private final String text;

    private final Placement placement;

    /** Each occasion it marks, and the uses it names there; an empty set marks every use of it. */
    private final Map<Occasion, Set<Use>> occasions;

    private final Set<String> except;

    private Watermark(String text, Placement placement, Map<Occasion, Set<Use>> occasions, Set<String> except) {
        this.text = text;
        this.placement = placement;
        this.occasions = Collections.unmodifiableMap(occasions);
        this.except = Collections.unmodifiableSet(except);
    }

    /**
     * The watermark {@code descriptor} describes, for a policy whose rules are {@code rules} and whose
     * delivery package is {@code delivery}, or {@code null} for a broken one, each mistake said in
     * {@code problems}.
     */
    static Watermark of(WatermarkDescriptor descriptor, Map<Use, Rule> rules, List<Use> delivery,
            List<String> problems) {
        boolean sound = true;
        String text = descriptor.getText() == null ? null : descriptor.getText().trim();
        if (text == null || text.isEmpty()) {
            problems.add("a <watermark> with no text: every use is refused");
            sound = false;
        } else {
            if (text.length() > MAX_TEXT) {
                problems.add("a <watermark> text over " + MAX_TEXT + " characters: every use is refused");
                sound = false;
            }
            if (text.codePoints().anyMatch(c -> Character.isISOControl(c) || Character.getType(c) == Character.FORMAT)) {
                problems.add("a <watermark> text with a control character: every use is refused");
                sound = false;
            }
            Matcher names = NAME.matcher(text);
            while (names.find()) {
                if (!NAMES.contains(names.group(1))) {
                    problems.add("a <watermark> text names {" + names.group(1) + "}, which is not one of " + NAMES
                            + ": every use is refused");
                    sound = false;
                }
            }
            String unnamed = NAME.matcher(text).replaceAll("");
            if (unnamed.indexOf('{') >= 0 || unnamed.indexOf('}') >= 0) {
                problems.add("a <watermark> text with a brace that opens or closes no name: every use is refused");
                sound = false;
            }
        }
        String written = descriptor.getPlacement() == null ? null : descriptor.getPlacement().trim();
        Placement placement = written == null || written.isEmpty() ? Placement.TILED
                : Placement.of(written.toLowerCase(Locale.ROOT));
        if (placement == null || written != null && !written.isEmpty() && !written.equals(placement.code())) {
            problems.add("<watermark placement=\"" + written + "\"> is not tiled, center, top-left, top-right,"
                    + " bottom-left or bottom-right: every use is refused");
            sound = false;
        }
        Map<Occasion, Set<Use>> occasions = new EnumMap<>(Occasion.class);
        sound &= occasion(Occasion.PREVIEW, descriptor.getPreviews(), rules, delivery, occasions, problems);
        sound &= occasion(Occasion.DOWNLOAD, descriptor.getDownloads(), rules, delivery, occasions, problems);
        sound &= occasion(Occasion.DELIVERY, descriptor.getDeliveries(), rules, delivery, occasions, problems);
        if (occasions.isEmpty()) {
            problems.add("a <watermark> with no <previews>, <downloads> or <deliveries>: every use is refused");
            sound = false;
        }
        if (occasions.containsKey(Occasion.DELIVERY) && text != null && !text.contains("{user}")) {
            // The distributor's name is the filer's to write: the mark must name who filed it too.
            problems.add("a <watermark> with <deliveries> does not name {user}, the delivery's filer, in its text:"
                    + " every use is refused");
            sound = false;
        }
        Set<String> except = new LinkedHashSet<>();
        for (String group : descriptor.getExcept()) {
            String trimmed = group == null ? "" : group.trim();
            if (!GROUP.matcher(trimmed).matches() || SecurityConstants.EVERYONE.equalsIgnoreCase(trimmed)
                    || SecurityConstants.SYSTEM_USERNAME.equalsIgnoreCase(trimmed) || "members".equalsIgnoreCase(trimmed)
                    || "administrators".equalsIgnoreCase(trimmed)) {
                // members is every user's default group; administrators the system's own.
                problems.add("<except group=\"" + trimmed + "\"> names no group of people, and is left out: more is"
                        + " marked, not less");
            } else {
                except.add(trimmed);
            }
        }
        return sound ? new Watermark(text, placement, occasions, except) : null;
    }

    /** Reads one occasion into {@code occasions}; answers whether it is sound. */
    private static boolean occasion(Occasion occasion, WatermarkUsesDescriptor descriptor, Map<Use, Rule> rules,
            List<Use> delivery, Map<Occasion, Set<Use>> occasions, List<String> problems) {
        if (descriptor == null) {
            return true;
        }
        boolean sound = true;
        List<Use> uses = new ArrayList<>();
        if (descriptor.getOriginal() != null) {
            uses.add(Use.ORIGINAL);
        }
        for (UseDescriptor view : descriptor.getViews()) {
            uses.add(named(view.getName()) == null ? null : Use.view(named(view.getName())));
        }
        for (UseDescriptor rendition : descriptor.getRenditions()) {
            uses.add(named(rendition.getName()) == null ? null : Use.rendition(named(rendition.getName())));
        }
        for (UseDescriptor blob : descriptor.getBlobs()) {
            uses.add(named(blob.getXpath()) == null ? null : Use.blob(named(blob.getXpath())));
        }
        if (descriptor.getStoryboard() != null) {
            uses.add(Use.STORYBOARD);
        }
        if (occasion == Occasion.DELIVERY && delivery == null) {
            problems.add("<watermark><deliveries> in a policy with no <delivery>: every use is refused");
            sound = false;
        }
        Set<Use> named = new LinkedHashSet<>();
        for (Use use : uses) {
            if (use == null) {
                problems.add("a <watermark><" + occasion.element() + "> entry with no name or xpath: every use is refused");
                sound = false;
                continue;
            }
            Rule rule = rules.get(use);
            boolean listed = switch (occasion) {
            case PREVIEW -> rule != null && rule.preview();
            case DOWNLOAD -> rule != null && !rule.preview();
            case DELIVERY -> delivery != null && delivery.contains(use);
            };
            if (!listed) {
                problems.add("<watermark><" + occasion.element() + "> names " + use + ", which is not a"
                        + (occasion == Occasion.PREVIEW ? " preview" : occasion == Occasion.DOWNLOAD
                                ? " use cleared for a channel" : " file of the delivery package")
                        + " of the policy: every use is refused");
                sound = false;
            }
            named.add(use);
        }
        occasions.put(occasion, named);
        return sound;
    }

    private static String named(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** Whether {@code use} is to carry the mark on {@code occasion}, whoever asks. */
    public boolean marks(Occasion occasion, Use use) {
        Set<Use> uses = occasions.get(occasion);
        return uses != null && (uses.isEmpty() || uses.contains(use));
    }

    /** Whether the occasion is one the watermark marks at all. */
    public boolean marks(Occasion occasion) {
        return occasions.containsKey(occasion);
    }

    /**
     * Whether {@code person} is to be given {@code use} marked on a preview or a download: the
     * watermark marks it, and they are in none of the groups exempt. Nobody named is exempt.
     */
    public boolean requiredFor(Occasion occasion, Use use, NuxeoPrincipal person) {
        if (!marks(occasion, use)) {
            return false;
        }
        if (occasion == Occasion.DELIVERY || except.isEmpty()) {
            return true;
        }
        NuxeoPrincipal who = person(person);
        if (who == null) {
            return true;
        }
        List<String> groups = who.getAllGroups();
        return groups == null || except.stream().noneMatch(groups::contains);
    }

    /**
     * The person a download is for, to read their groups: the user signed in, or, for the system
     * acting for someone, that user, read from the user directory; {@code null}, exempt from nothing,
     * for no one, or for the system acting for no one, whose groups are the administrators'.
     */
    static NuxeoPrincipal person(NuxeoPrincipal principal) {
        if (principal == null) {
            return null;
        }
        if (!SecurityConstants.SYSTEM_USERNAME.equals(principal.getName())) {
            return principal;
        }
        String originating = principal.getOriginatingUser();
        if (originating == null || originating.isBlank() || originating.equals(principal.getName())) {
            return null;
        }
        org.nuxeo.ecm.platform.usermanager.UserManager users = org.nuxeo.runtime.api.Framework.getService(
                org.nuxeo.ecm.platform.usermanager.UserManager.class);
        return users == null ? null
                : org.nuxeo.runtime.api.Framework.doPrivileged(() -> users.getPrincipal(originating));
    }

    /**
     * The text drawn, its names filled in: {@code recipient}, {@code user}, {@code day} and
     * {@code territory}, each cut to {@value #MAX_VALUE} characters, its control characters dropped.
     */
    public String text(String recipient, String user, LocalDate day, String territory) {
        Matcher names = NAME.matcher(text);
        StringBuilder drawn = new StringBuilder();
        while (names.find()) {
            String value = switch (names.group(1)) {
            case "recipient" -> recipient;
            case "user" -> user;
            case "day" -> day == null ? "" : day.toString();
            case "territory" -> territory;
            default -> "";
            };
            names.appendReplacement(drawn, Matcher.quoteReplacement(clean(value)));
        }
        names.appendTail(drawn);
        return drawn.toString().trim();
    }

    private static String clean(String value) {
        if (value == null) {
            return "";
        }
        StringBuilder kept = new StringBuilder();
        value.codePoints()
             .filter(c -> !Character.isISOControl(c) && Character.getType(c) != Character.FORMAT)
             .limit(MAX_VALUE)
             .forEach(kept::appendCodePoint);
        return kept.toString().trim();
    }

    /** The text as the policy writes it, its names unfilled. */
    public String template() {
        return text;
    }

    /** Whether the text names {@code name}, such as {@code recipient}, in braces. */
    public boolean names(String name) {
        return text.contains("{" + name + "}");
    }

    /**
     * Since 0.6.0: everything the watermark says, as one canonical text, so that a marked copy kept
     * under it is told from one kept under another: its text as written, its placement, each occasion
     * with the uses it names, and the groups exempt. A change to any of them is a change of the
     * watermark.
     */
    public String definition() {
        StringBuilder written = new StringBuilder();
        written.append("text=").append(text).append('\n');
        written.append("placement=").append(placement.code()).append('\n');
        for (Occasion occasion : Occasion.values()) {
            Set<Use> uses = occasions.get(occasion);
            if (uses != null) {
                written.append(occasion.element())
                       .append('=')
                       .append(uses.stream().map(Use::toString).sorted().collect(Collectors.joining("\u001f")))
                       .append('\n');
            }
        }
        written.append("except=").append(except.stream().sorted().collect(Collectors.joining("\u001f")));
        return written.toString();
    }

    public Placement placement() {
        return placement;
    }

    /** The groups exempt from it on previews and downloads. */
    public Set<String> except() {
        return except;
    }
}
