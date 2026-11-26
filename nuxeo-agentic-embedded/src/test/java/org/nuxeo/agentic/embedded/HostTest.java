package org.nuxeo.agentic.embedded;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

/** What a host's contribution may say, and what it means when it says nothing. */
class HostTest {

    private static String problem(HostDescriptor descriptor) {
        return assertThrows(IllegalArgumentException.class, () -> Host.of(descriptor)).getMessage();
    }

    @Test
    void aHostIsReadOnlyAndShortLivedByDefault() {
        Host host = Fixtures.host();
        assertEquals("crm", host.id());
        assertEquals(Set.of("read"), host.scopes());
        assertEquals(Set.of("Connector.Read"), host.operations());
        assertEquals(300, host.tokenLifetime());
        assertFalse(host.allowAdministrators());
        assertEquals("read", host.grantedScope(null));
        assertNull(host.grantedScope("write"));
    }

    @Test
    void itsSettingsAreNamedAfterItsIdAndNoOtherWay() {
        HostDescriptor descriptor = Fixtures.descriptor();
        descriptor.id = "claims-portal";
        Host host = Host.of(descriptor);
        assertEquals("nuxeo.agentic.embedded.claims-portal.clientSecret", host.clientSecretProperty());
        assertEquals("NUXEO_EMBEDDED_CLAIMS_PORTAL_CLIENT_SECRET", host.clientSecretEnv());
        assertEquals("nuxeo.agentic.embedded.claims-portal.assertionKey", host.assertionKeyProperty());
        assertEquals("NUXEO_EMBEDDED_CLAIMS_PORTAL_ASSERTION_KEY", host.assertionKeyEnv());

        for (String id : List.of("Crm", "crm_1", "1crm", "crm.portal", "a".repeat(33), "")) {
            descriptor.id = id;
            assertTrue(problem(descriptor).contains("id must be"), id);
        }
    }

    @Test
    void anOriginIsExactlyWhatABrowserSends() {
        assertEquals("https://crm.example.com", Host.origin("https://CRM.example.com:443"));
        assertEquals("https://crm.example.com:8443", Host.origin("https://crm.example.com:8443"));
        assertEquals("http://localhost:8094", Host.origin("http://localhost:8094"));
        assertEquals("http://127.0.0.1", Host.origin("http://127.0.0.1:80"));
        for (String refused : List.of("http://crm.example.com", "https://crm.example.com/", "https://crm.example.com/app",
                "https://*.example.com", "https://user@crm.example.com", "https://crm.example.com?x=1", "crm.example.com",
                "ftp://crm.example.com", "null", "https://")) {
            assertNull(Host.origin(refused), refused);
        }
        HostDescriptor descriptor = Fixtures.descriptor();
        descriptor.origins = new ArrayList<>(List.of("https://crm.example.com", "https://CRM.example.com"));
        assertTrue(problem(descriptor).contains("named twice"));
        descriptor.origins = new ArrayList<>();
        assertTrue(problem(descriptor).contains("origins are required"));
    }

    @Test
    void aHostThatMapsNoUserIsRefused() {
        HostDescriptor descriptor = Fixtures.descriptor();
        descriptor.users = new ArrayList<>();
        descriptor.groups = new ArrayList<>();
        assertTrue(problem(descriptor).contains("maps no user"));

        descriptor = Fixtures.descriptor();
        descriptor.users = new ArrayList<>(List.of(Fixtures.user("s-1", "a"), Fixtures.user("s-1", "b")));
        assertTrue(problem(descriptor).contains("mapped twice"));
    }

    @Test
    void writeIsGivenOnlyWhereTheHostAllowsItAndAlwaysWithRead() {
        HostDescriptor descriptor = Fixtures.descriptor();
        descriptor.scopes = new ArrayList<>(List.of("write"));
        Host host = Host.of(descriptor);
        assertEquals(Set.of("read", "write"), host.scopes());
        assertEquals("read write", host.grantedScope("write"));
        assertEquals("read write", host.grantedScope("read write"));
        assertEquals("read", host.grantedScope("read"));
        assertNull(host.grantedScope("read admin"));

        descriptor.scopes = new ArrayList<>(List.of("admin"));
        assertTrue(problem(descriptor).contains("scope must be read or write"));
    }

    @Test
    void everyOtherValueIsBounded() {
        HostDescriptor descriptor = Fixtures.descriptor();
        descriptor.allowAdministrators = "yes";
        assertTrue(problem(descriptor).contains("allowAdministrators"));

        for (String lifetime : List.of("59", "901", "five")) {
            descriptor = Fixtures.descriptor();
            descriptor.tokenLifetime = lifetime;
            assertTrue(problem(descriptor).contains("tokenLifetime"), lifetime);
        }

        descriptor = Fixtures.descriptor();
        descriptor.algorithm = "none";
        assertTrue(problem(descriptor).contains("HS256, RS256 or ES256"));
        descriptor.algorithm = null;
        assertTrue(problem(descriptor).contains("assertion@algorithm is required"));

        descriptor = Fixtures.descriptor();
        descriptor.issuer = null;
        assertTrue(problem(descriptor).contains("assertion@issuer is required"));

        descriptor = Fixtures.descriptor();
        descriptor.operations = new ArrayList<>(List.of("Document.Delete", "bad op"));
        assertTrue(problem(descriptor).contains("bad op"));
        descriptor.operations = new ArrayList<>(List.of("Document.Fetch"));
        assertEquals(Set.of("Document.Fetch"), Host.of(descriptor).operations(),
                "naming an operation replaces the default");
    }
}
