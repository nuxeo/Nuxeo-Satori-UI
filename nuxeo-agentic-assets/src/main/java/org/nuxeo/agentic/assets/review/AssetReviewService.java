/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.review;

/** The review policies in force: one per document type. */
public interface AssetReviewService {

    /** The policy for documents of {@code type}, or {@code null} when none covers it. */
    ReviewPolicy policyFor(String type);
}
