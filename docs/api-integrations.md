# API Integrations

This document tracks all Nuxeo REST API integrations used in the application. When adding a new API call, append an entry following the format below.

**Base URL:** `/nuxeo` (proxied to `http://localhost:8080` in development via `apps/nuxeo-ui/proxy.conf.json`)

**Authentication:** `nuxeoAuthInterceptor` (see `apps/nuxeo-ui/src/app/auth/nuxeo-auth.interceptor.ts`) authenticates `/nuxeo/**` requests from the session in force: it adds `Authorization: Basic <credentials>` after a password sign-in, while an SSO session — and a share link, once its token has been exchanged for one — travels as the browser's cookies. The share token's own header is added only while that exchange is in progress. With no session in force it adds no header, but still sends the request with credentials, so the browser attaches any cookies it holds. The sign-in request is the one that arrives already authenticated: `AuthService.login()` sets the typed credentials as its own Basic header, and the interceptor keeps that header and sends the request without cookies. The configuration requests never reach it: the two of §28, which `AppConfigService` sends, and the layout index and files of §29, which `DocumentLayoutService` sends, both skip the interceptors. They carry no `Authorization` header, but they are not anonymous: being same-origin, they still carry the browser's cookies.

---

## 1. Login (Validate Credentials)

| Field           | Value                                                        |
| --------------- | ------------------------------------------------------------ |
| **Service**     | `AuthService` (`apps/nuxeo-ui/src/app/auth/auth.service.ts`) |
| **Method**      | `login(username, password, remember)`                        |
| **HTTP Method** | `GET`                                                        |
| **Endpoint**    | `/nuxeo/api/v1/me`                                           |

**Request Headers:**

| Header          | Value                               |
| --------------- | ----------------------------------- |
| `Authorization` | `Basic <base64(username:password)>` |
| `Accept`        | `application/json`                  |

**Request Payload:** None (GET request).

**Response (200 OK):**

```json
{
  "entity-type": "user",
  "id": "Administrator",
  "properties": {
    "firstName": "",
    "lastName": "",
    "groups": ["administrators"],
    "email": "devnull@nuxeo.com",
    "username": "Administrator"
  },
  "isAdministrator": true,
  "isAnonymous": false
}
```

**Error Handling:**

| Status                | Message shown to user                                      |
| --------------------- | ---------------------------------------------------------- |
| 401 / 403             | "Invalid username or password."                            |
| Other / Network error | "Could not reach Nuxeo. Check the server, proxy, and URL." |

---

## 2. Recently Edited Documents (Dashboard Widget)

| Field           | Value                                                                               |
| --------------- | ----------------------------------------------------------------------------------- |
| **Service**     | `DocumentService` (`libs/shared/nuxeo-client/src/lib/services/document.service.ts`) |
| **Method**      | `getRecentlyEdited(pageSize)`                                                       |
| **HTTP Method** | `GET`                                                                               |
| **Endpoint**    | `/nuxeo/api/v1/search/lang/NXQL/execute`                                            |

**Query Parameters:**

| Parameter  | Value                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`    | `SELECT * FROM Document WHERE ecm:mixinType != 'HiddenInNavigation' AND ecm:isProxy = 0 AND ecm:isVersion = 0 AND ecm:isTrashed = 0 ORDER BY dc:modified DESC` |
| `pageSize` | `10` (default)                                                                                                                                                 |

**Request Headers:**

| Header          | Value                                        |
| --------------- | -------------------------------------------- |
| `Authorization` | `Basic <credentials>` (added by interceptor) |
| `properties`    | `dublincore`                                 |

**Request Payload:** None (GET request).

**Response (200 OK):**

```json
{
  "entity-type": "documents",
  "totalSize": 31,
  "currentPageSize": 10,
  "currentPageIndex": 0,
  "numberOfPages": 4,
  "entries": [
    {
      "entity-type": "document",
      "uid": "e5fb3f92-...",
      "title": "lta_merged.pdf",
      "type": "File",
      "path": "/default-domain/workspaces/MyWS/lta_merged.pdf",
      "lastModified": "2026-01-23T07:09:27.760Z",
      "properties": {
        "dc:title": "lta_merged.pdf",
        "dc:modified": "2026-01-23T07:09:27.760Z",
        "dc:lastContributor": "Administrator",
        "dc:creator": "Administrator"
      }
    }
  ]
}
```

**Key response fields used:**

| Field                                        | Usage                                                        |
| -------------------------------------------- | ------------------------------------------------------------ |
| `entries[].title`                            | Document name displayed in the widget                        |
| `entries[].type`                             | Mapped to a Material icon (File, Note, Picture, Video, etc.) |
| `entries[].lastModified`                     | Formatted as medium date in the "Modified" column            |
| `entries[].properties['dc:lastContributor']` | Shown in the "Last Contributor" column                       |

---

## 3. User Tasks (Dashboard Widget)

| Field           | Value                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| **Service**     | `TaskService` (`libs/shared/nuxeo-client/src/lib/services/task.service.ts`) |
| **Method**      | `getUserTasks(userId, pageSize)`                                            |
| **HTTP Method** | `GET`                                                                       |
| **Endpoint**    | `/nuxeo/api/v1/task`                                                        |

**Query Parameters:**

| Parameter  | Value                                                  |
| ---------- | ------------------------------------------------------ |
| `userId`   | Current authenticated username (e.g., `Administrator`) |
| `pageSize` | `10` (default)                                         |

**Request Headers:**

| Header          | Value                                        |
| --------------- | -------------------------------------------- |
| `Authorization` | `Basic <credentials>` (added by interceptor) |

**Request Payload:** None (GET request).

**Response (200 OK):**

```json
{
  "entity-type": "tasks",
  "totalSize": 1,
  "entries": [
    {
      "entity-type": "task",
      "id": "17482830-cc55-...",
      "name": "wf.parallelDocumentReview.chooseParticipants.title",
      "workflowModelName": "ParallelDocumentReview",
      "created": "2026-01-23T05:47:09.086Z",
      "dueDate": "2026-01-24T05:47:09.069Z",
      "state": "opened",
      "targetDocumentIds": [{ "id": "b0f3b31e-..." }],
      "actors": [{ "id": "Administrator" }],
      "taskInfo": {
        "taskActions": [
          { "name": "cancel", "label": "wf.parallelDocumentReview.cancel" },
          { "name": "start_review", "label": "wf.parallelDocumentReview.startReview" }
        ]
      }
    }
  ]
}
```

**Enrichment:** For each task, the target document title is fetched via `GET /nuxeo/api/v1/id/{docId}` and merged as `targetDocTitle`. If the document fetch fails, the task is returned without the title.

**Key response fields used:**

| Field                               | Usage                                            |
| ----------------------------------- | ------------------------------------------------ |
| `entries[].name`                    | Task label (stripped of `wf.<workflow>.` prefix) |
| `entries[].dueDate`                 | Due date column; shown in red if overdue         |
| `entries[].workflowModelName`       | Workflow name (PascalCase split into words)      |
| `entries[].targetDocumentIds[0].id` | Used to fetch the target document title          |
| `targetDocTitle` (enriched)         | Shown below the task name                        |

---

## 4. Recently Viewed Documents (Dashboard Widget)

| Field           | Value                                                                               |
| --------------- | ----------------------------------------------------------------------------------- |
| **Service**     | `DocumentService` (`libs/shared/nuxeo-client/src/lib/services/document.service.ts`) |
| **Method**      | `getRecentlyViewed(userId, pageSize)`                                               |
| **HTTP Method** | `GET`                                                                               |
| **Endpoint**    | `/nuxeo/api/v1/search/lang/NXQL/execute`                                            |

**Query Parameters:**

| Parameter  | Value                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`    | `SELECT * FROM Document WHERE ecm:mixinType != 'HiddenInNavigation' AND ecm:isProxy = 0 AND ecm:isVersion = 0 AND ecm:isTrashed = 0 AND ecm:primaryType NOT IN ('Root', 'Favorites', 'Collections') AND (dc:creator = '{user}' OR dc:lastContributor = '{user}') ORDER BY dc:modified DESC` |
| `pageSize` | `10` (default)                                                                                                                                                                                                                                                                              |

**Request Headers:**

| Header          | Value                                        |
| --------------- | -------------------------------------------- |
| `Authorization` | `Basic <credentials>` (added by interceptor) |
| `properties`    | `dublincore`                                 |

**Response (200 OK):** Same document list shape as §2.

**Key response fields used:**

| Field                    | Usage                                                        |
| ------------------------ | ------------------------------------------------------------ |
| `entries[].title`        | Document name with type icon                                 |
| `entries[].type`         | Shown as a coloured badge (e.g., "Picture", "Video", "File") |
| `entries[].lastModified` | Shown as relative time in the "Last Viewed" column           |

---

## 5. Favorite Items (Dashboard Widget)

| Field           | Value                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Service**     | `CollectionService` (`libs/shared/nuxeo-client/src/lib/services/collection.service.ts`)                                 |
| **Method**      | `getFavorites(userId, pageSize)`                                                                                        |
| **HTTP Method** | `GET` (two-step)                                                                                                        |
| **Endpoint**    | Step 1: `/nuxeo/api/v1/search/lang/NXQL/execute` — Step 2: `/nuxeo/api/v1/search/pp/default_content_collection/execute` |

**Step 1 — Locate Favorites collection:**

| Parameter  | Value                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `query`    | `SELECT * FROM Document WHERE ecm:primaryType = 'Favorites' AND ecm:path STARTSWITH '/default-domain/UserWorkspaces/{user}'` |
| `pageSize` | `1`                                                                                                                          |

**Step 2 — Fetch collection members:**

| Parameter     | Value                                           |
| ------------- | ----------------------------------------------- |
| `queryParams` | UID of the Favorites collection found in step 1 |
| `pageSize`    | `10` (default)                                  |

**Request Headers:**

| Header          | Value                                        |
| --------------- | -------------------------------------------- |
| `Authorization` | `Basic <credentials>` (added by interceptor) |
| `properties`    | `dublincore`                                 |

**Response (200 OK):** Same document list shape as §2.

**Key response fields used:**

| Field                                        | Usage                                             |
| -------------------------------------------- | ------------------------------------------------- |
| `entries[].title`                            | Document name with type icon                      |
| `entries[].lastModified`                     | Formatted as medium date in the "Modified" column |
| `entries[].properties['dc:lastContributor']` | Shown in the "Last Contributor" column            |

**Empty state:** "You haven't starred documents yet."

---

## 6. Browse — Get Document by Path

| Field           | Value                                                                           |
| --------------- | ------------------------------------------------------------------------------- |
| **Service**     | `BrowseService` (`libs/shared/nuxeo-client/src/lib/services/browse.service.ts`) |
| **Method**      | `getByPath(nuxeoPath)`                                                          |
| **HTTP Method** | `GET`                                                                           |
| **Endpoint**    | `/nuxeo/api/v1/path{nuxeoPath}`                                                 |

**Request Headers:**

| Header          | Value                                        |
| --------------- | -------------------------------------------- |
| `Authorization` | `Basic <credentials>` (added by interceptor) |
| `properties`    | `dublincore`                                 |

**Request Payload:** None (GET request).

**Response (200 OK):**

```json
{
  "entity-type": "document",
  "uid": "29687dae-ac11-4627-9bd5-8993338cba2a",
  "title": "Domain",
  "type": "Domain",
  "path": "/default-domain",
  "lastModified": "2026-01-23T07:09:27.760Z",
  "properties": {
    "dc:title": "Domain",
    "dc:lastContributor": "Administrator"
  }
}
```

**Key response fields used:**

| Field   | Usage                                           |
| ------- | ----------------------------------------------- |
| `title` | Shown in breadcrumbs and nav drawer folder tree |
| `type`  | Used to determine folderish status and icon     |
| `path`  | Used for breadcrumb construction and navigation |

---

## 7. Browse — Get Children of a Document

| Field           | Value                                                                           |
| --------------- | ------------------------------------------------------------------------------- |
| **Service**     | `BrowseService` (`libs/shared/nuxeo-client/src/lib/services/browse.service.ts`) |
| **Method**      | `getChildren(nuxeoPath, pageSize, currentPageIndex)`                            |
| **HTTP Method** | `GET`                                                                           |
| **Endpoint**    | `/nuxeo/api/v1/path{nuxeoPath}/@children`                                       |

**Query Parameters:**

| Parameter          | Value          |
| ------------------ | -------------- |
| `pageSize`         | `50` (default) |
| `currentPageIndex` | `0` (default)  |

**Request Headers:**

| Header          | Value                                        |
| --------------- | -------------------------------------------- |
| `Authorization` | `Basic <credentials>` (added by interceptor) |
| `properties`    | `dublincore`                                 |

**Request Payload:** None (GET request).

**Response (200 OK):**

```json
{
  "entity-type": "documents",
  "totalSize": 5,
  "currentPageSize": 5,
  "currentPageIndex": 0,
  "numberOfPages": 1,
  "entries": [
    {
      "entity-type": "document",
      "uid": "e96c9e6d-...",
      "title": "Demo",
      "type": "Folder",
      "path": "/default-domain/Demo",
      "lastModified": "2026-01-09T09:06:53.838Z",
      "properties": {
        "dc:title": "Demo",
        "dc:lastContributor": "Administrator"
      }
    }
  ]
}
```

**Key response fields used:**

| Field                                        | Usage                                                            |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `entries[].title`                            | Document/folder name in browse table and nav drawer tree         |
| `entries[].type`                             | Mapped to icon; determines if row is clickable (folderish types) |
| `entries[].path`                             | Used for navigation URL construction                             |
| `entries[].lastModified`                     | Shown in "Modified" column                                       |
| `entries[].properties['dc:lastContributor']` | Shown in "Last Contributor" column                               |
| `totalSize`                                  | Displayed as item count summary                                  |

**Used by:**

- **Browse page** (`libs/features/browse/src/lib/browse/browse.ts`) — displays folder contents

---

## 7b. Browse Tree — Get Folder Children via `tree_children` Page Provider

| Field           | Value                                                                           |
| --------------- | ------------------------------------------------------------------------------- |
| **Service**     | `BrowseService` (`libs/shared/nuxeo-client/src/lib/services/browse.service.ts`) |
| **Method**      | `getTreeChildren(parentUid, pageSize)`                                          |
| **HTTP Method** | `GET`                                                                           |
| **Endpoint**    | `/nuxeo/api/v1/search/pp/tree_children/execute`                                 |

**Query Parameters:**

| Parameter          | Value                                      |
| ------------------ | ------------------------------------------ |
| `queryParams`      | Parent document UID                        |
| `pageSize`         | `50` (default)                             |
| `currentPageIndex` | `0`, `1`, … (auto-fetched until exhausted) |

**Request Headers:**

| Header       | Value |
| ------------ | ----- |
| `properties` | `*`   |

**Notes:**

- Uses the same `tree_children` page provider as Nuxeo Web UI (Folderish children, excludes trashed, versions, and `HiddenInNavigation`).
- `getTreeChildren` concatenates all pages when `isNextPageAvailable` is true.

**Used by:**

- **Nav drawer browse tree** (`apps/nuxeo-ui/src/app/shell/nav-drawer/nav-drawer.component.ts`) — via `getNavTreeChildren()` for repository root and workspace folders

---

## 7c. Browse Tree — Nav Drawer Child Resolution (`getNavTreeChildren`)

| Field       | Value                                                                           |
| ----------- | ------------------------------------------------------------------------------- |
| **Service** | `BrowseService` (`libs/shared/nuxeo-client/src/lib/services/browse.service.ts`) |
| **Method**  | `getNavTreeChildren(parent, pageSize)`                                          |

**Routing:**

| Parent type | Data source     | Reason                                                             |
| ----------- | --------------- | ------------------------------------------------------------------ |
| `Root`      | `tree_children` | Lists every accessible domain (matches Nuxeo Web UI page provider) |
| `Domain`    | `@children`     | Includes structural roots (`WorkspaceRoot`, `SectionRoot`, etc.)   |
| Other       | `tree_children` | Standard folderish navigation under workspaces                     |

**Used by:**

- **Nav drawer browse tree** (`apps/nuxeo-ui/src/app/shell/nav-drawer/nav-drawer.component.ts`)

---

## 8. Document Detail — Full Document Metadata

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Method**      | `getFullDocument(uid)`                                                                           |
| **HTTP Method** | `GET`                                                                                            |
| **Endpoint**    | `/nuxeo/api/v1/id/{uid}`                                                                         |

**Request Headers:**

| Header               | Value                                               |
| -------------------- | --------------------------------------------------- |
| `Authorization`      | `Basic <credentials>` (added by interceptor)        |
| `properties`         | `*` (all schemas)                                   |
| `enrichers.document` | `acls,renditions,favorites,subscribedNotifications` |

**Request Payload:** None (GET request).

**Response (200 OK):**

```json
{
  "entity-type": "document",
  "uid": "fc21784c-...",
  "title": "Copy of Copy of Nishanth",
  "type": "File",
  "path": "/default-domain/workspaces/Copy of Copy of Nishanth",
  "lastModified": "2026-01-09T09:06:53.838Z",
  "properties": {
    "dc:title": "Copy of Copy of Nishanth",
    "dc:created": "2025-12-22T08:45:07.967Z",
    "dc:modified": "2026-01-09T09:06:53.838Z",
    "dc:creator": "Administrator",
    "dc:lastContributor": "Administrator",
    "dc:contributors": ["Administrator"],
    "dc:expired": "2026-01-30T18:30:00.000Z",
    "dc:description": null,
    "file:content": {
      "name": "Screenshot.png",
      "mime-type": "image/png",
      "length": "1365461",
      "digest": "eabb036b5a962b6c..."
    },
    "uid:major_version": 0,
    "uid:minor_version": 0,
    "nxtag:tags": []
  },
  "contextParameters": {
    "acls": [
      {
        "name": "inherited",
        "aces": [
          {
            "id": "Administrator:Everything:true:::",
            "username": "Administrator",
            "externalUser": false,
            "permission": "Everything",
            "granted": true,
            "creator": null,
            "begin": null,
            "end": null,
            "status": "effective"
          },
          {
            "id": "members:Read:true:::",
            "username": "members",
            "externalUser": false,
            "permission": "Read",
            "granted": true,
            "creator": null,
            "begin": null,
            "end": null,
            "status": "effective"
          }
        ]
      }
    ]
  }
}
```

**Key response fields used:**

| Field                                                   | Usage                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `properties['file:content']['mime-type']`               | Determines viewer type (image vs PDF vs fallback)                           |
| `properties['file:content']['name']`                    | File name shown in viewer footer                                            |
| `properties['file:content']['length']`                  | File size shown in viewer footer                                            |
| `properties['dc:created']` / `dc:modified`              | Shown in properties panel                                                   |
| `properties['dc:creator']` / `dc:contributors`          | Shown in properties panel                                                   |
| `properties['dc:expired']`                              | Expiry date in properties panel                                             |
| `properties['uid:major_version']` / `uid:minor_version` | Version badge                                                               |
| `properties['nxtag:tags']`                              | Tag chips                                                                   |
| `contextParameters.acls[].name`                         | ACL name: `"local"` or `"inherited"` — determines section placement         |
| `contextParameters.acls[].aces[].username`              | User/group name shown in permissions table                                  |
| `contextParameters.acls[].aces[].permission`            | Permission level mapped to label (e.g., "Everything" → "Manage everything") |
| `contextParameters.acls[].aces[].granted`               | Whether permission is granted (only granted entries shown)                  |
| `contextParameters.acls[].aces[].externalUser`          | Separates external user permissions into their own section                  |
| `contextParameters.acls[].aces[].creator`               | Who granted the permission ("Granted by" column)                            |
| `contextParameters.acls[].aces[].begin` / `end`         | Date range for time-limited permissions; null = "Permanent"                 |

---

## 9. Document Detail — Blob Download

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Method**      | `fetchBlob(uid, options?)`                                                                       |
| **HTTP Method** | `GET`                                                                                            |
| **Endpoint**    | `/nuxeo/api/v1/id/{uid}/@blob/file:content` (fallback: `@blob/blobholder:0`)                     |

**Query Parameters:**

| Parameter      | Value                                                                |
| -------------- | -------------------------------------------------------------------- |
| `clientReason` | `view` (default, document preview) or `download` (explicit download) |

Classic Web UI sends `clientReason=view` when loading blob content for preview and
`clientReason=download` on explicit download. Nuxeo stores the value in audit
`extended.clientReason` so the Activity tab can show "viewed" vs "downloaded".

**Request Headers:**

| Header          | Value                                        |
| --------------- | -------------------------------------------- |
| `Authorization` | `Basic <credentials>` (added by interceptor) |

**Response:** Raw binary blob (`image/png`, `application/pdf`, etc.)

**Usage:** Fetched via `HttpClient` with `responseType: 'blob'`, converted to an Object URL (`URL.createObjectURL`) for use in `<img>` and `<iframe>` elements. This approach ensures auth credentials are sent via the interceptor, which is not possible with direct `src` attribute binding.

---

## 10. Document Detail — PDF Rendition

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Method**      | `fetchPdfRendition(uid)`                                                                         |
| **HTTP Method** | `GET`                                                                                            |
| **Endpoint**    | `/nuxeo/api/v1/id/{uid}/@rendition/pdf`                                                          |

**Request Headers:**

| Header          | Value                                        |
| --------------- | -------------------------------------------- |
| `Authorization` | `Basic <credentials>` (added by interceptor) |

**Response:** Raw PDF blob. Used as fallback preview for non-image, non-PDF document types (e.g., Word docs).

---

## 11. Document Detail — Audit Log (History)

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Method**      | `getAuditLog(uid, pageSize, currentPageIndex)`                                                   |
| **HTTP Method** | `GET`                                                                                            |
| **Endpoint**    | `/nuxeo/api/v1/id/{uid}/@audit`                                                                  |

**Query Parameters:**

| Parameter          | Value          |
| ------------------ | -------------- |
| `pageSize`         | `50` (default) |
| `currentPageIndex` | `0` (default)  |

**Request Headers:**

| Header          | Value                                        |
| --------------- | -------------------------------------------- |
| `Authorization` | `Basic <credentials>` (added by interceptor) |

**Response (200 OK):**

```json
{
  "entity-type": "logEntries",
  "totalSize": 19,
  "currentPageSize": 3,
  "currentPageIndex": 0,
  "numberOfPages": 7,
  "entries": [
    {
      "entity-type": "logEntry",
      "id": 533,
      "category": "eventDocumentCategory",
      "principalName": "Administrator",
      "comment": "Screenshot 2025-11-26 at 4.33.51 PM.png",
      "docLifeCycle": "project",
      "docPath": "/default-domain/workspaces/Narasimha/Nishanth",
      "docType": "File",
      "docUUID": "79c36c72-...",
      "eventId": "download",
      "repositoryId": "default",
      "eventDate": "2026-03-31T06:47:47.472Z",
      "logDate": "2026-03-31T06:47:47.474Z",
      "extended": {
        "blobFilename": "Screenshot 2025-11-26 at 4.33.51 PM.png",
        "downloadReason": "download",
        "clientReason": "view",
        "blobXPath": "file:content"
      }
    }
  ]
}
```

**Key response fields used:**

| Field                             | Usage                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `entries[].eventId`               | Mapped to human-readable action label (e.g., "download" → "Download")                         |
| `entries[].extended.clientReason` | Activity tab label: `view` → "viewed the document", `download` → "downloaded" (Web UI parity) |
| `entries[].eventDate`             | Shown in "Date" column                                                                        |
| `entries[].principalName`         | Shown in "Username" column with avatar initial                                                |
| `entries[].category`              | Shown in "Category" column                                                                    |
| `entries[].comment`               | Shown in "Comment" column                                                                     |
| `entries[].docLifeCycle`          | Shown in "State" column as badge                                                              |
| `totalSize`, `numberOfPages`      | Used for server-side pagination                                                               |

**Used by:**

- **Document detail page — History tab** (`libs/features/document-detail/src/lib/document-detail/document-detail.ts`)

---

## 12. Directory — Suggest Entries (Event Types & Categories)

| Field           | Value                                                                                 |
| --------------- | ------------------------------------------------------------------------------------- |
| **Service**     | `DirectoryService` (`libs/shared/nuxeo-client/src/lib/services/directory.service.ts`) |
| **Method**      | `getEntries(directoryName)` / `getEventTypes()` / `getEventCategories()`              |
| **HTTP Method** | `POST`                                                                                |
| **Endpoint**    | `/nuxeo/api/v1/automation/Directory.SuggestEntries`                                   |

**Request Payload:**

```json
{
  "params": {
    "directoryName": "eventTypes",
    "dbl10n": false,
    "localize": true,
    "lang": "en",
    "searchTerm": ""
  },
  "context": {}
}
```

The `directoryName` parameter varies:

- `eventTypes` — returns all known audit event types (e.g., "documentCreated", "download")
- `eventCategories` — returns all known audit event categories (e.g., "eventDocumentCategory", "eventWorkflowCategory")

**Request Headers:**

| Header          | Value                                        |
| --------------- | -------------------------------------------- |
| `Authorization` | `Basic <credentials>` (added by interceptor) |
| `Content-Type`  | `application/json`                           |
| `properties`    | `*`                                          |

**Response (200 OK):**

```json
[
  {
    "ordering": 0,
    "obsolete": 0,
    "id": "documentCreated",
    "displayLabel": "Creation",
    "label": "Creation",
    "directoryName": "eventTypes",
    "entity-type": "directoryEntry",
    "computedId": "documentCreated",
    "absoluteLabel": "Creation"
  }
]
```

**Key response fields used:**

| Field          | Usage                                                                                |
| -------------- | ------------------------------------------------------------------------------------ |
| `id`           | Value used for filtering audit entries (matches `eventId` / `category` in audit log) |
| `displayLabel` | Human-readable label shown in filter dropdowns                                       |
| `ordering`     | Sort order for dropdown options                                                      |
| `obsolete`     | Entries with `obsolete: 1` are filtered out                                          |

**Caching:** Picker queries (`getEntries`, `getL10nEntries`, `getAllL10nEntries`) hit the server on every call (Nuxeo Web UI parity). The directory catalog (`getDirectoryCatalog`) is cached for the session.

**Used by:**

- **Document detail page — History tab** (`libs/features/document-detail/src/lib/document-detail/document-detail.ts`) — populates "Performed Actions" and "Event Category" filter dropdowns

---

## 12b. Directory — Vocabulary CRUD (Administration)

| Field           | Value                                                                                 |
| --------------- | ------------------------------------------------------------------------------------- |
| **Service**     | `DirectoryService` (`libs/shared/nuxeo-client/src/lib/services/directory.service.ts`) |
| **Methods**     | `getAdminEntries()` / `createEntry()` / `updateEntry()` / `deleteEntry()`             |
| **HTTP Method** | `GET` / `POST` / `PUT` / `DELETE`                                                     |
| **Endpoint**    | `/nuxeo/api/v1/directory/{directoryName}` (+ `/{entryId}` for update/delete)          |

**List entries (admin table, includes obsolete):**

```
GET /nuxeo/api/v1/directory/{directoryName}?pageSize=50&currentPageIndex=0
```

**Create entry:**

```json
POST /nuxeo/api/v1/directory/{directoryName}/
{
  "entity-type": "directoryEntry",
  "directoryName": "nature",
  "properties": {
    "id": "contract",
    "label": "Contract",
    "ordering": 10000000,
    "obsolete": 0
  }
}
```

**Update entry:**

```
PUT /nuxeo/api/v1/directory/{directoryName}/{entryId}
```

**Delete entry:**

```
DELETE /nuxeo/api/v1/directory/{directoryName}/{entryId}
```

L10n directories (`l10nsubjects`, `l10ncoverage`) use `label_en` instead of `label` and may include a `parent` property for hierarchical entries.

**Used by:**

- **Administration → Vocabularies** (`libs/features/administration/src/lib/admin-vocabularies-page/`)

---

## 13. Publishing — Get Published Versions (Proxies)

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Method**      | `getPublishedVersions(uid)`                                                                      |
| **HTTP Method** | `GET`                                                                                            |
| **Endpoint**    | `/nuxeo/api/v1/search/lang/NXQL/execute`                                                         |

**Query Parameters:**

| Parameter  | Value                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| `query`    | `SELECT * FROM Document WHERE ecm:isProxy = 1 AND ecm:proxyTargetId = '{uid}' AND ecm:isTrashed = 0` |
| `pageSize` | `50`                                                                                                 |

**Request Headers:**

| Header          | Value                                        |
| --------------- | -------------------------------------------- |
| `Authorization` | `Basic <credentials>` (added by interceptor) |
| `properties`    | `dublincore,uid`                             |

**Response (200 OK):** Standard `NuxeoDocumentList` — each entry is a proxy (published copy) of the source document.

**Key response fields used:**

| Field                                                             | Usage                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| `entries[].title`                                                 | Published document title                               |
| `entries[].path`                                                  | Location in the section tree (displayed as breadcrumb) |
| `entries[].lastModified`                                          | When the publication was last updated                  |
| `entries[].properties['uid:major_version']` / `uid:minor_version` | Published version number                               |

**Used by:**

- **Document detail page — Publishing tab** — displays list of existing publications

---

## 14. Publishing — Get Section Tree

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Method**      | `getSectionTree()`                                                                               |
| **HTTP Method** | `GET`                                                                                            |
| **Endpoint**    | `/nuxeo/api/v1/search/lang/NXQL/execute`                                                         |

**Query Parameters:**

| Parameter  | Value                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `query`    | `SELECT * FROM Document WHERE ecm:primaryType IN ('SectionRoot', 'Section') AND ecm:isTrashed = 0 ORDER BY ecm:path` |
| `pageSize` | `200`                                                                                                                |

**Request Headers:**

| Header          | Value                                        |
| --------------- | -------------------------------------------- |
| `Authorization` | `Basic <credentials>` (added by interceptor) |
| `properties`    | `dublincore`                                 |

**Response (200 OK):** Standard `NuxeoDocumentList` — flat list of all SectionRoot and Section documents, ordered by path. Reconstructed into a tree client-side using path relationships.

**Key response fields used:**

| Field             | Usage                                            |
| ----------------- | ------------------------------------------------ |
| `entries[].uid`   | Target section ID for publish operation          |
| `entries[].title` | Section name shown in tree picker                |
| `entries[].path`  | Used to build parent-child hierarchy client-side |
| `entries[].type`  | `SectionRoot` vs `Section` — determines icon     |

**Used by:**

- **Document detail page — Publishing tab** — section tree picker for publish target

---

## 15. Publishing — Publish Document to Section

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Method**      | `publishDocument(uid, targetSectionId)`                                                          |
| **HTTP Method** | `POST`                                                                                           |
| **Endpoint**    | `/nuxeo/api/v1/id/{uid}/@op/Document.PublishToSection`                                           |

**Request Payload:**

```json
{
  "params": {
    "target": "<targetSectionId>",
    "override": "true"
  },
  "context": {}
}
```

**Request Headers:**

| Header          | Value                                        |
| --------------- | -------------------------------------------- |
| `Authorization` | `Basic <credentials>` (added by interceptor) |
| `Content-Type`  | `application/json`                           |

**Response (200 OK):** The published proxy `NuxeoDocument`.

**Usage:** Creates a proxy of the current document version in the target section. If `override` is `"true"`, an existing publication to the same section is replaced. After publishing, the published versions list is refreshed.

**Used by:**

- **Document detail page — Publishing tab** — "Publish" button action

---

## 16. Document Actions — Lock / Unlock

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Methods**     | `lockDocument(uid)` / `unlockDocument(uid)`                                                      |
| **HTTP Method** | `POST`                                                                                           |
| **Endpoints**   | `/nuxeo/api/v1/id/{uid}/@op/Document.Lock` / `Document.Unlock`                                   |

**Request Payload:**

```json
{ "params": {}, "context": {} }
```

**Response (200 OK):** Updated `NuxeoDocument` entity.

**State Detection:** The document's `lockOwner` and `lockCreated` fields are populated when locked (`null` when unlocked). Enricher request includes `favorites,subscribedNotifications` to get all action states in one call.

**Used by:**

- **Document detail page** — Lock/Unlock toggle in "More actions" menu

---

## 17. Document Actions — Add to / Remove from Favorites

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Methods**     | `addToFavorites(uid)` / `removeFromFavorites(uid)`                                               |
| **HTTP Method** | `POST`                                                                                           |
| **Endpoints**   | `/nuxeo/api/v1/automation/Document.AddToFavorites` / `Document.RemoveFromFavorites`              |

**Request Payload:**

```json
{ "params": {}, "context": {}, "input": "{uid}" }
```

**Response (200 OK):** Updated `NuxeoDocument` entity (gains `CollectionMember` facet when added).

**State Detection:** Via the `favorites` enricher: `contextParameters.favorites.isFavorite` (`true`/`false`).

**Used by:** `nxsToggleFavorite()` in `@nuxeo-satori/platform/components`, the one caller of both,
which also fires the `favorites-changed` window event the shell's Favorites views re-read on:

- **`nxs-favorite-toggle`** — the star on search result cards and list rows
- **Document detail page** — **More actions → Add to Favorites / Remove from Favorites**
  (`app.toolbar.addToFavorites`, `app.toolbar.removeFromFavorites`)

---

## 18. Document Actions — Trash (Delete)

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Method**      | `trashDocument(uid)`                                                                             |
| **HTTP Method** | `POST`                                                                                           |
| **Endpoint**    | `/nuxeo/api/v1/id/{uid}/@op/Document.Trash`                                                      |

**Request Payload:**

```json
{ "params": {}, "context": {} }
```

**Response (200 OK):** Updated `NuxeoDocument` with `isTrashed: true` and modified path (`.trashed` suffix).

**Used by:**

- **Document detail page** — Delete button in header toolbar. Navigates back after successful trash.

---

## 19. Document Actions — Subscribe / Unsubscribe (Notify Me)

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Methods**     | `subscribe(uid, notifications)` / `unsubscribe(uid, notifications)`                              |
| **HTTP Method** | `POST`                                                                                           |
| **Endpoints**   | `/nuxeo/api/v1/id/{uid}/@op/Document.Subscribe` / `Document.Unsubscribe`                         |

**Request Payload:**

```json
{ "params": { "notifications": "Creation,Modification" }, "context": {} }
```

**Response (200 OK):** Updated `NuxeoDocument` (gains `Notifiable` facet when subscribed).

**State Detection:** Via the `subscribedNotifications` enricher: `contextParameters.subscribedNotifications` (empty array = not subscribed).

**Used by:**

- **Document detail page** — "Notify Me" / "Unsubscribe" toggle in "More actions" menu

---

## 20. Document Actions — Add to Collection

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Methods**     | `addToCollection(uid, collectionId)` / `getCollections()`                                        |
| **HTTP Method** | `POST` (add) / `GET` (list)                                                                      |
| **Endpoints**   | `/nuxeo/api/v1/id/{uid}/@op/Document.AddToCollection` / `/nuxeo/api/v1/search/lang/NXQL/execute` |

**Add to Collection Payload:**

```json
{ "params": { "collection": "<collectionId>" }, "context": {} }
```

**Get Collections Query:** `SELECT * FROM Collection WHERE ecm:isTrashed = 0 AND ecm:currentLifeCycleState != 'deleted' ORDER BY dc:title`

**Response (200 OK):** Updated `NuxeoDocument` (add) / `NuxeoDocumentList` of available collections (list).

**Used by:**

- **Document detail page** — "Add to collection" button with collection picker dropdown

---

## 21. Document Actions — Export (Download)

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Method**      | `exportBlob(uid)`                                                                                |
| **HTTP Method** | `GET`                                                                                            |
| **Endpoint**    | `/nuxeo/api/v1/id/{uid}/@blob/file:content` (fallback: `@blob/blobholder:0`)                     |

**Response:** Raw binary blob. Downloaded via a dynamically created `<a>` element with `URL.createObjectURL`.

**Used by:**

- **Document detail page** — "Export" action in "More actions" menu

---

## 22. Document Actions — Clipboard

### Client storage

| Field       | Value                                                           |
| ----------- | --------------------------------------------------------------- |
| **Storage** | `localStorage` key: `nuxeo_clipboard`                           |
| **Format**  | JSON array: `[{ "uid": "...", "title": "...", "type": "..." }]` |

Documents are added/removed via document detail, collection detail, or the selection topbar.

### Copy / Move (Web UI parity)

| Operation                                     | Method                                         | HTTP   | Endpoint                                 |
| --------------------------------------------- | ---------------------------------------------- | ------ | ---------------------------------------- |
| Copy clipboard items to current browse folder | `BrowseService.copyDocuments(uids, targetUid)` | `POST` | `/nuxeo/api/v1/automation/Document.Copy` |
| Move clipboard items to current browse folder | `BrowseService.moveDocuments(uids, targetUid)` | `POST` | `/nuxeo/api/v1/automation/Document.Move` |

**Request body:** `{ params: { target: "<folder-uid>" }, context: {}, input: "docs:<uid1>,<uid2>" }` (single doc: `doc:<uid>`).

**Target folder:** `ClipboardTargetService` — updated by `BrowseComponent` while browsing. User must browse to a folderish container before Copy/Move are enabled.

**After success:** `BrowseContextService.notifyClipboardPasteComplete()` optimistically merges pasted documents into the current folder listing and schedules a delayed server reload; `requestTreeRefresh()` updates the browse nav tree when needed.

**Used by:**

- **Clipboard drawer** (`nav-drawer`) — Copy / Move buttons; clears clipboard on success
- **Document detail page** — Add to / Remove from Clipboard
- **Collection detail page** — Add to / Remove from Clipboard
- **Selection topbar** — Add to Clipboard

---

## 23. Document Actions — Share (Copy Link)

No API call — copies the current page URL to the system clipboard using `navigator.clipboard.writeText()`.

**Used by:**

- **Document detail page** — "Share" action in "More actions" menu

---

<!-- TEMPLATE: Copy the block below when adding a new API integration -->

## 24. Knowledge Discovery (via Nuxeo CIC connector)

| Field           | Value                                                                             |
| --------------- | --------------------------------------------------------------------------------- |
| **Service**     | `KdClientService` (`libs/shared/kd-client/src/lib/kd-client.service.ts`)          |
| **Methods**     | `listAgents`, `getAgent`, `submitQuestion`, `getAnswer`, `submitFeedback`, others |
| **HTTP Method** | `POST`                                                                            |
| **Endpoint**    | `/nuxeo/site/automation/<OpName>` (Hyland CIC automation operations)              |

The Angular app calls Knowledge Discovery through Nuxeo automation operations exposed
by the **Hyland Content Intelligence Connector (CIC)** installed on the Nuxeo server.
There is no separate backend in this repo — only the Angular app is deployed to the
marketplace.

**Operation mapping (overridable via `KD_CIC_OPERATIONS` / `KD_UPSTREAM_PATHS`):**

The connector only exposes a handful of first-class ops. Everything else
goes through `HylandKnowledgeDiscovery.Invoke` (a generic passthrough
that takes `httpMethod`, `endpoint`, `jsonPayloadStr`).

| Client method        | Automation op (first-class)                        | Or: Invoke upstream path                                            |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| `listAgents`         | `HylandKnowledgeDiscovery.getAllAgents`            | —                                                                   |
| `submitQuestion`     | `HylandKnowledgeDiscovery.askQuestionAndGetAnswer` | —                                                                   |
| `getAgent`           | — (via Invoke)                                     | `GET /agent/agents/{id}`                                            |
| `listModels`         | — (via Invoke)                                     | `GET /agent/models`                                                 |
| `listGuardrails`     | — (via Invoke)                                     | `GET /agent/guardrails`                                             |
| `getQuestionHistory` | — (via Invoke)                                     | `GET /qna/agents/{agentId}/questions/history?pageNumber=&pageSize=` |
| `getAnswer`          | — (served from client-side cache after submit)     | —                                                                   |
| `submitFeedback`     | — (client-side only for one-shot answers)          | —                                                                   |

> Agent create/update/delete are intentionally NOT exposed. The CIC
> connector has no write-side agent ops, its `Invoke` passthrough rejects
> `DELETE` at the connector layer, and `POST /agent/agents` returns
> `400 Bad Request` from the upstream Discovery API through this auth.
> Agent management is handled in the Hyland Insight admin UI.

**Request body for a first-class op (e.g. `askQuestionAndGetAnswer`):**

```json
{
  "params": {
    "agentId": "agent-123",
    "question": "What contracts mention renewal clauses?",
    "extraPayloadJsonStr": "{\"dynamicFilter\":{\"property\":\"region\",\"operator\":\"equals\",\"value\":\"EMEA\"}}"
  }
}
```

**Request body for an Invoke call (e.g. `getAgent`):**

```json
{
  "params": {
    "httpMethod": "GET",
    "endpoint": "/agent/agents/agent-123"
  }
}
```

**Response envelope (all ops):**

```json
{
  "response": {/* upstream JSON */},
  "responseCode": 200,
  "responseMessage": "OK"
}
```

`KdClientService` unwraps this and surfaces non-2xx `responseCode` as a thrown error.

**Normalized answer payload (returned by the CIC operation):**

```json
{
  "questionId": "question-123",
  "agentId": "agent-123",
  "question": "What contracts mention renewal clauses?",
  "status": "Complete",
  "answer": "The renewal clause appears in the master services agreement.",
  "citations": [
    {
      "objectId": "doc-123",
      "referenceId": "section-4",
      "title": "MSA",
      "excerpt": "The agreement includes renewal terms for successive one-year periods.",
      "score": 0.98
    }
  ],
  "error": null
}
```

**Auth & secrets:**

- The browser authenticates to Nuxeo through the existing `nuxeoAuthInterceptor` (SAML cookie or Basic).
- KD client credentials and OAuth token caching live on the **Nuxeo server** (inside the CIC connector), never in the Angular app.

**Error Handling:**

| Status        | Behavior                                                                   |
| ------------- | -------------------------------------------------------------------------- |
| `400`         | Invalid agent payload, malformed filter JSON, or other request-shape issue |
| `401` / `403` | Surface authorization failure from Nuxeo / CIC                             |
| `404`         | Show missing agent/question state in the dedicated KD page                 |
| `5xx`         | Treat as transient Nuxeo/CIC/KD upstream failure                           |

---

## 25. Knowledge Enrichment (via Nuxeo CIC connector)

| Field           | Value                                                                    |
| --------------- | ------------------------------------------------------------------------ |
| **Service**     | `KeClientService` (`libs/shared/ke-client/src/lib/ke-client.service.ts`) |
| **Methods**     | `enrich`                                                                 |
| **HTTP Method** | `POST`                                                                   |
| **Endpoint**    | `/nuxeo/site/automation/HylandKnowledgeEnrichment.Enrich`                |

The Angular app calls Knowledge Enrichment through the **Hyland Content
Intelligence Connector (CIC)** installed on the Nuxeo server. There is no
separate KE backend in this repo.

Unlike Knowledge Discovery, the KE `Enrich` op accepts a **multipart**
request:

- part `request`: JSON automation payload
- part `input`: the document blob fetched from Nuxeo

The current UI flow is:

1. `DocumentDetailService.fetchBlob(uid)`
2. `KeClientService.enrich(blob, request)`
3. persist results back into Nuxeo metadata with `BrowseService.updateDocument`
   and `TagService.addTag`
4. refresh the full document record in the properties panel

**Supported action mapping:**

| UI action              | KE action(s)                                           | Nuxeo field(s) updated         |
| ---------------------- | ------------------------------------------------------ | ------------------------------ |
| PDF classify           | `text-classification`                                  | `dc:nature`                    |
| PDF extract entities   | `named-entity-recognition-text`                        | `nxtag:tags`                   |
| PDF summarize          | `text-summarization`                                   | `dc:description`               |
| Image describe and tag | `image-description` + `named-entity-recognition-image` | `dc:description`, `nxtag:tags` |

**Request payload inside the `request` multipart part:**

```json
{
  "params": {
    "actions": "text-classification",
    "sourceId": "document-uuid",
    "classes": "[\"Contract\",\"Invoice\",\"Legal\",\"Technical\"]"
  }
}
```

**Response (normalized by the client):**

```json
{
  "requestId": "processing-id",
  "status": "Complete",
  "inProgress": false,
  "textClassification": {
    "isSuccess": true,
    "result": "Contract"
  },
  "textSummary": {
    "isSuccess": true,
    "result": "Short summary..."
  },
  "namedEntityText": {
    "isSuccess": true,
    "result": {
      "ORGANIZATION": ["Hyland"],
      "PERSON": ["Jane Doe"]
    }
  }
}
```

The public Context API OpenAPI describes the canonical raw response keys as:

- `textClassification`
- `textSummary`
- `namedEntityText`
- `imageDescription`
- `namedEntityImage`

Some connector builds may wrap that payload in a generic
`{ response, responseCode, responseMessage }` envelope; `KeClientService`
supports both forms.

**Error Handling:**

| Status / Failure     | Behavior                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Missing KE config    | Surface connector error, e.g. `No authentication info for calling the Enrichment service.` |
| Empty result payload | Show a targeted UI error per action (`did not return a summary`, etc.)                     |
| `401` / `403`        | Treat as connector / KE auth issue                                                         |
| `5xx`                | Treat as transient Nuxeo/CIC/KE upstream failure                                           |

---

## 26. Content Lake ingest (via Nuxeo HxAI connector)

| Field           | Value                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| **Service**     | `ContentLakeIngestService` (`libs/shared/nuxeo-client/src/lib/services/content-lake-ingest.service.ts`) |
| **Methods**     | `startIngest`, `getStatus`, `waitUntilComplete`                                                         |
| **HTTP Method** | `POST` + `GET`                                                                                          |
| **Endpoint**    | `/nuxeo/api/v1/automation/Bulk.RunAction` then `/nuxeo/api/v1/bulk/{commandId}`                         |

The Knowledge Discovery **Upload to Content Lake** dialog uploads files to Nuxeo
with `DocumentImportService`, then triggers the HxAI connector bulk `ingest`
action. The browser never calls Content Lake or Ingest APIs directly.

**Start ingest request:**

```json
{
  "params": {
    "action": "ingest",
    "query": "SELECT * FROM Document WHERE ecm:uuid = 'document-uuid'"
  },
  "context": {}
}
```

**Bulk.RunAction response (automation):** Nuxeo wraps the initial status in `value`:

```json
{
  "entity-type": "bulkStatus",
  "value": {
    "entity-type": "bulkStatus",
    "commandId": "command-uuid",
    "state": "SCHEDULED"
  }
}
```

**Bulk status response (`GET /nuxeo/api/v1/bulk/{commandId}`):**

```json
{
  "entity-type": "bulkStatus",
  "commandId": "command-uuid",
  "state": "COMPLETED",
  "processed": 1,
  "error": false,
  "errorCount": 0
}
```

**Error Handling:**

| Status / Failure                 | Behavior                                                             |
| -------------------------------- | -------------------------------------------------------------------- |
| Missing `commandId`              | Surface as upload/ingest failure in the UI panel                     |
| `error: true` / `errorCount > 0` | Show ingest completed with errors; verify `hxai.ingest.*` on Nuxeo   |
| Bulk state not terminal          | Poll `/nuxeo/api/v1/bulk/{commandId}` until `COMPLETED` or `ABORTED` |

**Check ingest status (document open backfill):**

| Field           | Value                                               |
| --------------- | --------------------------------------------------- |
| **Method**      | `checkIngested`, `backfillIngestMarkerIfNeeded`     |
| **HTTP Method** | `POST`                                              |
| **Endpoint**    | `/nuxeo/api/v1/automation/HylandIngest.CheckDigest` |

On document open, when the local ingest marker is missing, the document detail
page calls `HylandIngest.CheckDigest` (CIC ingest connector). **`sourceId` is
required** — if it is omitted and `nuxeo.hyland.cic.ingest.default.sourceId`
is not set on Nuxeo, the operation returns HTTP 500. The UI resolves
`sourceId` from KD agents (`sourceIds`, or `staticFilterExpression.field =
'__sourceId__'`). Set `nuxeo.hyland.cic.ingest.default.sourceId` to the same
value as `hxai.ingest.source.id` as a server-side fallback. A successful
response looks like `{ "responseCode": 200, "response": { "exists": true } }`.
When `exists` is true, `backfillIngestMarkerIfNeeded` writes the ingest marker
so the UI shows **Already in Content Lake** without re-ingesting. The marker
prefers `dc:source` (rarely auto-filled) and falls back to `dc:rights` when
`dc:source` is already occupied — PDF metadata often populates `dc:rights`.

---

## 27. Document Import — Create Child Document (Web UI parity)

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentImportService` (`libs/shared/nuxeo-client/src/lib/services/document-import.service.ts`) |
| **Method**      | `getEmptyDocumentWithDefaults(parentPath, docType)` then `createChildDocument(...)`              |
| **HTTP Method** | `GET` then `POST`                                                                                |

**Step 1 — Seed create body from server defaults:**

| Field        | Value                                                             |
| ------------ | ----------------------------------------------------------------- |
| **Endpoint** | `/nuxeo/api/v1/path{parentPath}/@emptyWithDefault?type={docType}` |

**Request headers:**

| Header           | Value        |
| ---------------- | ------------ |
| `properties`     | `*`          |
| `fetch-document` | `properties` |

**Step 2 — Create document under parent:**

| Field        | Value                            |
| ------------ | -------------------------------- |
| **Endpoint** | `/nuxeo/api/v1/path{parentPath}` |

**Request body:** Merged document entity from `@emptyWithDefault` with user overrides applied (`mergeCreateDocumentBody`). Null/empty optional Dublin Core fields are omitted so server defaults (e.g. Domain schema fields) are preserved.

**Usage:** Dashboard Add Content (+) → Create tab → Domain at repository root `/` (`CreateImportDialogComponent` → `createChildDocument`).

---

## 28. Application Configuration — Bootstrap and Manifest (NXSAT-312)

| Field           | Value                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Service**     | `AppConfigService` (`libs/shared/app-config/src/lib/app-config.service.ts`)                                                |
| **Method**      | `load()`, once, from an `APP_INITIALIZER`                                                                                  |
| **HTTP Method** | `GET`, both in parallel, at startup; **anonymous**: sent without the interceptors, so never with an `Authorization` header |
| **Endpoints**   | `/nuxeo/agentic-ui-config/bootstrap.json`, `/nuxeo/agentic-ui-config/manifest.json`                                        |
| **Server side** | `AgenticUiConfigServlet` in `nuxeo-agentic-core`, from `org.nuxeo.agentic.ui.config` contributions                         |

Both URLs are resolved from the application's base href (`resolveBootstrapConfigUrl`,
`resolveManifestConfigUrl`), so under `nx serve` they are `/agentic-ui-config/*.json`, served from
the gitignored files `npm run config:dev` writes. Not proxied to Nuxeo.

**Response (both):**

```json
{
  "format": "nuxeo-agentic-ui-config/1",
  "layer": "bootstrap",
  "fragments": [
    {
      "name": "defaults",
      "component": "org.nuxeo.agentic.ui.config.defaults",
      "bundle": "org.nuxeo.agentic.core",
      "source": "agentic-ui-config/bootstrap.defaults.json",
      "content": { "branding": { "applicationTitle": "Nuxeo Platform" } }
    }
  ],
  "diagnostics": []
}
```

`fragments` are applied in order over the compiled defaults; the bootstrap response also carries
`assets`. A response that is not this envelope, an error status, a network failure or no answer
within 10 s (`CONFIG_LOAD_TIMEOUT_MS`) leaves the compiled defaults in force and is recorded in
`diagnostics().messages`. The manifest Note at
`/nuxeo/api/v1/path/default-domain/config/agentic-ui` is **no longer requested**.

**Usage:** every startup, before the first render. Never re-fetched on sign-in or sign-out.

---

## 29. Per-Type Layouts — Layout Files and Document Type Schemas (NXSAT-311)

| Field           | Value                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service**     | `DocumentLayoutService` (`libs/shared/document-layouts/src/lib/document-layout.service.ts`)                                                                            |
| **Method**      | `layoutFor(type, mode, documentSchemas)`, per document shown; `vocabularyLabel(directory, id)`, per vocabulary value shown; each read below is cached for the session  |
| **HTTP Method** | `GET`                                                                                                                                                                  |
| **Endpoints**   | `/nuxeo/agentic-ui-config/layouts.json` and `/nuxeo/agentic-ui-config/layouts/<type>/<mode>.layout.json` — without interceptors, no `Authorization` header             |
|                 | `/nuxeo/api/v1/config/types/<type>` with header `fetch-schema: fields` — authenticated, through `NuxeoApiBase`                                                         |
|                 | `/nuxeo/api/v1/config/schemas/<schema>` with header `fetch-schema: fields`, for a schema a dynamic facet added to the document — authenticated, through `NuxeoApiBase` |
|                 | `/nuxeo/api/v1/directory/<directory>/<id>` with headers `translate-directoryEntry: label` and `Accept-Language: en` — authenticated, through `NuxeoApiBase`            |
| **Server side** | `AgenticUiConfigServlet` (from `<layout>` contributions to `org.nuxeo.agentic.ui.config`); Nuxeo's type registry and directories                                       |

The layout URLs sit beside `bootstrap.json` (from `APP_BOOTSTRAP_CONFIG_URL`), so under `nx serve`
they are `/agentic-ui-config/layouts.json` and `/agentic-ui-config/layouts/…`, written by
`npm run config:dev -- --layout <Type>/<mode>=<file>`. Like the bootstrap reads, they skip the
interceptors: no `Authorization` header, and they do not count as activity for the idle timer.
They are not anonymous, though: being same-origin, they carry the browser's cookies, a signed-in
session's included. The server answers every user with the same files either way.

`layouts.json` lists `{ type, mode, url, component, bundle, source }` per layout in force, plus the
server's `diagnostics`. A layout file is fetched only when the index lists its type and mode, and
answers `{ format, layer: "layout", type, mode, component, bundle, source, content }`, where
`content` is the layout file itself — format in `docs/extension-reference.md` §9b. A missing or
malformed index or file, or no answer within 10 s (`LAYOUT_LOAD_TIMEOUT_MS`), falls back to the
layout generated from the type, with the reason in the console under `[agentic-ui-layouts]`.

`/config/types/<type>` is the per-type read, not the `/config/types` list: asked for
`fetch-schema: fields` it returns each of the type's schemas nested, with `@prefix` when it has
one, and per-field `constraints` — a `directoryResolver` names the vocabulary a value is bound to
(`itemConstraints` for a list). The `/config/types` and `/config/schemas` lists ignore that header;
the per-schema read below honours it. A failed read is not cached, so the next document of the
type asks again.

A dynamic facet adds schemas to one document, not to its type, so no type read has them. The
document's own read lists every schema it carries in `schemas`, as `{ name, prefix }`, and each
one its type lacks is read from `/config/schemas/<schema>` — answered in the same shape as a
schema of the type read, vocabulary constraints included — once per session, whichever type
carries it. Only those the layout could show are read: for the generated layout, the ones the
panel does not already present; for a layout file, the ones whose prefix it names. So, with no
layout file, a File that is collected, followed and has a thumbnail costs no extra read. An unknown schema answers 204 with
no body; that, an error status, a body that is not the schema asked for with a `fields` object,
or no answer within 10 s (`LAYOUT_LOAD_TIMEOUT_MS`, since the other sections wait for it) leaves
only that schema out, is logged, and is asked for again by the next document that carries it.

A vocabulary-bound value is labelled from its own entry, read by id: one request per value the
document shows, plus one for its parent in an `l10n…` vocabulary, which is labelled
`Parent/Child`. The whole vocabulary is never read — `Directory.SuggestEntries` with an empty
term, which the pickers use, returns every entry, and a customer vocabulary can be of any size.
`translate-directoryEntry: label` makes the server translate a label that is a message key, as
`SuggestEntries` with `localize` does, and `Accept-Language: en` keeps it in English, as the
panel's own vocabulary rows are. An entry that cannot be read shows the stored id, and is asked
for again by the next document that shows it.

**Usage:** the Properties panel on document detail (`metadata` mode).

---

## 30. Permissions Panel — ACL Read and Per-Entry Writes (NXSAT-308)

| Field           | Value                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service**     | `NxsPermissionsService` (`libs/shared/satori-components/src/lib/permissions-panel/permissions-panel.service.ts`), over `DocumentDetailService`                       |
| **Read**        | `GET /nuxeo/api/v1/id/:uid` with `enrichers.document=acls,permissions,userVisiblePermissions` and `fetch-acls: username,creator,extended` (`getDocumentPermissions`) |
| **Add**         | `POST /nuxeo/api/v1/automation/Document.AddPermission` — `username`, `permission`, `begin`, `end`, `notify: false` (`addPermission`)                                 |
| **Edit**        | `POST /nuxeo/api/v1/automation/Document.ReplacePermission` — `id`, `username`, `permission`, `begin`, `end`, `notify: false` (`replacePermission`)                   |
| **Remove**      | `POST /nuxeo/api/v1/id/:uid/@op/Document.RemovePermission` — `id`, `acl` (`removePermissionById`)                                                                    |
| **Inheritance** | `Document.BlockPermissionInheritance` / `Document.UnblockPermissionInheritance` on `/id/:uid/@op/…`                                                                  |
| **Users**       | `POST /nuxeo/api/v1/automation/UserGroup.Suggestion` (`searchUsersGroups`)                                                                                           |

**The permission list comes from two enrichers, because neither is enough alone.**
`userVisiblePermissions` is the server's list for the document type, from the `permissionsVisibility`
extension point: `Read`, `ReadWrite`, `Everything` on a stock workspace, plus `CanAskForPublishing`
on a section root. `permissions` lists every permission the server defines **that the caller
holds** — 33 on 2025.26.16 for a holder of `Everything`, 9 for a manager holding only
`WriteSecurity`. The panel offers the first list, then the standard grants (`Write`, `ReadVersion`,
`WriteVersion`, `AddChildren`, `RemoveChildren`, `Remove`, `Version`, `WriteSecurity`, `Unlock`,
`SetRetention`, `UnsetRetention`), then the rest of the second. It filters the standard grants by the
second list only when that list includes `Everything`, since only then is it the full set.

**Behaviour measured on 2025.26.16, which the panel is built around:**

- `Document.RemovePermission` with `user` removes **every** ACE that principal holds in the ACL,
  whatever else is passed. With `id` it removes exactly one. `DocumentDetailService.removePermission`
  sends `user`; the panel uses `removePermissionById`.
- An `id` that matches no ACE is answered `200` with nothing changed, by both `RemovePermission`
  and `ReplacePermission`. The panel re-reads the ACL before writing, refusing a change whose target
  is gone, and again after, reporting any change the server does not show.
- `ReplacePermission` writes the `begin` and `end` it is given, so an edit of the permission alone
  must send the entry's existing dates or it becomes permanent — and send them as the instants the
  read returned. Dates come back in UTC, so an entry written as `2030-01-01T00:00:00+01:00` reads
  as `2029-12-31T23:00:00.000Z`, and sending the day `2029-12-31` back moved it 23 hours earlier.
  The panel shows that entry as 1 January and writes an unchanged date back as the original instant.
- `AddPermission` answers `400` "Permission X is invalid" for a permission the server does not
  define, and `403` "Privilege 'WriteSecurity' is not granted" to a user who cannot manage
  permissions. A deny other than the inheritance marker is refused with `500` ("Negative ACL not
  allowed") unless the server allows negative ACLs.
- Blocking inheritance adds the current user's and `administrators`' `Everything` and the
  `Everyone`/`Everything`/deny marker to the local ACL, and the read then has no `inherited` ACL.
  The repository root has no `inherited` ACL either, so the panel reads "blocked" from the marker.

**Usage:** the Permissions tab of document detail and of `/browse`, through the registered
component `nxs.components.permissionsPanel`.

---

## Administration — Recently Created Users and Groups

| Field           | Value                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| **Service**     | `UserService` (`libs/shared/nuxeo-client/src/lib/services/user.service.ts`) |
| **Method**      | `getRecentlyCreatedUsersAndGroups(pageSize?, currentPageIndex?)`            |
| **HTTP Method** | `GET`                                                                       |
| **Endpoint**    | `/nuxeo/api/v1/search/pp/LATEST_CREATED_USERS_OR_GROUPS_PROVIDER/execute`   |

Returns users and groups sorted by creation date descending (newest first), using the same audit-backed page provider as Nuxeo Web UI. Request header: `properties: *`.

---

## Administration — Create User (with password)

| Field           | Value                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| **Service**     | `UserService` (`libs/shared/nuxeo-client/src/lib/services/user.service.ts`) |
| **Method**      | `createUser(...)` when `password` is provided                               |
| **HTTP Method** | `POST`                                                                      |
| **Endpoint**    | `/nuxeo/api/v1/user`                                                        |

**Request Payload:**

```json
{
  "entity-type": "user",
  "id": "jdoe",
  "properties": {
    "username": "jdoe",
    "firstName": "Jane",
    "lastName": "Doe",
    "company": "Hyland",
    "email": "jdoe@example.com",
    "password": "<password>",
    "groups": ["members"]
  }
}
```

---

## Administration — Invite User (no password)

| Field           | Value                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| **Service**     | `UserService` (`libs/shared/nuxeo-client/src/lib/services/user.service.ts`) |
| **Method**      | `createUser(...)` when `password` is omitted (Nuxeo Web UI parity)          |
| **HTTP Method** | `POST`                                                                      |
| **Endpoint**    | `/nuxeo/api/v1/automation/User.Invite`                                      |

**Request Payload:**

```json
{
  "input": {
    "entity-type": "user",
    "id": "",
    "properties": {
      "username": "jdoe",
      "firstName": "Jane",
      "lastName": "Doe",
      "company": "Hyland",
      "email": "jdoe@example.com",
      "groups": ["members"]
    }
  },
  "params": {},
  "context": {}
}
```

**Notes:** Sends an invitation email so the user can set their own password. Requires Nuxeo mail configuration (see [`../nuxeo-conf/README.md`](../nuxeo-conf/README.md) — local dev uses Mailpit via `mailpit-docker-compose.yml`). Matches `nuxeo-create-user.html` in nuxeo-ui-elements.

<!--
## N. Title

| Field | Value |
| ----- | ----- |
| **Service** | `ServiceName` (`path/to/service.ts`) |
| **Method** | `methodName(params)` |
| **HTTP Method** | `GET` / `POST` / `PUT` / `DELETE` |
| **Endpoint** | `/nuxeo/api/v1/...` |

**Query Parameters / Request Payload:**

| Parameter | Value |
| --------- | ----- |
| `param` | description |

**Response (200 OK):**

```json
{ }
```

**Error Handling:**

| Status | Behavior |
| ------ | -------- |
| ... | ... |
-->

---

## Adf-hx Nuxeo bridge (NXENG-619 Scope A)

| Field                      | Value                                                                    |
| -------------------------- | ------------------------------------------------------------------------ |
| **Library**                | `@agentic-ui/shared/adf-hx-bridge`                                       |
| **Purpose**                | Map Nuxeo REST responses to HxPR `Document` shapes for adf-hx browse POC |
| **POC route**              | `/#/browse-adf-hx?path=<nuxeo-path>`                                     |
| **HxPR APIs implemented**  | `DocumentApi`, `QueryApi` (`tree_children`, `advanced_document_content`) |
| **Nuxeo backing services** | `BrowseService`, `DocumentDetailService`                                 |

## ARender / NEV 2026 — Previewer and Diff URLs

| Field           | Value                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------- |
| **Service**     | `ARenderService` (`libs/shared/nuxeo-client/src/lib/services/arender.service.ts`)            |
| **Methods**     | `getPreviewerUrl(docUid, blobXPath?)`, `getDiffUrl(leftDocUid, rightDocUid)`                 |
| **HTTP Method** | `POST`                                                                                       |
| **Endpoints**   | `/nuxeo/api/v1/automation/Document.ARenderGetPreviewerUrl`, `.../Document.ARenderGetDiffUrl` |
| **Provided by** | The `nuxeo-arender` marketplace addon (`2025.0.4`), not by the platform                      |

**Request body — previewer:**

```json
{ "input": "<doc-uid>", "params": { "blobXPath": "file:content" } }
```

**Request body — diff:**

```json
{ "params": { "leftDocId": "<uid>", "rightDocId": "<uid>" } }
```

**Response:**

```json
{ "previewerUrl": "https://<viewer>/?documentId=default,<uid>,file:content,<digest>" }
```

The diff variant appends a second `documentId` and `visualization.multiView.doComparison=true`.

**Why the server builds this URL.** NEV's `BlobNuxeoURLParser.canParse` claims a request only when
it carries a `documentId` parameter, whose value is `<repository>,<uid>,<xpath>,<digest>`. The blob
digest is not computable in a browser, so the client cannot assemble it. The earlier generic-ARender
contract — `?url=<nxfile-url>` built client-side and fetched through an nginx sidecar with a shared
Basic credential — is left unparsed by NEV 2026.

The host half comes from `arender.server.previewer.host` in `nuxeo.conf`. If the `arender` template
is not active, that silently falls back to `http://localhost:8080/ARender` with no error.

**Failure modes, all answering `null`:**

| Condition                                         | Behaviour                                |
| ------------------------------------------------- | ---------------------------------------- |
| `integrations.arender` unset                      | no request issued                        |
| Addon absent (`404`)                              | `null` — "Annotations are not available" |
| Caller lacks `Read` on the document (`403`)       | `null`                                   |
| Returned URL not on `viewerOrigin`                | `null` — origin allow-list               |
| Returned URL has a non-http(s) scheme or userinfo | `null`                                   |

**Related:** NXSAT-279 (adoption), NXSAT-301 (viewer deployment), NCO-52212 (Nuxeo config).
