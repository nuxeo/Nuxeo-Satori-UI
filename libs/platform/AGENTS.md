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
gating rule missing from `failClosedRules`, a component exported from your barrel, and a
**component contribution** that does not hold up — see §7. Every one of those corresponds to
a mistake made in this codebase, not a hypothetical — and every one passes `lint`, `test` and
`typecheck`.

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

## 7. The `nxs-` components — compose, override, place

`@nuxeo-satori/platform/components` is the Nuxeo-owned component library: `nxs-` selectors,
built on Angular Material, with no ADF and no Satori import of its own. There are three things
you can do with it, and they are different promises.

### Composable — use a component inside your own

Every component the entry point exports can be imported and used in your Layer 2 components:

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
- **A load failure is `nxs-error-state`, chosen by status.** Map the request's error with
  `nxsErrorStatus(err)` and bind the result to `[status]`, so a 403 says the user lacks access and
  a 404 says the item is gone instead of both reading as a breakage. Retry appears only for a
  server error, and only with `retryable`.
- **An action slot rendered as a menu is `nxs-action-menu`.** Resolve the slot's descriptors into
  `NxsMenuAction` entries yourself (labels translated, enabled rules evaluated) and run the one it
  emits; with no entries it renders no trigger.
- **Show a document's thumbnail with `nxs-thumbnail`.** `<nxs-thumbnail [documentId]="doc.uid">`
  fetches the rendition with the platform's credentials and revokes its blob URL itself; put the
  fallback (a type icon) inside it, and size it with your own class on the element. A page
  listing many lists `provideNxsThumbnailCache()` in its `providers`.
- **Toast through `NxsToastService`, not `MatSnackBar`.** List `provideNxsToast()` in your
  component's `providers`, then `show(message)` or `error(message, { retry })` with text you have
  translated. It keeps the core slice's timing and announcements: four seconds or longer, a
  Dismiss button, Escape to close, errors announced assertively.
- **Favourite a document with `nxs-favorite-toggle`.** It is the star; it runs the request and
  reports the outcome, and your component says what to the user. To offer the same operation as a
  menu entry, call `nxsToggleFavorite(documentDetailService, id, favorite)`, which emits the new
  state.

```html
<nxs-favorite-toggle
  [documentId]="doc.uid"
  [(favorite)]="isFavorite"
  (changed)="onFavoriteChanged($event)"
  (failed)="onFavoriteFailed($event)"
/>
```

- **Import only the entry point.** A path past it fails the shipped guardrail like any other
  deep import.
- **The type declarations are the list of what exists.** Do not take a component's existence
  from this file; each one also has stories and an Overview page in the library's Storybook.

### Overridable — re-register an ID

Two kinds of ID are addressable, so you can replace what renders under them without forking.

**A packaged panel.** `nxs-permissions-panel` is registered as `NXS_PERMISSIONS_PANEL_ID`
(`nxs.components.permissionsPanel`). Register your own component under it and both Permissions
tabs render yours, with `documentId` and `permissionsChanged`, a callback to invoke after a write
so the host re-reads the external-user section it owns.

**The four primitives**, each with a Material and a Satori implementation:

| ID                           | Contract to implement  | Material, from `/components` | Satori, from `/components-satori` |
| ---------------------------- | ---------------------- | ---------------------------- | --------------------------------- |
| `nxs.primitives.avatar`      | `NxsAvatarInputs`      | `nxs-avatar`                 | `sat-avatar`                      |
| `nxs.primitives.breadcrumbs` | `NxsBreadcrumbsInputs` | `nxs-breadcrumbs`            | `sat-breadcrumbs`                 |
| `nxs.primitives.tag`         | `NxsTagInputs`         | `nxs-tag`                    | `sat-category-tag`                |
| `nxs.primitives.richTooltip` | `NxsRichTooltipInputs` | `nxs-rich-tooltip`           | `sat-rich-tooltip`                |

`provideNxsComponents()` registers them on Material. Only with GitHub Packages access, add
`provideNxsSatoriComponents()` from `@nuxeo-satori/platform/components-satori` after it to
re-register them on Satori — the one entry point that needs the optional
`@hylandsoftware/satori-ui` peer. Registrations layer in provider order and later wins, so yours
goes last:

```ts
providers: [
  provideNxsComponents(),
  provideNxsSatoriComponents(), // optional
  provideSatoriExtensions({
    components: {
      'nxs.primitives.tag': () => import('./acme-tag').then((m) => m.AcmeTagComponent),
    },
  }),
];
```

**Implement the contract** — `class AcmeTagComponent implements NxsTagInputs` — because a host
passes that interface's inputs and the outlet silently drops any your component does not declare.
The shipped guardrail fails an override that does not.

**What overriding does not reach:** a component used **by class** rather than resolved by ID. An
override changes every place that renders the ID through `lib-extension-outlet`, and nothing that
composed `NxsTagComponent` directly. Browse's breadcrumbs, and the type tag and avatar in each row of
`nxs-document-list`, resolve their IDs; other packaged screens do not yet — see
`extension-reference.md` §6a for where they do render.

### Placeable — the slots that render a component by ID

Four slots name a component with `componentId`, so a manifest can put a registered component on
screen with no build: `sidebar`, `tabs`, `documentView` and `routes`. `documentView` also passes
the focused document as a `document` input. Their state and descriptor fields are in
`extension-reference.md` §2, §6, §9, §9a and §11.

```json
{
  "extensions": {
    "slots": { "tabs": [{ "id": "acme.tabs.claims", "componentId": "acme.panel.claims" }] }
  }
}
```

### What the guardrail checks about a component you contribute

`check-extension-library.mjs` (§4) reads a registration written as
`'id': () => import('./x').then((m) => m.X)`, or as `'id': X` with `X` imported by name — aliased
or not — from a relative path. `X` may come through your own `index.ts` re-exports. It reads every
`components: { … }` object in your library, including one whose keys are quoted but which is
not a registration, so give an object like that plain keys. It fails a registration it reads that:

- **does not resolve** — an `import()` path that is not a file in your library, or a class name
  the file does not export. The registry swallows a failed load, so this is otherwise a blank
  slot with no error anywhere;
- **is not a component** — the class has no `@Component` of its own, so the outlet cannot create
  it;
- **no spec names** — by its ID as a string, the key expression it is registered under, or its
  class, each as a whole: a spec that names only `acme.panel.claimsExtra` or
  `AcmeClaimsComponentFake` does not name `acme.panel.claims` or `AcmeClaimsComponent`;
- **uses another prefix's selector** — the selector in that class's own `@Component`, not another
  in the same file, and every selector in a comma-separated list: `'acme-claims, nxs-claims'`
  fails on `nxs-claims`. Yours is `<owner>-` (or `[acmeClaims]` for an attribute, and
  `button[acme-button]` counts); `nxs-`, `lib-`, `app-` and `sat-` belong to the platform and
  collide on an upgrade, as an element, an attribute or a class. A component with no selector is
  allowed;
- **overrides an `nxs.primitives.*` ID without implementing its contract** — the interface
  imported from `@nuxeo-satori/platform/components`, under whatever name you import it, not a
  same-named one of your own — or one that does not exist. The ID may be written as
  `'nxs.primitives.tag'` or as `[NXS_PRIMITIVE_IDS.tag]`, under any name you import that by.

Any other shape — a class declared in the same file, a default or namespace import, a class from
another package (`@nuxeo-satori/platform-extras` is another package) — gets a warning that **none
of these checks ran on it**, and the command still exits 0. So does `components: SOME_CONSTANT`, a
`...spread` inside `components`, and a selector that is not a string literal. Treat each warning
as a failure, or rewrite it in one of the shapes above.

**What it cannot see: whether a contract member is a real Angular input.** The override check
reads your class's `implements` clause. TypeScript accepts the interface from a field that is not
an Angular input — `declare readonly label: InputSignal<string>` — and the outlet then drops that
input as silently as a missing one, with the guardrail green. Telling a real `input()` or
`@Input()` from a lookalike takes Angular's compiler, which a static check does not run, and your
typecheck passes it too, because the contract's members are typed `InputSignal<…>`. What catches
it is a spec that renders the override with the contract's inputs — through
`lib-extension-outlet`, as a host does — and asserts they arrive. The generators do not write that
spec for you (`extensions.spec.ts` asserts the registration), so write one for each override.
