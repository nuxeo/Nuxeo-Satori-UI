/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.lifecycle;

import static org.nuxeo.ecm.core.io.registry.reflect.Instantiations.SINGLETON;
import static org.nuxeo.ecm.core.io.registry.reflect.Priorities.REFERENCE;

import java.io.IOException;
import java.util.List;
import java.util.function.Function;

import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.io.marshallers.json.enrichers.AbstractJsonEnricher;
import org.nuxeo.ecm.core.io.registry.context.RenderingContext.SessionWrapper;
import org.nuxeo.ecm.core.io.registry.reflect.Setup;
import org.nuxeo.ecm.core.lifecycle.LifeCycle;
import org.nuxeo.ecm.core.lifecycle.LifeCycleService;
import org.nuxeo.runtime.api.Framework;

import com.fasterxml.jackson.core.JsonGenerator;

/**
 * The {@code allowedTransitions} document enricher: the lifecycle transitions the current user may
 * follow on the document now, as {@link AllowedTransitions} decides them.
 *
 * <p>Ask for it with {@code enrichers.document: allowedTransitions}. It writes
 *
 * <pre>
 * "contextParameters": {
 *   "allowedTransitions": [ { "name": "approve", "destinationState": "approved" } ]
 * }
 * </pre>
 *
 * <p>in the order the lifecycle lists them from the document's state, and an empty array when the
 * user may follow none. Nuxeo 2025 has no enricher or operation that lists them: the plan's
 * feasibility check asked for {@code lifecycle} and {@code allowedStateTransitions} and got
 * nothing back.
 */
@Setup(mode = SINGLETON, priority = REFERENCE)
public class AllowedTransitionsJsonEnricher extends AbstractJsonEnricher<DocumentModel> {

    public static final String NAME = "allowedTransitions";

    private final Function<String, LifeCycle> lifeCycles;

    /** The constructor the marshaller registry calls: it needs a public one with no parameters. */
    public AllowedTransitionsJsonEnricher() {
        this(name -> Framework.getService(LifeCycleService.class).getLifeCycleByName(name));
    }

    /** For tests, which have no runtime to look a lifecycle policy up in. */
    AllowedTransitionsJsonEnricher(Function<String, LifeCycle> lifeCycles) {
        super(NAME);
        this.lifeCycles = lifeCycles;
    }

    @Override
    public void write(JsonGenerator jg, DocumentModel document) throws IOException {
        List<AllowedTransition> transitions;
        try (SessionWrapper wrapper = ctx.getSession(document)) {
            transitions = AllowedTransitions.of(wrapper.getSession(), document, lifeCycles);
        }
        jg.writeArrayFieldStart(NAME);
        for (AllowedTransition transition : transitions) {
            jg.writeStartObject();
            jg.writeStringField("name", transition.name());
            if (transition.destinationState() == null) {
                jg.writeNullField("destinationState");
            } else {
                jg.writeStringField("destinationState", transition.destinationState());
            }
            jg.writeEndObject();
        }
        jg.writeEndArray();
    }
}
