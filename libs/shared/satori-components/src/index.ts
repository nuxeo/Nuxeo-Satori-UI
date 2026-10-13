export {
  NxsActionMenuComponent,
  type NxsMenuAction,
} from './lib/action-menu/action-menu.component';
export {
  NxsColumnPickerComponent,
  type NxsPickableColumn,
} from './lib/column-picker/column-picker.component';
export {
  NxsCommentExtraDirective,
  type NxsCommentContext,
} from './lib/comments/comment-extra.directive';
export { NxsCommentsComponent } from './lib/comments/comments.component';
export { NxsTagEditorComponent } from './lib/tag-editor/tag-editor.component';
export {
  NxsDetailsPanelComponent,
  type NxsDetailsPanelTab,
} from './lib/details-panel/details-panel.component';
export { NxsDocTypeIconComponent } from './lib/doc-type-icon/doc-type-icon.component';
export {
  NxsDocumentToolbarComponent,
  type NxsToolbarAction,
} from './lib/document-toolbar/document-toolbar.component';
export { NxsDomainHintComponent } from './lib/domain-hint/domain-hint.component';
export {
  NxsDriveDialogComponent,
  type NxsDriveDialogData,
} from './lib/drive-dialog/drive-dialog.component';
export { NxsEmptyStateComponent } from './lib/empty-state/empty-state.component';
export { NxsErrorStateComponent } from './lib/error-state/error-state.component';
export { type NxsErrorStatus, nxsErrorStatus } from './lib/error-state/error-status';
export { NxsFavoriteToggleComponent } from './lib/favorite-toggle/favorite-toggle.component';
export {
  NXS_FAVORITES_CHANGED_EVENT,
  nxsToggleFavorite,
} from './lib/favorite-toggle/toggle-favorite';
export { NxsFolderHeaderComponent } from './lib/folder-header/folder-header.component';
export type { NxsHeadingLevel } from './lib/heading-level';
export { NxsIconComponent } from './lib/icon/icon.component';
export { NxsMetadataEditorComponent } from './lib/metadata-editor/metadata-editor.component';
export type {
  NxsEditorConstraints,
  NxsEditorDisplay,
  NxsEditorField,
  NxsEditorFieldType,
  NxsEditorSection,
  NxsEditorValues,
} from './lib/metadata-editor/metadata-editor.model';
export {
  NXS_PERMISSIONS_PANEL_ID,
  NxsPermissionsPanelComponent,
} from './lib/permissions-panel/permissions-panel.component';
export {
  NxsPropertiesPanelComponent,
  type NxsVocabularyLabel,
} from './lib/properties-panel/properties-panel.component';
export { nxsPropertyText } from './lib/properties-panel/property-text';
export { NxsSpinnerComponent } from './lib/spinner/spinner.component';
export {
  NxsTabBodyDirective,
  type NxsTab,
  type NxsTabBodyContext,
} from './lib/tabs/tab-body.directive';
export { NxsTabsComponent } from './lib/tabs/tabs.component';
export { provideNxsThumbnailCache } from './lib/thumbnail/thumbnail-cache';
export { NxsThumbnailComponent } from './lib/thumbnail/thumbnail.component';
export {
  NXS_TOAST_DURATION,
  NxsToastService,
  provideNxsToast,
  type NxsToastAction,
  type NxsToastErrorOptions,
  type NxsToastOptions,
} from './lib/toast/toast.service';
export { NxsAvatarComponent } from './lib/avatar/avatar.component';
export { NxsBreadcrumbsComponent } from './lib/breadcrumbs/breadcrumbs.component';
export { NxsTagComponent } from './lib/tag/tag.component';
export { NxsRichTooltipComponent } from './lib/rich-tooltip/rich-tooltip.component';
export {
  NXS_PRIMITIVE_IDS,
  type NxsAvatarColor,
  type NxsAvatarInputs,
  type NxsAvatarSize,
  type NxsBreadcrumbItem,
  type NxsBreadcrumbsInputs,
  type NxsRichTooltipInputs,
  type NxsTagColor,
  type NxsTagInputs,
} from './lib/primitives';
export { provideNxsComponents } from './lib/provide-nxs-components';
// satori:export:components — `satori-component` inserts above this line
