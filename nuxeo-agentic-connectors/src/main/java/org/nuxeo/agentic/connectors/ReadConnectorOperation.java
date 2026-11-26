package org.nuxeo.agentic.connectors;

import org.nuxeo.ecm.automation.core.annotations.Context;
import org.nuxeo.ecm.automation.core.annotations.Operation;
import org.nuxeo.ecm.automation.core.annotations.OperationMethod;
import org.nuxeo.ecm.automation.core.annotations.Param;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * {@code Connector.Read}: one record from a system of record, for the input document.
 *
 * <pre>
 * POST /nuxeo/api/v1/automation/Connector.Read
 * { "input": "&lt;document id&gt;", "params": { "connector": "payers.claimPayments" } }
 * </pre>
 *
 * The request names a document and a connector, and nothing else: the address, the path, the key's
 * property, the fields and the credential are the connector's, from the server's configuration, and
 * so is how long an answer is kept. The answer is {@link ConnectorAnswer#toJson}, as
 * {@code application/json}, with its {@code age}. Automation reads the input document as the user, and
 * {@link ConnectorService#read} then checks the connector's own permission on it before anything is
 * sent or given from the cache.
 *
 * <p>{@code "refresh": true} reads past the cache, as {@code Cache-Control: no-cache} asks of an HTTP
 * cache: the system is asked, and its answer kept. It is an administrator's only; anyone else's is
 * refused with 403, so that no reader can make every card they draw a call.
 */
@Operation(id = ReadConnectorOperation.ID, category = "Connectors", label = "Read from a system of record",
        description = "Reads one record from a system of record by the key the input document holds, as the "
                + "connector named by the 'connector' parameter defines it, after checking the user's permission on "
                + "the document. Returns the connector's allowed fields as JSON, from the server's cache when it "
                + "keeps the connector's answers. 'refresh', for administrators only, asks the system again.")
public class ReadConnectorOperation {

    public static final String ID = "Connector.Read";

    @Context
    protected CoreSession session;

    @Context
    protected ConnectorService connectors;

    @Param(name = "connector", description = "The id of a connector registered on the server")
    protected String connector;

    @Param(name = "refresh", required = false, description = "Administrators only: ask the system of record "
            + "again rather than answer from the cache")
    protected boolean refresh;

    @OperationMethod
    public Blob run(DocumentModel document) {
        return Blobs.createJSONBlob(connectors.read(session, document, connector, refresh).toJson());
    }
}
