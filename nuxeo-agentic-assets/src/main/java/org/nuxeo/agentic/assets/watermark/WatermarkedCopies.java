/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import java.util.regex.Pattern;

import org.nuxeo.agentic.assets.rights.AssetRightsComponent;
import org.nuxeo.agentic.assets.watermark.MarkedVideos.Job;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentModelList;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.PartialList;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;
import org.nuxeo.ecm.core.query.sql.NXQL;

/**
 * Where a long video's marked copies are kept, since 0.6.0: documents of the add-on's type
 * {@value #TYPE}, in a folder of the type {@value #CONTAINER_TYPE} below the repository's root, its
 * inheritance blocked, so that no one but the system reads them, and an administrator, whom the
 * platform lets read anything; the download permission refuses their files to everyone. Every call
 * here is given a session with the system's rights.
 */
public final class WatermarkedCopies {

    /** The rights refuse this type's file to everyone, by its document or by its stored file's key. */
    public static final String TYPE = AssetRightsComponent.COPY_TYPE;

    /** The rights refuse this type's files and renditions, as a folder's export, to everyone. */
    public static final String CONTAINER_TYPE = AssetRightsComponent.COPIES_FOLDER_TYPE;

    static final String CONTAINER_NAME = "agentic-watermarked-copies";

    static final String KEY = "wmc:key";

    static final String SOURCE = "wmc:source";

    static final String SOURCE_TYPE = "wmc:sourceType";

    static final String XPATH = "wmc:xpath";

    static final String USE = "wmc:use";

    static final String DIGEST = "wmc:digest";

    static final String FINGERPRINT = "wmc:fingerprint";

    static final String PURPOSE = "wmc:purpose";

    static final String RECIPIENT = "wmc:recipient";

    static final String USER = "wmc:user";

    static final String TERRITORY = "wmc:territory";

    static final String WATERMARK = "wmc:watermark";

    static final String MADE = "wmc:made";

    static final String CONTENT = "wmc:content";

    /** A key's form: the SHA-256, in hex. Nothing else is written into a query. */
    static final Pattern KEY_FORM = Pattern.compile("[0-9a-f]{64}");

    /** What a document's id may be, to be written into a query. */
    static final Pattern ID_FORM = Pattern.compile("[A-Za-z0-9-]{1,64}");

    /** The most copies a sweep removes at once. */
    static final int SWEEP_LIMIT = 100;

    private WatermarkedCopies() {
    }

    /** A kept copy, as read. */
    record Copy(String id, Blob file, String digest, String fingerprint, String purpose, String recipient,
            String user, String territory, String watermark, Calendar made) {
    }

    /** The copy kept under {@code key}, or {@code null} for none. */
    static Copy find(CoreSession privileged, String key) {
        if (key == null || !KEY_FORM.matcher(key).matches()) {
            throw new IllegalArgumentException("not a copy's key");
        }
        DocumentModelList found = privileged.query("SELECT * FROM " + TYPE + " WHERE " + KEY + " = '" + key
                + "' AND ecm:isProxy = 0 AND ecm:isVersion = 0 AND ecm:isTrashed = 0", 2);
        if (found.isEmpty()) {
            return null;
        }
        // Two jobs of one key on two nodes, each past the other's lease, could both keep one: the
        // first read serves, and the next sweep drops the other with the source's stale copies.
        return read(found.get(0));
    }

    static Copy read(DocumentModel doc) {
        return new Copy(doc.getId(), doc.getPropertyValue(CONTENT) instanceof Blob blob ? blob : null,
                text(doc, DIGEST), text(doc, FINGERPRINT), text(doc, PURPOSE), text(doc, RECIPIENT), text(doc, USER),
                text(doc, TERRITORY), text(doc, WATERMARK),
                doc.getPropertyValue(MADE) instanceof Calendar made ? made : null);
    }

    /** {@code marked}, made by {@code job}, kept, in the folder of copies, created if there is none. */
    static DocumentModel keep(CoreSession privileged, Job job, Blob marked, long nowMillis) {
        DocumentModel container = container(privileged);
        DocumentModel copy = privileged.createDocumentModel(container.getPathAsString(), "copy-" + job.key(), TYPE);
        copy.setPropertyValue("dc:title", "Marked copy");
        copy.setPropertyValue(KEY, job.key());
        copy.setPropertyValue(SOURCE, job.document());
        copy.setPropertyValue(SOURCE_TYPE, job.type());
        copy.setPropertyValue(XPATH, job.xpath());
        copy.setPropertyValue(USE, job.use());
        copy.setPropertyValue(DIGEST, job.digest());
        copy.setPropertyValue(FINGERPRINT, job.fingerprint());
        copy.setPropertyValue(PURPOSE, job.purpose());
        copy.setPropertyValue(RECIPIENT, job.recipient());
        copy.setPropertyValue(USER, job.user());
        copy.setPropertyValue(TERRITORY, job.territory());
        copy.setPropertyValue(WATERMARK, job.text());
        GregorianCalendar made = new GregorianCalendar(TimeZone.getTimeZone("UTC"));
        made.setTimeInMillis(nowMillis);
        copy.setPropertyValue(MADE, made);
        copy.setPropertyValue(CONTENT, (Serializable) marked);
        return privileged.createDocument(copy);
    }

    /**
     * The folder of copies: the first below the root, or a new one, its inheritance blocked, so that
     * nothing the root grants reaches it. Two nodes making one at once make two, which is harmless:
     * a copy is found by its key wherever it is.
     */
    static DocumentModel container(CoreSession privileged) {
        DocumentModel root = privileged.getRootDocument();
        DocumentModelList found = privileged.query("SELECT * FROM " + CONTAINER_TYPE + " WHERE ecm:parentId = '"
                + root.getId() + "' AND ecm:isProxy = 0 AND ecm:isVersion = 0 AND ecm:isTrashed = 0", 1);
        if (!found.isEmpty()) {
            return found.get(0);
        }
        DocumentModel container = privileged.createDocumentModel("/", CONTAINER_NAME, CONTAINER_TYPE);
        container.setPropertyValue("dc:title", "Marked copies");
        container = privileged.createDocument(container);
        ACP acp = new ACPImpl();
        ACL local = acp.getOrCreateACL();
        local.add(ACE.BLOCK);
        privileged.setACP(container.getRef(), acp, true);
        return container;
    }

    /** The ids of the copies made from {@code source}, at most {@code limit}. */
    static List<DocumentModel> of(CoreSession privileged, String source, int limit) {
        if (source == null || !ID_FORM.matcher(source).matches()) {
            return List.of();
        }
        return privileged.query("SELECT * FROM " + TYPE + " WHERE " + SOURCE + " = '" + source
                + "' AND ecm:isProxy = 0 AND ecm:isVersion = 0", limit);
    }

    /** The ids of the copies of {@code purpose} whose file is the stored file of {@code key}. */
    static List<String> holding(CoreSession privileged, String key, MarkedVideos.Purpose purpose) {
        List<String> ids = new ArrayList<>();
        privileged.queryProjection("SELECT ecm:uuid FROM " + TYPE + " WHERE " + CONTENT + "/data = "
                + NXQL.escapeString(key) + " AND " + PURPOSE + " = " + NXQL.escapeString(purpose.code())
                + " AND ecm:isProxy = 0 AND ecm:isVersion = 0", SWEEP_LIMIT, 0)
                  .forEach(row -> ids.add((String) row.get("ecm:uuid")));
        return ids;
    }

    /**
     * The copies due to go: made before {@code before}, or under a watermark no policy in force has
     * now for their source's type, as {@code current} gives each type's fingerprint, at most
     * {@value #SWEEP_LIMIT} of each. With no {@code current}, as when the rights service is not
     * running, those made before only.
     */
    static List<String> stale(CoreSession privileged, Calendar before, Map<String, String> current) {
        List<String> ids = new ArrayList<>();
        PartialList<Map<String, Serializable>> rows = privileged.queryProjection(
                "SELECT ecm:uuid FROM " + TYPE + " WHERE " + MADE + " < TIMESTAMP '" + timestamp(before) + "'",
                SWEEP_LIMIT, 0);
        rows.forEach(row -> ids.add((String) row.get("ecm:uuid")));
        if (current == null) {
            return ids;
        }
        StringBuilder query = new StringBuilder("SELECT ecm:uuid FROM " + TYPE + " WHERE ");
        if (current.isEmpty()) {
            query.append("ecm:isProxy = 0");
        } else {
            List<String> clauses = new ArrayList<>();
            current.forEach((type, fingerprint) -> clauses.add("(" + SOURCE_TYPE + " = " + NXQL.escapeString(type)
                    + " AND " + FINGERPRINT + " = " + NXQL.escapeString(fingerprint) + ")"));
            query.append("NOT (").append(String.join(" OR ", clauses)).append(")");
        }
        privileged.queryProjection(query.toString(), SWEEP_LIMIT, 0).forEach(row -> {
            String id = (String) row.get("ecm:uuid");
            if (!ids.contains(id)) {
                ids.add(id);
            }
        });
        return ids;
    }

    /** Removes the copy {@code id}, if it is one. */
    static boolean remove(CoreSession privileged, String id) {
        if (id == null || !ID_FORM.matcher(id).matches()) {
            return false;
        }
        IdRef ref = new IdRef(id);
        if (!privileged.exists(ref) || !TYPE.equals(privileged.getDocument(ref).getType())) {
            return false;
        }
        privileged.removeDocument(ref);
        return true;
    }

    private static String timestamp(Calendar when) {
        java.time.Instant instant = when.toInstant();
        return java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
                                                 .withZone(java.time.ZoneOffset.UTC)
                                                 .format(instant);
    }

    private static String text(DocumentModel doc, String xpath) {
        return doc.getPropertyValue(xpath) instanceof String text ? text : "";
    }
}
