package org.nuxeo.agentic.embedded;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

/** What a panel's token may ask of the REST API, by its scope. */
class PanelScopeTest {

    private static final Set<String> OPERATIONS = Set.of("Connector.Read");

    private static boolean read(String method, String path) {
        return PanelScope.allows(method, path, "read", OPERATIONS);
    }

    private static boolean write(String method, String path) {
        return PanelScope.allows(method, path, "read write", OPERATIONS);
    }

    @Test
    void aReadTokenReadsDocumentsAndWhatAPageNeedsToShowThem() {
        for (String path : List.of("id/5f1c0e2a-0000-4000-8000-000000000001", "path/default-domain/workspaces",
                "repo/default/id/5f1c0e2a-0000-4000-8000-000000000001", "search/lang/NXQL/execute",
                "config/types/Claim", "config/schemas/claim", "directory/claim_status/open", "user/jsmith",
                "group/members", "me", "id/5f1c0e2a-0000-4000-8000-000000000001/@blob/file:content")) {
            assertTrue(read("GET", path), path);
            assertTrue(read("HEAD", path), path);
        }
        assertTrue(read("POST", "automation/Connector.Read"));
        assertTrue(read("POST", "repo/default/automation/Connector.Read"));
    }

    @Test
    void aReadTokenWritesNothing() {
        for (String method : List.of("POST", "PUT", "DELETE", "PATCH", "OPTIONS")) {
            assertFalse(read(method, "id/5f1c0e2a-0000-4000-8000-000000000001"), method);
            assertFalse(read(method, "path/default-domain"), method);
        }
        assertFalse(read("POST", "automation/Document.Delete"));
        assertFalse(read("POST", "automation/Connector.Read/@async"));
        assertFalse(read("POST", "id/x/@op/Connector.Read"));
        assertFalse(read("POST", "upload/"));
        assertFalse(read("POST", "upload/new/default"));
        assertFalse(read("POST", "bulk"));
    }

    @Test
    void noPanelTokenReachesTheUsersOwnTokensOrAdministrationEvenToRead() {
        for (String path : List.of("token", "token/abc", "oauth2/token/provider", "oauth2/provider/google/token",
                "management/info", "automation", "automation/Connector.Read", "upload/abc", "ext/whatever",
                "repo/default/token", "repo/default", "")) {
            assertFalse(read("GET", path), path);
            assertFalse(write("GET", path), path);
        }
        for (String path : List.of("token", "oauth2/token", "management/info", "me/changepassword", "user/jsmith",
                "group/members", "directory/claim_status", "config/types/Claim")) {
            assertFalse(write("POST", path), path);
            assertFalse(write("PUT", path), path);
            assertFalse(write("DELETE", path), path);
        }
    }

    @Test
    void aWriteTokenWritesDocumentsAndRunsOnlyTheHostsOperations() {
        assertTrue(write("PUT", "id/5f1c0e2a-0000-4000-8000-000000000001"));
        assertTrue(write("DELETE", "path/default-domain/workspaces/old"));
        assertTrue(write("POST", "upload/new/default"));
        assertTrue(write("POST", "repo/default/id/x"));
        assertTrue(write("POST", "id/x/@op/Connector.Read"));
        assertFalse(write("POST", "id/x/@op/Document.Delete"));
        assertFalse(write("POST", "id/x/@op/Connector.Read/extra"));
        assertFalse(write("POST", "automation/Document.Delete"));
        assertFalse(write("POST", "repo/default/automation/Document.Delete"));
        assertFalse(write("PATCH", "id/x"));
    }

    @Test
    void aPathWithAnEmptySegmentIsNeverAPanelsRequest() {
        assertFalse(read("GET", "id//x"));
        assertFalse(read("GET", "id/x/"));
        assertFalse(read("POST", "automation//Connector.Read"));
        assertFalse(read("GET", "repo/default"));
        assertFalse(PanelScope.allows(null, "id/x", "read", OPERATIONS));
        assertFalse(PanelScope.allows("GET", null, "read", OPERATIONS));
    }
}
