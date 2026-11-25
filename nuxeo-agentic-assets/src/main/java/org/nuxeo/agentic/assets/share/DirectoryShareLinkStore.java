/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.share;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Supplier;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.directory.Session;
import org.nuxeo.ecm.directory.api.DirectoryService;
import org.nuxeo.runtime.api.Framework;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;

/**
 * Share links and their downloads in two directories, as Nuxeo keeps its own authentication tokens
 * ({@code authTokens}) and its permissions' notes ({@code aceinfo}): directories of the
 * {@code system} type, which the REST API does not list, readable by the group {@code __Nobody__}
 * only, so by nobody but an administrator and code run with {@link Framework#doPrivileged}, which
 * is how this store reads and writes them. Neither has a cache: every read is of the database, so a
 * revocation holds from the next request on.
 *
 * <p>Every value is text. Instants are written in UTC to the millisecond, always 24 characters, so
 * that their order as text is their order in time, which the downloads are sorted by; a day is
 * {@code yyyy-MM-dd}. A link's items are a JSON array of text. A link whose fields do not read back
 * as written is not a link: {@link #find} throws, and the caller refuses.
 */
public class DirectoryShareLinkStore implements ShareLinkStore {

    private static final Logger log = LogManager.getLogger(DirectoryShareLinkStore.class);

    public static final String LINKS = "agenticShareLinks";

    public static final String DOWNLOADS = "agenticShareDownloads";

    static final String LINK_SCHEMA = "agenticsharelink";

    static final String DOWNLOAD_SCHEMA = "agenticsharedownload";

    static final String ID = "id";

    static final String REPOSITORY = "repository";

    static final String DOCUMENT = "document";

    static final String ITEMS = "items";

    static final String DIGESTS = "digests";

    static final String SHA256 = "sha256";

    static final String LAST_DAY = "lastDay";

    static final String CREATED = "created";

    static final String CREATED_BY = "createdBy";

    static final String REVOKED = "revoked";

    static final String REVOKED_BY = "revokedBy";

    static final String TIME = "time";

    static final String LINK = "link";

    static final String ITEM = "item";

    /** An instant in UTC to the millisecond: 24 characters, so sorted as text it is sorted in time. */
    static final DateTimeFormatter INSTANT = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'")
                                                               .withZone(ZoneOffset.UTC)
                                                               .withResolverStyle(ResolverStyle.STRICT);

    private static final ObjectMapper JSON = new ObjectMapper();

    /** Runs code with the system's rights: {@link Framework#doPrivileged}. */
    @FunctionalInterface
    public interface Privileged {
        <T> T run(Supplier<T> code);
    }

    private final Function<String, Session> open;

    private final Privileged privileged;

    public DirectoryShareLinkStore() {
        this(name -> Framework.getService(DirectoryService.class).open(name), Framework::doPrivileged);
    }

    /** For tests, which have no directory service and no runtime to be privileged in. */
    DirectoryShareLinkStore(Function<String, Session> open, Privileged privileged) {
        this.open = open;
        this.privileged = privileged;
    }

    private <T> T in(String directory, Function<Session, T> code) {
        return privileged.run(() -> {
            try (Session session = open.apply(directory)) {
                return code.apply(session);
            }
        });
    }

    @Override
    public void create(ShareLink link) {
        Map<String, Object> entry = new HashMap<>();
        entry.put(ID, link.id());
        entry.put(REPOSITORY, link.repository());
        entry.put(DOCUMENT, link.document());
        entry.put(ITEMS, items(link.items()));
        entry.put(DIGESTS, digests(link.digests()));
        entry.put(SHA256, digests(link.sha256()));
        entry.put(LAST_DAY, link.lastDay().toString());
        entry.put(CREATED, INSTANT.format(link.created()));
        entry.put(CREATED_BY, link.createdBy());
        in(LINKS, session -> session.createEntry(entry));
    }

    @Override
    public Optional<ShareLink> find(String id) {
        return in(LINKS, session -> Optional.ofNullable(session.getEntry(id)).map(DirectoryShareLinkStore::link));
    }

    @Override
    public List<ShareLink> forDocument(String document, int limit) {
        return in(LINKS, session -> {
            List<ShareLink> links = new ArrayList<>();
            for (DocumentModel entry : session.query(Map.of(DOCUMENT, document), Set.of(), Map.of(CREATED, "desc"),
                    false, limit, 0)) {
                try {
                    links.add(link(entry));
                } catch (RuntimeException e) {
                    log.error("Share links: an entry of {} for document {} does not read back, and is left out", LINKS,
                            document, e);
                }
            }
            return links;
        });
    }

    @Override
    public Optional<ShareLink> revoke(String id, Instant at, String by) {
        return in(LINKS, session -> {
            DocumentModel entry = session.getEntry(id);
            if (entry == null) {
                return Optional.empty();
            }
            ShareLink link = link(entry);
            if (link.revoked() != null) {
                return Optional.of(link);
            }
            entry.setProperty(LINK_SCHEMA, REVOKED, INSTANT.format(at));
            entry.setProperty(LINK_SCHEMA, REVOKED_BY, by);
            session.updateEntry(entry);
            return Optional.of(link.revokedAt(at, by));
        });
    }

    @Override
    public void logDownload(ShareDownload download) {
        Map<String, Object> entry = new HashMap<>();
        entry.put(ID, UUID.randomUUID().toString());
        entry.put(TIME, INSTANT.format(download.time()));
        entry.put(LINK, download.link());
        entry.put(DOCUMENT, download.document());
        entry.put(ITEM, download.item());
        in(DOWNLOADS, session -> session.createEntry(entry));
    }

    @Override
    public Downloads downloads(String document, int limit) {
        return in(DOWNLOADS, session -> {
            List<ShareDownload> downloads = new ArrayList<>();
            // One more than asked for, to say whether there are more.
            for (DocumentModel entry : session.query(Map.of(DOCUMENT, document), Set.of(), Map.of(TIME, "desc"), false,
                    limit + 1, 0)) {
                downloads.add(new ShareDownload(instant(text(entry, DOWNLOAD_SCHEMA, TIME)),
                        text(entry, DOWNLOAD_SCHEMA, LINK), text(entry, DOWNLOAD_SCHEMA, DOCUMENT),
                        text(entry, DOWNLOAD_SCHEMA, ITEM)));
            }
            boolean truncated = downloads.size() > limit;
            return new Downloads(truncated ? downloads.subList(0, limit) : downloads, truncated);
        });
    }

    /**
     * A link as its entry holds it.
     *
     * @throws IllegalStateException when a field does not read back as {@link #create} writes it
     */
    static ShareLink link(DocumentModel entry) {
        String revoked = optional(entry, REVOKED);
        try {
            List<String> items = items(text(entry, LINK_SCHEMA, ITEMS));
            return new ShareLink(text(entry, LINK_SCHEMA, ID), text(entry, LINK_SCHEMA, REPOSITORY),
                    text(entry, LINK_SCHEMA, DOCUMENT), items, digests(text(entry, LINK_SCHEMA, DIGESTS), items),
                    digests(text(entry, LINK_SCHEMA, SHA256), items),
                    LocalDate.parse(text(entry, LINK_SCHEMA, LAST_DAY)), instant(text(entry, LINK_SCHEMA, CREATED)),
                    text(entry, LINK_SCHEMA, CREATED_BY), revoked == null ? null : instant(revoked),
                    optional(entry, REVOKED_BY));
        } catch (DateTimeParseException | NullPointerException e) {
            throw new IllegalStateException("a share link entry does not read back", e);
        }
    }

    private static String text(DocumentModel entry, String schema, String field) {
        Object value = entry.getProperty(schema, field);
        if (!(value instanceof String text) || text.isEmpty()) {
            throw new IllegalStateException("a share link entry has no " + field);
        }
        return text;
    }

    private static String optional(DocumentModel entry, String field) {
        Object value = entry.getProperty(LINK_SCHEMA, field);
        return value instanceof String text && !text.isEmpty() ? text : null;
    }

    static Instant instant(String text) {
        return INSTANT.parse(text, Instant::from);
    }

    static String items(List<String> items) {
        ArrayNode array = JSON.createArrayNode();
        items.forEach(array::add);
        return array.toString();
    }

    static String digests(Map<String, String> digests) {
        com.fasterxml.jackson.databind.node.ObjectNode object = JSON.createObjectNode();
        digests.forEach(object::put);
        return object.toString();
    }

    /**
     * The digests as {@link #digests(Map)} writes them: one text for each of the link's items, and
     * nothing else.
     */
    static Map<String, String> digests(String json, List<String> items) {
        JsonNode object;
        try {
            object = JSON.readTree(json);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("a share link's digests are not JSON", e);
        }
        if (object == null || !object.isObject() || object.size() != items.size()) {
            throw new IllegalStateException("a share link's digests are not one for each item");
        }
        Map<String, String> digests = new java.util.LinkedHashMap<>();
        for (String item : items) {
            JsonNode digest = object.get(item);
            if (digest == null || !digest.isTextual() || digest.textValue().isEmpty()) {
                throw new IllegalStateException("a share link's item has no digest");
            }
            digests.put(item, digest.textValue());
        }
        return digests;
    }

    /** The items as {@link #items(List)} writes them: a JSON array of items, each one {@link ShareItem} reads. */
    static List<String> items(String json) {
        JsonNode array;
        try {
            array = JSON.readTree(json);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("a share link's items are not JSON", e);
        }
        if (array == null || !array.isArray() || array.isEmpty()) {
            throw new IllegalStateException("a share link's items are not a list");
        }
        List<String> items = new ArrayList<>();
        for (JsonNode item : array) {
            if (!item.isTextual()) {
                throw new IllegalStateException("a share link's item is not text");
            }
            try {
                items.add(ShareItem.parse(item.textValue()).id());
            } catch (IllegalArgumentException e) {
                throw new IllegalStateException("a share link lists what no link may", e);
            }
        }
        return items;
    }
}
