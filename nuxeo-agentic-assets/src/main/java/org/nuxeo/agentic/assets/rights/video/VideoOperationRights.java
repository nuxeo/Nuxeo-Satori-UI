/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.rights.video;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.stream.Collectors;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.rights.AssetRightsService;
import org.nuxeo.agentic.assets.rights.AssetRightsService.DownloadDecision;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.PartialList;
import org.nuxeo.ecm.core.api.blobholder.BlobHolder;
import org.nuxeo.ecm.core.api.model.Property;
import org.nuxeo.ecm.core.blob.ManagedBlob;
import org.nuxeo.ecm.core.query.sql.NXQL;
import org.nuxeo.ecm.core.schema.DocumentType;
import org.nuxeo.ecm.core.schema.SchemaManager;
import org.nuxeo.ecm.core.schema.TypeConstants;
import org.nuxeo.ecm.core.schema.types.ComplexType;
import org.nuxeo.ecm.core.schema.types.CompositeType;
import org.nuxeo.ecm.core.schema.types.Field;
import org.nuxeo.ecm.core.schema.types.ListType;
import org.nuxeo.ecm.core.schema.types.QName;
import org.nuxeo.ecm.core.schema.types.Schema;
import org.nuxeo.ecm.core.schema.types.Type;
import org.nuxeo.ecm.core.utils.BlobsExtractor;
import org.nuxeo.runtime.api.Framework;

/**
 * The asset's rights, asked before one of the platform's {@code Video.*} operations reads a file of
 * a document.
 *
 * <p>Each of {@code nuxeo-platform-video}'s Automation operations that takes a document reads the
 * file at its {@code xpath} parameter, or the document's main blob when it is empty, and answers
 * what it made of those bytes: a cut, its parts, a join, a watermarked copy, the captions. So the
 * file is decided as a download of it is, through {@link AssetRightsService#decideDownload} and the
 * asset's policy: the original by its channel, a transcoded video as the rendition of its
 * conversion's name, a storyboard frame as the storyboard, a picture view by its title, any other
 * place by its xpath. A use the rights do not cover is refused, 403, before the platform's
 * operation reads anything, for every user, administrators included.
 *
 * <p>A blob given as the operation's input, and the file read from a document of a type no policy
 * covers, may be a covered asset's stored file. So a blob stored in the blob store is decided for
 * each document of a covered type that holds it ({@link #checkStored}). A blob stored for none, and
 * one not stored at all, such as an upload, are not refused here.
 */
public final class VideoOperationRights {

    private static final Logger log = LogManager.getLogger(VideoOperationRights.class);

    /** Where the service is found; only a test of this package replaces it. */
    static volatile Supplier<AssetRightsService> service = () -> Framework.getService(AssetRightsService.class);

    private VideoOperationRights() {
    }

    /**
     * Refuses, with a {@link DocumentSecurityException}, an operation reading the file of
     * {@code document} at {@code xpath}, when the document's rights would refuse a download of it.
     *
     * @param operation the operation's id, for the log and the refusal
     * @param session the operation's session, from which a stored file's holders are looked for
     * @param document the document whose file the operation reads; {@code null} is the platform's
     *            to refuse
     * @param xpath the file's xpath, as the operation reads it; {@code null} or empty for the
     *            document's main blob, as its blob holder gives it
     */
    public static void check(String operation, CoreSession session, DocumentModel document, String xpath) {
        if (document == null) {
            return;
        }
        AssetRightsService rights = service.get();
        if (rights == null) {
            log.error("Asset rights: the service is not running, so {} is refused a document's file", operation);
            throw refused(operation, "policy-error");
        }
        String path = xpath == null || xpath.isEmpty() ? null : xpath;
        DownloadDecision decided;
        try {
            if (rights.policyFor(document.getType()) == null) {
                // Its file may be a covered asset's, stored once for both: decided for its holders.
                Blob read = readAsThePlatformDoes(document, path);
                if (read != null) {
                    checkStored(operation, session, read);
                }
                return;
            }
            // The main blob is read only to compare its digest with the original's, as a download
            // that names no xpath is decided.
            Blob blob = path == null ? mainBlob(document) : null;
            decided = rights.decideDownload(document, path, blob, null);
        } catch (DocumentSecurityException e) {
            throw e;
        } catch (RuntimeException e) {
            log.error("Asset rights: {} on {} could not be decided, so it is refused", operation, id(document), e);
            throw refused(operation, "policy-error");
        }
        if (decided == null || decided.decision().allowed()) {
            return;
        }
        String code = decided.decision().reason().code();
        log.info("Asset rights: refused the {} of {} ({}) to {}, through {}: {}", decided.use(), id(document),
                document.getType(), user(), operation, code);
        throw refused(operation, decided.use() + ": " + code);
    }

    /** How many documents a stored file is decided for: one held by more is refused. */
    public static final int HOLDERS_LIMIT = 100;

    /**
     * Refuses, with a {@link DocumentSecurityException}, an operation reading {@code blob} when it
     * is a file stored for a document of a type a policy covers, and that document's rights would
     * refuse a download of it at a place it holds it.
     *
     * <p>Every document of a covered type holding the blob's key in any blob field of its type's
     * schemas, or of a facet's, which a document may be given, is found with the system's rights, since the rights of an asset do not depend on who reads its
     * file, and decided at each place it holds it, as a download there is: one refusal refuses the
     * operation. The blob store keeps one file per content, so the same bytes stored for another
     * document are refused as the asset's are. Any failure refuses.
     *
     * @param session the operation's session, from which a privileged one is opened
     */
    public static void checkStored(String operation, CoreSession session, Blob blob) {
        if (!(blob instanceof ManagedBlob stored) || stored.getKey() == null) {
            return;
        }
        AssetRightsService rights = service.get();
        if (rights == null) {
            log.error("Asset rights: the service is not running, so {} is refused a stored file", operation);
            throw refused(operation, "policy-error");
        }
        String refusal;
        try {
            Set<String> types = Set.copyOf(rights.coveredTypes());
            String query = holdersQuery(types, stored.getKey());
            if (query == null) {
                return;
            }
            refusal = CoreInstance.doPrivileged(session,
                    (Function<CoreSession, String>) privileged -> decideHolders(operation, privileged, query, rights, blob,
                            stored.getKey()));
        } catch (RuntimeException e) {
            log.error("Asset rights: {} on a stored file could not be decided, so it is refused", operation, e);
            throw refused(operation, "policy-error");
        }
        if (refusal != null) {
            throw refused(operation, refusal);
        }
    }

    /**
     * Every document of {@code types} whose blob fields hold {@code key}, as one query, or
     * {@code null} when no covered type has a blob field.
     */
    public static String holdersQuery(Set<String> types, String key) {
        SchemaManager schemas = Framework.getService(SchemaManager.class);
        Set<String> covered = new TreeSet<>();
        Set<String> paths = new TreeSet<>();
        for (String type : types) {
            DocumentType documentType = schemas.getDocumentType(type);
            if (documentType != null) {
                covered.add(type);
                documentType.getSchemas().forEach(schema -> blobPaths(schema, paths));
            }
        }
        if (covered.isEmpty()) {
            return null;
        }
        // A facet added to one document brings its schemas to it, whatever its type declares.
        for (CompositeType facet : schemas.getFacets()) {
            facet.getSchemas().forEach(schema -> blobPaths(schema, paths));
        }
        if (paths.isEmpty()) {
            return null;
        }
        String literal = NXQL.escapeString(key);
        return "SELECT ecm:uuid FROM Document WHERE ecm:primaryType IN ("
                + covered.stream().map(NXQL::escapeString).collect(Collectors.joining(", ")) + ") AND ("
                + paths.stream().map(path -> path + "/data = " + literal).collect(Collectors.joining(" OR ")) + ")";
    }

    /** How deep a schema's fields are followed: deeper refuses. */
    private static final int MAX_DEPTH = 20;

    /**
     * Every blob field of {@code schema}, as a query names it: by the schema's prefix, or its name
     * for a schema with none, as {@code file:content}, each list's items as {@code *}.
     */
    static void blobPaths(Schema schema, Set<String> into) {
        for (Field field : schema.getFields()) {
            QName name = field.getName();
            String prefix = name.getPrefix();
            String top = prefix == null || prefix.isEmpty() ? schema.getName() + ":" + name.getLocalName()
                    : name.getPrefixedName();
            blobPaths(field.getType(), top, into, 0);
        }
    }

    private static void blobPaths(Type type, String path, Set<String> into, int depth) {
        if (depth > MAX_DEPTH) {
            throw new IllegalStateException("a schema nested deeper than " + MAX_DEPTH + " at " + path);
        }
        if (type.isListType()) {
            blobPaths(((ListType) type).getFieldType(), path + "/*", into, depth + 1);
        } else if (type.isComplexType()) {
            if (TypeConstants.isContentType(type)) {
                into.add(path);
                return;
            }
            for (Field field : ((ComplexType) type).getFields()) {
                blobPaths(field.getType(), path + "/" + field.getName().getLocalName(), into, depth + 1);
            }
        }
    }

    /** Decides each holder at each place it holds the key: the first refusal, said, or {@code null}. */
    private static String decideHolders(String operation, CoreSession privileged, String query, AssetRightsService rights,
            Blob blob, String key) {
        PartialList<Map<String, Serializable>> rows = privileged.queryProjection(query, HOLDERS_LIMIT + 1L, 0);
        if (rows.size() > HOLDERS_LIMIT) {
            log.error("Asset rights: {} on a file stored for more than {} assets is refused", operation, HOLDERS_LIMIT);
            return "policy-error";
        }
        for (Map<String, Serializable> row : rows) {
            DocumentModel holder = privileged.getDocument(new IdRef((String) row.get("ecm:uuid")));
            List<String> places = new ArrayList<>();
            for (Property property : new BlobsExtractor().getBlobsProperties(holder)) {
                if (property.getValue() instanceof ManagedBlob held && key.equals(held.getKey())) {
                    places.add(canonicalXpath(property));
                }
            }
            if (places.isEmpty()) {
                log.error("Asset rights: {} found {} holding a stored file at no place, so it is refused", operation,
                        id(holder));
                return "policy-error";
            }
            for (String place : places) {
                DownloadDecision decided = rights.decideDownload(holder, place, blob, null);
                if (decided != null && !decided.decision().allowed()) {
                    String code = decided.decision().reason().code();
                    log.info("Asset rights: refused the {} of {} ({}) to {}, through {} on its stored file: {}",
                            decided.use(), id(holder), holder.getType(), user(), operation, code);
                    return decided.use() + ": " + code;
                }
            }
        }
        return null;
    }

    /**
     * The property's xpath as a download names it: {@code vid:transcodedVideos/0/content}, and, for
     * a schema with no prefix, which {@link Property#getXPath} leaves out, by the schema's name, as
     * {@code file:content}.
     */
    public static String canonicalXpath(Property property) {
        // The schema's own property, whose parent is the document's part, the root.
        Property top = property;
        while (top.getParent() != null && top.getParent().getParent() != null) {
            top = top.getParent();
        }
        String xpath = property.getXPath();
        return top.getName().contains(":") ? xpath : property.getSchema().getName() + ":" + xpath;
    }

    private static DocumentSecurityException refused(String operation, String why) {
        return new DocumentSecurityException("Asset rights: " + operation + " is refused " + why);
    }

    /**
     * The file the platform's operation reads, or {@code null} when it cannot be read, which the
     * platform's operation then fails on itself.
     */
    private static Blob readAsThePlatformDoes(DocumentModel document, String path) {
        try {
            return path == null ? mainBlob(document) : (Blob) document.getPropertyValue(path);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static Blob mainBlob(DocumentModel document) {
        BlobHolder holder = document.getAdapter(BlobHolder.class);
        return holder == null ? null : holder.getBlob();
    }

    private static String id(DocumentModel document) {
        try {
            return document.getId();
        } catch (RuntimeException e) {
            return "?";
        }
    }

    private static String user() {
        try {
            NuxeoPrincipal principal = NuxeoPrincipal.getCurrent();
            return principal == null ? "?" : principal.getName();
        } catch (RuntimeException e) {
            return "?";
        }
    }
}
