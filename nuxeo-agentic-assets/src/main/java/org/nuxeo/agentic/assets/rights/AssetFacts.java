/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.io.Serializable;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * An asset's rights, as its document holds them where its policy says: the last day they cover,
 * the channels they cover, and, under a policy with territories, where it may be delivered and its
 * release windows.
 *
 * @param rightsEnd the rights end day, in UTC, or {@code null} for rights with no end
 * @param channels the channels, as written, trimmed; empty when the asset names none
 * @param territories where the asset may be delivered, as written, trimmed; empty when it names none
 *            or its policy reads no territories
 * @param windows its release windows, in the document's order; empty when it has none or its policy
 *            reads none
 */
public record AssetFacts(LocalDate rightsEnd, Set<String> channels, Set<String> territories, List<Window> windows) {

    /** The subfields of a release window, as a policy's {@code <windows>} list holds each. */
    public static final String WINDOW_TERRITORY = "territory";

    public static final String WINDOW_CHANNEL = "channel";

    public static final String WINDOW_FROM = "from";

    public static final String WINDOW_UNTIL = "until";

    /**
     * One release window: from its first day to its last, both in UTC and both included, a use of
     * its channel may be delivered to its territory.
     *
     * @param until its last day, or {@code null} for a window with no end
     */
    public record Window(String territory, String channel, LocalDate from, LocalDate until) {

        public Window {
            Objects.requireNonNull(territory, "territory");
            Objects.requireNonNull(channel, "channel");
            Objects.requireNonNull(from, "from");
            if (until != null && until.isBefore(from)) {
                throw new IllegalStateException("a release window ends on " + until + ", before it opens on " + from);
            }
        }

        /** Whether it is open on {@code day}: from its first day, until the end of its last. */
        public boolean open(LocalDate day) {
            return !day.isBefore(from) && (until == null || !day.isAfter(until));
        }
    }

    public AssetFacts {
        // In the document's order, which the enricher writes them in.
        channels = Collections.unmodifiableSet(new LinkedHashSet<>(channels));
        territories = Collections.unmodifiableSet(new LinkedHashSet<>(territories));
        windows = List.copyOf(windows);
    }

    /** The rights of a policy with no territories: a rights end and channels only. */
    public AssetFacts(LocalDate rightsEnd, Set<String> channels) {
        this(rightsEnd, channels, Set.of(), List.of());
    }

    /**
     * Read from {@code document} at the policy's xpaths, its windows included when they are its own.
     *
     * @throws IllegalStateException when a value is of a kind a rights end or a channel list cannot
     *             be, and whatever the document throws for a property its type does not have: the
     *             caller refuses the use either way; and for a policy whose windows are another
     *             document's, which only the rights service reads
     */
    public static AssetFacts read(DocumentModel document, RightsPolicy policy) {
        if (policy.windowsDocumentXpath() != null) {
            throw new IllegalStateException("the release windows are another document's: the rights service reads them");
        }
        return read(document, policy.territorial() ? document.getPropertyValue(policy.windowsXpath()) : null, policy);
    }

    /**
     * Read from {@code document} at the policy's xpaths, with {@code windows} the value of its
     * {@code <windows>}, read from wherever the policy says: the document, or the one it names.
     *
     * @throws IllegalStateException as {@link #read(DocumentModel, RightsPolicy)}, and for a window
     *             with no territory, channel or first day, or one that ends before it opens
     */
    public static AssetFacts read(DocumentModel document, Serializable windows, RightsPolicy policy) {
        LocalDate end = endDay(document.getPropertyValue(policy.rightsEndXpath()));
        Set<String> channels = channels(document.getPropertyValue(policy.channelsXpath()));
        if (!policy.territorial()) {
            return new AssetFacts(end, channels);
        }
        return new AssetFacts(end, channels, texts(document.getPropertyValue(policy.territoriesXpath()), "territory"),
                windows(windows));
    }

    /**
     * The day a stored rights end names, in UTC. Nuxeo stores a day written alone, as the kit's
     * seed and the stock Edit form write {@code dc:expired}, as midnight UTC: that day, as written.
     */
    static LocalDate endDay(Serializable value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Calendar calendar) {
            return calendar.toInstant().atZone(ZoneOffset.UTC).toLocalDate();
        }
        if (value instanceof Date date) {
            return date.toInstant().atZone(ZoneOffset.UTC).toLocalDate();
        }
        throw new IllegalStateException("the rights end is a " + value.getClass().getName() + ", not a date");
    }

    static Set<String> channels(Serializable value) {
        return texts(value, "channel");
    }

    /** A text or a list of texts, each trimmed, the empty ones left out. */
    static Set<String> texts(Serializable value, String what) {
        Set<String> texts = new LinkedHashSet<>();
        if (value == null) {
            return texts;
        }
        if (value instanceof String text) {
            add(texts, text, what);
        } else if (value instanceof Object[] array) {
            for (Object each : array) {
                add(texts, each, what);
            }
        } else if (value instanceof Collection<?> list) {
            for (Object each : list) {
                add(texts, each, what);
            }
        } else {
            throw new IllegalStateException("the " + what + "s are a " + value.getClass().getName() + ", not text");
        }
        return texts;
    }

    private static void add(Set<String> texts, Object value, String what) {
        if (value == null) {
            return;
        }
        if (!(value instanceof String text)) {
            throw new IllegalStateException("a " + what + " is a " + value.getClass().getName() + ", not text");
        }
        String trimmed = text.trim();
        if (!trimmed.isEmpty()) {
            texts.add(trimmed);
        }
    }

    /**
     * The release windows a complex list holds, each with a territory, a channel, a first day and,
     * or not, a last. A window that lacks one of the three, or ends before it opens, is a mistake,
     * and refuses: the windows cannot be read.
     */
    static List<Window> windows(Serializable value) {
        List<Window> windows = new ArrayList<>();
        if (value == null) {
            return windows;
        }
        Collection<?> entries;
        if (value instanceof Collection<?> list) {
            entries = list;
        } else if (value instanceof Object[] array) {
            entries = List.of(array);
        } else {
            throw new IllegalStateException("the release windows are a " + value.getClass().getName() + ", not a list");
        }
        for (Object entry : entries) {
            if (!(entry instanceof Map<?, ?> window)) {
                throw new IllegalStateException("a release window is a "
                        + (entry == null ? "null" : entry.getClass().getName()) + ", not a complex value");
            }
            String territory = required(window.get(WINDOW_TERRITORY), WINDOW_TERRITORY);
            String channel = required(window.get(WINDOW_CHANNEL), WINDOW_CHANNEL);
            Object from = window.get(WINDOW_FROM);
            if (from == null) {
                throw new IllegalStateException("a release window has no first day");
            }
            Object until = window.get(WINDOW_UNTIL);
            windows.add(new Window(territory, channel, endDay(day(from)), until == null ? null : endDay(day(until))));
        }
        return windows;
    }

    private static Serializable day(Object value) {
        if (value instanceof Serializable serializable) {
            return serializable;
        }
        throw new IllegalStateException("a release window's day is a " + value.getClass().getName() + ", not a date");
    }

    private static String required(Object value, String what) {
        if (!(value instanceof String text) || text.trim().isEmpty()) {
            throw new IllegalStateException("a release window has no " + what);
        }
        return text.trim();
    }

    /** Whether the rights end day has passed: true from the day after it, in UTC. */
    public boolean ended(LocalDate today) {
        return rightsEnd != null && today.isAfter(rightsEnd);
    }

    /** Whether a window for {@code channel} in {@code territory} is open on {@code today}. */
    public boolean windowOpen(String territory, String channel, LocalDate today) {
        return windows.stream()
                      .anyMatch(window -> window.territory().equals(territory) && window.channel().equals(channel)
                              && window.open(today));
    }
}
