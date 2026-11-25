package org.nuxeo.agentic.config;

import java.io.IOException;
import java.io.Serializable;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.ConcurrentUpdateException;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.core.api.repository.RepositoryManager;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.impl.ACLImpl;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * The deployment layer in the default repository: under one folder, {@value #ROOT}, one
 * {@code File} document per app, named by the app's id, whose {@code file:content} is the app's
 * layer as JSON. The document's change token is the stamp.
 *
 * <ul>
 * <li><b>Who may read it through Nuxeo:</b> the folder's own ACL blocks every permission inherited
 * and grants none, so only administrators, whom Nuxeo lets past every ACL, and the system read it.
 * A reader cannot list, search or fetch a draft through the REST API. The layer is read and
 * written here with a privileged session, after {@link LayerService} has checked that the person
 * is an administrator.</li>
 * <li><b>Hidden:</b> the folder has the {@code HiddenInNavigation} facet.</li>
 * <li><b>A write</b> names the change token it read; the repository refuses a save on another,
 * {@code ConcurrentUpdateException}, which is a write that lost, {@code false}. The first write of
 * an app creates its document, and is a write that lost when the app has one already. Two servers
 * never make an app's first write at once: {@link LayerService} makes its changes to one app inside
 * the cluster's lock for it ({@code ClusterService.runAtomically}).</li>
 * <li><b>Each operation</b> runs in a transaction of its own, so a write is committed, or not,
 * before the answer is given.</li>
 * </ul>
 */
final class RepositoryLayerStore implements LayerStore {

    static final String ROOT_NAME = "agentic-ui-layers";

    static final String ROOT = "/" + ROOT_NAME;

    static final String BLOB = "file:content";

    static final String HIDDEN = "HiddenInNavigation";

    /** Runs a piece of work with a privileged session, in a transaction of its own. */
    interface Sessions {
        <R> R run(Function<CoreSession, R> work);
    }

    /** The server's: the default repository, privileged, in a new transaction. */
    static final Sessions REPOSITORY = new Sessions() {
        @Override
        public <R> R run(Function<CoreSession, R> work) {
            String repository = Framework.getService(RepositoryManager.class).getDefaultRepositoryName();
            return TransactionHelper.runInNewTransaction(() -> CoreInstance.doPrivileged(repository, work));
        }
    };

    private final Sessions sessions;

    RepositoryLayerStore(Sessions sessions) {
        this.sessions = sessions;
    }

    @Override
    public Stored read(String app) {
        return sessions.run(session -> {
            DocumentRef ref = new PathRef(ROOT + "/" + app);
            if (!session.exists(new PathRef(ROOT)) || !session.exists(ref)) {
                return null;
            }
            return stored(session.getDocument(ref));
        });
    }

    @Override
    public Map<String, Stored> readAll() {
        return sessions.run(session -> {
            Map<String, Stored> all = new LinkedHashMap<>();
            DocumentRef root = new PathRef(ROOT);
            if (!session.exists(root)) {
                return all;
            }
            for (DocumentModel document : session.getChildren(root)) {
                Stored stored = stored(document);
                if (stored != null && ConfigScope.APP_ID.matcher(document.getName()).matches()) {
                    all.put(document.getName(), stored);
                }
            }
            return all;
        });
    }

    @Override
    public boolean write(String app, byte[] json, String expected) {
        return sessions.run(session -> {
            root(session);
            DocumentRef ref = new PathRef(ROOT + "/" + app);
            Blob blob = blob(app, json);
            if (expected == null) {
                if (session.exists(ref)) {
                    return false;
                }
                DocumentModel created = session.createDocumentModel(ROOT, app, "File");
                created.setPropertyValue("dc:title", app);
                created.setPropertyValue(BLOB, (Serializable) blob);
                session.createDocument(created);
                session.save();
                return true;
            }
            if (!session.exists(ref)) {
                return false;
            }
            DocumentModel document = session.getDocument(ref);
            if (!expected.equals(document.getChangeToken())) {
                return false;
            }
            document.setPropertyValue(BLOB, (Serializable) blob);
            document.putContextData(CoreSession.CHANGE_TOKEN, expected);
            try {
                session.saveDocument(document);
            } catch (ConcurrentUpdateException e) {
                return false;
            }
            session.save();
            return true;
        });
    }

    /** The folder, made with its ACL the first time. */
    private static DocumentRef root(CoreSession session) {
        DocumentRef root = new PathRef(ROOT);
        if (session.exists(root)) {
            return root;
        }
        DocumentModel folder = session.createDocumentModel("/", ROOT_NAME, "Folder");
        folder.setPropertyValue("dc:title", "Agentic UI deployment layers");
        folder.addFacet(HIDDEN);
        folder = session.createDocument(folder);
        session.setACP(folder.getRef(), blocked(), true);
        session.save();
        return folder.getRef();
    }

    /** An ACP that blocks every inherited permission and grants none. */
    static ACP blocked() {
        ACP acp = new ACPImpl();
        ACL acl = new ACLImpl(ACL.LOCAL_ACL);
        acl.add(ACE.BLOCK);
        acp.addACL(acl);
        return acp;
    }

    private static Blob blob(String app, byte[] json) {
        try {
            Blob blob = Blobs.createBlob(json, "application/json", "UTF-8");
            blob.setFilename(app + ".layer.json");
            return blob;
        } catch (IOException e) {
            throw new IllegalStateException("cannot hold the layer of " + app, e);
        }
    }

    private static Stored stored(DocumentModel document) {
        Object value = document.getPropertyValue(BLOB);
        if (!(value instanceof Blob blob)) {
            return null;
        }
        try {
            return new Stored(blob.getByteArray(), document.getChangeToken());
        } catch (IOException e) {
            throw new IllegalStateException("cannot read the layer of " + document.getName(), e);
        }
    }
}
