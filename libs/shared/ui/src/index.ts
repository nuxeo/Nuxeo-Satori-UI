export * from './lib/ui/ui';
export { SelectionTopbarComponent } from './lib/selection-topbar/selection-topbar.component';
export {
  DocumentCompareDialogComponent,
  type DocumentCompareDialogData,
} from './lib/document-compare-dialog/document-compare-dialog.component';
export { openDocumentCompareDialog } from './lib/document-compare-dialog/open-document-compare-dialog';
export { WidgetContainerComponent } from './lib/widget-container/widget-container.component';
export { WidgetGridComponent } from './lib/widget-grid/widget-grid.component';
export {
  ShareDialogComponent,
  type ShareDialogData,
} from './lib/share-dialog/share-dialog.component';
export {
  DocumentViewerComponent,
  type VideoSource,
  type StoryboardItem,
  type PictureInfo,
  type PictureView,
  type ExifData,
  type IptcData,
  type VideoInfo,
} from './lib/document-viewer/document-viewer.component';
export {
  ExportDialogComponent,
  type ExportDialogData,
  type ExportType,
} from './lib/export-dialog/export-dialog.component';
export {
  SavedSearchDialogComponent,
  SAVED_SEARCH_DIALOG_OPTIONS,
  type SavedSearchDialogData,
} from './lib/saved-search-dialog/saved-search-dialog.component';
export {
  ShareSavedSearchDialogComponent,
  type ShareSavedSearchDialogData,
  type PermissionEntry,
} from './lib/share-saved-search-dialog/share-saved-search-dialog.component';
export {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from './lib/confirm-dialog/confirm-dialog.component';
export {
  EditCollectionDialogComponent,
  type EditCollectionDialogData,
} from './lib/edit-collection-dialog/edit-collection-dialog';
export {
  trashDocumentConfirmData,
  trashSelectedDocumentsConfirmData,
  // Both functions take this, so a consumer cannot call either without being able to name it.
  type TranslateFn,
} from './lib/confirm-dialog/trash-confirm.utils';
export {
  observeStripRedundantMatInputAriaRequired,
  stripRedundantMatInputAriaRequired,
} from './lib/login-mat-input-required-a11y';
export {
  MAT_TAB_LIST_IBM_ONKEYDOWN,
  MAT_TAB_LIST_KEYDOWN_ATTR,
  observeMatTabListKeyboardA11y,
  wireMatTabListKeyboardA11y,
} from './lib/mat-tab-list-keyboard-a11y';
export { MatTabListKeydownDirective } from './lib/mat-tab-list-keydown.directive';
export {
  TranslatedDatepickerIntl,
  provideTranslatedDatepickerIntl,
} from './lib/datepicker-intl/translated-datepicker-intl';
export { PLATFORM_EN_TRANSLATIONS } from './lib/i18n/platform-en';
export {
  PLATFORM_MISSING_TRANSLATION_NEXT,
  PlatformEnglishMissingTranslationHandler,
  providePlatformEnglishFallback,
} from './lib/i18n/platform-english-fallback';
