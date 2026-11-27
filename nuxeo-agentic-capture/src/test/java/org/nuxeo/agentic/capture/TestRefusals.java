/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;

/** Another add-on's listener, as far as the tests need one: it refuses every change to a claim while {@link #claims} is set. */
public class TestRefusals implements EventListener {

    static volatile boolean claims;

    @Override
    public void handleEvent(Event event) {
        if (claims && event.getContext() instanceof DocumentEventContext context
                && context.getSourceDocument() != null && "TestClaim".equals(context.getSourceDocument().getType())) {
            event.markBubbleException();
            throw new NuxeoException("Another add-on refuses every change to a claim");
        }
    }
}
