/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import static org.nuxeo.agentic.signature.Signatures.COMPLETED_AT;
import static org.nuxeo.agentic.signature.Signatures.DECLINED;
import static org.nuxeo.agentic.signature.Signatures.DECLINE_REASON;
import static org.nuxeo.agentic.signature.Signatures.DOCUMENT;
import static org.nuxeo.agentic.signature.Signatures.EVENT;
import static org.nuxeo.agentic.signature.Signatures.EVIDENCE;
import static org.nuxeo.agentic.signature.Signatures.EVIDENCE_DIGEST;
import static org.nuxeo.agentic.signature.Signatures.EXTERNAL_ID;
import static org.nuxeo.agentic.signature.Signatures.FILE;
import static org.nuxeo.agentic.signature.Signatures.MAX_REASON;
import static org.nuxeo.agentic.signature.Signatures.PROVIDER_ID;
import static org.nuxeo.agentic.signature.Signatures.REQUEST_FACET;
import static org.nuxeo.agentic.signature.Signatures.SENT;
import static org.nuxeo.agentic.signature.Signatures.SENT_FILE_NAME;
import static org.nuxeo.agentic.signature.Signatures.SIGNED;
import static org.nuxeo.agentic.signature.Signatures.SIGNED_DIGEST;
import static org.nuxeo.agentic.signature.Signatures.SIGNED_FILE;
import static org.nuxeo.agentic.signature.Signatures.SIGNED_VERSION;
import static org.nuxeo.agentic.signature.Signatures.STATUS;
import static org.nuxeo.agentic.signature.Signatures.text;

import java.io.IOException;
import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.signature.CallbackEvent.Outcome;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentModelList;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.VersioningOption;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * A provider's callback, at {@code /nuxeo/agentic-signature/callback/<provider id>}, answered with
 * no sign-in: the callback is believed only once it is authenticated, and acted on only once.
 *
 * <ol>
 * <li>{@code POST} only, to a provider registered and configured on this server; anything else is
 * 405, 404 or 503, and nothing of the body is parsed.</li>
 * <li>The body is at most {@value #MAX_BODY} bytes, refused past it unread
 * ({@link CallbackServlet}).</li>
 * <li><strong>Authenticated by the provider</strong> ({@link SignatureProvider#authenticate}): its
 * signature over the body and its time, compared in constant time. Anything else is 401, with
 * nothing said of why.</li>
 * <li><strong>Fresh:</strong> its signed time within the window of the server's, either way
 * ({@link SignatureService#callbackWindow}); a stale one is 401.</li>
 * <li><strong>Taken once:</strong> its id claimed across the cluster for twice the window, past
 * which it is stale. One whose id ended a request already is a replay, refused: nothing is done,
 * and it is answered 200, "already received", so that a provider's redelivery stops; one whose
 * first delivery is still under way is 409, retried, since that delivery may yet fail. A claim is
 * released when its callback did not end a request, so that the provider's retry of it can.</li>
 * <li><strong>Its request,</strong> by the provider and the envelope: none is 404, retried, since
 * its send may not have committed yet; one no longer out is 200, "no longer out", and nothing done;
 * one ending at this moment 409, retried.</li>
 * <li><strong>Signed:</strong> the signed file and the evidence are fetched from the provider, with
 * the server's credential, so a callback alone files nothing: the provider's own service must say
 * the envelope is signed. The signed file takes the sent file's place on the record, the evidence
 * goes on it, and it is checked in as a new major version; the request keeps both and names the
 * version. <strong>Declined:</strong> the request and the record say so, with the reason. Anything
 * else is taken, and changes nothing.</li>
 * </ol>
 *
 * Every step after authentication runs in one transaction, as the system. An answer never quotes
 * the callback, the request or the record.
 */
final class CallbackEndpoint {

    private static final Logger log = LogManager.getLogger(CallbackEndpoint.class);

    static final int MAX_BODY = 64 * 1024;

    /** The most an evidence file may be. */
    static final int MAX_EVIDENCE = 5 * 1024 * 1024;

    /** The evidence's types the add-on keeps. */
    static final List<String> EVIDENCE_TYPES = List.of("application/json", "application/pdf", "application/xml",
            "text/plain");

    /** An answer: a status and a body of a few fixed words, as JSON. */
    record Response(int status, String body) {

        byte[] bytes() {
            return body.getBytes(StandardCharsets.UTF_8);
        }
    }

    static final Response RECEIVED = new Response(200, "{\"status\":\"received\"}");

    static final Response REFUSED = new Response(401, "{\"error\":\"refused\"}");

    static final Response MALFORMED = new Response(400, "{\"error\":\"malformed\"}");

    static final Response NOT_FOUND = new Response(404, "{\"error\":\"not found\"}");

    static final Response NOT_ALLOWED = new Response(405, "{\"error\":\"method not allowed\"}");

    /**
     * A callback whose id was acted on already: refused, nothing done, and answered 2xx, so that a
     * provider redelivering one whose first answer it lost stops; a replay learns nothing from it.
     */
    static final Response ALREADY = new Response(200, "{\"status\":\"already received\"}");

    /** A request no longer out: nothing done, and 2xx, so that a late event is not retried. */
    static final Response ENDED = new Response(200, "{\"status\":\"the request is no longer out\"}");

    /** A request another callback or a cancelling is ending at this moment: 409, so that it is retried. */
    static final Response BUSY = new Response(409, "{\"error\":\"the request is ending at this moment\"}");

    /** A signed result the server does not keep: retrying cannot change it, so 422, and logged as an error. */
    static final Response UNPROCESSABLE = new Response(422, "{\"error\":\"the signed result is not one the server keeps\"}");

    static final Response TOO_LARGE = new Response(413, "{\"error\":\"too large\"}");

    static final Response PROVIDER_FAILED = new Response(502, "{\"error\":\"the provider's service failed\"}");

    static final Response UNAVAILABLE = new Response(503, "{\"error\":\"unavailable\"}");

    /** What a callback's claim holds while its first delivery is under way, and once it has ended a request. */
    static final String CLAIM_IN_HAND = "in hand";

    static final String CLAIM_DONE = "done";

    /** What ending a request came to. */
    enum Ending {
        DONE, IGNORED, UNKNOWN, ENDED, BUSY
    }

    private final SignatureService service;

    private final Clock clock;

    private final String repository;

    CallbackEndpoint(SignatureService service, Clock clock, String repository) {
        this.service = service;
        this.clock = clock;
        this.repository = repository;
    }

    /** The provider's id a path names, {@code /callback/<id>}; {@code null} for any other path. */
    static String providerOf(String pathInfo) {
        if (pathInfo == null || !pathInfo.startsWith("/callback/")) {
            return null;
        }
        String id = pathInfo.substring("/callback/".length());
        return PROVIDER_ID.matcher(id).matches() ? id : null;
    }

    Response respond(String method, String pathInfo, Map<String, String> headers, byte[] body) {
        String providerId = providerOf(pathInfo);
        if (providerId == null) {
            return NOT_FOUND;
        }
        if (!"POST".equals(method)) {
            return NOT_ALLOWED;
        }
        SignatureProvider provider = service.provider(providerId);
        if (provider == null) {
            return NOT_FOUND;
        }
        if (!provider.configured()) {
            log.info("E-signature: a callback to {}, which this server has not configured, is refused", providerId);
            return UNAVAILABLE;
        }
        CallbackEvent event;
        try {
            event = provider.authenticate(new Callback(headers, body));
        } catch (CallbackRefusedException e) {
            log.info("E-signature: a callback to {} is refused: {}", providerId, e.reason());
            return REFUSED;
        } catch (RuntimeException e) {
            log.info("E-signature: a callback to {} could not be authenticated, and is refused ({})", providerId,
                    e.getClass().getSimpleName());
            return REFUSED;
        }
        if (event == null || event.id() == null || !EXTERNAL_ID.matcher(event.id()).matches()
                || event.envelope() == null || !EXTERNAL_ID.matcher(event.envelope()).matches()
                || event.outcome() == null) {
            log.info("E-signature: an authenticated callback to {} names no callback or envelope it could", providerId);
            return MALFORMED;
        }
        Duration window = service.callbackWindow();
        Instant now = clock.instant();
        Instant at = event.timestamp();
        if (at == null || at.isBefore(now.minus(window)) || at.isAfter(now.plus(window))) {
            log.info("E-signature: a callback to {} is refused: its time is outside the {} s window", providerId,
                    window.toSeconds());
            return REFUSED;
        }
        String taken = "callback." + providerId + "." + event.id();
        long kept = window.toSeconds() * 2 + 60;
        if (!service.claim(taken, CLAIM_IN_HAND, kept, false)) {
            if (CLAIM_DONE.equals(service.claimed(taken))) {
                log.info("E-signature: callback {} to {} is refused: it was acted on already", event.id(), providerId);
                return ALREADY;
            }
            // Its first delivery is under way, and may yet fail: retried, not acknowledged.
            log.info("E-signature: callback {} to {} is refused: its first delivery is under way", event.id(),
                    providerId);
            return BUSY;
        }
        boolean keep = false;
        try {
            Ending ending = TransactionHelper.runInTransaction(
                    () -> CoreInstance.doPrivileged(repository, (CoreSession system) -> end(system, providerId,
                            provider, event)));
            keep = ending == Ending.DONE;
            if (keep) {
                // Acted on: a redelivery from now on is acknowledged, with nothing done.
                service.reclaim(taken, CLAIM_DONE, kept);
            }
            return switch (ending) {
                case DONE, IGNORED -> RECEIVED;
                case UNKNOWN -> NOT_FOUND;
                case ENDED -> ENDED;
                case BUSY -> BUSY;
            };
        } catch (SignatureProviderException e) {
            if (e.kind() == SignatureProviderException.Kind.UNACCEPTABLE) {
                log.error("E-signature: callback {} to {}: the signed result is not one the server keeps; the request "
                        + "stays out until it is cancelled", event.id(), providerId);
                return UNPROCESSABLE;
            }
            log.warn("E-signature: callback {} to {}: the provider's service failed: {}", event.id(), providerId,
                    e.kind());
            return PROVIDER_FAILED;
        } catch (RuntimeException e) {
            log.error("E-signature: callback {} to {} could not be taken ({})", event.id(), providerId,
                    e.getClass().getSimpleName());
            return UNAVAILABLE;
        } finally {
            if (!keep) {
                // Not acted on: the provider's retry may act on it.
                service.release(taken);
            }
        }
    }

    private Ending end(CoreSession system, String providerId, SignatureProvider provider, CallbackEvent event) {
        // Both are one segment of letters, digits, '.', '_' and '-': nothing in them quotes or escapes.
        DocumentModelList found = system.query("SELECT * FROM Document WHERE ecm:mixinType = '" + REQUEST_FACET
                + "' AND sigreq:provider = '" + providerId + "' AND sigreq:envelope = '" + event.envelope()
                + "' AND ecm:isVersion = 0 AND ecm:isProxy = 0", 2);
        if (found.isEmpty()) {
            log.warn("E-signature: callback {} to {} names an envelope no request has", event.id(), providerId);
            return Ending.UNKNOWN;
        }
        if (found.size() > 1) {
            log.error("E-signature: callback {} to {}: more than one request has its envelope; none is ended",
                    event.id(), providerId);
            return Ending.BUSY;
        }
        DocumentModel request = found.get(0);
        if (!SENT.equals(text(request, STATUS))) {
            log.info("E-signature: callback {} to {}: request {} is {} already", event.id(), providerId,
                    request.getId(), text(request, STATUS));
            return Ending.ENDED;
        }
        if (event.outcome() == Outcome.OTHER) {
            return Ending.IGNORED;
        }
        String status = event.outcome() == Outcome.SIGNED ? SIGNED : DECLINED;
        if (!service.claim(SignatureRequestListener.endKey(request.getId()), status,
                SignatureRequestListener.CLAIM_TTL, true)) {
            log.info("E-signature: callback {} to {}: request {} is ending at this moment", event.id(), providerId,
                    request.getId());
            return Ending.BUSY;
        }
        if (event.outcome() == Outcome.SIGNED) {
            signed(system, providerId, provider, event, request);
        } else {
            // A decline files nothing, and ends the request all the same: the service must say so too.
            if (provider.status(event.envelope()) != SignatureProvider.EnvelopeStatus.DECLINED) {
                throw new SignatureProviderException(SignatureProviderException.Kind.NOT_DECLINED);
            }
            declined(system, event, request);
        }
        String recordId = text(request, DOCUMENT);
        TransactionSynchronizations.whenCommitted(() -> service.release(SignatureRequestListener.openKey(recordId)));
        log.info("E-signature: request {} {} through {}, callback {}", request.getId(), status, providerId, event.id());
        return Ending.DONE;
    }

    private void signed(CoreSession system, String providerId, SignatureProvider provider, CallbackEvent event,
            DocumentModel request) {
        SignedResult result = provider.fetchSigned(event.envelope());
        if (result == null || result.content() == null || result.content().length == 0 || result.evidence() == null
                || result.evidence().length == 0) {
            throw new SignatureProviderException(SignatureProviderException.Kind.UNREADABLE);
        }
        if (result.content().length > provider.maxBytes() + MAX_EVIDENCE || result.evidence().length > MAX_EVIDENCE) {
            throw new SignatureProviderException(SignatureProviderException.Kind.UNACCEPTABLE);
        }
        String mimeType = bare(result.mimeType());
        if (mimeType == null || !provider.accepts().contains(mimeType)) {
            throw new SignatureProviderException(SignatureProviderException.Kind.UNACCEPTABLE);
        }
        String evidenceType = bare(result.evidenceMimeType());
        if (evidenceType == null || !EVIDENCE_TYPES.contains(evidenceType)) {
            throw new SignatureProviderException(SignatureProviderException.Kind.UNACCEPTABLE);
        }
        String sentName = text(request, SENT_FILE_NAME);
        Blob signedFile = blob(result.content(), mimeType, signedName(sentName));
        Blob evidence = blob(result.evidence(), evidenceType, fileName(result.evidenceName(), "evidence"));

        String recordId = text(request, DOCUMENT);
        String versionId = null;
        DocumentModel record = SignatureRequestListener.endRecord(system, recordId, request.getId(), SIGNED, evidence);
        if (record != null) {
            String xpath = text(request, FILE);
            String filedAt = null;
            if (system.hasLegalHold(record.getRef())) {
                // Under a legal hold, the record keeps its files as they are: the records add-on refuses
                // a change to them, whoever asks, and a refusal here would leave the callback retried for
                // ever. The signed file is kept on the request, and the record says it is signed.
                log.warn("E-signature: the record {} is under a legal hold; the signed file of request {} is kept "
                        + "on the request only", recordId, request.getId());
            } else if (isTheFileSent(record, xpath, text(request, Signatures.SENT_DIGEST), provider.maxBytes())) {
                // In its place: the record's file is still the one sent.
                record.setPropertyValue(xpath, (Serializable) signedFile);
                filedAt = xpath;
            } else if (record.hasSchema("files")) {
                // Changed since it was sent, as no one but a transaction under way while it was sent could
                // have changed it: the signed file goes beside it, and nothing is written over it.
                List<Map<String, Serializable>> files = new ArrayList<>(Stored.entries(record, "files:files"));
                Map<String, Serializable> entry = new HashMap<>();
                entry.put("file", (Serializable) signedFile);
                files.add(entry);
                record.setPropertyValue("files:files", (Serializable) files);
                filedAt = "files:files/" + (files.size() - 1) + "/file";
                log.warn("E-signature: the record {} no longer holds the file request {} sent; the signed file is "
                        + "filed beside it", recordId, request.getId());
            } else {
                log.warn("E-signature: the record {} no longer holds the file request {} sent; the signed file is "
                        + "kept on the request only", recordId, request.getId());
            }
            record.setPropertyValue(Signatures.SGN_FILE, filedAt);
            SignatureRequestListener.saveRecord(system, record);
            if (filedAt != null) {
                DocumentRef version = system.checkIn(record.getRef(), VersioningOption.MAJOR,
                        "Signed through the e-signature service " + providerId + ", envelope " + event.envelope());
                versionId = version.reference().toString();
            }
        }
        request.setPropertyValue(STATUS, SIGNED);
        request.setPropertyValue(COMPLETED_AT, SignatureRequestListener.now());
        request.setPropertyValue(SIGNED_FILE, (Serializable) signedFile);
        request.setPropertyValue(SIGNED_DIGEST, Stored.sha256(result.content()));
        request.setPropertyValue(EVIDENCE, (Serializable) evidence);
        request.setPropertyValue(EVIDENCE_DIGEST, Stored.sha256(result.evidence()));
        request.setPropertyValue(SIGNED_VERSION, versionId);
        request.setPropertyValue(EVENT, event.id());
        ServerWrite.REQUEST.mark(request);
        system.saveDocument(request);
    }

    private void declined(CoreSession system, CallbackEvent event, DocumentModel request) {
        request.setPropertyValue(STATUS, DECLINED);
        request.setPropertyValue(COMPLETED_AT, SignatureRequestListener.now());
        request.setPropertyValue(DECLINE_REASON, reason(event.reason()));
        request.setPropertyValue(EVENT, event.id());
        ServerWrite.REQUEST.mark(request);
        system.saveDocument(request);
        DocumentModel record = SignatureRequestListener.endRecord(system, text(request, DOCUMENT), request.getId(),
                DECLINED, null);
        if (record != null) {
            SignatureRequestListener.saveRecord(system, record);
        }
    }

    /** Whether the record's file at {@code xpath} is the bytes sent, by their SHA-256, read no further than the bound. */
    static boolean isTheFileSent(DocumentModel record, String xpath, String sentDigest, long maxBytes) {
        Blob current = Stored.blobAt(record, xpath);
        if (current == null || sentDigest == null || current.getLength() > maxBytes) {
            return false;
        }
        try (java.io.InputStream in = current.getStream()) {
            byte[] bytes = in.readNBytes((int) Math.min(maxBytes + 1, Integer.MAX_VALUE - 8));
            return bytes.length <= maxBytes && Stored.sha256(bytes).equals(sentDigest);
        } catch (IOException e) {
            throw new NuxeoException("E-signature: the record's file could not be read", e);
        }
    }

    /** A decline's reason as kept: control characters but line breaks dropped, and cut at {@value Signatures#MAX_REASON}. */
    static String reason(String reason) {
        if (reason == null) {
            return null;
        }
        StringBuilder kept = new StringBuilder();
        reason.codePoints()
              .filter(c -> !Signatures.hasControl(new String(Character.toChars(c)), true))
              .limit(MAX_REASON)
              .forEach(kept::appendCodePoint);
        String text = kept.toString().trim();
        return text.isEmpty() ? null : text;
    }

    private static String bare(String mimeType) {
        if (mimeType == null) {
            return null;
        }
        String bare = mimeType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return bare.isEmpty() ? null : bare;
    }

    /** {@code agreement.pdf} as {@code agreement-signed.pdf}. */
    static String signedName(String sentName) {
        String name = fileName(sentName, "document.pdf");
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) + "-signed" + name.substring(dot) : name + "-signed";
    }

    /** A file name as kept: its last path segment, with no control character, 200 characters at most. */
    static String fileName(String name, String otherwise) {
        if (name == null) {
            return otherwise;
        }
        String last = name.substring(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1).trim();
        if (last.isEmpty() || last.equals(".") || last.equals("..") || Signatures.hasControl(last, false)) {
            return otherwise;
        }
        return last.length() > 200 ? last.substring(last.length() - 200) : last;
    }

    private static Blob blob(byte[] content, String mimeType, String name) {
        try {
            Blob blob = Blobs.createBlob(content, mimeType);
            blob.setFilename(name);
            return blob;
        } catch (IOException e) {
            throw new NuxeoException("E-signature: the signed file could not be kept", e);
        }
    }
}
