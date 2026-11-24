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

## 3. User Tasks (Tasks Page, Drawer, Dashboard Widget)

| Field           | Value                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| **Service**     | `TaskService` (`libs/shared/nuxeo-client/src/lib/services/task.service.ts`) |
| **Method**      | `getUserTasks(userId, pageSize)`                                            |
| **HTTP Method** | `GET`                                                                       |
| **Endpoint**    | `/nuxeo/api/v1/task`                                                        |

**Query Parameters:**

| Parameter  | Value                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| `userId`   | Current authenticated username (e.g., `Administrator`)                                                       |
| `pageSize` | First read: how many to return, 50 for the tasks page and the drawer, 10 for the dashboard, 100 for the bell |
| `offset`   | Second read only: the first read's entry count, with `pageSize` the rest, at most 1000                       |

**Order, and why there can be two reads.** Nuxeo cannot be asked for the newest tasks. Its task
list (`RoutingTaskPageProvider` in `nuxeo-routing-core`, Nuxeo 2025.10) builds its own query,
ending `ORDER BY nt:dueDate ASC`, and never reads `sortBy` or `sortOrder`: the first page holds
the tasks due soonest, the last page those due latest. Paging itself is reliable. Measured with
64 open tasks, due dates shuffled against creation:

| Request                                            | Result                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| `pageSize=50`                                      | `resultsCount: 64`, `isNextPageAvailable: true`, the 50 due soonest       |
| `pageSize=50&currentPageIndex=1`                   | the 14 due latest, not the 14 newest                                      |
| `sortBy=created` or `dc:created`, `sortOrder=desc` | the same order as without                                                 |
| `pageSize=10&offset=54`                            | entries 55 to 64 of that order: `offset` need not fall on a page boundary |

So `getUserTasks` reads the first page, and when `isNextPageAvailable` reads the rest after it
with `offset`, up to 1000 more (the `maxPageSize` the endpoint reports), drops a task that arrives
in both reads, sorts by `created` newest first and keeps the first `pageSize`. One request while the tasks fit,
two when they do not. The page providers that query task documents directly
(`GET_TASKS_FOR_ACTORS…`) return documents, not tasks, and need the reader's groups expanded, so
they are not used. **Limit:** a user with more than `pageSize` + 1000 open tasks gets the newest of
the ones due soonest.

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

**Enrichment:** For each task kept, when the response did not carry it, the target document title is fetched via `GET /nuxeo/api/v1/id/{docId}` and merged as `targetDocTitle`. If the document fetch fails, the task is returned without the title.

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

| Header               | Value                                                           |
| -------------------- | --------------------------------------------------------------- |
| `Authorization`      | `Basic <credentials>` (added by interceptor)                    |
| `properties`         | `*` (all schemas)                                               |
| `enrichers.document` | `acls,permissions,favorites,subscribedNotifications,breadcrumb` |

`breadcrumb` is what gives the browse trail its ancestors' **titles**. Without it the trail can
only decode the folders' URL path segments, so every crumb above the current folder reads as a
name rather than a title. Nuxeo Web UI's `nuxeo-breadcrumb` reads the same enricher, so the whole
trail still costs one request; the entries carry no `properties`, so the cost is one small document
entity per ancestor.

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

| Field                                  | Usage                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `title`                                | The current folder's own crumb, and its heading and nav-drawer tree label          |
| `type`                                 | Used to determine folderish status and icon                                        |
| `path`                                 | Used for crumb router links and navigation                                         |
| `contextParameters.breadcrumb.entries` | Each ancestor's `title`, keyed by its `path` — the labels above the current folder |

---

## 7. Browse — Get Children of a Document

| Field           | Value                                                                           |
| --------------- | ------------------------------------------------------------------------------- |
| **Service**     | `BrowseService` (`libs/shared/nuxeo-client/src/lib/services/browse.service.ts`) |
| **Method**      | `getChildren(nuxeoPath, pageSize, currentPageIndex)`                            |
| **HTTP Method** | `GET`                                                                           |
| **Endpoint**    | `/nuxeo/api/v1/path{nuxeoPath}/@children`                                       |

**Query Parameters:**

| Parameter          | Value                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| `pageSize`         | `50` (default)                                                            |
| `currentPageIndex` | `0` (default)                                                             |
| `principalName`    | `query.principalName` — the exact username, as Web UI's user picker sends |
| `eventId`          | `query.eventIds` — repeated, any of them matches                          |
| `eventCategory`    | `query.eventCategory`                                                     |
| `startEventDate`   | `query.startDate` as an ISO instant — inclusive                           |
| `endEventDate`     | `query.endDate` as an ISO instant — **exclusive**                         |
| `sortBy`           | `query.sortBy`: `eventId`, `eventDate`, `principalName` or `category`     |
| `sortOrder`        | `query.sortOrder`, `desc` unless given                                    |

Every `query` field is optional and sent only when set; `sortOrder` goes with `sortBy`, `desc`
unless given. Measured on the shared Nuxeo
(2026-10-13): each one filters or sorts the whole audit trail on the server, a bare day
(`2026-10-13`) is read as midnight in the server's zone, and an end of `2026-10-13` excludes
that day — so `nxs-document-history` sends instants, with the end at the start of the day after
the user's "To".

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
| **Method**  | `getNavTreeChildren(parent, pageSize, page?)`                                   |

**Routing:**

| Parent type | Data source     | Reason                                                             |
| ----------- | --------------- | ------------------------------------------------------------------ |
| `Root`      | `tree_children` | Lists every accessible domain (matches Nuxeo Web UI page provider) |
| `Domain`    | `@children`     | Includes structural roots (`WorkspaceRoot`, `SectionRoot`, etc.)   |
| Other       | `tree_children` | Standard folderish navigation under workspaces                     |

With `page` (`{ currentPageIndex?, sort? }`), `Root` returns that one page in that order, which is how the browse listing pages it; without it a `Root` level lists every page, as a tree level needs. A `Domain` level is always the folders of its first `@children` page: the browse listing pages a domain through `getBrowseFolderContents` on `@children` like any folder, with its files, as Nuxeo Web UI's domain view (`advanced_document_content`) does — keeping only the folders after the server paged them left pages short or empty. `Favorites` and `Collection` listings page the same way through `getCollectionMembers(uid, pageSize, page?)` on `default_content_collection`, which answers an unusable sort key with HTTP 400 rather than an empty page.

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

| Header               | Value                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Authorization`      | `Basic <credentials>` (added by interceptor)                                                                     |
| `properties`         | `*` (all schemas)                                                                                                |
| `enrichers.document` | `acls,permissions,renditions,favorites,subscribedNotifications,collections,preview,thumbnail,allowedTransitions` |
| `fetch-document`     | `lock` — without it a locked document arrives with no `lockOwner` / `lockCreated` and reads as unlocked          |

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

## 8b. Document Detail — Tags (NXSAT-308)

| Field           | Value                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Service**     | `TagService` (`libs/shared/nuxeo-client/src/lib/services/tag.service.ts`)                                               |
| **Methods**     | `addTag(uid, label)` / `removeTag(uid, label)` / `suggestTags(term)`                                                    |
| **HTTP Method** | `POST`                                                                                                                  |
| **Endpoints**   | `/nuxeo/api/v1/id/{uid}/@op/Services.TagDocument` / `Services.UntagDocument`; `/nuxeo/api/v1/automation/Tag.Suggestion` |

**Request Payload:** `{ "params": { "tags": "<label>" }, "context": {} }` to tag and untag;
`{ "params": { "searchTerm": "<term>" }, "context": {} }` to suggest.

**Headers:** `properties: facetedTag` on tag and untag, so the answer — the document — carries
`nxtag:tags`. Without it the operations' answer leaves the schema out.

**Response (200 OK):** `addTag` and `removeTag` answer with the labels of the document's tags
afterwards; `Tag.Suggestion` with `[{ "id", "displayLabel" }]`.

**Behaviour measured on Nuxeo LTS 2025 (2026-10-13):**

- Nuxeo normalises a label: "B2 Hello World" is stored as `b2helloworld`, "Writer Tag!" as
  `writertag!`. Show the label from the answer, not the one typed.
- A user with Read alone may tag (200) but not untag (500, "Failed to invoke operation"). A user with
  Write may untag a tag someone else added (200).
- Web UI's `isTaggable` — `canTagDocument(doc)` here — offers neither without Write, nor on a version
  or a proxy.

**Used by:** `nxs-tag-editor` in the document page's Properties panel and in Browse's details panel
(Tags sub-tab), and the AI "Suggested tags" card, which refreshes the document's tags from
`addTag`'s answer.

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

**A Picture's views on its record page** use the same endpoint through
`fetchBlobByXpath(uid, 'picture:views/<n>/content')`, with `clientReason=view`: `<n>` is the
view's place in the record's `picture:views`, as `RecordPictureViewsComponent`
(`libs/shared/document-layouts`) reads them. Measured on the local Nuxeo 2025 on 24 November 2026:
a 1600 × 1067 PNG upload had five views, `Thumbnail`, `Small`, `Medium`, `FullHD` and
`OriginalJpeg`, each an `image/jpeg` file
([layout-v2.md](business-apps/layout-v2.md), section 11).

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

## 10a. Document Detail — Why the Server's Rights Refused a Use

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Method**      | `fetchAssetRights(uid)`                                                                          |
| **HTTP Method** | `GET`                                                                                            |
| **Endpoint**    | `/nuxeo/api/v1/id/{uid}`                                                                         |

**Request Headers:** `properties: dublincore`, `enrichers.document: assetRights`.

**Response:** the document, whose `contextParameters.assetRights` is what the rights policy of
`nuxeo-agentic-assets` decides for each use of it: the original, each picture view by its title,
and each rendition the policy lists, each `allowed` or not with a `reason` code
(`cleared`, `preview`, `rights-ended`, `channel-not-covered`, `not-cleared`, `policy-error`), and
`otherwise` for any use not listed. `null` for a type no policy covers; absent on a server without
the add-on. Read with `assetRights(doc)` and `assetRightsDecision(rights, use)`
(`libs/shared/nuxeo-client/src/lib/utils/asset-rights.ts`); the full shape is in
`nuxeo-agentic-assets/README.md`.

**When it is asked:** only after the server has refused a download with 403. The record page's
picture views (`record-picture-views.ts`) then say the server's reason in place of the view. The
refusal is the server's download permission; this only explains it, and nothing is hidden or
offered from it.

---

## 11. Document Detail — Audit Log (History)

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Method**      | `getAuditLog(uid, pageSize, currentPageIndex, query?)`                                           |
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
| **Method**      | `getEntries(directoryName, lang?)` / `getEventTypes()` / `getEventCategories()`       |
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
| **Endpoint**    | `/nuxeo/api/v1/search/pp/nxql_search/execute`                                                    |

**Query Parameters:**

| Parameter     | Value                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queryParams` | `SELECT * FROM Document WHERE ecm:isProxy = 1 AND ecm:isTrashed = 0 AND (rend:sourceVersionableId = "{uid}" OR ecm:proxyVersionableId = "{uid}")` |
| `pageSize`    | `40`                                                                                                                                              |
| `sortBy`      | `dc:modified,uid:major_version,uid:minor_version`                                                                                                 |
| `sortOrder`   | `desc,desc,desc`                                                                                                                                  |

`{uid}` is the **live** document's uid, also on a version page: a proxy's `ecm:proxyVersionableId`
is the live document's uid (see section 30c).

**Request Headers:**

| Header               | Value                                        |
| -------------------- | -------------------------------------------- |
| `Authorization`      | `Basic <credentials>` (added by interceptor) |
| `properties`         | `dublincore,common,uid,rendition`            |
| `enrichers.document` | `permissions`                                |

**Response (200 OK):** Standard `NuxeoDocumentList` — each entry is a proxy (published copy) of the source document.

**Key response fields used:**

| Field                                                             | Usage                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| `entries[].path`                                                  | Location in the section tree                                  |
| `entries[].properties['uid:major_version']` / `uid:minor_version` | Published version number; Republish compares it with the page |
| `entries[].properties['dc:modified']`                             | Publish date                                                  |
| `entries[].contextParameters.permissions`                         | Unpublish and Republish need `WriteVersion` on the proxy      |

The permissions are the user's on each **proxy**, which follow the section's ACL, not the
document's: measured on the shared Nuxeo, a workspace reader gets no `WriteVersion` on a
publication in a section under that workspace, and a ReadWrite user does. This is Web UI's
`nuxeo-document-publications` gate (`_canUnpublish`, `_canRepublish`). The tab's own
**Publish to a section** is offered only when `canPublishDocument` holds — the same rule as the
toolbar's Publish (`app.rules.canPublish`).

**Used by:**

- **Document detail page — Publishing tab** — the list of publications, and the publication count in the properties panel

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

**Headers:** `fetch-document: lock`, so the response carries the `lockOwner` / `lockCreated` the server recorded.

**State Detection:** The document's `lockOwner` and `lockCreated` fields are populated when locked (`null` when unlocked) — **only when the request sends `fetch-document: lock`**. Without it Nuxeo omits both on a locked document, which is why `getFullDocument(uid)` sends it, and `CollectionService.getById(uid)` too, since collection detail falls back to it (with the `permissions` enricher, so that read still knows who may unlock). The other action states — favourite, subscription — come from `getFullDocument`'s enrichers on the same read; `lockDocument` / `unlockDocument` send only `fetch-document: lock`.

**Errors:** `409` when another user holds the lock (on Lock: "already locked"; on Unlock: "locked by another user"), `403` when the caller lacks the permission. Nuxeo's default lock policy removes Write on a locked document from everyone but its owner and administrators, so the packaged Unlock action is enabled by `app.rules.canWrite`; the server still decides.

**Used by:**

- **Document detail page** — Lock/Unlock toggle in the header toolbar (`app.toolbar.lock` / `app.toolbar.unlock`)
- **Collection detail page** — Lock/Unlock icon button in the header

---

## 16a. Document Actions — Follow a Lifecycle Transition

| Field           | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| **Service**     | `DocumentDetailService` (`libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts`) |
| **Method**      | `followTransition(uid, transition)`                                                              |
| **HTTP Method** | `POST`                                                                                           |
| **Endpoint**    | `/nuxeo/api/v1/id/{uid}/@op/Document.FollowLifecycleTransition`                                  |

**Request Payload:**

```json
{ "params": { "value": "approve" }, "context": {} }
```

**Response (200 OK):** The `NuxeoDocument` in its new `state`. The page reloads it with
`getFullDocument` anyway, for the transitions it allows next.

**Which transitions to offer:** the `allowedTransitions` document enricher, which
`nuxeo-agentic-core` adds (`org.nuxeo.agentic.lifecycle.AllowedTransitionsJsonEnricher`) and
`getFullDocument` asks for. It writes

```json
"contextParameters": {
  "allowedTransitions": [{ "name": "approve", "destinationState": "approved" }]
}
```

in the lifecycle's order: what the document's lifecycle allows from its current state, kept only
when the operation would succeed for this user. Nuxeo 2025's `followTransition` checks
`WriteLifeCycle` and, on a checked-in live document, `WriteProperties` for the check-out it does
first; listing the transitions needs `ReadLifeCycle`. A transition a state lists but the policy
does not declare is left out, as the server fails on its missing destination, and the lifecycle
is the one the service maps the document's type to. The enricher asks each of the session, so
security policies such as the lock policy answer as they do for the operation, and lets an
administrator through as `checkPermission` does. A server without the bundle ignores the name, and
`allowedTransitions(doc)` then reads none. Nuxeo has no operation or enricher of its own that lists
them.

**Errors:** `403` when the user may not change the lifecycle (the page says so); anything else,
such as a transition the document's state no longer allows, is reported as the state not changing.
The page reloads after either.

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

**Used by:** `nxsToggleFavorite()` in `@nuxeo/satori-platform/components`, the one caller of both,
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

**Request body:** Merged document entity from `@emptyWithDefault` with user overrides applied (`mergeCreateDocumentBody`). Null or empty values the form sends are omitted so server defaults (e.g. Domain schema fields) are preserved.

**Usage:** Create / Import → Create tab, in Browse and from the dashboard's Add Content (+), Domain at repository root `/` included (`CreateImportDialogComponent` → `createChildDocument`). The properties are those of the type's create form (`lib-document-layout-form mode="create"`, NXSAT-630): its Dublin Core fields and its create layout — generated from the type's schemas, or a contributed `<Type>/create.layout.json` — plus the Note body and format for a Note. Blob-holding types send the same form's properties to the same path endpoint with the staged main file (`createBlobHoldingDocumentReliable`).

The create form opens empty and sends only the fields the user filled in, so every untouched field — an unticked checkbox included — takes its server default from Step 1, and a default cannot be cleared at creation (NXSAT-630).

**Which types are blob-holding:** File, Picture, Audio and Video, and any type that extends one of them or carries the `file` schema itself — a customer's `RentalContract extends File`, for instance. The dialog reads the type hierarchy from Nuxeo's content model through `ContentModelService` (`GET /nuxeo/api/v1/config/types`, `/config/facets` and `/config/schemas`, cached for the application's lifetime). Until it arrives, or if the server refuses it, only the four stock names count. The same rule decides which types the Import tab offers for files.

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

| Field           | Value                                                                                                                                                                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service**     | `DocumentLayoutService` (`libs/shared/document-layouts/src/lib/document-layout.service.ts`)                                                                                                                                                                                                                                            |
| **Method**      | `layoutFor(type, mode, documentSchemas)`, per document shown; `vocabularyLabel(directory, id)`, per vocabulary value shown; each read below is cached for the session, but `linkedRecords(ids)`, per page or list                                                                                                                      |
| **HTTP Method** | `GET`                                                                                                                                                                                                                                                                                                                                  |
| **Endpoints**   | `/nuxeo/agentic-ui-config/layouts.json` and `/nuxeo/agentic-ui-config/layouts/<type>/<mode>.layout.json` — without interceptors, no `Authorization` header                                                                                                                                                                             |
|                 | `/nuxeo/api/v1/config/types/<type>` with header `fetch-schema: fields` — authenticated, through `NuxeoApiBase`                                                                                                                                                                                                                         |
|                 | `/nuxeo/api/v1/config/schemas/<schema>` with header `fetch-schema: fields`, for a schema a dynamic facet added to the document — authenticated, through `NuxeoApiBase`                                                                                                                                                                 |
|                 | `/nuxeo/api/v1/directory/<directory>/<entry id>` with headers `translate-directoryEntry: label` and `Accept-Language: en` — authenticated, through `NuxeoApiBase`. For an `l10n…` value the entry id is the **last segment** of the stored path, not the path: `art/architecture` is read as `architecture`, then `art` for its parent |
|                 | `/nuxeo/api/v1/search/lang/NXQL/execute` with `queryParams`, for the records `document-link` values name (below) — authenticated, through `NuxeoApiBase`                                                                                                                                                                               |
| **Server side** | `AgenticUiConfigServlet` (from `<layout>` contributions to `org.nuxeo.agentic.ui.config`); Nuxeo's type registry and directories                                                                                                                                                                                                       |

The layout URLs sit beside `bootstrap.json` (from `APP_BOOTSTRAP_CONFIG_URL`), so under `nx serve`
they are `/agentic-ui-config/layouts.json` and `/agentic-ui-config/layouts/…`, written by
`npm run config:dev -- --layout <Type>/<mode>=<file>`. Like the bootstrap reads, they skip the
interceptors: no `Authorization` header, and they do not count as activity for the idle timer.
They are not anonymous, though: being same-origin, they carry the browser's cookies, a signed-in
session's included. The server answers every user with the same files either way.

`layouts.json` lists `{ type, mode, url, component, bundle, source }` per layout in force, plus the
server's `diagnostics`, and may list in `labels` the languages a business app's labels are served
in (`docs/business-apps/app-definition-v2.md`, section 7). `AppTranslateLoader` reads the index for
that list at startup, once per session and without the interceptors like every other read of this
address, only when the configuration service answered for the bootstrap; it then asks for
`labels/<lang>.json` only in a language the list names.
Today's servlet lists none; `npm run config:dev -- --labels` lists those it serves. A layout file is fetched only when the index lists its type and mode, and
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
panel's own vocabulary rows are. An entry that cannot be read shows the stored id, says so in
the console, and is asked for again by the next document that shows it.

A hierarchical `l10n…` field (`dc:subjects`, `dc:coverage`) stores the **path** through the
vocabulary, `art/architecture`, while the entry carries only the leaf as its id —
`architecture`, whose `parent` is `art`. So the read is by that leaf, and the path is never a
path segment: Tomcat refuses the encoded slash with HTTP 400, and the unencoded form is a
different resource that answers 404 (NXSAT-726). The label is still composed from the stored
path, which is what names the parent. Both the formatter and the stock vocabularies are two
levels deep; a deeper path labels as the stored id.

**A `document-link` value** (`docs/business-apps/layout-v2.md`, section 11) is shown by the title of
the record it names, read by `linkedRecords(ids)`: `GET /nuxeo/api/v1/search/lang/NXQL/execute`,
authenticated through `NuxeoApiBase`, with `query` set to
`SELECT * FROM Document WHERE ecm:uuid IN (?, …)`, one `?` per id, each id sent as a `queryParams`
value of its own, which Nuxeo quotes before the query runs, and `pageSize` the number of ids. No
`properties` header: the title, type, path and facets come with every record. Only a value that is
an `ecm:uuid`, a lower-case UUID, is ever sent; one search asks for 100 at most. It is not cached
by the service: `LinkedRecordLookup` asks once per page or list for the ids each new set adds, and
keeps what it read for that page's life. The record page provides one, which its lists share, and
so do the form and the Properties panel; a queue's list has its own. So a document page showing
both a record page and the panel, as a Case's does, sends one search for each. A record the reader may not read, or that no longer exists, is not returned, and shows
"Unavailable". A failed search is logged and asked again by the next set that names its ids.

The Properties panel has no widgets: it reads a property as a reference when `/config/types/<type>`
reports a `documentResolver` among its `constraints` (`itemConstraints` for a list) whose `store`
is `id` or `idOnly`. Nuxeo reports `id` for a resolver given no `store` too. One that stores a
path, `path` or `pathOnly`, is shown as stored. A value written `<repository>:<id>`, as Nuxeo's
resolver writes one for `store` `id`, is not sent, and shows "Unavailable", as it does in a
`document-link`.

**Usage:** the Properties panel on document detail (`metadata` mode), for the vocabulary labels
and the linked records its values name; the record page, its lists and the queues (`view` mode),
for the vocabulary labels, the user and group names and the linked records their values name.

---

## 30. Permissions Panel — ACL Read and Per-Entry Writes (NXSAT-308)

| Field           | Value                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service**     | `NxsPermissionsService` (`libs/shared/satori-components/src/lib/permissions-panel/permissions-panel.service.ts`), over `DocumentDetailService`                                          |
| **Read**        | `GET /nuxeo/api/v1/id/:uid` with `enrichers.document=acls,permissions,userVisiblePermissions,allowedTransitions` and `fetch-acls: username,creator,extended` (`getDocumentPermissions`) |
| **Add**         | `POST /nuxeo/api/v1/automation/Document.AddPermission` — `username`, `permission`, `begin`, `end`, `notify: false` (`addPermission`)                                                    |
| **Edit**        | `POST /nuxeo/api/v1/automation/Document.ReplacePermission` — `id`, `username`, `permission`, `begin`, `end`, `notify: false` (`replacePermission`)                                      |
| **Remove**      | `POST /nuxeo/api/v1/id/:uid/@op/Document.RemovePermission` — `id`, `acl` (`removePermissionById`)                                                                                       |
| **Inheritance** | `Document.BlockPermissionInheritance` / `Document.UnblockPermissionInheritance` on `/id/:uid/@op/…`                                                                                     |
| **Users**       | `POST /nuxeo/api/v1/automation/UserGroup.Suggestion` (`searchUsersGroups`)                                                                                                              |

**The permission list comes from two enrichers, because neither is enough alone.**
`userVisiblePermissions` is the server's list for the document type, from the `permissionsVisibility`
extension point: `Read`, `ReadWrite`, `Everything` on a stock workspace, plus `CanAskForPublishing`
on a section root. `permissions` lists every permission the server defines **that the caller
holds** — 33 on 2025.26.16 for a holder of `Everything`, 9 for a manager holding only
`WriteSecurity`. By default (`offer: 'type'`) the panel offers only the first list, as Web UI does. The
checkbox **All permissions** adds the standard grants (`Write`, `ReadVersion`, `WriteVersion`,
`AddChildren`, `RemoveChildren`, `Remove`, `Version`, `WriteSecurity`, `Unlock`, `SetRetention`,
`UnsetRetention`), then the rest of the second list. It filters the standard grants by the second list
only when that list includes `Everything`, since only then is it the full set. With `offer: 'all'` the
checkbox starts ticked and stays on. A type that suggests nothing offers `Read`, `ReadWrite` and
`Everything`, so no select is left empty.

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

## 30a. Pickers — the `nxs-` picker and input components (NXSAT-308)

| Picker                         | Service and method                                                       | Endpoint                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `nxs-user-group-picker`        | `DocumentDetailService.searchUsersGroups` (users and groups)             | `POST /nuxeo/api/v1/automation/UserGroup.Suggestion` — `searchTerm`, `searchType: USER_GROUP_TYPE` |
| `nxs-user-group-picker`        | `UserService.searchUsers` / `searchGroups` (`search="users"`/`"groups"`) | `GET /nuxeo/api/v1/user/search?q=` / `GET /nuxeo/api/v1/group/search?q=`                           |
| `nxs-vocabulary-select`        | `DirectoryService.getEntries` (flat vocabularies)                        | `POST /nuxeo/api/v1/automation/Directory.SuggestEntries`                                           |
| `nxs-vocabulary-select`        | `DirectoryService.getAllL10nEntries` (`l10n*` vocabularies)              | `GET /nuxeo/api/v1/directory/:name?pageSize=50&currentPageIndex=n`                                 |
| `nxs-tag-input`                | `TagService.suggestTags` — **new**                                       | `POST /nuxeo/api/v1/automation/Tag.Suggestion` — `searchTerm`                                      |
| `nxs-document-reference-input` | `NuxeoApiBase.nxqlSearch`, query from `nxsDocumentSuggestionQuery()`     | `GET /nuxeo/api/v1/search/lang/NXQL/execute?query=…&pageSize=20`                                   |

**Each search follows Web UI's widget it replaces:** three characters before the user, group and
document searches run, one for tags, 300 ms after the last key; twenty documents per search. The
document query is Web UI's `default_document_suggestion` page provider's — `ecm:fulltext LIKE
'<term>*'`, not hidden, not a version, not trashed — with the term and any document type escaped by
`escapeNxqlLiteral`, so they stay text in the query. A uid (or path) the form already holds is looked
up with `SELECT * FROM Document WHERE ecm:uuid = '<uid>'` (or `ecm:path`), page size 1, escaped the
same way.

**The tag input does not use `TagService.searchTags`:** it reads
`/api/v1/directory/label_tag_entry`, which Nuxeo 2025 answers with
`404 Directory label_tag_entry was not found` (measured 2026-10-13), so it never suggests anything.
`suggestTags` uses the operation Web UI uses, which answered the same server, and is the one place
that sends it: the search filters' tags reach it through `SearchService.getTagSuggestions`, and
document detail and Browse's `nxs-tag-editor` call it directly. Both editors save every add and
remove immediately and apply the returned tags to their document state.

`nxs-date-input` makes no request.

**Usage:** Add permission and saved-search sharing use `nxs-user-group-picker`, with its default
three-character minimum. A selected `NxsPrincipal` supplies the raw username or group id for both
document and saved-search permission writes — never its label, which is a display name — and its
kind for the saved-search entry's `grantedBy`. Editing the text clears the selection; failed
searches remain retryable in the picker. Browse and document detail use `nxs-tag-editor` for
immediate saves, with `canTagDocument` controlling read-only state. Its writes are queued by
`provideNxsTagWrites()` in the app config, so closing the panel or moving to another document
mid-write neither cancels a change nor drops the ones behind it.
`nxs-tag-input` remains a form control for labels that are saved with a form.

**Why three characters, not one (NXSAT-654).** `UserGroup.Suggestion` does not cap its answer: it
returns every user and group matching the term, and the picker renders each one as an option. A
one-character term therefore asks for a large share of the directory on the first pause. The only
measurement made for this change was on the local Nuxeo directory of eight users: a one-character
search took 9 to 30 ms, which says nothing about the cost on a large directory. Three is also Web
UI's default for the saved-search dialog and document suggestion, so the minimum stays at three.
The picker's `minChars` input sets a different value where a smaller directory needs one.

---

## 30b. Permission Dialogs — External Shares, Edit and Delete (NXSAT-308)

| Field       | Value                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service** | `DocumentDetailService`, called by `nxs-share-external-dialog`, `nxs-update-permission-dialog` and `nxs-delete-permission-dialog` (`libs/shared/satori-components/src/lib/`)  |
| **Share**   | `POST /nuxeo/api/v1/automation/Document.AddPermission` — `email`, `permission`, `begin`, `end`, `comment`, `notify: false` (`addExternalPermissionWithNotification`)          |
| **Notify**  | then `POST /nuxeo/api/v1/automation/Document.SendNotificationEmailForPermission` — `id` of the new entry, so a mail failure reaches the dialog                                |
| **Edit**    | `POST /nuxeo/api/v1/automation/Document.ReplacePermission` — `id`, `username`, `permission`, `begin`, `end`, `comment`, `notify: false`, then the notification when asked for |
| **Delete**  | `POST /nuxeo/api/v1/id/:uid/@op/Document.RemovePermission` — `id`, `acl` (`removePermissionById`)                                                                             |

**Behaviour measured on 2025.26.16:**

- `AddPermission` with `email` creates the principal `transient/<email>` and marks the entry
  `externalUser`. Dates in the past are accepted, and the entry reads back with status `archived`.
- `ReplacePermission` edits an external entry in place: it keeps `externalUser` and its status, so
  the dialog no longer removes and re-adds it. An unchanged date is written back as the instant the
  read returned, as in the panel, so an end written as `2030-07-15T00:00:00+02:00` (which reads back
  as `2030-07-14T22:00:00.000Z`) survives an edit made from another zone.
- `RemovePermission` with `id` and the entry's own `acl` removes that one entry, including a deny.
- `Document.AddACE` with `grant: false` replaces the **whole** local ACL with the one deny it
  writes. The app does not call it; test seeding that does must add the other entries afterwards.

A new date is sent as the day (`2030-01-31`), which Nuxeo anchors at the server's midnight, as the
panel's are. Web UI sends the end as the end of that day in the browser's zone, so a share Web UI
writes lasts through its last day and one written here ends as that day starts.

Every date is shown as the calendar day its writer picked (`nxsAceTimeFrame`), not the UTC date
Nuxeo returns, so the Permissions tab's card, the panel and all three dialogs show the same day.
That includes an end Web UI wrote: `moment(end).endOf('day').format()` is 23:59:59 in the browser's
zone, one second before the next day starts, and is shown as its last day rather than the next.

**Usage:** the external-shares card on document detail's Permissions tab. The manifest's
`featureToggles["permissions.externalUsers"]` hides the card and its share action when `false`.

---

## 30c. Versions — List, Create, Restore and Publish a Version (NXSAT-308)

| Field       | Value                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service** | `DocumentDetailService`, called by `nxs-manage-versions`, `nxs-create-version-dialog` (`libs/shared/satori-components/src/lib/`) and document detail       |
| **List**    | `POST /nuxeo/api/v1/id/:liveUid/@op/Document.GetVersions`, header `properties: *` (`getVersionsDirect`) — the live document's, also when a version is open |
| **Create**  | `POST /nuxeo/api/v1/id/:uid/@op/Document.CreateVersion` — `increment: Minor \| Major`, `saveDocument: true` (`createVersion`)                              |
| **Restore** | `POST /nuxeo/api/v1/id/:versionUid/@op/Document.RestoreVersion` — `checkout: false` (`restoreVersion`)                                                     |
| **Publish** | `POST /nuxeo/api/v1/automation/Document.PublishToSection` — input the document on screen, a version included (`publishDocument`)                           |

**Behaviour measured on the shared Nuxeo (2026-10-13):**

- `Document.GetVersions` reads the repository, so a version created a moment before is listed;
  the NXQL list (`getVersions`) is OpenSearch-backed and may lag. It returns them oldest first;
  `nxs-manage-versions` sorts them by number, newest first, as Web UI does.
- A ReadWrite user's `permissions` enricher includes `WriteVersion`; Read plus WriteProperties
  does not. Create, restore and publish are gated on `WriteVersion`, as Web UI gates them.
- `Document.RestoreVersion` with `checkout: false` leaves the live document checked in at the
  restored number (0.1, not 0.1+).
- `Document.PublishToSection` on a version, as a ReadWrite user, returns 200 and creates a
  publication of that version (1.0) in the section. Web UI 2025.21.0's `isPublishable` offers it.
- A comment on a version (`POST /id/:versionUid/@comment`) is accepted (201), as Web UI's thread
  allows.
- A version's publications are found through its live document: a proxy's
  `ecm:proxyVersionableId` is the live document's uid, so the count on a version asks with that
  (`getPublishedVersions`), as Web UI's `nuxeo-document-publications` resolves the source first.

**Usage:** the version control in document detail's properties panel, the version banner's
Restore, and the Publish action on the live document and on a version.

---

## 31. Search — `default_search`, Saved Searches and Tag Suggestions

| Field             | Value                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service**       | `SearchService` (`libs/shared/nuxeo-client/src/lib/services/search.service.ts`)                                                                         |
| **Search**        | `GET /nuxeo/api/v1/search/pp/default_search/execute` (`search`), `enrichers.document=favorites`                                                         |
| **Saved: list**   | `GET /nuxeo/api/v1/search/saved?pageProvider=default_search` (`getSavedSearches`)                                                                       |
| **Saved: read**   | `GET /nuxeo/api/v1/search/saved/:id` (`getSavedSearchById`)                                                                                             |
| **Saved: create** | `POST /nuxeo/api/v1/search/saved` — `entity-type`, `pageProviderName`, `title`, `params` (`saveSavedSearch`)                                            |
| **Saved: save**   | `PUT /nuxeo/api/v1/search/saved/:id` — the same body (`updateSavedSearch`)                                                                              |
| **Saved: rename** | `PUT /nuxeo/api/v1/search/saved/:id` — `entity-type`, `pageProviderName`, `title`, **no** `params` (`renameSavedSearch`)                                |
| **Saved: delete** | `DELETE /nuxeo/api/v1/search/saved/:id` (`deleteSavedSearch`)                                                                                           |
| **Permissions**   | `GET /nuxeo/api/v1/id/:id` with `enrichers.document=permissions` — `WriteProperties` gates Save, Rename, Share and Delete                               |
| **Collections**   | `POST /nuxeo/api/v1/automation/User.GetCollections` (`getUserCollections`)                                                                              |
| **Tags**          | `POST /nuxeo/api/v1/automation/Tag.Suggestion` — `searchTerm` (`getTagSuggestions`, through `TagService.suggestTags`); answers `[{ id, displayLabel }]` |

**The filters are `default_search`'s own parameters**, as Web UI's search form sends them: full text
on `ecm_fulltext` (dashes turned into spaces, as Web UI's `formatFulltext` does, since Nuxeo reads
`-word` as an exclusion), and JSON arrays on `dc_modified_agg`, `dc_creator_agg`, `ecm_collections`,
`ecm_tags`, `dc_nature_agg`, `dc_subjects_agg`, `dc_coverage_agg` and `common_size_agg`. The answer's
`aggregations` give each filter its choices and counts, so the filters need no request of their own.

**Paging.** The search page sends `currentPageIndex`, `offset` (`pageIndex × pageSize`) and `pageSize`
(40 on the search page). The answer's `resultsCount` is the total across every page, and
`isNextPageAvailable` says whether a page follows; `SearchService.search` returns them as `totalSize`
and `hasNextPage`. Measured on the local 2025 instance with 25 matches, `resultsCount` was 25 at page
sizes 10, 20 and 40, and with 50 matches at page size 40 it was 50, so the count is the server's
total and not the rows on screen. This is unlike `@children`, whose count is only exact within one page.

Measured on the local 2025 instance:

- `ecm_collections` is the collection filter. `collection_agg` is not a parameter (the server ignores
  it), and the collection id on `dc_coverage_agg` — which this client sent until NXSAT-308 — filtered
  coverage on an id and answered no results.
- The modification-date buckets are `last24h`, `lastWeek`, `lastMonth`, `lastYear` and
  `priorToLastYear`. An unknown key such as the earlier `moreThan1YearAgo` is ignored, so it returned
  every document; the client maps it to `priorToLastYear`.
- A saved search's `params` are matched to the saved-search document's own fields by name: `subjects`
  is refused with `400` (it is read as `dc:subjects`, a list) and `size` with `501` ("Removed
  properties don't have field"). Saved searches are therefore written under the page-provider names
  above, which also lets Web UI open them; searches saved earlier under `modifiedDate`, `nature` and
  the other short names are still read.
- A list parameter may be sent as a JSON array or as a JSON-array string; it is stored and read back
  as an array.
- A `PUT` without `pageProviderName` is refused with `400`; with it and without `params` the stored
  parameters are kept, which is what renaming relies on.
- A saved search is a document named after its title, so a title with `/` is refused with `400`
  ("A DocumentModel's name cannot contain slash character"). The name dialog refuses it first, with
  Web UI's message.
- The server drops the short names `nature` and `coverage` at save time — it maps them onto the
  saved-search document's own `dc:nature` and `dc:coverage` — so searches saved under them never kept
  those two filters.
- A `PUT`'s `params` are merged into the stored ones: a parameter left out keeps its saved value. So
  Save writes every filter parameter, an empty one as `[]` or `""`, as Web UI writes its whole form;
  without that, a filter the user removed stayed in the saved search.

**Usage:** the search page and the search drawer, through `SearchSession`
(`libs/features/search/src/lib/search-session/search-session.ts`), which sends one request per change
of the query for both; `nxs-search-filters` for collections and tags; `nxs-saved-search-select` for the
list; `nxs-saved-search-actions` for the permission read.

---

## 32. Home — `home.json` and the KPIs' Page Providers

| Field           | Value                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service**     | `HomeService` (`libs/shared/home/src/lib/home.service.ts`)                                                                                                                            |
| **Method**      | `load()`, once per visit of `/home`; `results(kpi)`, once per page provider and parameters that a card the person sees reads                                                          |
| **HTTP Method** | `GET`                                                                                                                                                                                 |
| **Endpoints**   | `/nuxeo/agentic-ui-config/home.json` (`/agentic-ui-config/home.json` under `nx serve`) — without interceptors, no `Authorization` header                                              |
|                 | `/nuxeo/api/v1/search/pp/<pageProvider>/execute` — authenticated, through `NuxeoApiBase`                                                                                              |
|                 | Where that is 404: `/nuxeo/agentic-ui-apps/apps/<id>/home.json`, the app registry's, for the app open (section 36) — authenticated, through the interceptors                          |
| **Server side** | For `home.json`: `npm run config:dev -- --home <file>` under `nx serve`, and the app registry on a server; the configuration servlet answers 404. Nuxeo's page providers for the KPIs |

**Query parameters of the page provider read:**

| Parameter          | Value                                                               |
| ------------------ | ------------------------------------------------------------------- |
| `pageSize`         | `1`: a KPI reads `resultsCount` and `aggregations`, not the records |
| `currentPageIndex` | `0`                                                                 |
| `queryParams`      | The KPI's `parameters`, one each, in order; none when it has none   |

**Request headers:** `properties: dublincore`.

**Notes:**

- `aggregations.<id>.buckets` holds `{ key, docCount }` for each bucket. Only a page provider the
  search index serves has aggregates; one that queries the repository, such as `tree_children`,
  answers `aggregations: null`, and the card says its figure is unavailable. Measured on the local
  server: `default_search` answers six aggregates; an unknown page provider answers HTTP 500.
- A terms aggregate returns no bucket for a key no record has, so a KPI on that bucket is 0, unless
  it returned as many buckets as its `size` (`properties.size`, 10 when unset): then the bucket may
  be one it left out, and the card says its figure is unavailable.
- The server reads `queryParams` as a list, one value per parameter, and splits none on commas
  (`QueryExecutor.getParameters`, `nuxeo-search-rest-api` 2025.10.18). It replaces a value
  `$currentUser` with the signed-in user's name.
- `resultsCount` is negative (`-2`) when a page provider does not count its results, as
  `tree_children` does; the card says its figure is unavailable.
- The counts are the signed-in person's: a user in `members` only counted 2,167 records of
  `default_search` where an administrator counted 2,249.

**The menu, `navigation.json`:** `HomeService.loadNavigation()` reads
`/nuxeo/agentic-ui-config/navigation.json` (`/agentic-ui-config/navigation.json` under `nx serve`)
the same way, the development server's address first and the app registry's where that is 404
(section 36), once, at startup: `startAppMenu`
(`apps/nuxeo-ui/src/app/business-apps.menu-start.ts`), an `APP_INITIALIZER`, loads
`registerAppMenu` (`business-apps.menu.ts`) lazily, which waits for the configuration to load before
it reads anything, since `NuxeoApiBase` keeps the API origin it first reads.
`npm run config:dev -- --navigation <file>` serves the file under `nx serve`, and the app registry
on a server; where neither does, the platform's menu shows alone. For each entry that opens a queue and has no literal name of its own,
it then reads `queues/<id>.json` once (section 33), for the queue's name. **Startup waits for all
of it**: the menu's chunk, the file, then the queues' files, each read with the home's 10-second
timeout. It never rejects, not even when the chunk cannot be fetched: the platform's menu shows,
and the console says why.

**Used by:** `HomePageComponent` (`libs/shared/home/src/lib/home-page/home-page.ts`), at `/home`;
`registerAppMenu`, at startup, for the menu.

---

## 33. Queues — `queues/<id>.json` and the Queue's Page Provider

| Field           | Value                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service**     | `QueueService` (`libs/shared/queues/src/lib/queue.service.ts`) for the file; `PageProviderService` (`libs/shared/nuxeo-client/src/lib/services/page-provider.service.ts`) for the list |
| **Method**      | `load(id)`, once per visit of `/queues/<id>`; `execute(pageProvider, request)`, once per page, order or choice of buckets while the queue is shown                                     |
| **HTTP Method** | `GET`                                                                                                                                                                                  |
| **Endpoints**   | `/nuxeo/agentic-ui-config/queues/<id>.json` (`/agentic-ui-config/queues/<id>.json` under `nx serve`) — without interceptors, no `Authorization` header                                 |
|                 | `/nuxeo/api/v1/search/pp/<pageProvider>/execute` — authenticated, through `NuxeoApiBase`                                                                                               |
|                 | Where that is 404: `/nuxeo/agentic-ui-apps/apps/<id>/queues/<queue>.json`, the app registry's, for the app open (section 36) — authenticated, through the interceptors                 |
| **Server side** | For the file: `npm run config:dev -- --queue <file>` under `nx serve`, and the app registry on a server; the configuration servlet answers 404. Nuxeo's page provider for the list     |

**Query parameters of the page provider read:**

| Parameter                | Value                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `pageSize`               | The queue's `pageSize`, 10 when it has none                                                                                      |
| `currentPageIndex`       | The page on screen, from 0                                                                                                       |
| `queryParams`            | The queue's literal `parameters`, one each, in order; none when it has none                                                      |
| `sortBy`, `sortOrder`    | The queue's `sort`, or the header chosen; none when neither                                                                      |
| `<aggregate>`, per facet | The buckets chosen in that facet's aggregate, as a JSON array: `dc_creator_agg=["nxsat332-writer"]`; none when nothing is chosen |

**Request headers:** `properties: *`, `enrichers.document: permissions`.

**Notes:**

- A chosen bucket is sent as the search page sends its filters (`SearchService.search`). Measured on
  the local server with `default_search`, as an administrator: `dc_creator_agg=["nxsat332-writer"]`
  returns that author's 12 records only, and the response echoes the choice in
  `aggregations.<id>.selection`. Two keys of one aggregate are alternatives:
  `dc_nature_agg=["application"]` and `["article"]` return 1 record each, and
  `["application","article"]` returns 2. Aggregates together keep the records in all of them: that
  author and `dc_modified_agg=["last24h"]` return none.
- `aggregations.<id>.extendedBuckets` holds the buckets and the chosen ones that now hold no
  record, at `docCount: 0`; the facets read it first, so a chosen bucket can still be cleared. An
  aggregate's own counts are worked out with the other aggregates' choices and not its own.
- `PageProviderService` refuses, without a request, an aggregate named as the search's own
  parameters (`pageSize`, `sortBy`, `queryParams`, `properties` and others), or with a `.` or a
  `-`, which the rendering parameters use: it would change the request rather than filter it.
- A page provider that queries the repository answers no aggregates, so its facets are not drawn.

**Used by:** `QueuePageComponent` (`libs/shared/queues/src/lib/queue-page/queue-page.ts`), at
`/queues/<id>`, through `RecordListComponent`
(`libs/shared/document-layouts/src/lib/record-page/record-list.ts`).

---

## 34. Queues — a bulk action over every result, through the Bulk Action Framework

| Field           | Value                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Service**     | `BulkCommandService` (`libs/shared/nuxeo-client/src/lib/services/bulk-command.service.ts`)                                    |
| **Methods**     | `runOverPageProvider(pageProvider, query, action, actionParameters)`, `status(commandId)`, `abort(commandId)`                 |
| **HTTP Method** | `POST`, then `GET` every 200 ms until the server has counted, then once a second, and `PUT` to stop                           |
| **Endpoints**   | `/nuxeo/api/v1/search/pp/<pageProvider>/bulk/<action>` — the command over the page provider's whole result, answered HTTP 202 |
|                 | `/nuxeo/api/v1/bulk/<commandId>` — its status                                                                                 |
|                 | `/nuxeo/api/v1/bulk/<commandId>/abort` — stops it                                                                             |
| **Server side** | Nuxeo's Bulk Action Framework (`nuxeo-core-bulk`) and the REST bundle's `BulkActionObject`                                    |

**Query parameters of the command:** `queryParams`, the queue's literal `parameters`, one each, in
order, as the list sends them, and `queryLimit`, one more than the number the person agreed to.
Nothing else: no page, order or bucket.

**Body:** the action's parameters, from the platform's table and never from a file
(`wholeQueryBulkAction`, extension-reference.md, section 5): `{ "value": true }` for `trash`.

**Response (the submission and every status read):**

```json
{
  "entity-type": "bulkStatus",
  "commandId": "1e0ad81f-3592-4ad2-9878-023539dd2733",
  "state": "RUNNING",
  "processed": 1000,
  "total": 2314,
  "errorCount": 0,
  "skipCount": 0,
  "error": false,
  "action": "setProperties",
  "username": "Administrator",
  "submitted": "2026-11-23T17:45:06.262Z",
  "scrollEnd": "2026-11-23T17:45:06.468Z",
  "completed": null
}
```

`state` goes `SCHEDULED`, `SCROLLING_RUNNING`, `RUNNING`, then `COMPLETED` or `ABORTED`. `total`
is `0` until the server has read the whole query. `errorMessage` appears with the first failure.
`result` holds what an action produces, such as `csvExport`'s `{ "url": "nxbigblob/<commandId>" }`.

**Measured on the local Nuxeo 2025.10.18, as an administrator (2026-11-23):**

- **The actions it registers**, from the bundles' `org.nuxeo.ecm.core.bulk` contributions. Opened
  over HTTP (`httpEnabled="true"`): `setProperties`, `csvExport`, `automation`, `automationUi` and
  `publicAction`, and the HxAI connector's `ingest` and `nucleusMapping`. Registered but not opened:
  `trash`, `removeProxy`, `setSystemProperties`, `deletion` and about twenty internal ones.
- **Who may run what.** `BulkActionObject` answers HTTP 403, `Action name: <action> is not exposed
to HTTP`, to anyone but an administrator for an action not opened over HTTP. A command's status
  and stopping it are allowed to the person who ran it and to administrators only. Not measured as a
  person who is not an administrator: no such account was used.
- **Parameters.** The command reads the page provider's parameters as the list does: `member_claims`
  given a member's id counted 3 records in the list and 3 in the command. A named parameter, such as
  `ecm_parentId` for `advanced_document_content`, is applied too.
- **What it leaves out, silently.** A chosen bucket (`dc_last_contributor_agg=["nobody-at-all"]`):
  the list counted 0 and the command 3. A `queryParams` value for a page provider that takes none:
  the command ran over the provider's whole result, 2,314 records instead of 3. Neither is an
  error. So the page never sends a bucket, does not offer every result while one is chosen, and
  limits the command.
- **`queryLimit` caps the command.** `SearchObject` reads it and the command builder applies it:
  over `member_claims`'s 3 records, `queryLimit=2` read and processed 2, and `4` processed 3. The
  page sends one more than agreed, so a widened command processes that many at most, and its
  `total` above the agreed number says it was widened. Measured live: 5,010 agreed, 5,015 on the
  server, 5,011 trashed and 4 untouched.
- **Speed.** `trash` over 5,010 notes went from the end of the scroll to `completed` in 70 ms, so
  stopping a command once its `total` is known comes too late for it: the limit is what bounds it.
  5,000 records showed `4,900 of 5,000` at the page's first read after the count.
- **Refusals at submission.** An action the server does not know: HTTP 400 with no body. A
  `setProperties` property that does not exist: HTTP 400, `Unknown xpath …`. A page provider that
  does not exist: HTTP 500, a `NullPointerException`.
- **A parameter missing.** `trash` sent without `value` is taken (HTTP 202), then fails on its first
  record, and the failure **stops the server's `trash` processor** until Nuxeo restarts: the command
  stays `RUNNING` at 0 processed, and every later `trash` command waits behind it. That is why the
  platform's table fixes the parameters.
- **Stopping.** `PUT …/abort` answers `ABORTED` at once with the count so far; the batches already
  started still finish and still count, and `completed` is written when they have. Measured:
  `ABORTED` at 1,000 processed, final at 2,100 of 2,314.
- **An answer that is not a status.** A 202 whose body is not a `bulkStatus` leaves the page unable
  to tell whether the command runs: it says so, and reads the list again, rather than reporting a
  refusal.
- **The list after a command.** A page provider the search index serves may still hold the records
  a command changed when it completes, so the page reads the list again at the end and once more
  three seconds later, and offers no count until the second read has answered. Measured over 42 records on `document_content`, the list read at the end
  was already empty; the larger runs were not checked for it.
- **Counts.** A page provider counts its results, so `resultsCount` is a real total for
  `payers_unassigned_claims`, `member_claims` and `default_search`. One that answers `-2` cannot
  have every result selected.

**Used by:** `QueuePageComponent` (`libs/shared/queues/src/lib/queue-page/queue-page.ts`), through
`runWholeQuery` (`libs/shared/queues/src/lib/whole-query-run.ts`).

---

## 35. Notification Bell — Open Tasks, Followed Records and Their Audit

| Field           | Value                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service**     | `NotificationSources` (`libs/shared/notifications/src/lib/notification-sources.ts`), through `TaskService`, `NuxeoApiBase` and `DocumentDetailService`    |
| **Method**      | `tasks(user)`, `followed(user, since, page)` and `changes(wanted, audit)`, at each check: every 60 seconds by default (`notifications.pollIntervalMs`)    |
| **HTTP Method** | `GET` for the tasks and `@audit`; `POST` for the two Automation operations                                                                                |
| **Endpoints**   | `/nuxeo/api/v1/task?userId=<user>&pageSize=100` with `X-NXfetch.task: targetDocumentIds,actors`, then `&offset=100` for the rest when Nuxeo has more (§3) |
|                 | `/nuxeo/api/v1/automation/Repository.Query`, with `properties: dublincore`                                                                                |
|                 | `/nuxeo/api/v1/automation/Audit.QueryWithPageProvider`, for an administrator                                                                              |
|                 | `/nuxeo/api/v1/id/{uid}/@audit?startEventDate=…&eventId=documentModified&eventId=lifecycle_transition_event`, for anyone else, per record                 |
| **Context**     | `backgroundRequestContext()` on every request: the idle timer does not count them                                                                         |

**Followed records** — the documents whose `notif:notifications` list the reader, the property
`Document.Subscribe` writes:

```json
{
  "params": {
    "query": "SELECT * FROM Document WHERE notif:notifications/*/subscribers/* = ? AND ecm:isTrashed = 0 AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND dc:modified > TIMESTAMP '<seven days ago, ISO>'",
    "queryParams": ["user:<user>"],
    "pageSize": 20,
    "currentPageIndex": 0,
    "sortBy": "dc:modified",
    "sortOrder": "DESC"
  },
  "context": {}
}
```

**Changes, for an administrator** — one request for every followed record whose `dc:modified` moved:

```json
{
  "params": {
    "query": "SELECT * FROM LogEntry WHERE docUUID IN (?, ?) AND eventId IN (?, ?) AND eventDate >= TIMESTAMP '<earliest lower bound, ISO>'",
    "queryParams": ["<uid>", "<uid>", "documentModified", "lifecycle_transition_event"],
    "pageSize": 50,
    "currentPageIndex": 0,
    "sortBy": "eventDate",
    "sortOrder": "DESC"
  },
  "context": {}
}
```

**Notes** (measured on the local Nuxeo 2025.10, 2026-11-23):

- **There is no notification API.** `/api/v1/notification`, `/api/v1/me/notifications` and
  `/api/v1/me/subscriptions` answer 404, so the bell reads tasks, subscriptions and the audit.
- **`Repository.Query`, not the search endpoint.** The search endpoint is served by the search
  index: for the same subscriber query it reported `resultsCount: 37` and returned no entries,
  where the repository returned the 10 live records. A record followed a moment ago must be there.
- **The audit query is for administrators only.** `nuxeo-automation-features`'
  `bindings-contrib.xml` binds `Audit.QueryWithPageProvider` (and `Audit.Query`) with
  `<administrator>true</administrator>`; anyone else gets **404**, not 401, so a refusal never ends
  the session. Every audit page provider on the server (`EVENTS_VIEW`, `DOCUMENT_HISTORY_PROVIDER`,
  `ADMIN_HISTORY`) is reached only through that operation, or one record at a time through `@audit`.
  So a reader who is not an administrator gets one `@audit` read per followed record that changed,
  four at a time. A 404 or 403 from the operation switches the reader to those reads for the session.
- **Values go as `queryParams`**, which Nuxeo quotes: a quote in a user id or a uid is a value, and
  `IN (?, ?)` takes one placeholder per value. An instant goes as a `TIMESTAMP '…'` literal, the form
  `nxql.utils.ts` documents, written from `toISOString()` with its zone and checked
  (`timestampLiteral`); a quoted ISO string also answered here, but may not on another repository
  backend. `sortBy`/`sortOrder` order
  the audit query; an `ORDER BY` in its text is ignored. `NOT IN` answers 500; `!=` works.
- **Pages.** `currentPageIndex` pages both operations. A check reads the next page of followed
  records only while the whole of the last one was modified after the newest `dc:modified` the last
  check saw (a change to many records at once), up to 5 pages; and the next page of the audit,
  query or `@audit`, while `isNextPageAvailable`, up to 4 pages of 50, so that the reader's own
  entries, which are read too, cannot crowd other people's out.
- **The task list is answered oldest first**, and `sortBy=created&sortOrder=desc` changes nothing,
  so the bell reads 100 and keeps the newest 20.
- **What moves `dc:modified`**, which is how the bell finds the records that changed: an edit, a
  comment (Nuxeo audits it as `documentModified` on its record) and a lifecycle transition do; a
  lock, an unlock, a check-in and a permission change do not. So the bell lists `documentModified`
  and `lifecycle_transition_event` only. An edit's audit entry is dated 0 to 3 ms after its
  `dc:modified`, and readable a second or so after the change, so a record whose audit has no entry
  at or after its `dc:modified` yet is read once more at the next check.
- The reader's own changes are read, and left out of the list on the client: they say whether the
  audit has caught up with a change the reader made. `principalName != ?` works in the audit query,
  but leaving them out there made every change of the reader's own look not caught up, and read it
  twice more.

**Used by:** `NotificationBellComponent` (`libs/shared/notifications`), in the shell's header.

---

## 36. App Registry — the Apps a Person May See, and Their Files

| Field           | Value                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Service**     | `AppRegistryService` (`libs/shared/app-registry/src/lib/app-registry.service.ts`), provided by the app as `APP_DEFINITION_FILES` (`apps/nuxeo-ui/src/app/business-apps.registry.ts`)       |
| **Method**      | `load()`, once per page, the first time a file of an app definition is read; `refresh()`, after a sign-in; `file(path, developmentUrl)`, for each file the engines read                    |
| **HTTP Method** | `GET`                                                                                                                                                                                      |
| **Endpoints**   | `/nuxeo/agentic-ui-apps/apps.json` — the apps the person may see                                                                                                                           |
|                 | `/nuxeo/agentic-ui-apps/apps/<id>/<path>` — a file of one of them, such as `home.json` or `queues/open.json`, as its package wrote it, with no envelope                                    |
| **Auth**        | Authenticated, through the interceptors (the person's `Authorization: Basic`, or the session cookie), with `X-No-Basic-Header: true` so that a 401 does not open the browser's own prompt  |
| **Server side** | `AgenticUiAppsServlet` in `nuxeo-agentic-core`, behind Nuxeo's authentication filter, with the REST API's chain, from each package's `<app>` contribution to `org.nuxeo.agentic.ui.config` |

**The listing:**

```json
{
  "format": "nuxeo-agentic-ui-config/1",
  "layer": "apps",
  "apps": [
    {
      "id": "payers-claims",
      "url": "apps/payers-claims/",
      "component": "nuxeo.config.payers-claims-demo",
      "bundle": "nuxeo.config.payers-claims-demo",
      "source": "agentic-ui-config/app.json",
      "files": ["app.json", "home.json", "navigation.json", "queues/unassigned-claims.json"],
      "content": { "version": 2, "id": "payers-claims", "groups": ["claims-adjusters"] }
    }
  ],
  "diagnostics": []
}
```

**Notes:**

- **Who sees an app:** the apps whose `app.json` names a group the person is in, every group Nuxeo
  counts them in (`NuxeoPrincipal.getAllGroups()`, nested and virtual groups included, so `members`
  is everyone signed in). An administrator sees what their groups give them. A request that does
  not authenticate is 401, as on a stock REST API. On a server that defines an anonymous user, a
  request with no credentials is `Anonymous` instead, in no app's group, and gets an empty list.
  The app ends no session on the registry's 401 either (`APP_REGISTRY_REQUEST`): the two are
  separate, and each holds without the other.
- **Seeing an app is not a security control.** An app definition holds no record. The queues,
  homes and record pages read records through the REST API, as the person, and Nuxeo's permissions
  decide what they show.
- **An app the person may not see is 404**, and so is a file its package does not name, a path the
  listing does not give, and any other address under `/nuxeo/agentic-ui-apps/`.
- **A 200, a 304 and a 404 are `Cache-Control: private, no-cache`** with
  `X-Content-Type-Options: nosniff`, so the browser revalidates and a shared cache keeps nothing; a
  200 and a 304 also carry an ETag, `Vary: Cookie, Authorization` and the configuration servlet's
  `Content-Security-Policy`. The servlet's own 401 is `no-store`. GET and HEAD only: anything else
  is 405, with an `Allow` header and no body.
- **Diagnostics** are the configuration envelope's: `level`, `code`, `message`, the `app` it is
  about, and the contribution's `component`, `bundle` and `source`. A person gets those the
  contribution in force made, from its own component and bundle, about the apps they see, not
  those of a version another package has replaced; an administrator gets all, those about a
  refused app included. None reaches the configuration servlet's own answers, which everyone reads
  before sign-in.
- **Where a file is read:** the development server's address first, past the interceptors, as
  before the registry and without waiting for the listing, and the registry's where that is 404
  and the app open lists the file. On a
  server the first address is the configuration servlet's, which answers 404 for every file of an
  app definition. A labels file is asked of the development server only in a language its
  `layouts.json` lists.
- **The app open:** the one last chosen in this browser, by whoever chose it, kept in `localStorage` under
  `agentic-ui.app-registry.app`, when the person may still see it, and else the first listed.
  "Switch app" in the settings menu offers the others; choosing one reloads the page. A sign-in
  whose listing opens another app reloads the page once, so that the menu and the labels read at
  startup are the new app's.
- **Measured on the local server** (Nuxeo 2025.10.18, 24 November 2026, with the Payers kit 0.3.0
  and its `<app>`): a user in `claims-adjusters` was listed `payers-claims` with its eight files,
  each served 200, and the listing again with its ETag was 304; a user in `members` alone, and
  `Administrator`, were listed no app, and the first got 404 for `payers-claims/home.json`; no
  credentials and a wrong password were 401 with no `WWW-Authenticate` under `X-No-Basic-Header`;
  POST was 405. That server ran the registry before its chain ended with `ANONYMOUS_AUTH`, so a
  request with no credentials there was 401, not `Anonymous`.

**Used by:** `HomeService` (the home and the menu), `QueueService` (a queue), `DocumentLayoutService`
(a task form), `AppTranslateLoader` (the labels), and the shell's "Switch app".

---

## 37. Layout Designer — a Record Page's File, the Content Model and Records to Preview With

| Field           | Value                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service**     | `LayoutDesignerService` (`libs/features/layout-designer/src/lib/layout-designer.service.ts`), with `DocumentLayoutService` and `ContentModelService`     |
| **HTTP Method** | `GET` only: the designer writes nothing to the server, and saves the file as a download                                                                  |
| **Endpoints**   | `<config>/layouts.json` and `<config>/layouts/<Type>/view.layout.json` — the record pages served, and one of them, each read anew, past the interceptors |
|                 | `/nuxeo/api/v1/config/types`, `/config/facets` and `/config/schemas` — the content model the file is held to, read once per session                      |
|                 | `/nuxeo/api/v1/config/types/<Type>` — the type the preview resolves the file against, as the record page reads it                                        |
|                 | `/nuxeo/api/v1/config/schemas/<name>` — a schema the record's facets add that the file names, as the record page reads it                                |
|                 | `/nuxeo/api/v1/search/lang/NXQL/execute` — the records of the type to preview with                                                                       |
|                 | `/nuxeo/api/v1/id/<uid>` — the record the preview draws, read as the document page reads it (`getFullDocument`)                                          |
| **Auth**        | The person's own, through the interceptors, but for the two configuration files, which the layout reads send with the session's cookies only             |

**The records query:**

| Parameter          | Value                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `query`            | `SELECT * FROM Document WHERE ecm:primaryType = ? AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:isTrashed = 0 ORDER BY dc:modified DESC` |
| `queryParams`      | The type, as a parameter: never written into the query's text                                                                                |
| `pageSize`         | `20`                                                                                                                                         |
| `properties` (hdr) | `dublincore`                                                                                                                                 |

**Notes:**

- **Administrators only, and not a security control.** The route is behind the administrator gate,
  and every read is the person's own, so Nuxeo's permissions decide what it returns.
- **The preview draws the record page read-only:** no comment box and no row action, so drawing it
  writes nothing. Its related lists, timeline and lookups read what they read on the View tab.
- **Measured on the local server** (Nuxeo 2025.10.18, 24 November 2026, with the Payers kit served by
  `npm run config:dev`): the Member page opened with its first member previewed, every request a
  `GET`. The shell's own notification bell still posts its `Repository.Query` and
  `Audit.QueryWithPageProvider` reads, as on every page.

**Used by:** `LayoutDesignerPageComponent`, at `/#/administration/layout-designer`.

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
