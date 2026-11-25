package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import javax.script.ScriptEngine;

import org.junit.jupiter.api.Test;
import org.openjdk.nashorn.api.scripting.NashornScriptEngineFactory;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;

/** The engine the validator runs in, and what it does with an answer that is not the validator's. */
class NashornDeploymentValidatorTest {

    private static ScriptEngine engine() {
        return new NashornScriptEngineFactory().getScriptEngine(NashornDeploymentValidator.ENGINE_OPTIONS,
                NashornDeploymentValidatorTest.class.getClassLoader(), className -> false);
    }

    @Test
    void theScriptReachesNoJava() throws Exception {
        ScriptEngine engine = engine();
        assertEquals("undefined", engine.eval("typeof Java"));
        assertEquals("undefined", engine.eval("typeof Packages"));
        assertEquals("undefined", engine.eval("typeof java"));
        assertThrows(Exception.class, () -> engine.eval("Java.type('java.lang.System').exit(1)"));
        // The engine the options name is the one the script is built for: ES6's let and Map.
        assertEquals(2, ((Number) engine.eval("let m = new Map([[1, 2]]); m.get(1)")).intValue());
    }

    @Test
    void anAnswerThatIsNotTheValidatorsRefusesTheFile() {
        assertNotNull(NashornDeploymentValidator.read(null).refused());
        assertNotNull(NashornDeploymentValidator.read(42).refused());
        assertNotNull(NashornDeploymentValidator.read("not json").refused());
        assertNotNull(NashornDeploymentValidator.read("{}").refused());
        assertNotNull(NashornDeploymentValidator.read("{\"findings\":[{\"path\":\"\"}]}").refused());
        assertEquals("why", NashornDeploymentValidator.read("{\"refused\":\"why\"}").refused());
        DeploymentValidator.Answer passes = NashornDeploymentValidator.read("{\"findings\":[]}");
        assertNull(passes.refused());
        assertTrue(passes.passes());
        assertFalse(NashornDeploymentValidator.read(
                "{\"findings\":[{\"path\":\"\",\"kind\":\"unknown\",\"message\":\"m\"}]}").passes());
    }

    @Test
    void aModelThatCannotBeReadRefusesTheFile() {
        DeploymentValidator validator = new NashornDeploymentValidator(() -> {
            throw new IllegalStateException("no schema manager");
        }, LayerFixtures.ON);
        DeploymentValidator.Answer answer = validator.validate(LayerFixtures.CLAIM_VIEW,
                LayerFixtures.kitFile(LayerFixtures.CLAIM_VIEW), null, null);
        assertFalse(answer.passes());
        assertTrue(answer.refused().contains("no schema manager"));
    }

    @Test
    void theKitsOwnFilePassesAndOneWithAKeyVersionTwoLacksDoesNot() {
        DeploymentValidator validator = LayerFixtures.validator(LayerFixtures.ON);
        assertTrue(validator.validate(LayerFixtures.CLAIM_VIEW, LayerFixtures.kitFile(LayerFixtures.CLAIM_VIEW), null,
                null).passes());
        DeploymentValidator.Answer refused = validator.validate(LayerFixtures.CLAIM_VIEW,
                LayerFixtures.kitFile(LayerFixtures.CLAIM_VIEW).put("bogus", 1), null, null);
        assertEquals(List.of("bogus"), List.of(refused.findings().get(0).get("path").asText()));
        assertFalse(validator.validate("home.json", JsonNodeFactory.instance.objectNode(), null, null).passes());
    }
}
