package org.nuxeo.agentic.lifecycle;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.nuxeo.ecm.core.api.security.SecurityConstants.READ_LIFE_CYCLE;

import java.io.InputStream;
import java.io.StringWriter;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;

import javax.xml.parsers.DocumentBuilderFactory;

import org.junit.jupiter.api.Test;
import org.nuxeo.ecm.core.io.marshallers.json.AbstractJsonWriter;
import org.nuxeo.ecm.core.io.marshallers.json.enrichers.AbstractJsonEnricher;
import org.nuxeo.ecm.core.io.marshallers.json.enrichers.Enriched;
import org.nuxeo.ecm.core.io.registry.context.RenderingContext;
import org.nuxeo.ecm.core.io.registry.reflect.Instantiations;
import org.nuxeo.ecm.core.io.registry.reflect.Setup;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * What the {@code allowedTransitions} enricher writes, through the entry point the marshaller
 * registry calls, and that the bundle registers it where the server will find it.
 */
class AllowedTransitionsJsonEnricherTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static AllowedTransitionsJsonEnricher enricher(FakeRepository repository, String requested)
            throws Exception {
        AllowedTransitionsJsonEnricher enricher = new AllowedTransitionsJsonEnricher(repository::lifeCycleOfType);
        RenderingContext ctx = RenderingContext.CtxBuilder.param(AbstractJsonEnricher.ENTITY_ENRICHER_NAME, requested)
                                                          .get();
        // The registry injects `ctx`; there is no registry here.
        Field field = AbstractJsonWriter.class.getDeclaredField("ctx");
        field.setAccessible(true);
        field.set(enricher, ctx);
        return enricher;
    }

    /** The object the enricher's output lands in, as `contextParameters` holds it. */
    private static JsonNode written(FakeRepository repository) throws Exception {
        StringWriter out = new StringWriter();
        try (JsonGenerator jg = new JsonFactory(JSON).createGenerator(out)) {
            jg.writeStartObject();
            enricher(repository, AllowedTransitionsJsonEnricher.NAME).write(new Enriched<>(repository.document()), jg);
            jg.writeEndObject();
        }
        return JSON.readTree(out.toString());
    }

    @Test
    void writesEachTransitionWithItsDestinationInTheLifecyclesOrder() throws Exception {
        JsonNode written = written(new FakeRepository().grantEverythingNeeded());

        assertEquals(JSON.readTree("""
                { "allowedTransitions": [
                    { "name": "approve", "destinationState": "approved" },
                    { "name": "deny", "destinationState": "denied" }
                ] }
                """), written);
    }

    /** An empty array, not a missing field: "none" is an answer the interface can act on. */
    @Test
    void writesAnEmptyArrayWhenTheUserMayFollowNone() throws Exception {
        JsonNode written = written(new FakeRepository().grant(READ_LIFE_CYCLE));

        assertEquals(JSON.readTree("{ \"allowedTransitions\": [] }"), written);
    }

    /** Every entry carries both keys as text: a transition with no destination is not written. */
    @Test
    void writesNoTransitionThePolicyDoesNotDeclare() throws Exception {
        FakeRepository repository = new FakeRepository().grantEverythingNeeded();
        repository.state = "review";

        assertEquals(JSON.readTree("""
                { "allowedTransitions": [ { "name": "approve", "destinationState": "approved" } ] }
                """), written(repository));
    }

    /** The registry runs an enricher only for the name the request asked for. */
    @Test
    void answersToItsOwnNameOnly() throws Exception {
        FakeRepository repository = new FakeRepository();

        assertEquals("allowedTransitions", AllowedTransitionsJsonEnricher.NAME);
        assertTrue(enricher(repository, "allowedTransitions").accept(Enriched.class, null, null));
        assertFalse(enricher(repository, "allowedStateTransitions").accept(Enriched.class, null, null));
        assertFalse(enricher(repository, "permissions").accept(Enriched.class, null, null));
    }

    /**
     * The marshaller registry instantiates a marshaller through its public constructor with no
     * parameters and refuses one without {@code @Setup}. Either missing, the contribution loads and
     * the enricher never runs.
     */
    @Test
    void isAMarshallerTheRegistryCanInstantiate() throws Exception {
        Setup setup = AllowedTransitionsJsonEnricher.class.getAnnotation(Setup.class);
        assertNotNull(setup);
        assertEquals(Instantiations.SINGLETON, setup.mode());

        Constructor<?> constructor = Arrays.stream(AllowedTransitionsJsonEnricher.class.getDeclaredConstructors())
                                           .filter(candidate -> candidate.getParameterCount() == 0)
                                           .findFirst()
                                           .orElseThrow();
        assertTrue(Modifier.isPublic(constructor.getModifiers()));
        // As the registry does. The runtime lookup it installs is only reached when it is applied.
        assertTrue(constructor.newInstance() instanceof AbstractJsonEnricher<?>);
    }

    /**
     * The contribution names this class at the marshaller registry's extension point, and the
     * bundle's manifest lists the contribution. A contribution the manifest does not list is never
     * read.
     */
    @Test
    void theBundleRegistersTheEnricher() throws Exception {
        String contribution = "OSGI-INF/agentic-allowed-transitions-enricher-contrib.xml";
        org.w3c.dom.Document xml;
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(contribution)) {
            assertNotNull(in, contribution + " is not on the bundle's classpath");
            xml = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(in);
        }
        Element extension = (Element) xml.getElementsByTagName("extension").item(0);
        assertEquals("org.nuxeo.ecm.core.io.MarshallerRegistry", extension.getAttribute("target"));
        assertEquals("marshallers", extension.getAttribute("point"));
        NodeList registered = extension.getElementsByTagName("register");
        assertEquals(1, registered.getLength());
        Element register = (Element) registered.item(0);
        assertEquals(AllowedTransitionsJsonEnricher.class.getName(), register.getAttribute("class"));
        assertEquals("true", register.getAttribute("enable"));

        Path manifest = Path.of(System.getProperty("basedir", "."), "src/main/resources/META-INF/MANIFEST.MF");
        assertTrue(componentsOf(manifest).contains(contribution), "MANIFEST.MF does not list " + contribution);
    }

    /** {@code Nuxeo-Component} as Java reads a manifest: continuation lines unfolded, split at commas. */
    private static List<String> componentsOf(Path manifest) throws Exception {
        try (InputStream in = Files.newInputStream(manifest)) {
            String value = new java.util.jar.Manifest(in).getMainAttributes().getValue("Nuxeo-Component");
            assertNotNull(value, "no Nuxeo-Component in " + manifest);
            return Arrays.stream(value.split("[,\\s]+")).filter(path -> !path.isEmpty()).toList();
        }
    }
}
