# Nuxeo API Reference

All HTTP calls go through `NuxeoApiBase` which prepends the base URL and adds auth headers.
In dev: proxied via `apps/nuxeo-ui/proxy.conf.json` to `http://localhost:8080`.
In prod: same-origin.

---

## REST API Endpoints

### Documents

| Operation                  | Method | Endpoint                                         |
| -------------------------- | ------ | ------------------------------------------------ |
| Fetch document by UID      | GET    | `/nuxeo/api/v1/id/:uid`                          |
| Fetch document by path     | GET    | `/nuxeo/api/v1/path/:path`                       |
| Fetch user workspace       | POST   | `/nuxeo/api/v1/automation/User.GetUserWorkspace` |
| Update document properties | PUT    | `/nuxeo/api/v1/id/:uid`                          |
| Delete document            | DELETE | `/nuxeo/api/v1/id/:uid`                          |
| Get document children      | GET    | `/nuxeo/api/v1/id/:uid/@children`                |
| Get children by path       | GET    | `/nuxeo/api/v1/path/:path/@children`             |

### Document Headers / Enrichers

Pass via request headers to augment the response:

```
enrichers-document: thumbnail          → adds @rendition/thumbnail URL
enrichers-document: permissions        → adds @permissions array: every permission the server defines that the caller holds
enrichers-document: userVisiblePermissions → the server's permission list for the document type (permissionsVisibility)
enrichers-document: subtypes           → adds @subtypes for allowed child types
enrichers-document: hasContent         → adds @hasContent boolean
enrichers-document: collections        → adds @collections membership
enrichers-document: firstAccessibleAncestor → adds breadcrumb parent
```

### Blobs

| Operation         | Method | Endpoint                                                                    |
| ----------------- | ------ | --------------------------------------------------------------------------- |
| Get main blob     | GET    | `/nuxeo/api/v1/id/:uid/@blob/file:content` (fallback: `@blob/blobholder:0`) |
| Get blob by xpath | GET    | `/nuxeo/api/v1/id/:uid/@blob/:xpath`                                        |
| Get thumbnail     | GET    | `/nuxeo/api/v1/id/:uid/@rendition/thumbnail`                                |
| Get PDF rendition | GET    | `/nuxeo/api/v1/id/:uid/@rendition/pdf`                                      |

### Upload

| Operation              | Method | Endpoint                                            |
| ---------------------- | ------ | --------------------------------------------------- |
| Init upload batch      | POST   | `/nuxeo/api/v1/upload/new/default`                  |
| Upload file to batch   | POST   | `/nuxeo/api/v1/upload/:batchId/:fileIndex`          |
| Import batch to folder | POST   | `/nuxeo/api/v1/upload/:batchId/execute/Blob.Attach` |

### Versions

| Operation           | Method | Endpoint                          |
| ------------------- | ------ | --------------------------------- |
| Get version history | GET    | `/nuxeo/api/v1/id/:uid/@versions` |

### Search

| Operation                  | Method | Endpoint                                        |
| -------------------------- | ------ | ----------------------------------------------- |
| NXQL search                | POST   | `/nuxeo/api/v1/search/lang/NXQL/execute`        |
| Page provider search       | GET    | `/nuxeo/api/v1/search/pp/:providerName/execute` |
| Global suggest (typeahead) | GET    | `/nuxeo/api/v1/search/suggest`                  |

### Workflows & Tasks

| Operation              | Method | Endpoint                            |
| ---------------------- | ------ | ----------------------------------- |
| Get workflow models    | GET    | `/nuxeo/api/v1/workflowModel`       |
| Get document workflows | GET    | `/nuxeo/api/v1/id/:uid/@workflow`   |
| Get task               | GET    | `/nuxeo/api/v1/task/:taskId`        |
| Complete task          | PUT    | `/nuxeo/api/v1/task/:taskId`        |
| Get user tasks         | GET    | `/nuxeo/api/v1/task?userId=:userId` |

### Tags

| Operation         | Method | Endpoint                                     |
| ----------------- | ------ | -------------------------------------------- |
| Get document tags | GET    | `/nuxeo/api/v1/id/:uid/@tag`                 |
| Add tag           | POST   | `/nuxeo/api/v1/id/:uid/@tag/:label`          |
| Remove tag        | DELETE | `/nuxeo/api/v1/id/:uid/@tag/:label`          |
| Suggest tags      | GET    | `/nuxeo/api/v1/tag/suggest?searchTerm=:term` |

### Users & Groups

| Operation     | Method | Endpoint                              |
| ------------- | ------ | ------------------------------------- |
| Search users  | GET    | `/nuxeo/api/v1/user/search?q=:query`  |
| Get user      | GET    | `/nuxeo/api/v1/user/:userId`          |
| Search groups | GET    | `/nuxeo/api/v1/group/search?q=:query` |
| Get group     | GET    | `/nuxeo/api/v1/group/:groupId`        |

### Audit

| Operation              | Method | Endpoint                       |
| ---------------------- | ------ | ------------------------------ |
| Get document audit log | GET    | `/nuxeo/api/v1/id/:uid/@audit` |

---

## Automation Operations

Automation operations use `POST /nuxeo/api/v1/automation/:operationId` with body `{ params: {}, context: {}, input: "" }`.

| Operation               | ID                                      | Key params                                                                                                                      |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Create collection       | `Collection.Create`                     | `name`, `description`                                                                                                           |
| Add to collection       | `Collection.AddToCollection`            | `collection` (uid)                                                                                                              |
| Publish document        | `Document.PublishToSection`             | `target` (section uid)                                                                                                          |
| Lock document           | `Document.Lock`                         | —                                                                                                                               |
| Unlock document         | `Document.Unlock`                       | —                                                                                                                               |
| Add permission          | `Document.AddPermission`                | `username`, `permission`, `notify`, `comment`, `begin`, `end`, `creator` (logged-in user — populates "Granted by")              |
| Replace permission      | `Document.ReplacePermission`            | `id`, `username`, `permission`, `notify`, `comment`, `begin`, `end` — an unknown `id` is a 200 no-op; omitted dates are cleared |
| Remove permission       | `Document.RemovePermission`             | `id` removes one ACE; `user` removes **every** ACE of that principal (an unknown `id` is a 200 no-op)                           |
| Add permission (legacy) | `Document.AddACE`                       | `user`, `permission` — client may pass `notify`/`comment`/`begin`/`end` but Nuxeo ignores them; prefer `Document.AddPermission` |
| Block inheritance       | `Document.BlockPermissionInheritance`   | —                                                                                                                               |
| Unblock inheritance     | `Document.UnblockPermissionInheritance` | —                                                                                                                               |
| Bulk download           | `Blob.BulkDownload`                     | `uids`                                                                                                                          |
| CSV export              | `Bulk.RunAction`                        | `action: "csvExport"`                                                                                                           |

---

## Saved Searches

| Operation              | Method | Endpoint                         |
| ---------------------- | ------ | -------------------------------- |
| Get saved searches     | GET    | `/nuxeo/api/v1/search/saved`     |
| Get saved search by ID | GET    | `/nuxeo/api/v1/search/saved/:id` |
| Create saved search    | POST   | `/nuxeo/api/v1/search/saved`     |
| Update saved search    | PUT    | `/nuxeo/api/v1/search/saved/:id` |

---

## Common NXQL Query Patterns

```sql
-- Children of a folder
SELECT * FROM Document WHERE ecm:parentId = ':uid' AND ecm:isTrashed = 0

-- User's collections
SELECT * FROM Collection WHERE ecm:mixinType != 'HiddenInNavigation'
  AND ecm:isVersion = 0 AND ecm:isTrashed = 0
  AND dc:creator = ':username'

-- Full text search
SELECT * FROM Document WHERE ecm:fulltext = ':term'
  AND ecm:mixinType != 'HiddenInNavigation'
  AND ecm:isVersion = 0 AND ecm:isTrashed = 0

-- Recently modified
SELECT * FROM Document WHERE dc:modified >= DATE ':date'
  ORDER BY dc:modified DESC
```

---

## Key Document Properties

| Property                           | Type     | Description                                                   |
| ---------------------------------- | -------- | ------------------------------------------------------------- |
| `uid`                              | string   | Unique document ID                                            |
| `path`                             | string   | Repository path (e.g. `/default-domain/workspaces/MyDoc`)     |
| `title`                            | string   | Display title                                                 |
| `type`                             | string   | Document type (e.g. `File`, `Folder`, `Note`)                 |
| `properties['file:content']`       | object   | Main blob — `{ name, data (URL), length, mime-type }`         |
| `properties['dc:creator']`         | string   | Creator username                                              |
| `properties['dc:lastContributor']` | string   | Last modifier username                                        |
| `properties['dc:modified']`        | string   | ISO date                                                      |
| `properties['dc:subjects']`        | string[] | Subject tags                                                  |
| `contextParameters['thumbnail']`   | object   | `{ url }` — only with `enrichers-document: thumbnail`         |
| `contextParameters['permissions']` | string[] | ACL permissions — only with `enrichers-document: permissions` |
