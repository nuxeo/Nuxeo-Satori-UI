package org.nuxeo.agentic.embedded;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

/**
 * The start-up check of the chains the server resolved, read as the platform's authentication service
 * holds them: a map of descriptors by name, each with its replacement chain.
 */
class AuthenticationChainsTest {

    /** As {@code SpecificAuthChainDescriptor} answers. */
    public static final class Descriptor {

        private final List<String> chain;

        Descriptor(List<String> chain) {
            this.chain = chain;
        }

        public List<String> getReplacementChain() {
            return chain;
        }
    }

    /** As {@code PluggableAuthenticationService} holds them, in a field of a superclass's here. */
    static class Base {

        protected Map<String, Descriptor> specificAuthChains = new HashMap<>();
    }

    static final class Service extends Base {
    }

    private static final List<String> WITH = List.of("AUTOMATION_BASIC_AUTH", "TOKEN_AUTH", "OAUTH2_AUTH", "JWT_AUTH",
            PanelTokenAuthenticator.NAME);

    private static final List<String> WITHOUT = List.of("AUTOMATION_BASIC_AUTH", "TOKEN_AUTH", "OAUTH2_AUTH",
            "JWT_AUTH", "ANONYMOUS_AUTH");

    @Test
    void bothChainsHoldingThePanelsAuthenticatorIsSilence() {
        Service service = new Service();
        service.specificAuthChains.put("RestAPI", new Descriptor(WITH));
        service.specificAuthChains.put("Automation", new Descriptor(WITH));
        assertEquals(List.of(), AuthenticationChains.lacking(service));
    }

    @Test
    void aChainAServersOwnConfigurationReplacedIsNamed() {
        Service service = new Service();
        service.specificAuthChains.put("RestAPI", new Descriptor(WITH));
        service.specificAuthChains.put("Automation", new Descriptor(WITHOUT));
        assertEquals(List.of("Automation"), AuthenticationChains.lacking(service));
        service.specificAuthChains.remove("RestAPI");
        assertEquals(List.of("RestAPI", "Automation"), AuthenticationChains.lacking(service));
    }

    @Test
    void aServiceThatReadsOtherwiseIsSaidSo() {
        List<String> lacking = AuthenticationChains.lacking(new Object());
        assertEquals(1, lacking.size());
        assertTrue(lacking.get(0).contains("could not be read"), lacking.get(0));
    }
}
