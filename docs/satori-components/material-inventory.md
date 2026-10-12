# Material inventory: what Satori 1.0 replaces, and where it is used today

**Measured:** 2026-10-08 on `main` at `70b4bb202` · **Ticket:** [NXSAT-308](https://hyland.atlassian.net/browse/NXSAT-308) ·
**Plan:** section 3a ("Material to Satori adoption") · **This is the backlog for the `nxs-wrappers` todo.**

The plan's section 3a lists the patterns Satori 1.0 replaces. This record lists every direct use of
those patterns in feature, shared and app code, with its Satori target and the `nxs-` wrapper that should
own it. It also covers the two wrapper-only patterns, `MatSnackBar` toasts and inline error states.

## 1. Read this first

- **The targets were re-checked against the latest alpha.** The `alpha` dist-tag is
  `@hylandsoftware/satori-ui@1.0.0-alpha.142`, published 2026-10-07. It has the same 30 entry points as
  `alpha.135`, which the plan's list came from. The mappings below were read from alpha.142's `.d.ts`
  files and implementation, not from entry-point names. That changed five of them (section 3).
- **Line numbers are as of `70b4bb202`** and will drift. Section 6 gives the scan, so the list can be
  regenerated rather than patched by hand.
- **Scope column.** `NXSAT-308` means the work is in this ticket. `NXSAT-326`, `-327`, `-328` and `-329` are
  the split-out trash, workflow and tasks, publishing, and users and groups tickets. The code stays on
  Material until those tickets take it. `admin (no ticket)` is the rest of the administration console;
  neither NXSAT-308 nor NXSAT-329 covers it. `DAM (§13 Q2)` is `libs/features/assets` and the
  attachment preview, pending plan section 13, question 2. `KD` and `AI` are outside the NXENG-615 Beta
  scope. `app` is `apps/nuxeo-ui`. `bridge` and `POC route` are deleted in the removal commit and are
  not migrated, except the bridge components the plan promotes (DocumentCards, Pager, DomainHint).

## 2. Summary

| Pattern                            | Sites (files)       | In NXSAT-308           | Satori 1.0 target (alpha.142)                                                                                   | `nxs-` wrapper                   |
| ---------------------------------- | ------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Tabs (`mat-tab-group`)             | 7 (7)               | 4                      | `navigation-tabs`: links, not panels (section 3, item 3)                                                        | `nxs-tabs`                       |
| Toolbar button groups              | 27 (19)             | 10                     | `action-bar` (`sat-action-group`, `sat-selection-bar`), `split-button`, `important-button`, `tonal-icon-button` | `nxs-action-bar`                 |
| Empty states (region level)        | 78 (24)             | 29                     | `empty-state` + `illustration`                                                                                  | `nxs-empty-state`                |
| Empty "none" text (inline)         | 17 (7)              | 12                     | none: stays text                                                                                                | none                             |
| Upload controls (drop zone, input) | 7 (5)               | 6                      | `upload` (`[satUpload]`, `sat-upload-area`), `upload-field`                                                     | `nxs-upload`                     |
| Upload queues                      | 2 (2)               | 1                      | `upload-field` file list (fit not verified)                                                                     | `nxs-upload`                     |
| Cards and grid tiles               | 7 (7)               | 2, plus DocumentCards  | `interactive-card`, `card-surface`                                                                              | `nxs-card`                       |
| Banners and inline notices         | 20 (12)             | 6                      | `banner`                                                                                                        | `nxs-banner`                     |
| Chips (`mat-chip-set`/`-grid`)     | 18 (7)              | 16                     | **none**: `inline-chip` is not an input chip (section 3, item 1)                                                | **none**; owned by §5 J/K inputs |
| Loading: existing skeletons        | 7 (3)               | 0                      | `ghost`                                                                                                         | `nxs-ghost`                      |
| Loading: region-level spinners     | 56 (33)             | 20                     | `ghost` where the content shape is known                                                                        | `nxs-ghost` or `nxs-spinner`     |
| Loading: inline spinners and bars  | 69 (25)             | 30                     | none; stays `mat-spinner`/`mat-progress-bar`                                                                    | `nxs-spinner` (§5 H)             |
| Split panes                        | 0 resizable         | 0                      | `splitter`, `nested-scrollviews`                                                                                | `nxs-splitter`, only if wanted   |
| Tables                             | 49 (22)             | 20, plus search's list | Material table + `table-with-row-states` (section 4.10)                                                         | `nxs-document-list` for lists    |
| Toasts (`MatSnackBar`)             | 30 files, 173 calls | 14 files, 85 calls     | none (wrapper only)                                                                                             | `nxs-toast`                      |
| Inline `@if (error())` states      | 54 (32)             | 19                     | `empty-state`'s **error states** (section 3, item 2)                                                            | `nxs-error-state`, `nxs-banner`  |

How to read the counts. A site is one element: one `<mat-tab-group>`, one action bar, one `<table>`, one
drop zone together with its file input. For toasts it is one call. The NXSAT-308 column counts sites in the
core slice: `libs/features/{browse,search,document-detail,collections}` and `libs/shared/*`, excluding the
bridge and the parts of document detail and browse that belong to the split-out tickets. Spinner and toast
files overlap other patterns, so the file counts do not add up across rows.

## 3. Corrections to the plan's section 3a mapping

Read from the alpha.142 typings and implementation in `@hylandsoftware/satori-ui`.

1. **Chips have no Satori 1.0 target.** `SatInlineChip` matches `button[sat-inline-chip]` and
   `a[sat-inline-chip]`. It is an inline, clickable chip sized to sit in body text (`size: 'medium' |
'large'`, `triggersTooltip`). It is not a removable chip in a form field. Every one of the 18 chip sites
   is a `mat-chip-set` or `mat-chip-grid` of removable chips inside an input: vocabulary triggers, the
   inline tag editor, and admin member pickers. **Drop `nxs-chip` from the wrapper list.** These sites
   belong to the tag editor, vocabulary selector and user and group picker in plan sections 5 J and 5 K,
   and stay `mat-chip-*` underneath. Display tags already use Satori's `tag` (`sat-category-tag`).
2. **Error states do have a Satori target.** The plan says neither `nxs-toast` nor `nxs-error-state` has
   one. Toasts are right. Error states are not: the `empty-state` entry point also exports
   `sat-401-error-state`, `sat-403-error-state`, `sat-404-error-state` and `sat-500-error-state`, plus
   `satErrorStateHeadline`, `satErrorStateDescription` and `satErrorStateIllustration` for overriding
   them. They were already in alpha.135; only the entry-point name hid them. `nxs-error-state` should
   wrap them, so the "permission-denied folder" and "500 from Nuxeo" parity cases in plan section 10 map
   onto `403` and `500`.
3. **`navigation-tabs` navigates between links; it does not switch panels.** It is `sat-navigation-tabs`
   with `a[satNavigationTab]` children and an `active` input, the analogue of `mat-tab-nav-bar`. All
   seven tab groups here are `mat-tab-group`s with in-page panels. Adopting it means making tab
   selection navigational (for example a `tab` query parameter) and rendering the panel in the host.
   That is a design change for TabsHost and the six `app.tabs.*` IDs, not a drop-in swap.
4. **`action-bar` fits our action descriptors more closely than the plan says.** `sat-action-group` takes
   `items: { icon, action, label | ariaLabel, disabled?, hasTrailingDivider? }[]`. It collapses overflow into
   a "More" menu and gives arrow-key navigation, mirrored for RTL. `sat-selection-bar` takes `count` and
   `actions` and emits `cleared`. These map onto the `toolbar` slot (with `contextMenu` as the overflow)
   and onto SelectionTopbar's `bulk-actions` slot. `nxs-action-bar` should accept resolved
   `ExtensionActionDescriptor`s and translate them, so no Satori type reaches a customer.
5. **`ghost` is decorative only.** `sat-ghost` (`variant: box | round`, `fitContainer`) is
   `aria-hidden`. Its documentation requires a separate `role="status"` `aria-live="polite"` element to
   announce loading. `nxs-ghost` must own that live region, or swapping a spinner for a ghost removes the
   only loading announcement.

Two smaller points. `header-bar` is a new entry point the plan does not map; it is a candidate for the page
headers in browse, document detail and collection detail. `table-with-row-states` styles only Material
rows; see the [table-primitive decision](decision-table-primitive.md).

## 4. The inventory, pattern by pattern

### 4.1 Tabs → `navigation-tabs` → `nxs-tabs`

| Site                                                                                                        | What it is                                                               | Scope             |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------- |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html:352`                            | TabsHost: `@for (tab of detailTabs())` over the six `app.tabs.*` IDs     | NXSAT-308         |
| `libs/features/browse/src/lib/browse/browse.html:105`                                                       | Browse page tabs (View, Permissions, History, Trash), `activeTabIndex()` | NXSAT-308         |
| `libs/features/collections/src/lib/collection-detail/collection-detail.html:151`                            | Collection tabs                                                          | NXSAT-308         |
| `libs/shared/document-layouts/src/lib/document-layout/document-layout.html:9`                               | Schema-driven layout sections rendered as tabs                           | NXSAT-308         |
| `libs/features/administration/src/lib/admin-users-groups-page/admin-users-groups-page.component.html:117`   | Users and groups tabs                                                    | NXSAT-329         |
| `libs/features/administration/src/lib/admin-analytics-page/admin-analytics-page.component.html:15`          | Analytics tabs                                                           | admin (no ticket) |
| `libs/features/administration/src/lib/admin-cloud-services-page/admin-cloud-services-page.component.html:8` | Cloud services tabs                                                      | admin (no ticket) |

### 4.2 Toolbar button groups → `action-bar` and the button set → `nxs-action-bar`

| Site                                                                                                     | What it is                                                                                                         | Scope             | Target                                                                     |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------- |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html:33`, `:160`                  | DocumentToolbar: header actions, `@for (action of toolbarActions())` over 16 `app.toolbar.*` IDs, plus "More" menu | NXSAT-308         | `sat-action-group`, with the menu as overflow                              |
| `libs/features/browse/src/lib/browse/browse.html:13`, `:71`                                              | Browse header: Create/Import (primary), Drive, "More actions" `mat-menu` over `contextMenuActions()`               | NXSAT-308         | `important-button` or `split-button` for Create/Import, `sat-action-group` |
| `libs/features/browse/src/lib/browse/browse.html:201`                                                    | View toolbar actions: export CSV, view toggle, columns                                                             | NXSAT-308         | `sat-action-group`                                                         |
| `libs/features/collections/src/lib/collection-detail/collection-detail.html:52`                          | Collection header actions                                                                                          | NXSAT-308         | `sat-action-group`                                                         |
| `libs/features/search/src/lib/search/search.html:167`                                                    | Results toolbar: export CSV, view toggles                                                                          | NXSAT-308         | `sat-action-group`                                                         |
| `libs/features/search/src/lib/search/search.html:230`, `:451`                                            | Grid and list action bars: group-by select and actions                                                             | NXSAT-308         | `sat-action-group`                                                         |
| `libs/features/search/src/lib/search-filters-drawer/search-filters-drawer.component.html:1`              | Drawer header actions                                                                                              | NXSAT-308         | `tonal-icon-button`                                                        |
| `libs/shared/ui/src/lib/selection-topbar/selection-topbar.component.html:19`                             | SelectionTopbar: `bulk-actions` slot                                                                               | NXSAT-308         | `sat-selection-bar`                                                        |
| `libs/shared/ui/src/lib/document-viewer/document-viewer.component.html:115`                              | Document viewer toolbar                                                                                            | NXSAT-308         | `sat-action-group`                                                         |
| `libs/features/document-detail/src/lib/attachment-preview-dialog/attachment-preview-dialog.html:55`      | Attachment preview viewer toolbar                                                                                  | DAM (§13 Q2)      | `sat-action-group`                                                         |
| `libs/features/assets/src/lib/asset-search-results/asset-search-results.component.html:49`, `:57`        | Asset results toolbar                                                                                              | DAM (§13 Q2)      | `sat-action-group`                                                         |
| `libs/features/assets/src/lib/assets-drawer/assets-drawer.component.html:1`                              | Drawer header actions                                                                                              | DAM (§13 Q2)      | `tonal-icon-button`                                                        |
| `libs/features/trash/src/lib/trash/trash.component.html:36`, `:69`, `:81`, `:140`, `:360`                | Trash page header, results toolbar, grid and list action bars                                                      | NXSAT-326         | `sat-action-group`                                                         |
| `libs/features/tasks/src/lib/tasks-page/tasks-page.component.html:51`                                    | Task header actions                                                                                                | NXSAT-327         | `sat-action-group`                                                         |
| `libs/features/administration/src/lib/admin-users-groups-page/admin-users-groups-page.component.html:8`  | Users and groups toolbar                                                                                           | NXSAT-329         | `sat-action-group`                                                         |
| `libs/features/administration/src/lib/admin-audit-page/admin-audit-page.component.html:192`              | Audit toolbar                                                                                                      | admin (no ticket) | `sat-action-group`                                                         |
| `libs/features/administration/src/lib/admin-vocabularies-page/admin-vocabularies-page.component.html:31` | Vocabularies toolbar                                                                                               | admin (no ticket) | `sat-action-group`                                                         |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html:2001`                        | Sentiment toolbar in AI insights                                                                                   | AI (out of Beta)  | `sat-action-group`                                                         |
| `apps/nuxeo-ui/src/app/features/contracts/contracts-page.component.html:9`                               | Contracts page header actions                                                                                      | app               | `sat-action-group`                                                         |
| `apps/nuxeo-ui/src/app/settings/themes/themes-page.component.html:2`                                     | Themes page toolbar                                                                                                | app               | `sat-action-group`                                                         |
| `libs/shared/adf-hx-bridge/src/lib/ui/hxp-browse-toolbar/hxp-browse-toolbar.component.html:1`            | adf-hx POC browse toolbar                                                                                          | bridge            | deleted                                                                    |
| `libs/features/browse/src/lib/browse-adf-hx-poc/browse-adf-hx-poc.html:240`                              | adf-hx POC viewer toolbar                                                                                          | POC route         | deleted                                                                    |

Not an action bar, and staying as it is: the Quill formatting toolbar in
`libs/features/document-detail/src/lib/note-editor/note-editor.html:54` (`role="toolbar"`).

### 4.3 Empty states → `empty-state` + `illustration` → `nxs-empty-state`

Region-level "nothing here" blocks, one row per file:

| File                                                                                                      | Lines                                                                        | Scope             |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------- |
| `libs/features/browse/src/lib/browse/browse.html`                                                         | 255 (empty folder), 518, 616, 620, 682 (no permissions), 815 (no history)    | NXSAT-308         |
| `libs/features/collections/src/lib/collection-detail/collection-detail.html`                              | 175, 239, 323, 327, 378, 534                                                 | NXSAT-308         |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html`                              | 531, 626, 632, 691 (permissions), 861 (history), 1897, 2247, 2318 (sections) | NXSAT-308         |
| `libs/features/search/src/lib/search/search.html`                                                         | 322, 442, 543                                                                | NXSAT-308         |
| `libs/features/search/src/lib/search-queue/search-queue.component.html`                                   | 17                                                                           | NXSAT-308         |
| `libs/features/search/src/lib/search-filters-drawer/search-filters-drawer.component.html`                 | 20, 24, 38 (no saved filters)                                                | NXSAT-308         |
| `libs/features/browse/src/lib/folder-picker/folder-picker-dialog.component.html`                          | 48                                                                           | NXSAT-308         |
| `libs/shared/ui/src/lib/document-compare-dialog/document-compare-dialog.html`                             | 45                                                                           | NXSAT-308         |
| `libs/features/browse/src/lib/browse/browse.html`                                                         | 934 (browse trash tab)                                                       | NXSAT-326         |
| `libs/features/trash/src/lib/trash/trash.component.html`                                                  | 210, 352, 455                                                                | NXSAT-326         |
| `libs/features/trash/src/lib/trash-filters-drawer/trash-filters-drawer.component.html`                    | 215                                                                          | NXSAT-326         |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html`                              | 307 (no workflow models)                                                     | NXSAT-327         |
| `libs/features/tasks/src/lib/task-list/task-list.component.html`                                          | 25                                                                           | NXSAT-327         |
| `libs/features/tasks/src/lib/tasks-page/tasks-page.component.html`                                        | 5, 297                                                                       | NXSAT-327         |
| `libs/features/tasks/src/lib/task-detail/task-detail.component.html`                                      | 69                                                                           | NXSAT-327         |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html`                              | 986, 1103 (publishing)                                                       | NXSAT-328         |
| `libs/features/administration/src/lib/admin-group-details-page/admin-group-details-page.component.html`   | 95, 136, 209                                                                 | NXSAT-329         |
| `libs/features/administration/src/lib/admin-user-details-page/admin-user-details-page.component.html`     | 101, 174, 257                                                                | NXSAT-329         |
| `libs/features/administration/src/lib/admin-users-groups-page/admin-users-groups-page.component.html`     | 109, 216, 340                                                                | NXSAT-329         |
| `libs/features/administration/src/lib/admin-vocabularies-page/admin-vocabularies-page.component.html`     | 114                                                                          | admin (no ticket) |
| `libs/features/administration/src/lib/admin-cloud-services-page/admin-cloud-services-page.component.html` | 51                                                                           | admin (no ticket) |
| `libs/features/assets/src/lib/asset-search-results/asset-search-results.component.html`                   | 109, 270                                                                     | DAM (§13 Q2)      |
| `libs/features/assets/src/lib/assets-drawer/assets-drawer.component.html`                                 | 21, 25, 39                                                                   | DAM (§13 Q2)      |
| `libs/features/assets/src/lib/assets-queue/assets-queue.component.html`                                   | 3                                                                            | DAM (§13 Q2)      |
| `libs/features/knowledge-discovery/src/lib/knowledge-discovery/knowledge-discovery.html`                  | 287, 331, 356, 440, 471                                                      | KD (out of Beta)  |
| `apps/nuxeo-ui/src/app/dashboard/dashboard-page.component.html`                                           | 30, 35 (AI insights), 82, 137, 169, 217 (widgets)                            | app               |
| `apps/nuxeo-ui/src/app/shell/nav-drawer/nav-drawer.component.html`                                        | 77, 111, 129, 164, 201, 251, 308, 344, 446 (compact, in the drawer)          | app               |

Inline "none" text, which is **not** an empty state and stays as text: `browse.html:1127`, `:1186`
(`no-data`); `document-detail.html:1639` (version dropdown) and `:1841` (tags "—");
`search-filters-drawer.component.html:116`, `:261`, `:292`, `:323`, `:352` and
`assets-drawer.component.html:118` (`filter-no-results`); empty table cells in
`share-saved-search-dialog.component.html:87`, `:123`, `:235`, `nuxeo-drive-page.component.html:77`, `:85`,
`:137` and `profile-page.component.html:57`.

### 4.4 Upload → `upload`, `upload-field` → `nxs-upload`

| Site                                                                                                      | What it is                                                 | Scope            |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------- |
| `libs/features/browse/src/lib/create-import/create-import-dialog.component.html:188`, `:192`              | Upload drop zone (`onUploadDrop`) and its file input       | NXSAT-308        |
| `libs/features/browse/src/lib/create-import/create-import-dialog.component.html:276`, `:280`              | CSV import drop zone (`onCsvDrop`) and its file input      | NXSAT-308        |
| `libs/features/browse/src/lib/create-import/create-import-dialog.component.html:446`, `:450`              | Content drop zone (`onContentDrop`) and its file input     | NXSAT-308        |
| `libs/features/document-detail/src/lib/replace-attachment-dialog/replace-attachment-dialog.html:9`, `:18` | Replace-attachment drop zone and hidden file input         | NXSAT-308        |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html:1968`                         | Hidden attachment input (`uploadAttachment`)               | NXSAT-308        |
| `libs/features/document-detail/src/lib/note-editor/note-editor.html:249`                                  | Note editor image input                                    | NXSAT-308        |
| `libs/features/knowledge-discovery/src/lib/content-lake-upload/content-lake-upload.html:63`               | Content Lake upload input                                  | KD (out of Beta) |
| `libs/features/search/src/lib/search-queue/search-queue.component.html`                                   | Upload queue (`lib-search-queue`)                          | NXSAT-308        |
| `libs/features/assets/src/lib/assets-queue/assets-queue.component.html`                                   | Upload queue (`lib-assets-queue`), to unify with the above | DAM (§13 Q2)     |

Drop-on-list upload (plan section 5 I, Build) has no site today; no drop target exists outside these dialogs.

### 4.5 Cards and grid tiles → `interactive-card`, `card-surface` → `nxs-card`

| Site                                                                                          | What it is                                                                      | Scope        |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------ |
| `libs/features/browse/src/lib/browse/browse.html:433`, `:444`                                 | Browse grid view: `doc-card` with selection                                     | NXSAT-308    |
| `libs/features/search/src/lib/search/search.html:262`                                         | Search grid view: `result-card` with selection                                  | NXSAT-308    |
| `libs/shared/adf-hx-bridge/src/lib/ui/hxp-document-cards/hxp-document-cards.component.html:3` | DocumentCards, promoted per plan section 5 A                                    | bridge       |
| `libs/features/trash/src/lib/trash/trash.component.html:179`                                  | Trash grid view: `result-card`                                                  | NXSAT-326    |
| `libs/features/tasks/src/lib/task-detail/task-detail.component.html:37`                       | Target-document panel: preview, title, path, type, download (`document-banner`) | NXSAT-327    |
| `libs/features/assets/src/lib/asset-search-results/asset-search-results.component.html:118`   | Asset grid tile                                                                 | DAM (§13 Q2) |
| `apps/nuxeo-ui/src/app/features/contracts/contracts-page.component.html:207`                  | `mat-card` code sample                                                          | app          |

`interactive-card` carries a selection control slot (`satInteractiveCardSelectionControl`), title,
subtitle, header action and actions, which is what each selectable grid tile here builds by hand. The
task-detail panel is named a banner in its class but is a summary of the task's target document, not a
notice, so it is a card here rather than a `banner`.

### 4.6 Banners and inline notices → `banner` → `nxs-banner`

| Site                                                                                                      | What it is                                   | Scope                      |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------- |
| `libs/features/browse/src/lib/browse/browse.html:95`                                                      | Domain hint (`role="note"`), DomainHint      | NXSAT-308                  |
| `libs/shared/adf-hx-bridge/src/lib/ui/hxp-domain-hint/hxp-domain-hint.component.html:2`                   | DomainHint, promoted per plan section 5 A    | bridge                     |
| `libs/features/collections/src/lib/collection-detail/collection-detail.html:3`                            | Collection unavailable (`role="status"`)     | NXSAT-308                  |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html:216`                          | Trashed-document banner                      | NXSAT-308                  |
| `libs/features/browse/src/lib/create-import/create-import-dialog.component.html:128`, `:408`              | Location hints (`role="alert"`)              | NXSAT-308                  |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html:249`, `:271`                  | Workflow-started and task-action banners     | NXSAT-327                  |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html:202`, `:209`                  | Knowledge Enrichment and Content Lake status | KD (out of Beta)           |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html:1470`                         | AI error banner                              | AI (out of Beta)           |
| `libs/features/search/src/lib/search/search.html:77`                                                      | AI search error                              | NXSAT-308 page, AI feature |
| `libs/features/knowledge-discovery/src/lib/knowledge-discovery/knowledge-discovery.html:24`, `:53`, `:82` | KD banners                                   | KD (out of Beta)           |
| `libs/features/administration/src/lib/admin-analytics-page/admin-analytics-page.component.html:31`        | Warning callout                              | admin (no ticket)          |
| `libs/features/administration/src/lib/admin-audit-page/admin-audit-page.component.html:17`                | AI anomaly banner                            | admin (no ticket)          |
| `apps/nuxeo-ui/src/app/dashboard/dashboard-page.component.html:4`                                         | AI insights banner                           | app                        |
| `apps/nuxeo-ui/src/app/features/contracts/contracts-page.component.html:234`                              | Info banner                                  | app                        |
| `libs/features/browse/src/lib/browse-adf-hx-poc/browse-adf-hx-poc.html:19`                                | POC scope notice (`role="status"`)           | POC route (deleted)        |

The scan's `role` pattern matched 21 elements. The rows above cover 7 of them. The other 14 are accounted
for elsewhere or are not banners:

- **Form and load errors, in section 4.12:** `create-import-dialog.component.html:251`, `:332`, `:435` and
  `:950`; `browse-adf-hx-poc.html:84`; `hxp-browse-trash.component.html:9`.
- **A form validation hint, which stays as text:** `create-import-dialog.component.html:430`, "upload a
  main file to create".
- **Upload progress and success, which belong with `nxs-upload`:** `create-import-dialog.component.html:258`,
  `:335`, `:955` and `:1002`.
- **Live regions that are not notices.** The extension outlet's loading announcement
  (`libs/shared/extensions/src/lib/extension-outlet.component.html:2`) is the kind `nxs-ghost` needs
  (section 3, item 5). The bridge pager's range label
  (`libs/shared/adf-hx-bridge/src/lib/ui/hxp-browse-pager/hxp-browse-pager.component.html:2`) goes with the
  promoted Pager. The preset badge (`apps/nuxeo-ui/src/app/shell/preset-badge/preset-badge.component.html:4`)
  is a status badge.

### 4.7 Chips → no Satori target → stay Material, owned by the §5 J/K inputs

| Site                                                                                                                         | What it is                                      | Scope     |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------- |
| `libs/features/browse/src/lib/edit-metadata-dialog/edit-metadata-dialog.html:25`, `:70`, `:120`                              | Vocabulary triggers: nature, subjects, coverage | NXSAT-308 |
| `libs/features/document-detail/src/lib/edit-document-dialog/edit-document-dialog.html:25`, `:70`, `:120`                     | The same three, duplicated                      | NXSAT-308 |
| `libs/shared/ui/src/lib/edit-collection-dialog/edit-collection-dialog.html:25`, `:70`, `:120`                                | The same three, duplicated                      | NXSAT-308 |
| `libs/features/browse/src/lib/create-import/create-import-dialog.component.html:525`, `:573`, `:630`, `:771`, `:822`, `:879` | The same three, twice (create and import tabs)  | NXSAT-308 |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html:1788`                                            | Inline tag editor (`mat-chip-grid`)             | NXSAT-308 |
| `libs/features/administration/src/lib/group-form-dialog/group-form-dialog.component.html:25`                                 | Group member chips                              | NXSAT-329 |
| `libs/features/administration/src/lib/user-form-dialog/user-form-dialog.component.html:60`                                   | User group chips                                | NXSAT-329 |

Fifteen of the sixteen NXSAT-308 sites are one vocabulary chip trigger copied five times. That is the
vocabulary-selector deduplication in plan section 5 K, not a chip swap.

### 4.8 Loading → `ghost` → `nxs-ghost`; spinners → `nxs-spinner`

**Existing skeletons, all outside the Beta slice:** `apps/nuxeo-ui/src/app/dashboard/dashboard-page.component.html:23`
(AI KPI cards, app), `libs/features/administration/src/lib/admin-audit-page/admin-audit-page.component.html:55`
(AI anomaly cards, admin), and `libs/features/document-detail/src/lib/document-detail/document-detail.html:1187`,
`:1238`, `:1297`, `:1399`, `:1408` (AI insights, out of Beta). The core slice has no skeleton loader today.

**Spinners.** 125 sites in 47 files. A spinner is "inline" when its `diameter` is 24 or less (inside a
button or a row) and "region-level" otherwise, including Material's default of 100. ᵇ marks a
`mat-progress-bar`. Region-level spinners are `nxs-ghost` candidates where the shape of the coming content
is known, such as a list or a card grid. The rest are `nxs-spinner`.

| File                                                                                                            | Scope             | Region-level      | Inline                                     |
| --------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------- | ------------------------------------------ |
| `libs/features/browse/src/lib/browse/browse.html`                                                               | NXSAT-308         | 241               | 210, 494, 809, 1163                        |
| `libs/features/browse/src/lib/browse/browse.html`                                                               | NXSAT-326         | —                 | 928                                        |
| `libs/features/browse/src/lib/create-import/create-import-dialog.component.html`                                | NXSAT-308         | 52, 63            | 96, 139, 262ᵇ, 337ᵇ, 374, 459ᵇ, 959ᵇ       |
| `libs/features/browse/src/lib/drive-dialog/drive-dialog.html`                                                   | NXSAT-308         | 4                 | —                                          |
| `libs/features/browse/src/lib/edit-metadata-dialog/edit-metadata-dialog.html`                                   | NXSAT-308         | —                 | 197                                        |
| `libs/features/browse/src/lib/folder-picker/folder-picker-dialog.component.html`                                | NXSAT-308         | 8                 | —                                          |
| `libs/features/collections/src/lib/collection-detail/collection-detail.html`                                    | NXSAT-308         | 161, 528          | —                                          |
| `libs/features/document-detail/src/lib/add-to-collection-dialog/add-to-collection-dialog.html`                  | NXSAT-308         | —                 | 8, 47, 73                                  |
| `libs/features/document-detail/src/lib/create-version-dialog/create-version-dialog.html`                        | NXSAT-308         | —                 | 32                                         |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html`                                    | NXSAT-308         | 3, 506, 855, 2294 | 116, 1579                                  |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html`                                    | NXSAT-327         | 301               | 334                                        |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html`                                    | NXSAT-328         | —                 | 968, 980, 1073, 1097                       |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html`                                    | AI (out of Beta)  | 1993              | 1159, 1264, 1361, 1400, 1409, 1453, 2008   |
| `libs/features/document-detail/src/lib/drive-dialog/drive-dialog.html`                                          | NXSAT-308         | 4                 | —                                          |
| `libs/features/document-detail/src/lib/edit-document-dialog/edit-document-dialog.html`                          | NXSAT-308         | —                 | 200                                        |
| `libs/features/document-detail/src/lib/note-editor/note-editor.html`                                            | NXSAT-308         | 5, 27, 38         | 316, 360                                   |
| `libs/features/document-detail/src/lib/note-editor/note-image-picker-dialog.html`                               | NXSAT-308         | 76                | —                                          |
| `libs/features/document-detail/src/lib/publish-dialog/publish-dialog.html`                                      | NXSAT-328         | 10                | 105                                        |
| `libs/features/search/src/lib/search/search.html`                                                               | NXSAT-308         | 224               | 48                                         |
| `libs/shared/permission-dialogs/src/lib/add-permission-dialog/add-permission-dialog.html`                       | NXSAT-308         | —                 | 122, 134                                   |
| `libs/shared/permission-dialogs/src/lib/delete-permission-dialog/delete-permission-dialog.html`                 | NXSAT-308         | —                 | 33                                         |
| `libs/shared/permission-dialogs/src/lib/share-external-dialog/share-external-dialog.html`                       | NXSAT-308         | —                 | 74, 87                                     |
| `libs/shared/permission-dialogs/src/lib/update-permission-dialog/update-permission-dialog.html`                 | NXSAT-308         | —                 | 102                                        |
| `libs/shared/ui/src/lib/document-compare-dialog/document-compare-dialog.html`                                   | NXSAT-308         | 37                | —                                          |
| `libs/shared/ui/src/lib/document-viewer/document-viewer.component.html`                                         | NXSAT-308         | 6                 | —                                          |
| `libs/shared/ui/src/lib/edit-collection-dialog/edit-collection-dialog.html`                                     | NXSAT-308         | —                 | 198                                        |
| `libs/shared/ui/src/lib/export-dialog/export-dialog.component.html`                                             | NXSAT-308         | —                 | 9                                          |
| `libs/shared/ui/src/lib/share-saved-search-dialog/share-saved-search-dialog.component.html`                     | NXSAT-308         | 19                | —                                          |
| `libs/features/trash/src/lib/trash/trash.component.html`                                                        | NXSAT-326         | 129               | —                                          |
| `libs/features/tasks/src/lib/task-detail/task-detail.component.html`                                            | NXSAT-327         | 4                 | 40, 200                                    |
| `libs/features/tasks/src/lib/task-list/task-list.component.html`                                                | NXSAT-327         | 13                | —                                          |
| `libs/features/tasks/src/lib/tasks-page/tasks-page.component.html`                                              | NXSAT-327         | 13                | 267, 452                                   |
| `libs/features/administration/src/lib/admin-group-details-page/admin-group-details-page.component.html`         | NXSAT-329         | 11, 150           | —                                          |
| `libs/features/administration/src/lib/admin-user-details-page/admin-user-details-page.component.html`           | NXSAT-329         | 11, 115, 198      | —                                          |
| `libs/features/administration/src/lib/admin-users-groups-page/admin-users-groups-page.component.html`           | NXSAT-329         | 64, 128, 227      | —                                          |
| `libs/features/administration/src/lib/user-form-dialog/user-form-dialog.component.html`                         | NXSAT-329         | 4, 17             | —                                          |
| `libs/features/administration/src/lib/admin-analytics-page/admin-analytics-page.component.html`                 | admin (no ticket) | 39, 87, 149, 214  | 201                                        |
| `libs/features/administration/src/lib/admin-audit-page/admin-audit-page.component.html`                         | admin (no ticket) | 234, 290          | 111                                        |
| `libs/features/administration/src/lib/admin-cloud-services-page/admin-cloud-services-page.component.html`       | admin (no ticket) | 19                | —                                          |
| `libs/features/administration/src/lib/admin-nxql-search-page/admin-nxql-search-page.component.html`             | admin (no ticket) | 104               | 45                                         |
| `libs/features/administration/src/lib/admin-vocabularies-page/admin-vocabularies-page.component.html`           | admin (no ticket) | 11, 45            | —                                          |
| `libs/features/administration/src/lib/vocabulary-entry-form-dialog/vocabulary-entry-form-dialog.component.html` | admin (no ticket) | 13                | —                                          |
| `libs/features/assets/src/lib/asset-search-results/asset-search-results.component.html`                         | DAM (§13 Q2)      | 97                | —                                          |
| `libs/features/knowledge-discovery/src/lib/content-lake-upload/content-lake-upload.html`                        | KD (out of Beta)  | —                 | 24, 151                                    |
| `libs/features/knowledge-discovery/src/lib/kd-citation-dialog/kd-citation-dialog.html`                          | KD (out of Beta)  | 29                | —                                          |
| `libs/features/knowledge-discovery/src/lib/knowledge-discovery/knowledge-discovery.html`                        | KD (out of Beta)  | —                 | 122, 182, 252, 350, 434, 465               |
| `libs/features/browse/src/lib/search-adf-hx/search-adf-hx.html`                                                 | POC route         | 25                | —                                          |
| `apps/nuxeo-ui/src/app/dashboard/dashboard-page.component.html`                                                 | app               | 77, 132, 164, 212 | —                                          |
| `apps/nuxeo-ui/src/app/login/login-page.component.html`                                                         | app               | —                 | 101                                        |
| `apps/nuxeo-ui/src/app/personal-space/personal-space-page.component.html`                                       | app               | 4                 | —                                          |
| `apps/nuxeo-ui/src/app/shell/nav-drawer/nav-drawer.component.html`                                              | app               | —                 | 74, 101, 124, 159, 198, 239, 305, 379, 470 |

### 4.9 Split panes → `splitter`, `nested-scrollviews` → `nxs-splitter`

No resizable split pane exists. The only container is the shell's `mat-sidenav-container`
(`apps/nuxeo-ui/src/app/shell/app-shell.component.html:232`), a navigation drawer, which stays. Document
detail's viewer and side panel is the candidate if resizable panes are wanted. That is a product decision,
not a swap, so `nxs-splitter` should not be built until someone asks for it.

### 4.10 Tables → Material table, with `table-with-row-states` later

The primitive is settled in the [table-primitive decision](decision-table-primitive.md): Material table,
with Satori's row-states layer added on Angular 22. Only lists of documents become `nxs-document-list`.
Static data tables have no Satori target and keep `mat-table` or a native `<table>`.

| Site                                                                                                                                       | What it is                                                                                                                       | Scope             | Becomes                              |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------ |
| `libs/features/browse/src/lib/browse/browse.html:301`                                                                                      | Folder contents, hand-written `browse-table`                                                                                     | NXSAT-308         | `nxs-document-list`                  |
| `libs/features/collections/src/lib/collection-detail/collection-detail.html:187`                                                           | Collection members, hand-written                                                                                                 | NXSAT-308         | `nxs-document-list`                  |
| `libs/features/search/src/lib/search/search.html` (list view, `simple-list`)                                                               | Search results list: a `div` list, no table or list role                                                                         | NXSAT-308         | `nxs-document-list`                  |
| `libs/features/browse/src/lib/browse/browse.html:820`                                                                                      | History, `mat-table` + `matSort`                                                                                                 | NXSAT-308         | History (Promote), stays `mat-table` |
| `libs/features/collections/src/lib/collection-detail/collection-detail.html:540`                                                           | History, `mat-table` + `matSort`                                                                                                 | NXSAT-308         | History (Promote)                    |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html:867`                                                           | History, `mat-table` + `matSort`                                                                                                 | NXSAT-308         | History (Promote)                    |
| `libs/features/browse/src/lib/browse/browse.html:522`, `:624`, `:686`                                                                      | Permission tables, native                                                                                                        | NXSAT-308         | PermissionsPanel (Build)             |
| `libs/features/collections/src/lib/collection-detail/collection-detail.html:243`, `:331`, `:382`                                           | Permission tables, the same three                                                                                                | NXSAT-308         | PermissionsPanel                     |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html:536`, `:637`, `:698`                                           | Permission tables, the same three                                                                                                | NXSAT-308         | PermissionsPanel                     |
| `libs/features/browse/src/lib/drive-dialog/drive-dialog.html:9`, `libs/features/document-detail/src/lib/drive-dialog/drive-dialog.html:11` | Drive table, duplicated                                                                                                          | NXSAT-308         | DriveDialog (deduplicate)            |
| `libs/shared/permission-dialogs/src/lib/delete-permission-dialog/delete-permission-dialog.html:6`                                          | Confirmation table                                                                                                               | NXSAT-308         | stays                                |
| `libs/shared/ui/src/lib/share-saved-search-dialog/share-saved-search-dialog.component.html:43`, `:133`, `:179`                             | Saved-search permission tables                                                                                                   | NXSAT-308         | stays                                |
| `libs/features/browse/src/lib/browse/browse.html:940`                                                                                      | Browse trash tab, hand-written                                                                                                   | NXSAT-326         | `nxs-document-list`                  |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html:996`                                                           | Publications                                                                                                                     | NXSAT-328         | stays                                |
| `libs/features/administration/…` (9 `mat-table`s in the users and groups pages)                                                            | `admin-users-groups-page` :71, :137, :236; `admin-user-details-page` :66, :122, :205; `admin-group-details-page` :66, :107, :157 | NXSAT-329         | stays `mat-table`                    |
| `libs/features/administration/…` (6 `mat-table`s)                                                                                          | analytics :49, :100; audit :294; cloud services :26; NXQL :117; vocabularies :52                                                 | admin (no ticket) | stays `mat-table`                    |
| `apps/nuxeo-ui/src/app/dashboard/dashboard-page.component.html:84`, `:173`, `:221`                                                         | Dashboard widget tables                                                                                                          | app               | stays                                |
| `apps/nuxeo-ui/src/app/settings/…` (7 tables)                                                                                              | authorized applications :14; cloud services :18; Nuxeo Drive :9, :66, :124; profile :47, :156                                    | app               | stays                                |
| `libs/shared/adf-hx-bridge/src/lib/ui/hxp-browse-history/hxp-browse-history.component.html:70`, `hxp-browse-trash.component.html:21`       | POC history and trash tables                                                                                                     | bridge            | deleted                              |

The same three permission tables appear in nine places across three pages. That is the strongest
single argument for PermissionsPanel being one component.

### 4.11 Toasts → no Satori target → `nxs-toast`

30 files inject `MatSnackBar` directly and make 173 `.open(` calls. There is no shared toast service.
`app-shell.component.ts` injects it and never calls it.

**Status, 2026-10-09:** the 14 NXSAT-308 files below are on `nxs-toast` (`NxsToastService`), including
`document-detail.ts` and `collection-detail.ts`'s private `toast()` helpers, whose call sites the table's
`.open(` count does not show. No core-slice library injects `MatSnackBar` now. The rows marked
NXSAT-326 to NXSAT-329, admin, DAM, KD and app are unchanged and still inject it.

| File                                                                                                  | Scope             | `inject(MatSnackBar)` at   | `.open(` calls |
| ----------------------------------------------------------------------------------------------------- | ----------------- | -------------------------- | -------------- |
| `libs/features/browse/src/lib/browse/browse.ts`                                                       | NXSAT-308         | 229                        | 45             |
| `libs/features/search/src/lib/search/search.ts`                                                       | NXSAT-308         | 185                        | 8              |
| `libs/features/document-detail/src/lib/document-detail/document-detail.ts`                            | NXSAT-308         | 341                        | 5              |
| `libs/features/document-detail/src/lib/note-editor/note-editor.ts`                                    | NXSAT-308         | 73                         | 4              |
| `libs/shared/permission-dialogs/src/lib/update-permission-dialog/update-permission-dialog.ts`         | NXSAT-308         | 137                        | 4              |
| `libs/features/browse/src/lib/create-import/create-import-dialog.component.ts`                        | NXSAT-308         | 199                        | 3              |
| `libs/shared/permission-dialogs/src/lib/add-permission-dialog/add-permission-dialog.ts`               | NXSAT-308         | 158                        | 3              |
| `libs/features/browse/src/lib/edit-metadata-dialog/edit-metadata-dialog.ts`                           | NXSAT-308         | 156                        | 2              |
| `libs/features/document-detail/src/lib/create-version-dialog/create-version-dialog.ts`                | NXSAT-308         | 105                        | 2              |
| `libs/features/search/src/lib/search-filters-drawer/search-filters-drawer.component.ts`               | NXSAT-308         | 68                         | 2              |
| `libs/shared/permission-dialogs/src/lib/share-external-dialog/share-external-dialog.ts`               | NXSAT-308         | 120                        | 2              |
| `libs/shared/ui/src/lib/edit-collection-dialog/edit-collection-dialog.ts`                             | NXSAT-308         | 69                         | 2              |
| `libs/shared/ui/src/lib/share-dialog/share-dialog.component.ts`                                       | NXSAT-308         | 67                         | 2              |
| `libs/features/collections/src/lib/collection-detail/collection-detail.ts`                            | NXSAT-308         | 124                        | 1              |
| `libs/features/trash/src/lib/trash/trash.component.ts`                                                | NXSAT-326         | 104                        | 16             |
| `libs/features/tasks/src/lib/tasks-page/tasks-page.component.ts`                                      | NXSAT-327         | 95                         | 8              |
| `libs/features/tasks/src/lib/task-detail/task-detail.component.ts`                                    | NXSAT-327         | 63                         | 4              |
| `libs/features/document-detail/src/lib/publish-dialog/publish-dialog.ts`                              | NXSAT-328         | 225                        | 2              |
| `libs/features/administration/src/lib/admin-users-groups-page/admin-users-groups-page.component.ts`   | NXSAT-329         | 80                         | 11             |
| `libs/features/administration/src/lib/admin-group-details-page/admin-group-details-page.component.ts` | NXSAT-329         | 58                         | 10             |
| `libs/features/administration/src/lib/admin-user-details-page/admin-user-details-page.component.ts`   | NXSAT-329         | 66                         | 10             |
| `libs/features/administration/src/lib/user-form-dialog/user-form-dialog.component.ts`                 | NXSAT-329         | 131                        | 1              |
| `libs/features/administration/src/lib/admin-vocabularies-page/admin-vocabularies-page.component.ts`   | admin (no ticket) | 56                         | 5              |
| `libs/features/assets/src/lib/asset-search-results/asset-search-results.component.ts`                 | DAM (§13 Q2)      | 318                        | 6              |
| `libs/features/assets/src/lib/assets-drawer/assets-drawer.component.ts`                               | DAM (§13 Q2)      | 96                         | 2              |
| `libs/features/knowledge-discovery/src/lib/content-lake-upload/content-lake-upload.ts`                | KD (out of Beta)  | 107                        | 2              |
| `apps/nuxeo-ui/src/app/extensions/bulk-action.services.ts`                                            | app               | 45, 96, 150, 190, 239, 281 | 6              |
| `apps/nuxeo-ui/src/app/shell/nav-drawer/nav-drawer.component.ts`                                      | app               | 120                        | 3              |
| `apps/nuxeo-ui/src/app/login/login-page.component.ts`                                                 | app               | 82                         | 2              |
| `apps/nuxeo-ui/src/app/shell/app-shell.component.ts`                                                  | app               | 117                        | 0              |

### 4.12 Inline error states → `empty-state`'s error states → `nxs-error-state`

54 `@if`/`@else if` branches on an `…Error()` signal in 32 files. Not all of them are error _states_,
so each is classified:

- **load error → `nxs-error-state`** (30): a region that failed to load and shows a message in its place.
- **inline banner → `nxs-banner`** (6): an error shown above content that still renders.
- **form or action error — stays** (15): a validation or submit message beside a field or a button,
  `mat-error` or `role="alert"` text, which is not an error state.
- **deleted with ADF** (3): the POC routes and the bridge.

| Site                                                                                                                                                                                                                                                           | Signal                                                                            | Scope             | Kind             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------- | ---------------- |
| `libs/features/browse/src/lib/browse/browse.html:246`                                                                                                                                                                                                          | `error()`                                                                         | NXSAT-308         | load error       |
| `libs/features/collections/src/lib/collection-detail/collection-detail.html:166`                                                                                                                                                                               | `error()`                                                                         | NXSAT-308         | load error       |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html:8`                                                                                                                                                                                 | `error()`                                                                         | NXSAT-308         | load error       |
| `libs/features/browse/src/lib/create-import/create-import-dialog.component.html:147`                                                                                                                                                                           | `typesLoadError()`                                                                | NXSAT-308         | load error       |
| `libs/features/browse/src/lib/folder-picker/folder-picker-dialog.component.html:14`                                                                                                                                                                            | `error()`                                                                         | NXSAT-308         | load error       |
| `libs/features/document-detail/src/lib/note-editor/note-image-picker-dialog.html:78`                                                                                                                                                                           | `searchError()`                                                                   | NXSAT-308         | load error       |
| `libs/shared/ui/src/lib/document-compare-dialog/document-compare-dialog.html:42`                                                                                                                                                                               | `error()`                                                                         | NXSAT-308         | load error       |
| `libs/features/search/src/lib/search/search.html:77`                                                                                                                                                                                                           | `aiError()`                                                                       | NXSAT-308         | inline banner    |
| `libs/features/browse/src/lib/create-import/create-import-dialog.component.html:58`, `:71`, `:250`, `:331`, `:434`, `:692`, `:940`, `:949`                                                                                                                     | `pathError()`, `error()`, `importError()`, `contentError()`, `showExpiresError()` | NXSAT-308         | form or action   |
| `libs/features/browse/src/lib/edit-metadata-dialog/edit-metadata-dialog.html:180`, `libs/features/document-detail/src/lib/edit-document-dialog/edit-document-dialog.html:180`, `libs/shared/ui/src/lib/edit-collection-dialog/edit-collection-dialog.html:180` | `showExpiresError()`                                                              | NXSAT-308         | form or action   |
| `libs/features/trash/src/lib/trash/trash.component.html:133`                                                                                                                                                                                                   | `error()`                                                                         | NXSAT-326         | load error       |
| `libs/features/tasks/src/lib/task-detail/task-detail.component.html:7`                                                                                                                                                                                         | `error()`                                                                         | NXSAT-327         | load error       |
| `libs/features/tasks/src/lib/task-list/task-list.component.html:16`                                                                                                                                                                                            | `error()`                                                                         | NXSAT-327         | load error       |
| `libs/features/administration/src/lib/admin-group-details-page/admin-group-details-page.component.html:16`                                                                                                                                                     | `error()`                                                                         | NXSAT-329         | load error       |
| `libs/features/administration/src/lib/admin-user-details-page/admin-user-details-page.component.html:16`                                                                                                                                                       | `error()`                                                                         | NXSAT-329         | load error       |
| `libs/features/administration/src/lib/admin-users-groups-page/admin-users-groups-page.component.html:133`, `:232`                                                                                                                                              | `usersError()`, `groupsError()`                                                   | NXSAT-329         | load error       |
| `libs/features/administration/src/lib/admin-nxql-search-page/admin-nxql-search-page.component.html:63`, `:98`                                                                                                                                                  | `aiGenError()`, `error()`                                                         | admin (no ticket) | load error       |
| `libs/features/assets/src/lib/asset-search-results/asset-search-results.component.html:104`                                                                                                                                                                    | `error()`                                                                         | DAM (§13 Q2)      | load error       |
| `libs/features/document-detail/src/lib/document-detail/document-detail.html:1469`                                                                                                                                                                              | `aiError()`                                                                       | AI (out of Beta)  | inline banner    |
| `libs/features/knowledge-discovery/src/lib/kd-citation-dialog/kd-citation-dialog.html:35`                                                                                                                                                                      | `documentError()`                                                                 | KD (out of Beta)  | load error       |
| `libs/features/knowledge-discovery/src/lib/knowledge-discovery/knowledge-discovery.html:23`, `:52`, `:81`                                                                                                                                                      | `agentsError()`, `referenceDataError()`, `agentDetailsError()`                    | KD (out of Beta)  | inline banner    |
| `libs/features/knowledge-discovery/src/lib/knowledge-discovery/knowledge-discovery.html:175`, `content-lake-upload.html:56`, `:128`                                                                                                                            | `questionError()`, `folderBrowseError()`, `errorMessage()`                        | KD (out of Beta)  | form or action   |
| `apps/nuxeo-ui/src/app/dashboard/dashboard-page.component.html:79`, `:134`, `:166`, `:214`                                                                                                                                                                     | widget errors                                                                     | app               | load error       |
| `apps/nuxeo-ui/src/app/dashboard/dashboard-page.component.html:29`                                                                                                                                                                                             | `aiInsightsError()`                                                               | app               | inline banner    |
| `apps/nuxeo-ui/src/app/shell/nav-drawer/nav-drawer.component.html:103`, `:126`, `:161`, `:241`                                                                                                                                                                 | drawer section errors                                                             | app               | load error       |
| `apps/nuxeo-ui/src/app/shell/app-shell.component.html:98`                                                                                                                                                                                                      | `globalSearchError()`                                                             | app               | load error       |
| `apps/nuxeo-ui/src/app/personal-space/personal-space-page.component.html:10`                                                                                                                                                                                   | `error()`                                                                         | app               | load error       |
| `apps/nuxeo-ui/src/app/settings/authorized-applications/authorized-applications-page.component.html:8`, `apps/nuxeo-ui/src/app/settings/cloud-services/cloud-services-page.component.html:12`                                                                  | `error()`                                                                         | app               | load error       |
| `apps/nuxeo-ui/src/app/settings/profile/change-password-dialog/change-password-dialog.component.html:6`                                                                                                                                                        | `error()`                                                                         | app               | form or action   |
| `libs/features/browse/src/lib/browse-adf-hx-poc/browse-adf-hx-poc.html:82`, `libs/features/browse/src/lib/search-adf-hx/search-adf-hx.html:31`, `libs/shared/adf-hx-bridge/src/lib/ui/hxp-browse-trash/hxp-browse-trash.component.html:6`                      | `error()`                                                                         | POC route, bridge | deleted with ADF |

## 5. What this means for the `nxs-wrappers` todo

A suggested order for NXSAT-308, with the core-slice sites each wrapper takes over:

1. **`nxs-empty-state`** and **`nxs-error-state`**: 29 and 7 sites. Both wrap the same Satori entry point,
   and the parity cases in plan section 10 assert on the error state, so they come first.
2. **`nxs-toast`**: 14 files, 85 calls. There is no Satori swap, but one behaviour contract (duration,
   politeness, i18n, retry) replaces fourteen ad-hoc ones.
3. **`nxs-spinner`** (§5 H) and **`nxs-ghost`**: 30 inline and 20 region-level sites. `nxs-ghost` must
   announce loading itself (section 3, item 5).
4. **`nxs-action-bar`**: 10 sites. It wraps `sat-action-group` and `sat-selection-bar` and takes resolved
   action descriptors, which is also how DocumentToolbar and SelectionTopbar get promoted.
5. **`nxs-upload`** and **`nxs-banner`**: 6 sites each.
6. **`nxs-tabs`**: 4 sites. It needs the navigational-tabs design decision first (section 3, item 3).
7. **`nxs-card`**: 2 sites, plus DocumentCards.

Not wrappers: chips, which go with the §5 J/K inputs (section 3, item 1); tables, which go into `nxs-document-list`,
History and PermissionsPanel; split panes, which nobody has asked for.

## 6. How this was produced

A scan of `apps/nuxeo-ui/src` and `libs/**` for `.html` and `.ts` files, excluding `*.spec.ts`,
`*.spec.html`, `*.host.html`, `*.stories.ts`, `test-setup.ts` and `__mocks__`. One regular expression per
pattern, matched per line:

| Pattern      | Regular expression (any of)                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| tabs         | `<mat-tab-group\b`, `\bmat-tab-nav-bar\b`, `\bmat-tab-link\b`                                        |
| chips        | `<mat-chip-(set\|grid\|listbox)\b`                                                                   |
| cards        | `<mat-card\b`, `class="[^"]*\b(doc-card\|asset-card\|asset-tile\|grid-tile\|result-card)\b`          |
| spinners     | `<mat-(progress-)?spinner\b`, `<mat-progress-bar\b`; `diameter` read from the next four lines        |
| skeletons    | `class="[^"]*\b(skeleton\|placeholder-row\|ghost)\b`                                                 |
| tables       | `<table\b`, `<mat-table\b`                                                                           |
| split panes  | `<mat-(sidenav\|drawer)-container\b`, `class="[^"]*\b(split-pane\|splitter\|resize-handle)\b`        |
| toasts       | `inject\(MatSnackBar\)`; calls `\.(snackBar\|snack)\.open\(`                                         |
| error states | `@if \(\s*!?\s*[A-Za-z]*[eE]rror[A-Za-z]*\(\)`, `@else if \(\s*[A-Za-z]*[eE]rror[A-Za-z]*\(\)`       |
| upload       | `type="file"`, `\(drop\)=`                                                                           |
| notices      | `role="(alert\|status\|note)"`, `class="[^"]*\b[a-z-]*(banner\|callout\|notice)\b`                   |
| empty states | `class="[^"]*\b[a-z-]*(empty\|no-results\|no-data\|nothing)[a-z-]*\b`, opening elements only         |
| toolbars     | `<mat-toolbar\b`, `class="[^"]*\b[a-z-]*(toolbar\|action-bar\|actions-bar\|header-actions)[a-z-]*\b` |

Each hit was then read in context and classified by hand: region or inline, load error or form error,
action bar or filter field. That judgement is what the counts above rest on, so a regenerated scan will
find the same sites, but its counts are raw until they are classified again.
