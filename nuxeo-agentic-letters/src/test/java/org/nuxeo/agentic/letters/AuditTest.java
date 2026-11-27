/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import javax.inject.Inject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.query.sql.model.OrderByExprs;
import org.nuxeo.ecm.core.query.sql.model.Predicates;
import org.nuxeo.ecm.core.query.sql.model.QueryBuilder;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.test.runner.TransactionalFeature;

/**
 * Each letter in its record's history: an entry of the platform's audit, {@code letterGenerated},
 * category {@code Letters}, on the record, by its writer, naming the letter, its template and its
 * language and why that one. A refused letter writes none.
 */
@RunWith(FeaturesRunner.class)
@Features({ LettersFeature.class, LettersAuditFeature.class })
public class AuditTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected TransactionalFeature txFeature;

    protected String repository;

    protected String claim;

    @Before
    public void setUp() {
        repository = session.getRepositoryName();
        Office.create(session);
        String member = Office.member(repository, Office.MEMBERS, "maria", "Maria", "Lopez", "Oakland");
        claim = Office.claim(repository, "CLM-6001", "denied", member, "es");
        Office.template(repository, "test-denial-en", Office.DENIAL, "en", Office.DENIAL_EN);
        Office.template(repository, "test-denial-es", Office.DENIAL, "es", Office.DENIAL_ES);
    }

    private static List<LogEntry> entries(String id) {
        QueryBuilder query = new QueryBuilder();
        query.predicate(Predicates.eq("eventId", LetterAudit.EVENT));
        query.and(Predicates.eq("docUUID", id));
        query.order(OrderByExprs.asc("id"));
        List<LogEntry> entries = new ArrayList<>();
        for (Object entry : AuditAccess.reader().queryLogs(query)) {
            entries.add((LogEntry) entry);
        }
        return entries;
    }

    private void audited() {
        session.save();
        txFeature.nextTransaction();
    }

    @Test
    public void eachLetterIsAuditedOnItsRecord() {
        DocumentModel spanish = Office.generate(repository, Office.ALICE, claim, Office.DENIAL, null);
        DocumentModel english = Office.generate(repository, Office.ALICE, claim, Office.DENIAL, "en");
        audited();

        List<LogEntry> entries = entries(claim);
        assertEquals(2, entries.size());
        for (LogEntry entry : entries) {
            assertEquals(Office.ALICE, entry.getPrincipalName());
            assertEquals(LetterAudit.CATEGORY, entry.getCategory());
            assertEquals("TestClaim", entry.getDocType());
            assertEquals(claim, entry.getDocUUID());
        }
        Map<String, Object> first = AuditAccess.extended(entries.get(0));
        assertEquals(Office.DENIAL, first.get(LetterAudit.LETTER));
        assertEquals(spanish.getId(), first.get(LetterAudit.LETTER_ID));
        assertEquals("test-denial-es", first.get(LetterAudit.TEMPLATE_NAME));
        assertEquals("es", first.get(LetterAudit.LANGUAGE));
        assertEquals(LetterAudit.RECORDS, first.get(LetterAudit.LANGUAGE_FROM));
        assertEquals(Office.ALICE, first.get(LetterAudit.BY));
        assertEquals("alice wrote the letter test.denial, " + spanish.getId()
                + ", from the template test-denial-es, in es, the record's language", entries.get(0).getComment());
        Map<String, Object> second = AuditAccess.extended(entries.get(1));
        assertEquals(english.getId(), second.get(LetterAudit.LETTER_ID));
        assertEquals("en", second.get(LetterAudit.LANGUAGE));
        assertEquals(LetterAudit.CHOSEN, second.get(LetterAudit.LANGUAGE_FROM));
        assertTrue(entries.get(1).getComment(), entries.get(1).getComment().endsWith("in en, as chosen"));
    }

    @Test
    public void aRefusedLetterIsNotAudited() {
        Office.refusedGenerate(repository, Office.BOB, claim, Office.DENIAL, null);
        Office.refusedGenerate(repository, Office.ALICE, claim, Office.DENIAL, "sv");
        Office.refusedGenerate(repository, Office.ALICE, claim, "test.unknown", null);
        audited();
        assertTrue(entries(claim).isEmpty());
        // And the next one is.
        Office.generate(repository, Office.ALICE, claim, Office.DENIAL, null);
        audited();
        assertEquals(1, entries(claim).size());
    }
}
