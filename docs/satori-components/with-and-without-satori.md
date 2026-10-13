---
title: 'Satori components: with and without Satori access'
---

<!--
Source of the Confluence page of the same title; docs/satori-components/with-and-without-satori.confluence.json
names the page. Publishing replaces the page, so edit here, never there.

Every component exported from libs/shared/satori-components/src/index.ts, or opened by something
it exports (the toast, through NxsToastService), needs a section under "Side by side" and a row
under "All components"; `npm run docs:satori-comparison:check` fails CI otherwise. The images are not committed: `npm run docs:satori-comparison:capture` renders them
into the evidence folder, and `npm run docs:satori-comparison:publish` attaches them to the page.
On GitHub they show as missing images, by design.
-->

# Satori components: with and without Satori access

## Summary

The `nxs-` library renders the same pages whether or not a customer has access to Satori. Four primitives — avatar, tag, breadcrumbs and rich tooltip — exist twice, under one registered ID each: a built-in version in `@nuxeo-satori/platform/components`, and a thin wrapper around Satori's own component in `@nuxeo-satori/platform/components-satori`. Every other component is the same component in both cases; only the theme differs.

> **Note:** the library is not published yet; this page describes the configuration it is built to support.

## Why both exist

`@hylandsoftware/satori-ui` is published only on GitHub Packages and needs a token, while our library must install from public npm with no credentials. An Angular build fails on a missing import, so the library cannot import Satori and skip it when absent.

Material is not a substitute: Satori is built on Angular Material and adds these components on top, and Angular Material has no avatar, breadcrumbs or rich tooltip (its chip is not Satori's tag).

Pages ask for the ID, never `sat-*`, which keeps Satori types out of our public API so a Satori upgrade only touches the wrappers.

## How it is decided

A page never names a component; it asks for the ID, e.g. `nxs.primitives.avatar`, with the same inputs, e.g. `{ initials: 'NK', color: 'teal', label: 'Narasimha Koppula' }`, and whatever is registered under that ID renders.

## With Satori access

Install `@hylandsoftware/satori-ui` from GitHub Packages (this needs a token) alongside our library.

Register the providers `provideSatori()` (theme and icons), `provideNxsComponents()`, then `provideNxsSatoriComponents()` — the later registration wins, so every avatar, tag, breadcrumb and rich-tooltip slot renders `<sat-avatar>`, `<sat-category-tag>`, `<sat-breadcrumbs>` and `<sat-rich-tooltip>` in Satori's theme.

The Satori components also need Satori's translation strings: register `provideAndConfigureSatoriUITranslations()` from `@hylandsoftware/satori-ui/translations`, or add Satori's `sat.*` strings to your own translation loader. Without them, the breadcrumbs' "Show more breadcrumbs" button, the breadcrumbs' screen-reader name when no `label` is given, and the rich tooltip's close hint show raw translation keys.

The wrapper maps our inputs onto Satori's: our `color` becomes Satori's `category`, and initials are never passed empty, because an empty value crashes Satori's avatar.

Our own product app is in this group.

## Without Satori access

Install from public npm only. Satori is an optional peer, so the install succeeds (verified: with no credentials the install works, and the same install fails with a 404 if Satori is made required).

Register only `provideNxsComponents()`; the same IDs render the built-in `nxs-` versions. Same page template, IDs and inputs.

The whole app takes the customer's own Material theme, not only these four.

## Satori installed but not registered

Leaving out `provideNxsSatoriComponents()` gives the built-in versions; nothing breaks.

## Side by side

Every component in the library, with the same inputs on both sides: on the left without Satori (built-in components, Material theme), on the right with Satori. The four primitives render Satori's own component when Satori is registered, and come from the "Primitives/By registered ID" story, whose template and inputs are the same in both Storybooks — only what is registered differs. Every other component is the same story under Satori's theme.

### Avatar

| Field           | Value                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Component       | `NxsAvatarComponent`                                                                                                 |
| Registered ID   | `nxs.primitives.avatar`                                                                                              |
| With Satori     | Satori's own component: `NxsSatoriAvatarComponent` renders `<sat-avatar>`                                            |
| Storybook story | `primitives-by-registered-id--material-registration`; with Satori `primitives-by-registered-id--satori-registration` |

![Avatar: without Satori on the left, with Satori on the right](avatar-side-by-side.png 'Left: without Satori (built-in component, Material theme). Right: with Satori. Same inputs.')

Both are 36 px teal circles. Satori's has a thin white border and uses Noto Sans; the built-in one blends teal with the Material theme's surface and text, so it is a little darker and greyer. At size 24, Satori shows one initial and the built-in version two. Screen readers hear one image, named by `label`, on both sides.

### Tag

| Field           | Value                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Component       | `NxsTagComponent`                                                                                                    |
| Registered ID   | `nxs.primitives.tag`                                                                                                 |
| With Satori     | Satori's own component: `NxsSatoriTagComponent` renders `<sat-category-tag>`                                         |
| Storybook story | `primitives-by-registered-id--material-registration`; with Satori `primitives-by-registered-id--satori-registration` |

![Tag: without Satori on the left, with Satori on the right](tag-side-by-side.png 'Left: without Satori (built-in component, Material theme). Right: with Satori. Same inputs.')

Satori's is a little larger — 24 px tall with 14 px text, against 20 px with 12 px — with softer colours. The built-in one shortens long text with "…"; Satori's never shortens and spills out of a narrow box.

### Breadcrumbs

| Field           | Value                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Component       | `NxsBreadcrumbsComponent`                                                                                            |
| Registered ID   | `nxs.primitives.breadcrumbs`                                                                                         |
| With Satori     | Satori's own component: `NxsSatoriBreadcrumbsComponent` renders `<sat-breadcrumbs>`                                  |
| Storybook story | `primitives-by-registered-id--material-registration`; with Satori `primitives-by-registered-id--satori-registration` |

![Breadcrumbs: without Satori on the left, with Satori on the right](breadcrumbs-side-by-side.png 'Left: without Satori (built-in component, Material theme). Right: with Satori. Same inputs.')

The biggest visible difference. When space runs out, Satori's collapse into a "…" menu and the built-in ones wrap onto two lines. Satori has its own chevron icon and a rounded purple focus ring.

Both name the landmark from our `label`; with no label, Satori's uses its own translation. One gap on the Satori side: at 110 px or narrower Satori hides every item, including the current page.

### Rich tooltip

| Field           | Value                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Component       | `NxsRichTooltipComponent`                                                                                            |
| Registered ID   | `nxs.primitives.richTooltip`                                                                                         |
| With Satori     | Satori's own component: `NxsSatoriRichTooltipComponent` renders `<sat-rich-tooltip>`                                 |
| Storybook story | `primitives-by-registered-id--material-registration`; with Satori `primitives-by-registered-id--satori-registration` |
| Captured        | Opened from the keyboard                                                                                             |

![Rich tooltip: without Satori on the left, with Satori on the right](rich-tooltip-side-by-side.png 'Left: without Satori (built-in component, Material theme). Right: with Satori. Same inputs, opened from the keyboard.')

The biggest behaviour difference. The built-in one opens on click, Enter or Space and closes straight away; Satori's opens on hover or keyboard focus after 200 ms, ignores clicks, and closes 1.5 s after you leave (Escape closes it at once). The built-in panel is never wider than the window and moves sideways to stay on screen near either edge, in either reading direction.

Screen readers: the built-in version uses `aria-expanded`/`aria-controls` and a live region; Satori uses `role=tooltip` with linked hidden text ending "Press Escape key to close". Both use the Material Icons font for the trigger icon.

### Icon

| Field           | Value                                 |
| --------------- | ------------------------------------- |
| Component       | `NxsIconComponent`                    |
| Registered ID   | —                                     |
| With Satori     | Same component; theme only            |
| Storybook story | `primitives-icon--sized-and-coloured` |

![Icon: without Satori on the left, with Satori on the right](icon-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

The same Material Icons glyph in both; it takes the theme's primary colour.

### Document type icon

| Field           | Value                                         |
| --------------- | --------------------------------------------- |
| Component       | `NxsDocTypeIconComponent`                     |
| Registered ID   | —                                             |
| With Satori     | Same component; theme only                    |
| Storybook story | `primitives-document-type-icon--across-types` |

![Document type icon: without Satori on the left, with Satori on the right](doc-type-icon-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

The same icon for each document type, and no visible difference: the icons take the surrounding text colour, which both themes keep near-black.

### Thumbnail

| Field           | Value                          |
| --------------- | ------------------------------ |
| Component       | `NxsThumbnailComponent`        |
| Registered ID   | —                              |
| With Satori     | Same component; theme only     |
| Storybook story | `primitives-thumbnail--loaded` |

![Thumbnail: without Satori on the left, with Satori on the right](thumbnail-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

The same thumbnail in both. It draws nothing of its own beyond the image: the caller sizes it and rounds its corners, so the theme changes nothing visible. Until the image arrives, or when there is none, the projected content shows instead, usually the document-type icon.

### Folder header

| Field           | Value                               |
| --------------- | ----------------------------------- |
| Component       | `NxsFolderHeaderComponent`          |
| Registered ID   | —                                   |
| With Satori     | Same component; theme only          |
| Storybook story | `panels-folder-header--with-detail` |

![Folder header: without Satori on the left, with Satori on the right](folder-header-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

The same layout in both; the theme sets the type, the colours and the projected button's style.

### Domain hint

| Field           | Value                                 |
| --------------- | ------------------------------------- |
| Component       | `NxsDomainHintComponent`              |
| Registered ID   | —                                     |
| With Satori     | Same component; theme only            |
| Storybook story | `states-domain-hint--inside-a-domain` |

![Domain hint: without Satori on the left, with Satori on the right](domain-hint-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

The same note in both; the theme sets its colours and type.

### Empty state

| Field           | Value                                       |
| --------------- | ------------------------------------------- |
| Component       | `NxsEmptyStateComponent`                    |
| Registered ID   | —                                           |
| With Satori     | Same component; theme only                  |
| Storybook story | `states-empty-state--with-projected-action` |

![Empty state: without Satori on the left, with Satori on the right](empty-state-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

The same icon, heading, message and projected action in both; the theme sets the type, the colours and the button's style.

### Error state

| Field           | Value                                         |
| --------------- | --------------------------------------------- |
| Component       | `NxsErrorStateComponent`                      |
| Registered ID   | —                                             |
| With Satori     | Same component; theme only                    |
| Storybook story | `states-error-state--server-error-with-retry` |

![Error state: without Satori on the left, with Satori on the right](error-state-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

A folder listing the server failed to answer: the same icon, heading, explanation and Retry button in both. The theme sets the type, the icon's error colour and the button's style.

It has four variants, chosen by the status of the request that failed: the session has ended, the user has no access, the item is not there, or something went wrong. Retry appears only for the last, because asking again after the first three gets the same answer. Satori has its own error states for the same four cases; this component is not registered under an ID, so Satori's do not replace it.

### Spinner

| Field           | Value                      |
| --------------- | -------------------------- |
| Component       | `NxsSpinnerComponent`      |
| Registered ID   | —                          |
| With Satori     | Same component; theme only |
| Storybook story | `states-spinner--named`    |

![Spinner: without Satori on the left, with Satori on the right](spinner-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

The same Material progress spinner in both, in the theme's primary colour. The capture stops its animation, so it shows as a still arc.

### Toast

| Field           | Value                            |
| --------------- | -------------------------------- |
| Component       | `NxsToastComponent`              |
| Registered ID   | —                                |
| With Satori     | Same component; theme only       |
| Storybook story | `states-toast--error-with-retry` |

![Toast: without Satori on the left, with Satori on the right](toast-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

The same dark toast in both: the message, a Retry button and a Dismiss (×) button. The theme sets the type and the colour of Retry, blue under Material and purple under Satori. A page never places the toast in a template; it calls `NxsToastService`, which is what the library exports, and the toast opens at the bottom of the window.

This is the error toast. Because it carries a button it stays until dismissed, and screen readers announce it straight away; a toast without a button closes after four seconds.

### Column picker

| Field           | Value                                       |
| --------------- | ------------------------------------------- |
| Component       | `NxsColumnPickerComponent`                  |
| Registered ID   | —                                           |
| With Satori     | Same component; theme only                  |
| Storybook story | `tables-column-picker--some-columns-hidden` |

![Column picker: without Satori on the left, with Satori on the right](column-picker-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

The same panel, checkboxes and buttons in both; the theme sets the type, the colours and the control styles.

### Permissions panel

| Field           | Value                                  |
| --------------- | -------------------------------------- |
| Component       | `NxsPermissionsPanelComponent`         |
| Registered ID   | `nxs.components.permissionsPanel`      |
| With Satori     | Same component; theme only             |
| Storybook story | `panels-permissions-panel--manageable` |

![Permissions panel: without Satori on the left, with Satori on the right](permissions-panel-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

The same panel in both. The library defines its ID and our app registers it; `provideNxsComponents()` does not, so a customer who wants it addressable by ID registers it themselves.

### Nuxeo Drive dialog

| Field           | Value                                 |
| --------------- | ------------------------------------- |
| Component       | `NxsDriveDialogComponent`             |
| Registered ID   | —                                     |
| With Satori     | Same component; theme only            |
| Storybook story | `dialogs-nuxeo-drive--no-drive-token` |

![Nuxeo Drive dialog: without Satori on the left, with Satori on the right](drive-dialog-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

The same dialog content in both; the theme sets the type, the colours and the button styles.

### Favorite toggle

| Field           | Value                                 |
| --------------- | ------------------------------------- |
| Component       | `NxsFavoriteToggleComponent`          |
| Registered ID   | —                                     |
| With Satori     | Same component; theme only            |
| Storybook story | `actions-favorite-toggle--a-favorite` |

![Favorite toggle: without Satori on the left, with Satori on the right](favorite-toggle-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

The same star button in both, for a document that is already a favorite. A favorite's star takes the theme's primary colour, blue under Material and purple under Satori; a document that is not a favorite shows an outlined grey star. Pressing it adds the document to the user's favorites or removes it, and the page that shows the star decides what message to give.

### Action menu

| Field           | Value                                           |
| --------------- | ----------------------------------------------- |
| Component       | `NxsActionMenuComponent`                        |
| Registered ID   | —                                               |
| With Satori     | Same component; theme only                      |
| Storybook story | `actions-action-menu--opened-from-the-keyboard` |

![Action menu: without Satori on the left, with Satori on the right](action-menu-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs, opened from the keyboard.')

The folder header's "More actions" button with its menu open, opened with Enter from the keyboard, so the first entry has focus: Share and Notify Me can be chosen, and Export is shown disabled. The same button and menu in both; the theme sets the type, the menu's surface and the highlight on the focused entry.

The page gives the menu its entries and runs the one chosen. An entry that is not allowed is shown disabled; one hidden by the configuration is not listed, and with none left, no button renders.

### Document toolbar

| Field           | Value                                                     |
| --------------- | --------------------------------------------------------- |
| Component       | `NxsDocumentToolbarComponent`                             |
| Registered ID   | —                                                         |
| With Satori     | Same component; theme only                                |
| Storybook story | `documents-document-toolbar--file-locked-by-another-user` |

![Document toolbar: without Satori on the left, with Satori on the right](document-toolbar-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

The action row of a File locked by another user: Edit, Add to collection, the padlock drawn as on, Add to Favorites, Share and Delete as icon buttons, and a "More actions" button for the rest. The same buttons in both; the theme sets the icon colour, the "on" colour of the padlock and the focus ring.

The page gives the toolbar its entries and runs the one chosen. A disabled entry stays focusable so its tooltip, such as who holds the lock, can be read; with nothing to overflow, no "More actions" button renders.

### Tabs

| Field           | Value                       |
| --------------- | --------------------------- |
| Component       | `NxsTabsComponent`          |
| Registered ID   | —                           |
| With Satori     | Same component; theme only  |
| Storybook story | `documents-tabs--file-tabs` |

![Tabs: without Satori on the left, with Satori on the right](tabs-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

A File's View, Permissions, History and Publishing tabs and a "Claims" tab a manifest adds, with View selected. The same strip in both; the theme sets the type, the icon colour and the selection underline.

The page gives the tabs their list and one template every body renders from, so a tab a manifest adds renders like a packaged one.

### Details panel

| Field           | Value                                       |
| --------------- | ------------------------------------------- |
| Component       | `NxsDetailsPanelComponent`                  |
| Registered ID   | —                                           |
| With Satori     | Same component; theme only                  |
| Storybook story | `documents-details-panel--document-details` |

![Details panel: without Satori on the left, with Satori on the right](details-panel-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

A document page's side panel for "Quarterly report.pdf": the header with its close button, the Properties, Comments and Activity views with Properties selected, and the view's content. The same panel in both; the theme sets the type, the divider and the selection underline.

The page decides which views exist — no Comments view on a document that cannot be commented on — and projects what each one shows.

### Properties panel

| Field           | Value                                         |
| --------------- | --------------------------------------------- |
| Component       | `NxsPropertiesPanelComponent`                 |
| Registered ID   | —                                             |
| With Satori     | Same component; theme only                    |
| Storybook story | `documents-properties-panel--file-properties` |

![Properties panel: without Satori on the left, with Satori on the right](properties-panel-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

A File's properties: its state, version, publications, dates, creator and contributors, then title, file name, tags, description, nature, coverage and subjects, and the collection it is in. The same rows in both; the theme sets the type, the label colour and the chips.

Every value is a label or a name: a directory entry or a user that arrives as an object never shows as `[object Object]`. Tags show only on a document that can be tagged.

### Metadata editor

| Field           | Value                                      |
| --------------- | ------------------------------------------ |
| Component       | `NxsMetadataEditorComponent`               |
| Registered ID   | —                                          |
| With Satori     | Same component; theme only                 |
| Storybook story | `documents-metadata-editor--customer-type` |

![Metadata editor: without Satori on the left, with Satori on the right](metadata-editor-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

Editing a customer "Policy" type: the Dublin Core fields, then its section with a policy number, a premium, a checkbox, product codes, a holder, contacts and a signed copy shown read-only. The same controls in both; the theme sets the type, the outlines and the chips.

It checks the schema's rules as the user types and on Save, names the field in every message, and sends only what changed.

### Comments

| Field           | Value                        |
| --------------- | ---------------------------- |
| Component       | `NxsCommentsComponent`       |
| Registered ID   | —                            |
| With Satori     | Same component; theme only   |
| Storybook story | `documents-comments--thread` |

![Comments: without Satori on the left, with Satori on the right](comments-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

A document's comment thread signed in as one of its authors: three comments, the first with its two replies folded behind "2 replies", the last cut short behind "Show all", Edit and Delete on the user's own comment only, and the comment box. The same thread in both; the theme sets the type, the avatars, the outline of the box and the link colour.

It follows Web UI's thread: the newest page first, replies only on top-level comments, Edit and Delete for the author and administrators, a confirmation before deleting, Ctrl+Enter to submit.

### Tag editor

| Field           | Value                            |
| --------------- | -------------------------------- |
| Component       | `NxsTagEditorComponent`          |
| Registered ID   | —                                |
| With Satori     | Same component; theme only       |
| Storybook story | `documents-tag-editor--editable` |

![Tag editor: without Satori on the left, with Satori on the right](tag-editor-side-by-side.png 'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')

A document's two tags as chips, each with a remove button, and the box that adds one. The same field in both; the theme sets the chip colour, the outline of the box and the type.

It follows Web UI's tag field on the document page: existing tags suggested as you type, the typed text offered as a new tag, each change saved at once, and read-only without Write or on a version or proxy.

<!-- satori:comparison:components -->

## Full screenshots

Storybook's "Primitives/By registered ID" story renders all four registered IDs with one template and the same inputs.

![All four primitives without Satori](without-satori-full.png 'Without Satori (built-in components, Material theme).')

![All four primitives with Satori](with-satori-full.png 'With Satori. Same inputs.')

![All four primitives: without Satori on the left, with Satori on the right](full-side-by-side.png 'Left: without Satori (built-in components, Material theme). Right: with Satori. Same inputs.')

## Detailed differences

Colours are given as background / text.

| Primitive        | Without Satori (built-in, Material theme)                                                                                                                        | With Satori (`sat-*`, Satori theme)                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Avatar**       | 36 px circle, no border, teal `#c8e1e4`/`#095d5e`                                                                                                                | 36 px with 1 px white border, teal `#e1f7f7`/`#3d7879`, Noto Sans                                                                                         |
| **Tag**          | 20 px, 12 px text, padding 2/8, `#ecdcff`/`#5f00c0`, truncates ("In…" in a 40 px box)                                                                            | 24 px, 14 px text, padding 2/6, white inset ring, `#f4f0fb`/`#5c59b6`, never truncates                                                                    |
| **Breadcrumbs**  | 20 px high, link `#005cbb`, grey 18 px Material chevron, browser default focus outline, wraps when narrow                                                        | 28 px high, link `#5654ac`, 16 px Satori SVG chevron, rounded purple focus ring, collapses to "…" ("Show more breadcrumbs")                               |
| **Rich tooltip** | Click/Enter/Space, panel under the button (radius 8, max 320 px, kept on screen), closes instantly on Escape, Tab-away or outside click, grey highlight on focus | Hover or focus after 200 ms, floating 20 px below (radius 12, max 40% of viewport width), Escape instant, otherwise closes after 1.5 s, purple focus ring |

## What a customer without access also loses

The whole Satori theme (colours, Noto Sans, focus rings, form-field defaults, Satori's SVG icon set), the app chrome (`sat-app-header`, `sat-platform-nav`, `sat-logo`) and the status tag (`sat-status-tag`). The base library has no replacement for these.

## How our own app uses this

The app registers both entry points, so anything rendered by ID shows Satori; but its own screens currently use `<sat-avatar>`, `<sat-category-tag>`, `<sat-status-tag>` and `<sat-breadcrumbs>` directly, so in practice the app looks as it always has, and a manifest cannot swap these in our own screens.

Only things rendered by ID, such as customer extensions, go through the choice.

## Known gaps

- Built-in breadcrumbs wrap instead of collapsing.
- Satori breadcrumbs hide everything at 110 px or less.
- Storybook's default theme names Roboto but doesn't load it, so the built-in screenshots render in Arial.

## Open questions

- Should the built-in tooltip copy Satori's hover-and-focus opening, or keep click-to-open (easier for keyboard and touch users)?
- Should our own screens move from `sat-*` to the registered IDs so customers can swap them?
- Does the status tag need a built-in version?

## All components

The components in the library today:

<!-- satori:comparison:summary -->

| Component          | Registered ID (if any)                                                                                                  | Differs with Satori?         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Avatar             | `nxs.primitives.avatar`                                                                                                 | Yes — Satori's own component |
| Tag                | `nxs.primitives.tag`                                                                                                    | Yes — Satori's own component |
| Breadcrumbs        | `nxs.primitives.breadcrumbs`                                                                                            | Yes — Satori's own component |
| Rich tooltip       | `nxs.primitives.richTooltip`                                                                                            | Yes — Satori's own component |
| Icon               | —                                                                                                                       | Same component; theme only   |
| Document type icon | —                                                                                                                       | Same component; theme only   |
| Thumbnail          | —                                                                                                                       | Same component; theme only   |
| Folder header      | —                                                                                                                       | Same component; theme only   |
| Domain hint        | —                                                                                                                       | Same component; theme only   |
| Empty state        | —                                                                                                                       | Same component; theme only   |
| Error state        | —                                                                                                                       | Same component; theme only   |
| Spinner            | —                                                                                                                       | Same component; theme only   |
| Toast              | —                                                                                                                       | Same component; theme only   |
| Column picker      | —                                                                                                                       | Same component; theme only   |
| Permissions panel  | `nxs.components.permissionsPanel` (the library defines the ID; our app registers it, `provideNxsComponents()` does not) | Same component; theme only   |
| Nuxeo Drive dialog | —                                                                                                                       | Same component; theme only   |
| Favorite toggle    | —                                                                                                                       | Same component; theme only   |
| Action menu        | —                                                                                                                       | Same component; theme only   |
| Document toolbar   | —                                                                                                                       | Same component; theme only   |
| Tabs               | —                                                                                                                       | Same component; theme only   |
| Details panel      | —                                                                                                                       | Same component; theme only   |
| Properties panel   | —                                                                                                                       | Same component; theme only   |
| Metadata editor    | —                                                                                                                       | Same component; theme only   |
| Comments           | —                                                                                                                       | Same component; theme only   |
| Tag editor         | —                                                                                                                       | Same component; theme only   |

This table and the screenshots are kept current as components are added.

## About this page

Published from `docs/satori-components/with-and-without-satori.md` in the `nuxeo/agentic-ui-poc` repository, with screenshots captured from the component library's Storybook. Edit the Markdown there: publishing replaces this page.
