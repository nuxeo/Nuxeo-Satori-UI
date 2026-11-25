/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import java.time.Instant;
import java.util.List;

import org.nuxeo.agentic.assets.share.ShareLinkStore.Downloads;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * Share links: an asset's picture views, and its original where its rights allow, given to someone
 * who is not signed in, through an address that carries an unguessable token.
 *
 * <p>Two sides:
 * <ul>
 * <li><strong>Signed in,</strong> through the operations: a user who holds
 * {@value #MANAGE_PERMISSION} on a document makes, lists and revokes its links, and reads their
 * downloads. Each call checks that permission on the session it is given, the user's.</li>
 * <li><strong>Not signed in,</strong> through the servlet at {@code /agentic-share/}: the token is
 * all a request carries, and all it can name is an item of its own link. The document is the
 * link's, read with a system session, so nothing in the request can name another one.</li>
 * </ul>
 */
public interface ShareLinkService {

    /**
     * What a user must hold on a document to make, list or revoke its links, and to read their
     * downloads, and what the link's creator must still hold for it to open: {@code WriteSecurity},
     * "Manage permissions", which is what Nuxeo itself asks of anyone who gives someone else access
     * to a document, an outside person by email included ({@code Document.AddPermission}).
     */
    String MANAGE_PERMISSION = "WriteSecurity";

    /** The most items one link lists. */
    int MAX_ITEMS = 10;

    /** The latest a link's last day may be: this many days after today, in UTC. */
    int MAX_DAYS = 90;

    /** The most links a document may have open at once. */
    int MAX_OPEN_LINKS = 100;

    /** The most links {@link #list} answers. */
    int MAX_LISTED = 200;

    /** The most downloads {@link #downloads} answers. */
    int MAX_DOWNLOADS = 200;

    /** Now, as links are decided. */
    Instant now();

    /**
     * Make a link to {@code document} for {@code items}, opening until the end of {@code lastDay}, in
     * UTC.
     *
     * @return the link and its token, which nothing keeps but the answer; or the items the rights
     *         refuse, and no link
     * @throws org.nuxeo.ecm.core.api.DocumentSecurityException when the user may not share it
     * @throws org.nuxeo.ecm.core.api.NuxeoException with status 400 for anything else wrong in the
     *             request
     */
    Creation create(CoreSession session, DocumentModel document, List<String> items, String lastDay);

    /** The document's links, newest first. */
    List<ShareLink> list(CoreSession session, DocumentModel document);

    /** Revoke one of the document's links: from now on it opens nothing. */
    ShareLink revoke(CoreSession session, DocumentModel document, String link);

    /** The document's downloads through its links, newest first. */
    Downloads downloads(CoreSession session, DocumentModel document);

    /** The page a link opens: what it lists that may be served now. */
    Answer page(String token);

    /** One item of a link, marked. */
    Answer serve(String token, String item);

    /** What {@link #create} answers. */
    sealed interface Creation permits Created, NotCreated {
    }

    /** A new link, and its token: shown once, kept nowhere. */
    record Created(ShareLink link, String token) implements Creation {
    }

    /** No link: the items the rights refuse, each with its reason code. */
    record NotCreated(List<Refusal> refused) implements Creation {

        public NotCreated {
            refused = List.copyOf(refused);
        }
    }

    /** An item refused, and why, as a code the client translates. */
    record Refusal(String item, String reason) {
    }

    /** What a request through a link gets. */
    sealed interface Answer permits Page, Served, Refused, Busy {
    }

    /** The link's page: the items it lists that may be served now, in the link's order. */
    record Page(ShareLink link, List<ShareItem> items) implements Answer {

        public Page {
            items = List.copyOf(items);
        }
    }

    /** An item's bytes, marked, and their type. */
    record Served(ShareLink link, ShareItem item, byte[] bytes, String mimeType) implements Answer {
    }

    /**
     * Nothing: the visitor is told no more than that, whichever the reason, which the server log
     * keeps.
     */
    record Refused(Why why) implements Answer {
    }

    /** Too many items are being marked at once: try again. */
    record Busy() implements Answer {
    }

    /** Why a request through a link gets nothing. Logged; never told the visitor. */
    enum Why {
        /** Not a token's form: refused before anything is looked up. */
        MALFORMED,
        /** No link has this token. */
        UNKNOWN,
        REVOKED,
        EXPIRED,
        /** The link does not list the item. */
        NOT_LISTED,
        /** The document is gone, in the trash, or no longer the live document the link was made on. */
        DOCUMENT_GONE,
        /** The link's creator may no longer share the document, or is no longer a user. */
        CREATOR_MAY_NOT_SHARE,
        /** No rights policy covers the document's type any more. */
        NOT_COVERED,
        /** The asset's rights have ended: every item, a preview's included. */
        RIGHTS_ENDED,
        /** The asset's rights refuse the item, or cannot be read. */
        RIGHTS_REFUSED,
        /** The document has no such view, or no original. */
        NO_SUCH_ITEM,
        /** The item is not a picture the watermark can be drawn on. */
        NOT_AN_IMAGE,
        /** The item is larger than the watermark draws on. */
        TOO_LARGE,
        /** Anything else that went wrong. */
        ERROR
    }
}
