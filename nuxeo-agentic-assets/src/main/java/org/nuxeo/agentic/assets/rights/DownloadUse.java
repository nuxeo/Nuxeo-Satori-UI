/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import java.io.Serializable;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * Which use a download is, from what the platform's {@code DownloadService} hands its permissions:
 * the document, the xpath, the blob and the rendition's name.
 *
 * <p>Read from {@code nuxeo-core-io}, {@code nuxeo-rest-api-server}, {@code nuxeo-automation-core}
 * and {@code nuxeo-platform-imaging-core} 2025.10.18 with {@code javap}:
 * <ul>
 * <li>{@code /nxfile/} and the REST API's {@code @blob} and {@code @preview} pass the document and
 * the xpath;</li>
 * <li>the REST API's {@code @rendition} passes the document, no xpath, and the rendition's name
 * as the extended information {@code rendition};</li>
 * <li>{@code Blob.BulkDownload} passes the document, no xpath, and its main blob;</li>
 * <li>a Picture's {@code blobholder:0} is {@code file:content}, its later blob holder places its
 * views, and the {@code mainBlob} rendition is its main blob.</li>
 * </ul>
 * So {@code blobholder:0} and {@code mainBlob} return the main blob, which need not be the blob a
 * policy names as its original: each is the original only when the blob it returns has the
 * original's digest, and otherwise a use no policy lists.
 *
 * <p>Only canonical forms are named. Anything else, such as a view addressed another way or an
 * index the document does not have, is a use no policy lists, so it is refused.
 */
public final class DownloadUse {

    /** The platform's rendition of a document's main blob: its original. */
    static final String MAIN_BLOB_RENDITION = "mainBlob";

    static final String MAIN_BLOB_HOLDER = "blobholder:0";

    /** {@code picture:views/<index>/content}, with an index in its canonical form. */
    private static final Pattern VIEW = Pattern.compile("picture:views/(0|[1-9][0-9]{0,4})/content");

    private DownloadUse() {
    }

    /**
     * @param rendition the rendition's name, or {@code null} when the download is not of one
     */
    public static Use classify(DocumentModel document, RightsPolicy policy, String xpath, Blob blob,
            String rendition) {
        if (rendition != null) {
            // The mainBlob rendition returns the document's main blob, which is the policy's
            // original only when the policy's original is that blob.
            return MAIN_BLOB_RENDITION.equals(rendition) && isOriginal(document, policy, blob) ? Use.ORIGINAL
                    : Use.rendition(rendition);
        }
        if (xpath == null) {
            // Only Blob.BulkDownload was seen doing this, with the main blob. Anything else is unknown.
            return isOriginal(document, policy, blob) ? Use.ORIGINAL : Use.unknown(null);
        }
        // As DownloadServiceImpl.fixXPath reads one, though checkPermission has done it already.
        String path = xpath.replace(';', ':');
        if (path.equals(policy.originalXpath())) {
            return Use.ORIGINAL;
        }
        if (path.equals(MAIN_BLOB_HOLDER)) {
            // The main blob, as the type's blob holder gives it: the original only when it is the
            // policy's original's blob, compared by digest.
            return isOriginal(document, policy, blob) ? Use.ORIGINAL : Use.blob(path);
        }
        Matcher view = VIEW.matcher(path);
        if (view.matches()) {
            String title = viewTitle(document, view.group(1));
            return title == null ? Use.unknown(path) : Use.view(title);
        }
        return Use.blob(path);
    }

    /**
     * Whether {@code blob} is the policy's original: the blob at its xpath, by digest. A blob with no
     * digest, or a document with nothing there, is not.
     */
    private static boolean isOriginal(DocumentModel document, RightsPolicy policy, Blob blob) {
        if (blob == null || blob.getDigest() == null) {
            return false;
        }
        Serializable original = document.getPropertyValue(policy.originalXpath());
        return original instanceof Blob main && blob.getDigest().equals(main.getDigest());
    }

    /** The view's title, or {@code null} when it has none or the document has no such view. */
    static String viewTitle(DocumentModel document, String index) {
        try {
            Serializable title = document.getPropertyValue("picture:views/" + index + "/title");
            return title instanceof String text && !text.isBlank() ? text : null;
        } catch (RuntimeException e) {
            return null;
        }
    }
}
