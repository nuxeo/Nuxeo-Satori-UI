/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import java.time.Instant;

/**
 * An authenticated callback, read: what the provider says happened to an envelope.
 *
 * @param id the provider's id of the callback, which the add-on takes once
 * @param envelope the envelope's id at the provider
 * @param outcome what happened
 * @param timestamp when the provider sent it, a time its signature covers, which the add-on holds to its window
 * @param reason a decline's reason, as a signer gave it, or {@code null}
 */
public record CallbackEvent(String id, String envelope, Outcome outcome, Instant timestamp, String reason) {

    /** What a callback says. Anything but signed or declined is taken, and changes nothing. */
    public enum Outcome {
        SIGNED, DECLINED, OTHER
    }
}
