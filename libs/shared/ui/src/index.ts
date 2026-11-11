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
// Only the provider. `libs/platform/package.json` already declares `date-fns` and
// `@angular/material-date-fns-adapter` as peer dependencies, so a customer's install depends on
// that choice either way; what stays unexported is the date-fns `Locale` type, which
// `dateFnsLocaleFor` returns and which would otherwise enter our TypeScript API.
export { provideSatoriDateAdapter } from './lib/date-adapter/satori-date-adapter';
// `canFormatDatesIn` takes a string and returns a boolean, so it carries no date-fns type into
// the API either — the same reason `dateMaskFor` below is exportable and `dateFnsLocaleFor` is
// not. It is public because the question it answers is about this BUILD, not about a
// deployment's configuration: which locales the bundled date-fns map can parse. A host that
// provides its own `LOCALE_ID` — directly, or by mounting one of our exported dialogs — needs
// it to avoid formatting dates in a locale we would then read back as English (#522).
export { canFormatDatesIn } from './lib/date-adapter/satori-date-adapter';
// `dateMaskFor` takes and returns strings, so it carries no date-fns type into the API. It is
// exported beside the pipe for a host that renders its own date hint.
export { dateMaskFor } from './lib/date-adapter/date-mask';
export { DateMaskPipe } from './lib/date-adapter/date-mask.pipe';
export { PLATFORM_EN_TRANSLATIONS } from './lib/i18n/platform-en';
export {
  PLATFORM_MISSING_TRANSLATION_NEXT,
  PlatformEnglishMissingTranslationHandler,
  providePlatformEnglishFallback,
} from './lib/i18n/platform-english-fallback';
