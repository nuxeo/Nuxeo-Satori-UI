/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import static org.nuxeo.agentic.signature.Refusal.conflict;
import static org.nuxeo.agentic.signature.Refusal.forbidden;
import static org.nuxeo.agentic.signature.Refusal.invalid;
import static org.nuxeo.agentic.signature.Refusal.unavailable;
import static org.nuxeo.agentic.signature.Signatures.ATTACHMENT;
import static org.nuxeo.agentic.signature.Signatures.CANCELLED;
import static org.nuxeo.agentic.signature.Signatures.CANCELLED_BY;
import static org.nuxeo.agentic.signature.Signatures.COMPLETED_AT;
import static org.nuxeo.agentic.signature.Signatures.DOCUMENT;
import static org.nuxeo.agentic.signature.Signatures.DOCUMENT_ID;
import static org.nuxeo.agentic.signature.Signatures.EMAIL;
import static org.nuxeo.agentic.signature.Signatures.ENVELOPE;
import static org.nuxeo.agentic.signature.Signatures.EXTERNAL_ID;
import static org.nuxeo.agentic.signature.Signatures.FILE;
import static org.nuxeo.agentic.signature.Signatures.FILE_NAME;
import static org.nuxeo.agentic.signature.Signatures.MAIN_FILE;
import static org.nuxeo.agentic.signature.Signatures.MAX_MESSAGE;
import static org.nuxeo.agentic.signature.Signatures.MAX_NAME;
import static org.nuxeo.agentic.signature.Signatures.MAX_SIGNERS;
import static org.nuxeo.agentic.signature.Signatures.MAX_TITLE;
import static org.nuxeo.agentic.signature.Signatures.MESSAGE;
import static org.nuxeo.agentic.signature.Signatures.PROVIDER;
import static org.nuxeo.agentic.signature.Signatures.REQUESTED_AT;
import static org.nuxeo.agentic.signature.Signatures.REQUESTED_BY;
import static org.nuxeo.agentic.signature.Signatures.REQUEST_FACET;
import static org.nuxeo.agentic.signature.Signatures.REQUEST_PROPERTIES;
import static org.nuxeo.agentic.signature.Signatures.REQUEST_SCHEMA;
import static org.nuxeo.agentic.signature.Signatures.SENT;
import static org.nuxeo.agentic.signature.Signatures.SENT_DIGEST;
import static org.nuxeo.agentic.signature.Signatures.SENT_FILE_NAME;
import static org.nuxeo.agentic.signature.Signatures.SERVER_PROPERTIES;
import static org.nuxeo.agentic.signature.Signatures.SGN_COMPLETED_AT;
import static org.nuxeo.agentic.signature.Signatures.SGN_EVIDENCE;
import static org.nuxeo.agentic.signature.Signatures.SGN_FILE;
import static org.nuxeo.agentic.signature.Signatures.SGN_FILE_DIGEST;
import static org.nuxeo.agentic.signature.Signatures.SGN_REQUEST;
import static org.nuxeo.agentic.signature.Signatures.SGN_SENT_AT;
import static org.nuxeo.agentic.signature.Signatures.SGN_SIGNERS;
import static org.nuxeo.agentic.signature.Signatures.SGN_STATUS;
import static org.nuxeo.agentic.signature.Signatures.SIGNABLE_FACET;
import static org.nuxeo.agentic.signature.Signatures.SIGNABLE_PROPERTIES;
import static org.nuxeo.agentic.signature.Signatures.SIGNABLE_SCHEMA;
import static org.nuxeo.agentic.signature.Signatures.SIGNED;
import static org.nuxeo.agentic.signature.Signatures.SIGNED_VERSION;
import static org.nuxeo.agentic.signature.Signatures.SIGNERS;
import static org.nuxeo.agentic.signature.Signatures.STATUS;
import static org.nuxeo.agentic.signature.Signatures.hasControl;
import static org.nuxeo.agentic.signature.Signatures.isLive;
import static org.nuxeo.agentic.signature.Signatures.text;

import java.io.IOException;
import java.io.InputStream;
import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.UUID;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.signature.Envelope.Signer;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentNotFoundException;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.VersioningOption;
import org.nuxeo.ecm.core.api.event.CoreEventConstants;
import org.nuxeo.ecm.core.api.event.DocumentEventTypes;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.core.api.versioning.VersioningService;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.runtime.api.Framework;

/**
 * Signature requests: sent on creation, cancelled by their requester, ended by their provider's
 * callback alone ({@link CallbackEndpoint}); and the record each names, held while its file is out.
 *
 * <p>Synchronous, in the transaction of the change that fires it, as the user who makes it; every
 * refusal marks that transaction for rollback.
 *
 * <ul>
 * <li><strong>{@code aboutToCreate} of a request:</strong> it is sent. It names a live record of a
 * Signable type the requester may read and write, not out for signature already, that keeps
 * versions; one of its files, {@code file:content} or an attachment by its name, of a type and size
 * the provider takes; one to ten signers; and nothing the server writes. Then the file is sent to
 * the provider the server configures, and the request given its envelope, who sent it and when.
 * An envelope whose request does not commit is voided at the provider.</li>
 * <li><strong>{@code documentCreated} of a request:</strong> the record is marked out for signature,
 * as the requester, with where its file is and the platform's digest of it.</li>
 * <li><strong>{@code beforeDocumentModification}:</strong> a request is not changed once sent, but
 * for its cancelling, by its requester or an administrator, while it is out. A record's {@code sgn:}
 * properties are the server's, and the file out for signature is not changed, moved or removed
 * while it is out.</li>
 * <li><strong>{@code documentCreatedByCopy}:</strong> a request is not copied; a record's copy is not
 * out for signature, and its {@code sgn:} properties are emptied.</li>
 * <li><strong>{@code aboutToRemove}, {@code aboutToRemoveVersion} and {@code documentTrashed}:</strong> a request is kept, but for
 * an administrator, once it is no longer out; a record is not removed while it is out; the version
 * that holds a signed file is kept, but for an administrator.</li>
 * </ul>
 */
public class SignatureRequestListener implements EventListener {

    private static final Logger log = LogManager.getLogger(SignatureRequestListener.class);

    /**
     * How long a record's claim and a request's ending claim hold, in seconds: past any transaction,
     * so that two sends to one record, or two endings of one request, are never both let through. A
     * record's is released when its request ends.
     */
    static final long CLAIM_TTL = 86_400;

    static String openKey(String recordId) {
        return "open." + recordId;
    }

    static String endKey(String requestId) {
        return "end." + requestId;
    }

    @Override
    public void handleEvent(Event event) {
        if (!(event.getContext() instanceof DocumentEventContext context)) {
            return;
        }
        DocumentModel doc = context.getSourceDocument();
        if (doc == null) {
            return;
        }
        try {
            switch (event.getName()) {
                case DocumentEventTypes.ABOUT_TO_CREATE -> aboutToCreate(context, doc);
                case DocumentEventTypes.DOCUMENT_CREATED -> documentCreated(context, doc);
                case DocumentEventTypes.DOCUMENT_CREATED_BY_COPY -> copied(context, doc);
                case DocumentEventTypes.BEFORE_DOC_UPDATE -> beforeModification(context, doc);
                case DocumentEventTypes.ABOUT_TO_REMOVE, "aboutToRemoveVersion", "documentTrashed" -> removal(event.getName(),
                        context, doc);
                case DocumentEventTypes.BEFORE_DOC_RESTORE -> beforeRestore(doc);
                case DocumentEventTypes.DOCUMENT_RESTORED -> restored(context, doc);
                default -> {
                    // Not one of ours: the contribution lists the nine above.
                }
            }
        } catch (NuxeoException e) {
            throw Refusal.refuse(log, event, context, doc, e);
        } catch (RuntimeException e) {
            throw Refusal.refuse(log, event, context, doc,
                    new NuxeoException("E-signature: the change could not be checked, and is refused", e));
        }
    }

    // ------------------------------------------------------------------ sending

    private void aboutToCreate(DocumentEventContext context, DocumentModel doc) {
        if (doc.hasFacet(SIGNABLE_FACET) && !ServerWrite.RECORD.consumes(doc)) {
            List<String> given = SIGNABLE_PROPERTIES.stream()
                                                    .filter(p -> Stored.value(doc, SIGNABLE_SCHEMA, p) != null)
                                                    .toList();
            if (!given.isEmpty()) {
                throw invalid(String.join(", ", given) + (given.size() == 1 ? " is" : " are")
                        + " given by the server, and not by whoever creates a record");
            }
        }
        if (doc.hasFacet(REQUEST_FACET)) {
            if (!isLive(doc, REQUEST_FACET)) {
                throw invalid("A signature request is created as itself, not as a proxy or a version");
            }
            send(context, doc);
        }
    }

    /** The file a request sends: where it is on the record, and the file. */
    record FileRef(String xpath, Blob blob) {
    }

    private void send(DocumentEventContext context, DocumentModel request) {
        List<String> given = SERVER_PROPERTIES.stream()
                                              .filter(p -> Stored.value(request, REQUEST_SCHEMA, p) != null)
                                              .toList();
        if (!given.isEmpty()) {
            throw invalid(String.join(", ", given) + (given.size() == 1 ? " is" : " are")
                    + " given by the server, and not by the requester");
        }
        CoreSession session = context.getCoreSession();
        String title = text(request, "dc:title");
        if (title == null || title.length() > MAX_TITLE || hasControl(title, false)) {
            throw invalid("A signature request needs a title, what the signers are asked to sign, of " + MAX_TITLE
                    + " characters at most");
        }
        String message = text(request, MESSAGE);
        if (message != null && (message.length() > MAX_MESSAGE || hasControl(message, true))) {
            throw invalid(MESSAGE + " is " + MAX_MESSAGE + " characters at most, with no control character");
        }
        List<Signer> signers = signers(request);

        String recordId = text(request, DOCUMENT);
        if (recordId == null || !DOCUMENT_ID.matcher(recordId).matches()) {
            throw invalid("A signature request names the record to sign by its id, in " + DOCUMENT);
        }
        DocumentModel record;
        try {
            record = session.getDocument(new IdRef(recordId));
        } catch (DocumentNotFoundException e) {
            throw invalid("No document has the id " + recordId);
        } catch (DocumentSecurityException e) {
            throw forbidden("You may not read the record " + recordId);
        }
        if (!record.hasFacet(SIGNABLE_FACET)) {
            throw invalid("The record " + recordId + " is not of a type that can be sent for signature");
        }
        if (record.isProxy() || record.isVersion()) {
            throw invalid("A signature request names a live record, not a proxy or a version");
        }
        if (record.isTrashed() || session.getParentDocuments(record.getRef()).stream().anyMatch(DocumentModel::isTrashed)) {
            throw conflict("The record " + recordId + " is in the trash");
        }
        if (!record.isVersionable()) {
            throw invalid("The record " + recordId + " keeps no versions, so its signed file could not be filed as one");
        }
        if (!session.hasPermission(record.getRef(), SecurityConstants.WRITE)) {
            throw forbidden("You may not change the record " + recordId + ", so you may not send it for signature");
        }
        if (SENT.equals(text(record, SGN_STATUS))) {
            throw conflict("The record " + recordId + " is out for signature already: its request is signed, "
                    + "declined or cancelled first");
        }
        FileRef file = fileOf(record, text(request, FILE_NAME));

        SignatureService service = Framework.getService(SignatureService.class);
        String providerId = service.activeProviderId();
        SignatureProvider provider = service.provider(providerId);
        if (provider == null || !provider.configured()) {
            throw unavailable("No e-signature service is configured on this server, so nothing was sent");
        }
        String mimeType = mimeTypeOf(file.blob());
        if (mimeType == null || !provider.accepts().contains(mimeType)) {
            throw invalid("The e-signature service takes " + String.join(", ", provider.accepts()) + " files only");
        }
        byte[] content = read(file.blob(), provider.maxBytes());
        if ("application/pdf".equals(mimeType) && !startsWith(content, "%PDF-")) {
            throw invalid("The file to sign is said to be a PDF, and is not one");
        }
        String sha256 = Stored.sha256(content);
        String fileName = file.blob().getFilename() == null ? "document" : file.blob().getFilename();
        String reference = UUID.randomUUID().toString();

        // One request out per record, across the cluster: the record's sgn:status says so once this
        // commits, and the claim says so meanwhile.
        if (!service.claim(openKey(record.getId()), reference, CLAIM_TTL, true)) {
            throw conflict("The record " + recordId + " is being sent for signature at this moment");
        }
        String envelope;
        try {
            envelope = provider.send(new Envelope(reference, title, message, signers, fileName, mimeType, content,
                    sha256));
        } catch (SignatureProviderException e) {
            log.warn("E-signature: {} did not take a file for the record {}: {}", providerId, record.getId(), e.kind());
            throw unavailable("Nothing was sent: " + e.kind().sentence());
        }
        if (envelope == null || !EXTERNAL_ID.matcher(envelope).matches()) {
            log.warn("E-signature: {} answered a send with an envelope id that is not one", providerId);
            throw unavailable("Nothing was sent: " + SignatureProviderException.Kind.UNREADABLE.sentence());
        }
        // Sent, and not saved: voided at the provider, so that no one signs what the server never kept.
        String sent = envelope;
        TransactionSynchronizations.unlessCommitted(() -> voidQuietly(provider, providerId, sent));

        List<Map<String, Serializable>> written = new ArrayList<>();
        for (Signer signer : signers) {
            Map<String, Serializable> entry = new HashMap<>();
            entry.put("name", signer.name());
            entry.put("email", signer.email());
            written.add(entry);
        }
        request.setPropertyValue(SIGNERS, (Serializable) written);
        request.setPropertyValue(MESSAGE, message);
        request.setPropertyValue(DOCUMENT, record.getId());
        request.setPropertyValue(STATUS, SENT);
        request.setPropertyValue(PROVIDER, providerId);
        request.setPropertyValue(ENVELOPE, envelope);
        request.setPropertyValue(FILE, file.xpath());
        request.setPropertyValue(SENT_FILE_NAME, fileName);
        request.setPropertyValue(SENT_DIGEST, sha256);
        request.setPropertyValue(REQUESTED_BY, Refusal.actingUser(context.getPrincipal(), null));
        request.setPropertyValue(REQUESTED_AT, now());
        log.debug("E-signature: request for the record {} sent to {}, envelope {}", record.getId(), providerId,
                envelope);
    }

    private static List<Signer> signers(DocumentModel request) {
        List<Map<String, Serializable>> entries = Stored.entries(request, SIGNERS);
        if (entries.isEmpty() || entries.size() > MAX_SIGNERS) {
            throw invalid("A signature request has 1 to " + MAX_SIGNERS + " signers, each a name and an email "
                    + "address, in " + SIGNERS);
        }
        List<Signer> signers = new ArrayList<>();
        Set<String> addresses = new HashSet<>();
        for (Map<String, Serializable> entry : entries) {
            String name = trimmed(entry.get("name"));
            String email = trimmed(entry.get("email"));
            if (name == null || name.length() > MAX_NAME || hasControl(name, false)) {
                throw invalid("Each signer has a name, of " + MAX_NAME + " characters at most");
            }
            if (email == null || !EMAIL.matcher(email).matches()) {
                throw invalid("Each signer has an email address, such as name@example.com");
            }
            if (!addresses.add(email.toLowerCase(Locale.ROOT))) {
                throw invalid("A signer's email address is listed once");
            }
            signers.add(new Signer(name, email));
        }
        return signers;
    }

    private static String trimmed(Object value) {
        if (value == null) {
            return null;
        }
        String text = value.toString().trim();
        return text.isEmpty() ? null : text;
    }

    /** The file a request names: an attachment by its file name, or with none, the record's main file. */
    static FileRef fileOf(DocumentModel record, String fileName) {
        if (fileName == null) {
            Blob blob = record.hasSchema("file") ? Stored.blobAt(record, MAIN_FILE) : null;
            if (blob == null) {
                throw invalid("The record has no main file: name the attachment to send, in " + FILE_NAME);
            }
            return new FileRef(MAIN_FILE, blob);
        }
        if (fileName.length() > 255 || hasControl(fileName, false)) {
            throw invalid(FILE_NAME + " is an attachment's file name, 255 characters at most");
        }
        if (!record.hasSchema("files")) {
            throw invalid("The record has no attachments: leave " + FILE_NAME + " empty to send its main file");
        }
        List<Map<String, Serializable>> attachments = Stored.entries(record, "files:files");
        int found = -1;
        for (int i = 0; i < attachments.size(); i++) {
            if (attachments.get(i).get("file") instanceof Blob blob && fileName.equals(blob.getFilename())) {
                if (found >= 0) {
                    throw conflict("More than one of the record's attachments is named " + fileName + ": rename one");
                }
                found = i;
            }
        }
        String xpath = "files:files/" + found + "/file";
        if (found < 0 || !ATTACHMENT.matcher(xpath).matches()) {
            throw invalid("The record has no attachment named " + fileName);
        }
        return new FileRef(xpath, (Blob) attachments.get(found).get("file"));
    }

    private static String mimeTypeOf(Blob blob) {
        String type = blob.getMimeType();
        if (type == null) {
            return null;
        }
        String bare = type.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return bare.isEmpty() ? null : bare;
    }

    private static byte[] read(Blob blob, long max) {
        if (blob.getLength() > max) {
            throw invalid("The file to sign is larger than the e-signature service takes, " + max / (1024 * 1024)
                    + " MiB");
        }
        try (InputStream in = blob.getStream()) {
            byte[] bytes = in.readNBytes((int) Math.min(max + 1, Integer.MAX_VALUE - 8));
            if (bytes.length > max) {
                throw invalid("The file to sign is larger than the e-signature service takes, " + max / (1024 * 1024)
                        + " MiB");
            }
            if (bytes.length == 0) {
                throw invalid("The file to sign is empty");
            }
            return bytes;
        } catch (IOException e) {
            throw new NuxeoException("E-signature: the file to sign could not be read", e);
        }
    }

    private static boolean startsWith(byte[] content, String magic) {
        byte[] expected = magic.getBytes(StandardCharsets.US_ASCII);
        return content.length >= expected.length
                && Arrays.equals(Arrays.copyOf(content, expected.length), expected);
    }

    private static void voidQuietly(SignatureProvider provider, String providerId, String envelope) {
        try {
            provider.cancel(envelope);
            log.info("E-signature: envelope {} at {} voided: its request was not saved", envelope, providerId);
        } catch (RuntimeException e) {
            log.warn("E-signature: envelope {} at {} was not saved, and could not be voided ({}); its callback "
                    + "will be refused as unknown", envelope, providerId, e.getClass().getSimpleName());
        }
    }

    /** The record, marked out for signature, as the requester, who may write it. */
    private void documentCreated(DocumentEventContext context, DocumentModel request) {
        // Only a request this listener sent is created as sent: one given any of the server's
        // properties was refused before it was created.
        if (!isLive(request, REQUEST_FACET) || !SENT.equals(text(request, STATUS))) {
            return;
        }
        CoreSession session = context.getCoreSession();
        DocumentModel record = session.getDocument(new IdRef(text(request, DOCUMENT)));
        String xpath = text(request, FILE);
        Blob blob = Stored.blobAt(record, xpath);
        if (blob == null) {
            throw conflict("The file to sign is no longer on the record");
        }
        // Held from now on. A change committed by another transaction while the provider took the
        // file is not seen here, in this one: so filing checks the file is still the bytes sent,
        // by their SHA-256, and files the signed one beside it otherwise (CallbackEndpoint).
        List<String> names = Stored.entries(request, SIGNERS).stream().map(e -> trimmed(e.get("name"))).toList();
        record.setPropertyValue(SGN_STATUS, SENT);
        record.setPropertyValue(SGN_REQUEST, request.getId());
        record.setPropertyValue(SGN_SIGNERS, (Serializable) names);
        record.setPropertyValue(SGN_SENT_AT, request.getPropertyValue(REQUESTED_AT));
        record.setPropertyValue(SGN_COMPLETED_AT, null);
        record.setPropertyValue(SGN_FILE, xpath);
        record.setPropertyValue(SGN_FILE_DIGEST, fingerprint(blob));
        record.setPropertyValue(SGN_EVIDENCE, null);
        saveRecord(session, record);
    }

    /** A file's fingerprint as the guard compares it: its digest, length and name. */
    static String fingerprint(Blob blob) {
        Object value = Stored.normal(blob);
        return value == null ? null : value.toString();
    }

    /** A server write of a record's sgn: properties, with no version made of it. */
    static DocumentModel saveRecord(CoreSession session, DocumentModel record) {
        ServerWrite.RECORD.mark(record);
        record.putContextData(VersioningService.VERSIONING_OPTION, VersioningOption.NONE);
        DocumentModel saved = session.saveDocument(record);
        // Neither the mark nor the option outlives this write, on the model given or the one returned.
        for (DocumentModel model : List.of(record, saved)) {
            model.getContextData().remove(VersioningService.VERSIONING_OPTION);
            model.getContextData().remove(ServerWrite.KEY);
        }
        return saved;
    }

    // ------------------------------------------------------------------ copies

    private void copied(DocumentEventContext context, DocumentModel doc) {
        if (doc.hasFacet(REQUEST_FACET)) {
            throw invalid("A signature request is not copied: it is the record of one send");
        }
        if (isLive(doc, SIGNABLE_FACET) && signed(doc)) {
            unsign(context.getCoreSession(), doc);
        }
        // Nuxeo tells a copy's root only: what it holds is the folder's to check.
        if (doc.isFolder() && !doc.isProxy() && !doc.isVersion()) {
            CoreSession session = context.getCoreSession();
            if (holds(session, doc, "ecm:mixinType = '" + REQUEST_FACET + "'")) {
                throw invalid("A folder that holds signature requests is not copied: each is the record of one send");
            }
            CoreInstance.doPrivileged(session, (CoreSession system) -> {
                for (DocumentModel record : system.query(below(doc) + " AND ecm:mixinType = '" + SIGNABLE_FACET
                        + "' AND sgn:status IS NOT NULL")) {
                    unsign(system, record);
                }
            });
        }
    }

    private static boolean signed(DocumentModel doc) {
        return SIGNABLE_PROPERTIES.stream().anyMatch(p -> Stored.value(doc, SIGNABLE_SCHEMA, p) != null);
    }

    /** A copy was never sent: none of its original's signature comes with it. */
    private static void unsign(CoreSession session, DocumentModel copy) {
        for (String property : SIGNABLE_PROPERTIES) {
            copy.setPropertyValue(property, null);
        }
        saveRecord(session, copy);
    }

    /** The live documents below a folder, as NXQL: its id is a document's, which quotes nothing. */
    private static String below(DocumentModel folder) {
        String id = folder.getId();
        if (id == null || !DOCUMENT_ID.matcher(id).matches()) {
            throw new NuxeoException("E-signature: a folder with no id is not checked");
        }
        return "SELECT * FROM Document WHERE ecm:ancestorId = '" + id + "' AND ecm:isVersion = 0 AND ecm:isProxy = 0";
    }

    /** Whether a folder holds, at any depth, a document the condition finds, as the system sees it. */
    private static boolean holds(CoreSession session, DocumentModel folder, String condition) {
        String query = below(folder) + " AND " + condition;
        return CoreInstance.doPrivileged(session, (CoreSession system) -> !system.query(query, 1).isEmpty());
    }

    // ------------------------------------------------------------------ changes

    private void beforeModification(DocumentEventContext context, DocumentModel doc) {
        if (!doc.hasFacet(REQUEST_FACET) && !doc.hasFacet(SIGNABLE_FACET)
                && !(context.getProperty(CoreEventConstants.PREVIOUS_DOCUMENT_MODEL) instanceof DocumentModel)) {
            return;
        }
        DocumentModel previous = context.getProperty(CoreEventConstants.PREVIOUS_DOCUMENT_MODEL) instanceof DocumentModel p
                ? p
                : context.getCoreSession().getDocument(doc.getRef());
        for (String facet : List.of(REQUEST_FACET, SIGNABLE_FACET)) {
            if (previous.hasFacet(facet) != doc.hasFacet(facet)) {
                throw invalid("The " + facet + " facet comes with a document's type: it is not added to a document "
                        + "or removed from one");
            }
        }
        if (doc.hasFacet(REQUEST_FACET)) {
            requestChange(context, previous, doc);
        }
        if (doc.hasFacet(SIGNABLE_FACET)) {
            recordChange(previous, doc);
        }
    }

    private void requestChange(DocumentEventContext context, DocumentModel previous, DocumentModel doc) {
        if (ServerWrite.REQUEST.consumes(doc)) {
            return;
        }
        List<String> changed = new ArrayList<>(Stored.changes(previous, doc, REQUEST_SCHEMA, REQUEST_PROPERTIES));
        changed.addAll(Stored.changes(previous, doc, "dublincore", List.of("dc:title")));
        if (changed.isEmpty()) {
            return;
        }
        if (changed.equals(List.of(STATUS)) && SENT.equals(text(previous, STATUS))
                && CANCELLED.equals(text(doc, STATUS)) && isLive(doc, REQUEST_FACET)) {
            cancel(context, previous, doc);
            return;
        }
        throw invalid("A signature request is not changed once sent: " + String.join(", ", changed)
                + ". Its requester may cancel it while it is out, with " + STATUS + " " + CANCELLED);
    }

    /** Cancelled by its requester or an administrator: the record is no longer out, and the envelope voided. */
    private void cancel(DocumentEventContext context, DocumentModel previous, DocumentModel doc) {
        NuxeoPrincipal principal = context.getPrincipal();
        String user = Refusal.actingUser(principal, null);
        String requester = text(previous, REQUESTED_BY);
        if (!Refusal.isAdministrator(principal) && (user == null || !user.equals(requester))) {
            throw forbidden("Only the request's requester, " + requester + ", or an administrator cancels it");
        }
        SignatureService service = Framework.getService(SignatureService.class);
        // One ending: a callback and a cancelling at once would both find it sent.
        if (!service.claim(endKey(doc.getId()), CANCELLED, CLAIM_TTL, true)) {
            throw conflict("This request is ending at this moment");
        }
        doc.setPropertyValue(CANCELLED_BY, user);
        doc.setPropertyValue(COMPLETED_AT, now());
        String recordId = text(previous, DOCUMENT);
        String requestId = doc.getId();
        // As the system: the requester may no longer write the record, and an administrator's
        // cancelling must not depend on the record's permissions.
        CoreInstance.doPrivileged(context.getCoreSession(), (CoreSession system) -> {
            DocumentModel record = endRecord(system, recordId, requestId, CANCELLED, null);
            if (record != null) {
                saveRecord(system, record);
            }
        });
        String providerId = text(previous, PROVIDER);
        String envelope = text(previous, ENVELOPE);
        TransactionSynchronizations.whenCommitted(() -> {
            service.release(openKey(recordId));
            SignatureProvider provider = service.provider(providerId);
            if (provider != null && envelope != null) {
                voidQuietly(provider, providerId, envelope);
            }
        });
    }

    /**
     * The record's request ended: signed, declined or cancelled. Its sgn: properties say so; the
     * file is no longer held. Nothing is written when the record is gone, or names another request.
     */
    static DocumentModel endRecord(CoreSession system, String recordId, String requestId, String status,
            Blob evidence) {
        IdRef ref = new IdRef(recordId);
        if (!system.exists(ref)) {
            log.warn("E-signature: the record {} of request {} is gone; the request ends without it", recordId,
                    requestId);
            return null;
        }
        DocumentModel record = system.getDocument(ref);
        if (!requestId.equals(text(record, SGN_REQUEST))) {
            log.warn("E-signature: the record {} names another request than {}; it is left as it is", recordId,
                    requestId);
            return null;
        }
        record.setPropertyValue(SGN_STATUS, status);
        record.setPropertyValue(SGN_COMPLETED_AT, now());
        record.setPropertyValue(SGN_FILE_DIGEST, null);
        if (!SIGNED.equals(status)) {
            record.setPropertyValue(SGN_FILE, null);
        }
        record.setPropertyValue(SGN_EVIDENCE, (Serializable) evidence);
        return record;
    }

    private void recordChange(DocumentModel previous, DocumentModel doc) {
        if (ServerWrite.RECORD.consumes(doc)) {
            return;
        }
        List<String> changed = Stored.changes(previous, doc, SIGNABLE_SCHEMA, SIGNABLE_PROPERTIES);
        if (!changed.isEmpty()) {
            throw invalid(String.join(", ", changed) + (changed.size() == 1 ? " is" : " are")
                    + " given by the server, and not changed");
        }
        if (SENT.equals(text(previous, SGN_STATUS))) {
            String xpath = text(previous, SGN_FILE);
            String held = text(previous, SGN_FILE_DIGEST);
            String now = fingerprint(Stored.blobAt(doc, xpath));
            if (xpath == null || held == null || !held.equals(now)) {
                throw conflict("The file out for signature is not changed, moved or removed until its request is "
                        + "signed, declined or cancelled");
            }
        }
    }

    // ------------------------------------------------------------------ removal

    /**
     * A request, a record out for signature, and a folder holding either, are kept. Trashed, by no
     * one while out: trash is undone, so an envelope voided for it could not be. Deleted, by an
     * administrator only, the escape when a signer never answers: each envelope out below it is
     * voided once the deletion commits. Nuxeo tells a folder's removal at its root only, so the
     * folder answers for what it holds, and no child of a bulk trash is refused part way.
     */
    private void removal(String event, DocumentEventContext context, DocumentModel doc) {
        NuxeoPrincipal principal = context.getPrincipal();
        boolean trash = "documentTrashed".equals(event);
        boolean administrator = Refusal.isAdministrator(principal);
        CoreSession session = context.getCoreSession();
        if (isLive(doc, REQUEST_FACET)) {
            boolean out = SENT.equals(text(doc, STATUS));
            if (out && (trash || !administrator)) {
                throw conflict("A signature request out for signature is cancelled before it is deleted or trashed");
            }
            if (!administrator) {
                throw forbidden("A signature request is kept: only an administrator deletes or trashes one");
            }
            if (out) {
                voidOnCommit(doc);
                CoreInstance.doPrivileged(session, (CoreSession system) -> {
                    unhold(system, doc);
                });
            }
        }
        if (isLive(doc, SIGNABLE_FACET) && SENT.equals(text(doc, SGN_STATUS)) && (trash || !administrator)) {
            throw conflict("A record out for signature is not deleted or trashed: its request is cancelled first");
        }
        if (doc.isFolder() && !doc.isProxy() && !doc.isVersion()) {
            String sentRequests = "ecm:mixinType = '" + REQUEST_FACET + "' AND sigreq:status = '" + SENT + "'";
            if ((trash || !administrator) && holds(session, doc, sentRequests)) {
                throw conflict("This folder holds a signature request out for signature: it is cancelled before the "
                        + "folder is deleted or trashed");
            }
            if ((trash || !administrator)
                    && holds(session, doc, "ecm:mixinType = '" + SIGNABLE_FACET + "' AND sgn:status = '" + SENT + "'")) {
                throw conflict("This folder holds a record out for signature: its request is cancelled before the "
                        + "folder is deleted or trashed");
            }
            if (!administrator && holds(session, doc, "ecm:mixinType = '" + REQUEST_FACET + "'")) {
                throw forbidden("This folder holds signature requests, which are kept: only an administrator deletes "
                        + "or trashes it");
            }
            if (administrator && !trash) {
                CoreInstance.doPrivileged(session, (CoreSession system) -> {
                    for (DocumentModel request : system.query(below(doc) + " AND " + sentRequests)) {
                        voidOnCommit(request);
                        unhold(system, request);
                    }
                });
            }
        }
        if (doc.isVersion() && doc.hasFacet(SIGNABLE_FACET) && !Refusal.isAdministrator(principal)) {
            String requestId = text(doc, SGN_REQUEST);
            String versionId = doc.getId();
            boolean holdsSigned = requestId != null && DOCUMENT_ID.matcher(requestId).matches()
                    && CoreInstance.doPrivileged(context.getCoreSession(), (CoreSession system) -> {
                        IdRef ref = new IdRef(requestId);
                        return system.exists(ref)
                                && versionId.equals(text(system.getDocument(ref), SIGNED_VERSION));
                    });
            if (holdsSigned) {
                throw forbidden("The version that holds a signed file is kept: only an administrator deletes it");
            }
        }
    }

    /** A request deleted while out: its record no longer held, as if it had been cancelled. */
    private static void unhold(CoreSession system, DocumentModel request) {
        String recordId = text(request, DOCUMENT);
        if (recordId == null || !DOCUMENT_ID.matcher(recordId).matches()) {
            return;
        }
        DocumentModel record = endRecord(system, recordId, request.getId(), CANCELLED, null);
        if (record != null) {
            saveRecord(system, record);
        }
    }

    /** A request deleted while out: its envelope voided, and its record's claim released, once that commits. */
    private static void voidOnCommit(DocumentModel request) {
        String providerId = text(request, PROVIDER);
        String envelope = text(request, ENVELOPE);
        String recordId = text(request, DOCUMENT);
        SignatureService service = Framework.getService(SignatureService.class);
        TransactionSynchronizations.whenCommitted(() -> {
            if (recordId != null) {
                service.release(openKey(recordId));
            }
            SignatureProvider provider = service.provider(providerId);
            if (provider != null && envelope != null) {
                voidQuietly(provider, providerId, envelope);
            }
        });
    }

    // ------------------------------------------------------------------ restore

    /** A record out for signature keeps its file: it is not restored to a version, by anyone. */
    private void beforeRestore(DocumentModel doc) {
        if (isLive(doc, SIGNABLE_FACET) && SENT.equals(text(doc, SGN_STATUS))) {
            throw conflict("A record out for signature is not restored to a version: its request is cancelled first");
        }
    }

    /**
     * A record restored to a version gets that version's sgn: properties, which may say anything
     * since: so they are written again from its latest request, as the system.
     */
    private void restored(DocumentEventContext context, DocumentModel doc) {
        if (!isLive(doc, SIGNABLE_FACET)) {
            return;
        }
        String id = doc.getId();
        if (id == null || !DOCUMENT_ID.matcher(id).matches()) {
            return;
        }
        CoreInstance.doPrivileged(context.getCoreSession(), (CoreSession system) -> {
            DocumentModel record = system.getDocument(new IdRef(id));
            List<DocumentModel> latest = system.query("SELECT * FROM Document WHERE ecm:mixinType = '"
                    + REQUEST_FACET + "' AND sigreq:document = '" + id + "' AND ecm:isVersion = 0 AND ecm:isProxy = 0 "
                    + "ORDER BY sigreq:requestedAt DESC", 1);
            for (String property : SIGNABLE_PROPERTIES) {
                record.setPropertyValue(property, null);
            }
            if (!latest.isEmpty()) {
                DocumentModel request = latest.get(0);
                String status = text(request, STATUS);
                record.setPropertyValue(SGN_STATUS, status);
                record.setPropertyValue(SGN_REQUEST, request.getId());
                record.setPropertyValue(SGN_SIGNERS, (Serializable) Stored.entries(request, SIGNERS)
                                                                         .stream()
                                                                         .map(e -> trimmed(e.get("name")))
                                                                         .toList());
                record.setPropertyValue(SGN_SENT_AT, request.getPropertyValue(REQUESTED_AT));
                record.setPropertyValue(SGN_COMPLETED_AT, request.getPropertyValue(COMPLETED_AT));
                if (SIGNED.equals(status)) {
                    // The evidence is the request's, whatever the version holds; the signed file is named
                    // only where it is, by its SHA-256, which a version from before the signing has not.
                    record.setPropertyValue(SGN_EVIDENCE, request.getPropertyValue(Signatures.EVIDENCE));
                    String xpath = text(request, FILE);
                    if (CallbackEndpoint.isTheFileSent(record, xpath, text(request, Signatures.SIGNED_DIGEST),
                            64L * 1024 * 1024)) {
                        record.setPropertyValue(SGN_FILE, xpath);
                    }
                }
            }
            saveRecord(system, record);
        });
    }

    static Calendar now() {
        return Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT);
    }
}
