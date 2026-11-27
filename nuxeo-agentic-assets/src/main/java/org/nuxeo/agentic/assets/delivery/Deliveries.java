/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.delivery;

import java.io.Serializable;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import java.util.function.Supplier;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.rights.AssetRightsService;
import org.nuxeo.agentic.assets.rights.AssetRightsService.DeliveryDecision;
import org.nuxeo.agentic.assets.rights.AssetRightsService.PackageFile;
import org.nuxeo.agentic.assets.rights.Decision;
import org.nuxeo.agentic.assets.rights.RightsPolicy;
import org.nuxeo.agentic.assets.rights.Use;
import org.nuxeo.agentic.assets.rights.Watermark;
import org.nuxeo.agentic.assets.watermark.AssetWatermarks;
import org.nuxeo.agentic.assets.watermark.MarkedVideos;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentNotFoundException;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.runtime.api.Framework;

/**
 * A delivery package decided, in the filer's transaction, before it is created.
 *
 * <p>The filer writes the localised version's id, the distributor and the territory. The version
 * is read with the filer's own session: one they may not read, or that is not there, refuses.
 * Then its rights policy's {@code <delivery>} chooses the files, and each is decided as the asset
 * rights service decides a download, for the delivery's territory: its rights not ended, its
 * channel among the version's, the territory among the version's, and a release window for its
 * channel open there today, in UTC. <strong>Refused whole</strong> when any file is refused or
 * missing: the answer is 403, its code the first refused file's reason, its message every refused
 * file's, and nothing is made. Otherwise the server writes what was delivered, file by file with
 * its digest, when and by whom, over anything the filer wrote there.
 *
 * <p>Since 0.5.0, each file the version's watermark marks for deliveries is marked for the
 * distributor, the text naming them as its {@code recipient}, the filer as its {@code user}, the day
 * and the territory; the delivery records, for each file, whether it was marked, for whom and with
 * what text, and holds the file marked. One that cannot be marked, such as a video on a server
 * without ffmpeg, refuses the delivery whole, 403 {@code watermark-unavailable}.
 */
public class Deliveries {

    private static final Logger log = LogManager.getLogger(Deliveries.class);

    public static final String TYPE = "MediaDelivery";

    public static final String SCHEMA = "media_delivery";

    static final String VERSION = "mdlv:version";

    static final String DISTRIBUTOR = "mdlv:distributor";

    static final String TERRITORY = "mdlv:territory";

    static final String DELIVERED_AT = "mdlv:deliveredAt";

    static final String DELIVERED_BY = "mdlv:deliveredBy";

    static final String FILES = "mdlv:files";

    /**
     * Since 0.6.0: a delivery refused, 409, while a long video it marks is being marked in the
     * background; filed again once it is ready, it is delivered with it.
     */
    public static final String WATERMARK_PENDING = "watermark-pending";

    /** The most characters a distributor's name may have. */
    static final int MAX_DISTRIBUTOR = 200;

    /** The most characters a territory may have. */
    static final int MAX_TERRITORY = 64;

    private static final Pattern DOCUMENT_ID = Pattern.compile("[A-Za-z0-9-]{1,64}");

    private final Clock clock;

    private final Supplier<AssetRightsService> rights;

    public Deliveries() {
        this(Clock.systemUTC(), () -> Framework.getService(AssetRightsService.class));
    }

    Deliveries(Clock clock, Supplier<AssetRightsService> rights) {
        this.clock = clock;
        this.rights = rights;
    }

    /** Decide {@code delivery}, which is about to be created, and write it, or refuse it whole. */
    void deliver(CoreSession session, DocumentModel delivery) {
        NuxeoPrincipal principal = session == null ? null : session.getPrincipal();
        if (principal == null) {
            throw new DeliveryRefusal(403, "request", "A delivery is filed by a person signed in.");
        }
        String versionId = text(delivery, VERSION);
        if (versionId == null || !DOCUMENT_ID.matcher(versionId).matches()) {
            throw new DeliveryRefusal(400, "request", "A delivery names its localised version by its id.");
        }
        String distributor = text(delivery, DISTRIBUTOR);
        if (!printable(distributor, MAX_DISTRIBUTOR)) {
            throw new DeliveryRefusal(400, "request",
                    "A delivery names its distributor, in 1 to " + MAX_DISTRIBUTOR + " characters.");
        }
        String territory = text(delivery, TERRITORY);
        if (!printable(territory, MAX_TERRITORY)) {
            throw new DeliveryRefusal(400, "request",
                    "A delivery names its territory, in 1 to " + MAX_TERRITORY + " characters.");
        }
        DocumentModel version;
        try {
            version = session.getDocument(new IdRef(versionId));
        } catch (DocumentNotFoundException | DocumentSecurityException e) {
            // The same answer whether it is not there or the filer may not read it.
            throw new DeliveryRefusal(403, "version", "The delivery names no localised version you may read.");
        }
        if (version.isVersion() || version.isProxy() || version.isTrashed()) {
            throw new DeliveryRefusal(409, "version",
                    "A delivery is of a live localised version: not a version of it, a proxy or one in the trash.");
        }
        AssetRightsService service = rights.get();
        DeliveryDecision decided;
        try {
            if (service == null) {
                throw new IllegalStateException("the asset rights service is not running");
            }
            decided = service.decideDelivery(version, territory);
        } catch (RuntimeException e) {
            log.error("Media deliveries: a delivery of {} could not be decided, so it is refused", versionId, e);
            throw new DeliveryRefusal(403, Decision.Reason.POLICY_ERROR.code(),
                    "The delivery could not be decided, so it is refused.");
        }
        if (decided.refused() != null) {
            String code = decided.refused().reason().code();
            log.info("Media deliveries: {} was refused a delivery of {} to {}: {}", principal.getName(), versionId,
                    territory, code);
            throw new DeliveryRefusal(403, code, "The delivery to " + territory + " is refused: " + code + ".");
        }
        if (!decided.delivered()) {
            List<PackageFile> refused = decided.files()
                                               .stream()
                                               .filter(file -> !file.decision().allowed() || file.blob() == null)
                                               .toList();
            String code = refused.isEmpty() ? Decision.Reason.POLICY_ERROR.code()
                    : refused.get(0).decision().reason().code();
            String files = refused.stream().map(Deliveries::describe).collect(Collectors.joining("; "));
            log.info("Media deliveries: {} was refused a delivery of {} to {}, whole: {}", principal.getName(),
                    versionId, territory, files);
            throw new DeliveryRefusal(403, code, "The delivery to " + territory + " is refused whole: " + files + ".");
        }
        // Since 0.5.0: each file the version's watermark marks for deliveries, marked for the
        // distributor, and held by the delivery; one that cannot be refuses the delivery whole.
        RightsPolicy policy = service.policyFor(version.getType());
        Watermark watermark = policy == null ? null : policy.watermark();
        LocalDate today = service.today();
        List<String> unmarkable = new ArrayList<>();
        List<String> pending = new ArrayList<>();
        List<Map<String, Serializable>> files = new ArrayList<>();
        for (PackageFile file : decided.files()) {
            Blob blob = file.blob();
            Map<String, Serializable> entry = new HashMap<>();
            entry.put("use", file.use().kind().code());
            entry.put("name", file.use().name());
            entry.put("channel", file.decision().channel());
            entry.put("filename", blob.getFilename());
            entry.put("mimeType", blob.getMimeType());
            entry.put("length", blob.getLength());
            entry.put("digest", blob.getDigest());
            boolean marks = watermark != null && watermark.marks(Watermark.Occasion.DELIVERY, file.use());
            entry.put("watermarked", marks);
            if (marks) {
                String text = watermark.text(distributor, principal.getName(), today, territory);
                if (AssetWatermarks.isVideo(blob)) {
                    // Since 0.6.0: a long video is marked in the background, and the delivery waits for it.
                    MarkedVideos.Outcome outcome = video(version, policy, watermark, file, blob, text, distributor,
                            principal.getName(), territory);
                    if (outcome instanceof MarkedVideos.Marked marked) {
                        entry.put("watermarkedFor", distributor);
                        entry.put("watermark", text);
                        entry.put("watermarkedFile", (Serializable) marked.file());
                    } else if (outcome instanceof MarkedVideos.Preparing) {
                        pending.add(file.use().toString());
                    } else {
                        String reason = outcome instanceof MarkedVideos.Refused refused ? refused.reason() : null;
                        log.info("Media deliveries: the {} of {} could not be marked for {}: {}", file.use(), versionId,
                                territory, reason);
                        unmarkable.add(file.use() + (reason == null ? "" : " (" + reason + ")"));
                    }
                } else {
                    try {
                        Blob marked = AssetWatermarks.mark(blob, text, watermark.placement());
                        entry.put("watermarkedFor", distributor);
                        entry.put("watermark", text);
                        entry.put("watermarkedFile", (Serializable) marked);
                    } catch (AssetWatermarks.Unavailable e) {
                        log.info("Media deliveries: the {} of {} could not be marked for {}: {}", file.use(), versionId,
                                territory, e.getMessage());
                        unmarkable.add(file.use().toString());
                    }
                }
            }
            files.add(entry);
        }
        if (!unmarkable.isEmpty()) {
            throw new DeliveryRefusal(403, Decision.Reason.WATERMARK_UNAVAILABLE.code(),
                    "The delivery to " + territory + " is refused whole: " + String.join("; ", unmarkable)
                            + " cannot be marked as the version's rights require.");
        }
        if (!pending.isEmpty()) {
            // Refused whole, and nothing is made: file it again once its marked files are ready.
            throw new DeliveryRefusal(409, WATERMARK_PENDING, "The delivery to " + territory + " waits for its marked"
                    + " files: " + String.join("; ", pending) + " " + (pending.size() == 1 ? "is" : "are")
                    + " being marked for its distributor. File it again once they are ready.");
        }
        GregorianCalendar now = new GregorianCalendar(TimeZone.getTimeZone("UTC"));
        now.setTimeInMillis(clock.millis());
        // Written by the server, over anything the filer wrote there.
        delivery.setPropertyValue(VERSION, versionId);
        delivery.setPropertyValue(DISTRIBUTOR, distributor);
        delivery.setPropertyValue(TERRITORY, territory);
        delivery.setPropertyValue(FILES, (Serializable) files);
        delivery.setPropertyValue(DELIVERED_AT, now);
        delivery.setPropertyValue(DELIVERED_BY, principal.getName());
        if (text(delivery, "dc:title") == null) {
            delivery.setPropertyValue("dc:title", distributor + ", " + territory);
        }
        log.info("Media deliveries: {} delivered {} to {} in {}: {}", principal.getName(), versionId,
                distributor.length() > 80 ? distributor.substring(0, 80) + "…" : distributor, territory,
                decided.files().stream().map(file -> file.use().toString()).toList());
    }

    /**
     * Since 0.6.0, once a delivery is created, in its filer's transaction: the kept copies for
     * deliveries of each file it holds marked dropped, so that the delivery alone holds that file, and
     * no other path is refused it as a copy's. After its creation, so that it holds the file first.
     */
    @SuppressWarnings("unchecked")
    void delivered(CoreSession session, DocumentModel delivery) {
        if (!(delivery.getPropertyValue(FILES) instanceof List<?> files)) {
            return;
        }
        MarkedVideos videos = null;
        for (Object each : files) {
            if (each instanceof Map<?, ?> file && Boolean.TRUE.equals(file.get("watermarked"))
                    && file.get("watermarkedFile") instanceof Blob marked && AssetWatermarks.isVideo(marked)) {
                videos = videos == null ? Framework.getService(MarkedVideos.class) : videos;
                if (videos != null) {
                    videos.delivered(session, marked);
                }
            }
        }
    }

    /**
     * Since 0.6.0, a video the watermark marks for this delivery: marked here when it is short; when
     * it is long, the copy a job made for this distributor, filer, day and territory, or a job queued
     * for it, or its failure.
     */
    private static MarkedVideos.Outcome video(DocumentModel version, RightsPolicy policy, Watermark watermark,
            PackageFile file, Blob blob, String text, String distributor, String filer, String territory) {
        MarkedVideos videos = Framework.getService(MarkedVideos.class);
        if (videos == null) {
            return new MarkedVideos.Refused("the server's marked videos are not running");
        }
        return videos.mark(MarkedVideos.Order.of(version, file.use().toString(), place(policy, file.use()), blob,
                watermark, text, distributor, filer, territory, MarkedVideos.Purpose.DELIVERY));
    }

    /** Where a package's file is held: the original's place, or a blob's xpath; {@code null} for a view. */
    static String place(RightsPolicy policy, Use use) {
        return switch (use.kind()) {
        case ORIGINAL -> policy.originalXpath();
        case BLOB -> use.name();
        default -> null;
        };
    }

    /** A refused file as the refusal's message names it: its use, its reason, and its channel. */
    private static String describe(PackageFile file) {
        Decision decision = file.decision();
        String reason = decision.allowed() ? Decision.Reason.NO_SUCH_FILE.code() : decision.reason().code();
        return file.use() + " " + reason + (decision.channel() == null ? "" : " for " + decision.channel());
    }

    /** The text at {@code xpath}, trimmed, or {@code null} for none or an empty one. */
    private static String text(DocumentModel document, String xpath) {
        Serializable value = document.getPropertyValue(xpath);
        if (!(value instanceof String text)) {
            return null;
        }
        String trimmed = text.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** Text of 1 to {@code max} characters with no control or format character. */
    static boolean printable(String text, int max) {
        return text != null && !text.isEmpty() && text.length() <= max
                && text.codePoints()
                       .noneMatch(c -> Character.isISOControl(c) || Character.getType(c) == Character.FORMAT);
    }
}
