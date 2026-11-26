/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * A share link as the server keeps it: bound to one document, the items it lists, the files those
 * items had when it was made, and its last day. Its token is not here: only the token's hash,
 * which is its id.
 *
 * @param id the SHA-256 of its token, in lowercase hexadecimal
 * @param repository the repository its document is in
 * @param document its document's id: the live document, never a version or a proxy
 * @param items what it lists, as {@link ShareItem} writes them, in the order they were chosen
 * @param digests each item's file's digest when the link was made: an item is served only while the
 *            document's file for it still has that digest, so a view renamed, a picture replaced or
 *            another file put in its place ends the link for it
 * @param sha256 each item's file's SHA-256 when the link was made, of its bytes: checked against the
 *            bytes read before they are marked, so that a file the store would give the same digest
 *            to is not taken for the one the link was made for
 * @param lastDay the last day it opens, in UTC: it stops at the first instant of the next day
 * @param created when it was made
 * @param createdBy who made it: asked again, at each opening, whether they may still share the
 *            document
 * @param revoked when it was revoked, or {@code null}
 * @param revokedBy who revoked it, or {@code null}
 */
public record ShareLink(String id, String repository, String document, List<String> items,
        Map<String, String> digests, Map<String, String> sha256, LocalDate lastDay, Instant created,
        String createdBy, Instant revoked, String revokedBy) {

    /** What a link is at a given instant. The wire names are the operations'. */
    public enum State {
        ACTIVE("active"), EXPIRED("expired"), REVOKED("revoked");

        private final String code;

        State(String code) {
            this.code = code;
        }

        public String code() {
            return code;
        }
    }

    public ShareLink {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(repository, "repository");
        Objects.requireNonNull(document, "document");
        items = List.copyOf(items);
        digests = java.util.Collections.unmodifiableMap(new LinkedHashMap<>(digests));
        sha256 = java.util.Collections.unmodifiableMap(new LinkedHashMap<>(sha256));
        Objects.requireNonNull(lastDay, "lastDay");
        Objects.requireNonNull(created, "created");
        Objects.requireNonNull(createdBy, "createdBy");
    }

    /** The first instant the link no longer opens: the start of the day after its last, in UTC. */
    public Instant endsAt() {
        return lastDay.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();
    }

    /** Revoked, whenever that was; otherwise expired from {@link #endsAt()}; otherwise active. */
    public State state(Instant now) {
        if (revoked != null) {
            return State.REVOKED;
        }
        return now.isBefore(endsAt()) ? State.ACTIVE : State.EXPIRED;
    }

    /** The link as people name it: the first 8 characters of its id, which its watermark prints too. */
    public String label() {
        return id.substring(0, 8);
    }

    /** The same link, revoked. */
    public ShareLink revokedAt(Instant at, String by) {
        return new ShareLink(id, repository, document, items, digests, sha256, lastDay, created, createdBy, at, by);
    }
}
