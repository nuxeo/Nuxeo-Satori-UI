---
title: Extensibility Contract
parent: Engineering
order: 7
last_reviewed: 2026-10-15
repo_commit: c053e63
audience: engineering
---

# The Extensibility Contract — four layers

> **Last reviewed:** 2026-10-15 · **Repository:** `c053e63` (`integration/nxsat-308`)
> Only the adf-hx bridge and POC-route passages were re-verified at that commit, for NXSAT-648.
> Before that, last reviewed 2026-10-12 at `82c78bd` (`feature/nxsat-308-agent-surface`):
> Only "The six guardrail checks" was verified at that commit, against
> `libs/platform/guardrails/check-extension-library.mjs`. The entry-point count and the
> `@nuxeo/satori-platform/components-satori` row in §6 were verified on 2026-10-11 at `ad60a57`.
> The `@nuxeo/satori-platform/components` row in §6 was re-verified at
> `effd434` (`feature/nxsat-308-satori-components`), and "Our rule context is deliberately not
> upstream's" in §5 at `5abcd50` (`feature/nxsat-308-replace-adf-extensions`); the tarball figure
> in §6 carries its own date. The rest of the page as of 2026-08-24 · `77265f9`.
> Customer-facing companion: [`docs/extension-reference.md`](../../docs/extension-reference.md),
> which is drift-gated by `npm run beta:reference`.

**The contract is the product.** Everything else in this repository exists to make a
customer able to change the application without editing our source — and to make that
promise checkable rather than aspirational.

---

## 1. The four layers

| Layer                      | What the customer writes                                                    | App rebuild needed     | Survives upgrade                                 |
| -------------------------- | --------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------ |
| **0 — Configuration**      | JSON + CSS custom properties: theme tokens, branding, languages             | No                     | Yes — it is a fragment in the customer's package |
| **1 — Declarative wiring** | JSON referencing components, rules, actions and routes **by registered ID** | No                     | Yes — it is a fragment in the customer's package |
| **2 — Customer code**      | A TypeScript library against `@nuxeo/satori-platform`                       | Yes, in **their** repo | Yes — npm semver                                 |
| **3 — Agent harness**      | Prompts. The generators and guardrails ship inside the package              | Yes, in their repo     | Yes                                              |

Layers 0 and 1 are expected to absorb most customer requests and need no build of the application:
the customer's configuration package is zipped by a dependency-free script and installed.

> **This expectation is a design assumption, not a measured fact.** It has not been tested
> against real customer requests. [`docs/adf-hx-beta-plan.md`](../../docs/adf-hx-beta-plan.md)
> flags it as needing validation against The Church and one other account. **Not verified in
> repository.**

Layer 2 exists because a manifest can only rewire what is already compiled in — ACA's own
`extensions.setComponents({...})` registration confirms the same constraint upstream.

---

## 2. Layer 0 — configuration without a rebuild

`bootstrap.json`, fetched before authentication because it carries the Nuxeo server URL.

Live example: [`apps/nuxeo-satori-template/public/agentic-ui-config/bootstrap.json`](../../apps/nuxeo-satori-template/public/agentic-ui-config/bootstrap.json). It is the servlet's
response with one fragment, which is what the template's dev server answers; on a server, the
fragment's `content` is a `bootstrap` fragment in your configuration package.

| Key                                      | Purpose                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `nuxeoApiOrigin`                         | Where the Nuxeo REST API lives                                               |
| `branding`                               | Product name, browser tab title, and `logo` (below)                          |
| `themes` / `defaultThemeId`              | Named token sets applied to `<html>`                                         |
| `defaultLanguage` / `availableLanguages` | i18n                                                                         |
| `presales`                               | Presales presets, honoured only where a package sets `presetSwitching: true` |

### `branding.logo`

`{ "src": "assets/acme-logo.svg", "alt": "Acme Insurance" }` replaces the Satori word mark in the header
and the Satori lockup on the login page. `null` or absent keeps the Satori marks. It does not
replace the Hyland mark at the top of the navigation rail or the "Content Innovation Cloud" title
shown when the rail is expanded (both hard-coded in Satori's `sat-platform-nav`), and there is no
key for the favicon.

- **`src`** is a relative path resolved against the directory `bootstrap.json` is served from,
  `/nuxeo/agentic-ui-config/`. The servlet serves images only under `assets/`, so a logo is
  `assets/<name>`, backed by an `<asset>` the configuration package contributes and the file in
  its bundle — `<asset name="acme-logo.svg" src="agentic-ui-config/assets/acme-logo.svg" />`.
  Nothing placed on the server's disk is served. An `https:` URL or a
  `data:image/` URI also works. Both `<img>` elements carry `crossorigin="anonymous"`, so a remote
  logo is loaded without cookies and a redirect from it to a Nuxeo URL cannot carry the session —
  which means an `https:` logo only renders if its host sends `Access-Control-Allow-Origin`. A
  contributed asset is same-origin and unaffected.
- **Every other form is rejected.** What shows instead depends on which check rejected it, and the
  two are not the same: a value rejected **while the fragments merge** is dropped and the previous
  layer stands, so another package's valid logo keeps rendering and only a deployment with no
  valid logo before it falls back to the Satori marks; a value rejected **after the merge**, on
  the URL it resolves to, has no earlier layer left to fall back to and the Satori marks render.
  A contributed value can therefore be retained by the merge and still not be displayed. An
  `<img>` request bypasses the
  HTTP interceptor but still sends the session cookie, so a `src` that could name a Nuxeo REST
  endpoint is refused rather than left to fail. The deciding check runs on the **resolved** URL,
  after the URL parser has dropped tabs and newlines and collapsed `..` and `%2e%2e`. On any host
  that serves Nuxeo — the application's, and those of `nuxeoApiOrigin` and `nuxeoServerUrl`,
  including protocol-relative values — it is refused whatever the scheme or port, because cookies
  are scoped by host. The one exception is the configuration directory itself, where no path
  segment may carry a `;`, an encoded `;` or `/`, or a double-encoded escape such as `%252e` —
  Tomcat strips `;` path parameters before it collapses `..`, so `..;/api/v1/me` would leave the
  directory on the server while staying inside it in the browser, and a proxy that decodes before
  forwarding turns the encoded forms into the same thing. A logo file name therefore cannot
  contain `;` or `%`. Elsewhere it must be `https:`. Refused earlier, on the string as written:
  control characters, backslashes, an absolute or protocol-relative path, a `..` segment, a query
  or fragment with no path (it would load `bootstrap.json` itself), `http:`, `javascript:`, and a
  `data:` URI that is not an image or has no payload (a payload that starts with `#` is a
  fragment, so it counts as none).
- **"The same host" means the same host however it is spelled** (NXSAT-724). The URL parser
  lowercases names and canonicalises every IPv4 form — `127.1` and `0x7f.0.0.1` both arrive as
  `127.0.0.1` — so neither case nor IPv4 notation was ever a way past the rule above. Two things
  it does not do, and the check now does: a **trailing dot** is stripped, because `example.com.`
  is the fully-qualified form of `example.com` and shares its cookie jar; and `localhost`,
  anything in `127.0.0.0/8`, `[::1]` and any `*.localhost` subdomain are treated as one host,
  because on a single-host deployment each of them reaches the Nuxeo the configuration itself came
  from — `*.localhost` because RFC 6761 resolves it to loopback and browsers honour that. An IPv4
  address embedded in IPv6 is **decoded**, for each of the three standardised embeddings the URL
  parser accepts (`::ffff:127.0.0.1`, the deprecated `::127.0.0.1`, and `::ffff:0:127.0.0.1`,
  which arrive as `[::ffff:7f00:1]`, `[::7f00:1]` and `[::ffff:0:7f00:1]`) and only those — an
  address outside them embeds no IPv4 host and is left alone, because reading the low 32 bits of
  anything that merely looks similar collapses distinct hosts together and refuses logos that
  should load. Decoding applies to **every**
  address, not just loopback, so a deployment on `10.0.0.5` also refuses `[::ffff:10.0.0.5]`;
  that equivalence needs no DNS. Names that merely contain the word are unaffected —
  `mylocalhost`, `localhost.example.com` and a host actually called `loopback` are ordinary
  third-party hosts. A side effect
  worth knowing: a logo inside the configuration directory is refused if its host carries a
  trailing dot, since the same-origin exception is matched on the origin as written — write the
  host the way the application is served, or use a relative path. What the check still cannot do
  is resolve a name to an address, so a Nuxeo named `nuxeo.internal` and addressed as `10.0.0.5`
  compares unequal; that is not a session risk, because cookies are scoped by the host as
  written and the two spellings do not share a jar.
- **Every refusal is reported** (NXSAT-724). A refused `src` used to keep the packaged mark and
  say nothing, so a typo looked exactly like configuring no logo at all. Each contributed value
  the checks refuse is now written once per load to the console as `[agentic-ui-config] …` and
  recorded in `diagnostics().messages`, naming the value, where it came from and the reason. The
  reason text comes from the same function that decides the verdict, so the two cannot drift
  apart. The active preset's contribution is included and named as such; unselected presets
  contribute nothing and stay quiet. A `src` written as an empty or whitespace-only string is
  reported too — it is refused, and it used to be indistinguishable from declaring no logo.
  What the report deliberately does **not** say is which mark ends up on screen: a refusal leaves
  whatever an earlier layer set, so an earlier valid logo still wins and a later valid one
  replaces a refused earlier one. Each cause gives its own wording — the scheme is named, so
  `javascript:` and `http:` do not read alike; a backslash is not reported as a control
  character; and a path refused for syntax the server re-reads is not reported as pointing outside
  the configuration directory, because a file named `acme;v=1.svg` or `acme%e0.svg` is inside it
  and saying otherwise sends the administrator looking in the wrong place. A `..` segment is
  likewise reported as not allowed rather than as leaving the directory, since
  `assets/../acme.svg` carries one and resolves back inside — it is refused on the written form
  wherever it would resolve to, which is the point of checking the form at all. One log line
  identifies what was wrong with the value.
- **The two logo messages make different claims on purpose.** A failure _after_ loading (the
  NXSAT-721 case above) says the Satori marks are in use, because the merge has already settled
  which contribution won and suppressing that one URL leaves nothing to render but the packaged
  marks. A refusal _during_ the merge says only that the value was refused, because an earlier
  layer's valid logo survives it.
- **A logo that is accepted and then does not render keeps the Satori marks too** (NXSAT-721).
  Every check above runs before the image is requested, so none of them can know whether the file
  exists, whether the bytes decode, or whether a remote host sent the CORS header. The two `<img>`
  elements report back instead: `error` covers a missing file, a `src` that answers with something
  that is not an image, and a cross-origin response without `Access-Control-Allow-Origin`, and a
  measurement after `load` covers an image that decodes but draws nothing, such as a 0x0 SVG. The
  first report clears the logo for the session, so the header, the login page and the brand link's
  accessible name all go back to the Satori marks together, and one warning naming the failing
  address is written to the console as `[agentic-ui-config] …` and recorded in
  `diagnostics().messages`. A failure on another origin says so, because a missing
  `Access-Control-Allow-Origin` header is the likeliest cause and the hardest to guess at.
- **`alt`** names the login page's brand link. Empty falls back to `applicationTitle`. The header
  logo is decorative (`alt=""`): the header is named by its heading.
- Contributed assets are served at `/nuxeo/agentic-ui-config/assets/<name>` (NXSAT-312). The servlet path is outside every
  `NuxeoAuthenticationFilter` URL pattern, which is what lets the login page load the logo before
  sign-in; the NXSAT-312 rehearsal fetched a contributed SVG there anonymously, as `image/svg+xml`.

### Why it is contributed, not edited

The marketplace installer copies the web directory with `overwrite="true"`, so configuration
inside the bundle is **destroyed on upgrade**, and a file the package protects with
`overwrite="false"` made an upgrade after an edit leave no version installed (NXSAT-317). Since
NXSAT-312 nothing is edited on the server at all: a customer ships their own Marketplace package
that contributes fragments to the configuration service in `nuxeo-agentic-core`, and a servlet
serves them at `/nuxeo/agentic-ui-config/`. Upgrading our package uninstalls and reinstalls the
packages that depend on it, so their contributions come back unchanged. The old
`bootstrap.json`-on-disk mechanism is **removed with no migration**. The package layout, and why
`nxserver/web` is the wrong web destination (it is not a Tomcat docBase), are in
[`13-deployment-and-troubleshooting.md`](13-deployment-and-troubleshooting.md) §2.

An earlier version shipped to `nxserver/web/…` and **would have 404'd on every install**.
It was recorded complete before that was caught.

### Theme tokens

`TemplateThemeService` writes `themes[].tokens` onto `<html>` as CSS custom properties.
Colour literals in `.scss` must come from a themed namespace with a fallback —
`--mat-sys-*`, `--kd-*`, or `--shell-*` in the template — enforced by `checkThemeTokens`.

The template ships **no Angular Material on purpose**, so a fork does not have to remove
our design system before adding its own. That is why `--shell-*` is a recognised namespace
rather than a faked one: writing `var(--mat-sys-surface, #fff)` there would satisfy the
gate while the fallback did all the work.

---

## 3. Layer 1 — the manifest

A **`manifest` fragment in the customer's configuration package**, served with every other
package's fragments at `agentic-ui-config/manifest.json`. Example fragment:
[`apps/nuxeo-satori-template/manifest.example.json`](../../apps/nuxeo-satori-template/manifest.example.json).

It survives an upgrade of ours because it is in their package, which depends on ours, and it is
versioned with that package. It is read before sign-in, so it is the same for every user and
must hold nothing sensitive. Until NXSAT-312 the manifest was a Nuxeo Note at
`/default-domain/config/agentic-ui`, read with each user's session; the application no longer
reads it, with no migration. Each fragment's `extensions` block is resolved on its own, so two
packages' contributions never depend on each other's `$layer` references.

```jsonc
{
  "version": 1,
  "labels": {}, // i18n overrides
  "featureToggles": { "acme.reports.betaExport": true },
  "extensions": {
    "overrides": {
      // change a descriptor without restating it
      "template.navbar.reports": { "visible": false },
      "template.navbar.home": { "label": "Dashboard", "order": 5 },
    },
    "slots": {
      // ADD entries; merges with code, does not replace
      "navbar": [
        { "id": "acme.navbar.contracts", "label": "Contracts", "path": "/reports", "order": 35 },
      ],
      "sidebar": [{ "id": "acme.sidebar.reports", "component": "template.sidebar.reports" }],
      "toolbar": [
        {
          "id": "acme.toolbar.exportSummary",
          "action": "template.actions.exportSummary",
          "rule": "template.rules.isSignedIn",
        },
      ],
    },
  },
}
```

**The manifest never names a class.** It names IDs. That indirection is what lets us rename
a component without breaking a customer.

### The manifest is JSON, and nothing type-checks JSON

This is the contract's sharpest edge. Rename a slot in the platform and every manifest
referencing it goes **quietly inert** — the app boots, compiles, and the customer's entry is
simply gone. No compiler sees it.

That is why [`scripts/beta-harness/upgrade-rehearsal.mjs`](../../scripts/beta-harness/upgrade-rehearsal.mjs)
exists and why its slot-existence assertion is the one that earns it its place. Run
`node scripts/beta-harness/upgrade-rehearsal.mjs --break-slot toolbar`: `toolbar` is named
only in the manifest and referenced by no TypeScript, so **the compile stays green** and
only that check goes red.

---

## 4. The nine slots, and what actually reads them

Declared in [`libs/shared/extensions/src/lib/extension-slots.ts`](../../libs/shared/extensions/src/lib/extension-slots.ts).

| Slot           | State                                                           | Evidence                                         |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| `navbar`       | **Live** — packaged descriptors + a host that renders them      | 17 documented IDs                                |
| `bulk-actions` | **Live** — packaged descriptors + host                          |                                                  |
| `documentList` | **Live** — 12 packaged columns, resolved by the browse route    | `provide-app-extensions.ts:108`, `browse.ts:481` |
| `sidebar`      | Resolved, **no packaged descriptor**                            | 3 documented IDs                                 |
| `routes`       | Resolved, **no packaged descriptor**                            | `extension-reference.md` section 11              |
| `toolbar`      | **Live** — 16 packaged actions on document detail               | `extension-reference.md` section 8               |
| `contextMenu`  | **Live** — 4 packaged actions in the browse "More actions" menu | `extension-reference.md` section 10              |
| `tabs`         | **Live** — 6 packaged document-detail tabs                      | `extension-reference.md` section 9               |
| `documentView` | Resolved, **no packaged descriptor** — the View tab body        | `extension-reference.md` section 9a              |

This table read "Reserved — nothing reads it" for `routes`, `toolbar`, `contextMenu` and
`tabs` well after each gained a host. `npm run beta:reference` checks the states in
`docs/extension-reference.md`, not this table, so the reference is authoritative.

**Do not describe a reserved ID as an extension point.** No slot is reserved today; every
one is read by a host, and `sidebar`, `routes` and `documentView` carry no packaged entries.

`rules` was **removed** from `EXTENSION_SLOTS`: rules are not descriptors and live in
`ExtensionRuleRegistry`, so `slots.rules` was silently inert.

### Slots are additive by construction

`ExtensionSlotRegistry` keys slots by opaque string with **no enum, union or `switch` on
slot identity**, so a tenth slot requires no change to the nine. Do not introduce a central
slot dispatch — it would undo the property the addressable-surface decision rests on.

---

## 5. The four registries

[`libs/shared/extensions`](../../libs/shared/extensions), 3,101 lines, 9 spec files, 96.04%
line coverage.

| Registry                     | Holds                       | Keyed by               |
| ---------------------------- | --------------------------- | ---------------------- |
| `ExtensionSlotRegistry`      | Descriptors placed in slots | slot id → descriptor[] |
| `ExtensionRuleRegistry`      | Named predicates            | rule id → evaluator    |
| `ExtensionComponentRegistry` | Lazily-resolved components  | component id → loader  |
| `ExtensionActionRegistry`    | Action handlers             | action id → handler    |

### Rules

An evaluator receives `(context, parameters, resolve)`. The context has three
independently populated halves — see [Architecture §8](02-architecture.md#8-state-management)
for why `selection` is deliberately still empty while `selectionCount` is live.

Composites are ordinary registered evaluators, not special cases: `core.every`, `core.some`,
`core.not`, `core.true`, `core.false`. Named after ACA so a manifest written against ACA's
docs works unchanged.

> **`core.not` is NOR, not NAND.** Upstream is `args.every(arg => !evaluator(...))` — every
> nested rule must be false. Phase 2 shipped `!every(evaluator)`, which agrees for one
> argument and diverges from two upwards while the file claimed ACA parity. Corrected, with
> a multi-argument test.

Fail-open, recursion bounds and the security-relevant list: see
[Architecture §9](02-architecture.md#9-error-handling-retry-and-validation).

**Varying by document type.** `app.rules.isType` and `app.rules.hasFacet` take type or facet names
as `parameters` — the same tests as the `type` and `facet` attributes of Nuxeo Web UI's
`nuxeo-filter` — so a manifest can show a tab or action for a Case and not a Claim with no code.
Both answer `false` with no string parameter, and both read the focused document, so they gate
document-detail tabs and toolbar actions but not browse columns. Reference and examples:
`docs/extension-reference.md` §4.

### Our rule context is deliberately not upstream's

`RuleContext` from `@alfresco/adf-extensions` is typed on Alfresco Content Services domain
objects — `NodeEntry`, `SiteEntry`, `RepositoryInfo` — describing a repository we do not
talk to. Reusing it would put ACS types in the signature every customer rule is written
against. The _shape_ is upstream's; the types are ours. Upstream's domain-neutral helpers
were used directly until NXSAT-308, which replaced the three the engine needed —
`mergeObjects`, `filterEnabled` and `sortByOrder` — with our own, pinned case by case to
upstream's output.

---

## 6. Layer 2 — `@nuxeo/satori-platform`

One publishable library, six secondary entry points; `npm pack --dry-run` on the build gives a
556 kB tarball of 70 files (measured 2026-10-08).

| Entry point                                | Wraps                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@nuxeo/satori-platform`                   | Root — `PLATFORM_ENTRY_POINTS`, shared types                                                                                                     |
| `@nuxeo/satori-platform/extensions`        | The registries, `provideSatoriExtensions`, `ExtensionOutletComponent`                                                                            |
| `@nuxeo/satori-platform/app-config`        | Layer 0 loader and tokens                                                                                                                        |
| `@nuxeo/satori-platform/components`        | `nxs-` components — Material-backed, no ADF or Satori import                                                                                     |
| `@nuxeo/satori-platform/components-satori` | The same `nxs-` primitive IDs on Satori, over the Material ones; the only entry point that imports the optional `@hylandsoftware/satori-ui` peer |
| `@nuxeo/satori-platform/nuxeo-client`      | Services and models                                                                                                                              |
| `@nuxeo/satori-platform/ui`                | Shared presentational components                                                                                                                 |

### One declarative object reaches four registries

[`provideSatoriExtensions()`](../../libs/shared/extensions/src/lib/provide-satori-extensions.ts)
takes a contributor and registers slots, rules, components and actions in a
`provideEnvironmentInitializer`. It uses `runInInjectionContext` rather than a bare call, so
a rule contributed by a **customer library** may `inject()` its own dependencies — a factory
declared in a customer library has no injection context of its own.

The contributor runs **before the configuration loads**. The configuration tokens —
`NUXEO_API_ORIGIN` and the SSO and session settings among them — keep the first value they
resolve to, so a contributor that injects a service which reads one (any `NuxeoApiBase`
service reads `NUXEO_API_ORIGIN` when it is constructed) fixes it at the packaged default for
the life of the application. Inject an `Injector` and look such a service up inside the rule,
as the product's own `app.rules.hasAdministrationAccess` does.

```ts
// The whole integration, in a customer's app config:
providers: [/* … */ provideAcmeExtensions()];
```

### Four guards on the package

Each added because something got past the ones before it:

| Gate               | Asserts                                                          | What it caught                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beta:api`         | The `.d.ts` surface matches a 2,221-line snapshot                | Its first version reported PASS across **27 changed types** (rolled-up `.d.ts` has no `export` prefix); its second recorded `const EXTENSION_SLOTS:` and nothing after the colon |
| `beta:publishable` | A real `npm publish --dry-run`, plus generators and declarations | **The package could not be published at all** for the whole of Phase 4 — compiled in full mode, so ng-packagr wrote a `prepublishOnly` that hard-fails publish                   |
| `beta:fork`        | The template compiles against the **built** declarations         | The platform compiled without `strictNullChecks`, shipping 27 wrongly non-nullable public types                                                                                  |
| `beta:upgrade`     | A Layer 0/1/2 customisation survives a version bump              | The only check that crosses a version boundary                                                                                                                                   |

### `tsconfig.lib.json` is the entire compiler configuration

`@nx/angular:package` given a `tsConfig` option calls
`parseRemappedTsConfigAndMergeDefaults`, which — despite the name — merges eight hardcoded
options and otherwise **replaces** ng-packagr's bundled `conf/tsconfig.ngc.json`. That
bundled file is the only place `compilationMode: partial` is set, and it is where
`strictTemplates` lives. Angular's own default is `FULL`.

Two separate defects came from this, both **configuration absent rather than wrong**, so no
compiler reported either. If you touch
[`libs/platform/tsconfig.lib.json`](../../libs/platform/tsconfig.lib.json), run
`npm run beta:publishable`.

---

## 7. Layer 3 — the harness that ships to customers

Four Nx generators, shipped **inside** the package at its root as a proper plugin:

```bash
npx nx g @nuxeo/satori-platform:extension-library acme-extensions --owner=acme
npx nx g @nuxeo/satori-platform:extension-rule      is-legal-team --library=acme-extensions
npx nx g @nuxeo/satori-platform:extension-action    export-claim  --library=acme-extensions
npx nx g @nuxeo/satori-platform:extension-component claim-summary --library=acme-extensions
```

Plus the guardrail a customer runs in their own CI:

```bash
node node_modules/@nuxeo/satori-platform/guardrails/check-extension-library.mjs libs/<their-library>
```

> Until 2026-08-24 the customer guide told customers to run
> `npx nx g ./tools/satori-generators:…` — a path inside **our** repository — and the
> generators were not in the tarball at all. The first instruction in the shipped guide
> could not be run by its audience. Verified fixed by unpacking the tarball into
> `node_modules` and generating a library from it.

### The six guardrail checks, and what each one caught

| #   | Check                                                                                                                                                          | Origin                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Registered IDs carry the library's own owner prefix                                                                                                            | An ID is a public contract                                                                                                                                                  |
| 2   | No import reaches past a published entry point                                                                                                                 | Deep paths break without being breaking changes                                                                                                                             |
| 3   | A spec asserts **registry state**                                                                                                                              | Three generators once spliced every registration _inside a comment_, reported success, printed the IDs they had "registered" — and lint, typecheck and six specs all passed |
| 4   | Gating rules are declared fail-closed                                                                                                                          | An unregistered rule ID permits                                                                                                                                             |
| 5   | No component exported from the barrel                                                                                                                          | A host that can import the class depends on a name that should stay free to change                                                                                          |
| 6   | Each registered component resolves, is named by a spec, uses the owner's selector prefix, and implements the `Nxs…Inputs` contract of a primitive it overrides | The registry swallows a failed lazy load on purpose, so a misspelt path is a blank slot with no error anywhere; an override missing an input has it silently dropped        |

Three of the first five were once satisfiable **without doing the thing they check** — a comment
mentioning a registry counted as an assertion, a dynamic `import()` evaded check 2, and
`export * from './leaky'` evaded check 5. All three probed and closed.

### Assert `false`, not `true`

An **unregistered** rule ID also evaluates to `true`, so a test expecting `true` passes
whether or not registration happened. Only `false` is an answer a genuinely registered
evaluator can give.

---

## 8. Adding an extension point

Use [`.cursor/skills/add-extension-point/SKILL.md`](../../.cursor/skills/add-extension-point/SKILL.md).
The shape:

1. Add the ID to the appropriate registry contribution.
2. Resolve it at the host — a registered descriptor is **not** a placed descriptor.
3. Document it in [`docs/extension-reference.md`](../../docs/extension-reference.md).
4. Run `npm run beta:reference` — it fails if a documented ID is unregistered, if a
   registered ID is undocumented, or if a slot-state claim does not hold.

That gate matched raw source text until 2026-08-24, so a **commented-out** `resolve(...)`
proved a slot live exactly as well as real code. Comments are now stripped before matching.
