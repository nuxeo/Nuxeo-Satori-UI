# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

`@nuxeo-satori/platform` is versioned `0.2.0` from here (`libs/platform/package.json`, previously
`0.1.0`). This section holds breaking changes made since `0.1.0`, and `^0.1.0` admits only `0.1.x`,
so the next publish has to be a minor. Nothing has been published yet.

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

### Removed (`@nuxeo-satori/platform`) — a peer dependency

- **`@alfresco/adf-extensions` is no longer a peer dependency.** The extension engine used three of
  its functions — `filterEnabled`, `sortByOrder` and `mergeObjects` — and now has its own, pinned
  case by case to the output 9.0.0 produced (`extension-element.spec.ts` and
  `extension-merge.spec.ts` in `libs/shared/extensions`). No export changes. A consumer no longer
  has to install the package, and can remove it unless its own code imports it.

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
- The Clipboard navigation item's accessible name and the `hxp-document-cards` selection
  checkbox label are translated rather than concatenated (INFO-144).
