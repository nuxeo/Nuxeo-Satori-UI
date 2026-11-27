/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.review;

import static org.nuxeo.ecm.core.io.registry.reflect.Instantiations.SINGLETON;
import static org.nuxeo.ecm.core.io.registry.reflect.Priorities.REFERENCE;

import java.io.IOException;
import java.util.function.Function;
import java.util.function.Supplier;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.io.marshallers.json.enrichers.AbstractJsonEnricher;
import org.nuxeo.ecm.core.io.registry.reflect.Setup;
import org.nuxeo.runtime.api.Framework;

import com.fasterxml.jackson.core.JsonGenerator;

/**
 * The {@code assetReview} document enricher: whether the reader may decide the document's review,
 * so that the asset page offers Send back, Approve and Reject only to those the server lets decide.
 *
 * <p>Ask for it with {@code enrichers.document: assetReview}. For a document no review policy covers
 * it writes {@code "assetReview": null}. Otherwise:
 *
 * <pre>
 * "assetReview": { "type": "AcmeAsset", "mayDecide": false, "reason": "not-a-reviewer", "permission": "ReviewAsset" }
 * </pre>
 *
 * {@code reason} is {@code null} when the reader may decide, else a code of
 * {@link AssetReviews.Refused}. It says nothing a reader of the document may not know: whether they
 * may decide, and the permission's name. It explains; the listener refuses, whatever it said.
 */
@Setup(mode = SINGLETON, priority = REFERENCE)
public class AssetReviewJsonEnricher extends AbstractJsonEnricher<DocumentModel> {

    private static final Logger log = LogManager.getLogger(AssetReviewJsonEnricher.class);

    public static final String NAME = "assetReview";

    private final Supplier<AssetReviewService> service;

    /** The constructor the marshaller registry calls: it needs a public one with no parameters. */
    public AssetReviewJsonEnricher() {
        this(() -> Framework.getService(AssetReviewService.class));
    }

    AssetReviewJsonEnricher(Supplier<AssetReviewService> service) {
        super(NAME);
        this.service = service;
    }

    @Override
    public void write(JsonGenerator jg, DocumentModel document) throws IOException {
        AssetReviewService reviews = service.get();
        ReviewPolicy policy = reviews == null ? null : reviews.policyFor(document.getType());
        if (policy == null) {
            jg.writeNullField(NAME);
            return;
        }
        AssetReviews.Refused refused;
        try {
            refused = refusal(document, policy);
        } catch (RuntimeException e) {
            log.error("Asset review: whether {} may be decided could not be read", document.getId(), e);
            refused = AssetReviews.Refused.NOT_A_REVIEWER;
        }
        jg.writeObjectFieldStart(NAME);
        jg.writeStringField("type", policy.type());
        jg.writeBooleanField("mayDecide", refused == null);
        if (refused == null) {
            jg.writeNullField("reason");
        } else {
            jg.writeStringField("reason", refused.code());
        }
        jg.writeStringField("permission", AssetReviews.PERMISSION);
        jg.writeEndObject();
    }

    /** As the listener decides for the reader: the document's permissions read with the system's rights. */
    static AssetReviews.Refused refusal(DocumentModel document, ReviewPolicy policy) {
        CoreSession session = document.getCoreSession();
        if (session == null) {
            return AssetReviews.Refused.NOT_A_REVIEWER;
        }
        NuxeoPrincipal person = AssetReviews.acting(session.getPrincipal());
        ACP acp = CoreInstance.doPrivileged(session,
                (Function<CoreSession, ACP>) privileged -> privileged.getACP(document.getRef()));
        return AssetReviews.refusal(person, document, policy, acp);
    }
}
