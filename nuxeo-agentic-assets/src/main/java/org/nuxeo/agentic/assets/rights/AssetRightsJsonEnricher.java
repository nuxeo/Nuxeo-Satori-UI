/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights;

import static org.nuxeo.ecm.core.io.registry.reflect.Instantiations.SINGLETON;
import static org.nuxeo.ecm.core.io.registry.reflect.Priorities.REFERENCE;

import java.io.IOException;
import java.io.Serializable;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.rights.Decision.Reason;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.io.marshallers.json.enrichers.AbstractJsonEnricher;
import org.nuxeo.ecm.core.io.registry.reflect.Setup;
import org.nuxeo.runtime.api.Framework;

import com.fasterxml.jackson.core.JsonGenerator;

/**
 * The {@code assetRights} document enricher: what the rights policy decides for each use of the
 * document, so that a client can say why the server refused one.
 *
 * <p>Ask for it with {@code enrichers.document: assetRights}. For a document no policy covers it
 * writes {@code "assetRights": null}. Otherwise:
 *
 * <pre>
 * "assetRights": {
 *   "type": "AcmeAsset",
 *   "today": "2026-11-24",
 *   "rightsEnd": "2026-12-14",
 *   "ended": false,
 *   "channels": ["E-commerce", "Social"],
 *   "uses": [
 *     { "use": "original", "name": null, "allowed": false, "reason": "channel-not-covered", "channel": "Print" },
 *     { "use": "view", "name": "Medium", "allowed": true, "reason": "preview" },
 *     { "use": "view", "name": "OriginalJpeg", "allowed": false, "reason": "channel-not-covered", "channel": "Print" },
 *     { "use": "rendition", "name": "thumbnail", "allowed": true, "reason": "preview" }
 *   ],
 *   "otherwise": { "allowed": false, "reason": "not-cleared" }
 * }
 * </pre>
 *
 * <p>{@code uses} holds the original, each picture view the document has, by its title, then each
 * rendition and blob the policy lists; {@code otherwise} is the answer for any use not among them.
 * Every reason is a code from {@link Reason}, for the client to translate. Days are the server's,
 * in UTC. A policy or a document that cannot be read writes every use refused with
 * {@code policy-error}, as the download permission refuses them.
 *
 * <p>The enricher explains; the download permission is what refuses. Both decide through
 * {@link AssetRights#decide}.
 */
@Setup(mode = SINGLETON, priority = REFERENCE)
public class AssetRightsJsonEnricher extends AbstractJsonEnricher<DocumentModel> {

    private static final Logger log = LogManager.getLogger(AssetRightsJsonEnricher.class);

    public static final String NAME = "assetRights";

    private final Supplier<AssetRightsService> service;

    /** The constructor the marshaller registry calls: it needs a public one with no parameters. */
    public AssetRightsJsonEnricher() {
        this(() -> Framework.getService(AssetRightsService.class));
    }

    /** For tests, which have no runtime to look the service up in. */
    AssetRightsJsonEnricher(Supplier<AssetRightsService> service) {
        super(NAME);
        this.service = service;
    }

    @Override
    public void write(JsonGenerator jg, DocumentModel document) throws IOException {
        AssetRightsService rights = service.get();
        RightsPolicy policy = rights == null ? null : rights.policyFor(document.getType());
        if (policy == null) {
            jg.writeNullField(NAME);
            return;
        }
        LocalDate today = rights.today();
        AssetFacts facts = null;
        boolean unreadable = policy.broken();
        if (!unreadable) {
            try {
                facts = AssetFacts.read(document, policy);
            } catch (RuntimeException e) {
                log.error("Asset rights: the rights of {} ({}) could not be read", AssetRightsComponent.id(document),
                        document.getType(), e);
                unreadable = true;
            }
        }
        Map<Use, Decision> decided = new LinkedHashMap<>();
        for (Use use : uses(document, policy)) {
            decided.put(use, unreadable ? Decision.refuse(Reason.POLICY_ERROR)
                    : AssetRights.decide(policy, facts, use, today));
        }
        Decision otherwise = unreadable ? Decision.refuse(Reason.POLICY_ERROR) : Decision.refuse(Reason.NOT_CLEARED);

        jg.writeObjectFieldStart(NAME);
        jg.writeStringField("type", policy.type());
        jg.writeStringField("today", today.toString());
        if (facts == null) {
            jg.writeNullField("rightsEnd");
            jg.writeNullField("ended");
            jg.writeNullField("channels");
        } else {
            writeDay(jg, "rightsEnd", facts.rightsEnd());
            jg.writeBooleanField("ended", facts.ended(today));
            jg.writeArrayFieldStart("channels");
            for (String channel : facts.channels()) {
                jg.writeString(channel);
            }
            jg.writeEndArray();
        }
        jg.writeArrayFieldStart("uses");
        for (Map.Entry<Use, Decision> entry : decided.entrySet()) {
            jg.writeStartObject();
            jg.writeStringField("use", entry.getKey().kind().code());
            jg.writeStringField("name", entry.getKey().name());
            writeDecision(jg, entry.getValue());
            jg.writeEndObject();
        }
        jg.writeEndArray();
        jg.writeObjectFieldStart("otherwise");
        writeDecision(jg, otherwise);
        jg.writeEndObject();
        jg.writeEndObject();
    }

    /** The original, each view the document has, then each rendition and blob the policy lists. */
    static List<Use> uses(DocumentModel document, RightsPolicy policy) {
        Set<Use> uses = new LinkedHashSet<>();
        uses.add(Use.ORIGINAL);
        uses.addAll(views(document));
        for (Use listed : policy.rules().keySet()) {
            if (listed.kind() == Use.Kind.RENDITION || listed.kind() == Use.Kind.BLOB) {
                uses.add(listed);
            }
        }
        return new ArrayList<>(uses);
    }

    /** The document's picture views, by title, in its order; none when it is not a picture. */
    static List<Use> views(DocumentModel document) {
        List<Use> views = new ArrayList<>();
        try {
            if (!document.hasSchema("picture")) {
                return views;
            }
            Serializable value = document.getPropertyValue("picture:views");
            if (value instanceof List<?> list) {
                for (Object view : list) {
                    if (view instanceof Map<?, ?> map && map.get("title") instanceof String title && !title.isBlank()) {
                        views.add(Use.view(title));
                    }
                }
            }
        } catch (RuntimeException e) {
            log.warn("Asset rights: the views of {} could not be listed", AssetRightsComponent.id(document), e);
        }
        return views;
    }

    private static void writeDecision(JsonGenerator jg, Decision decision) throws IOException {
        jg.writeBooleanField("allowed", decision.allowed());
        jg.writeStringField("reason", decision.reason().code());
        if (decision.channel() != null) {
            jg.writeStringField("channel", decision.channel());
        }
        if (decision.rightsEnd() != null) {
            writeDay(jg, "rightsEnd", decision.rightsEnd());
        }
    }

    private static void writeDay(JsonGenerator jg, String field, LocalDate day) throws IOException {
        if (day == null) {
            jg.writeNullField(field);
        } else {
            jg.writeStringField(field, day.toString());
        }
    }
}
