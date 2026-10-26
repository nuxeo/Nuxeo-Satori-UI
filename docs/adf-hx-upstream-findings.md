# adf-hx / adf-core findings

**Audience: the adf-hx team.** This document is written to be sent as-is. Everything in it is
reproducible against published packages, with a version, a path and a reproduction.

**Versions under test**

| Package                             | Version                       |
| ----------------------------------- | ----------------------------- |
| `@alfresco/adf-hx-content-services` | `7.20.0-automate.292`         |
| `@alfresco/adf-core`                | `9.0.0`                       |
| `@alfresco/adf-extensions`          | `9.0.0`                       |
| `@hylandsoftware/hxcs-js-client`    | `2.0.111`                     |
| Host application                    | Angular `20.3.x`, Nx `22.6.3` |

**Context.** We are adopting adf-hx components over a **Nuxeo** back end by implementing the twelve
`*_API_TOKEN` ports against Nuxeo's REST API, rather than against HxPR. Eleven of the twelve are
implemented. Five components were rendered against live data: document list, breadcrumb, document
tree, manage-versions and the properties sidebar. So these findings come from working code, not
from reading the source. The last two are no longer rendered in our browse page, which since
2026-09-23 keeps per-document panels on the document page as production browse does; the findings
about them were observed while they were.

_Changed by NXSAT-635 and NXSAT-638 (2026-10):_ the adoption has ended. The API ports, the POC
routes and the adopted components were removed on 2026-10-14, and the packages after them. The
findings stand against the versions above; the code they were observed in is in git history.

**Deliberately excluded.** Problems caused by _our_ environment are not listed here — a Node 25
`localStorage` global, a macOS lockfile pruning platform-optional entries, and Angular replacing
rather than merging an `assets` array in a build configuration. None is adf-hx's fault and including
them would weaken what follows. They are recorded internally in
`docs/adf-hx-workarounds.md` and `AGENTS/11-beta-program.md` §3.

Ordered by severity. Severity 1 is a shipped-to-customers problem.

---

## Severity 1 — ships to customers

### 1.1 `ng-mocks`, a test-mocking library, is imported from the shipped `/ui` runtime bundle

**Package:** `@alfresco/adf-hx-content-services@7.20.0-automate.292`
**File:** `ui/fesm2022/alfresco-adf-hx-content-services-ui.mjs` (and the `services` entry point)

`ng-mocks` is a **test** library. It is imported by the runtime bundle, so it is resolved, bundled
and served to end users. It contains two `eval()` calls, which is a problem in its own right for any
customer running a Content-Security-Policy without `unsafe-eval`.

**Reproduce**

```bash
npm i @alfresco/adf-hx-content-services@7.20.0-automate.292
grep -o "from 'ng-mocks'" node_modules/@alfresco/adf-hx-content-services/fesm2022/*.mjs
# then build any app that imports a component from @alfresco/adf-hx-content-services/ui
grep -c "eval(" dist/<app>/browser/*.js
```

**Measured in our build:** `ng-mocks` reached a **1.6 MB** customer-facing chunk, and `eval()`
appeared twice in the shipped output.

**Impact.** Bundle size, CSP incompatibility, and a supply-chain surface that has no business in a
production dependency tree.

**Our mitigation, which should not be necessary.** We replaced `ng-mocks` with a local `file:` stub
that satisfies the import and throws if anything actually calls it. `eval()` occurrences in the
shipped bundle went to **0**. We have documented that stub as _permanent_, because we cannot assume
this is fixed.

**Ask:** move `ng-mocks` to `devDependencies` and remove the runtime import. If a component
genuinely needs a mock at runtime, it should be behind a separate entry point that production code
does not reach.

### 1.2 `DataTableComponent` emits `role="row"` with children that are not cells — a WCAG 2.1 AA failure

**Package:** `@alfresco/adf-core@9.0.0`
**File:** `fesm2022/adf-core.mjs`, the `DataTableComponent` template
**Rule:** axe-core `aria-required-children` (**critical**), WCAG 4.1.2 / ARIA 1.2 `grid` structure

`<adf-datatable-row role="row">` contains, as **direct children**, elements that the `row` role does
not permit. `role="row"` requires children of role `cell`, `gridcell`, `columnheader` or `rowheader`.
The template supplies plain `<div>`s and a bare `mat-checkbox`:

```html
<adf-datatable-row ... class="adf-datatable-row" role="row">
  @if (enableDragRows) {
    <div class="adf-datatable-cell-header adf-drag-column">…</div>
  }
  @if (multiselect) {
    <div class="adf-datatable-cell-header adf-datatable-checkbox">
      <mat-checkbox …>
    </div>
  }
</adf-datatable-row>
```

None of the `adf-datatable-cell-header` divs carries `role="columnheader"`, and body rows
additionally place a `<span aria-live>` directly in the row.

**Reproduce**

```bash
# any host rendering hxp-document-list, with multiselect on (the default)
npm install --no-save @axe-core/playwright
# scan the page with tags wcag2a,wcag2aa,wcag21a,wcag21aa
# -> aria-required-children, 3 nodes:
#    "Element has children which are not allowed: mat-checkbox[aria-describedby]"
#    "Element has children which are not allowed: span[aria-live]"  (x2, one per body row)
```

**Impact.** It is the **only** WCAG 2.1 AA violation left anywhere in our application after a
fifteen-case audit, and it is not fixable by a host. A screen-reader user gets a grid whose
structure does not parse. WCAG 2.1 AA is a named procurement requirement for us, so a component we
cannot make compliant is a component we cannot ship into an accessibility-gated tender.

**Our mitigation: none, deliberately.** The only host-side fix is to patch `role` attributes onto
your DOM children after render, which is DOM surgery on another library's internals and would break
silently on any template change. We have instead scoped an exclusion to the single surface that
renders this component and pointed it at this finding, so the debt is attributed to its owner rather
than absorbed.

**Ask:** add `role="columnheader"` to the header cell divs and `role="gridcell"` to the body cell
divs, and move the `aria-live` announcer out of the row (a sibling `<span aria-live>` outside the
grid is the usual pattern). This is an attribute-level change to one template.

### 1.3 `HxpDocumentTreeComponent` asks for a translation key it does not ship, and renders the raw key as an accessible name

**Package:** `@alfresco/adf-hx-content-services@7.20.0-automate.292`
**File:** `ui/fesm2022/alfresco-adf-hx-content-services-ui.mjs`, the `HxpDocumentTreeComponent` template
**Rule:** WCAG 4.1.2 Name, Role, Value / 2.4.6 Headings and Labels

The node toggle binds its accessible name to a key with a **trailing space inside the key
literal**:

```html
<button
  mat-icon-button
  [attr.aria-label]="('DOCUMENT_TREE.TOGGLE_ARIA-LABEL ' | translate) + node.name"
  matTreeNodeToggle
></button>
```

The catalogue shipped in the same package has no such key. It has the key without the space:

```json
"DOCUMENT_TREE": { "ROOT": "Home", "TOGGLE_ARIA-LABEL": "Toggle" }
```

So the lookup misses, ngx-translate falls through to its key passthrough, and every folder
toggle in the tree is announced as **`DOCUMENT_TREE.TOGGLE_ARIA-LABEL undefined`**.

`undefined`, not the folder name — and this example said `… Home` until the third defect below was
found, which is what made the trailing space look like the whole story. `node.name` does not exist;
the concatenation appends the string `"undefined"` whatever the key resolves to.

The sibling binding one block down is correct — `'DOCUMENT_TREE.CONTEXT_MENU.TRIGGER_ARIA_LABEL' |
translate`, no trailing space — which is what makes the space look like a slip rather than a
convention.

**Reproduce**

```bash
npm i @alfresco/adf-hx-content-services@7.20.0-automate.292
# the key the template asks for, with its trailing space:
grep -o "TOGGLE_ARIA-LABEL[^\"']\{0,4\}" \
  node_modules/@alfresco/adf-hx-content-services/fesm2022/alfresco-adf-hx-content-services-ui.mjs
# -> TOGGLE_ARIA-LABEL      (note the space before the closing quote)
# the key the catalogue ships:
grep -n "TOGGLE_ARIA" \
  node_modules/@alfresco/adf-hx-content-services/ui/assets/adf-enterprise-adf-hx-content-services-ui/i18n/en.json
# -> "TOGGLE_ARIA-LABEL": "Toggle"
```

**Why this survived an accessibility audit, and why it is worth its own finding.** axe does not
flag it. The control **has** a non-empty accessible name; the name is simply not words. That is
the opposite failure mode to 4.6, where the name was empty and axe caught it immediately, and it
is why 1.2 can still be described as the only machine-detectable WCAG violation left in our
application. A raw key in visible text gets noticed by whoever looks at the screen. A raw key in
an `aria-label` is invisible to everyone who is not using a screen reader.

**Impact.** Every surface of our application, because the tree is our shell's navigation drawer.
A screen-reader user hears a namespaced identifier read out before each folder name.

**Second defect in the same line: the name is concatenated.** `(… | translate) + node.name`
builds a string from two pieces. Hyland's internationalization standard (INFO-144) forbids this
outright, because languages differ in word order and a translator handed only the prefix cannot
move it. Even with the key resolved, no locale can render this as anything but `<prefix><name>`.

**Our mitigation.** We alias the whitespace key onto the canonical one in our translation loader,
copying the resolved value so a French catalogue still yields a French name. It is recorded as
W13 in `docs/adf-hx-workarounds.md` and it yields to an upstream-shipped key, so it becomes inert
rather than authoritative if this is fixed.

**The concatenation is mitigated too, by W15**, and this paragraph said it could not be. W15 is a
host-side directive that sets the whole `aria-label` from the row's rendered label through our own
`nav.tree.toggle`, which takes the folder as an interpolation parameter — so at the host boundary
there is no concatenation left and a translator can reorder. What we cannot do is fix it _inside_
upstream's template, which is why the ask below still stands.

**There is a third defect here, and it makes the other two moot on their own.** `node.name` does
not exist. `node` is a wrapper — the same template reads `node.document`, `node.isLoading` and
`node.isSelectable`, and renders the visible label as
`{{ node.document | breadcrumbLabel: 'DOCUMENT_TREE.ROOT' }}`. So the concatenation appends the
string `"undefined"`, for every consumer of the component, and no catalogue entry can change it.
Measured on a real application against `7.20.0-automate.292`:

```
tree aria-labels: ["Toggleundefined", "Toggleundefined"]
```

Fixing only the trailing space yields `Toggle undefined`. That is why our own mitigation is a
directive that sets the attribute outright (W15), rather than the alias alone (W13).

**Ask:** delete the trailing space from the key literal, and pass the **label the row already
renders** through an interpolation parameter rather than concatenating a property the node does not
have — `'DOCUMENT_TREE.TOGGLE_ARIA-LABEL' | translate: { name: (node.document | breadcrumbLabel:
'DOCUMENT_TREE.ROOT') }`, with the catalogue value carrying the placeholder. The trailing space is a
one-character change; using `node.document` is what makes the name a name at all; and the
interpolation parameter is what makes it translatable, since a concatenated string cannot be
reordered for a language that needs the noun first.

---

### 1.4 `SatSkipToContent` hard-codes its own text, so the accessibility skip link cannot be translated

**Package:** `@hylandsoftware/satori-ui`
**File:** `fesm2022/hylandsoftware-satori-ui-platform-nav.mjs`, the `SatSkipToContent` template
**Rule:** WCAG 2.4.1 Bypass Blocks, read together with 3.1.1 Language of Page

The skip link's text is a literal in the template rather than a catalogue lookup:

```html
<a class="sat-skip-to-content-button" (focus)="display()" (blur)="hide()"> Skip to main content </a>
```

Every other string in the package goes through `i18n/en.json`; this one does not, and the
catalogue has no key for it. A host cannot override it, because there is no key to override.

The consequence is narrow and unusually bad. The skip link is the **first** thing a keyboard or
screen-reader user reaches on every page, and it is the one control whose entire purpose is to
serve users who need it most. In a French or German deployment that user meets an English
instruction before anything else on the page, and the page declares itself as French — so a
screen reader set to French will attempt to pronounce English words with French phonemes.

**Reproduce**

Generate a pseudo-locale and run the app in it. Every catalogue-sourced string renders
accented; this one stays plain English on all nine routes:

```bash
node tools/i18n/pseudo-locale.mjs
node tools/i18n/pseudo-locale-audit.mjs   # reports "Skip to main content" x9
```

**What we would like**

`SatSkipToContent` to read its text from a key — `SAT.SKIP_TO_CONTENT` or similar — shipped in
`i18n/en.json` alongside the other `sat.*` strings, so a host's catalogue can translate it.

**Workaround**

None that is not worse than the defect. The text lives inside a compiled template we do not
own; reaching it would mean either patching `node_modules` or replacing the component, and
replacing a skip link with our own risks having two or none. Recorded rather than worked around.

## Severity 2 — dependency and contract problems that break a clean install

### 2.1 All sixteen `@alfresco/adf-core` peer dependencies are declared as unbounded `>=`

**Package:** `@alfresco/adf-core@9.0.0`
**File:** `package.json`, `peerDependencies`

Every peer is `>=x`, with no upper bound. On a clean install the resolver floats them to their
latest majors, which for us meant `@angular/material-date-fns-adapter` resolving onto the Angular 22
line against an Angular 20 application.

**Reproduce**

```bash
npm i @alfresco/adf-core@9.0.0            # fresh tree, no lockfile
npx ng build
# → Unsupported enum value
```

**Our mitigation.** Nine exact pins. Two of them deliberately differ from adf-core's own suggested
versions — `@mat-datetimepicker/core@16.0.1`, whose major track is offset from Angular's, and
`pdfjs-dist@6.2.108`, because 4.x downgrades a shared native package.

**Ask:** bound the peer ranges. `>=` with no ceiling is equivalent to declaring no constraint.

### 2.2 Fifteen packages are imported but only one is declared as a peer

**Package:** `@alfresco/adf-hx-content-services@7.20.0-automate.292`

The bundles import fifteen third-party packages. One appears in `peerDependencies`. A consumer
therefore discovers the remaining fourteen at build or runtime, one failure at a time, instead of
from the manifest.

**Reproduce:** compare the `import ... from '<bare specifier>'` set in
`fesm2022/*.mjs` against `peerDependencies` in `package.json`.

**Ask:** declare what is imported.

### 2.3 `TranslationService` does not use the `TranslateLoader` interface it is given

**Package:** `@alfresco/adf-core@9.0.0`
**Symbol:** `TranslationService`, reading `translate.currentLoader`

`TranslationService` takes ngx-translate's `currentLoader` and calls five methods on it that are
**not on the `TranslateLoader` interface**: `setDefaultLang`, `providerRegistered`,
`registerProvider`, `getFullTranslationJSON` and `init`.

A host that provides a conforming `TranslateLoader` — the documented ngx-translate contract — dies
on the first adf-hx component with:

```
TypeError: this.customLoader.setDefaultLang is not a function
```

**Reproduce:** provide any class implementing only `TranslateLoader.getTranslation()` as
`{ provide: TranslateLoader, useClass: … }`, then render any adf-hx component.

**Why this is more than an inconvenience.** There are three ways out and each costs something:
replace the host loader with adf-core's (loses any host-specific catalogue layering), extend
adf-core's (puts `@alfresco/adf-core` on an import chain from the app's root config, which moved our
**initial** bundle from 1.71 MB to 2.86 MB), or duck-type the five methods without importing
adf-core. We took the third. It is an undocumented contract, so an adf-core upgrade adding a method
breaks us with the same `TypeError` on a different name.

**Ask:** either use `TranslateLoader` as declared, or publish the extended contract as an exported
interface so it can be implemented deliberately.

### 2.4 Packages are compiled against Angular 19.2.18 and consumed by Angular 20 hosts

**Packages:** both, per the `ngDeclareComponent` metadata in the fesm bundles
(`version: "19.2.18"`).

We consume them from Angular 20.3.x. It works, but it means partial-compilation output is being
linked by a newer compiler than it was produced by, and diagnostics like `NG0912` component-ID
collisions appear in our test runs from upstream's own components.

**Reproduce:** `grep -o 'version: "19\.2\.18"' node_modules/@alfresco/adf-hx-content-services/fesm2022/*.mjs | head`

**Ask:** state the supported Angular range explicitly, and publish builds for it.

---

## Severity 3 — architecture choices that constrain every host

### 3.1 Eleven `providedIn: 'root'` services force the entire port set into the root injector

**Package:** `@alfresco/adf-hx-content-services@7.20.0-automate.292`
**Symbols:** `DocumentService`, `SearchService`, `DocumentVersionsService`, `UserService`,
`UserResolverService`, `RenditionsService`, `DocumentModelService`, `HxpNotificationService`,
`MetadataSidebarService`, `VersionContextMenuActionsService`, `DocumentPropertiesService`

Each is `providedIn: 'root'` and injects one or more `*_API_TOKEN`. Angular resolves a root-provided
service from the **root** injector, so the tokens must be provided there too — even when every
component using them is behind a lazily-loaded route.

**Consequence, measured.** Our initial bundle went **1.70 MB → 3.49 MB**. We raised the Angular
budget twice, 2.0 → 3.5 → 4.0 MB. The panels sit in a single eager 1.2 MB chunk; we verified this by
reading the built output, not by inference.

**Reproduce:** provide the API tokens at component level only, on a lazily-loaded route, and render
`HxpDocumentListComponent`:

```
NG0201: No provider found for InjectionToken DOCUMENT_API_TOKEN
```

**Ask:** drop `providedIn: 'root'` from the services that consume ports, or accept the tokens
optionally, so a host can scope adf-hx to the routes that use it. This is the single largest cost of
adoption for us and it is not recoverable at the host level.

### 3.2 `DocumentModelService` calls `getModel()` from its constructor

**Package:** `@alfresco/adf-hx-content-services@7.20.0-automate.292`
**Symbol:** `DocumentModelService`, `constructor` → `this.model$ = this.getModel()`

The constructor eagerly invokes `modelApi.getModel()`. Two consequences for a host:

1. The model is fetched on **injection**, not on use. Any component behind
   `DOCUMENT_PROPERTIES_SERVICE` triggers it whether or not it reads a property.
2. If the port rejects — which any port must be able to do — the rejected promise exists with
   nothing subscribed to it, so the browser logs an **unhandled promise rejection** before the user
   has done anything.

**Reproduce:** bind `MODEL_API_TOKEN` to an implementation whose `getModel()` rejects, inject
`DocumentModelService`, and observe the console. The service constructs successfully; the rejection
is unhandled until something subscribes.

**Ask:** make `model$` lazy (`defer`), so the fetch happens on first subscription.

### 3.3 Six services carry no `providedIn` and are not documented as requiring a provider

**Package:** `@alfresco/adf-hx-content-services@7.20.0-automate.292`
**Symbols:** `DocumentTreeDatabaseService`, `VersionContextMenuActionsService` (its five handler
tokens), `HxpMetadataCacheService`, `DocumentRouterService`, plus adf-core's `DecimalNumberPipe`,
`LocalizedDatePipe`, `FileSizePipe` and `UserResolverPipe` injected as **services**.

Each surfaces as an `NG0201` at the point of use. We found them one at a time, over several
sessions, and only afterwards discovered that `DOCUMENT_PROVIDERS` and `USER_RESOLVER_PROVIDERS`
are exported and cover some of them.

**Note a gap in that provider function.** `provideAdfEnterpriseAdfHxContentServicesServices()`
provides adf-hx's pipes but **not adf-core's**, so `PropertyUtilService` still cannot construct
after calling it:

```
NG0201: No provider found for _DecimalNumberPipe.
Path: DocumentPropertiesService -> PropertyUtilService -> _DecimalNumberPipe
```

**Reproduce:** call `provideAdfEnterpriseAdfHxContentServicesServices()` and render
`hxp-properties-sidebar`.

**Ask:** either mark them `providedIn: 'root'`, or make one exported provider array sufficient and
say so in the README. A component's required providers should be discoverable from its documentation
rather than from its stack traces.

### 3.4 `DocumentRouterService` hardcodes a route shape

**Package:** `@alfresco/adf-hx-content-services@7.20.0-automate.292`
**Symbol:** `DocumentRouterService`

It builds `/{repository}/documents/{id}` and the breadcrumb feeds the result straight into
`[routerLink]`. A host with different routes gets links to a route that does not exist.

That it carries no `providedIn` suggests substitution is intended, which is how we treat it — but
this is inference, not documentation.

**Reproduce:** render `hxp-breadcrumb` in an app without a `/{repository}/documents/:id` route and
inspect the crumb `href`s.

**Ask:** document it as the intended extension point, or take the URL builder as an injectable
function.

### 3.5 `[contextMenuActions]="false"` does not prevent the handlers from being constructed

**Package:** `@alfresco/adf-hx-content-services@7.20.0-automate.292`
**Symbol:** `HxpDocumentListComponent`, input `contextMenuActions`

Setting it `false` suppresses the menu, but the action handler services are still injected, so a
host must provide `DOWNLOAD_API_TOKEN` and the other handler dependencies for a list that shows no
context menu at all.

**Reproduce:** render `hxp-document-list` with `[contextMenuActions]="false"` and no
`DOWNLOAD_API_TOKEN`.

**Ask:** make the handler injection lazy, or optional when the input is `false`.

---

## Severity 4 — release hygiene and behaviour worth documenting

### 4.1 No stable release in twelve months

`@alfresco/adf-hx-content-services` has 648 published versions; `latest` is
`7.20.0-automate.292` — a pre-release tag. Every consumer is therefore pinned to a pre-release, and
our own rules forbid pinning a dist-tag, so we pin the exact build.

**Ask:** cut a stable release, or state the support expectation for the `automate` line.

### 4.2 Runtime assets are not copied by installing the package, and this is undocumented

Four asset trees are fetched at runtime and none arrives with the install:

| Fetched at runtime                                                  | Source in the package                                          |
| ------------------------------------------------------------------- | -------------------------------------------------------------- |
| `assets/adf-core/i18n/<lang>.json`                                  | `@alfresco/adf-core/bundles/assets/adf-core`                   |
| `assets/adf-enterprise-adf-hx-content-services-ui/i18n/<lang>.json` | `.../ui/assets/adf-enterprise-adf-hx-content-services-ui/i18n` |
| `assets/adf-enterprise-adf-hx-content-services-services/i18n/…`     | `.../services/assets/…`                                        |
| `assets/images/*.svg`, `assets/search-icons/*.svg`                  | `.../icons/assets`                                             |

Missing them, components render raw translation keys — the versions panel's heading rendered
`MANAGE_VERSIONS.DIALOG.TITLE` — and 404 their icons.

**Additionally:** components register their own catalogues through `provideTranslations` in each
component's `providers`, so registration happens at **component construction** — long after the
language has been loaded. The registration lands and the strings never arrive. We had to seed the
catalogues at bootstrap instead.

**Reproduce:** install the packages, render any adf-hx component, and watch the network tab 404
`assets/…/i18n/en.json`.

**Ask:** ship an `ng-add`/asset schematic, and register translation providers at bootstrap rather
than at component construction.

### 4.3 The breadcrumb renders ancestors only, and links only non-last crumbs

**Symbol:** `HxpBreadcrumbComponent`

It never renders the current document, and the last crumb is not a link. At the repository root, and
at a top-level folder, there is therefore exactly one crumb and **no link at all**. Two of our
evidence captures failed on this before we understood it.

Not a defect — but it is not documented, and it makes "the breadcrumb renders links" untestable
without navigating two levels deep.

Users read it as broken: a folder's own name is missing and its parent cannot be clicked. We now
render the inner `HxpUiBreadcrumbComponent` with the ancestors plus the current document.

A related trap: the crumbs bind `DocumentRouterService.urlFor()` to `[routerLink]`, which treats
a **string** as path segments and escapes any `?`. A host whose routes carry a query parameter
gets links to `/route%3Fparam%3D…`. We return a `UrlTree` from our substitute to avoid it.

**Ask:** document the behaviour, and consider an input to include the current document. Type
`urlFor()` as `string | UrlTree` so a substitute can return a tree without casting.

### 4.4 `CheckInApi` also declares a copy operation

**Package:** `@hylandsoftware/hxcs-js-client@2.0.111` / the `CHECKIN_API_TOKEN` contract

The check-in API surface includes a copy method, so a host implementing `CHECKIN` has to implement
something that belongs to `COPY`. Two ports overlap for no evident reason.

**Ask:** separate them, or document why they are coupled.

### 4.5 `@alfresco/adf-extensions@9.0.0` has typecheck and peer problems

Consuming it from an Angular 20 host required working around both its declared peer range and its
emitted types. We wrap it rather than expose it, so the detail is contained on our side — but a
consumer expecting it to typecheck cleanly against Angular 20 will not find that.

**Ask:** confirm the supported Angular range and publish types that check against it.

### 4.6 `sat-platform-nav` uses one translation key for both the tooltip and the accessible name

**Package:** `@hylandsoftware/satori-ui@0.2.0`
**Component:** `SatPlatformNav`, the rail toggle `#sat-platform-nav-title-icon`

The same translated string is bound to both purposes:

```html
[matTooltip]="(service.collapsed() ? 'sat.platform-nav.expand' : '…collapse') | translate"
[attr.aria-label]="(service.collapsed() ? 'sat.platform-nav.expand' : '…collapse') | translate"
```

A host that wants to suppress the tooltip — reasonable, because it duplicates the visible label
when the rail is expanded — has only one lever: blank the key. Doing so also empties `aria-label`,
so the button becomes a control with **no accessible name**: axe `button-name`, critical.

We did exactly that, deliberately, and it stood for some time. `aria-label=""` is invisible unless
you use a screen reader, so nothing surfaced it until a WCAG audit. Untranslated adf strings get
noticed because they render as raw keys; an empty accessible name renders as nothing.

**Reproduce:** set `sat.platform-nav.expand` and `sat.platform-nav.collapse` to `""` in any
catalogue that wins precedence, then scan any page. `button-name` fires on every surface that
renders the nav.

**Our mitigation.** We restored the strings and accepted the tooltip, and we now assert the
accessible name is non-empty in our accessibility capture so it cannot regress.

**Ask:** separate the two. Either use distinct keys (`…expand.tooltip` / `…expand.label`), or take
the accessible name from an `@Input()` that a host can set without touching the tooltip. An empty
tooltip string should not be able to produce an unnamed control.

### 4.7 `ObjectDataColumn` drops `formatTooltip`, so a column's tooltip function never runs

**Package:** `@alfresco/adf-core@9.0.0`
**Symbols:** `ObjectDataColumn` constructor, `DataTableComponent.getCellTooltip`

`DataColumn` declares `formatTooltip`, and the DataTable template binds
`[tooltip]="getCellTooltip(row, col)"`, which calls `col.formatTooltip`. But the table builds an
`ObjectDataColumn` from each `[columns]` entry, and that constructor copies a fixed list of
properties that does not include `formatTooltip`. The function is discarded before the table sees
it, with no warning.

**Reproduce:** pass `[columns]="[{ key: 'name', type: 'text', formatTooltip: () => 'x' }]"` to
`adf-datatable` (or a `[schema]` to `hxp-document-list`) and inspect a body cell: its
`.adf-datatable-cell-value` span carries `title=""`.

**Our mitigation.** `maxTextLength` survives the copy, so long values are shortened and get their
full text as the tooltip. Values short enough to escape that limit but still clipped by
`adf-ellipsis-cell` get no tooltip. Recorded as W16 in `docs/adf-hx-workarounds.md`.

**Ask:** copy `formatTooltip` in `ObjectDataColumn`, alongside the properties it already copies.

### 4.8 `.adf-datatable` forces a full-height table with a permanent scrollbar

**Package:** `@alfresco/adf-core@9.0.0`
**Rule:** `.adf-datatable { overflow-y: scroll; height: 100%; display: block }`

`overflow-y: scroll` draws a scrollbar track whether or not anything overflows, and `height: 100%`
stretches a short list to fill its container. A folder of six documents therefore renders as a
full-height table with an empty band beneath the rows and a scrollbar that scrolls nothing. The
body already scrolls on its own (`.adf-datatable-body`), so neither is needed for long lists.

**Reproduce:** render `hxp-document-list` with a handful of documents inside a container taller
than the rows.

**Our mitigation.** Overridden from the host (W17 in `docs/adf-hx-workarounds.md`), which reaches
into upstream's markup with `::ng-deep`.

**Ask:** use `overflow-y: auto`, and leave the table's height to the host.

### 4.9 `HxpDocumentTreeComponent` cannot reload, re-root or show a leaf folder as a leaf

**Package:** `@alfresco/adf-hx-content-services@7.20.0-automate.292`
**Symbols:** `HxpDocumentTreeComponent`, `DocumentTreeDatabaseService`

Three gaps, each of which a host has to work around:

1. **`rootDocument` is read once, in `ngOnInit`, and there is no reload.** A host that scopes the
   tree to the selected domain, or offers a Refresh button, must destroy and re-create the
   component.
2. **`[documents]` expansion stops at the first ancestor it cannot find.** `openNodes` walks the
   ancestor chain from the repository root, so a tree rooted at a domain never opens below it.
3. **Every folder is expandable.** `isExpandable(child)` returns `isFolder(child)` — its own
   comment says it should check for children — so a folder holding only files shows an arrow
   that expands to nothing. The tree also omits the toggle on a non-expandable node instead of
   keeping its space, so a leaf is misaligned against its siblings. `DocumentTreeDatabaseService`
   is provided by the component itself, so a host cannot substitute a better one.

**Our mitigation.** W18 in `docs/adf-hx-workarounds.md`: the drawer re-creates the tree on a
key, opens the branch from the tree's own root, and replaces `isExpandable` on the tree's
instance, honouring a subfolder flag our `QUERY` port sets from one NXQL probe per level.

**Ask:** a `reload()` method or a reactive `rootDocument`; expand from the tree's root rather than
the repository's; and either an `isExpandable` input or a data-source injection token.

### 4.10 `HxpUiDocumentViewerComponent` has no close button unless the host supplies a toolbar

**Package:** `@alfresco/adf-hx-content-services@7.20.0-automate.292`, `@alfresco/adf-core@9.0.0`
**Symbols:** `HxpUiDocumentViewerComponent`, `ViewerRenderComponent`, `ViewUtilService`

Three things a host finds out only once a file actually renders:

1. **The close button disappears.** The viewer always projects `<adf-viewer-toolbar>` with the
   host's `#toolbar` template, or an empty one when the host passes none. A projected toolbar
   replaces adf-core's default toolbar, which is the one carrying the title and the close
   button. Without a host template the toolbar is 0 px tall, and Escape is the only way out.
2. **The image viewer needs `cropperjs/dist/cropper.css`, and nothing says so.** adf-core's image
   viewer uses cropperjs, which hides the original `<img>` only through its own stylesheet.
   Without it the image renders twice, side by side, at full size.
3. **WebP is not viewable.** `ViewUtilService.mimeTypes.image` lists PNG, JPEG, GIF, BMP and SVG,
   so an `image/webp` file goes down the rendition path. `ViewerRenderComponent` declares
   `providers: [ViewUtilService]` itself, so a host cannot extend the list without patching
   adf-core's prototype.

**Our mitigation.** `browse-adf-hx-poc.html` projects a `#toolbar` with the document title and a
Close button, and `angular.json` adds `cropper.min.css` to the global styles. WebP stays
unsupported. The Phase 3 evidence asserts that a fixture file's own text renders in the viewer,
because the earlier check (overlay opens, component exists) passed while every preview failed.

_Changed by NXSAT-635 (2026-10):_ this mitigation went with the POC route and its viewer, removed on
2026-10-14.

**Ask:** fall back to adf-core's default toolbar when no `#toolbar` template is given; document
the cropperjs stylesheet or bundle it; add `image/webp` to the natively viewable images.

---

## What we would most like fixed, in order

1. **`ng-mocks` out of the runtime bundle** (1.1). It ships to customers.
2. **Valid `role` structure in `DataTableComponent`** (1.2). An attribute-level change to one
   template, and it is the single remaining WCAG 2.1 AA violation in our entire application. It is
   the only finding here that no host can work around without patching your DOM.
3. **One space out of the document tree's `aria-label` key, and the node name into an
   interpolation parameter** (1.3). The cheapest fix in this document by a wide margin — one
   character — and until it lands every folder in the tree is announced to screen-reader users as
   a namespaced identifier. Ranked this high because of the cost-to-impact ratio, not the blast
   radius.
4. **Bounded peer ranges** (2.1) and **declared imports** (2.2). Together they are the difference
   between a clean install working and not.
5. **Ports resolvable outside the root injector** (3.1). This is worth 1.79 MB of initial bundle to
   us and no host can fix it.
6. **A sufficient exported provider array, documented** (3.3). Cheap to do, and it removes an entire
   class of onboarding failure.
