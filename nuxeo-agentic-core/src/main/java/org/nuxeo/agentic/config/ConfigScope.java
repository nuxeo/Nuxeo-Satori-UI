package org.nuxeo.agentic.config;

import java.util.regex.Pattern;

/** The responses the configuration servlet serves, which diagnostics are filed under. */
final class ConfigScope {

    static final String BOOTSTRAP = "bootstrap";

    static final String MANIFEST = "manifest";

    static final String LAYOUTS = "layouts";

    /**
     * The app registry's, for a diagnostic about no one app: a contribution whose id is not one.
     * Shown to administrators only. A diagnostic about one app is filed under {@link #app}.
     */
    static final String APPS = "apps";

    /** An app's id, as {@code app.json} writes one (docs/business-apps/app-definition-v2.md, section 3). */
    static final Pattern APP_ID = Pattern.compile("[a-z][a-z0-9-]{0,62}");

    private ConfigScope() {
    }

    static boolean isFragmentLayer(String layer) {
        return BOOTSTRAP.equals(layer) || MANIFEST.equals(layer);
    }

    /**
     * The scope of a diagnostic about the app {@code id}: {@code apps/<id>}, which no response of the
     * configuration servlet names, so none of them can report it. {@link #APPS} for an id that is
     * not one, so that a malformed id never reaches a scope.
     */
    static String app(String id) {
        return id != null && APP_ID.matcher(id).matches() ? APPS + "/" + id : APPS;
    }

    /** The app a scope from {@link #app} is about, or {@code null} for any other scope. */
    static String appOf(String scope) {
        return scope != null && scope.startsWith(APPS + "/") ? scope.substring(APPS.length() + 1) : null;
    }

    /** Whether a diagnostic in this scope is the app registry's, whichever app it is about. */
    static boolean isAppScope(String scope) {
        return APPS.equals(scope) || appOf(scope) != null;
    }
}
