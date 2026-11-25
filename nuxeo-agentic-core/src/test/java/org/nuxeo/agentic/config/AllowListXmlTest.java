package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;
import org.nuxeo.common.xmap.XMap;
import org.nuxeo.ecm.automation.core.annotations.Operation;

/**
 * The allow-list as the runtime reads it: the example its extension point documents, and the Payers
 * kit's demo deployment contribution, read by the same XMap and held to {@link AllowedOperation#of}.
 * An example nobody could register is a wrong example, and a deployment file that registers
 * nothing would leave the demo's button refused for a reason no one meant.
 */
class AllowListXmlTest {

    private static final Pattern EXTENSION = Pattern.compile(
            "<extension target=\"org\\.nuxeo\\.agentic\\.ui\\.operations\" point=\"allowList\">(.*?)</extension>",
            Pattern.DOTALL);

    private static final Pattern CODE = Pattern.compile("<code>(.*?)</code>", Pattern.DOTALL);

    /** The kit's demo deployment contribution, from this module: the repository's root is one up. */
    private static final Path DEPLOYMENT = Path.of("..", "business-apps", "packages", "payers-claims-demo",
            "deployment", "payers-claims-demo-operations-config.xml");

    private static List<AllowedOperationDescriptor> load(String xml) throws Exception {
        XMap xmap = new XMap();
        xmap.register(AllowedOperationDescriptor.class);
        List<AllowedOperationDescriptor> loaded = new ArrayList<>();
        for (Object each : xmap.loadAll(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)))) {
            loaded.add((AllowedOperationDescriptor) each);
        }
        return loaded;
    }

    private static String resource(String name) throws Exception {
        try (InputStream in = AllowListXmlTest.class.getClassLoader().getResourceAsStream(name)) {
            assertNotNull(in, name + " is not in the bundle");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    void theDocumentedExampleRegisters() throws Exception {
        Matcher code = CODE.matcher(resource("OSGI-INF/agentic-ui-operations-service.xml"));
        assertTrue(code.find(), "the extension point documents no example");
        List<AllowedOperationDescriptor> descriptors = load("<x>" + code.group(1) + "</x>");
        assertEquals(1, descriptors.size());
        AllowedOperation operation = AllowedOperation.of(descriptors.get(0));
        assertEquals("Payers.RequestMedicalRecords", operation.id());
        assertEquals("Write", operation.permission());
        assertEquals(Set.of("claims-adjusters"), operation.groups());
        assertEquals(500, operation.parameters().get("note").maxLength());
        assertEquals(AllowedOperation.Type.BOOLEAN, operation.parameters().get("urgent").type());
    }

    @Test
    void theKitsDemoDeploymentAllowsRequestMedicalRecordsAndNothingElse() throws Exception {
        String xml = Files.readString(DEPLOYMENT);
        Matcher extension = EXTENSION.matcher(xml);
        assertTrue(extension.find(), DEPLOYMENT + " contributes to no allow-list");
        List<AllowedOperationDescriptor> descriptors = load("<x>" + extension.group(1) + "</x>");
        OperationAllowListComponent component = new OperationAllowListComponent();
        descriptors.forEach(descriptor -> component.register(descriptor, "deployment"));
        AllowList allowList = component.getAllowList();
        assertEquals(Set.of("Payers.RequestMedicalRecords"), allowList.operations().keySet());
        AllowedOperation operation = allowList.get("Payers.RequestMedicalRecords");
        assertEquals(List.of("provider", "urgent", "note"), List.copyOf(operation.parameters().keySet()));
        assertEquals(Set.of("claims-adjusters"), operation.groups());
        // On purpose: the demo shows the registry and the endpoint refusing it.
        assertFalse(allowList.operations().containsKey("Payers.ReferToInvestigations"));
        assertTrue(xml.contains("<require>org.nuxeo.agentic.ui.operations</require>"),
                "it must register after the component whose point it contributes to");
    }

    @Test
    void theKitServedWithItsDemoDeploymentOffersOneButtonAndRefusesTheOther() throws Exception {
        Path kit = Path.of("..", "business-apps", "packages", "payers-claims-demo", "bundle");
        String actions = Files.readString(kit.resolve("agentic-ui-config/actions.json"));
        Matcher extension = EXTENSION.matcher(Files.readString(DEPLOYMENT));
        assertTrue(extension.find());
        OperationAllowListComponent component = new OperationAllowListComponent();
        load("<x>" + extension.group(1) + "</x>").forEach(d -> component.register(d, "deployment"));
        AppRegistryEndpoint registry = ActionFixtures.registry(actions, component.getAllowList());
        AppRegistryEndpoint.Viewer adjuster = new AppRegistryEndpoint.Viewer("dana.lee",
                Set.of("members", "claims-adjusters"), false);

        com.fasterxml.jackson.databind.JsonNode served = ConfigSnapshot.JSON.readTree(
                registry.respond("/apps/" + ActionFixtures.APP + "/actions.json", adjuster, null).body());
        List<String> ids = new ArrayList<>();
        served.get("actions").forEach(action -> ids.add(action.get("id").asText()));
        assertEquals(List.of("payers.claim.pay", "payers.claim.requestRecords"), ids);
        RunnableAction request = registry.action(ActionFixtures.APP, "payers.claim.requestRecords", adjuster);
        assertEquals("Payers.RequestMedicalRecords", request.operation());
        assertEquals(new RunnableAction.Field("claim:provider"), request.parameters().get("provider"));
        assertEquals(null, registry.action(ActionFixtures.APP, "payers.claim.referToInvestigations", adjuster));

        // The kit contributes both chains, and closes Nuxeo's own endpoint to them for everyone but
        // administrators; it contributes nothing to the allow-list.
        String operations = Files.readString(kit.resolve("OSGI-INF/payers-claims-demo-operations.xml"));
        for (String chain : List.of("Payers.RequestMedicalRecords", "Payers.ReferToInvestigations")) {
            assertTrue(operations.contains("<chain id=\"" + chain + "\">"), chain);
            // Its first step refuses every run but AgenticUi.RunAction's, for itself.
            assertTrue(Pattern.compile("<chain id=\"" + Pattern.quote(chain) + "\">\\s*(?:<!--.*?-->\\s*)?<operation id=\""
                    + Pattern.quote(RequireRunActionOperation.ID) + "\">\\s*<param type=\"string\" name=\"operation\">"
                    + Pattern.quote(chain) + "</param>", Pattern.DOTALL).matcher(operations).find(),
                    chain + " does not begin with " + RequireRunActionOperation.ID + " for itself");
            assertTrue(Pattern.compile("<binding name=\"" + Pattern.quote(chain)
                    + "\" chain=\"true\">\\s*<administrator>true</administrator>\\s*</binding>")
                              .matcher(operations)
                              .find(), chain + " is not closed on Nuxeo's own Automation endpoint");
        }
        assertFalse(operations.contains("org.nuxeo.agentic.ui.operations\" point"));
    }

    @Test
    void theRunEndpointIsTheOperationTheContributionRegisters() throws Exception {
        assertEquals(RunAppActionOperation.ID, RunAppActionOperation.class.getAnnotation(Operation.class).id());
        String contribution = resource("OSGI-INF/agentic-ui-operations-contrib.xml");
        assertTrue(contribution.contains("<operation class=\"" + RunAppActionOperation.class.getName() + "\" />"));
        assertTrue(contribution.contains("<require>org.nuxeo.agentic.ui.operations</require>"));
        assertTrue(contribution.contains("<require>org.nuxeo.agentic.ui.config</require>"));
        String service = resource("OSGI-INF/agentic-ui-operations-service.xml");
        assertTrue(service.contains("<object class=\"" + AllowedOperationDescriptor.class.getName() + "\" />"));
        assertTrue(service.contains("<provide interface=\"" + OperationAllowListService.class.getName() + "\" />"));
        assertTrue(service.contains("<implementation class=\"" + OperationAllowListComponent.class.getName() + "\" />"));
    }
}
