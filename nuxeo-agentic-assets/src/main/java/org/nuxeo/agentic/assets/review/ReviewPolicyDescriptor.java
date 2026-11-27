/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.review;

import java.util.ArrayList;
import java.util.List;

import org.nuxeo.common.xmap.annotation.XNode;
import org.nuxeo.common.xmap.annotation.XNodeList;
import org.nuxeo.common.xmap.annotation.XObject;

/**
 * A review policy for one document type, as a package contributes it to
 * {@code org.nuxeo.agentic.assets.review}, point {@code policies}:
 *
 * <pre>
 * &lt;review type="AcmeAsset"&gt;
 *   &lt;reviewer group="creative-review" /&gt;
 * &lt;/review&gt;
 * </pre>
 *
 * The groups whose members may decide a review of a document of that type, once the add-on's
 * {@value AssetReviews#PERMISSION} permission is granted to them on it ({@link AssetReviews}),
 * read as the platform reads a document type's facets, {@code facet@name}. {@link ReviewPolicy#of}
 * reads it, and a mistake in it never widens it.
 */
@XObject("review")
public class ReviewPolicyDescriptor {

    @XNode("@type")
    protected String type;

    @XNode("@enabled")
    protected boolean enabled = true;

    @XNodeList(value = "reviewer@group", type = ArrayList.class, componentType = String.class)
    protected List<String> groups = new ArrayList<>();

    public ReviewPolicyDescriptor() {
    }

    ReviewPolicyDescriptor(String type, List<String> groups) {
        this.type = type;
        this.groups = new ArrayList<>(groups);
    }

    public String getType() {
        return type;
    }

    public boolean isEnabled() {
        return enabled;
    }

    /** Each {@code <reviewer group>}, as written. */
    public List<String> getGroups() {
        return groups;
    }
}
