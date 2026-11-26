/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import java.time.Instant;
import java.util.Objects;

/**
 * One download through a share link, as the log keeps it: when, through which link, of which
 * document and which item. Nothing about who downloaded it: no address, no browser, no name. A
 * share link's visitor is not signed in, and the link's id is what tells its owner which recipient
 * it was given to.
 *
 * @param time when it was served
 * @param link the link's id
 * @param document the document's id, so that the log is listed by document
 * @param item the item, as {@link ShareItem} writes it
 */
public record ShareDownload(Instant time, String link, String document, String item) {

    public ShareDownload {
        Objects.requireNonNull(time, "time");
        Objects.requireNonNull(link, "link");
        Objects.requireNonNull(document, "document");
        Objects.requireNonNull(item, "item");
    }
}
