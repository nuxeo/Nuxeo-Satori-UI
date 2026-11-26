package org.nuxeo.agentic.records;

import java.io.BufferedOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.StringWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.DigestOutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collection;
import java.util.Date;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.nuxeo.ecm.platform.audit.api.LogEntry;

import com.fasterxml.jackson.core.JsonEncoding;
import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonGenerator;

/**
 * An audit export's two files, written as the entries arrive, one at a time, so that a period of any
 * length is never held in memory: a CSV for a records specialist's spreadsheet, and a JSON file for a
 * program, with the same rows and the same columns, and each file's SHA-256 computed as it is
 * written.
 *
 * <h2>The columns</h2>
 * One row per audit entry, each whole on its own, so that a row sorted or filtered away from the
 * others still says what happened, to which record, by whom and when ({@link #COLUMNS}; the README's
 * "The audit export" says what each means).
 *
 * <h2>The CSV</h2>
 * As the certificate's: RFC 4180, every field in double quotes, a quote doubled, CRLF between rows;
 * UTF-8 with a byte order mark; times as UTC instants, ISO 8601; and a field that a spreadsheet would
 * read as a formula starts with {@code '}.
 *
 * <h2>The JSON file</h2>
 * {@code {"export": {...}, "entries": [...], "summary": {...}}}: the export's scope, period and filer
 * first; then an object per row, with the CSV's column names, numbers as numbers, {@code record_exists}
 * a boolean and {@code extended} an object; then the counts, and the CSV's SHA-256, so that the JSON
 * file vouches for the CSV.
 */
final class AuditExportFiles implements Closeable {

    /** The columns of both files, in order. */
    static final List<String> COLUMNS = List.of("entry_id", "event_date", "logged_date", "kind", "event", "what", "user",
            "record_uid", "record_path", "record_type", "record_exists", "lifecycle_state", "comment", "retain_until",
            "run_number", "run_uid", "certificate_uid", "certificate_sha256", "download_reason", "blob_xpath", "file_name",
            "category", "extended");

    /** The extended information with a column of its own: everything else is in {@code extended}. */
    static final Map<String, String> EXTENDED_COLUMNS = extendedColumns();

    private static Map<String, String> extendedColumns() {
        Map<String, String> columns = new LinkedHashMap<>();
        columns.put(RecordsAudit.RETAIN_UNTIL, "retain_until");
        columns.put(RecordsAudit.RUN_NUMBER, "run_number");
        columns.put(RecordsAudit.RUN_UID, "run_uid");
        columns.put(RecordsAudit.CERTIFICATE_UID, "certificate_uid");
        columns.put(RecordsAudit.CERTIFICATE_SHA256, "certificate_sha256");
        columns.put(RecordsAudit.DOWNLOAD_REASON, "download_reason");
        columns.put(RecordsAudit.BLOB_XPATH, "blob_xpath");
        columns.put(RecordsAudit.BLOB_FILENAME, "file_name");
        return Map.copyOf(columns);
    }

    /** The format's version, in the JSON's header: a column added, removed or renamed raises it. */
    static final int FORMAT = 1;

    private final DigestOutputStream csvDigest;

    private final DigestOutputStream jsonDigest;

    private final Writer csv;

    private final OutputStream jsonOut;

    private final JsonGenerator json;

    private long rows;

    private boolean finished;

    /** Opens both files and writes their headers: the CSV's column names, the JSON's {@code export} object. */
    AuditExportFiles(Path csvFile, Path jsonFile, Map<String, Object> header) throws IOException {
        csvDigest = new DigestOutputStream(new BufferedOutputStream(Files.newOutputStream(csvFile)), sha256());
        csvDigest.write(CertificateCsv.BOM);
        csv = new OutputStreamWriter(csvDigest, StandardCharsets.UTF_8);
        jsonDigest = new DigestOutputStream(new BufferedOutputStream(Files.newOutputStream(jsonFile)), sha256());
        jsonOut = jsonDigest;
        json = new JsonFactory().createGenerator(jsonOut, JsonEncoding.UTF8);
        row(COLUMNS);
        json.writeStartObject();
        json.writeFieldName("export");
        value(header);
        json.writeArrayFieldStart("entries");
    }

    /** One entry, in both files. */
    void write(LogEntry entry, Map<String, Object> extended, boolean exists) throws IOException {
        Map<String, Object> row = row(entry, extended, exists);
        List<String> fields = new ArrayList<>(COLUMNS.size());
        for (String column : COLUMNS) {
            fields.add(text(row.get(column)));
        }
        row(fields);
        json.writeStartObject();
        for (String column : COLUMNS) {
            json.writeFieldName(column);
            value(row.get(column));
        }
        json.writeEndObject();
        rows++;
    }

    long rows() {
        return rows;
    }

    /**
     * Ends both files: the CSV, then the JSON's summary, which names the CSV's SHA-256. Each file's
     * SHA-256, in lower-case hex: the CSV's first.
     */
    String[] finish(Map<String, Object> summary) throws IOException {
        csv.flush();
        csvDigest.flush();
        String csvSha256 = HexFormat.of().formatHex(csvDigest.getMessageDigest().digest());
        json.writeEndArray();
        Map<String, Object> all = new LinkedHashMap<>(summary);
        all.put("entries", rows);
        all.put("csv_sha256", csvSha256);
        json.writeFieldName("summary");
        value(all);
        json.writeEndObject();
        json.flush();
        jsonDigest.flush();
        String jsonSha256 = HexFormat.of().formatHex(jsonDigest.getMessageDigest().digest());
        finished = true;
        close();
        return new String[] { csvSha256, jsonSha256 };
    }

    @Override
    public void close() throws IOException {
        try {
            if (!finished) {
                json.flush();
            }
            json.close();
        } finally {
            csv.close();
        }
    }

    /** A row, by column: what the entry says, and the extended information with a column of its own taken out of the rest. */
    static Map<String, Object> row(LogEntry entry, Map<String, Object> extended, boolean exists) {
        Map<String, Object> row = new LinkedHashMap<>();
        String event = entry.getEventId();
        row.put("entry_id", entry.getId());
        row.put("event_date", entry.getEventDate());
        row.put("logged_date", entry.getLogDate());
        row.put("kind", RecordsAudit.kind(event));
        row.put("event", event);
        row.put("what", RecordsAudit.what(event));
        row.put("user", entry.getPrincipalName());
        row.put("record_uid", entry.getDocUUID());
        row.put("record_path", entry.getDocPath());
        row.put("record_type", entry.getDocType());
        row.put("record_exists", exists);
        row.put("lifecycle_state", entry.getDocLifeCycle());
        row.put("comment", entry.getComment());
        Map<String, Object> rest = new TreeMap<>(extended);
        for (Map.Entry<String, String> column : EXTENDED_COLUMNS.entrySet()) {
            row.put(column.getValue(), rest.remove(column.getKey()));
        }
        row.put("category", entry.getCategory());
        row.put("extended", rest);
        return row;
    }

    // --- The CSV ------------------------------------------------------------------------------------

    private void row(List<String> fields) throws IOException {
        for (int index = 0; index < fields.size(); index++) {
            if (index > 0) {
                csv.write(',');
            }
            csv.write('"');
            csv.write(CertificateCsv.field(fields.get(index)).replace("\"", "\"\""));
            csv.write('"');
        }
        csv.write("\r\n");
    }

    /** A value as the CSV writes it: an instant in UTC, a map as its JSON, anything else as its text. */
    static String text(Object value) {
        if (value == null) {
            return "";
        }
        if (value instanceof Date date) {
            return date.toInstant().toString();
        }
        if (value instanceof Calendar calendar) {
            return calendar.toInstant().toString();
        }
        if (value instanceof Boolean bool) {
            return bool ? "yes" : "no";
        }
        if (value instanceof Map<?, ?> map) {
            return map.isEmpty() ? "" : AuditExportFiles.toJson(map);
        }
        return String.valueOf(value);
    }

    // --- The JSON -----------------------------------------------------------------------------------

    private void value(Object value) throws IOException {
        write(json, value);
    }

    private static void write(JsonGenerator json, Object value) throws IOException {
        if (value == null) {
            json.writeNull();
        } else if (value instanceof Boolean bool) {
            json.writeBoolean(bool);
        } else if (value instanceof Long || value instanceof Integer || value instanceof Short) {
            json.writeNumber(((Number) value).longValue());
        } else if (value instanceof Number number) {
            json.writeNumber(number.doubleValue());
        } else if (value instanceof Date || value instanceof Calendar) {
            json.writeString(text(value));
        } else if (value instanceof Map<?, ?> map) {
            json.writeStartObject();
            for (Map.Entry<?, ?> entry : new TreeMap<>(stringKeys(map)).entrySet()) {
                json.writeFieldName(String.valueOf(entry.getKey()));
                write(json, entry.getValue());
            }
            json.writeEndObject();
        } else if (value instanceof Collection<?> list) {
            json.writeStartArray();
            for (Object item : list) {
                write(json, item);
            }
            json.writeEndArray();
        } else if (value instanceof Object[] array) {
            write(json, List.of(array));
        } else {
            json.writeString(String.valueOf(value));
        }
    }

    private static Map<String, Object> stringKeys(Map<?, ?> map) {
        Map<String, Object> keys = new LinkedHashMap<>();
        map.forEach((key, value) -> keys.put(String.valueOf(key), value));
        return keys;
    }

    /** A map as one line of JSON, its keys sorted: the CSV's {@code extended}. */
    static String toJson(Map<?, ?> map) {
        StringWriter out = new StringWriter();
        try (JsonGenerator generator = new JsonFactory().createGenerator(out)) {
            write(generator, map);
        } catch (IOException e) {
            throw new IllegalStateException("A map could not be written as JSON", e);
        }
        return out.toString();
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is missing from this Java", e);
        }
    }
}
