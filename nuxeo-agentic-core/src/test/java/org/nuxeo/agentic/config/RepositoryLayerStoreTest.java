package org.nuxeo.agentic.config;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.Serializable;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

import org.junit.jupiter.api.Test;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.ConcurrentUpdateException;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.core.api.impl.DocumentModelListImpl;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.Access;

/**
 * The store in the repository, against a session that answers as Nuxeo's does for the calls it
 * makes: documents by path, a change token raised on every save, and a save on a token that is no
 * longer the document's refused with {@code ConcurrentUpdateException}, as {@code AbstractSession}
 * refuses it when {@code CoreSession.CHANGE_TOKEN} is in the document's context data. Every other
 * call throws, so a change that makes one the fake does not model fails here. The real repository
 * is not run: no Nuxeo is started for these tests.
 */
class RepositoryLayerStoreTest {

    /** One document of the fake repository. */
    static final class Stored {
        final String path;

        final String type;

        final Map<String, Serializable> properties = new HashMap<>();

        final Set<String> facets = new HashSet<>();

        int token = 1;

        ACP acp;

        Stored(String path, String type) {
            this.path = path;
            this.type = type;
        }

        String name() {
            return path.substring(path.lastIndexOf('/') + 1);
        }
    }

    final Map<String, Stored> documents = new LinkedHashMap<>();

    int saves;

    private DocumentModel model(Stored stored, String parent, String name, String type) {
        Map<String, Serializable> properties = new HashMap<>(stored == null ? Map.of() : stored.properties);
        Map<String, Serializable> context = new HashMap<>();
        Set<String> facets = new HashSet<>();
        String path = stored == null ? ("/".equals(parent) ? "" : parent) + "/" + name : stored.path;
        String token = stored == null ? null : String.valueOf(stored.token);
        return (DocumentModel) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] { DocumentModel.class },
                (proxy, method, args) -> switch (method.getName()) {
                case "getPropertyValue" -> properties.get(args[0]);
                case "setPropertyValue" -> {
                    properties.put((String) args[0], (Serializable) args[1]);
                    yield null;
                }
                case "putContextData" -> {
                    context.put((String) args[0], (Serializable) args[1]);
                    yield null;
                }
                case "getContextData" -> context.get(args[0]);
                case "addFacet" -> facets.add((String) args[0]);
                case "getFacets" -> facets;
                case "getName" -> path.substring(path.lastIndexOf('/') + 1);
                case "getPathAsString" -> path;
                case "getRef" -> new PathRef(path);
                case "getType" -> stored == null ? type : stored.type;
                case "getChangeToken" -> token;
                case "properties" -> properties;
                default -> throw new UnsupportedOperationException("DocumentModel." + method.getName());
                });
    }

    private CoreSession session() {
        return (CoreSession) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] { CoreSession.class },
                (proxy, method, args) -> switch (method.getName()) {
                case "exists" -> documents.containsKey(((PathRef) args[0]).value);
                case "getDocument" -> {
                    Stored stored = documents.get(((PathRef) args[0]).value);
                    if (stored == null) {
                        throw new IllegalStateException("no such document");
                    }
                    yield model(stored, null, null, null);
                }
                case "getChildren" -> {
                    String parent = ((PathRef) args[0]).value;
                    List<DocumentModel> children = new ArrayList<>();
                    documents.values()
                             .stream()
                             .filter(each -> each.path.startsWith(parent + "/")
                                     && each.path.indexOf('/', parent.length() + 1) < 0)
                             .forEach(each -> children.add(model(each, null, null, null)));
                    yield new DocumentModelListImpl(children);
                }
                case "createDocumentModel" -> model(null, (String) args[0], (String) args[1], (String) args[2]);
                case "createDocument" -> {
                    DocumentModel created = (DocumentModel) args[0];
                    Stored stored = new Stored(created.getPathAsString(), created.getType());
                    stored.properties.putAll(propertiesFrom(created));
                    stored.facets.addAll(created.getFacets());
                    documents.put(stored.path, stored);
                    yield model(stored, null, null, null);
                }
                case "saveDocument" -> {
                    DocumentModel saved = (DocumentModel) args[0];
                    Stored stored = documents.get(saved.getPathAsString());
                    Object expected = saved.getContextData(CoreSession.CHANGE_TOKEN);
                    if (expected != null && !expected.equals(String.valueOf(stored.token))) {
                        throw new ConcurrentUpdateException(saved.getPathAsString());
                    }
                    stored.properties.putAll(propertiesFrom(saved));
                    stored.token++;
                    yield model(stored, null, null, null);
                }
                case "setACP" -> {
                    documents.get(((PathRef) args[0]).value).acp = (ACP) args[1];
                    yield null;
                }
                case "save" -> {
                    saves++;
                    yield null;
                }
                default -> throw new UnsupportedOperationException("CoreSession." + method.getName());
                });
    }

    /** The properties a fake document model holds. */
    @SuppressWarnings("unchecked")
    private static Map<String, Serializable> propertiesFrom(DocumentModel document) {
        try {
            java.lang.reflect.InvocationHandler handler = Proxy.getInvocationHandler(document);
            return (Map<String, Serializable>) handler.invoke(document, PropertiesHolder.class.getMethod("properties"),
                    null);
        } catch (Throwable e) {
            throw new IllegalStateException(e);
        }
    }

    /** A method named as the fake model answers with its properties. */
    interface PropertiesHolder {
        Map<String, Serializable> properties();
    }

    private RepositoryLayerStore store() {
        CoreSession session = session();
        return new RepositoryLayerStore(new RepositoryLayerStore.Sessions() {
            @Override
            public <R> R run(Function<CoreSession, R> work) {
                return work.apply(session);
            }
        });
    }

    private static byte[] bytes(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    @Test
    void theFirstWriteMakesTheFolderWithItsBlockingAclAndTheAppsDocument() throws Exception {
        RepositoryLayerStore store = store();
        assertNull(store.read("payers-claims"));
        assertTrue(store.readAll().isEmpty());

        assertTrue(store.write("payers-claims", bytes("{\"a\":1}"), null));

        Stored root = documents.get(RepositoryLayerStore.ROOT);
        assertEquals("Folder", root.type);
        assertTrue(root.facets.contains(RepositoryLayerStore.HIDDEN));
        ACL acl = root.acp.getACL(ACL.LOCAL_ACL);
        assertEquals(List.of(ACE.BLOCK), List.of(acl.getACEs()));
        // Blocked: no one is granted anything, members and every other group included.
        assertEquals(Access.DENY, root.acp.getAccess("members", "Read"));
        assertEquals(Access.DENY, root.acp.getAccess("dana", "Read"));

        Stored app = documents.get(RepositoryLayerStore.ROOT + "/payers-claims");
        assertEquals("File", app.type);
        Blob blob = (Blob) app.properties.get(RepositoryLayerStore.BLOB);
        assertEquals("application/json", blob.getMimeType());
        assertArrayEquals(bytes("{\"a\":1}"), store.read("payers-claims").json());
        assertEquals(Set.of("payers-claims"), store.readAll().keySet());
    }

    @Test
    void aWriteOnAStampThatIsNoLongerTheDocumentsLoses() {
        RepositoryLayerStore store = store();
        assertTrue(store.write("payers-claims", bytes("{\"v\":1}"), null));
        // A second first write: another server's, or this one's after a write it did not see.
        assertFalse(store.write("payers-claims", bytes("{\"v\":0}"), null));

        LayerStore.Stored read = store.read("payers-claims");
        assertTrue(store.write("payers-claims", bytes("{\"v\":2}"), read.stamp()));
        assertNotEquals(read.stamp(), store.read("payers-claims").stamp());
        assertFalse(store.write("payers-claims", bytes("{\"v\":3}"), read.stamp()));
        assertArrayEquals(bytes("{\"v\":2}"), store.read("payers-claims").json());
        assertFalse(store.write("staff-directory", bytes("{}"), "1"));
    }

    @Test
    void theRepositorysOwnRefusalOfAStaleTokenIsALostWrite() {
        RepositoryLayerStore store = store();
        assertTrue(store.write("payers-claims", bytes("{\"v\":1}"), null));
        String stamp = store.read("payers-claims").stamp();
        // Another server saves between this one's read of the token and its save: the token this one
        // read still matches what it read, and the repository refuses the save on it.
        Stored stored = documents.get(RepositoryLayerStore.ROOT + "/payers-claims");
        RepositoryLayerStore racing = new RepositoryLayerStore(new RepositoryLayerStore.Sessions() {
            @Override
            public <R> R run(Function<CoreSession, R> work) {
                CoreSession session = session();
                CoreSession interleaved = (CoreSession) Proxy.newProxyInstance(getClass().getClassLoader(),
                        new Class<?>[] { CoreSession.class }, (proxy, method, args) -> {
                            if ("saveDocument".equals(method.getName())) {
                                stored.token++;
                            }
                            try {
                                return method.invoke(session, args);
                            } catch (java.lang.reflect.InvocationTargetException e) {
                                throw e.getCause();
                            }
                        });
                return work.apply(interleaved);
            }
        });
        assertFalse(racing.write("payers-claims", bytes("{\"v\":2}"), stamp));
        assertArrayEquals(bytes("{\"v\":1}"), store.read("payers-claims").json());
    }

    @Test
    void onlyDocumentsNamedAsAnAppIsAreRead() {
        RepositoryLayerStore store = store();
        assertTrue(store.write("payers-claims", bytes("{}"), null));
        Stored stray = new Stored(RepositoryLayerStore.ROOT + "/Not An App", "File");
        stray.properties.put(RepositoryLayerStore.BLOB,
                (Serializable) org.nuxeo.ecm.core.api.Blobs.createBlob("{}", "application/json"));
        documents.put(stray.path, stray);
        assertEquals(Set.of("payers-claims"), store.readAll().keySet());
    }
}
