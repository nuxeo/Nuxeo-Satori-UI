# Services — All Public Methods

Most frontend data services live in `libs/shared/nuxeo-client/src/lib/services/` and are
imported from `@nuxeo/satori-platform/nuxeo-client`.

Knowledge Discovery uses the dedicated shared client in `libs/shared/kd-client/src/lib/`
and is imported from `@agentic-ui/shared/kd-client`. It calls Knowledge Discovery through
Nuxeo automation operations exposed by the Hyland Content Intelligence Connector (CIC) —
there is no separate backend in this repo.

Knowledge Enrichment uses the dedicated shared client in `libs/shared/ke-client/src/lib/`
and is imported from `@agentic-ui/shared/ke-client`. It posts multipart blob requests to
Nuxeo automation operations exposed by the same CIC bundle.

---

## DocumentDetailService (`document-detail.service.ts`)

Primary service for single-document operations.

```typescript
getFullDocument(uid: string): Observable<NuxeoDocument>
getDocumentPermissions(uid: string): Observable<NuxeoDocument>
fetchBlob(uid: string, options?: FetchBlobOptions): Observable<Blob>
  // GET @blob/file:content?clientReason=view (default) or download; fallback blobholder:0
fetchBlobByXpath(uid: string, xpath: string, options?: FetchBlobOptions): Observable<Blob>
fetchRendition(uid: string, name: string): Observable<Blob>
  // GET @rendition/{name}, the name one encoded path segment; '', '.' and '..' error unasked.
  // A video's transcoded files are asked so, by the name a rights policy lists them by
fetchPdfRendition(uid: string): Observable<Blob>
fetchThumbnail(uid: string): Observable<Blob>
fetchAssetRights(uid: string): Observable<AssetRightsExplanation | null>
  // GET /id/{uid} with enrichers.document: assetRights (nuxeo-agentic-assets), read with
  // assetRights(doc): why the server's rights refused a use. Asked only after a 403, never to
  // decide what to offer: the server refuses whatever this says
getAuditLog(uid: string, pageSize?: number, currentPageIndex?: number, query?: AuditLogQuery, context?: HttpContext): Observable<AuditLogList>
  // query: principalName, eventIds, eventCategory, startDate, endDate (exclusive), sortBy, sortOrder — all server-side
getPublishedVersions(uid: string): Observable<NuxeoDocumentList>
getSectionTree(): Observable<NuxeoDocumentList>
unpublishDocument(proxyUid: string): Observable<unknown>
republishDocument(sourceUid: string, targetSectionId: string): Observable<NuxeoDocument>
lockDocument(uid: string): Observable<NuxeoDocument>
unlockDocument(uid: string): Observable<NuxeoDocument>
followTransition(uid: string, transition: string): Observable<NuxeoDocument>
  // @op/Document.FollowLifecycleTransition with params.value; what to offer is getFullDocument's
  // `allowedTransitions` enricher (nuxeo-agentic-core), read with allowedTransitions(doc)
addToFavorites(uid: string): Observable<NuxeoDocument>
removeFromFavorites(uid: string): Observable<NuxeoDocument>
trashDocument(uid: string): Observable<NuxeoDocument>
trashDocuments(uids: string[]): Observable<NuxeoDocument[]>
restoreFromTrash(uid: string): Observable<NuxeoDocument>
permanentlyDelete(uid: string): Observable<void>
subscribe(uid: string, notifications?: string): Observable<NuxeoDocument>
unsubscribe(uid: string, notifications?: string): Observable<NuxeoDocument>
addToCollection(uid: string, collectionId: string): Observable<NuxeoDocument>
getCollections(): Observable<NuxeoDocumentList>
exportBlob(uid: string): Observable<Blob>
exportZip(uid: string, filename?: string): Observable<Blob>
bulkDownload(uids: string[], filename?: string): Observable<Blob>
exportXml(uid: string): Observable<Blob>
getRunnableWorkflows(uid: string): Observable<NuxeoWorkflowModel[]>
createCollection(title: string, description?: string): Observable<NuxeoDocument>
searchUsersGroups(searchTerm: string): Observable<UserGroupSuggestion[]>
addPermission(uid: string, params: { username?, email?, permission, notify?, comment?, begin?, end?, creator? }): Observable<NuxeoDocument>  // creator defaults to CURRENT_USERNAME
addPermissionWithNotification(uid, params): Observable<PermissionWithNotificationResult>  // add ACE then send notification separately
replacePermissionWithNotification(uid, params): Observable<PermissionWithNotificationResult>
addExternalPermissionWithNotification(uid, params): Observable<PermissionWithNotificationResult>  // saves with notify:false, then optional separate notification
addExternalPermission(uid: string, params: { email, permission, notify?, comment?, begin?, end?, creator? }): Observable<NuxeoDocument>  // delegates to addPermission; notify defaults false; creator defaults to CURRENT_USERNAME
replacePermission(uid: string, params: { id?, username?, email?, permission, notify?, comment?, begin?, end? }): Observable<NuxeoDocument>
removePermission(uid: string, params: { user, permission, acl? }): Observable<NuxeoDocument>  // removes EVERY ACE `user` holds in `acl` — Nuxeo ignores `permission`
removePermissionById(uid: string, aceId: string, acl = 'local'): Observable<NuxeoDocument>  // removes exactly one ACE by its Nuxeo id; an unknown id is a 200 no-op, so re-read to confirm
blockPermissionInheritance(uid: string): Observable<NuxeoDocument>
unblockPermissionInheritance(uid: string): Observable<NuxeoDocument>
sendNotificationEmailForPermission(uid: string, aceId: string): Observable<NuxeoDocument>
getAnnotationDocuments(uid: string, xpath: string, origin: string): Observable<NuxeoDocument[]>
  // Repository.Query, ANNOTATION_DOCUMENTS_QUERY, every page, the repository and not the lagging index:
  // the record's annotations on that file and of that origin,
  // as Annotation documents, oldest first by dc:created, which the repository stamps. Not by an
  // annotation's creationDate, which Nuxeo 2025 takes from the request when one is sent
createAnnotation(uid: string, { xpath, text, origin?, entity? }): Observable<NuxeoAnnotation>
  // POST @annotation; the server makes the signed-in user the author. `origin` and `entity` are the
  // writer's own text, which anyone who may read the record may write: hold them to a form on read.
  // The record page's review stores its pins and rounds this way (docs/api-integrations.md, section 39)
```

---

## BrowseService (`browse.service.ts`)

```typescript
getByPath(nuxeoPath: string): Observable<NuxeoDocument>  // enrichers acls, permissions, favorites, subscribedNotifications, breadcrumb — `breadcrumb` carries every ancestor's title, read with nuxeoBreadcrumbTitles()
getUserWorkspace(): Observable<NuxeoDocument>  // POST automation/User.GetUserWorkspace (Web UI)
getRepositoryRoot(): Observable<NuxeoDocument>  // falls back to NXQL when GET /path/ is denied
getNavTreeBootstrap(pageSize?: number): Observable<NavTreeBootstrap>  // root + top-level folders for all permission profiles
getBrowseFolderContents(nuxeoPath: string, pageSize?: number, page?: BrowsePageRequest, filters?: BrowseFolderFilters): Observable<BrowseFolderContents>  // browse page loader with restricted-user fallbacks; `page` ({ currentPageIndex?, sort?: { sortBy, sortOrder }[] }) is server paging and sort, honoured by every source — folders, Root, Domain, Favorites and Collection; below the root a failure is Nuxeo's own HttpErrorResponse, so map it with nxsErrorStatus(). `filters` (title, type, modified range, contributor) are applied by the **server**: an active filter runs `POST automation/Repository.Query` over `ecm:parentId` for a folder or Domain and `collectionMember:collectionIds` for a Collection or Favorites, so the rows, `totalSize` and `hasNextPage` all describe the whole container rather than one page, and `serverFiltered: true` says so. The repository root is the one container no query reproduces (`tree_children` lists only its Folderish children, and a user who cannot read it takes the bootstrap fallback): it answers `serverFiltered: false` and the caller narrows what it was handed
getBrowseFolderTypes(nuxeoPath: string, maxDocuments?: number): Observable<string[]>  // the distinct `ecm:primaryType`s a container holds, for the browse type dropdown, which cannot build its options from the rows any more: under an active type filter those rows are all of that one type. One bounded, header-free request (54 KB for 66 children against 151 KB with `properties: '*'` and the `permissions` enricher), cached per folder by the caller and asked for when the dropdown opens. `Repository.Query` takes `SELECT *` only — `SELECT DISTINCT ecm:primaryType` and a bare `SELECT ecm:primaryType` both answer 200 with **zero** rows rather than erroring, and `GROUP BY` fails the operation — so the types are collected from the documents. Do NOT reimplement any of this against `search/lang/NXQL/execute`, which is **OpenSearch-backed**: measured on a live instance it disagrees with `@children` in both directions — 91 documents against 66, 13 live children missing from the index and 38 trashed ones whose index entries still read `ecm:isTrashed = 0` — so a filter evaluated there both drops real documents and resurrects deleted ones, and `ILIKE` returns 0 rather than erroring, silently making title matching case-sensitive
getCollectionMembers(collectionUid: string, pageSize?: number, page?: BrowsePageRequest): Observable<NuxeoDocumentList>  // Favorites / Collection member listing, one page in the requested order; a sort key the provider cannot use is HTTP 400
getFolderContext(nuxeoPath: string): Observable<NuxeoDocument>  // includes @subtypes enricher
getCreatableSubtypes(nuxeoPath: string): Observable<string[]>  // parsed allowed child types
getChildren(nuxeoPath: string, pageSize?: number, currentPageIndex?: number): Observable<NuxeoDocumentList>
getTreeChildren(parentUid: string, pageSize?: number): Observable<NuxeoDocumentList>  // tree_children page provider, all pages
getNavTreeChildren(parent: NuxeoDocument, pageSize?: number, page?: BrowsePageRequest): Observable<NuxeoDocumentList>  // Root/workspaces: tree_children; Domain: @children, folders only, first page, total = folders kept; with `page`, Root answers that one page in that order (a listing), without it Root lists every page (a tree level). A domain listing goes through getBrowseFolderContents, which pages @children with files
getFolderIdsWithSubfolders(parentUids: readonly string[]): Observable<ReadonlySet<string> | null>  // one NXQL probe per tree level; null = incomplete, keep arrows
updateDocument(uid: string, properties: Record<string, unknown>, options?: { enrichPermissions?: boolean }): Observable<NuxeoDocument>
copyDocuments(uids: string[], targetUid: string): Observable<NuxeoDocument[]>  // Document.Copy automation
moveDocuments(uids: string[], targetUid: string): Observable<NuxeoDocument[]>  // Document.Move automation
getTrashedChildren(parentUid: string, pageSize?: number): Observable<NuxeoDocumentList>
hasChildCollections(collectionsFolderUid: string): Observable<boolean>  // NXQL pageSize=1 existence check
restoreDocument(uid: string): Observable<NuxeoDocument>
startCsvExport(parentUid: string): Observable<string>
pollAndDownloadCsv(executionId: string): Observable<Blob>
```

---

## BrowseContextService (`browse-context.service.ts`)

Tracks the Nuxeo path that drives the browse nav drawer tree (Nuxeo Web UI pattern). Updated
from browse navigation, document detail, and tree clicks.

```typescript
readonly contextPath: Signal<string>  // normalized repository path, default '/'
readonly treeRefreshTick: Signal<number>  // incremented when browse nav tree should reload
readonly contentRefreshTick: Signal<number>  // incremented when browse folder listing should reload
readonly clipboardPasteTick: Signal<number>  // incremented when clipboard copy/move completes

setFromRouterUrl(routerUrl: string): void
setFromDocument(doc: NuxeoDocument): void  // folderish → doc.path; leaf → parent folder
setFromNuxeoPath(nuxeoPath: string): void
requestTreeRefresh(): void  // invalidate/reload browse nav drawer tree (e.g. after domain creation)
requestContentRefresh(): void  // reload browse main view children (e.g. after domain creation)
notifyClipboardPasteComplete(event: ClipboardPasteEvent): void  // optimistic listing merge + reload
consumeClipboardPasteEvent(): ClipboardPasteEvent | null
resetContext(): void  // restore repository root path (e.g. on sign-out)
```

Path helpers: `libs/shared/nuxeo-client/src/lib/utils/browse-path.utils.ts`
(`parseBrowseNuxeoPathFromRouterUrl`, `cumulativeNuxeoPathPrefixes`, `topLevelNuxeoFolderPath`,
`nuxeoPathsEqualFlexible`, …).

---

## DocumentChangesService (`document-changes.service.ts`)

Says that documents changed, so the lists following it read their page again: browse's listing
and each `RecordListComponent`, a record page's related records and a queue's. The document page
reads its record again on it, and a record page's timeline its history. The platform's row
actions notify it after a rename, copy, move or delete, and an app's operation button after it runs, since they run from one app-wide
registration and cannot reload the list they came from. Every list follows every change. Each follower hears of it before `notify()` returns: browse
reloads at once, a record list on the next change detection. `BrowseContextService
.requestContentRefresh()` instead asks browse alone, through an effect.

```typescript
readonly changes: Observable<void>  // one emission per change; follow with takeUntilDestroyed()
notify(): void  // documents were renamed, copied, moved, trashed or otherwise changed
```

---

## ClipboardTargetService (`clipboard-target.service.ts`)

Tracks the current browse folder used as the paste target for clipboard Copy/Move (Web UI `target-document`).

```typescript
readonly target: Signal<NuxeoDocument | null>
setTarget(doc: NuxeoDocument | null): void
clear(): void
```

---

## SearchAggregationService (`search-aggregation.service.ts`)

Shared state service for search. Holds aggregation results and saved search state as signals.

```typescript
readonly aggregations: Signal<SearchAggregations>
readonly items: Signal<SearchResultItem[]>
readonly drawerFilters: Signal<Record<string, string>>
readonly selectedSavedSearchId: Signal<string>
readonly selectedSavedSearchTitle: Signal<string>
readonly savedSearchVersion: Signal<number>

markSavedSearchDirty(): void
```

`SearchSession` in `libs/features/search` keeps the filters and the open saved search here, runs
the one search the page and the drawer show, and publishes its `items` and `aggregations` here; the
drawer's queue reads `items`. Search for results through the session, not by calling
`SearchService.search` beside it.

## SearchService (`search.service.ts`)

`default_search`, saved searches and the lookups the search filters use. See
`docs/api-integrations.md` §31 for the parameters and the server's behaviour.

```typescript
search(params: SearchQueryParams): Observable<SearchResponse>
suggest(searchTerm: string, pageSize?: number): Observable<GlobalSearchSuggestion[]>
getUserCollections(): Observable<SearchCollectionOption[]>
getTagSuggestions(term: string): Observable<string[]>          // TagService.suggestTags; [] when blank or on failure
getSavedSearches(pageProvider?: string): Observable<SavedSearchOption[]>
getSavedSearchById(id: string): Observable<Record<string, string>>   // lists as JSON
saveSavedSearch(request: SaveSavedSearchParams): Observable<unknown>
updateSavedSearch(id: string, request: SaveSavedSearchParams): Observable<unknown>
renameSavedSearch(id: string, title: string, pageProviderName?: string): Observable<unknown>  // keeps params
deleteSavedSearch(id: string): Observable<unknown>
```

---

## KdClientService (`kd-client.service.ts`)

Frontend client for Knowledge Discovery. Talks to the Hyland Content
Intelligence Connector (`nuxeo-labs-content-intelligence-connector`) via
Nuxeo automation endpoints (`/nuxeo/site/automation/<OpName>`). Uses the
connector's first-class ops (`HylandKnowledgeDiscovery.getAllAgents`,
`askQuestionAndGetAnswer`) where available and its generic
`HylandKnowledgeDiscovery.Invoke` passthrough for read-only metadata. Op
names and upstream paths are overridable via the `KD_CIC_OPERATIONS` and
`KD_UPSTREAM_PATHS` tokens.

Agent create/update/delete are **not** exposed: the CIC connector has
no write-side ops for agents, its `Invoke` passthrough rejects `DELETE`
with `Only GET, POST and PUT are supported.`, and the upstream Discovery
service returns `400 Bad Request` for `POST /agent/agents` through this
auth surface. Agent management is done in the Hyland Insight admin UI;
new agents appear here automatically through `listAgents`.

```typescript
listAgents(): Observable<KdAgentSummary[]>
getAgent(agentId: string): Observable<KdAgentDetails>
listModels(): Observable<KdModelInfo[]>
listGuardrails(): Observable<{ guardrailGroups: KdGuardrailGroup[] }>
submitQuestion(request: KdQuestionRequest): Observable<KdQuestionSubmission>
getAnswer(questionId: string): Observable<KdAnswerResponse>
submitFeedback(questionId: string, request: KdFeedbackRequest): Observable<void>
getQuestionHistory(agentId: string, pageNumber?: number, pageSize?: number): Observable<KdQuestionHistoryPage>
```

---

## KeClientService (`ke-client.service.ts`)

Frontend client for Knowledge Enrichment. Talks to the Hyland Content
Intelligence Connector (`nuxeo-labs-content-intelligence-connector`) via the
`HylandKnowledgeEnrichment.Enrich` automation op. Unlike KD, KE uses a
multipart request with a JSON `request` part and a blob `input` part.

The client normalizes the Context API response fields (`textClassification`,
`textSummary`, `namedEntityText`, `imageDescription`, `namedEntityImage`) and
also tolerates the connector's generic `{ response, responseCode,
responseMessage }` envelope when present.

```typescript
enrich(blob: Blob, request: KeEnrichRequest): Observable<KeEnrichmentResult>
```

---

## ContentLakeIngestService (`content-lake-ingest.service.ts`)

Triggers HxAI Content Lake ingestion for existing Nuxeo documents via the
`nuxeo-hxai-connector` bulk `ingest` action. Used by the Knowledge Discovery
upload panel after `DocumentImportService` creates File documents in Nuxeo.

```typescript
startIngest(documentUids: string[]): Observable<ContentLakeIngestCommand>
getStatus(commandId: string): Observable<ContentLakeIngestStatus>
waitUntilComplete(commandId: string, pollIntervalMs?: number): Observable<ContentLakeIngestStatus>
findDuplicates(files: File[], sourceIds?: string[]): Observable<ContentLakeDuplicate[]>
checkIngested(documentUid: string, sourceIds?: string[]): Observable<boolean>
backfillIngestMarkerIfNeeded(doc: NuxeoDocument, sourceIds?: string[]): Observable<ContentLakeBackfillResult>
markIngested(documentUids: string[]): Observable<NuxeoDocument[]>
```

---

## CollectionService (`collection.service.ts`)

```typescript
getById(uid: string): Observable<NuxeoDocument>
getAll(pageSize?: number): Observable<NuxeoDocumentList>
getFavorites(userId: string, pageSize?: number): Observable<NuxeoDocumentList>
getCollectionMembers(collectionUid: string, pageSize?: number, page?: BrowsePageRequest): Observable<NuxeoDocumentList>  // one page, in the requested order; totalSize is the collection's size on every page
updateProperties(uid: string, properties: Record<string, unknown>): Observable<NuxeoDocument>
bulkDownload(collectionUid: string, filename?: string): Observable<Blob>
```

---

## TaskService (`task.service.ts`)

```typescript
notifyTasksChanged(): void
getUserTasks(userId: string, pageSize?: number, context?: HttpContext): Observable<NuxeoTask[]>
  // the newest `pageSize` open tasks, newest `created` first. Nuxeo orders the list by nt:dueDate and
  // ignores sortBy, so when it has more than `pageSize` the rest is read with `offset`, up to 1000 more.
  // context reaches every request it makes, both task-list reads and any target read for a title
getTask(taskId: string): Observable<NuxeoTask>
getDocumentTasks(docId: string, userId?: string): Observable<NuxeoTask[]>
```

---

## UserService (`user.service.ts`)

```typescript
searchUsers(query: string): Observable<NuxeoUser[]>
searchUsersPaged(query: string, pageSize?: number, currentPageIndex?: number): Observable<NuxeoUserList>
getRecentlyCreatedUsersAndGroups(pageSize?: number, currentPageIndex?: number): Observable<NuxeoDocumentList>
  // GET /nuxeo/api/v1/search/pp/LATEST_CREATED_USERS_OR_GROUPS_PROVIDER/execute
searchGroups(query: string): Observable<NuxeoGroup[]>
searchGroupsPaged(query: string, pageSize?: number, currentPageIndex?: number): Observable<NuxeoGroupList>
getUser(userId: string): Observable<NuxeoUser>
getGroup(groupId: string): Observable<NuxeoGroup>
createUser(input: { username, firstName, lastName, company?, email, password?, groups? }): Observable<NuxeoUser>
  // With password → POST /nuxeo/api/v1/user
  // Without password → User.Invite automation (invitation email flow)
updateUser(userId: string, updates: { firstName?, lastName?, company?, email?, password?, groups? }): Observable<NuxeoUser>
deleteUser(userId: string): Observable<void>
createGroup(input: { groupname, grouplabel, memberUsers?, memberGroups? }): Observable<NuxeoGroup>
updateGroup(groupname: string, updates: { grouplabel?, memberUsers?, memberGroups? }): Observable<NuxeoGroup>
deleteGroup(groupname: string): Observable<void>
```

---

## TagService (`tag.service.ts`)

```typescript
addTag(uid: string, label: string): Observable<string[]> // the document's tags afterwards, as Nuxeo stored them
removeTag(uid: string, label: string): Observable<string[]> // the tags left
searchTags(term: string): Observable<string[]>
suggestTags(term: string): Observable<string[]> // Tag.Suggestion, as Web UI; searchTags' directory 404s on Nuxeo 2025
```

---

## WorkflowService (`workflow.service.ts`)

```typescript
getWorkflowModels(): Observable<NuxeoWorkflowModel[]>
getDocumentWorkflows(docId: string): Observable<NuxeoWorkflow[]>
getMyWorkflows(): Observable<NuxeoWorkflow[]>
getWorkflow(workflowId: string): Observable<NuxeoWorkflow>
cancelWorkflow(workflowInstanceId: string): Observable<void>
getWorkflowGraph(workflowInstanceId: string): Observable<unknown>
getWorkflowModel(modelName: string): Observable<NuxeoWorkflowModel>
getWorkflowModelGraph(modelName: string): Observable<unknown>
```

---

## DocumentService (`document.service.ts`)

General document utilities.

```typescript
getRecentlyEdited(pageSize?: number): Observable<NuxeoDocumentList>
getRecentlyViewed(userId: string, pageSize?: number): Observable<NuxeoDocumentList>
getExpiredDocuments(pageSize?: number): Observable<NuxeoDocumentList>
getById(docId: string): Observable<NuxeoDocument>
```

---

## DocumentImportService (`document-import.service.ts`)

```typescript
getDefaultImportParentPath(): Observable<string>
getEmptyDocumentWithDefaults(parentPath: string, docType: string): Observable<NuxeoCreateDocumentTemplate>
createChildDocument(parentPath, name, docType, properties): Observable<NuxeoDocument>
initUploadBatch(handler?: string): Observable<string>
uploadFileToBatch(batchId: string, fileIndex: number, file: File): Observable<void>
createBlobHoldingDocument(parentPath, name, docType, properties, file, options?): Observable<NuxeoDocument>
createBlobHoldingDocumentReliable(parentPath, name, docType, properties, file, stagedBatch?, options?): Observable<NuxeoDocument>
createBlobHoldingDocumentFromBatch(parentPath, name, docType, properties, batchId, fileIndex, options?): Observable<NuxeoDocument>
stageFileInBatch(file, options?): Observable<StagedBatchFile>
createDocumentWithBlob(...): Observable<NuxeoDocument>
createFileFromBatch(...): Observable<NuxeoDocument>
importFiles(parentPath, files, options?): Observable<NuxeoDocument[]>
importFilesWithProperties(parentPath, entries: ImportFileEntry[], options?): Observable<NuxeoDocument[]>
importCsvFile(options: CsvServerImportOptions): Observable<string>
importFromCsvText(parentPath: string, csvText: string): Observable<CsvImportResult>
```

Exported helpers from the same module (not class methods):

```typescript
isBlobHoldingDocType(docType: string): boolean
inferBlobDocTypeFromFile(file: File): string
resolveImportBlobDocType(file: File, allowedTypes: readonly string[]): string
titleFromFileName(fileName: string): string
sanitizeDocumentCreateName(name: string): string
mergeCreateDocumentBody(template, docType, nameFallback, overrides): Record<string, unknown>
documentHasMainBlob(doc: NuxeoDocument): boolean
BLOB_HOLDING_DOC_TYPES: ReadonlySet<string>
```

Types exported from the same module:

```typescript
ImportProgress;
ImportFilesOptions;
CreateBlobHoldingDocumentOptions;
```

---

## SelectionService (`selection.service.ts`)

Manages multi-select state in browse/search. Uses signals.

```typescript
toggle(id: string, label?: string, preview?: SelectionPreview, type?: string): void
selectAll(
  ids: string[],
  labels?: Record<string, string>,
  previews?: Record<string, SelectionPreview>,
  types?: Record<string, string>,
): void
forgetPreviews(): void
clear(): void
deleteSelected(): Observable<NuxeoDocument[]>
```

**`preview` is a borrowed object URL, and this service does not own it.** Callers pass a `blob:` URL
they minted, and the selection topbar binds the retained string into `<img [src]>`. Selection is
global and survives a new search, so the owner's URL can be revoked while this service still holds
it — which renders a broken image beside a still-selected item.

`forgetPreviews()` is the current mitigation: every owner calls it immediately before revoking a
thumbnail batch, which drops the previews to `null` and degrades the popup to its placeholder. It
does **not** clear the selection. Callers as of this writing: `search`, `trash`, `assets`, `browse`.

**`offeredBulkActions`** is a signal of the bulk action ids the page holding the selection offers, or
`null` for every one the `bulk-actions` slot resolves. A queue's page sets those of its file's
`bulkActions` that have a handler, `[]` while it shows no queue, and puts `null` back when it goes;
the shell's selection topbar reads it, and offers those of them the slot resolves for the rows
selected. It is not a security control.

That is deliberately the conservative half. The complete fix is for this service to own preview
lifetime — hold the blobs, or refetch on demand — so a selection keeps its thumbnails across a
search. That is a design change to a shared service and has not been made.

---

## DirectoryService (`directory.service.ts`)

Nuxeo vocabulary / directory lookups and admin CRUD. Picker methods (`getEntries`, `getL10nEntries`, `getAllL10nEntries`) query the server on every call (Nuxeo Web UI parity).

```typescript
getEntries(directoryName: string, lang?: string): Observable<DirectoryEntry[]>   // lang defaults to 'en'
getAdminEntries(directoryName: string): Observable<ManagedDirectoryEntry[]>
getDirectoryCatalog(): Observable<Map<string, DirectoryMetadata>>
createEntry(directoryName: string, values: VocabularyEntryFormValues): Observable<ManagedDirectoryEntry>
updateEntry(directoryName: string, entryId: string, values: VocabularyEntryFormValues): Observable<ManagedDirectoryEntry>
deleteEntry(directoryName: string, entryId: string): Observable<void>
getL10nEntries(directoryName: string): Observable<L10nDirectoryEntry[]>
getAllL10nEntries(directoryName: string): Observable<L10nDirectoryEntry[]>
getEventTypes(): Observable<DirectoryEntry[]>
getEventCategories(): Observable<DirectoryEntry[]>
```

---

## ContentModelService (`content-model.service.ts`)

Nuxeo's content model — document types, facets and schemas — read from `/config/types`,
`/config/facets` and `/config/schemas` in one `forkJoin`.

```typescript
getContentModel(): Observable<NuxeoContentModel>
```

Read-only: Nuxeo exposes no REST write path for the content model, so there is no `set`
counterpart. The three reads are cached for the lifetime of the application with
`shareReplay({ bufferSize: 1, refCount: false })`. That is not an optimisation — the model is
server-side configuration that changes only when a package is installed, and the consumer builds
its observable in a constructor, so `refCount: true` would issue three requests every time a
metadata panel opened. `facets` and `schemas` are coerced to `[]` when the server answers with an
empty body, because an `undefined` becomes a crash inside the caller's `DocumentModel` rather than
an empty property list.

---

## PrincipalPermissionsService (`principal-permissions.service.ts`)

ACL management for documents.

```typescript
// Methods for adding/blocking permissions — see file for full API
```

---

## NuxeoDriveService (`nuxeo-drive.service.ts`)

```typescript
hasDriveToken(): Observable<boolean>
buildEditUrl(docUid: string, blobUrl: string, filename: string): string
buildDirectTransferUrl(folderPath: string): string
openDriveUrl(url: string): void
```

---

## AssetAggregationService (`asset-aggregation.service.ts`)

Same pattern as `SearchAggregationService` but for the DAM assets page.

---

## TrashFilterService (`trash-filter.service.ts`)

Shared state for trash filters. Uses signals.

---

## SettingsService (`settings.service.ts`)

User preferences and cloud service connections.

---

## AdministrationService (`administration.service.ts`)

Admin console operations (users, groups, system info).

---

## AppConfigService (`libs/shared/app-config/src/lib/app-config.service.ts`)

Layer 0/1 configuration, loaded once at startup. Import: `@nuxeo/satori-platform/app-config`.

| Member                                                                      | Notes                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load(): Promise<void>`                                                     | Fetches `agentic-ui-config/bootstrap.json` and `manifest.json` together, anonymously and without the interceptors; folds their fragments over the defaults; applies a presales preset where enabled. Never rejects. Runs once: later calls return the same promise, so another initializer can `await` it.                                                          |
| `bootstrap` / `manifest`                                                    | Signals of the merged configuration. `manifest().extensionLayers` holds each fragment's `extensions` block, resolved per layer by `AppExtensionsService`.                                                                                                                                                                                                           |
| `diagnostics`                                                               | Source of each half, the fragments applied with their package, server diagnostics, and fallback messages.                                                                                                                                                                                                                                                           |
| `activePreset`                                                              | `{ name, label }` of the preset in force, or `null`; shown by the header badge.                                                                                                                                                                                                                                                                                     |
| `reportBrandingLogoUnavailable(url, reason)`                                | Called by the brand surfaces when the browser could not show the configured logo — a missing file, bytes that are not an image, a cross-origin response with no CORS header, or no intrinsic size. Clears `brandingLogo` so both surfaces fall back to the Satori marks, and records one diagnostic naming the address. Keyed by URL and reported once (NXSAT-721). |
| `themes`, `brandingLogo`, `resolveTheme(id)`, `featureToggle(id, fallback)` | Unchanged.                                                                                                                                                                                                                                                                                                                                                          |

Removed in NXSAT-312, with no replacement: `loadBootstrap()`, `loadManifest()`, `resetManifest()`,
`diagnostics().manifestAttempt`, and `parseRuntimeManifest`.

---

## NxsToastService (`libs/shared/satori-components/src/lib/toast/toast.service.ts`)

The core slice's one toast (NXSAT-308), over Material's `MatSnackBar`. Import:
`@nuxeo/satori-platform/components`. Not provided in root: list `provideNxsToast()` in the
component's `providers`. In a spec, `TestBed.overrideProvider(NxsToastService, { useValue })`.

| Member                                                         | Notes                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `show(message: string, options?: NxsToastOptions): void`       | Something happened. Announced politely. `message` is already translated; a blank one opens nothing.                                                                                                                                                             |
| `error(message: string, options?: NxsToastErrorOptions): void` | Something the user asked for did not happen. Announced assertively. `retry` adds a translated Retry button running it.                                                                                                                                          |
| `NxsToastOptions`                                              | `duration` in ms: below `NXS_TOAST_DURATION` (4000, Web UI's) it is raised to it, `0` keeps the toast until dismissed. `action: { label, run }` adds one button; a toast with an action defaults to `0`. Every toast has a Dismiss button and closes on Escape. |

---

## RowActionsService (`libs/shared/ui/src/lib/row-actions/row-actions.service.ts`)

What the platform's row actions do, `app.rowActions.download`, `.rename`, `.copyTo`, `.moveTo` and
`.delete`, on whichever list offered them. Import: `@nuxeo/satori-platform/ui`. Not provided in
root: `providePackagedRowActions()` provides it and registers the five handlers once with
`registerPackaged`, so a customer's `register()` outranks them. `provideAppExtensions()` calls it.
Its messages go through an environment `NxsToastService` when one is provided, and otherwise
through its own: it does not provide one to the environment, so a component that forgets
`provideNxsToast()` still fails. A spec that runs these actions lists `providePackagedRowActions()`
in `providers`, with `{ provide: NxsToastService, useValue }` to hear its messages.

| Member                       | Notes                                                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `download(doc): void`        | Saves the main file under its own name, through a blob URL revoked at once.                                                                                                        |
| `rename(doc): void`          | `nxs-rename-dialog`, refused on an `Immutable` document even if a manifest clears the rule.                                                                                        |
| `copyTo(doc)`, `moveTo(doc)` | `nxs-folder-picker-dialog`, opened on the folder the document is in; a move does not offer that folder, and no folder can be its own destination. Then `Document.Copy` or `.Move`. |
| `delete(doc): void`          | Confirms, then trashes. A collection goes through the collection's own confirmation; a Collections folder still holding collections is refused.                                    |
| After a change that succeeds | Asks the folder tree to reload, takes a moved or trashed document out of the selection (all of it, for a collection), and calls `DocumentChangesService.notify()`.                 |

---

## PageProviderService (`page-provider.service.ts`)

Runs a page provider defined on the server: `GET /api/v1/search/pp/<name>/execute`, as the user.
The record page's related records and a queue's list read through it.

```typescript
execute(name: string, request: PageProviderRequest): Observable<PageProviderResults>
isAggregateParameter(name: string): boolean
```

`PageProviderRequest` carries `parameters`, `pageSize`, `pageIndex`, `sort`, `properties` and
`aggregates`: the buckets chosen in each aggregate, sent as `<aggregate>=<JSON array>` as the search
page sends its filters. `PageProviderResults` is the page with the server's `aggregations`. It
refuses, without a request, a name that is not a page provider's, a page size outside 1 to 1000, a
sort that is not `<prefix>:<name>`, and an aggregate the search reads for itself (`pageSize`,
`sortBy`, `properties` and the like) or named with a `.` or a `-`.

```typescript
isPageProviderName(name: string): boolean
resultWindow(page: NuxeoPaginatedList<unknown>, pageSize: number): ResultWindow // { total, moreThan, reach }
```

`resultWindow` reads one page's answer: `total`, the server's whole count or `null`; `moreThan`,
the limit where it stopped counting (`-2` with `resultsCountLimit`); and `reach`, how many results
the pages can reach at that page size when the search index's window, `resultsCountLimit`, is below
the count, or where the server says there is no next page short of its count. A page that ends past
the window is HTTP 500, so a list never asks for one (`RecordListComponent`); a repository provider
has no window (`docs/api-integrations.md`, section 33).

---

## BulkCommandService (`bulk-command.service.ts`)

Nuxeo's Bulk Action Framework over REST, as the user: an action over a page provider's whole
result on the server, its status, and stopping it. A queue's page runs a bulk action over every
result of its query through it (`docs/api-integrations.md`, section 34).

```typescript
runOverPageProvider(name: string, query: BulkCommandQuery, action: string,
  actionParameters: Readonly<Record<string, unknown>>): Observable<BulkCommandStatus> // POST …/search/pp/<name>/bulk/<action>
status(commandId: string): Observable<BulkCommandStatus>  // GET …/bulk/<commandId>
abort(commandId: string): Observable<BulkCommandStatus>   // PUT …/bulk/<commandId>/abort
readBulkCommandStatus(body: unknown): BulkCommandStatus   // BulkCommandStatusError on anything but a bulkStatus
```

`BulkCommandQuery` carries the page provider's `parameters` only. There is no way to send a bucket:
the server leaves chosen buckets out of the command, which would then reach records the list does
not show. `BulkCommandStatus.ended` is true once the server writes `completed`, not merely
`ABORTED`: after a stop, the batches already started still finish. It refuses, without a request, a
name that is not a page provider's, an action that is not a name, an empty parameter and a command
id that is not a UUID.

---

## AppRegistryService (`libs/shared/app-registry/src/lib/app-registry.service.ts`)

The app registry in `nuxeo-agentic-core`, `/nuxeo/agentic-ui-apps/`: the apps the person signed in
may see, the one open, and each file of its definition. The app provides it as
`APP_DEFINITION_FILES`, which the home, the menu, the queues, the labels and the task forms read
through; that token's default reads the development server's addresses alone.

```typescript
load(): Promise<void>                      // the listing, once per page, after the configuration
refresh(): Promise<boolean>                // read again after a sign-in; true when the app open changes
choose(id: string): void                   // remember it, and reload the page with it
file(path: string, developmentUrl: string | null): Observable<unknown>
                                           // the development server's address first, then the
                                           // registry's where that is 404 and the app has the file
labelLanguages(): Observable<readonly string[]>
apps: Signal<readonly RegistryApp[]>; current: Signal<RegistryApp | null>; state: Signal<AppRegistryState>
```

---

## QueueService (`libs/shared/queues/src/lib/queue.service.ts`)

Reads an app's `queues/<id>.json` through `APP_DEFINITION_FILES`: beside the layouts and the home,
past the interceptors, where the development server serves it, and otherwise from the app registry.

```typescript
load(id: string): Observable<QueueLoad>   // file | none (404, or an id that is not one) | unreadable
queueFileUrl(bootstrapUrl: string, id: string): string
queueLink(id: string): readonly string[]  // ['/queues', id]
```

---

## NotificationSources (`libs/shared/notifications/src/lib/notification-sources.ts`)

Where the notification bell's items come from. Every request is a background request. Nothing
writes.

```typescript
tasks(user: string): Observable<TaskNotification[]>            // TaskService.getUserTasks, newest first
followed(user: string, since: Date, page?: number): Observable<FollowedPage>
  // Repository.Query: notif:notifications/*/subscribers/* = 'user:<id>', dc:modified > since, 20 to a page
changes(wanted: readonly ChangesWanted[], audit: boolean): Observable<ChangesRead & { refused: boolean }>
  // audit: one Audit.QueryWithPageProvider (administrators only); else one @audit per record; both paged
```

`NotificationCenter` (provided by the bell) holds the state and runs the checks with
`NotificationPoller`; `NotificationReadState` keeps what each user has seen, by item, in
`localStorage`.

---

## DocumentLayoutService (`libs/shared/document-layouts/src/lib/document-layout.service.ts`)

Per-type layouts (NXSAT-311). Internal: `@agentic-ui/shared/document-layouts` exports
the `<lib-document-layout>` and `<lib-document-layout-form>` components that use it, and
`readValidationFailure` — not the service — and no `@nuxeo/satori-platform` entry point
re-exports the library.

A record page (`view`), edit or create form of the app open's deployment layer, which the app
registry serves after sign-in to the app's groups (`APP_DEFINITION_FILES`,
`layouts/<Type>/<mode>.layout.json`), is read first and wins over the file `layouts.json` lists; a
layer that has none costs no request, and one that cannot be read leaves the package's file, said in
the console (`docs/business-apps/app-definition-v2.md`, section 10).

| Member                                                                                                                                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layoutFor(type: string, mode: LayoutMode, documentSchemas: readonly DocumentSchemaRef[] = []): Observable<ResolvedLayout \| null>`                                   | The contributed file for `type`/`mode` if `agentic-ui-config/layouts.json` lists one, else the layout generated from `GET /config/types/<type>` (`fetch-schema: fields`). `documentSchemas` is the `schemas` list of the document's own read: each schema in it the type lacks — one a dynamic facet added — and the layout could show is read from `GET /config/schemas/<name>` (`fetch-schema: fields`), and its section follows the type's own; a layout file may name its fields. The index and files are read without the interceptors, so with no `Authorization` header — though, being same-origin, with the browser's cookies; index, files, types and schemas are each read once per session, except that a failed type or schema read is retried. `null` when the type cannot be read; a schema that cannot be read is left out, and so is a section a layout file leaves with no field to show — as the generated layout leaves out a schema with no fields. Never errors; every fallback is logged under `[agentic-ui-layouts]`. |
| `formLayoutFor(type: string, mode: 'edit' \| 'create', documentSchemas: readonly DocumentSchemaRef[] = []): Observable<ResolvedLayout \| ResolvedFormLayout \| null>` | The edit or create form: as `layoutFor` for a version 1 file or none, and for a version 2 file (`docs/business-apps/layout-v2.md`, section 11) the file read with `readFormLayout` and resolved with `resolveFormLayout` against the type and the facet schemas its fields name. A version 2 file with a structural error is refused, and the generated form shows; a field naming what this build lacks, or a rule it cannot answer, is left out. `layoutFor` never hands over a version 2 file, and a `metadata` file of version 2 is still refused. Never errors; every fallback is logged under `[agentic-ui-layouts]`.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `taskFormFor(task: NuxeoTask, document: NuxeoDocument): Observable<ResolvedFormLayout \| null>`                                                                       | The task form of the task's workflow step, `tasks/<workflow>.<step>.layout.json` beside `layouts.json`, read as the package writes it, with no envelope and past the interceptors, once per session (`docs/business-apps/app-definition-v2.md`, section 6). Resolved against the record's type and the step's variables: the fields of the `var_*` schemas the task names in `taskInfo.schemas`, then of `var_<workflowModelName>`, each `var:<name>`. `null` when nothing is served for the step (404, silently), when the file is refused or cannot be read, when the type cannot be read, or when a variable schema the file's `var:` fields need cannot be read: the task panel's own form shows, and a failed read is asked again for the next task. Never errors. Only `npm run config:dev -- --task` serves the file for now.                                                                                                                                                                                                          |
| `taskDocument(uid: string): Observable<NuxeoDocument \| null>`                                                                                                        | `GET /id/<uid>` with `properties: *`: the record a task is on, for its task form. `null` when it cannot be read. Never errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `vocabularyLabel(directory: string, id: string): Observable<string \| null>`                                                                                          | The label of one vocabulary entry, from `GET /directory/<directory>/<entry id>` (`translate-directoryEntry: label`, in English) — one read per value a document shows, and one for its parent in an `l10n…` vocabulary, labelled `Parent/Child`; never the whole vocabulary. An `l10n…` value stores the path (`art/architecture`) while the entry's id is its last segment (`architecture`, parent `art`), so the leaf is what is read and the path never is — encoded it is an HTTP 400 and unencoded a 404 (NXSAT-726). Each entry is read once per session; a failed read is logged under `[agentic-ui-layouts]` and retried. `null` when the entry cannot be read. Never errors.                                                                                                                                                                                                                                                                                                                                                         |
| `linkedRecords(ids: readonly string[]): Observable<ReadonlyMap<string, LinkedRecord> \| null>`                                                                        | The records a `document-link` names, by id, each with its title and the app's route to it (`docs/business-apps/layout-v2.md`, section 11): one `GET /search/lang/NXQL/execute` with `SELECT * FROM Document WHERE ecm:uuid IN (?, …)` and each id as a `queryParams` value of its own, never in the query's text. Only lower-case UUIDs are sent, 100 at most; more answers `null` without a request. A record the reader may not read, or that no longer exists, is absent. Not cached: `LinkedRecordLookup` keeps a page's, its lists' included, a queue's list's, or the Properties panel's, for a property whose `documentResolver` stores an id. `null` when the search fails, logged under `[agentic-ui-layouts]`. Never errors.                                                                                                                                                                                                                                                                                                        |
| `servedLayouts(): Observable<readonly ServedLayout[]>`                                                                                                                | The layout designer's: every `{ type, mode }` `layouts.json` lists a file for, each once, in its order. Read anew, past the interceptors, never from the session's cache. Errors when the index cannot be read or is not one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `layoutSource(type: string, mode: string): Observable<LayoutSource>`                                                                                                  | The layout designer's: the type's file for `mode` as it is served now, `{ url, content }` with its content unread, or `{ url, problem }`. Read anew, past the interceptors. Never errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `previewFormLayout(content: unknown, mode: 'edit' \| 'create', type: string, document: NuxeoDocument \| null = null): Observable<FormLayoutPreview>`                  | The layout designer's form preview: an unserved `edit` or `create` file read with `readFormLayout` and resolved against the type, and for an edit against the edited `document`'s own facet schemas too, as `formLayoutFor` resolves a served one. `{ layout, notes }`, `{ refused, notes }` for a file the form refuses, or `{ notDrawn, notes }` when the type cannot be read. `lib-document-layout-form` draws the layout given as its `preview` input. The console is not told the notes. Nothing is cached for the file. Never errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `previewRecords(type: string, pageSize: number): Observable<readonly NuxeoDocument[]>`                                                                                | The layout designer's: up to `pageSize` live records of the type, the last changed first, with their Dublin Core properties. One `GET /search/lang/NXQL/execute`, the type a `queryParams` value, never in the query's text. Not cached. Errors when the search fails.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `previewRecordLayout(content: unknown, document: NuxeoDocument): Observable<RecordLayoutPreview>`                                                                     | The layout designer's preview: an unserved `view` file read with `readRecordLayout` and resolved against the document's type and facet schemas as `recordLayoutFor` resolves a served one. `{ layout, notes }`, or `{ refused, notes }` for a file the record page refuses, or `{ notDrawn, notes }` when the type cannot be read or the record keeps its own View tab. `notes` are what the console would be told of the file, and it is not told them. Nothing is cached for the file. Never errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

## ConnectorRecordService (`libs/shared/document-layouts/src/lib/record-page/connector-record.service.ts`)

A record of another system for an open record, through a connector of `nuxeo-agentic-connectors`
(`docs/business-apps/layout-v2.md`, section 7). Internal to the library, for the record page's
`external` card.

```typescript
read(connector: string, uid: string): Observable<ConnectorAnswer>
  // POST /automation/Connector.Read, { params: { connector }, input: 'doc:<uid>' }
  // { connector, status: 'found' | 'not-found' | 'no-key', fields: { <name>: text | number | boolean } }
  // an answer of another shape errors with status 500; the server's errors pass through
```

---

## DeploymentLayerService (`libs/features/layout-designer/src/lib/layer/deployment-layer.service.ts`)

The layout designer's reads and changes of the app open's deployment layer
(`LayerEndpoint` in `nuxeo-agentic-core`; `docs/api-integrations.md`, section 41), for
`LayerPanelComponent`. Internal to the designer. Administrators alone, on the server.

```typescript
state(path: string): Observable<LayerReading>
  // GET /nuxeo/agentic-ui-apps/apps/<app open>/layer/<path>, through the interceptors
  // 'reading' first, then { kind: 'state', state } or why there is none:
  // 'unavailable' (no-app | off | forbidden), 'refused' (the server's reason), 'failed'
act(path: string, change: LayerChange): Observable<LayerReading>
  // POST of { action, revision, content?, to? }, application/json, X-Agentic-Layer-Change: 1
  // answered with the file as it then is, or the refusal: findings for a 422, the file for a 409
```

---

## ShareLinkService (`libs/shared/nuxeo-client/src/lib/services/share-link.service.ts`)

An asset's share links, through `nuxeo-agentic-assets`' Automation operations
(`docs/business-apps/layout-v2.md`, section 2, "Share links"; `docs/api-integrations.md`,
section 42). Exported from `@nuxeo/satori-platform/nuxeo-client`; the record page's
`lib-record-share-links` is its caller. It checks nothing the server decides.

```typescript
list(uid: string): Observable<ShareLink[]>
  // POST /automation/ShareLink.List, { params: {}, input: 'doc:<uid>' }; 403 without WriteSecurity
create(uid: string, items: readonly ShareLinkItem[], end: string): Observable<CreatedShareLink>
  // ShareLink.Create, { params: { renditions: items, end } }: { kind: 'created', link, token, path }
  // or { kind: 'refused', refused: [{ rendition, reason }] }; the token is shown once, never kept
revoke(uid: string, link: string): Observable<ShareLink>
downloads(uid: string): Observable<ShareLinkDownloads>
  // { downloads: [{ time, link, rendition }], truncated }
// every answer held to its shape: another one errors with status 500; a created link's path must be
// on this server (shareLinkUrl gives null for any other origin)
```

---

## AppActionsService (`libs/shared/document-layouts/src/lib/app-actions/app-actions.service.ts`)

An app's operation buttons, its `actions.json` (`docs/business-apps/app-definition-v2.md`, section
5): each action that runs an operation on one record, in the `toolbar` slot for `record` and the
`rowActions` slot for `row`, with a handler under its id. Registered once, at startup, by the app
(`business-apps.actions.ts`), from the app registry's file. Chosen, its rules are checked again, a
dialog asks its question with its form, the record is read again and its rules checked a third
time, then the server runs it.

```typescript
register(app: string, content: unknown): readonly string[]  // the ids registered; the console says what is left out
  // chosen: GET /id/<uid> (permissions), then
  // POST /automation/AgenticUi.RunAction, { input: 'doc:<uid>', params: { app, action, values: '<JSON>' }, context: {} }
  // never the operation or its other parameters: the server reads them from the app's served file
```

---

## ArenderService (`arender.service.ts`)

```typescript
getPreviewerUrl(docUid: string, blobXPath = 'file:content'): Observable<string | null>
getDiffUrl(leftDocUid: string, rightDocUid: string): Observable<string | null>
isAvailable(): Observable<boolean>
```

**`null` is a real return value, not an error.** All three depend on `ARENDER_CONFIG`, which is
`InjectionToken<ARenderConfig | null>` — a customer need not configure ARender, and the config is
also rejected outright if `viewerOrigin` fails `isNavigableBaseUrl`. `nuxeoInternalUrl` is vestigial
under NEV 2026 and is deliberately **not** checked. Callers must handle `null` rather than treating
it as a failed request.

**The URL comes from the server, not from this service.** `getPreviewerUrl` and `getDiffUrl` POST to
`Document.ARenderGetPreviewerUrl` / `Document.ARenderGetDiffUrl` (from the `nuxeo-arender` addon) and
return `previewerUrl` from the response, after checking it against `viewerOrigin` as an origin
allow-list. The client cannot build the URL itself: NEV requires a `documentId` parameter carrying
the blob digest. So `null` additionally covers a missing addon (404), a caller without `Read` on the
document (403), and a returned URL that is not framable. See `docs/api-integrations.md`.

This block previously documented `getViewerUrl(blobUrl: string): string` and
`isAvailable(): Promise<boolean>`, neither of which existed — a signature the code had never had.
Consumers reading it would have built against a synchronous, non-nullable contract.

---

## NuxeoApiBase (`nuxeo-api-base.ts`)

Low-level HTTP wrapper. **Do not inject directly in features or components.**

```typescript
apiUrl(path: string): string
get<T>(path: string, params?: HttpParams, headers?: Record<string, string>, context?: HttpContext): Observable<T>
post<T>(path: string, body: unknown, headers?: Record<string, string>, context?: HttpContext): Observable<T>
put<T>(path: string, body: unknown, headers?: Record<string, string>): Observable<T>
delete<T>(path: string, headers?: Record<string, string>): Observable<T>
nxqlSearch(query: string, pageSize: number, headers?: Record<string, string>): Observable<NuxeoDocumentList>
```

A request the application sends on its own, on a timer, passes `backgroundRequestContext()` as
`context` (`background-request.context.ts`): the auth interceptor then does not count its response
as activity for the idle timer, so it cannot keep a session open. It still carries the credentials,
and a 401 still ends the session. The notification bell's reads are the only ones today.
