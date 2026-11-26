package org.nuxeo.agentic.connectors;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.nuxeo.agentic.connectors.SystemOfRecordStub.Answer;
import org.nuxeo.ecm.automation.AutomationService;
import org.nuxeo.ecm.automation.OperationContext;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.impl.UserPrincipal;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.metrics.MetricsService;
import org.nuxeo.runtime.transaction.TransactionHelper;

import com.fasterxml.jackson.databind.JsonNode;

import io.dropwizard.metrics5.SharedMetricRegistries;

/**
 * Two claims in a folder that inherits nothing, each readable by one user only, a stand-in core
 * system that knows both, and the server settings the connector reads, generated for the run.
 *
 * <ul>
 * <li>{@code alice} may read claim A, {@code CLAIM-000130}, and not claim B;</li>
 * <li>{@code bob} may read claim B, {@code CLAIM-000131}, and not claim A;</li>
 * <li>{@code admin} is an administrator.</li>
 * </ul>
 */
final class Claims {

    static final String CONNECTOR = "test.claimPayments";

    static final String ALICE = "alice";

    static final String BOB = "bob";

    static final String ADMIN = "admin";

    static final String KEY_A = "CLAIM-000130";

    static final String KEY_B = "CLAIM-000131";

    static final String PREFIX = Connector.PROPERTY_PREFIX + CONNECTOR + ".";

    /** The settings the tests set, so that each is removed after it. */
    private static final List<String> SET = new ArrayList<>();

    final SystemOfRecordStub stub;

    final String repository;

    final DocumentRef a;

    final DocumentRef b;

    final Fixtures.Clock clock = new Fixtures.Clock();

    /** The connector's bearer credential on this server, generated for the run. */
    final String token = Fixtures.generatedSecret();

    private Claims(SystemOfRecordStub stub, String repository, DocumentRef a, DocumentRef b) {
        this.stub = stub;
        this.repository = repository;
        this.a = a;
        this.b = b;
    }

    static Claims create(CoreSession admin, String repository) throws IOException {
        SystemOfRecordStub stub = new SystemOfRecordStub();
        stub.answer("/claims/" + KEY_A,
                Answer.json("{ \"payment\": { \"status\": \"Paid\", \"amount\": 412.5, \"account\": \"FICTIONAL\" } }"));
        stub.answer("/claims/" + KEY_B, Answer.json("{ \"payment\": { \"status\": \"Pending\", \"amount\": 0 } }"));

        DocumentModel folder = admin.createDocument(admin.createDocumentModel("/", "claims", "Folder"));
        ACP closed = new ACPImpl();
        closed.getOrCreateACL().add(ACE.BLOCK);
        admin.setACP(folder.getRef(), closed, true);
        DocumentModel a = claim(admin, folder, "claim-a", KEY_A, ALICE);
        DocumentModel b = claim(admin, folder, "claim-b", KEY_B, BOB);
        admin.save();
        TransactionHelper.commitOrRollbackTransaction();
        TransactionHelper.startTransaction();

        Claims claims = new Claims(stub, repository, a.getRef(), b.getRef());
        set(PREFIX + "address", stub.address());
        set(PREFIX + "http.allowed", "true");
        set(PREFIX + "token", claims.token);
        set(PREFIX + "cache.ttl", "60");
        claims.reset();
        return claims;
    }

    private static DocumentModel claim(CoreSession admin, DocumentModel folder, String name, String key,
            String reader) {
        DocumentModel claim = admin.createDocumentModel(folder.getPathAsString(), name, "Claim");
        claim.setPropertyValue("claim:number", key);
        claim = admin.createDocument(claim);
        ACP acp = new ACPImpl();
        acp.getOrCreateACL().add(new ACE(reader, "Read", true));
        admin.setACP(claim.getRef(), acp, true);
        return claim;
    }

    static void set(String property, String value) {
        Framework.getProperties().setProperty(property, value);
        SET.add(property);
    }

    static void unset(String property) {
        Framework.getProperties().remove(property);
    }

    /** The component as the runtime runs it. */
    static ConnectorComponent component() {
        return (ConnectorComponent) Framework.getService(ConnectorService.class);
    }

    /** Empties the cache and puts the test's clock in. */
    void reset() {
        component().cache().clear();
        component().clock(clock);
    }

    void close() {
        SET.forEach(Claims::unset);
        SET.clear();
        component().clock(java.time.InstantSource.system());
        component().cache().clear();
        stub.close();
    }

    static NuxeoPrincipal principal(String user) {
        return ADMIN.equals(user) ? new UserPrincipal(user, List.of("administrators"), false, true)
                : new UserPrincipal(user, List.of("members"), false, false);
    }

    CoreSession as(String user) {
        return CoreInstance.getCoreSession(repository, principal(user));
    }

    /**
     * {@code Connector.Read} run by the Automation service as {@code user}, for the document as an
     * administrator reads it: a model the user is handed, as a request's JSON entity can hand
     * Automation one, so that the add-on's own check is what refuses, not Automation's.
     */
    JsonNode read(String user, DocumentRef ref, boolean refresh) throws Exception {
        DocumentModel input = as(ADMIN).getDocument(ref);
        CoreSession session = as(user);
        OperationContext context = new OperationContext(session);
        context.setInput(input);
        Map<String, Object> params = refresh ? Map.of("connector", CONNECTOR, "refresh", true)
                : Map.of("connector", CONNECTOR);
        Blob answer = (Blob) Framework.getService(AutomationService.class)
                                      .run(context, ReadConnectorOperation.ID, params);
        return ConnectorAnswer.JSON.readTree(answer.getString());
    }

    JsonNode read(String user, DocumentRef ref) throws Exception {
        return read(user, ref, false);
    }

    /** What the read threw, the first of the given type in its causes, or {@code null}. */
    <T extends Throwable> T refusal(Class<T> type, String user, DocumentRef ref, boolean refresh) {
        try {
            read(user, ref, refresh);
        } catch (Throwable t) {
            for (Throwable cause = t; cause != null; cause = cause.getCause()) {
                if (type.isInstance(cause)) {
                    return type.cast(cause);
                }
            }
            throw new AssertionError("refused, but not with a " + type.getSimpleName(), t);
        }
        return null;
    }

    /** How many times the stand-in core system was asked for a key. */
    long asked(String key) {
        return stub.received.stream().filter(r -> r.path().equals("/claims/" + key)).count();
    }

    static long counter(String group, String metric) {
        return SharedMetricRegistries.getOrCreate(MetricsService.class.getName())
                                     .counter(ConnectorMetrics.name(group, metric, CONNECTOR))
                                     .getCount();
    }

    /** Revokes every permission the user has on the document, as an administrator. */
    void revoke(String user, DocumentRef ref) {
        CoreSession admin = as(ADMIN);
        ACP acp = admin.getACP(ref);
        for (ACL acl : acp.getACLs()) {
            acl.removeIf(ace -> ace.getUsername().equals(user));
        }
        admin.setACP(ref, acp, true);
        admin.save();
    }
}
