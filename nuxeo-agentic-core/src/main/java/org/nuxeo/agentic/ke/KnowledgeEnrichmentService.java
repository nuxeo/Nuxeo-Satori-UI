package org.nuxeo.agentic.ke;

import org.hyland.sdk.cic.http.client.auth.AuthenticationHttpClient;
import org.hyland.sdk.cic.ke.KEHttpClient;
import org.hyland.sdk.cic.ke.KEService;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.runtime.api.Framework;

/**
 * The shared {@link KEService}, built once from the {@code nuxeo.hyland.cic.*} properties the
 * Content Intelligence Connector already uses. The client secret stays on the server.
 */
final class KnowledgeEnrichmentService {

    private static volatile KEService instance;

    private KnowledgeEnrichmentService() {
    }

    static KEService get() {
        KEService service = instance;
        if (service == null) {
            synchronized (KnowledgeEnrichmentService.class) {
                if (instance == null) {
                    instance = create();
                }
                service = instance;
            }
        }
        return service;
    }

    private static KEService create() {
        String baseUrl = required("nuxeo.hyland.cic.contextEnrichment.baseUrl");
        String tokenUrl = required("nuxeo.hyland.cic.auth.baseUrl").replaceAll("/+$", "") + "/connect/token";
        String clientId = required("nuxeo.hyland.cic.enrichment.clientId");
        String clientSecret = required("nuxeo.hyland.cic.enrichment.clientSecret");
        String grantType = required("nuxeo.hyland.cic.enrichment.auth.grantType");
        String scope = required("nuxeo.hyland.cic.enrichment.auth.scope");
        String environment = environment();

        AuthenticationHttpClient.Builder auth = AuthenticationHttpClient.from(tokenUrl)
                .grantType(grantType)
                .scope(scope);
        KEHttpClient client = KEHttpClient.from(baseUrl, auth)
                .clientId(clientId)
                .clientSecret(clientSecret)
                .hxpEnvironment(environment)
                .build();
        return new KEService(client);
    }

    /**
     * The KE environment, falling back to the ingest environment when the KE key is unset. Both point
     * at the same Content Intelligence environment in our tenant.
     */
    private static String environment() {
        String value = Framework.getProperty("nuxeo.hyland.cic.enrichment.environment");
        if (value == null || value.isBlank()) {
            value = Framework.getProperty("nuxeo.hyland.cic.ingest.environment");
        }
        if (value == null || value.isBlank()) {
            throw new NuxeoException("Knowledge Enrichment is not configured: missing nuxeo.hyland.cic.enrichment.environment");
        }
        return value;
    }

    private static String required(String key) {
        String value = Framework.getProperty(key);
        if (value == null || value.isBlank()) {
            throw new NuxeoException("Knowledge Enrichment is not configured: missing " + key);
        }
        return value;
    }
}
