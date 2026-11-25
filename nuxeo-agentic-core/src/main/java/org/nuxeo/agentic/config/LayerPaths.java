package org.nuxeo.agentic.config;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The files a deployment layer may hold, each at the place an app definition puts it
 * (docs/business-apps/app-definition-v2.md, section 1): a type's record page, edit form or create
 * form, {@code layouts/<Type>/<view|edit|create>.layout.json}, and a queue,
 * {@code queues/<id>.json}. A type's name is the one a layout contribution may have
 * ({@code ContributionRegistry}), and a queue's id the one the registry serves a queue under
 * ({@link ConfigSnapshot#APP_FILES}).
 *
 * Nothing else: not the labels, the menu, the home, the actions or {@code app.json}, so a layer
 * changes what a page draws and never which app is served, to whom, or what an action runs.
 */
final class LayerPaths {

    static final Pattern LAYOUT = Pattern.compile("layouts/([A-Za-z][A-Za-z0-9_-]{0,127})/(view|edit|create)\\.layout\\.json");

    static final Pattern QUEUE = Pattern.compile("queues/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\\.json");

    private LayerPaths() {
    }

    static boolean isLayerPath(String path) {
        return path != null && (LAYOUT.matcher(path).matches() || QUEUE.matcher(path).matches());
    }

    static boolean isLayout(String path) {
        return path != null && LAYOUT.matcher(path).matches();
    }

    /** A layout's type and mode, or {@code null} for a path that is not a layout's. */
    static String[] typeAndMode(String path) {
        if (path == null) {
            return null;
        }
        Matcher matcher = LAYOUT.matcher(path);
        return matcher.matches() ? new String[] { matcher.group(1), matcher.group(2) } : null;
    }
}
