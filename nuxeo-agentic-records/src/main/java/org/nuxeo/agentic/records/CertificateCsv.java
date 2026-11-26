package org.nuxeo.agentic.records;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Calendar;
import java.util.HexFormat;
import java.util.List;

/**
 * A disposition certificate's CSV, written on the server: one row per record disposed of, each row
 * whole on its own, the run's facts repeated, so that a records specialist can sort and filter it
 * in a spreadsheet and any one row still says who decided and when.
 *
 * <ul>
 * <li>RFC 4180: a header row, every field in double quotes, a quote doubled, CRLF between rows.</li>
 * <li>UTF-8, with a byte order mark, which spreadsheets need to read it as UTF-8.</li>
 * <li>Times are UTC instants, ISO 8601.</li>
 * <li>A field that starts with {@code =}, {@code +}, {@code -}, {@code @}, a tab or a carriage
 * return starts with {@code '} instead, so that no spreadsheet reads a title as a formula.</li>
 * <li>{@code disposition} is each record's: {@code deleted} for an electronic record, deleted
 * permanently, and for a physical one {@code destroyed} or {@code transferred}, to
 * {@code transferred_to}, its document kept. {@code barcode} is a physical record's.</li>
 * </ul>
 */
final class CertificateCsv {

    static final List<String> HEADER = List.of("run_number", "run_started_by", "run_started_at", "approved_by_1",
            "approved_at_1", "approved_by_2", "approved_at_2", "disposed_at", "disposition", "record_uid",
            "record_path", "record_title", "record_type", "retention_rule_uid", "retention_rule_title",
            "retention_ended", "barcode", "transferred_to");

    static final byte[] BOM = { (byte) 0xEF, (byte) 0xBB, (byte) 0xBF };

    /** One approval: who, and when. */
    record Approval(String by, Calendar at) {
    }

    private CertificateCsv() {
    }

    static byte[] write(long runNumber, String startedBy, Calendar startedAt, List<Approval> approvals,
            Calendar disposedAt, List<DueRecords.Due> records) {
        StringBuilder csv = new StringBuilder();
        row(csv, HEADER);
        Approval first = approvals.size() > 0 ? approvals.get(0) : new Approval(null, null);
        Approval second = approvals.size() > 1 ? approvals.get(1) : new Approval(null, null);
        for (DueRecords.Due record : records) {
            row(csv, List.of(Long.toString(runNumber), text(startedBy), instant(startedAt), text(first.by()),
                    instant(first.at()), text(second.by()), instant(second.at()), instant(disposedAt),
                    method(record), text(record.uid()), text(record.path()), text(record.title()),
                    text(record.type()), text(record.ruleId()), text(record.ruleTitle()),
                    instant(record.retentionEnded()), text(record.barcode()), text(record.transferTo())));
        }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        bytes.writeBytes(BOM);
        bytes.writeBytes(csv.toString().getBytes(StandardCharsets.UTF_8));
        return bytes.toByteArray();
    }

    /** How a record was disposed of: deleted, destroyed or transferred. */
    static String method(DueRecords.Due record) {
        return switch (record.disposal()) {
        case Physical.DESTROY -> Physical.DESTROYED;
        case Physical.TRANSFER -> Physical.TRANSFERRED;
        default -> Disposition.METHOD;
        };
    }

    /** The methods a certificate's records were disposed of by, each once, deleted first, then destroyed, then transferred. */
    static String methods(List<DueRecords.Due> records) {
        List<String> methods = new java.util.ArrayList<>();
        for (String method : List.of(Disposition.METHOD, Physical.DESTROYED, Physical.TRANSFERRED)) {
            if (records.stream().anyMatch(record -> method.equals(method(record)))) {
                methods.add(method);
            }
        }
        return String.join(", ", methods);
    }

    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is missing from this Java", e);
        }
    }

    private static void row(StringBuilder csv, List<String> fields) {
        for (int index = 0; index < fields.size(); index++) {
            if (index > 0) {
                csv.append(',');
            }
            csv.append('"').append(field(fields.get(index)).replace("\"", "\"\"")).append('"');
        }
        csv.append("\r\n");
    }

    /** A field as written: a formula's first character neutralised. */
    static String field(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        char first = value.charAt(0);
        return first == '=' || first == '+' || first == '-' || first == '@' || first == '\t' || first == '\r'
                ? "'" + value : value;
    }

    private static String text(String value) {
        return value == null ? "" : value;
    }

    private static String instant(Calendar calendar) {
        return calendar == null ? "" : calendar.toInstant().toString();
    }
}
