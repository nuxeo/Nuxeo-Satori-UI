package org.nuxeo.agentic.embedded;

import java.util.Arrays;
import java.util.List;
import java.util.Set;

/**
 * What a panel's token may ask of the REST API, by its scope: a rule on the request's method and its
 * path below {@code /api/v1/}, which the server checks before the request reaches the REST API
 * ({@link PanelTokenGuard}). Nuxeo's permissions still decide what the user may read or change; this
 * decides what a token exchanged by another system may ask for at all.
 *
 * <ul>
 * <li><b>{@code read}</b>, always: {@code GET} and {@code HEAD} on the documents, searches, the
 * content model, vocabularies, users and groups, and the user's own {@code me}; and {@code POST} to
 * {@code automation/<id>} for the operations the host names, {@code Connector.Read} by default.
 * Nothing else, which leaves out the user's own authentication tokens ({@code token}), their OAuth
 * tokens ({@code oauth2}) and administration ({@code management}), even to read.</li>
 * <li><b>{@code write}</b>, only where the host's configuration allows it and the exchange asked for
 * it: as well, {@code POST}, {@code PUT} and {@code DELETE} on documents, uploads and bulk actions;
 * an operation, through {@code automation} or a document's {@code @op}, still only one the host
 * names. Never users, groups, vocabularies, the content model, {@code me}, {@code token},
 * {@code oauth2} or {@code management}.</li>
 * </ul>
 *
 * A path of a repository, {@code repo/<name>/...}, is held to the rule of the path below it.
 */
public final class PanelScope {

    static final Set<String> READ_ROOTS = Set.of("id", "path", "search", "query", "config", "directory", "user",
            "group", "me");

    static final Set<String> WRITE_ROOTS = Set.of("id", "path", "upload", "bulk");

    static final Set<String> WRITE_METHODS = Set.of("POST", "PUT", "DELETE");

    private PanelScope() {
    }

    /**
     * @param method the request's method
     * @param path its path below {@code api/v1/}, with no leading slash
     * @param scope the token's scope: {@code read}, or {@code read write}
     * @param operations the operations the host names
     */
    public static boolean allows(String method, String path, String scope, Set<String> operations) {
        if (method == null || path == null || path.isEmpty()) {
            return false;
        }
        List<String> segments = Arrays.asList(path.split("/", -1));
        if (segments.contains("")) {
            // An empty segment, as in a doubled or trailing slash: never a panel's request.
            return false;
        }
        if ("repo".equals(segments.get(0))) {
            // repo/<name>/<the path the rule is for>
            if (segments.size() < 3) {
                return false;
            }
            segments = segments.subList(2, segments.size());
        }
        String root = segments.get(0);
        if ("GET".equals(method) || "HEAD".equals(method)) {
            return READ_ROOTS.contains(root);
        }
        if ("automation".equals(root)) {
            return "POST".equals(method) && segments.size() == 2 && operations.contains(segments.get(1));
        }
        int op = segments.indexOf("@op");
        if (op >= 0) {
            // A document's adapter for an operation: one the host names, and nothing after it.
            return "POST".equals(method) && hasWrite(scope) && op == segments.size() - 2
                    && operations.contains(segments.get(op + 1)) && WRITE_ROOTS.contains(root);
        }
        return hasWrite(scope) && WRITE_METHODS.contains(method) && WRITE_ROOTS.contains(root);
    }

    static boolean hasWrite(String scope) {
        return scope != null && Arrays.asList(scope.split(" ")).contains(Host.WRITE);
    }
}
