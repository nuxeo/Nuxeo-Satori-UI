/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.rights.AssetRights;
import org.nuxeo.agentic.assets.rights.AssetRightsService;
import org.nuxeo.agentic.assets.rights.Decision;
import org.nuxeo.agentic.assets.rights.DownloadUse;
import org.nuxeo.agentic.assets.rights.RightsPolicy;
import org.nuxeo.agentic.assets.rights.RightsPolicy.Rule;
import org.nuxeo.agentic.assets.rights.Use;
import org.nuxeo.agentic.assets.rights.Watermark;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.impl.blob.ByteArrayBlob;
import org.nuxeo.ecm.platform.rendition.Rendition;
import org.nuxeo.ecm.platform.rendition.service.RenditionService;
import org.nuxeo.runtime.api.Framework;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * What {@code Asset.GetWatermarked} serves, since 0.5.0: a use of an asset, marked for the person
 * asking, where its rights policy's watermark marks it. The download endpoints refuse it unmarked,
 * {@code watermark-required}; this is where it is served marked.
 *
 * <p>In this order, the first that applies answering:
 * <ol>
 * <li>the use, as {@code original}, {@code view:<title>}, {@code rendition:<name>},
 * {@code blob:<xpath>} or {@code storyboard:<n>}: anything else, 400;</li>
 * <li>a policy for the document's type, with a watermark, listing the use, a preview or one cleared
 * for a channel, which its watermark marks on that occasion, whoever asks: else 404, since this
 * serves nothing the watermark does not mark;</li>
 * <li>the rights, as a download of the use is decided, a version or a proxy by its live document's:
 * a refusal is 403, with its reason;</li>
 * <li>the file the document holds for the use, else 404;</li>
 * <li>the file marked, its text naming the person as {@code recipient} and {@code user}, the day,
 * and no territory: a file that cannot be, 409, {@code watermark-unavailable}.</li>
 * </ol>
 * A member of a group the watermark exempts is served it marked too: the download endpoints serve
 * them the file itself. Every file served is logged at {@code INFO}, with the document, the use and
 * the person.
 */
public final class WatermarkedFiles {

    private static final Logger log = LogManager.getLogger(WatermarkedFiles.class);

    private static final Pattern STORYBOARD = Pattern.compile("storyboard:(0|[1-9][0-9]{0,4})");

    private final Supplier<AssetRightsService> rights;

    public WatermarkedFiles() {
        this(() -> Framework.getService(AssetRightsService.class));
    }

    WatermarkedFiles(Supplier<AssetRightsService> rights) {
        this.rights = rights;
    }

    /** A use as the operation's parameter names it, with a storyboard frame's place. */
    record Asked(Use use, String frame) {
    }

    /** The file the document holds for a use, and the place it holds it at; {@code null} for a computed rendition. */
    record Located(Blob blob, String xpath) {
    }

    /**
     * What the operation answers, since 0.6.0: the file marked, or, for a long video being marked in
     * the background, {@code preparing}, a short JSON saying so and when to ask again, which the
     * operation answers with the status 202.
     */
    public record Answer(Blob file, boolean preparing) {
    }

    /** {@code use} of {@code document}, marked for {@code person}. */
    public Blob serve(DocumentModel document, String use, NuxeoPrincipal person) {
        return answer(document, use, person).file();
    }

    /** {@code use} of {@code document}, marked for {@code person}, or being marked. */
    public Answer answer(DocumentModel document, String use, NuxeoPrincipal person) {
        Asked written = parse(use);
        AssetRightsService service = rights.get();
        if (service == null) {
            throw new DocumentSecurityException("The asset rights service is not running, so nothing is served.");
        }
        RightsPolicy policy = service.policyFor(document.getType());
        if (policy != null && policy.broken()) {
            throw new DocumentSecurityException(
                    "The asset's rights refuse this file: " + Decision.Reason.POLICY_ERROR.code() + ".");
        }
        // A blob named by its xpath is the use a download of that xpath is: the original at the
        // original's, a view at a view's place, never a rule written for that place otherwise.
        Asked asked = policy == null ? written : canonical(document, policy, written);
        Watermark watermark = policy == null ? null : policy.watermark();
        Rule rule = policy == null ? null : policy.rule(asked.use());
        if (watermark == null || rule == null
                || !watermark.marks(rule.preview() ? Watermark.Occasion.PREVIEW : Watermark.Occasion.DOWNLOAD,
                        asked.use())) {
            throw new NuxeoException("No watermark is drawn on this file: download it as it is.", 404);
        }
        Decision decision;
        try {
            decision = AssetRights.decide(policy, () -> service.facts(document, policy), asked.use(), service.today());
        } catch (RuntimeException e) {
            log.error("Asset rights: the rights of {} could not be read, so its marked {} is refused",
                    document.getId(), asked.use(), e);
            decision = new Decision(false, Decision.Reason.POLICY_ERROR, null, null);
        }
        if (!decision.allowed()) {
            log.info("Asset rights: refused the marked {} of {} ({}) to {}: {}", asked.use(), document.getId(),
                    document.getType(), name(person), decision.reason().code());
            throw new DocumentSecurityException(
                    "The asset's rights refuse this file: " + decision.reason().code() + ".");
        }
        Located found = located(document, policy, asked);
        Blob file = found == null ? null : found.blob();
        if (file == null) {
            throw new NuxeoException("The asset has no such file.", 404);
        }
        String text = watermark.text(name(person), name(person), service.today(), "");
        if (AssetWatermarks.isVideo(file)) {
            return video(document, use, asked, found, watermark, text, person);
        }
        Blob marked;
        try {
            marked = AssetWatermarks.mark(file, text, watermark.placement());
        } catch (AssetWatermarks.Unavailable e) {
            log.info("Asset rights: the {} of {} could not be marked for {}, so it is refused: {}", asked.use(),
                    document.getId(), name(person), e.getMessage());
            throw unavailable(null);
        }
        log.info("Asset rights: served the {} of {} ({}) marked to {}", asked.use(), document.getId(),
                document.getType(), name(person));
        return new Answer(marked, false);
    }

    /**
     * Since 0.6.0, a video: marked in the request when it is short; when it is long, a kept copy for
     * this person, or {@code preparing} while a job makes one, or the job's failure. Never the unmarked
     * video.
     */
    private Answer video(DocumentModel document, String use, Asked asked, Located found, Watermark watermark,
            String text, NuxeoPrincipal person) {
        MarkedVideos videos = Framework.getService(MarkedVideos.class);
        MarkedVideos.Outcome outcome = videos == null
                ? new MarkedVideos.Refused("the server's marked videos are not running")
                : videos.mark(MarkedVideos.Order.of(document, use, found.xpath(), found.blob(), watermark, text,
                        name(person), name(person), "", MarkedVideos.Purpose.DOWNLOAD));
        if (outcome instanceof MarkedVideos.Marked marked) {
            log.info("Asset rights: served the {} of {} ({}) marked to {}{}", asked.use(), document.getId(),
                    document.getType(), name(person), marked.copy() == null ? "" : ", from its kept copy");
            // A kept copy's stored file is refused wherever else it is asked for: handed over here as
            // its bytes, under no key of the store's.
            return new Answer(marked.copy() == null ? marked.file() : new ServedCopy(marked.file()), false);
        }
        if (outcome instanceof MarkedVideos.Preparing preparing) {
            log.info("Asset rights: the marked {} of {} is being prepared for {}", asked.use(), document.getId(),
                    name(person));
            return new Answer(preparing(use, preparing.retryAfter()), true);
        }
        String reason = outcome instanceof MarkedVideos.Refused refused ? refused.reason() : null;
        log.info("Asset rights: the {} of {} could not be marked for {}, so it is refused: {}", asked.use(),
                document.getId(), name(person), reason);
        throw unavailable(reason);
    }

    /** The answer while a long video is being marked: what it is, and when to ask again. */
    static Blob preparing(String use, int retryAfter) {
        ObjectNode json = JsonNodeFactory.instance.objectNode();
        json.put("entity-type", "watermarkedFile");
        json.put("status", "preparing");
        json.put("use", use);
        json.put("retryAfter", retryAfter);
        Blob blob = new ByteArrayBlob(json.toString().getBytes(StandardCharsets.UTF_8), "application/json",
                StandardCharsets.UTF_8.name());
        blob.setFilename("preparing.json");
        return blob;
    }

    /** 409: the file cannot be marked, so it is not served, with the reason when there is one. */
    private static NuxeoException unavailable(String reason) {
        return new NuxeoException("This file cannot be marked as its rights require, so it is not served: "
                + Decision.Reason.WATERMARK_UNAVAILABLE.code()
                + (reason == null || reason.isBlank() ? "." : ": " + reason + "."), 409);
    }

    static Asked parse(String use) {
        if (use == null) {
            throw new NuxeoException("Name the file: original, view:<title>, rendition:<name>, blob:<xpath> or"
                    + " storyboard:<n>.", 400);
        }
        if (use.equals("original")) {
            return new Asked(Use.ORIGINAL, null);
        }
        Matcher frame = STORYBOARD.matcher(use);
        if (frame.matches()) {
            return new Asked(Use.STORYBOARD, frame.group(1));
        }
        int colon = use.indexOf(':');
        String kind = colon < 0 ? use : use.substring(0, colon);
        String name = colon < 0 ? "" : use.substring(colon + 1);
        if (!name.isEmpty() && name.length() <= 256) {
            switch (kind) {
            case "view" -> {
                return new Asked(Use.view(name), null);
            }
            case "rendition" -> {
                return new Asked(Use.rendition(name), null);
            }
            case "blob" -> {
                return new Asked(Use.blob(name), null);
            }
            default -> {
                // Below: not a use this names.
            }
            }
        }
        throw new NuxeoException("Name the file: original, view:<title>, rendition:<name>, blob:<xpath> or"
                + " storyboard:<n>.", 400);
    }

    /**
     * A use named as a blob by its xpath, as {@code DownloadUse} names a download of that xpath, so
     * that the operation and the download endpoints decide one place by one rule. A view, a rendition,
     * the original and a storyboard frame are named as they are.
     */
    static Asked canonical(DocumentModel document, RightsPolicy policy, Asked asked) {
        if (asked.use().kind() != Use.Kind.BLOB) {
            return asked;
        }
        Use use = DownloadUse.classify(document, policy, asked.use().name(), blobAt(document, asked.use().name()),
                null);
        if (use.kind() == Use.Kind.STORYBOARD) {
            Matcher frame = STORYBOARD_PLACE.matcher(asked.use().name());
            return frame.matches() ? new Asked(Use.STORYBOARD, frame.group(1)) : new Asked(Use.unknown(null), null);
        }
        return new Asked(use, null);
    }

    private static final Pattern STORYBOARD_PLACE = Pattern.compile("vid:storyboard/(0|[1-9][0-9]{0,4})/content");

    /** The file the document holds for the use; {@code null} for none. */
    static Blob file(DocumentModel document, RightsPolicy policy, Asked asked) {
        Located found = located(document, policy, asked);
        return found == null ? null : found.blob();
    }

    /** The file the document holds for the use, and its place; {@code null} for none. */
    static Located located(DocumentModel document, RightsPolicy policy, Asked asked) {
        Use use = asked.use();
        try {
            switch (use.kind()) {
            case ORIGINAL:
                return at(document, policy.originalXpath());
            case BLOB:
                return at(document, use.name());
            case VIEW:
                return at(document, viewPlace(document, use.name()));
            case STORYBOARD:
                return at(document, "vid:storyboard/" + asked.frame() + "/content");
            case RENDITION:
                String transcoded = transcodedPlace(document, use.name());
                if (transcoded != null) {
                    return at(document, transcoded);
                }
                RenditionService renditions = Framework.getService(RenditionService.class);
                if (renditions == null) {
                    return null;
                }
                Rendition rendition = renditions.getRendition(document, use.name());
                return rendition == null || rendition.getBlob() == null ? null : new Located(rendition.getBlob(), null);
            default:
                return null;
            }
        } catch (NuxeoException e) {
            if (e.getStatusCode() == 404) {
                return null;
            }
            throw e;
        }
    }

    private static Located at(DocumentModel document, String xpath) {
        Blob blob = xpath == null ? null : blobAt(document, xpath);
        return blob == null ? null : new Located(blob, xpath);
    }

    private static Blob blobAt(DocumentModel document, String xpath) {
        try {
            return document.getPropertyValue(xpath) instanceof Blob blob ? blob : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** The place of the first picture view of that title, as the download use names a view by its title. */
    private static String viewPlace(DocumentModel document, String title) {
        if (!document.hasSchema("picture")
                || !(document.getPropertyValue("picture:views") instanceof List<?> views)) {
            return null;
        }
        for (int index = 0; index < views.size(); index++) {
            if (title.equals(document.getPropertyValue("picture:views/" + index + "/title"))) {
                return "picture:views/" + index + "/content";
            }
        }
        return null;
    }

    /** The place of a video's transcoded video of that conversion's name, as {@code @rendition} serves it. */
    private static String transcodedPlace(DocumentModel document, String name) {
        if (!document.hasSchema("video")
                || !(document.getPropertyValue("vid:transcodedVideos") instanceof List<?> videos)) {
            return null;
        }
        for (int index = 0; index < videos.size(); index++) {
            Serializable named = document.getPropertyValue("vid:transcodedVideos/" + index + "/name");
            if (name.equals(named) && blobAt(document, "vid:transcodedVideos/" + index + "/content") != null) {
                return "vid:transcodedVideos/" + index + "/content";
            }
        }
        return null;
    }

    private static String name(NuxeoPrincipal person) {
        return person == null ? "?" : person.getName();
    }
}
