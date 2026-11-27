/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.time.LocalDate;
import java.util.Objects;

/**
 * What the rights decide for one use of an asset, and why.
 *
 * <p>The reason is a stable code, never a sentence: a client translates it, and the server sends
 * no prose a reader would see in the server's language.
 *
 * @param allowed whether the use may be served
 * @param reason why
 * @param channel the channel that covers the use, when the policy names one; {@code null} for a
 *            preview and for a use the policy does not list
 * @param rightsEnd the last day the rights cover, in UTC, when the reason is that it has passed
 * @param territory the territory a delivery was decided for, when the reason is its territory or
 *            its window; {@code null} for a download, which names none, and for any other reason
 */
public record Decision(boolean allowed, Reason reason, String channel, LocalDate rightsEnd, String territory) {

    /** Why a use is served or refused. The codes are the {@code assetRights} enricher's. */
    public enum Reason {
        /** Served: the rights run and their channels hold the one that covers the use. */
        CLEARED("cleared", true),
        /** Served whatever the rights: the policy marks the use as a preview. */
        PREVIEW("preview", true),
        /** Refused: the rights end day has passed. */
        RIGHTS_ENDED("rights-ended", false),
        /** Refused: the asset's channels do not hold the one that covers the use. */
        CHANNEL_NOT_COVERED("channel-not-covered", false),
        /** Refused: the policy does not list the use, so nothing clears it. */
        NOT_CLEARED("not-cleared", false),
        /** Refused: the policy, or the asset's rights fields, could not be read. */
        POLICY_ERROR("policy-error", false),
        /** Refused: a container's rendition, such as a tree export, holding a document a policy covers. */
        CONTAINS_ASSETS("contains-assets", false),
        /**
         * Refused: the asset may not be delivered to the delivery's territory, or, for a download,
         * which names none, to any territory.
         */
        TERRITORY_NOT_COVERED("territory-not-covered", false),
        /**
         * Refused: no release window for the use's channel is open today in the delivery's
         * territory, or, for a download, in any territory the asset may be delivered to.
         */
        OUTSIDE_WINDOW("outside-window", false),
        /** Refused: a file a delivery's package lists that the document does not have, or has with no digest. */
        NO_SUCH_FILE("no-such-file", false);

        private final String code;

        private final boolean allows;

        Reason(String code, boolean allows) {
            this.code = code;
            this.allows = allows;
        }

        public String code() {
            return code;
        }

        boolean allows() {
            return allows;
        }
    }

    public Decision {
        Objects.requireNonNull(reason, "reason");
        if (allowed != reason.allows()) {
            throw new IllegalArgumentException(reason + " cannot be " + (allowed ? "allowed" : "refused"));
        }
    }

    /** A decision that names no territory: every one but a delivery's refusal for its territory or window. */
    public Decision(boolean allowed, Reason reason, String channel, LocalDate rightsEnd) {
        this(allowed, reason, channel, rightsEnd, null);
    }

    static Decision allow(Reason reason, String channel) {
        return new Decision(true, reason, channel, null);
    }

    static Decision refuse(Reason reason, String channel, LocalDate rightsEnd) {
        return new Decision(false, reason, channel, rightsEnd);
    }

    static Decision refuse(Reason reason) {
        return refuse(reason, null, null);
    }

    /** A refusal for a territory or a window, naming the delivery's territory, or none for a download. */
    static Decision refuseIn(Reason reason, String channel, String territory) {
        return new Decision(false, reason, channel, null, territory);
    }
}
