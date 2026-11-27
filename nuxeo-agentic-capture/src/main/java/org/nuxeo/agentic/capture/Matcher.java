/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.util.List;
import java.util.Map;

import org.nuxeo.agentic.capture.Profile.CaptureClass;
import org.nuxeo.agentic.capture.Profile.CaptureField;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.query.sql.NXQL;

/**
 * The records an item's keys match: live records of the profile's record type, under its
 * {@code recordPath} when it names one, whose property each key's {@code match} names equals the
 * key's value. Two at most are asked for, since two already means a person must choose.
 *
 * <p>Asked as the system, since whoever uploads into an inbox need not read the records: the
 * profile, a server's configuration, decides where records are looked for. Every value is quoted
 * and escaped by the platform's own NXQL escaping; the type and the properties are the profile's,
 * checked when it was registered, and never a provider's.
 */
final class Matcher {

    private Matcher() {
    }

    static List<String> match(CoreSession system, Profile profile, CaptureClass captureClass, Map<String, String> keys) {
        List<CaptureField> fields = captureClass.keys();
        if (fields.isEmpty() || keys.size() != fields.size()) {
            return List.of();
        }
        StringBuilder query = new StringBuilder("SELECT * FROM Document WHERE ecm:primaryType = '")
                                                                                                  .append(profile.recordType())
                                                                                                  .append("' AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:isTrashed = 0");
        if (profile.recordPath() != null) {
            query.append(" AND ecm:path STARTSWITH ").append(NXQL.escapeString(profile.recordPath()));
        }
        for (CaptureField field : fields) {
            String value = keys.get(field.name());
            if (value == null) {
                return List.of();
            }
            query.append(" AND ").append(field.match()).append(" = ").append(NXQL.escapeString(value));
        }
        return system.query(query.toString(), 2).stream().map(DocumentModel::getId).toList();
    }

    /** Whether {@code record} is one the profile files on: its type, live, and under its path. */
    static boolean inScope(Profile profile, DocumentModel record) {
        if (!profile.recordType().equals(record.getType()) || !Captures.isLive(record)) {
            return false;
        }
        String path = profile.recordPath();
        if (path == null) {
            return true;
        }
        String prefix = path.endsWith("/") ? path : path + "/";
        String recordPath = record.getPathAsString();
        return recordPath != null && recordPath.startsWith(prefix);
    }
}
