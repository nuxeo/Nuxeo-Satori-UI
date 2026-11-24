package org.nuxeo.agentic.connectors;

import java.io.Serializable;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.model.PropertyNotFoundException;

/** Connectors, settings, a document and a session for the tests, with no Nuxeo runtime. */
final class Fixtures {

    static final String ADDRESS_PROPERTY = "test.claims.address";

    static final String TOKEN_PROPERTY = "test.claims.token";

    static final String TOKEN_ENV = "TEST_CLAIMS_TOKEN";

    private Fixtures() {
    }

    /** A sound descriptor: a claim's number, three fields, a bearer credential. */
    static ConnectorDescriptor descriptor() {
        ConnectorDescriptor d = new ConnectorDescriptor();
        d.id = "test.claimPayments";
        d.addressProperty = ADDRESS_PROPERTY;
        d.path = "/claims/{key}";
        d.keyXpath = "claim:number";
        d.fields = new ArrayList<>(List.of(field("paymentStatus", null), field("paidAmount", "/payment/amount"),
                field("paid", "/payment/paid")));
        return d;
    }

    static ConnectorDescriptor withCredential(ConnectorDescriptor d) {
        d.credentialHeader = "Authorization";
        d.credentialPrefix = "Bearer ";
        d.credentialProperty = TOKEN_PROPERTY;
        d.credentialEnv = TOKEN_ENV;
        return d;
    }

    static ConnectorDescriptor.FieldDescriptor field(String name, String pointer) {
        ConnectorDescriptor.FieldDescriptor field = new ConnectorDescriptor.FieldDescriptor();
        field.name = name;
        field.pointer = pointer;
        return field;
    }

    /** Server properties and environment variables, both empty unless a test sets them. */
    static final class Settings {

        final Map<String, String> properties = new HashMap<>();

        final Map<String, String> env = new HashMap<>();

        ConnectorSettings settings() {
            return new ConnectorSettings(properties::get, env::get);
        }

        Settings address(String address) {
            properties.put(ADDRESS_PROPERTY, address);
            return this;
        }

        Settings allowHttp() {
            properties.put(ConnectorSettings.ALLOW_HTTP, "true");
            return this;
        }
    }

    /** A document holding {@code claim:number} as given, or no such property at all. */
    static DocumentModel claim(Serializable number, boolean hasProperty) {
        DocumentRef ref = new IdRef("4c6e9f1a-claim");
        return (DocumentModel) Proxy.newProxyInstance(Fixtures.class.getClassLoader(),
                new Class<?>[] { DocumentModel.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getRef" -> ref;
                case "getId" -> "4c6e9f1a-claim";
                case "getPropertyValue" -> {
                    if (!hasProperty || !"claim:number".equals(args[0])) {
                        throw new PropertyNotFoundException((String) args[0]);
                    }
                    yield number;
                }
                case "toString" -> "claim";
                case "hashCode" -> System.identityHashCode(proxy);
                case "equals" -> proxy == args[0];
                default -> throw new UnsupportedOperationException(method.getName());
                });
    }

    /** A session whose user holds {@code granted} on every document, and that records what was asked. */
    static final class Session {

        final Set<String> granted;

        final List<String> asked = new ArrayList<>();

        Session(String... granted) {
            this.granted = Set.of(granted);
        }

        CoreSession session() {
            return (CoreSession) Proxy.newProxyInstance(Fixtures.class.getClassLoader(),
                    new Class<?>[] { CoreSession.class }, (proxy, method, args) -> switch (method.getName()) {
                    case "hasPermission" -> {
                        if (args.length != 2) {
                            throw new UnsupportedOperationException("hasPermission for another principal");
                        }
                        asked.add(args[0] + " " + args[1]);
                        yield granted.contains((String) args[1]);
                    }
                    case "toString" -> "session";
                    case "hashCode" -> System.identityHashCode(proxy);
                    case "equals" -> proxy == args[0];
                    default -> throw new UnsupportedOperationException(method.getName());
                    });
        }
    }
}
