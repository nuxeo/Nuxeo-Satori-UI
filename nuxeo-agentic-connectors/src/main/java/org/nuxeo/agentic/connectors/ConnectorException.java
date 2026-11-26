package org.nuxeo.agentic.connectors;

import org.nuxeo.ecm.core.api.NuxeoException;

/**
 * Why a connector gave no answer, with the HTTP status the operation fails with.
 *
 * Its message is one of the neutral sentences below, and nothing else: never the system's address,
 * the record's key, the credential, or what the system answered. Those stay on the server; the
 * log names the connector and the {@link Kind}.
 */
public class ConnectorException extends NuxeoException {

    private static final long serialVersionUID = 1L;

    public enum Kind {
        /** No connector has the id the request names. */
        UNKNOWN_CONNECTOR(404, "No connector has this id on this server"),
        /** Asked to read past the cache, by someone who is not an administrator. */
        REFRESH_NOT_ALLOWED(403, "Only an administrator may ask a connector past its cache"),
        /** Its address or credential is missing or unusable on this server. */
        NOT_CONFIGURED(503, "This connector is not configured on this server"),
        /** As many calls of the connector as it allows are already running. */
        BUSY(503, "This connector is answering as many requests as it allows; try again"),
        /** The system did not answer in time. */
        TIMEOUT(504, "The system of record did not answer in time"),
        /** The system could not be reached. */
        UNREACHABLE(502, "The system of record could not be reached"),
        /** It answered with a redirect, which is never followed. */
        REDIRECTED(502, "The system of record answered with a redirect, which is not followed"),
        /** It answered with an error status. */
        REFUSED(502, "The system of record refused the request"),
        /** Its answer was larger than the connector allows. */
        TOO_LARGE(502, "The system of record's answer is larger than this connector allows"),
        /** Its answer was not a JSON object. */
        UNREADABLE(502, "The system of record's answer could not be read");

        final int status;

        final String message;

        Kind(int status, String message) {
            this.status = status;
            this.message = message;
        }
    }

    private final Kind kind;

    public ConnectorException(Kind kind) {
        super(kind.message, kind.status);
        this.kind = kind;
    }

    public Kind getKind() {
        return kind;
    }
}
