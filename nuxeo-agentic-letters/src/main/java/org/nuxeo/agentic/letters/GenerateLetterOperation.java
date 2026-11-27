/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import org.nuxeo.ecm.automation.core.Constants;
import org.nuxeo.ecm.automation.core.annotations.Context;
import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.automation.core.annotations.Param;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * {@code Letter.Generate}: a letter written on the input record, from its letter's template, in the
 * language asked for or the record's, and filed next to the record. As the person who asks, who must
 * hold {@code Write} on the record; {@link LetterGenerator} says what is checked, in which order.
 *
 * <p>A button reaches it through a kit's chain that the deployment's allow-list names and that
 * begins with {@code AgenticUi.RequireRunAction}; Nuxeo's own Automation endpoint reaches it too,
 * for anyone, so its own checks are the control.
 */
@Operation(id = GenerateLetterOperation.ID, category = Constants.CAT_DOCUMENT, label = "Generate a letter",
        description = "Write a letter on the input record from its letter's template, in the language asked for or "
                + "the record's, and file it next to the record. Needs Write on the record. Returns the letter.")
public class GenerateLetterOperation {

    public static final String ID = "Letter.Generate";

    @Context
    protected CoreSession session;

    /** The letter, as its templates name it: payers.denial. */
    @Param(name = "letter")
    protected String letter;

    /** A language tag, such as es; the record's language when none. */
    @Param(name = "language", required = false)
    protected String language;

    @OperationMethod
    public DocumentModel run(DocumentModel record) {
        return LetterGenerator.generate(session, record, letter, language);
    }
}
