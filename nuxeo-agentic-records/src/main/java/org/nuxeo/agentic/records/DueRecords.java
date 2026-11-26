package org.nuxeo.agentic.records;

import static org.nuxeo.agentic.records.Disposition.RECORD_FACET;
import static org.nuxeo.agentic.records.Disposition.RECORD_RETAIN_UNTIL;
import static org.nuxeo.agentic.records.Disposition.RECORD_RULE_IDS;
import static org.nuxeo.agentic.records.Disposition.RULE_END_ACTIONS;
import static org.nuxeo.agentic.records.Disposition.RULE_FACET;

import java.io.Serializable;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentModelList;
import org.nuxeo.ecm.core.api.IdRef;

/**
 * The records due for disposition, and why a record is not, as the platform's retention module and
 * the repository say it. A record is due when all of these hold:
 * <ul>
 * <li>it is a record of the retention module's: the {@code Record} facet, and a record to the
 * repository ({@code isRecord});</li>
 * <li>its retention has ended: the repository no longer holds it under retention, and the module
 * saved the day it ended, {@code record:retainUntil}, which is past;</li>
 * <li>it is under no legal hold;</li>
 * <li>its rule, the first of {@code record:ruleIds}, can be read, and has no end action. A rule
 * with one, {@code Document.Delete} or {@code Document.Trash}, disposes of its records itself when
 * their retention ends, with no review: those records are never a run's;</li>
 * <li>it is the live document: not a version, not a proxy;</li>
 * <li>it is a document, not a folder, since deleting a folder deletes what it holds, and none of the
 * add-on's own documents, a certificate made a record among them;</li>
 * <li>for a physical record: it is in its location, not checked out, and has not been disposed of
 * already, and a run can take its disposition action, destroy or transfer.</li>
 * </ul>
 * A record in the trash is still a record, and is due as any other: the trash is not a disposition.
 * A run finds them with its starter's session, so it holds only records its starter may read. Each
 * is checked again, with the add-on's, when the run is disposed of.
 */
final class DueRecords {

    /**
     * One record of a run: what the certificate says of it. {@code disposal} is what the run does
     * with it: {@code delete}, an electronic record's, or a physical record's {@code destroy} or
     * {@code transfer}, to {@code transferTo}; {@code barcode} is a physical record's.
     */
    record Due(String uid, String path, String title, String type, String ruleId, String ruleTitle,
            Calendar retentionEnded, String barcode, String disposal, String transferTo) {

        /** Whether it is a physical record, which a run does not delete. */
        boolean physical() {
            return !Physical.DELETE.equals(disposal);
        }
    }

    /** How many candidates the query returns at a time, and how many a start reads at most. */
    static final int PAGE = 100;

    static final int SCAN = 5000;

    /** A document id as the repository writes them. */
    static final Pattern ID = Pattern.compile("[0-9A-Za-z][0-9A-Za-z-]{0,63}");

    private DueRecords() {
    }

    /**
     * The records due, oldest retention end first, that {@code held} does not hold already, at
     * most {@code max}. {@code reader} is the starter's session; {@code privileged} reads the rules.
     */
    static List<Due> find(CoreSession reader, CoreSession privileged, Set<String> held, int max, Instant now) {
        String query = candidates(now);
        List<Due> due = new ArrayList<>();
        for (long offset = 0; offset < SCAN && due.size() < max; offset += PAGE) {
            DocumentModelList page = reader.query(query, null, PAGE, offset, false);
            for (DocumentModel candidate : page) {
                if (due.size() >= max) {
                    break;
                }
                if (held.contains(candidate.getId()) || why(candidate, privileged, now) != null) {
                    continue;
                }
                due.add(of(candidate, privileged));
            }
            if (page.size() < PAGE) {
                break;
            }
        }
        return due;
    }

    /**
     * The query a start reads its candidates with, oldest retention end first. A physical record
     * disposed of already is none: it is kept, and its retention ended long ago, so that otherwise it
     * would come first in every scan and, once there were {@value #SCAN} of them, hide every record due.
     */
    static String candidates(Instant now) {
        return "SELECT * FROM Document WHERE ecm:mixinType = '" + RECORD_FACET + "' AND ecm:isRecord = 1"
                + " AND ecm:mixinType <> 'Folderish' AND ecm:primaryType NOT IN ('" + String.join("', '", ownTypes())
                + "') AND ecm:isProxy = 0 AND ecm:isVersion = 0 AND " + RECORD_RETAIN_UNTIL + " < TIMESTAMP '"
                + now.truncatedTo(ChronoUnit.MILLIS) + "' AND " + Physical.DISPOSED_AT + " IS NULL ORDER BY "
                + RECORD_RETAIN_UNTIL + ", ecm:uuid";
    }

    /** The add-on's own types, which no run holds, in order. */
    static List<String> ownTypes() {
        TreeSet<String> types = new TreeSet<>(Disposition.TYPES);
        types.addAll(Physical.NEVER_DUE);
        return List.copyOf(types);
    }

    /** Why {@code doc} is not due, in a phrase that follows "It", or {@code null} when it is. */
    static String why(DocumentModel doc, CoreSession privileged, Instant now) {
        if (doc.isVersion() || doc.isProxy()) {
            return "is a version or a proxy, not a record itself";
        }
        if (Disposition.TYPES.contains(doc.getType()) || Physical.NEVER_DUE.contains(doc.getType())) {
            return "is one of the disposition review's own documents";
        }
        // Deleting a folder deletes what it holds, which no one reviewed: a run holds documents alone.
        if (doc.isFolder()) {
            return "is a folder, whose contents a run does not review";
        }
        // A document that is no folder may still hold others, which its deletion would take with it,
        // unlisted, those its starter cannot read among them: read with the add-on's session.
        if (privileged.hasChildren(doc.getRef())) {
            return "holds other documents, which a run does not review";
        }
        if (!doc.hasFacet(RECORD_FACET) || !doc.isRecord()) {
            return "is not a record of the retention module's";
        }
        if (doc.hasLegalHold()) {
            return "is under a legal hold";
        }
        String physical = PhysicalRecords.whyNotDue(doc);
        if (physical != null) {
            return physical;
        }
        Calendar until = doc.getRetainUntil();
        if (doc.isUnderRetentionOrLegalHold() || until != null && !until.toInstant().isBefore(now)) {
            return "is under retention";
        }
        Calendar ended = ended(doc);
        if (ended == null || !ended.toInstant().isBefore(now)) {
            return "has no retention that has ended";
        }
        String ruleId = ruleId(doc);
        if (ruleId == null) {
            return "has no retention rule";
        }
        DocumentModel rule = rule(privileged, ruleId);
        if (rule == null) {
            return "has a retention rule that cannot be read";
        }
        if (!endActions(rule).isEmpty()) {
            return "has a retention rule that disposes of its records itself";
        }
        return null;
    }

    /** What a run says of a due record. */
    static Due of(DocumentModel doc, CoreSession privileged) {
        String ruleId = ruleId(doc);
        DocumentModel rule = ruleId == null ? null : rule(privileged, ruleId);
        boolean physical = Physical.RECORD_TYPE.equals(doc.getType());
        String disposal = physical ? PhysicalRecords.disposalOf(doc) : Physical.DELETE;
        return new Due(doc.getId(), doc.getPathAsString(), title(doc), doc.getType(), ruleId,
                rule == null ? null : title(rule), ended(doc),
                physical ? text(doc, Physical.BARCODE) : null, disposal,
                Physical.TRANSFER.equals(disposal) ? text(doc, Physical.TRANSFER_TO) : null);
    }

    /**
     * Whether a run's row says what the record says now: the same disposition action, and for a
     * transfer the same recipient. A row of a run started before physical records says none, and
     * was a deletion.
     */
    static boolean sameDisposal(java.util.Map<String, Serializable> row, Due now) {
        Object disposal = row.get("disposal");
        String was = disposal instanceof String text && !text.isEmpty() ? text : Physical.DELETE;
        Object transferTo = row.get("transferTo");
        String wasTo = transferTo instanceof String text && !text.isEmpty() ? text : null;
        return was.equals(now.disposal()) && java.util.Objects.equals(wasTo, now.transferTo());
    }

    private static String text(DocumentModel doc, String xpath) {
        return doc.getPropertyValue(xpath) instanceof String value && !value.isBlank() ? value : null;
    }

    /** The first of the record's rules, or {@code null}. */
    static String ruleId(DocumentModel doc) {
        Serializable value = doc.getPropertyValue(RECORD_RULE_IDS);
        Object first = null;
        if (value instanceof Object[] array && array.length > 0) {
            first = array[0];
        } else if (value instanceof List<?> list && !list.isEmpty()) {
            first = list.get(0);
        }
        return first instanceof String id && ID.matcher(id).matches() ? id : null;
    }

    static Calendar ended(DocumentModel doc) {
        return doc.getPropertyValue(RECORD_RETAIN_UNTIL) instanceof Calendar calendar ? calendar : null;
    }

    /** The rule, read with the add-on's session, or {@code null} when it is gone or not a rule. */
    static DocumentModel rule(CoreSession privileged, String ruleId) {
        IdRef ref = new IdRef(ruleId);
        if (!privileged.exists(ref)) {
            return null;
        }
        DocumentModel rule = privileged.getDocument(ref);
        return rule.hasFacet(RULE_FACET) ? rule : null;
    }

    static List<String> endActions(DocumentModel rule) {
        Serializable value = rule.getPropertyValue(RULE_END_ACTIONS);
        List<String> actions = new ArrayList<>();
        if (value instanceof Object[] array) {
            for (Object action : array) {
                if (action instanceof String text && !text.isBlank()) {
                    actions.add(text);
                }
            }
        } else if (value instanceof Collection<?> list) {
            for (Object action : list) {
                if (action instanceof String text && !text.isBlank()) {
                    actions.add(text);
                }
            }
        }
        return actions;
    }

    static String title(DocumentModel doc) {
        String title = doc.getTitle();
        return title == null || title.isBlank() ? doc.getName() : title;
    }
}
