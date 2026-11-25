/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.io.Serializable;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Calendar;
import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.Set;

import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * An asset's rights, as its document holds them where its policy says: the last day they cover,
 * and the channels they cover.
 *
 * @param rightsEnd the rights end day, in UTC, or {@code null} for rights with no end
 * @param channels the channels, as written, trimmed; empty when the asset names none
 */
public record AssetFacts(LocalDate rightsEnd, Set<String> channels) {

    public AssetFacts {
        // In the document's order, which the enricher writes them in.
        channels = Collections.unmodifiableSet(new LinkedHashSet<>(channels));
    }

    /**
     * Read from {@code document} at the policy's xpaths.
     *
     * @throws IllegalStateException when a value is of a kind a rights end or a channel list cannot
     *             be, and whatever the document throws for a property its type does not have: the
     *             caller refuses the use either way
     */
    public static AssetFacts read(DocumentModel document, RightsPolicy policy) {
        return new AssetFacts(endDay(document.getPropertyValue(policy.rightsEndXpath())),
                channels(document.getPropertyValue(policy.channelsXpath())));
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
        Set<String> channels = new LinkedHashSet<>();
        if (value == null) {
            return channels;
        }
        if (value instanceof String text) {
            add(channels, text);
        } else if (value instanceof Object[] array) {
            for (Object each : array) {
                add(channels, each);
            }
        } else if (value instanceof Collection<?> list) {
            for (Object each : list) {
                add(channels, each);
            }
        } else {
            throw new IllegalStateException("the channels are a " + value.getClass().getName() + ", not text");
        }
        return channels;
    }

    private static void add(Set<String> channels, Object value) {
        if (value == null) {
            return;
        }
        if (!(value instanceof String text)) {
            throw new IllegalStateException("a channel is a " + value.getClass().getName() + ", not text");
        }
        String trimmed = text.trim();
        if (!trimmed.isEmpty()) {
            channels.add(trimmed);
        }
    }

    /** Whether the rights end day has passed: true from the day after it, in UTC. */
    public boolean ended(LocalDate today) {
        return rightsEnd != null && today.isAfter(rightsEnd);
    }
}
