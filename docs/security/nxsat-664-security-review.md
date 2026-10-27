# Security review: `nxs-` component library (NXSAT-664)

- **Ticket:** NXSAT-664, Goal "independent security review of the component library before it is used more widely".
- **Scope:** `libs/shared/satori-components/src/lib` as shipped on `main` (non-spec, non-story runtime code, plus `.storybook/` and `test-setup.ts` for credential checks). Concerns: blob URL creation and revocation, subscriptions (`takeUntilDestroyed`), image binding, sanitizer use, credential handling.
- **Base:** `origin/main` at `e317be02c`. NXSAT-649 (PR #446, "merge the ADF-free platform to main") is merged and an ancestor of that commit.
- **Method:** static review by four read-only reviewers, one per concern, each reading the code rather than its comments. Every finding below was checked against the code by the author of this document. The reviewers and the author are different models from the author of the code under review.
- **Not done:** `npm audit` (the ticket says "if approved"; it was not approved, so it was not run). Runtime or browser testing of the findings was not done. This is a static review.

## Verdict

**0 critical, 0 high.** The "Done when" threshold is met. Three medium-rated items and several low and informational items are recorded for follow-up. None blocks the library from wider use, but the first two are real behaviour defects with data-integrity consequences and should be ticketed.

## Findings

Severity follows the reviewers' ratings. "Verified" means the author re-read the cited lines.

### Medium

**M1. A closed permission dialog aborts an in-flight write, and the server may already have applied it.** Verified.

- `delete-permission-dialog/delete-permission-dialog.component.ts:99-112` and `update-permission-dialog/update-permission-dialog.component.ts:135-170` subscribe with `takeUntilDestroyed(this.destroyRef)`.
- Only `share-external-dialog.component.ts:133` sets `disableClose`. The other dialogs can be closed with Esc or the backdrop while the request is pending. The Cancel button is disabled during the save, but Esc and the backdrop are not.
- Effect: the HTTP request is cancelled on destroy. The server may still have committed the grant or removal and sent the notification email. `afterClosed()` yields `undefined`, so the host does not refresh and no toast appears.
- Same pattern, lower rating (L3 below): rename and create-version.

**M2. Destroying the permissions panel mid-save cuts a multi-change batch short.** Reviewer finding; code path read, not executed.

- `permissions-panel/permissions-panel.component.ts:558-588` pipes `this.service.save(...)` through `takeUntilDestroyed(this.destroyRef)`. `permissions-panel.service.ts:112-124` issues the writes with `from(changes).pipe(concatMap(...))`.
- Effect: destroying the panel (tab or route change) stops the `concatMap` partway. Some changes land, later ones are never sent, and `notifyChanged()` is not called, so the host's views stay stale. The comment at `:200-202` promises that a save in flight "finishes on its own document". That holds for a document change (the generation guard) but not for a panel destroy.

**M3. An SVG thumbnail becomes a same-origin `blob:` URL with no MIME check.** Verified.

- `thumbnail/thumbnail.component.ts:86-89` and `thumbnail/thumbnail-cache.ts:128` call `URL.createObjectURL(blob)` on the response of `/@rendition/thumbnail` (`document-detail.service.ts:76-79`, `responseType: 'blob'`) without checking `blob.type`.
- Inside `<img [src]>` a script does not run, so the rendered page is safe. A top-level navigation to the blob URL (for example "open image in new tab") would run any script in an SVG, same origin.
- Conditions: a writer must set a document's thumbnail to an `image/svg+xml` file containing script, and a viewer must take the explicit open-in-new-tab action. Rating is Medium per the reviewer; the author would accept Low-to-Medium given those conditions.
- Fix options: allow-list raster MIME types, or re-wrap the bytes as `new Blob([blob], { type: 'image/png' })` so an SVG fails to decode and the fallback shows.

### Low

**L1. Stale `(error)` handler can discard or revoke the next document's good thumbnail URL.** Verified.

- `thumbnail/thumbnail.component.ts:78-82` (`broken()`) acts on the current `url()`, not on the `src` that failed (`thumbnail.component.html:2`).
- In cache mode a document switch can replay a cached URL synchronously while the `<img>` element is reused, so a late error for document A can discard and revoke B's URL. Owned mode has the same race.
- Fix: take the failing `src` from the event and act only if it equals `url()`.

**L2. `discard()` and `drop()` revoke a URL that other holders still display.** Verified.

- `thumbnail/thumbnail-cache.ts:76-77` (`discard`) calls `drop`, which revokes regardless of `holders` (`:138-148`). Other holders then keep a dead `src` with no refetch. Harmless when the bytes really are undecodable; combined with L1 it can blank a good image for every holder on the page.

**L3. Rename and create-version have the same abort-on-close race as M1.**

- `rename-dialog/rename-dialog.component.ts:72-82`: Cancel is `(click)="cancel()"` and is not disabled during the request.
- `create-version-dialog/create-version-dialog.component.ts:75-98`: `mat-dialog-close` is not disabled.
- Effect: the version may be created or the title changed, while `versionCreated` is never emitted (`manage-versions.component.ts:198`) and the list stays stale.

**L4. A late comment-save response is applied to whichever document is shown by then.**

- `comments/comments.component.ts:444-463`, called from `submitComment` at `:326`. Nothing compares the request's uid with the current one.
- Effect: display and `threadChange` integrity only. Nothing is written to the server with the wrong uid.

**L5. Saved-search list can be overwritten by a stale response.**

- `saved-search-select/saved-search-select.component.ts:86-104`: a `refresh` or `pageProvider` change resets state but does not cancel the earlier `getSavedSearches` request, so whichever answers last wins.

**L6. Drive installer URLs are hardcoded to an external host and cannot be configured.** Verified.

- `drive-dialog/drive-dialog.component.ts:21-37` holds three `https://community.nuxeo.com/...` constants. No Layer 0/1 override exists, which conflicts with the repo rule that customer-changeable values are configurable. No credential is involved.

### Informational

**I1.** `tabs/tabs.component.ts:90-91` sets an inline `onkeydown` attribute to the constant `'void(0)'`. Nothing is injectable, but a strict CSP without `'unsafe-inline'` will block it and log violations.

**I2.** `breadcrumbs/breadcrumbs.component.html:38,72` binds `[href]="entry.item.href"` from the consumer. Angular's URL sanitizer neutralises `javascript:` URLs, and nothing in the library bypasses it. `data:` or external URLs still pass; the input documentation should state that consumers own the href value.

**I3.** `document-detail.service.ts:77` interpolates `uid` into the thumbnail path without `encodeURIComponent`. The value comes from the server today; encoding is defence in depth.

**I4.** `comments/comments.component.ts:172-173, 264` takes the current username from the host and uses it only to decide whether edit and delete are offered. This is a UI decision; server permissions remain the control.

**I5.** `.storybook/preview.ts:28` calls raw `fetch('i18n/en.json')`. It is a same-origin static file, Storybook only, and never reaches Nuxeo.

## Checked and not findings

Summarised by concern. Full reviewer notes are in the NXSAT-664 review session transcripts.

- **Blob lifecycle.** Each `createObjectURL` has a matching `revokeObjectURL` in cleanup (`thumbnail.component.ts:96`, `thumbnail-cache.ts:144`). Late responses after destroy do not mint URLs: owned mode unsubscribes via `takeUntilDestroyed`, cache mode via `takeUntil(entry.cancel)`. Double revoke is prevented by identity checks. Provider scope is component-level in every production use, so URLs do not outlive their page. `[src]` with `blob:` passes Angular's sanitizer; no bypass is used.
- **Subscriptions.** Every `takeUntilDestroyed()` without an argument is in an injection context. Calls outside the constructor pass an explicit `DestroyRef`. Window and document listeners, `ResizeObserver`s and timers are all removed or cleared on destroy. There are no `setInterval`, `@HostListener` or `MutationObserver` uses. Stale-answer guards exist in permissions-panel, document-tree, favorite-toggle, folder-picker, tag-editor and several `switchMap` paths.
- **HTML sinks and sanitizers.** No `[innerHTML]`, `[outerHTML]`, `insertAdjacentHTML`, `document.write`, `innerHTML` via Renderer, `DomSanitizer` or `bypassSecurityTrust*` anywhere in the library. User-supplied titles, filenames, comment bodies, tag and vocabulary labels and display names are rendered by interpolation or `[attr.*]`, which Angular escapes.
- **Icons.** `[svgIcon]` names resolve only through `MatIconRegistry`. An unregistered name logs an error and fetches nothing, so document-supplied names cannot load attacker SVG.
- **Style bindings.** `[style]` on avatar and tag comes from the frozen `NXS_NAMED_COLORS` table, so consumers cannot inject a CSS value.
- **Credentials.** No hardcoded usernames with passwords, tokens, API keys, `Basic`/`Bearer` strings, `btoa`/`atob`, or fallback credentials in the library. `Administrator` appears only as a story fixture username with no password. Setup docs use an environment-variable placeholder.
- **Network access.** No raw `fetch()`, `XMLHttpRequest` or direct `HttpClient` in components. Every Nuxeo call goes through platform services from `@nuxeo/satori-platform/nuxeo-client`. No credential or token is placed in a URL query string.
- **Browser storage and logging.** No `localStorage`, `sessionStorage`, `document.cookie` or `console.*` calls in non-spec library source.
- **External links.** The one `target="_blank"` link (`drive-dialog.component.html:32-34`) carries `rel="noopener"`.

## Not verified

- `NuxeoDriveService.buildDirectTransferUrl` lives outside this library. The spec shows it produces no credential or query string, but the encoding of `folderPath` was not checked.
- Runtime behaviour of M1 to M3 and L1 to L5 was not reproduced in a browser. Each is a code-path finding.
- `npm audit` was not run (not approved for this ticket).

## Follow-ups (for the developer to ticket)

1. M1 and L3: make in-flight permission and rename/version writes non-cancellable on close (or disable close while saving), and emit the outcome to the host either way.
2. M2: make a permissions save finish, or report partial completion, when the panel is destroyed.
3. M3: restrict thumbnail blob MIME types or re-wrap the blob.
4. L1 and L2: act on the failing `src` in `broken()`, and stop `discard`/`drop` from revoking URLs other holders still show.
5. L4 and L5: compare request uid and provider with the current ones before applying a late response.
6. L6: make Drive installer URLs configurable through Layer 0/1.
7. I1 to I5: hygiene items, as listed above.
