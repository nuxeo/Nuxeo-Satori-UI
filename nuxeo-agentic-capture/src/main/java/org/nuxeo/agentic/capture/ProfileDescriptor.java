/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.util.ArrayList;
import java.util.List;

import org.nuxeo.common.xmap.annotation.XNode;
import org.nuxeo.common.xmap.annotation.XNodeList;
import org.nuxeo.common.xmap.annotation.XObject;

/**
 * {@code <profile id="...">} at {@code org.nuxeo.agentic.capture}'s {@code profiles}, as it is
 * written: {@link Profile#of} checks it and makes the profile the add-on uses.
 */
@XObject("profile")
public class ProfileDescriptor {

    @XNode("@id")
    protected String id;

    @XNode("@enabled")
    protected boolean enabled = true;

    @XNode("inboxType")
    protected String inboxType;

    @XNode("itemType")
    protected String itemType;

    @XNode("recordType")
    protected String recordType;

    @XNode("recordPath")
    protected String recordPath;

    @XNode("threshold")
    protected String threshold;

    @XNodeList(value = "class", type = ArrayList.class, componentType = ClassDescriptor.class)
    protected List<ClassDescriptor> classes = new ArrayList<>();

    public String getId() {
        return id;
    }

    public boolean isEnabled() {
        return enabled;
    }

    /** {@code <class name="..." label="...">}: its description, keywords and fields. */
    @XObject("class")
    public static class ClassDescriptor {

        @XNode("@name")
        protected String name;

        @XNode("@label")
        protected String label;

        @XNode("description")
        protected String description;

        @XNodeList(value = "keyword", type = ArrayList.class, componentType = String.class)
        protected List<String> keywords = new ArrayList<>();

        @XNodeList(value = "field", type = ArrayList.class, componentType = FieldDescriptor.class)
        protected List<FieldDescriptor> fields = new ArrayList<>();
    }

    /** {@code <field name="..." label="..." match="prefix:name" format="..." />}. */
    @XObject("field")
    public static class FieldDescriptor {

        @XNode("@name")
        protected String name;

        @XNode("@label")
        protected String label;

        @XNode("@description")
        protected String description;

        @XNode("@match")
        protected String match;

        @XNode("@format")
        protected String format;
    }
}
