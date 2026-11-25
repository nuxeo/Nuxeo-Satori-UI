package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

/**
 * The deployment layer's switch: off on a server that has set nothing, or anything but
 * {@code true}, and the settings read as the component reads them.
 */
class LayerSwitchTest {

    @Test
    void aServerThatHasSetNothingHasTheLayerSwitchedOff() {
        AgenticUiConfigComponent component = new AgenticUiConfigComponent();
        assertSame(LayerService.SWITCHED_OFF, component.layerService());
        for (String value : new String[] { null, "", "1", "yes", "on", "TRUE " }) {
            component.activateLayer(key -> LayerSettings.ENABLED_PROPERTY.equals(key) ? value : null,
                    new LayerFixtures.MemoryStore(), LayerFixtures::corpus, LayerService.AppLock.NONE);
            assertSame(LayerService.SWITCHED_OFF, component.layerService(), String.valueOf(value));
        }
    }

    @Test
    void switchedOnTheLayerIsBuiltWithTheSettingsTheServerGives() {
        Map<String, String> properties = Map.of(LayerSettings.ENABLED_PROPERTY, "true",
                LayerSettings.REGISTERED_PREFIX + "rules", " acme.rules.one, ,acme.rules.two ");
        AgenticUiConfigComponent component = new AgenticUiConfigComponent();
        component.activateLayer(properties::get, new LayerFixtures.MemoryStore(), LayerFixtures::corpus,
                LayerService.AppLock.NONE);
        assertTrue(component.layerService().enabled());

        LayerSettings settings = LayerSettings.from(properties::get);
        assertFalse(settings.selfApproval());
        assertEquals(List.of("acme.rules.one", "acme.rules.two"), settings.rules());
        assertTrue(LayerSettings.from(key -> LayerSettings.SELF_APPROVAL_PROPERTY.equals(key) ? "true" : null)
                                .selfApproval());
        assertFalse(LayerSettings.from(key -> null).enabled());
    }
}
