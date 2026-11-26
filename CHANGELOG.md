# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

`@nuxeo-satori/platform` is versioned `0.2.0` from here (`libs/platform/package.json`, previously
`0.1.0`). This section holds breaking changes made since `0.1.0`, and `^0.1.0` admits only `0.1.x`,
so the next publish has to be a minor. Nothing has been published yet.

### Changed (configuration service) — a displaced packaged default is a warning

A fragment, layout or asset that replaces or disables one **we** packaged is now reported at
`warning` with its own diagnostic code — `replaced-packaged-default` or
`removed-packaged-default` — instead of `info` with `replaced` / `removed` (NXSAT-747). It reaches
`server.log` at `WARN` and the `diagnostics` of the served `bootstrap.json` and `manifest.json`.
The usual way to arrive is naming a configuration package `defaults`, which makes its fragment
`defaults` too and silently takes the place of ours; the generator refuses that name since
NXSAT-729, but a hand-written component XML still reaches the server.

Displacing **another package's** contribution is unchanged — ordinary layering, still `replaced` /
`removed` at `info`. Nothing is blocked either way: replacement remains a supported operation, so
a customer who meant it keeps the behaviour and gains a record of it. The distinction is drawn on
the bundle that contributed the displaced item, so it covers anything we package rather than only
the fragments named `defaults`. `level` was already one of `error` / `warning` / `info` and `code`
is an open string, so neither is a schema change — but a consumer that matched on `replaced` or
`removed` to notice this case should match the new codes instead.

### Added (`@nuxeo-satori/platform/nuxeo-client`) — a rendition by its name

`DocumentDetailService.fetchRendition(uid, name)` reads a document's rendition by its name, such
as a video's `MP4 480p`, through the REST API's rendition adapter, the name sent as one encoded path
segment; an empty name, `.` or `..` errors without a request. The record page's video player asks
for a transcoded video so, by the name a rights policy lists it by
(docs/business-apps/layout-v2.md, section 11). Additive: no existing call changes.

### Added (`@nuxeo-satori/platform/nuxeo-client`, `@nuxeo-satori/platform/ui`) — what a queue needs

For the queue page of the business apps (docs/business-apps/app-definition-v2.md, section 4).
Additive: no existing call changes.

- `PageProviderService.execute` takes `aggregates`, the buckets chosen in each of the page
  provider's aggregates, and sends each as the search page sends its filters,
  `<aggregate>=<JSON array>`. It returns `PageProviderResults`, the page with the server's
  `aggregations`. `isAggregateParameter` says which names it sends: letters, digits and `_`, and
  none the search reads for itself, such as `pageSize` or `properties`.
- `SelectionService.offeredBulkActions`: the bulk actions the page holding the selection offers, or
  `null` for every one. `SelectionTopbarComponent` takes them as `offered`, and then offers only
  those that the `bulk-actions` slot resolves and that have a handler. Neither is a security
  control.

### Added (`@nuxeo-satori/platform/nuxeo-client`, `@nuxeo-satori/platform/ui`) — row actions on every list

The platform's row actions, `app.rowActions.download`, `.rename`, `.copyTo`, `.moveTo` and
`.delete`, run from every list that offers them: browse's, a record page's related records and a
queue's (docs/extension-reference.md, section 10a). Additive: no existing call changes.

- `providePackagedRowActions()` and `RowActionsService` (`ui`): the five handlers, registered once
  for the app with `registerPackaged`, so a customer's `register()` for one of these IDs still
  outranks them. The app's `provideAppExtensions()` calls it. Browse no longer registers them.
- `DocumentChangesService` (`nuxeo-client`): `notify()` says documents changed, and `changes`
  emits once for each. The row actions notify it after a change that succeeds, and browse's list
  and `RecordListComponent` follow it and read their page again. A customer's own action that
  changes documents calls it too.

### Fixed (generators) — a configuration package's manifest is one Java can read

A generated package's `build.mjs` packaged a `bundle/META-INF/MANIFEST.MF` that Java's
`java.util.jar.Manifest` refuses outright, and `scripts/verify-package-zip.mjs` passed the result.
The Nuxeo runtime reads a bundle's headers through that class, which throws at the first line it
cannot read, so the bundle has no headers at all and the package installs and configures nothing.
A blank line inside the main section with an ordinary header after it, a header name with a space
or a dot in it or over 70 characters, a colon with no space after it, and a first line that starts
with a space each built a package, and JDK 21 refused its jar with `invalid manifest format`,
`invalid header field` or `misplaced continuation line`. No component went unchecked: the server
loaded none.

`build.mjs` now refuses a manifest Java would refuse, quoting the line: a line that is neither a
header — a name of 1 to 70 letters, digits, `-` and `_`, then `: ` and the value — nor a
continuation of one, a first line that starts with a space, or a section after a blank line that
does not begin with `Name: `. It checks the manifest as packaged, the unfolded source refolded at
72 bytes, so a source line longer than Java's 512-byte limit, or one with no line break at its
end, still builds. The new check refuses nothing Java reads, and packaging is unchanged.
`verify-package-zip.mjs` applies the same rules to the packaged jar, and two more, since its jar
may come from anywhere: a line over 512 bytes with its line break, and text after the last line
break, which Java ignores — a `Nuxeo-Component` header there loads nothing. Every copy of
`build.mjs` made before this change keeps building such manifests until it is replaced with the
template's.

### Fixed (generators) — a configuration package's components are the ones the server loads

A generated package's `build.mjs` read `bundle/META-INF/MANIFEST.MF`'s components from the first
header spelt exactly `Nuxeo-Component`, anywhere in the file, split at commas. The server reads that
header through `java.util.jar.Manifest` — from the main section alone, above the first blank line;
the name in any letter case; the last of a repeated header; a line ended only at CR or LF — and its
runtime splits the value at commas and whitespace. Everything under `bundle/` is packaged whatever
the build read, so a second `Nuxeo-Component` header, one spelt `nuxeo-component`, a lookalike after
a U+2028 inside another header's value, or a path with a space in it each built a jar whose server
loaded a component the build had never checked.

`build.mjs` now finds the header as the server does, splits it as the server does, refuses a
manifest with more than one such header in its main section or another spelling, and checks the
components of every one it found there. A header in a later `Name:` section is an entry attribute
the server ignores, so it is ignored here too; a manifest that names its components only below its
first blank line, which used to build a package that configured nothing, is refused.
`scripts/verify-package-zip.mjs` applies the same rules to the packaged jar. The scaffold's
manifest, and any that lists comma-separated paths without spaces in one header spelt
`Nuxeo-Component`, reads as before. Every copy of `build.mjs` made before this change keeps the old
reading until it is replaced with the template's.

### Fixed (generators) — the documented `npx nx g ./tools/satori-generators:…` command runs

Every generator that writes templates — `config-package`, `extension-library`,
`extension-component`, `satori-component` — threw `ReferenceError: __dirname is not defined` when
run through the Nx command line, on Node 22.6 and later (NXSAT-795). They resolved their template
directory with `join(__dirname, 'files')`; since Nx 23, `loadTsFile` prefers Node's native type
stripping, which gives the TypeScript source ESM semantics, and ESM has no `__dirname`. A single
`generatorFilesDir()` now serves both module systems.

This never affected customers: `@nuxeo/satori-platform` ships the generators compiled to
CommonJS, where `__dirname` exists, and `npx nx g @nuxeo/satori-platform:<generator>` worked
throughout. It affected anyone following `docs/extension-reference.md`,
`docs/beta-demo-runbook.md` or `libs/platform/AGENTS.md` in this repository — the demo runbook
among them. `checkGeneratorsEsmSafe` now fails the guardrails gate on a CommonJS-only global in
those sources, since no test can see this: vitest defines `__dirname` too.

The refusal message for a Windows device name now says a directory of that name "cannot be used
there" rather than "cannot be created there" (NXSAT-729 QA). Node does create `con` or `nul` on
Windows 11; Explorer and `cmd` then cannot open or delete it. The refusal is unchanged.

### Changed — BREAKING (registered IDs) — one Browse entry again

The earlier parallel-browse proof of concept is removed, with its two routes and its navigation entry.

- **`app.navbar.browseAdfHx`, the proof of concept's navbar entry, is retired.** An `overrides` key
  naming it now addresses nothing. A `navbar` slot entry naming it no longer patches a packaged
  entry, so it becomes an entry of its own — with no path or label unless it gives them, which
  renders a blank item: delete it. Its label key, `nav.item.browse-adf-hx`, is on no entry any
  more: move a `labels` entry for it to `nav.item.browse`.
- **`app.navbar.browse` is enabled again.** It shipped `disabled: true` while the proof-of-concept entry read
  "Browse". A manifest that restated it with `"disabled": false` to get both entries can drop that;
  it is now redundant, not harmful.
- **Old links redirect.** `/#/browse-adf-hx` and `/#/search-adf-hx` go to `/browse` and `/search`
  with their query string intact, and a `?path=` folder opens in `/browse`.

### Removed — BREAKING (`@nuxeo-satori/platform/nuxeo-client`) — the proof-of-concept browse URL helpers

They built, recognised and parsed the proof-of-concept browse URLs, and chose between that route and
`/browse` for document detail's way back. With the route retired, all seven go:
`toAdfHxBrowseRouterUrl`, `isAdfHxBrowseRouterUrl`, `parseAdfHxBrowsePathFromRouterUrl`,
`toBrowseRouterUrlForReturnMode`, `parseBrowseReturnMode`, `BrowseReturnMode` and
`BROWSE_RETURN_MODE_PARAM`. Use `toBrowseRouterUrl`, `isBrowseRouterUrl` and
`parseBrowseNuxeoPathFromRouterUrl`. Document detail no longer reads `?browseReturn=`; an old link
carrying it opens normally, with breadcrumbs into `/browse`.

### Changed (`@nuxeo-satori/platform`) — `@hylandsoftware/satori-ui` is an optional peer

- **`@hylandsoftware/satori-ui` is now an optional peer** (`peerDependenciesMeta`). npm installs
  every non-optional peer, and Satori resolves only from GitHub Packages, so installing the package
  without a token failed with `E404` on public npm. Only the new `/components-satori` entry point
  imports Satori; install it, with GitHub Packages access, only if you import that entry point.
  `npm run beta:installable` installs the built tarball from public npm with no credentials.

### Added (`@nuxeo-satori/platform/components`, `@nuxeo-satori/platform/components-satori`)

- `nxs-avatar`, `nxs-breadcrumbs`, `nxs-tag` and `nxs-rich-tooltip` on Material, registered as
  `nxs.primitives.avatar`, `.breadcrumbs`, `.tag` and `.richTooltip` by `provideNxsComponents()`,
  with their input contracts (`NxsAvatarInputs` and the rest) and `NXS_PRIMITIVE_IDS`.
- A new entry point, `@nuxeo-satori/platform/components-satori`, whose
  `provideNxsSatoriComponents()` re-registers the same four IDs on Satori. List it after
  `provideNxsComponents()`; later registrations win.

### Added (`@nuxeo-satori/platform/components`) — card

- `nxs-card` on Material, registered as `nxs.primitives.card` (`NXS_PRIMITIVE_IDS.card`) by
  `provideNxsComponents()`, with its input contract `NxsCardInputs`. It has no outputs: its open and
  selection handlers and the templates for its media, header action and actions are inputs, so a
  host rendering the ID through `lib-extension-outlet` passes them. `provideNxsSatoriComponents()`
  does not re-register it, so the ID renders `nxs-card` with or without Satori.
- Browse's and search's card views render each card through `nxs.primitives.card`, so a component
  registered under the ID replaces every card there.

### Added (`@nuxeo-satori/platform/components`) — search

- `nxs-search-filters`, Web UI's search form over `default_search`, which edits `NxsSearchFilters`
  and takes the server's `aggregations` for its counts; with `nxsSearchFiltersToQuery`,
  `nxsSearchFiltersToSavedParams`, `nxsSearchFiltersFromParams` and `nxsSearchFiltersToRecord` to
  convert the filters.
- `nxs-saved-search-select`, the saved searches a page provider lists, and
  `nxs-saved-search-actions`, which offers Save, Rename, Share and Delete only with `WriteProperties`
  on the saved search, as Web UI does.

### Fixed (`@nuxeo-satori/platform/nuxeo-client`) — search

- `SearchService.search` sends a collection on `ecm_collections`. It sent the collection id on
  `dc_coverage_agg` too, which the server applied as a coverage filter, so a collection search
  returned nothing. `moreThan1YearAgo`, which the server ignored, is sent as `priorToLastYear`;
  the page is no longer filtered again client-side; dashes in the full text become spaces, as in Web
  UI; and a list parameter may be a JSON array, which keeps a value containing a comma whole.
- `SearchService.getSavedSearchById` returns a list parameter as JSON rather than comma-joined.
- Added `SearchService.getTagSuggestions` (`Tag.Suggestion`) and `renameSavedSearch`, which keeps
  the stored filters.

### Removed (`@nuxeo-satori/platform`) — a peer dependency

- **`@alfresco/adf-extensions` is no longer a peer dependency.** The extension engine now has its
  own `filterEnabled`, `sortByOrder` and `mergeObjects`, pinned case by case to the output 9.0.0
  produced (`extension-element.spec.ts` and `extension-merge.spec.ts` in `libs/shared/extensions`).
  No export changes. A consumer no longer has to install the package, and can remove it unless its
  own code imports it.

### Fixed (`@nuxeo-satori/platform/extensions`)

- Two extension layers that set the same key to `null` and to an object, in either order, no
  longer break every slot. The `$references` merge (`mergeExtensionConfigs`) threw `TypeError`
  there — so `"rule": null` after a nested rule, or any `order` after `"order": null`, made every
  slot's `resolve()` rethrow — and now the later layer's value is used.
- A `__proto__` key in an extension layer — a slot id, an override id, or any key the merge
  reaches — is ignored instead of replacing an object's prototype, and an entry whose `id` is
  `__proto__` or names an `Object.prototype` member (`constructor`, `toString`) merges by id like
  any other.

### Changed — BREAKING (`@nuxeo-satori/platform/nuxeo-client`)

Four exported functions gained a **required** `locale: string` parameter. Each previously
formatted dates with a hardcoded `'en-US'` or with a bare `toLocaleDateString()`/`toLocaleString()`,
so the date a user saw came from the machine rather than from the language they chose.

- `buildDocumentCompareSections(left, right, viewAll, locale)`
- `formatCompareDate(value, locale)`
- `principalPermissionTimeFrameLabel(row, translate, locale)`
- `principalPermissionToLocalRow(row, translate, locale)`

The parameter is required rather than defaulted on purpose. A default that supplies the host
locale is what let the original bug survive: it makes every un-updated call site a silent no-op
instead of a compile error. Callers should pass Angular's `LOCALE_ID`:

```ts
private readonly locale = inject(LOCALE_ID);
```

### Removed — BREAKING (`@nuxeo-satori/platform/nuxeo-client`)

- `buildDocumentCompareRows` — deprecated, and superseded by `buildDocumentCompareSections`,
  which returns the same rows grouped by section. To migrate:
  `buildDocumentCompareSections(left, right, viewAll, locale).flatMap((s) => s.fields)`.

### Added (`@nuxeo-satori/platform/nuxeo-client`)

- `formatAceDateRange(begin, end, translate, locale)` — one implementation of the ACE date-range
  label previously duplicated across the document, collection and browse permission tables.
- `permissionRightLabel(permission, translate)` — maps a Nuxeo permission identifier to its
  display label, replacing three hardcoded English `Record<string, string>` copies. Unknown
  permissions (for example from a marketplace package) still render their raw Nuxeo name.

### Added (`@nuxeo-satori/platform` generators)

- `generators/config-package/create.mjs` scaffolds a configuration package with Node 20 alone —
  no install, no Nx, no registry token (NXSAT-312). In a clone of this repository:
  `node tools/satori-generators/src/config-package/create.mjs acme-config --owner=acme`. It writes
  the same files as the `config-package` generator, byte for byte, which `create.spec.ts` checks.

### Changed (`@nuxeo-satori/platform` generators)

- A generated package's `build.mjs` refuses JSON nested deeper than the server accepts, which was
  the one server limit it did not know (NXSAT-730). Between 1001 and about 3700 deep the build used
  to succeed and the package to install, while the server dropped the fragment at
  `error invalid-json` and the customer's setting silently did nothing; deeper than that the
  recursive duplicate-key check overflowed the stack and the build reported the bare words
  "Maximum call stack size exceeded". Depth is now counted with an explicit stack before anything
  walks the document, so the refusal names the file and the limit at any depth:
  `nested 1001 deep; the server's JSON parser refuses a fragment or layout nested deeper than 1000`.
  That limit is jackson-core's `StreamReadConstraints` default rather than one `nuxeo-agentic-core`
  sets — `ConfigSnapshot` parses with a plain `ObjectMapper` — so the message names the parser, and
  on a server whose Jackson raised the default the build is stricter than it needs to be rather
  than generous enough to ship a package that does not work. Component XML is bounded the same way
  at 256 elements, this script's own limit, because the recursive well-formedness walk used to
  overflow and print a raw Node stack trace. Inside the band the server accepts, the build now also
  says when the limit it met was its own: both the duplicate-key walk and the `JSON.stringify` that
  packages a body still recurse through it, so a body nested close to 1000 can exhaust the stack of
  the Node running the build — on Windows with Node 20 from about depth 993, where packaging gives
  out first and, being the one depth-sensitive call outside a `try`, ended the build with a raw
  `RangeError` trace. Both now report
  `nested 993 deep; the server accepts this depth but this Node ran out of stack walking it. Build with Node 22 or newer.`,
  naming the file and never writing a zip. A `RangeError` that is not the stack, such as
  "Invalid string length", is still reported as itself rather than blamed on Node.
- The `config-package` generator and `create.mjs` refuse a package name they cannot honour, before
  writing anything, and say what it would clash with (NXSAT-729). Refused: `defaults`, the name of
  Satori's own packaged fragments in both layers — a package of that name contributed a fragment on
  the same key as ours and took its place on the server, reported only at `info`; `nuxeo-agentic-ui`,
  the package every configuration package depends on; and the device names Windows reserves (`con`,
  `prn`, `aux`, `nul`, `com0`–`com9`, `lpt0`–`lpt9`), which cannot be directory names there, through
  any case and through a trailing extension. A `--directory` segment is held to the Windows names
  too, since it also becomes a directory; Satori's names are refused for the package name only. A
  package already generated under one of these names is unaffected until it is regenerated with
  `--force`.
- The `config-package` generator no longer runs Prettier over what it writes, so its output no
  longer depends on the workspace's Prettier configuration or on the title (Prettier rewrote
  `*Claims*` as `_Claims_`). Its templates are stored as Prettier formatted them, so the only file
  formatted differently is `project.json`, now as Nx serialises it, one array item per line. The
  generated README builds with `node build.mjs`, and its table no longer names the component file.
  A `.gitignore` keeps the `dist/` that `node build.mjs` writes inside the package out of git.

### Fixed

- Permission tables, browse columns, the expired-documents drawer, task due dates and the
  document-compare dialog now format dates in the user's selected language. Every remaining
  `toLocaleDateString('en-US')` and bare `toLocaleDateString()` in application code is gone;
  `LOCALE_ID` is the single source. Verify with:

  ```bash
  grep -rn --include='*.ts' -E "toLocale(Date|Time)?String\('en-US'|toLocale(Date|Time)?String\(\)" apps libs | grep -v '\.spec\.'
  ```

- ACE time frames no longer build their text by interpolation (`from ${begin} to ${end}`).
  A string assembled at runtime has no catalogue entry, so no translation could reach it; these
  now resolve the `permissions.time-frame.*` keys, which already existed in `en.json` and were
  already in use by `share-saved-search-dialog` — so this is the fourth copy of that shape
  selection rather than the first consumer of a dormant path. That dialog keeps its own copy
  deliberately: it re-parses its own label, so its dates must stay unformatted.
- The Clipboard navigation item's accessible name and the document cards selection
  checkbox label are translated rather than concatenated (INFO-144).
