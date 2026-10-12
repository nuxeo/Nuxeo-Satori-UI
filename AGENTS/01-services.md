# Services — All Public Methods

Most frontend data services live in `libs/shared/nuxeo-client/src/lib/services/` and are
imported from `@nuxeo-satori/platform/nuxeo-client`.

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
fetchPdfRendition(uid: string): Observable<Blob>
fetchThumbnail(uid: string): Observable<Blob>
getAuditLog(uid: string, pageSize?: number, currentPageIndex?: number): Observable<AuditLogList>
getPublishedVersions(uid: string): Observable<NuxeoDocumentList>
getSectionTree(): Observable<NuxeoDocumentList>
unpublishDocument(proxyUid: string): Observable<unknown>
republishDocument(sourceUid: string, targetSectionId: string): Observable<NuxeoDocument>
lockDocument(uid: string): Observable<NuxeoDocument>
unlockDocument(uid: string): Observable<NuxeoDocument>
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
```

---

## BrowseService (`browse.service.ts`)

```typescript
getByPath(nuxeoPath: string): Observable<NuxeoDocument>
getUserWorkspace(): Observable<NuxeoDocument>  // POST automation/User.GetUserWorkspace (Web UI)
getRepositoryRoot(): Observable<NuxeoDocument>  // falls back to NXQL when GET /path/ is denied
getNavTreeBootstrap(pageSize?: number): Observable<NavTreeBootstrap>  // root + top-level folders for all permission profiles
getBrowseFolderContents(nuxeoPath: string, pageSize?: number): Observable<BrowseFolderContents>  // browse page loader with restricted-user fallbacks
getCollectionMembers(collectionUid: string, pageSize?: number): Observable<NuxeoDocumentList>  // Favorites / Collection member listing
getFolderContext(nuxeoPath: string): Observable<NuxeoDocument>  // includes @subtypes enricher
getCreatableSubtypes(nuxeoPath: string): Observable<string[]>  // parsed allowed child types
getChildren(nuxeoPath: string, pageSize?: number, currentPageIndex?: number): Observable<NuxeoDocumentList>
getTreeChildren(parentUid: string, pageSize?: number): Observable<NuxeoDocumentList>  // tree_children page provider, all pages
getNavTreeChildren(parent: NuxeoDocument, pageSize?: number): Observable<NuxeoDocumentList>  // Root/workspaces: tree_children; Domain: @children, folders only, total = folders kept
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
suggest(searchTerm: string, pageSize?: number): Observable<GlobalSearchSuggestion[]>
getUserCollections(): Observable<SearchCollectionOption[]>
getSavedSearches(pageProvider?: string): Observable<SavedSearchOption[]>
getSavedSearchById(id: string): Observable<Record<string, string>>
saveSavedSearch(request: SaveSavedSearchParams): Observable<unknown>
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
getCollectionMembers(collectionUid: string, pageSize?: number): Observable<NuxeoDocumentList>
updateProperties(uid: string, properties: Record<string, unknown>): Observable<NuxeoDocument>
bulkDownload(collectionUid: string, filename?: string): Observable<Blob>
```

---

## TaskService (`task.service.ts`)

```typescript
notifyTasksChanged(): void
getUserTasks(userId: string, pageSize?: number): Observable<NuxeoTask[]>
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
addTag(uid: string, label: string): Observable<unknown>
removeTag(uid: string, label: string): Observable<unknown>
searchTags(term: string): Observable<string[]>
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

That is deliberately the conservative half. The complete fix is for this service to own preview
lifetime — hold the blobs, or refetch on demand — so a selection keeps its thumbnails across a
search. That is a design change to a shared service and has not been made.

---

## DirectoryService (`directory.service.ts`)

Nuxeo vocabulary / directory lookups and admin CRUD. Picker methods (`getEntries`, `getL10nEntries`, `getAllL10nEntries`) query the server on every call (Nuxeo Web UI parity).

```typescript
getEntries(directoryName: string): Observable<DirectoryEntry[]>
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

Layer 0/1 configuration, loaded once at startup. Import: `@nuxeo-satori/platform/app-config`.

| Member                                                                      | Notes                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load(): Promise<void>`                                                     | Fetches `agentic-ui-config/bootstrap.json` and `manifest.json` together, anonymously and without the interceptors; folds their fragments over the defaults; applies a presales preset where enabled. Never rejects. Runs once: later calls return the same promise, so another initializer can `await` it. |
| `bootstrap` / `manifest`                                                    | Signals of the merged configuration. `manifest().extensionLayers` holds each fragment's `extensions` block, resolved per layer by `AppExtensionsService`.                                                                                                                                                  |
| `diagnostics`                                                               | Source of each half, the fragments applied with their package, server diagnostics, and fallback messages.                                                                                                                                                                                                  |
| `activePreset`                                                              | `{ name, label }` of the preset in force, or `null`; shown by the header badge.                                                                                                                                                                                                                            |
| `themes`, `brandingLogo`, `resolveTheme(id)`, `featureToggle(id, fallback)` | Unchanged.                                                                                                                                                                                                                                                                                                 |

Removed in NXSAT-312, with no replacement: `loadBootstrap()`, `loadManifest()`, `resetManifest()`,
`diagnostics().manifestAttempt`, and `parseRuntimeManifest`.

---

## NxsToastService (`libs/shared/satori-components/src/lib/toast/toast.service.ts`)

The core slice's one toast (NXSAT-308), over Material's `MatSnackBar`. Import:
`@nuxeo-satori/platform/components`. Not provided in root: list `provideNxsToast()` in the
component's `providers`. In a spec, `TestBed.overrideProvider(NxsToastService, { useValue })`.

| Member                                                         | Notes                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `show(message: string, options?: NxsToastOptions): void`       | Something happened. Announced politely. `message` is already translated; a blank one opens nothing.                                                                                                                                                             |
| `error(message: string, options?: NxsToastErrorOptions): void` | Something the user asked for did not happen. Announced assertively. `retry` adds a translated Retry button running it.                                                                                                                                          |
| `NxsToastOptions`                                              | `duration` in ms: below `NXS_TOAST_DURATION` (4000, Web UI's) it is raised to it, `0` keeps the toast until dismissed. `action: { label, run }` adds one button; a toast with an action defaults to `0`. Every toast has a Dismiss button and closes on Escape. |

---

## DocumentLayoutService (`libs/shared/document-layouts/src/lib/document-layout.service.ts`)

Per-type layouts (NXSAT-311). Internal: `@agentic-ui/shared/document-layouts` exports only the
`<lib-document-layout [document] mode>` component that uses it, and no `@nuxeo-satori/platform`
entry point re-exports the library.

| Member                                                                                                                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layoutFor(type: string, mode: LayoutMode, documentSchemas: readonly DocumentSchemaRef[] = []): Observable<ResolvedLayout \| null>` | The contributed file for `type`/`mode` if `agentic-ui-config/layouts.json` lists one, else the layout generated from `GET /config/types/<type>` (`fetch-schema: fields`). `documentSchemas` is the `schemas` list of the document's own read: each schema in it the type lacks — one a dynamic facet added — and the layout could show is read from `GET /config/schemas/<name>` (`fetch-schema: fields`), and its section follows the type's own; a layout file may name its fields. The index and files are read without the interceptors, so with no `Authorization` header — though, being same-origin, with the browser's cookies; index, files, types and schemas are each read once per session, except that a failed type or schema read is retried. `null` when the type cannot be read; a schema that cannot be read is left out. Never errors; every fallback is logged under `[agentic-ui-layouts]`. |
| `vocabularyLabel(directory: string, id: string): Observable<string \| null>`                                                        | The label of one vocabulary entry, from `GET /directory/<directory>/<id>` (`translate-directoryEntry: label`, in English) — one read per value a document shows, and one for its parent in an `l10n…` vocabulary, labelled `Parent/Child`; never the whole vocabulary. Each entry is read once per session; a failed read is retried. `null` when the entry cannot be read. Never errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

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
get<T>(path: string, options?: HttpOptions): Observable<T>
post<T>(path: string, body: unknown, options?: HttpOptions): Observable<T>
put<T>(path: string, body: unknown, options?: HttpOptions): Observable<T>
delete<T>(path: string, options?: HttpOptions): Observable<T>
```

---

## AdfHxBridge (`libs/shared/adf-hx-bridge`)

Nuxeo → HxPR bridge for NXENG-619 Scope A. Implements HxPR `DocumentApi` / `QueryApi` over `BrowseService` and `DocumentDetailService`.

→ Architecture (layers, routes, hxp-* components, Scope A/B): `libs/shared/adf-hx-bridge/ARCHITECTURE.md`

```typescript
provideAdfHxNuxeoBridge(): EnvironmentProviders
mapNuxeoDocumentToHx(doc: NuxeoDocument, repositoryId?: string): Document
NuxeoDocumentApi.getDocumentById(docId, repositoryId?): Promise<{ data: Document }>
NuxeoQueryApi.getDocumentsByNamedQuery(namedQuery?): Promise<{ data: QueryResult }>
AdfHxDocumentService.getFolderChildren(parentId, repositoryId?, options?): Observable<DocumentFetchResults>
AdfHxDocumentService.getAllChildren(parentId, options?, repositoryId?): Observable<DocumentFetchResults>
NuxeoDocumentRouterService.navigateTo(document: Document): void
```
