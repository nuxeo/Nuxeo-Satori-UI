# AGENTS.md — extending Nuxeo Satori

**Audience:** a developer or an AI agent extending the platform from **outside** it.
**Scope:** everything you need to add a navigation entry, a rule, an action or a
component without forking us. Nothing here is about how the platform itself is built.

Read [`extension-reference.md`](./extension-reference.md) alongside this — it is the
list of every addressable ID. This file is the _procedure_; that file is the
_vocabulary_.

---

## 1. The rule that matters most

**Never fork to change something a layer already addresses.** In order of cost:

| Layer | You change                                            | Rebuild?   | Who can do it                             |
| ----- | ----------------------------------------------------- | ---------- | ----------------------------------------- |
| **0** | a `bootstrap` fragment — branding, theme, endpoints   | no         | whoever ships their configuration package |
| **1** | a `manifest` fragment — hide, reorder, relabel, gate  | no         | whoever ships their configuration package |
| **2** | your own npm library — new rules, actions, components | yes, yours | a developer                               |
| **3** | this file and the generators                          | —          | you, when extending                       |

If a change is possible at Layer 0 or 1, doing it in code is a mistake you will pay
for at the next upgrade. If it is not possible at any layer, that is a gap worth
raising rather than a reason to fork.

## 2. Start with a generator

The five generators ship **inside this package** — `generators.json` at its root, so Nx
resolves them from `node_modules` like any other plugin. Nothing to clone.

For Layer 0 and 1 — no code — scaffold the **configuration package** you install on Nuxeo. That
needs only Node 20: no install, no Nx, no registry token. In a clone of the Satori repository:

```bash
node tools/satori-generators/src/config-package/create.mjs acme-config --owner=acme
node config-packages/acme-config/build.mjs     # checks the fragments, writes config-packages/acme-config/dist/acme-config-1.0.0.zip
nuxeoctl mp-install config-packages/acme-config/dist/acme-config-1.0.0.zip   # then restart Nuxeo
```

Where this package is installed, the same script is
`node_modules/@nuxeo-satori/platform/generators/config-package/create.mjs`.

It writes the Marketplace package — `package.xml` depending on `nuxeo-agentic-ui`, a component
that `<require>`s Satori's defaults, starter `bootstrap.json` and `manifest.json` with JSON
schemas for your editor — and a `build.mjs` that refuses what the server would reject (bad JSON,
a repeated key, a fragment over 1 MiB, a missing asset) before anything reaches a server.
`--presales` adds demo presets. Everything in a fragment is served without authentication.

Where Nx is installed, the `config-package` generator writes the same files, byte for byte, and
`nx build` runs the same `build.mjs`:

```bash
npx nx g @nuxeo-satori/platform:config-package acme-config --owner=acme
npx nx build acme-config          # writes dist/config-packages/acme-config/acme-config-1.0.0.zip
```

In a fully installed clone that form needs `npx nx run platform:sync-generators` first, because
there `generators.json` is a build output;
`npx nx g ./tools/satori-generators:config-package acme-config --owner=acme` works without it.

For Layer 2 — code — the other four:

```bash
# once, per library
npx nx g @nuxeo-satori/platform:extension-library acme-extensions --owner=acme

# then, per contribution
npx nx g @nuxeo-satori/platform:extension-rule      is-legal-team --library=acme-extensions
npx nx g @nuxeo-satori/platform:extension-action    export-claim  --library=acme-extensions
npx nx g @nuxeo-satori/platform:extension-component claim-summary --library=acme-extensions
```

> These commands used to read `npx nx g ./tools/satori-generators:…` — a path inside the
> platform repository, which you do not have. The first instruction in this guide could not
> be run by its audience, and the generators were not in the tarball at all. Both fixed:
> `beta:publishable` now fails if any generator's factory or schema is missing from the
> built package.

`--library` takes the project name, and the library defaults to `libs/extensions/<name>`.
Pass `--directory` to place it elsewhere — note it is the **parent**, so
`--directory=libs/custom` yields `libs/custom/<name>`.

The library is **inert until an application opts in**. One line:

```ts
providers: [/* … */ provideAcmeExtensions()];
```

That is the whole integration. **No edit to any `@nuxeo-satori/platform` library** —
if you find yourself needing one, stop and raise it.

### The generators edit your `extensions.ts` through marker comments

```ts
    rules: {
      'acme.rules.canUseAcme': (context) => rules.canUseAcme(context),
      // satori:register:rules      <- keep this line
    },
```

Delete a marker and the matching generator fails loudly rather than guessing where to
insert. They are comments; they do nothing at runtime.

## 3. Four things that will bite you

### 3.1 An unregistered rule ID evaluates to `true`

Rules **fail open** by design, so a manifest typo cannot silently strip working
actions out of the interface. The consequence for you: a rule you have not registered
yet does not disable anything — it permits everything.

For a rule that _gates_ a surface, declare it fail-closed:

```ts
failClosedRules: ['acme.rules.isLegalTeam'];
```

The `extension-rule` generator does this by default, inverting the platform default
deliberately: a rule you are writing now is one you want closed while it is missing.

### 3.2 Inline slot literals do not compile

```ts
// ✗ TS2418 — excess property checking rejects label/path/icon
slots: {
  navbar: [{ id: 'acme.navbar.x', label: 'X', path: '/x', icon: 'folder' }];
}

// ✓ hoist to a typed const first
const NAV: readonly NavItemDescriptor[] = [
  { id: 'acme.navbar.x', label: 'X', path: '/x', icon: 'folder' },
];
slots: {
  navbar: NAV;
}
```

`slots` values are typed `readonly ExtensionElement[]`, which carries only `id`,
`disabled` and `order` — the fields the registry honours for _every_ slot. A fresh
object literal gets excess property checking; an already-typed array does not. Hoisting
also documents which fields a slot expects.

### 3.3 A registered component is not a _placed_ component

Registering `acme.panel.claims` makes it addressable. Nothing renders until a manifest
places it, or a host route resolves it:

```ts
{ path: 'claims', component: ExtensionOutletComponent,
  data: { componentId: 'acme.panel.claims' } }
```

Do **not** export your component from `index.ts`. A host that can import the class
depends on a name that should stay free to change; it resolves by ID instead.

The `routes` slot is declared but **nothing resolves it** — a library cannot contribute
a route on its own, so a host must map the path. Check the slot table in
`extension-reference.md` before assuming a slot is live: it distinguishes _populated_,
_resolves_, and _reserved and inert_, and those are three different promises.

### 3.4 Hiding a control is not a security control

Layer 1 decides what the interface **offers**. Nuxeo decides what the server
**allows**, server-side, on every operation. Hiding a delete action does not stop a
user with `Remove` from deleting over REST, and showing it grants nothing.
`failClosedRules` closes a startup-timing gap in the _interface_; it is not
authorisation either. Use Nuxeo ACLs.

## 4. How to verify your library — and how not to

```bash
npx nx test <library>       # asserts your IDs are really registered
npx nx typecheck <library>  # `test` does NOT typecheck — vitest strips types
npx nx lint <library>
```

`typecheck` is not redundant. Vitest strips types through esbuild, so a green `test`
says nothing about type safety.

### Run the shipped guardrail in your own CI

Those three targets check that your code compiles and that your own assertions hold. They
cannot tell you that you have made one of the five mistakes below, because each one is
green code. This package ships the check as an executable:

```bash
node node_modules/@nuxeo-satori/platform/guardrails/check-extension-library.mjs libs/<your-library>
```

It exits non-zero on: an ID registered under a prefix you do not own, an import that
reaches past a published entry point, a library with no spec touching a registry, a
gating rule missing from `failClosedRules`, and a component exported from your barrel.
Every one of those corresponds to a mistake made in this codebase, not a hypothetical —
and every one passes `lint`, `test` and `typecheck`.

We run it against our own reference library on every build, so you are not the first to
find out when it breaks.

### Assert against the registry, not against your own call

The failure this contract exists to prevent is a library that registers descriptors
nothing renders. Only the registry can tell you the difference:

```ts
// ✓ observable registry state
expect(TestBed.inject(ExtensionActionRegistry).has('acme.actions.export')).toBe(true);

// ✗ proves only that you called a function
expect(provideSpy).toHaveBeenCalled();
```

**And assert a rule's answer as `false`, not `true.`** An _unregistered_ ID also
evaluates to `true`, so a test expecting `true` passes whether or not your registration
happened. Only `false` is an answer a genuinely registered evaluator can give.

This is not hypothetical. Three generators in this workspace once spliced every
registration _inside a comment_, reported success, printed the IDs they had
"registered" — and `lint`, `typecheck` and six existing specs all passed, because none
of them named the new IDs.

## 5. If you are an AI agent

- **Do not edit anything under `@nuxeo-satori/platform`.** If a task seems to require
  it, the task is either a Layer 0/1 change in disguise or a genuine gap to report.
- **Prefer a generator to hand-writing a file.** They emit the specs and the guard
  rails; hand-written contributions routinely omit both.
- **An ID is a public contract.** Once a manifest references it, renaming is breaking.
  Use your own `<owner>.` prefix for everything you contribute.
- **Never claim a contribution works because it compiled.** Run the specs, and make one
  of them assert registry state. A green build is compatible with registering nothing.
- **State what you did not verify.** "Registered and typechecks" and "renders on
  screen" are different claims.

## 6. Where things live

| What                                             | Where                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Every addressable ID, and each slot's real state | `extension-reference.md`                                                                      |
| The published API surface                        | `@nuxeo-satori/platform` type declarations                                                    |
| Entry points                                     | `@nuxeo-satori/platform/{extensions,app-config,components,components-satori,nuxeo-client,ui}` |
| Your contributions                               | your own library, `provideSatoriExtensions()`                                                 |

## 7. The `nxs-` components

`@nuxeo-satori/platform/components` is the Nuxeo-owned component library: `nxs-` selectors,
built on Angular Material, with no ADF and no Satori import of its own. Compose its components
inside your own Layer 2 components:

```ts
import { NxsEmptyStateComponent } from '@nuxeo-satori/platform/components';
```

```html
<nxs-empty-state icon="inbox" [heading]="'acme.claims.empty' | translate" />
```

- **Text inputs take text you have already translated.** Bind every heading, message, label and
  column name you pass through your own translate pipe.
- **A component's own chrome uses `satori-components.*` keys.** The column picker's Done and
  Reset, or `nxs-permissions-panel`'s headings, for example. Without the Satori catalogue,
  `providePlatformEnglishFallback()` (README, "Translations") renders them in English; add the same
  keys to your catalogue to translate them. `nxs-domain-hint` is the exception: its note is
  `nuxeo-client`'s `DOMAIN_CONTAINER_GUIDANCE_KEY` (`browse.message.domain-container-guidance`),
  the same sentence the Create / Import checks give, and the fallback covers it the same way.
- **`nxs-empty-state` renders its heading as an `<h2>` by default.** Bind `[headingLevel]` to
  one below the heading of the section it sits in, so screen-reader heading navigation stays in
  order.
- **Replace a packaged panel by its ID.** `nxs-permissions-panel` is registered as
  `NXS_PERMISSIONS_PANEL_ID` (`nxs.components.permissionsPanel`). Register your own component
  under it and both Permissions tabs render yours, with `documentId` and `permissionsChanged`, a
  callback to invoke after a write so the host re-reads the external-user section it owns.
- **Import only the entry point.** A path past it fails the shipped guardrail like any other
  deep import.
- **It is new and growing.** The type declarations are the list of what exists; do not take
  a component's existence from this file.
- **Satori is optional.** `provideNxsComponents()` registers the four `nxs.primitives.*` IDs on
  Material. Only with GitHub Packages access, add `provideNxsSatoriComponents()` from
  `@nuxeo-satori/platform/components-satori` after it to re-register them on Satori — the one entry
  point that needs the optional `@hylandsoftware/satori-ui` peer. See `extension-reference.md` §6a.
