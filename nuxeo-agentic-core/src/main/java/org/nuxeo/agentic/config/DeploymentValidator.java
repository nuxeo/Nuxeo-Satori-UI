package org.nuxeo.agentic.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;

/**
 * The check every write to a deployment layer goes through, on the server, whatever the client
 * checked: the app definition's own validator, the pipeline's check of one file of a package
 * ({@link NashornDeploymentValidator}).
 */
interface DeploymentValidator {

    /**
     * The validator's answer for one file.
     *
     * @param findings each finding, as the validator writes it: {@code path}, {@code kind} and
     *            {@code message}
     * @param refused why the file was not checked at all, or {@code null}: a path that is no file of
     *            the layer, a content model that cannot be read, or a validator that could not run.
     *            Each refuses the write, as a finding does.
     */
    record Answer(ArrayNode findings, String refused) {

        /** Whether the file may be written: checked, and with no finding of any kind. */
        boolean passes() {
            return refused == null && findings != null && findings.isEmpty();
        }
    }

    /**
     * @param path the file's path below the app's root
     * @param content the file, parsed
     * @param app the app's {@code app.json}
     * @param actions the app's {@code actions.json}, or {@code null} when its package has none
     */
    Answer validate(String path, JsonNode content, JsonNode app, JsonNode actions);
}
