package org.nuxeo.agentic.assets.rights;

import java.io.Serializable;
import java.lang.reflect.Proxy;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.PropertyException;

/**
 * Documents, blobs and policies with no Nuxeo runtime, as the rest of the module's tests use them.
 *
 * <p>The document is a {@link Proxy} over {@link DocumentModel} that answers only {@code getType},
 * {@code getId}, {@code hasSchema} and {@code getPropertyValue}, and throws on any other call, so a
 * change that reads something these do not model fails a test rather than reading a default. A
 * property it does not hold throws {@link PropertyException}, as the server does for a property
 * whose schema the type does not have.
 */
final class Fakes {

    /** 24 November 2026, midday UTC: the day the tests decide on. */
    static final Instant NOW = Instant.parse("2026-11-24T12:00:00Z");

    static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);

    private Fakes() {
    }

    static final class Doc {
        String type = "AcmeAsset";

        String id = "3c1e-asset";

        final Set<String> schemas = new HashSet<>(Set.of("dublincore", "file", "picture", "acmeasset"));

        final Map<String, Serializable> properties = new HashMap<>();

        /** Every property read, in order. */
        final List<String> read = new ArrayList<>();

        Doc rightsEnd(String day) {
            properties.put("dc:expired", day == null ? null : midnightUtc(day));
            return this;
        }

        Doc channels(String... channels) {
            properties.put("acmeasset:channels", channels);
            return this;
        }

        Doc original(String digest) {
            properties.put("file:content", (Serializable) blob(digest));
            return this;
        }

        /** Picture views with these titles, at indexes 0, 1, 2 and on, as Nuxeo lists them. */
        Doc views(String... titles) {
            ArrayList<Map<String, Serializable>> views = new ArrayList<>();
            for (int i = 0; i < titles.length; i++) {
                HashMap<String, Serializable> view = new HashMap<>();
                view.put("title", titles[i]);
                view.put("content", (Serializable) blob("view-" + i));
                views.add(view);
                properties.put("picture:views/" + i + "/title", titles[i]);
                properties.put("picture:views/" + i + "/content", (Serializable) blob("view-" + i));
            }
            properties.put("picture:views", views);
            return this;
        }

        DocumentModel model() {
            return (DocumentModel) Proxy.newProxyInstance(Fakes.class.getClassLoader(),
                    new Class<?>[] { DocumentModel.class }, (proxy, method, args) -> switch (method.getName()) {
                    case "getType" -> type;
                    case "getId" -> id;
                    case "hasSchema" -> schemas.contains((String) args[0]);
                    case "getPropertyValue" -> {
                        String xpath = (String) args[0];
                        read.add(xpath);
                        if (!properties.containsKey(xpath)) {
                            throw new PropertyException("no property " + xpath);
                        }
                        yield properties.get(xpath);
                    }
                    case "toString" -> "Doc(" + type + ", " + id + ")";
                    case "hashCode" -> System.identityHashCode(proxy);
                    case "equals" -> proxy == args[0];
                    default -> throw new UnsupportedOperationException("DocumentModel." + method.getName());
                    });
        }
    }

    /** An asset as the brand kit seeds one: cleared until 2027, on every channel. */
    static Doc asset() {
        return new Doc().rightsEnd("2027-12-31")
                        .channels("E-commerce", "Wholesale", "Social", "Print")
                        .original("original-digest")
                        .views("Thumbnail", "Small", "Medium", "FullHD", "OriginalJpeg");
    }

    static Calendar midnightUtc(String day) {
        GregorianCalendar calendar = new GregorianCalendar(TimeZone.getTimeZone("UTC"));
        calendar.clear();
        String[] parts = day.split("-");
        calendar.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1, Integer.parseInt(parts[2]));
        return calendar;
    }

    /** A blob that answers its digest and nothing else. */
    static Blob blob(String digest) {
        return (Blob) Proxy.newProxyInstance(Fakes.class.getClassLoader(), new Class<?>[] { Blob.class, Serializable.class },
                (proxy, method, args) -> switch (method.getName()) {
                case "getDigest" -> digest;
                case "toString" -> "Blob(" + digest + ")";
                case "hashCode" -> System.identityHashCode(proxy);
                case "equals" -> proxy == args[0];
                default -> throw new UnsupportedOperationException("Blob." + method.getName());
                });
    }

    static UseDescriptor channel(String name, String channel) {
        return new UseDescriptor(name, null, channel, false);
    }

    static UseDescriptor preview(String name) {
        return new UseDescriptor(name, null, null, true);
    }

    /** The brand kit's policy, as its component contributes it. */
    static RightsPolicyDescriptor kitPolicy() {
        RightsPolicyDescriptor policy = new RightsPolicyDescriptor();
        policy.type = "AcmeAsset";
        policy.rightsEndXpath = "dc:expired";
        policy.channelsXpath = "acmeasset:channels";
        policy.original = new UseDescriptor(null, null, "Print", false);
        policy.views.add(preview("Thumbnail"));
        policy.views.add(preview("Small"));
        policy.views.add(preview("Medium"));
        policy.views.add(channel("FullHD", "E-commerce"));
        policy.views.add(channel("OriginalJpeg", "Print"));
        policy.renditions.add(preview("thumbnail"));
        policy.renditions.add(preview("Thumbnail"));
        policy.renditions.add(preview("Small"));
        policy.renditions.add(preview("Medium"));
        policy.renditions.add(channel("FullHD", "E-commerce"));
        policy.renditions.add(channel("OriginalJpeg", "Print"));
        return policy;
    }

    static AssetRightsComponent component(RightsPolicyDescriptor... policies) {
        AssetRightsComponent component = new AssetRightsComponent(CLOCK);
        for (RightsPolicyDescriptor policy : policies) {
            component.register(policy, "test");
        }
        return component;
    }
}
