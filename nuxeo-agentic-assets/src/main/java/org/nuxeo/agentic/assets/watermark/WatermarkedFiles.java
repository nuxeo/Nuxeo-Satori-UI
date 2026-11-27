/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.io.Serializable;
import java.util.List;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.rights.AssetRights;
import org.nuxeo.agentic.assets.rights.AssetRightsService;
import org.nuxeo.agentic.assets.rights.Decision;
import org.nuxeo.agentic.assets.rights.RightsPolicy;
import org.nuxeo.agentic.assets.rights.RightsPolicy.Rule;
import org.nuxeo.agentic.assets.rights.Use;
import org.nuxeo.agentic.assets.rights.Watermark;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.platform.rendition.Rendition;
import org.nuxeo.ecm.platform.rendition.service.RenditionService;
import org.nuxeo.runtime.api.Framework;

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

    /** {@code use} of {@code document}, marked for {@code person}. */
    public Blob serve(DocumentModel document, String use, NuxeoPrincipal person) {
        Asked asked = parse(use);
        AssetRightsService service = rights.get();
        if (service == null) {
            throw new DocumentSecurityException("The asset rights service is not running, so nothing is served.");
        }
        RightsPolicy policy = service.policyFor(document.getType());
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
        Blob file = file(document, policy, asked);
        if (file == null) {
            throw new NuxeoException("The asset has no such file.", 404);
        }
        String text = watermark.text(name(person), name(person), service.today(), "");
        Blob marked;
        try {
            marked = AssetWatermarks.mark(file, text, watermark.placement());
        } catch (AssetWatermarks.Unavailable e) {
            log.info("Asset rights: the {} of {} could not be marked for {}, so it is refused: {}", asked.use(),
                    document.getId(), name(person), e.getMessage());
            throw new NuxeoException("This file cannot be marked as its rights require, so it is not served: "
                    + Decision.Reason.WATERMARK_UNAVAILABLE.code() + ".", 409);
        }
        log.info("Asset rights: served the {} of {} ({}) marked to {}", asked.use(), document.getId(),
                document.getType(), name(person));
        return marked;
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

    /** The file the document holds for the use; {@code null} for none. */
    static Blob file(DocumentModel document, RightsPolicy policy, Asked asked) {
        Use use = asked.use();
        try {
            switch (use.kind()) {
            case ORIGINAL:
                return blobAt(document, policy.originalXpath());
            case BLOB:
                return blobAt(document, use.name());
            case VIEW:
                return view(document, use.name());
            case STORYBOARD:
                return blobAt(document, "vid:storyboard/" + asked.frame() + "/content");
            case RENDITION:
                Blob transcoded = transcoded(document, use.name());
                if (transcoded != null) {
                    return transcoded;
                }
                RenditionService renditions = Framework.getService(RenditionService.class);
                if (renditions == null) {
                    return null;
                }
                Rendition rendition = renditions.getRendition(document, use.name());
                return rendition == null ? null : rendition.getBlob();
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

    private static Blob blobAt(DocumentModel document, String xpath) {
        try {
            return document.getPropertyValue(xpath) instanceof Blob blob ? blob : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** The first picture view of that title, as the download use names a view by its title. */
    private static Blob view(DocumentModel document, String title) {
        if (!document.hasSchema("picture")
                || !(document.getPropertyValue("picture:views") instanceof List<?> views)) {
            return null;
        }
        for (int index = 0; index < views.size(); index++) {
            if (title.equals(document.getPropertyValue("picture:views/" + index + "/title"))) {
                return blobAt(document, "picture:views/" + index + "/content");
            }
        }
        return null;
    }

    /** A video's transcoded video of that conversion's name, as {@code @rendition} serves it. */
    private static Blob transcoded(DocumentModel document, String name) {
        if (!document.hasSchema("video")
                || !(document.getPropertyValue("vid:transcodedVideos") instanceof List<?> videos)) {
            return null;
        }
        for (int index = 0; index < videos.size(); index++) {
            Serializable named = document.getPropertyValue("vid:transcodedVideos/" + index + "/name");
            if (name.equals(named)) {
                return blobAt(document, "vid:transcodedVideos/" + index + "/content");
            }
        }
        return null;
    }

    private static String name(NuxeoPrincipal person) {
        return person == null ? "?" : person.getName();
    }
}
