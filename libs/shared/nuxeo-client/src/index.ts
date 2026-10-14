// Models
export type { NuxeoPaginatedList } from './lib/models/paginated.model';
export type {
  AggregateBucket,
  AggregateResult,
  AssetAggregations,
  AssetSearchParams,
  AssetSearchResult,
} from './lib/models/asset.model';
export type { NuxeoDocument, NuxeoDocumentList } from './lib/models/document.model';
export type {
  NuxeoComplexField,
  NuxeoContentModel,
  NuxeoDoctypeDefinition,
  NuxeoFacetDefinition,
  NuxeoFieldType,
  NuxeoSchemaDefinition,
  NuxeoTypesConfig,
} from './lib/models/content-model.model';
export type {
  ContentLakeDuplicate,
  ContentLakeBackfillResult,
  ContentLakeIngestCommand,
  ContentLakeIngestStatus,
} from './lib/models/content-lake-ingest.model';
export type { NuxeoTask, NuxeoTaskList } from './lib/models/task.model';
export type {
  AuditEntry,
  AuditLogList,
  AuditLogQuery,
  AuditLogSortField,
} from './lib/models/audit.model';
export { auditActivityLabel, auditActivityLabelKey } from './lib/utils/audit-activity-label';
export {
  BLOB_CLIENT_REASON_HEADER,
  BLOB_CLIENT_REASON_PARAM,
  type BlobClientReason,
  type FetchBlobOptions,
} from './lib/utils/blob-client-reason';
export type {
  DirectoryEntry,
  DirectoryEntryRest,
  DirectoryEntriesResponse,
  DirectoryMetadata,
  L10nDirectoryEntry,
  ManagedDirectoryEntry,
  VocabularyEntryFormValues,
} from './lib/models/directory.model';
export {
  DEFAULT_VOCABULARY_ORDERING,
  buildVocabularyTableColumns,
  defaultVocabularyLabel,
  directoryAdminTableLabel,
  directoryEntryDisplayLabel,
  directoryPickerLabel,
  filterDirectoryPickerEntries,
  formatDirectoryEntryId,
  isDirectoryI18nKey,
  directoryShowsParentField,
  directoryUsesL10nLabel,
  entryPropertiesIncludeParent,
  getDirectoryMetadata,
  isManagedDirectory,
  isManagedDirectoryName,
  resolveParentSourceName,
  vocabularyParentRequired,
  vocabularySupportsParent,
  vocabularyTableColumns,
} from './lib/models/directory.model';
export type { NuxeoAce, NuxeoAcl } from './lib/models/acl.model';
export type {
  SearchQueryParams,
  GlobalSearchSuggestion,
  SavedSearchOption,
  // The return element of the public `getUserCollections()`. It was the only one of the four
  // option types this service publishes that was not exported, so the method's own return
  // type was unnameable by a caller — `docs/api/platform.api.md` referenced it from the class
  // while declaring nothing. Found by the spec-typecheck gate when a test tried to name it.
  SearchCollectionOption,
} from './lib/services/search.service';
export type {
  SearchAggregations,
  SearchResponse,
  SearchResultItem,
} from './lib/models/search.model';
export type {
  AuthorizedApplication,
  ConnectedAccount,
  NuxeoOAuth2ServiceProvider,
  NuxeoOAuth2ServiceProviderList,
  NuxeoOAuth2Token,
  NuxeoOAuth2TokenList,
} from './lib/models/oauth2.model';
export type {
  NuxeoWorkflow,
  NuxeoWorkflowList,
  NuxeoWorkflowModel,
  NuxeoWorkflowModelList,
} from './lib/models/workflow.model';
export type { NuxeoUser, NuxeoUserList, NuxeoGroup, NuxeoGroupList } from './lib/models/user.model';
export type {
  PrincipalPermissionRow,
  PrincipalPermissionPage,
} from './lib/models/principal-permissions.model';
export type { NuxeoOAuth2Provider } from './lib/models/oauth.model';

// Config
export { NUXEO_API_ORIGIN, NUXEO_SERVER_URL } from './lib/nuxeo-api.config';
export { CURRENT_USERNAME } from './lib/current-user.token';
export { ADMIN_ACCESS_CHECKS, type AdminAccessChecks } from './lib/auth/admin-access.token';
export {
  administrationAccessGuard,
  administrationLandingGuard,
  fullAdministratorGuard,
} from './lib/auth/admin-route.guards';
export {
  NUXEO_POWERUSERS_GROUP,
  isPowerUserFromGroups,
  readGroupsFromMe,
} from './lib/auth/user-groups.util';
export type { NuxeoSamlLoginEndpoint } from './lib/saml-login.config';
export {
  NUXEO_SAML_LOGIN_ENDPOINTS,
  NUXEO_SSO_POST_LOGIN_PATH,
  NUXEO_SSO_RETURN_QUERY_PARAM,
} from './lib/saml-login.config';

// Services
export { NuxeoApiBase } from './lib/services/nuxeo-api-base';
export { AssetService } from './lib/services/asset.service';
export {
  AssetAggregationService,
  type AssetQueueItem,
} from './lib/services/asset-aggregation.service';
export { DocumentService } from './lib/services/document.service';
export {
  DocumentImportService,
  BLOB_HOLDING_DOC_TYPES,
  BLOB_NOT_ATTACHED_ERROR,
  DEFAULT_IMPORT_PARENT_PATH,
  RESTRICTED_IMPORT_LOCATION_MESSAGE_KEY,
  documentHasMainBlob,
  documentHasPersistedMainBlob,
  inferBlobDocTypeFromFile,
  isBlobHoldingDocType,
  isFolderishDocument,
  isBrowsableNavNode,
  isRepositoryRootPath,
  isRestrictedImportParentPath,
  resolveImportBlobDocType,
  sanitizeDocumentName,
  sanitizeDocumentCreateName,
  mergeCreateDocumentBody,
  summarizeCsvImportReport,
  titleFromFileName,
  type CsvImportResult,
  type CsvServerImportOptions,
  type CreateBlobHoldingDocumentOptions,
  type ImportFileEntry,
  type ImportFilesOptions,
  type ImportProgress,
  type StagedBatchFile,
  type StageFileInBatchOptions,
  type NuxeoCreateDocumentTemplate,
} from './lib/services/document-import.service';
export { TaskService } from './lib/services/task.service';
export { CollectionService } from './lib/services/collection.service';
export {
  BrowseService,
  type BrowsePageRequest,
  type BrowseSortEntry,
} from './lib/services/browse.service';
export {
  BrowseContextService,
  type ClipboardPasteEvent,
} from './lib/services/browse-context.service';
export { ClipboardTargetService } from './lib/services/clipboard-target.service';
export {
  browseTreeContextPath,
  cumulativeNuxeoPathPrefixes,
  decodeNuxeoPathSegment,
  expandableNuxeoPathPrefixes,
  normalizeNuxeoPath,
  parentNuxeoFolderPath,
  parseBrowseNuxeoPathFromRouterUrl,
  nuxeoPathsEqual,
  nuxeoPathsEqualFlexible,
  nuxeoPathSegments,
  toBrowseRouterUrl,
  isBrowseRouterUrl,
  topLevelNuxeoFolderPath,
  BROWSE_RETURN_MODE_PARAM,
  parseBrowseReturnMode,
  toAdfHxBrowseRouterUrl,
  isAdfHxBrowseRouterUrl,
  parseAdfHxBrowsePathFromRouterUrl,
  toBrowseRouterUrlForReturnMode,
  type BrowseReturnMode,
  isUserWorkspacePath,
  userWorkspaceOwnerFromPath,
  userWorkspaceRootFromPath,
  shouldShowUserWorkspaceBreadcrumbs,
  userWorkspaceBrowseRouterUrl,
  postTrashBrowseRouterUrl,
  documentNavigationUrl,
  isCollectionDocument,
} from './lib/utils/browse-path.utils';
export { ContentLakeIngestService } from './lib/services/content-lake-ingest.service';
export {
  DocumentDetailService,
  type UserGroupSuggestion,
  type NuxeoComment,
  type NuxeoCommentList,
} from './lib/services/document-detail.service';
export { DirectoryService } from './lib/services/directory.service';
export { SearchService } from './lib/services/search.service';
export { SearchAggregationService } from './lib/services/search-aggregation.service';
export { SelectionService } from './lib/services/selection.service';
export { WorkflowService } from './lib/services/workflow.service';
export { UserService } from './lib/services/user.service';
export { TagService } from './lib/services/tag.service';
export { NuxeoDriveService } from './lib/services/nuxeo-drive.service';
export { ARenderService } from './lib/services/arender.service';
export { ARENDER_CONFIG, type ARenderConfig } from './lib/arender.config';
export {
  SettingsService,
  type LocalPermissionRow,
  type SynchronizationRootRow,
} from './lib/services/settings.service';
export { ContentModelService } from './lib/services/content-model.service';
export {
  AdministrationService,
  FALLBACK_DIRECTORY_NAMES,
} from './lib/services/administration.service';
export { PrincipalPermissionsService } from './lib/services/principal-permissions.service';
export {
  TrashService,
  type TrashSearchParams,
  type SavedSearch,
} from './lib/services/trash.service';
export {
  TrashFilterService,
  type TrashFilters,
  type TrashLayoutMode,
  type TrashResultItem,
} from './lib/services/trash-filter.service';

// Constants
export { DOC_TYPE_ICONS, docTypeIcon } from './lib/constants/doc-type-icons';
export { DOC_TYPE_LABEL_KEYS, docTypeLabel } from './lib/constants/doc-type-labels';
export { DocTypeLabelPipe } from './lib/constants/doc-type-label.pipe';
export { taskDueDistance, type TaskDueDistance } from './lib/utils/task-due-distance';
export { avatarColor } from './lib/constants/avatar-colors';
export type { AvatarColor } from './lib/constants/avatar-colors';
export { FOLDERISH_TYPES } from './lib/constants/folderish-types';
export { NON_CONTENT_DOCUMENT_TYPES } from './lib/constants/non-content-document-types';
export {
  WORKSPACE_CONTENT_TYPE_ORDER,
  parseDocumentSubtypes,
  sortDocumentSubtypes,
  type NuxeoSubtypeEntry,
} from './lib/utils/parse-document-subtypes';
export {
  ADD_CHILDREN,
  MANAGE_DOCUMENT_PERMISSIONS,
  PERMISSION_DENIED_KEY,
  REMOVE_DOCUMENT,
  WRITE_DOCUMENT,
  WRITE_PROPERTIES,
  WRITE_VERSION,
  canAddChildren,
  canCreateDocumentVersion,
  canManageDocumentPermissions,
  canPublishDocument,
  canRemoveDocument,
  canShowRemoveDocumentAction,
  canShowWriteDocumentAction,
  canTagDocument,
  canViewDocumentAuditLog,
  canWriteDocument,
  hasDocumentPermission,
  hasDocumentPermissionsEnricher,
  isPermissionDeniedError,
  isRecordDocument,
  READ_WRITE_DOCUMENT,
} from './lib/utils/document-permissions';
export {
  buildDocumentCompareSections,
  formatCompareDate,
  formatCompareValue,
  isCompareIconField,
  resolveNuxeoIconPath,
  type CompareRow,
  type CompareSection,
} from './lib/utils/document-compare.utils';
export {
  DOMAIN_CONTAINER_GUIDANCE_KEY,
  DOMAIN_STRUCTURAL_ROOT_TYPES,
  filterCreatableSubtypesForParent,
  isDomainParentType,
  resolveCreatableSubtypes,
} from './lib/utils/creatable-subtypes';
export {
  CLIPBOARD_STORAGE_KEY,
  canPasteClipboard,
  readClipboardDocs,
  writeClipboardDocs,
  type ClipboardDoc,
} from './lib/utils/clipboard.utils';
export {
  principalPermissionTimeFrameLabel,
  principalPermissionToLocalRow,
} from './lib/utils/principal-permission-display';
// `formatPermissionTimeFrame` is deliberately NOT re-exported: its only callers are
// `settings.service.ts` and `principal-permission-display.ts`, both inside this library. It was
// briefly exported here purely because it shares a file with `formatAceDateRange`, which widened
// the published surface for nothing.
export { formatAceDateRange } from './lib/utils/permission-timeframe.utils';
export { permissionRightLabel } from './lib/utils/permission-label.utils';
export {
  isNavigableBaseUrl,
  navigableUrlOrNull,
  originOf,
  insecureAllowedForHost,
  mediaTypeEssence,
  type NavigableUrlPolicy,
} from './lib/utils/navigable-url';
export { trustObjectUrl } from './lib/utils/trust-object-url';
export { renderTrustedHtml, type TrustedHtmlConfig } from './lib/utils/render-trusted-html';
export {
  mergeDocumentPermissionsContext,
  normalizeDocumentAcls,
  resolveAcePrincipal,
} from './lib/utils/ace-principal';
export {
  NOTE_FORMAT_OPTIONS,
  defaultNoteContent,
  formatNoteHtmlForSourceView,
  isHtmlNoteFormat,
  noteFormatLabel,
  type NoteMimeType,
} from './lib/utils/note-format';
export { isMarkdownNoteFormat, isSafeHttpUrl, renderNoteMarkdown } from './lib/utils/note-markdown';
export {
  PERMISSION_NOTIFICATION_MAIL_HINT_KEY,
  findLocalAceForPrincipal,
  isMailSendError,
  mailSendFailureKey,
  mailSendFailureMessage,
  permissionCreateMailFailureMessage,
  permissionNotificationAceNotFoundKey,
  permissionNotificationAceNotFoundMessage,
  permissionUpdateMailFailureMessage,
  type PermissionMessageTranslate,
  type PermissionWithNotificationResult,
} from './lib/utils/permission-notification';
export {
  buildNoteDocumentPickerNxql,
  filterInsertablePictureDocuments,
  hasInsertablePictureBlob,
  NOTE_DOCUMENT_PICKER_HEADERS,
  NOTE_DOCUMENT_PICKER_PROVIDER,
  normalizeDocumentPickerList,
} from './lib/utils/note-document-picker-search';
export { resolvePaginatedListTotal } from './lib/utils/paginated-total';
export type { PaginatedListMeta } from './lib/utils/paginated-total';
export { escapeNxqlLiteral } from './lib/utils/nxql.utils';
export {
  formatHierarchicalL10nLabel,
  groupL10nChildrenByParent,
  l10nEntryLabel,
  resolveNatureLabel,
} from './lib/utils/l10n-directory.utils';
export type { L10nOptionGroup } from './lib/utils/l10n-directory.utils';
export {
  isExpiresFieldValid,
  shouldShowExpiresFieldError,
  createExpiresErrorStateMatcher,
} from './lib/utils/expires-date.utils';
export {
  CONTENT_LAKE_INGEST_DOCUMENT_TYPES,
  CONTENT_LAKE_INGEST_MARKER_LEGACY_PROPERTY,
  CONTENT_LAKE_INGEST_MARKER_PREFIX,
  CONTENT_LAKE_INGEST_MARKER_PROPERTY,
  CONTENT_LAKE_INGEST_MARKER_PROPERTIES,
  buildContentLakeIngestMarker,
  isContentLakeIngestCurrent,
  needsContentLakeIngest,
  readBlobDigest,
  readContentLakeIngestMarker,
  resolveIngestMarkerWriteProperty,
  shouldProbeContentLakeIngestStatus,
  supportsContentLakeIngest,
} from './lib/utils/content-lake-ingest';

// Queries (for advanced / custom use)
export {
  RECENTLY_EDITED_QUERY,
  RECENTLY_VIEWED_QUERY,
  EXPIRED_DOCUMENTS_QUERY,
  FAVORITES_COLLECTION_QUERY,
} from './lib/queries/nxql-queries';
export { formatRelativeTime } from './lib/utils/relative-time.utils';
