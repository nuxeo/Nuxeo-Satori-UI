/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import java.io.IOException;
import java.io.Serializable;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Supplier;

import org.nuxeo.ecm.automation.AutomationService;
import org.nuxeo.ecm.automation.OperationContext;
import org.nuxeo.ecm.automation.OperationException;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.impl.UserPrincipal;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * The repository the tests work in, the people who work in it, and the templates an administrator
 * keeps there.
 *
 * <pre>
 * /office             inheritance blocked: alice ReadWrite, bob and dave Read, carol nothing
 *   /office/claims    the records; one of them, dave's, with ReadWrite for dave on itself alone
 *   /office/members   the members the claims name
 *   /office/sealed    inheritance blocked: the administrator's alone, a member no one else reads
 *   /office/templates the letter templates, which the administrator writes
 * </pre>
 *
 * So alice may write a letter on a claim; bob may read the claim and may not write one; dave may
 * write his claim and may add nothing to its folder; carol may read nothing.
 */
final class Office {

    static final String ALICE = "alice";

    static final String BOB = "bob";

    static final String CAROL = "carol";

    static final String DAVE = "dave";

    static final String ADMINISTRATOR = "Administrator";

    static final String CLAIMS = "/office/claims";

    static final String MEMBERS = "/office/members";

    static final String SEALED = "/office/sealed";

    static final String TEMPLATES = "/office/templates";

    static final String DENIAL = "test.denial";

    /** A denial letter in English: a reference's values, the record's, and the letter's own. */
    static final String DENIAL_EN = """
            <!DOCTYPE html>
            <html lang="en">
            <head>
            <meta charset="utf-8">
            <title>Claim denial</title>
            <style>p { margin: 0 0 1em 0; } .small { font-size: 9pt; }</style>
            </head>
            <body>
            <!-- A fictional letter. -->
            <p>{{letter.date}}</p>
            <p>Dear {{tclaim:member>tmember:firstName}} {{tclaim:member>tmember:lastName}}, of {{tclaim:member>tmember:address/city}},</p>
            <p>Your claim {{tclaim:number}}, billed USD {{tclaim:billedAmount}} for the service of {{tclaim:serviceDate}}, is denied: {{tclaim:diagnosis}}.</p>
            <p class="small">Codes: {{tclaim:codes}}. Visits: {{tclaim:visits}}. In {{letter.language}}.</p>
            <p>{{letter.writer}}</p>
            </body>
            </html>
            """;

    /** The same letter in Spanish. */
    static final String DENIAL_ES = """
            <!DOCTYPE html>
            <html lang="es">
            <body>
            <p>{{letter.date}}</p>
            <p>Estimado/a {{tclaim:member>tmember:firstName}} {{tclaim:member>tmember:lastName}}:</p>
            <p>Su reclamación {{tclaim:number}}, por USD {{tclaim:billedAmount}}, ha sido denegada.</p>
            <p>{{letter.writer}}</p>
            </body>
            </html>
            """;

    private Office() {
    }

    static void create(CoreSession admin) {
        DocumentModel office = admin.createDocument(admin.createDocumentModel("/", "office", "Workspace"));
        ACP acp = new ACPImpl();
        ACL acl = acp.getOrCreateACL();
        acl.add(new ACE(ALICE, "ReadWrite", true));
        acl.add(new ACE(BOB, "Read", true));
        acl.add(new ACE(DAVE, "Read", true));
        acl.add(ACE.BLOCK);
        admin.setACP(office.getRef(), acp, true);
        admin.createDocument(admin.createDocumentModel("/office", "claims", "Folder"));
        admin.createDocument(admin.createDocumentModel("/office", "members", "Folder"));
        admin.createDocument(admin.createDocumentModel("/office", "templates", "Folder"));
        DocumentModel sealed = admin.createDocument(admin.createDocumentModel("/office", "sealed", "Folder"));
        ACP sealedAcp = new ACPImpl();
        sealedAcp.getOrCreateACL().add(ACE.BLOCK);
        admin.setACP(sealed.getRef(), sealedAcp, true);
        admin.save();
        TransactionHelper.commitOrRollbackTransaction();
        TransactionHelper.startTransaction();
    }

    // ------------------------------------------------------------------ records

    static String member(String repository, String folder, String name, String first, String last, String city) {
        return asAdministrator(repository, s -> {
            DocumentModel doc = s.createDocumentModel(folder, name, "TestMember");
            doc.setPropertyValue("dc:title", first + " " + last);
            doc.setPropertyValue("tmember:firstName", first);
            doc.setPropertyValue("tmember:lastName", last);
            doc.setPropertyValue("tmember:ssn", "000-00-0000");
            Map<String, Serializable> address = new HashMap<>();
            address.put("street", "1 Example Way");
            address.put("city", city);
            doc.setPropertyValue("tmember:address", (Serializable) address);
            return s.createDocument(doc).getId();
        });
    }

    /** A claim of {@code member}'s, its status and language as given. */
    static String claim(String repository, String name, String status, String member, String language) {
        return claim(repository, "TestClaim", name, status, member, language);
    }

    static String claim(String repository, String type, String name, String status, String member, String language) {
        return asAdministrator(repository, s -> {
            DocumentModel doc = s.createDocumentModel(CLAIMS, name, type);
            doc.setPropertyValue("dc:title", name);
            doc.setPropertyValue("tclaim:number", name);
            doc.setPropertyValue("tclaim:status", status);
            doc.setPropertyValue("tclaim:member", member);
            doc.setPropertyValue("tclaim:diagnosis", "not covered by the plan");
            doc.setPropertyValue("tclaim:billedAmount", 1250.5);
            doc.setPropertyValue("tclaim:visits", 3L);
            doc.setPropertyValue("tclaim:serviceDate", new GregorianCalendar(2026, Calendar.MARCH, 4));
            doc.setPropertyValue("tclaim:codes", new String[] { "A01", "B02" });
            if (language != null) {
                doc.setPropertyValue("corr:language", language);
            }
            return s.createDocument(doc).getId();
        });
    }

    /** Write {@code xpath} of {@code id}, as the administrator. */
    static void set(String repository, String id, String xpath, Serializable value) {
        asAdministrator(repository, s -> {
            DocumentModel doc = s.getDocument(new IdRef(id));
            doc.setPropertyValue(xpath, value);
            return s.saveDocument(doc);
        });
    }

    /** Give {@code user} {@code permission} on {@code id} itself, as the administrator. */
    static void grant(String repository, String id, String user, String permission) {
        asAdministrator(repository, s -> {
            ACP acp = s.getACP(new IdRef(id));
            acp.getOrCreateACL().add(new ACE(user, permission, true));
            s.setACP(new IdRef(id), acp, true);
            return null;
        });
    }

    // ------------------------------------------------------------------ templates

    /** A letter template's model, unsaved, in {@link #TEMPLATES}. */
    static DocumentModel templateModel(CoreSession s, String name, String letter, String language, String text,
            String... conditions) {
        DocumentModel doc = s.createDocumentModel(TEMPLATES, name, "LetterTemplate");
        doc.setPropertyValue("dc:title", "Claim denial");
        doc.setPropertyValue("tmpl:templateName", name);
        doc.setPropertyValue("tmpl:applicableTypes", new String[] { "TestClaim" });
        doc.setPropertyValue("ltpl:letter", letter);
        doc.setPropertyValue("ltpl:language", language);
        doc.setPropertyValue("ltpl:conditions", conditions);
        doc.setPropertyValue("file:content", (Serializable) html(name + ".html", text));
        return doc;
    }

    /** A letter template, saved by the administrator. */
    static String template(String repository, String name, String letter, String language, String text,
            String... conditions) {
        return asAdministrator(repository,
                s -> s.createDocument(templateModel(s, name, letter, language, text, conditions)).getId());
    }

    static Blob html(String name, String text) {
        return Blobs.createBlob(text, "text/html", "UTF-8", name);
    }

    // ------------------------------------------------------------------ letters

    /** {@code Letter.Generate} on {@code record}, as {@code user}, through Automation, committed. */
    static DocumentModel generate(String repository, String user, String record, String letter, String language) {
        return inTransactionAs(repository, user, s -> run(s, record, letter, language));
    }

    /** The refusal {@code Letter.Generate} gets as {@code user}, its transaction rolled back. */
    static NuxeoException refusedGenerate(String repository, String user, String record, String letter,
            String language) {
        return refusedAs(repository, user, s -> run(s, record, letter, language));
    }

    private static DocumentModel run(CoreSession s, String record, String letter, String language) {
        DocumentModel input = CoreInstance.doPrivileged(s.getRepositoryName(),
                (CoreSession admin) -> admin.getDocument(new IdRef(record)));
        try (OperationContext context = new OperationContext(s)) {
            context.setInput(input);
            Map<String, Object> parameters = new HashMap<>();
            parameters.put("letter", letter);
            if (language != null) {
                parameters.put("language", language);
            }
            return (DocumentModel) Framework.getService(AutomationService.class)
                                            .run(context, GenerateLetterOperation.ID, parameters);
        } catch (OperationException e) {
            throw unwrap(e);
        }
    }

    /** The first Nuxeo exception in {@code e}'s causes: the refusal, as the REST API answers it. */
    static NuxeoException unwrap(Throwable e) {
        for (Throwable cause = e; cause != null; cause = cause.getCause()) {
            if (cause instanceof NuxeoException nuxeo) {
                return nuxeo;
            }
        }
        return new NuxeoException(e);
    }

    /** The letters on {@code record}, as the administrator reads them. */
    static List<DocumentModel> letters(String repository, String record) {
        return asAdministrator(repository, s -> {
            List<DocumentModel> found = new ArrayList<>();
            for (DocumentModel doc : s.query("SELECT * FROM Letter WHERE letter:record = '" + record
                    + "' AND ecm:isTrashed = 0 ORDER BY dc:created")) {
                doc.detach(true);
                found.add(doc);
            }
            return found;
        });
    }

    /** A letter's file, as text. */
    static String text(DocumentModel letter) {
        try {
            return ((Blob) letter.getPropertyValue("file:content")).getString();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** The document as stored, read by the administrator in a transaction of its own. */
    static DocumentModel stored(String repository, String id) {
        return asAdministrator(repository, s -> {
            DocumentModel doc = s.getDocument(new IdRef(id));
            doc.detach(true);
            return doc;
        });
    }

    // ------------------------------------------------------------------ people and transactions

    static NuxeoPrincipal principal(String user) {
        return ADMINISTRATOR.equals(user) ? new UserPrincipal(user, List.of("administrators"), false, true)
                : new UserPrincipal(user, List.of("members"), false, false);
    }

    static CoreSession as(String repository, String user) {
        return CoreInstance.getCoreSession(repository, principal(user));
    }

    static <T> T asAdministrator(String repository, Function<CoreSession, T> work) {
        return inTransactionAs(repository, ADMINISTRATOR, work);
    }

    static <T> T inTransactionAs(String repository, String user, Function<CoreSession, T> work) {
        return inTransaction(() -> work.apply(as(repository, user)));
    }

    /** The refusal a piece of work as the user gets, in a transaction of its own, rolled back. */
    static NuxeoException refusedAs(String repository, String user, Function<CoreSession, ?> work) {
        try {
            inTransactionAs(repository, user, work);
        } catch (NuxeoException e) {
            return e;
        }
        throw new AssertionError("not refused");
    }

    /** Run something in a transaction of its own, committed unless it throws, and rolled back if it does. */
    static <T> T inTransaction(Supplier<T> work) {
        if (TransactionHelper.isTransactionActiveOrMarkedRollback()) {
            TransactionHelper.commitOrRollbackTransaction();
        }
        try {
            return TransactionHelper.runInTransaction(work);
        } finally {
            TransactionHelper.startTransaction();
        }
    }

    /** Set a server property for the work, and take it off after. */
    static void withProperty(String name, String value, Runnable work) {
        Framework.getProperties().setProperty(name, value);
        try {
            work.run();
        } finally {
            Framework.getProperties().remove(name);
        }
    }
}
