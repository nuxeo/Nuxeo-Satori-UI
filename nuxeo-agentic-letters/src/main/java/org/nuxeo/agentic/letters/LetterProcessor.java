/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.template.api.TemplateInput;
import org.nuxeo.template.api.TemplateProcessor;
import org.nuxeo.template.api.adapters.TemplateBasedDocument;

/**
 * The add-on's template processor, {@value Letters#PROCESSOR}, at the platform's template processor
 * service: a letter template's text with its placeholders filled, and nothing run.
 *
 * <p>It renders only the letter {@link LetterGenerator} is writing on this thread, from the template
 * it checked, with the values it read as the writer. Asked any other way, by the platform's own
 * {@code TemplateProcessor.Render} operation, a template-based rendition, or code that binds another
 * document to a letter template, it refuses: a letter template is reached through
 * {@code Letter.Generate} alone. It reads nothing itself, and ignores the platform's template
 * parameters, which a letter template does not use.
 */
public class LetterProcessor implements TemplateProcessor {

    /** The longest letter. */
    static final int MAX_LETTER_CHARS = 2 * 1024 * 1024;

    @Override
    public Blob renderTemplate(TemplateBasedDocument templateBasedDocument, String templateName) {
        LetterRendering.Current current = LetterRendering.current();
        DocumentModel adapted = templateBasedDocument == null ? null : templateBasedDocument.getAdaptedDoc();
        if (current == null || adapted == null || adapted.getId() == null || !adapted.getId().equals(current.letterId())
                || !current.templateName().equals(templateName) || !adapted.hasFacet(Letters.TEMPLATE_BASED_FACET)
                || !Letters.LETTER_TYPE.equals(adapted.getType())) {
            throw Refusal.forbidden("A letter template renders only the letter Letter.Generate writes from it");
        }
        String letter = current.text().fill(current.values());
        if (letter.length() > MAX_LETTER_CHARS) {
            throw Refusal.conflict("The letter is longer than a letter may be");
        }
        TemplateText.Format format = current.text().format();
        return Blobs.createBlob(letter, format.mimeType, StandardCharsets.UTF_8.name(), current.fileName());
    }

    /** None: a letter template's placeholders are its own, never the platform's parameters. */
    @Override
    public List<TemplateInput> getInitialParametersDefinition(Blob blob) {
        return new ArrayList<>();
    }
}
