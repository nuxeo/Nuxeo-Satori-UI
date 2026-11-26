package org.nuxeo.agentic.records;

import java.util.Set;

import org.nuxeo.runtime.api.Framework;

/** The disposition review's names: its types, permissions, states and properties, and the retention module's it reads. */
final class Disposition {

    // --- The add-on's types -------------------------------------------------------------------------

    static final String RUNS_TYPE = "DispositionRuns";

    static final String RUN_TYPE = "DispositionRun";

    static final String REQUEST_TYPE = "DispositionRequest";

    static final String CERTIFICATE_TYPE = "DispositionCertificate";

    /** An audit export, filed by a person in the same folder: what happened to a folder's records over a period. */
    static final String EXPORT_TYPE = "RecordsAuditExport";

    static final Set<String> TYPES = Set.of(RUNS_TYPE, RUN_TYPE, REQUEST_TYPE, CERTIFICATE_TYPE, EXPORT_TYPE);

    /** The schemas no one but the add-on writes, by type. */
    static final String RUNS_SCHEMA = "disposition_runs";

    static final String RUN_SCHEMA = "disposition_run";

    static final String REQUEST_SCHEMA = "disposition_request";

    static final String CERTIFICATE_SCHEMA = "disposition_certificate";

    static final String EXPORT_SCHEMA = "records_audit_export";

    // --- Its permissions ----------------------------------------------------------------------------

    static final String START_PERMISSION = "StartDisposition";

    static final String APPROVE_PERMISSION = "ApproveDisposition";

    /** Filing an audit export in the folder: a strong permission, for the few records specialists. */
    static final String EXPORT_PERMISSION = "ExportRecordsAudit";

    /** How many different people approve a run before it is disposed of, none of them its starter. */
    static final int APPROVALS_REQUIRED = 2;

    // --- A request's actions, a run's states, and what a request came to -----------------------------

    static final String PENDING = "pending";

    static final String DISPOSED = "disposed";

    static final String HALTED = "halted";

    static final String REJECTED = "rejected";

    static final String STARTED = "started";

    static final String APPROVED = "approved";

    static final String START = "start";

    static final String APPROVE = "approve";

    static final String REJECT = "reject";

    /** A record's status in a run. */
    static final String AWAITING = "awaiting";

    static final String KEPT = "kept";

    static final String REFUSED = "refused";

    /** How a certificate's records were disposed of: deleted, permanently (README, "Trash or delete"). */
    static final String METHOD = "deleted";

    // --- The properties -----------------------------------------------------------------------------

    static final String SEQUENCE = "druns:sequence";

    static final String RUN_NUMBER = "drun:number";

    static final String RUN_STATE = "drun:state";

    static final String RUN_STARTED_BY = "drun:startedBy";

    static final String RUN_STARTED_AT = "drun:startedAt";

    static final String RUN_RECORD_COUNT = "drun:recordCount";

    static final String RUN_RECORDS = "drun:records";

    static final String RUN_APPROVALS = "drun:approvals";

    static final String RUN_CLOSED_BY = "drun:closedBy";

    static final String RUN_CLOSED_AT = "drun:closedAt";

    static final String RUN_HALT_REASON = "drun:haltReason";

    static final String RUN_CERTIFICATE = "drun:certificate";

    static final String RUN_CERTIFICATE_SHA256 = "drun:certificateSha256";

    static final String REQUEST_ACTION = "dreq:action";

    static final String REQUEST_RUN = "dreq:run";

    static final String REQUEST_COMMENT = "dreq:comment";

    static final String REQUEST_BY = "dreq:by";

    static final String REQUEST_AT = "dreq:at";

    static final String REQUEST_RUN_NUMBER = "dreq:runNumber";

    static final String REQUEST_OUTCOME = "dreq:outcome";

    static final String CERT_RUN = "dcert:run";

    static final String CERT_RUN_NUMBER = "dcert:runNumber";

    static final String CERT_STARTED_BY = "dcert:startedBy";

    static final String CERT_STARTED_AT = "dcert:startedAt";

    static final String CERT_APPROVALS = "dcert:approvals";

    static final String CERT_DISPOSED_AT = "dcert:disposedAt";

    static final String CERT_METHOD = "dcert:method";

    static final String CERT_RECORD_COUNT = "dcert:recordCount";

    static final String CERT_RECORDS = "dcert:records";

    static final String CERT_SHA256 = "dcert:sha256";

    static final String FILE_CONTENT = "file:content";

    /** The attachments, where an export keeps its JSON beside its CSV. */
    static final String FILES = "files:files";

    static final String TITLE = "dc:title";

    // An audit export's: the filer writes the scope, the period and a comment; the server the rest.

    static final String EXPORT_PATH = "rexp:path";

    static final String EXPORT_FROM = "rexp:from";

    static final String EXPORT_TO = "rexp:to";

    static final String EXPORT_COMMENT = "rexp:comment";

    static final String EXPORT_BY = "rexp:by";

    static final String EXPORT_AT = "rexp:at";

    static final String EXPORT_STATE = "rexp:state";

    static final String EXPORT_GENERATED_AT = "rexp:generatedAt";

    static final String EXPORT_ENTRY_COUNT = "rexp:entryCount";

    static final String EXPORT_OMITTED_COUNT = "rexp:omittedCount";

    static final String EXPORT_CSV_SHA256 = "rexp:csvSha256";

    static final String EXPORT_JSON_SHA256 = "rexp:jsonSha256";

    static final String EXPORT_FAILURE = "rexp:failure";

    /** An export's states: written in the background once filed, then done, or failed with nothing kept. */
    static final String EXPORT_PENDING = "pending";

    static final String EXPORT_DONE = "done";

    static final String EXPORT_FAILED = "failed";

    /** A request's comment, at most. */
    static final int MAX_COMMENT = 2000;

    // --- The retention module's (nuxeo-retention), read and never written -----------------------------

    /** The facet the module gives a document it attaches a rule to. */
    static final String RECORD_FACET = "Record";

    /** The rules the module attached, by document id. */
    static final String RECORD_RULE_IDS = "record:ruleIds";

    /** When the record's retention ended: the module saves it when the platform ends the retention. */
    static final String RECORD_RETAIN_UNTIL = "record:retainUntil";

    static final String RULE_FACET = "RetentionRule";

    /** What the rule does itself once retention ends: Document.Delete or Document.Trash. */
    static final String RULE_END_ACTIONS = "retention_def:endActions";

    // --- Settings -----------------------------------------------------------------------------------

    /** The most records one run holds, so that its disposal is one transaction of a bounded size. */
    static final String MAX_RECORDS_PROPERTY = "nuxeo.agentic.records.disposition.maxRecords";

    static final int DEFAULT_MAX_RECORDS = 200;

    static final int LIMIT_MAX_RECORDS = 1000;

    /** The key of the cluster's lock every request is handled in. */
    static final String LOCK_KEY = "agentic-records-disposition";

    static int maxRecords() {
        String value = Framework.getProperty(MAX_RECORDS_PROPERTY);
        if (value == null || value.isBlank()) {
            return DEFAULT_MAX_RECORDS;
        }
        try {
            int max = Integer.parseInt(value.trim());
            return max < 1 || max > LIMIT_MAX_RECORDS ? DEFAULT_MAX_RECORDS : max;
        } catch (NumberFormatException e) {
            return DEFAULT_MAX_RECORDS;
        }
    }

    private Disposition() {
    }
}
