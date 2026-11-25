package org.nuxeo.agentic.config;

import static org.nuxeo.agentic.config.TestContributions.app;
import static org.nuxeo.agentic.config.TestContributions.appJson;

import java.io.Serializable;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.model.PropertyNotFoundException;

/**
 * An allow-list, an app with an {@code actions.json}, a record, a reader and a session, for the
 * tests of operation buttons, with no Nuxeo runtime. Each fake answers only the calls listed and
 * throws on any other, so a change that reads something they do not model fails a test.
 */
final class ActionFixtures {

    static final String APP = "payers-claims";

    static final String REQUEST_RECORDS = "Payers.RequestMedicalRecords";

    static final String REFER = "Payers.ReferToInvestigations";

    static final DocumentRef REF = new IdRef("4c6e9f1a-claim");

    /** The Payers kit's two operation actions, a lifecycle button, and one of each kind refused. */
    static final String ACTIONS = """
            {
              "$schema": "../actions.schema.json",
              "version": 2,
              "actions": [
                { "id": "payers.claim.pay", "label": "Mark as paid", "transition": "pay" },
                {
                  "id": "payers.claim.requestRecords",
                  "label": "Request medical records",
                  "on": ["record", "row"],
                  "operation": "Payers.RequestMedicalRecords",
                  "parameters": {
                    "provider": { "field": "claim:provider" },
                    "urgent": { "field": "var:urgent" },
                    "note": { "field": "var:note" },
                    "channel": "portal"
                  }
                },
                {
                  "id": "payers.claim.referToInvestigations",
                  "label": "Refer to special investigations",
                  "operation": "Payers.ReferToInvestigations"
                }
              ]
            }
            """;

    private ActionFixtures() {
    }

    static AllowedOperationDescriptor.ParameterDescriptor parameter(String name, String type, String maxLength) {
        AllowedOperationDescriptor.ParameterDescriptor parameter = new AllowedOperationDescriptor.ParameterDescriptor();
        parameter.name = name;
        parameter.type = type;
        parameter.maxLength = maxLength;
        return parameter;
    }

    /** The demo deployment's entry: Request medical records, with its four parameters. */
    static AllowedOperationDescriptor requestRecords() {
        AllowedOperationDescriptor d = new AllowedOperationDescriptor();
        d.id = REQUEST_RECORDS;
        d.parameters = new ArrayList<>(List.of(parameter("provider", "string", null),
                parameter("urgent", "boolean", null), parameter("note", "string", "20"),
                parameter("channel", "string", null)));
        return d;
    }

    static AllowList allowList(AllowedOperationDescriptor... descriptors) {
        Map<String, AllowedOperation> operations = new LinkedHashMap<>();
        for (AllowedOperationDescriptor descriptor : descriptors) {
            AllowedOperation operation = AllowedOperation.of(descriptor);
            operations.put(operation.id(), operation);
        }
        return new AllowList(operations);
    }

    /** The app, for {@code claims-adjusters}, with {@code actions} as its {@code actions.json}. */
    static ConfigSnapshot snapshot(String actions) {
        ContributionRegistry registry = new ContributionRegistry();
        Map<String, String> files = new LinkedHashMap<>();
        files.put("actions.json", actions);
        registry.add(app("payers", APP, appJson(APP, "claims-adjusters"), files));
        return ConfigSnapshot.build(registry.resolve());
    }

    static AppRegistryEndpoint registry(String actions, AllowList allowList) {
        return new AppRegistryEndpoint(snapshot(actions), allowList);
    }

    static NuxeoPrincipal principal(String name, String... groups) {
        return (NuxeoPrincipal) Proxy.newProxyInstance(ActionFixtures.class.getClassLoader(),
                new Class<?>[] { NuxeoPrincipal.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getName" -> name;
                case "getAllGroups" -> List.of(groups);
                case "isAdministrator" -> false;
                case "toString" -> name;
                case "hashCode" -> System.identityHashCode(proxy);
                case "equals" -> proxy == args[0];
                default -> throw new UnsupportedOperationException(method.getName());
                });
    }

    /** A record holding {@code properties}, by xpath; reading any other is a property it does not have. */
    static DocumentModel record(DocumentRef ref, Map<String, Serializable> properties) {
        return (DocumentModel) Proxy.newProxyInstance(ActionFixtures.class.getClassLoader(),
                new Class<?>[] { DocumentModel.class }, (proxy, method, args) -> switch (method.getName()) {
                case "getRef" -> ref;
                case "getId" -> ref == null ? null : ref.toString();
                case "getPropertyValue" -> {
                    if (!properties.containsKey(args[0])) {
                        throw new PropertyNotFoundException((String) args[0]);
                    }
                    yield properties.get(args[0]);
                }
                case "toString" -> "record";
                case "hashCode" -> System.identityHashCode(proxy);
                case "equals" -> proxy == args[0];
                default -> throw new UnsupportedOperationException(method.getName());
                });
    }

    /** A session as {@code principal}, who holds {@code granted} on {@link #REF}, recording what was asked. */
    static final class Session {

        final NuxeoPrincipal principal;

        final Set<String> granted;

        final List<String> asked = new ArrayList<>();

        /** The record as the repository stores it. */
        final Map<String, Serializable> stored = new HashMap<>(Map.of("claim:provider", "provider-0042"));

        DocumentModel storedRecord;

        Session(NuxeoPrincipal principal, String... granted) {
            this.principal = principal;
            this.granted = Set.of(granted);
        }

        CoreSession session() {
            storedRecord = record(REF, stored);
            return (CoreSession) Proxy.newProxyInstance(ActionFixtures.class.getClassLoader(),
                    new Class<?>[] { CoreSession.class }, (proxy, method, args) -> switch (method.getName()) {
                    case "getPrincipal" -> principal;
                    case "hasPermission" -> {
                        if (args.length != 2) {
                            throw new UnsupportedOperationException("hasPermission for another principal");
                        }
                        asked.add(args[1].toString());
                        yield REF.equals(args[0]) && granted.contains((String) args[1]);
                    }
                    case "getDocument" -> {
                        asked.add("getDocument");
                        yield storedRecord;
                    }
                    case "toString" -> "session";
                    case "hashCode" -> System.identityHashCode(proxy);
                    case "equals" -> proxy == args[0];
                    default -> throw new UnsupportedOperationException(method.getName());
                    });
        }
    }

    /** Automation, recording each operation run, its input and its parameters. */
    static final class Automation implements AppActionRunner.Automation {

        record Run(String operation, DocumentModel input, Map<String, Object> parameters) {
        }

        final List<Run> runs = new ArrayList<>();

        /** The operation that throws when run, or {@code null}. */
        String failing;

        @Override
        public Object run(CoreSession session, DocumentModel input, String operation, Map<String, Object> parameters)
                throws Exception {
            if (operation.equals(failing)) {
                throw new org.nuxeo.ecm.automation.OperationException(operation + " failed");
            }
            runs.add(new Run(operation, input, new LinkedHashMap<>(parameters)));
            return null;
        }
    }
}
