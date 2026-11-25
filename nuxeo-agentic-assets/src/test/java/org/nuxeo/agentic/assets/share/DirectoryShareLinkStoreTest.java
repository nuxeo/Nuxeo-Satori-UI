package org.nuxeo.agentic.assets.share;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.Serializable;
import java.lang.reflect.Proxy;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Supplier;

import org.junit.jupiter.api.Test;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.impl.DocumentModelListImpl;
import org.nuxeo.ecm.directory.Session;

/**
 * The store on two directories, against sessions that answer as a directory does: every call made
 * with the system's rights, every value text, the token nowhere, and what does not read back
 * refused.
 */
class DirectoryShareLinkStoreTest {

    /** Two directories in memory, whose sessions refuse any call made without the system's rights. */
    private static final class Directories {
        final Map<String, Map<String, Map<String, Object>>> entries = new HashMap<>();

        final List<String> calls = new ArrayList<>();

        boolean privileged;

        int privilegedRuns;

        final DirectoryShareLinkStore store = new DirectoryShareLinkStore(this::open, new DirectoryShareLinkStore.Privileged() {
            @Override
            public <T> T run(Supplier<T> code) {
                privilegedRuns++;
                privileged = true;
                try {
                    return code.get();
                } finally {
                    privileged = false;
                }
            }
        });

        Session open(String directory) {
            Map<String, Map<String, Object>> rows = entries.computeIfAbsent(directory, name -> new LinkedHashMap<>());
            String schema = DirectoryShareLinkStore.LINKS.equals(directory) ? DirectoryShareLinkStore.LINK_SCHEMA
                    : DirectoryShareLinkStore.DOWNLOAD_SCHEMA;
            return (Session) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] { Session.class },
                    (proxy, method, args) -> {
                        if (!"close".equals(method.getName()) && !privileged) {
                            throw new SecurityException("the directory is read without the system's rights");
                        }
                        calls.add(directory + " " + method.getName());
                        return switch (method.getName()) {
                        case "close" -> null;
                        case "createEntry" -> {
                            @SuppressWarnings("unchecked")
                            Map<String, Object> row = new HashMap<>((Map<String, Object>) args[0]);
                            rows.put((String) row.get("id"), row);
                            yield entry(schema, row);
                        }
                        case "getEntry" -> {
                            Map<String, Object> row = rows.get((String) args[0]);
                            yield row == null ? null : entry(schema, row);
                        }
                        case "updateEntry" -> null;
                        case "query" -> {
                            @SuppressWarnings("unchecked")
                            Map<String, Serializable> filter = (Map<String, Serializable>) args[0];
                            @SuppressWarnings("unchecked")
                            Map<String, String> order = (Map<String, String>) args[2];
                            int limit = (Integer) args[4];
                            List<Map<String, Object>> found = new ArrayList<>(rows.values()
                                                                               .stream()
                                                                               .filter(row -> filter.entrySet()
                                                                                                    .stream()
                                                                                                    .allMatch(f -> f.getValue()
                                                                                                                    .equals(row.get(f.getKey()))))
                                                                               .toList());
                            Map.Entry<String, String> by = order.entrySet().iterator().next();
                            Comparator<Map<String, Object>> comparator = Comparator.comparing(
                                    row -> (String) row.get(by.getKey()));
                            found.sort("desc".equals(by.getValue()) ? comparator.reversed() : comparator);
                            DocumentModelListImpl list = new DocumentModelListImpl();
                            found.stream().limit(limit).forEach(row -> list.add(entry(schema, row)));
                            yield list;
                        }
                        default -> throw new UnsupportedOperationException("Session." + method.getName());
                        };
                    });
        }

        /** A directory entry: its fields read and written by schema and name, as a directory's are. */
        DocumentModel entry(String schema, Map<String, Object> row) {
            return (DocumentModel) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] { DocumentModel.class },
                    (proxy, method, args) -> switch (method.getName()) {
                    case "getProperty" -> {
                        if (args.length != 2 || !schema.equals(args[0])) {
                            throw new UnsupportedOperationException("getProperty " + List.of(args));
                        }
                        yield row.get((String) args[1]);
                    }
                    case "setProperty" -> {
                        if (!schema.equals(args[0])) {
                            throw new UnsupportedOperationException("setProperty " + List.of(args));
                        }
                        row.put((String) args[1], args[2]);
                        yield null;
                    }
                    case "hashCode" -> System.identityHashCode(proxy);
                    case "equals" -> proxy == args[0];
                    case "toString" -> row.toString();
                    default -> throw new UnsupportedOperationException("DocumentModel." + method.getName());
                    });
        }
    }

    private static final String TOKEN = ShareToken.generate(new SecureRandom());

    private static ShareLink link(String id, String document, Instant created) {
        return new ShareLink(id, "default", document, List.of("view:FullHD", "original"),
                Map.of("view:FullHD", "0f3e", "original", "9a1b"), Map.of("view:FullHD", "5e2c", "original", "77aa"),
                LocalDate.of(2026, 12, 14), created, "brand.manager", null, null);
    }

    @Test
    void aLinkIsWrittenAsTextWithItsTokensHashAndNotItsToken() {
        Directories directories = new Directories();
        ShareLink link = link(ShareToken.hash(TOKEN), "asset-a", Instant.parse("2026-11-24T12:00:00Z"));

        directories.store.create(link);

        Map<String, Object> row = directories.entries.get(DirectoryShareLinkStore.LINKS).get(link.id());
        assertEquals(Set.of("id", "repository", "document", "items", "digests", "sha256", "lastDay", "created",
                "createdBy"),
                row.keySet());
        // A JSON object, one digest for each item; read back as it was written, in whatever order.
        assertEquals(Map.of("view:FullHD", "0f3e", "original", "9a1b"),
                DirectoryShareLinkStore.digests((String) row.get("digests"), link.items()));
        assertEquals(Map.of("view:FullHD", "5e2c", "original", "77aa"),
                DirectoryShareLinkStore.digests((String) row.get("sha256"), link.items()));
        assertEquals(link.id(), row.get("id"));
        assertEquals("[\"view:FullHD\",\"original\"]", row.get("items"));
        assertEquals("2026-12-14", row.get("lastDay"));
        assertEquals("2026-11-24T12:00:00.000Z", row.get("created"));
        for (Object value : row.values()) {
            assertTrue(value instanceof String, () -> value + " is not text");
            assertFalse(((String) value).contains(TOKEN), "the token is kept");
        }
        assertEquals(Optional.of(link), directories.store.find(link.id()));
    }

    @Test
    void everyCallIsMadeWithTheSystemsRightsAndClosesItsSession() {
        Directories directories = new Directories();
        ShareLink link = link(ShareToken.hash(TOKEN), "asset-a", Instant.parse("2026-11-24T12:00:00Z"));
        directories.store.create(link);
        directories.store.find(link.id());
        directories.store.forDocument("asset-a", 10);
        directories.store.revoke(link.id(), Instant.parse("2026-11-25T08:00:00Z"), "brand.manager");
        directories.store.logDownload(new ShareDownload(Instant.parse("2026-11-24T13:00:00Z"), link.id(), "asset-a",
                "view:FullHD"));
        directories.store.downloads("asset-a", 10);

        assertEquals(6, directories.privilegedRuns);
        assertEquals(6, directories.calls.stream().filter(call -> call.endsWith(" close")).count(), directories.calls::toString);
    }

    @Test
    void aRevocationIsWrittenOnceAndReadBack() {
        Directories directories = new Directories();
        ShareLink link = link(ShareToken.hash(TOKEN), "asset-a", Instant.parse("2026-11-24T12:00:00Z"));
        directories.store.create(link);

        Instant at = Instant.parse("2026-11-25T08:00:00Z");
        assertEquals(at, directories.store.revoke(link.id(), at, "brand.manager").orElseThrow().revoked());
        ShareLink again = directories.store.revoke(link.id(), at.plusSeconds(60), "someone.else").orElseThrow();
        assertEquals(at, again.revoked());
        assertEquals("brand.manager", again.revokedBy());
        assertEquals(at, directories.store.find(link.id()).orElseThrow().revoked());
        assertEquals(1, directories.calls.stream().filter(call -> call.endsWith("updateEntry")).count());
        assertTrue(directories.store.revoke("f".repeat(64), at, "brand.manager").isEmpty());
    }

    @Test
    void anEntryThatDoesNotReadBackAsWrittenIsNotALink() {
        for (Map.Entry<String, Object> broken : List.<Map.Entry<String, Object>> of(Map.entry("items", "not json"), Map.entry("items", "[]"),
                Map.entry("items", "[\"blob:file:content\"]"), Map.entry("items", "[1]"), Map.entry("items", "{}"),
                Map.entry("digests", "not json"), Map.entry("digests", "{}"), Map.entry("digests", "[]"),
                Map.entry("digests", "{\"view:FullHD\":\"0f3e\"}"),
                Map.entry("digests", "{\"view:FullHD\":\"0f3e\",\"original\":\"\"}"),
                Map.entry("digests", "{\"view:FullHD\":\"0f3e\",\"view:Medium\":\"9a1b\"}"),
                Map.entry("sha256", "{}"), Map.entry("sha256", "{\"view:FullHD\":\"5e2c\"}"),
                Map.entry("lastDay", "14/12/2026"), Map.entry("created", "2026-11-24T12:00:00Z"),
                Map.entry("createdBy", ""), Map.entry("revoked", "yesterday"), Map.<String, Object> entry("document", 7))) {
            Directories directories = new Directories();
            ShareLink link = link(ShareToken.hash(TOKEN), "asset-a", Instant.parse("2026-11-24T12:00:00Z"));
            directories.store.create(link);
            directories.entries.get(DirectoryShareLinkStore.LINKS).get(link.id()).put(broken.getKey(), broken.getValue());
            assertThrows(IllegalStateException.class, () -> directories.store.find(link.id()), broken::toString);
            // Listed, it is left out rather than failing the list.
            assertTrue(directories.store.forDocument("asset-a", 10).isEmpty(), broken::toString);
        }
    }

    /** An entry that lists what no link may, with its digests to match, is not a link either. */
    @Test
    void anEntryListingWhatNoLinkMayIsNotALink() {
        Directories directories = new Directories();
        ShareLink link = link(ShareToken.hash(TOKEN), "asset-a", Instant.parse("2026-11-24T12:00:00Z"));
        directories.store.create(link);
        Map<String, Object> row = directories.entries.get(DirectoryShareLinkStore.LINKS).get(link.id());
        for (String item : List.of("blob:file:content", "rendition:FullHD", "view:", "view:a/b")) {
            row.put("items", "[\"" + item + "\"]");
            row.put("digests", "{\"" + item + "\":\"0f3e\"}");
            row.put("sha256", "{\"" + item + "\":\"5e2c\"}");
            assertThrows(IllegalStateException.class, () -> directories.store.find(link.id()), item);
        }
        // The same entry with an item a link may list reads back.
        row.put("items", "[\"view:FullHD\"]");
        row.put("digests", "{\"view:FullHD\":\"0f3e\"}");
        row.put("sha256", "{\"view:FullHD\":\"5e2c\"}");
        assertEquals(List.of("view:FullHD"), directories.store.find(link.id()).orElseThrow().items());
    }

    @Test
    void aDocumentsLinksAreItsOwnNewestFirst() {
        Directories directories = new Directories();
        ShareLink older = link("a".repeat(64), "asset-a", Instant.parse("2026-11-24T12:00:00Z"));
        ShareLink newer = link("b".repeat(64), "asset-a", Instant.parse("2026-11-24T12:00:00.500Z"));
        ShareLink other = link("c".repeat(64), "asset-b", Instant.parse("2026-11-24T13:00:00Z"));
        directories.store.create(older);
        directories.store.create(newer);
        directories.store.create(other);
        assertEquals(List.of(newer, older), directories.store.forDocument("asset-a", 10));
        assertEquals(List.of(newer), directories.store.forDocument("asset-a", 1));
    }

    /** Instants are 24 characters, so their order as text, which the directory sorts by, is their order in time. */
    @Test
    void downloadsAreNewestFirstLimitedAndSayWhetherThereWereMore() {
        Directories directories = new Directories();
        String id = ShareToken.hash(TOKEN);
        Instant[] times = { Instant.parse("2026-11-24T12:00:00Z"), Instant.parse("2026-11-24T12:00:00.123Z"),
                Instant.parse("2026-11-24T12:00:01Z"), Instant.parse("2026-11-24T11:59:59.999Z") };
        for (Instant time : times) {
            directories.store.logDownload(new ShareDownload(time, id, "asset-a", "view:FullHD"));
        }
        directories.store.logDownload(new ShareDownload(times[0], id, "asset-b", "view:FullHD"));

        ShareLinkStore.Downloads all = directories.store.downloads("asset-a", 10);
        assertEquals(List.of(times[2], times[1], times[0], times[3]),
                all.downloads().stream().map(ShareDownload::time).toList());
        assertFalse(all.truncated());
        ShareLinkStore.Downloads two = directories.store.downloads("asset-a", 2);
        assertEquals(List.of(times[2], times[1]), two.downloads().stream().map(ShareDownload::time).toList());
        assertTrue(two.truncated());

        Map<String, Object> row = directories.entries.get(DirectoryShareLinkStore.DOWNLOADS).values().iterator().next();
        assertEquals(Set.of("id", "time", "link", "document", "item"), row.keySet());
        assertEquals("2026-11-24T12:00:00.000Z", row.get("time"));
    }
}
