package org.nuxeo.agentic.assets.share;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.Serializable;
import java.io.UncheckedIOException;
import java.lang.reflect.Proxy;
import java.security.Principal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Comparator;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.Semaphore;
import java.util.function.Function;

import javax.imageio.ImageIO;

import org.nuxeo.agentic.assets.rights.AssetRightsService;
import org.nuxeo.agentic.assets.rights.TestRights;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.PropertyException;
import org.nuxeo.ecm.core.api.impl.blob.ByteArrayBlob;

/**
 * Share links with no Nuxeo runtime: a clock the tests move, a store and a repository in memory,
 * documents that answer only what the code reads, real pictures, and the brand kit's own rights
 * policy deciding.
 */
final class ShareFakes {

    /** 24 November 2026, midday UTC. */
    static final Instant NOW = Instant.parse("2026-11-24T12:00:00Z");

    static final String REPOSITORY = "default";

    static final String OWNER = "brand.manager";

    private ShareFakes() {
    }

    /** A clock the test moves. */
    static final class MovingClock extends Clock {
        Instant now = NOW;

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    /** A picture of this size, filled with {@code colour} and a band of its complement, as a JPEG. */
    static byte[] jpeg(int width, int height, Color colour) {
        return picture(width, height, colour, "jpeg", BufferedImage.TYPE_INT_RGB);
    }

    static byte[] png(int width, int height, Color colour) {
        return picture(width, height, colour, "png", BufferedImage.TYPE_INT_ARGB);
    }

    static byte[] picture(int width, int height, Color colour, String format, int type) {
        BufferedImage image = new BufferedImage(width, height, type);
        Graphics2D g = image.createGraphics();
        g.setColor(colour);
        g.fillRect(0, 0, width, height);
        g.setColor(new Color(255 - colour.getRed(), 255 - colour.getGreen(), 255 - colour.getBlue()));
        g.fillRect(0, height / 3, width, height / 3);
        g.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            if (!ImageIO.write(image, format, out)) {
                throw new IllegalStateException("no writer for " + format);
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return out.toByteArray();
    }

    static Blob blob(byte[] bytes, String mimeType) {
        return new ByteArrayBlob(bytes, mimeType);
    }

    /** An asset as the brand kit seeds one, cleared until 2027 on every channel, with its pictures. */
    static final class Asset {
        String id;

        String type = "AcmeAsset";

        boolean version;

        boolean proxy;

        boolean trashed;

        /** The colour its pictures are painted, so that the test can tell whose bytes were served. */
        final Color colour;

        final Map<String, Serializable> properties = new HashMap<>();

        Asset(String id, Color colour) {
            this.id = id;
            this.colour = colour;
            rightsEnd("2027-12-31");
            channels("E-commerce", "Wholesale", "Social", "Print");
            properties.put("file:content", (Serializable) blob(jpeg(320, 240, colour), "image/jpeg"));
            views("Thumbnail", "Small", "Medium", "FullHD", "OriginalJpeg");
        }

        Asset rightsEnd(String day) {
            properties.put("dc:expired", day == null ? null : midnightUtc(day));
            return this;
        }

        Asset channels(String... channels) {
            properties.put("acmeasset:channels", channels);
            return this;
        }

        Asset views(String... titles) {
            ArrayList<Map<String, Serializable>> views = new ArrayList<>();
            for (int i = 0; i < titles.length; i++) {
                Blob content = blob(jpeg(160 + 10 * i, 120 + 10 * i, colour), "image/jpeg");
                view(views, i, titles[i], content);
            }
            properties.put("picture:views", views);
            return this;
        }

        /** Replace a view's file, as a conversion would. */
        Asset viewFile(int index, Blob content) {
            properties.put("picture:views/" + index + "/content", (Serializable) content);
            return this;
        }

        private void view(List<Map<String, Serializable>> views, int index, String title, Blob content) {
            HashMap<String, Serializable> view = new HashMap<>();
            view.put("title", title);
            view.put("content", (Serializable) content);
            views.add(view);
            properties.put("picture:views/" + index + "/title", title);
            properties.put("picture:views/" + index + "/content", (Serializable) content);
        }

        DocumentModel model() {
            return (DocumentModel) Proxy.newProxyInstance(ShareFakes.class.getClassLoader(),
                    new Class<?>[] { DocumentModel.class }, (proxy, method, args) -> switch (method.getName()) {
                    case "getType" -> type;
                    case "getId" -> id;
                    case "getRef" -> new IdRef(id);
                    case "getRepositoryName" -> REPOSITORY;
                    case "isVersion" -> version;
                    case "isProxy" -> Asset.this.proxy;
                    case "isTrashed" -> trashed;
                    case "getPropertyValue" -> {
                        String xpath = (String) args[0];
                        if (!properties.containsKey(xpath)) {
                            throw new PropertyException("no property " + xpath);
                        }
                        yield properties.get(xpath);
                    }
                    case "toString" -> "Asset(" + id + ")";
                    case "hashCode" -> System.identityHashCode(proxy);
                    case "equals" -> proxy == args[0];
                    default -> throw new UnsupportedOperationException("DocumentModel." + method.getName());
                    });
        }
    }

    static Calendar midnightUtc(String day) {
        GregorianCalendar calendar = new GregorianCalendar(TimeZone.getTimeZone("UTC"));
        calendar.clear();
        String[] parts = day.split("-");
        calendar.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1, Integer.parseInt(parts[2]));
        return calendar;
    }

    /** The store, in memory, counting its reads. */
    static class Store implements ShareLinkStore {
        final Map<String, ShareLink> links = new LinkedHashMap<>();

        final List<ShareDownload> downloads = new ArrayList<>();

        int finds;

        boolean failLogging;

        @Override
        public void create(ShareLink link) {
            if (links.putIfAbsent(link.id(), link) != null) {
                throw new IllegalStateException("a link of this id already");
            }
        }

        @Override
        public Optional<ShareLink> find(String id) {
            finds++;
            return Optional.ofNullable(links.get(id));
        }

        @Override
        public List<ShareLink> forDocument(String document, int limit) {
            return links.values()
                        .stream()
                        .filter(link -> link.document().equals(document))
                        .sorted(Comparator.comparing(ShareLink::created).reversed())
                        .limit(limit)
                        .toList();
        }

        @Override
        public Optional<ShareLink> revoke(String id, Instant at, String by) {
            ShareLink link = links.get(id);
            if (link == null) {
                return Optional.empty();
            }
            if (link.revoked() == null) {
                link = link.revokedAt(at, by);
                links.put(id, link);
            }
            return Optional.of(link);
        }

        @Override
        public void logDownload(ShareDownload download) {
            if (failLogging) {
                throw new IllegalStateException("the log's database is down");
            }
            downloads.add(download);
        }

        @Override
        public Downloads downloads(String document, int limit) {
            List<ShareDownload> of = downloads.stream()
                                              .filter(download -> download.document().equals(document))
                                              .sorted(Comparator.comparing(ShareDownload::time).reversed())
                                              .toList();
            return new Downloads(of.subList(0, Math.min(limit, of.size())), of.size() > limit);
        }
    }

    /** The repository, in memory: documents by id, and who may share which. */
    static final class Repository implements ShareRepository {
        final Map<String, Asset> documents = new HashMap<>();

        /** Each user's documents they hold WriteSecurity on. */
        final Map<String, Set<String>> mayShare = new HashMap<>();

        /** Every document id read, in order. */
        final List<String> read = new ArrayList<>();

        /** An id answered with another document, as a repository that went wrong would. */
        final Map<String, String> answersWith = new HashMap<>();

        Asset add(Asset asset) {
            documents.put(asset.id, asset);
            mayShare.computeIfAbsent(OWNER, user -> new HashSet<>()).add(asset.id);
            return asset;
        }

        @Override
        public <T> T withDocument(String repository, String id, Function<DocumentModel, T> code) {
            read.add(id);
            Asset asset = REPOSITORY.equals(repository) ? documents.get(answersWith.getOrDefault(id, id)) : null;
            return code.apply(asset == null ? null : asset.model());
        }

        @Override
        public boolean hasPermission(String repository, String document, String username, String permission) {
            return "WriteSecurity".equals(permission)
                    && mayShare.getOrDefault(username, Set.of()).contains(document);
        }
    }

    /** A signed-in user's session: who they are, and whether they hold WriteSecurity on every document. */
    static CoreSession session(String user, boolean mayManage) {
        NuxeoPrincipal principal = (NuxeoPrincipal) Proxy.newProxyInstance(ShareFakes.class.getClassLoader(),
                new Class<?>[] { NuxeoPrincipal.class, Principal.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getName" -> user;
                case "toString" -> user;
                case "hashCode" -> user.hashCode();
                case "equals" -> proxy == args[0];
                default -> throw new UnsupportedOperationException("NuxeoPrincipal." + method.getName());
                });
        return (CoreSession) Proxy.newProxyInstance(ShareFakes.class.getClassLoader(),
                new Class<?>[] { CoreSession.class }, (proxy, method, args) -> switch (method.getName()) {
                case "hasPermission" -> {
                    if (args.length != 2 || !(args[0] instanceof DocumentRef)) {
                        throw new UnsupportedOperationException("CoreSession.hasPermission with a principal");
                    }
                    yield mayManage && "WriteSecurity".equals(args[1]);
                }
                case "getPrincipal" -> principal;
                case "toString" -> "Session(" + user + ")";
                case "hashCode" -> System.identityHashCode(proxy);
                case "equals" -> proxy == args[0];
                default -> throw new UnsupportedOperationException("CoreSession." + method.getName());
                });
    }

    /** A component deciding with the kit's rights, on the clock's day, marking up to two at once. */
    static ShareLinkComponent component(MovingClock clock, Store store, Repository repository) {
        AssetRightsService rights = TestRights.kit(clock);
        return component(clock, store, repository, rights, new Semaphore(2));
    }

    static ShareLinkComponent component(MovingClock clock, Store store, Repository repository,
            AssetRightsService rights, Semaphore marking) {
        return new ShareLinkComponent(clock, store, repository, () -> rights, new Watermarker(),
                new java.security.SecureRandom(), marking);
    }
}
