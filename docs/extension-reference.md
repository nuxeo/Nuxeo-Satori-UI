# Extension reference — Layer 1

**Status:** current · **Introduced:** Phase 2 (Beta) · **Audience:** customers, partners and their agents

Everything a manifest can address, by ID. An extension point nobody can discover is not an
extension point, so this file is the contract: if an ID is not listed here, do not depend on it.

Related: [`docs/adf-hx-beta-plan.md`](adf-hx-beta-plan.md) ·
[`AGENTS/11-beta-program.md`](../AGENTS/11-beta-program.md)

---

## 1. Read this first

### IDs are a public contract

Every ID below follows `<owner>.<surface>.<name>` — `app.bulkActions.delete`, `app.rules.canWrite`,
`app.navbar.browse`. Use your own owner prefix for anything you contribute (`acme.navbar.contracts`).
Once published, **renaming one of our IDs is a breaking change** and will only happen in a major
version.

### Hiding an action is not a security control

Layer 1 decides what the UI _offers_. It does not decide what the server _allows_. Nuxeo evaluates
the real permission server-side on every operation, so:

- hiding `app.bulkActions.delete` does not stop a user who has `Remove` from deleting via the REST API;
- showing it does not grant anything — the operation still fails with 403 without the permission;
- an **unregistered rule ID evaluates to `true`**, deliberately, so a typo or a manifest written
  against a newer release cannot silently strip working actions out of the UI. The exception is
  the three user rules in section 4, which fail **closed** — an unknown
  `app.rules.hasAdministrationAccess` must not hand every user the Administration
  entry while the shell is still starting up.

Use Nuxeo ACLs for authorisation. Use the manifest for what the interface presents.

### A manifest cannot rebind a packaged action

Hiding is yours to decide; **rebinding is not**. When a manifest entry reuses a packaged ID it
patches that descriptor — `label`, `icon`, `order`, `rule` and the rest all apply — but an `action`
it supplies is **ignored**:

```json
{ "id": "app.toolbar.addToFavorites", "action": "app.toolbar.delete" }
```

That entry changes nothing. Were it honoured, the user would see a star reading "Add to Favorites"
and delete the document, and the server would authorise it, because it really is that user asking.
The rule in the section above — that the server still checks permissions — is what makes hiding
safe, and it is exactly what does **not** make this safe: the user has `Remove`, so the deletion
succeeds. Presentation and behaviour have to stay attached to each other.

To introduce behaviour, add a descriptor under **your own** ID, where the label and the action are
both yours:

```json
{ "id": "acme.toolbar.archive", "label": "Archive", "action": "acme.actions.archive" }
```

Replacing what a packaged ID _does_ is a Layer 2 operation: register a handler under that ID from
your own library (section 14), where the change is in reviewed, versioned code rather than in a
JSON fragment.

### Where the manifest lives, and how it survives upgrade

Layer 0 and Layer 1 are contributed, not edited. A customer ships their own
Marketplace package that contributes `bootstrap` and `manifest` fragments to the
`org.nuxeo.agentic.ui.config` extension point, and the server serves them after our defaults at
`/nuxeo/agentic-ui-config/bootstrap.json` and `manifest.json`. Ordering needs two declarations:
the package's `package.xml` depends on `nuxeo-agentic-ui`, which orders installation, and its
component `<require>`s `org.nuxeo.agentic.ui.config.defaults`, which orders contributions so our
defaults are always registered first. Everything at that path is served without authentication —
put nothing secret in a fragment.

Scaffold that package rather than writing it by hand. In a clone of this repository it needs only
Node 20 — no `npm ci`, no registry token:
`node tools/satori-generators/src/config-package/create.mjs acme-config --owner=acme` writes both
declarations, starter fragments with JSON schemas for your editor, and a `build.mjs` that refuses
what the server would reject — JSON that does not parse, a repeated key, a fragment over 1 MiB or
nested more than 1000 deep, a missing asset — and writes the installable zip:
`node config-packages/acme-config/build.mjs`. Nesting is the one of those limits the server does
not set itself: `ConfigSnapshot` parses with a plain Jackson `ObjectMapper`, so the depth it
accepts is jackson-core's `StreamReadConstraints` default, and a fragment past it is dropped at
`error invalid-json` while the package installs and Nuxeo starts normally (NXSAT-730). The
`config-package` Nx generator writes the same files, byte for byte, where Nx is installed:
`npx nx g ./tools/satori-generators:config-package acme-config --owner=acme` after a full install
of this repository, or `npx nx g @nuxeo/satori-platform:config-package acme-config --owner=acme`
from the published package. Both refuse a package name they cannot honour before writing
anything, and say what it would clash with: a name Satori itself uses — `defaults`, the name of
our own packaged fragments, and `nuxeo-agentic-ui`, the package yours depends on — or a device
name Windows reserves, such as `con` or `nul`, which cannot be a directory there. A package named
`defaults` would otherwise contribute a fragment on the same key as ours and take its place, which
the server reports as a warning — see "Displacing one of our packaged defaults" below.
`config-packages/presales-demo` in this repository is one, with two
demo presets. The `bootstrap.json` that used to be copied and edited beside
the bundle is **removed with no migration**: a file left in `nxserver/nuxeo.war/agentic-ui-config`
is not served.

The application fetches both, anonymously and together, before anything renders, and applies
the fragments in the order the server lists them, our defaults first. A key a later fragment sets
wins over an earlier one. Each fragment's `extensions` block is handled in two stages. First its
`$references` resolve against its own `$layers` only, so one package cannot reach another's named
layers. Then the resolved blocks merge in the same order, and that merge is **not** isolated: slot
entries with the same `id` merge across packages, so a later package can patch a descriptor an
earlier one contributed. Nothing is read from the repository: the Nuxeo Note at
`/default-domain/config/agentic-ui` that once held the manifest is no longer read, by
any request, with **no migration** — re-create its content as a manifest fragment in your package.
Nothing about configuration changes when a user signs in or out.

`AppConfigService.diagnostics()` reports where each half came from (`configuration-service` or
`packaged-default`), the package component behind every fragment, and the server's own
diagnostics — a replacement it rejected, a contribution it removed.

#### Displacing one of our packaged defaults

A later fragment on the same key replaces the earlier one, and that is how you override our
defaults deliberately. But replacing or disabling a fragment **we** packaged usually is not
deliberate — the usual way to arrive is to name your package `defaults`, which makes its fragment
`defaults` too — and the result is that you silently lose the documentation and themes defaults we
ship. So the server distinguishes the two:

| What happened                                            | Code                                                     | Level     |
| -------------------------------------------------------- | -------------------------------------------------------- | --------- |
| Your fragment replaces or disables **another package's** | `replaced` · `removed`                                   | `info`    |
| Your fragment replaces or disables **one of ours**       | `replaced-packaged-default` · `removed-packaged-default` | `warning` |

The warning reaches `server.log` at `WARN` and the served `bootstrap.json` / `manifest.json`
`diagnostics`, and it names the fragment, the component that shipped it and the component that
displaced it. It does not block anything: the contribution still takes effect, because replacement
is a supported operation and you may well have meant it.

If you did not mean it, **rename the fragment** — `name` on the `<fragment>` element in your
component XML, which the `config-package` generator sets from the package name. If you did mean
it, nothing needs doing; the warning is the record that our defaults are no longer in force.

The distinction is drawn on the **bundle** that contributed the displaced fragment, not on its
name, so it holds for anything we package rather than only for the fragments called `defaults`.

The Layer 1 configuration is the `extensions` key of a manifest fragment:

```json
{
  "version": 1,
  "extensions": {
    "$name": "acme-customisation",
    "overrides": { "app.navbar.expiredQueue": { "visible": false } },
    "slots": {
      "navbar": [
        {
          "id": "acme.navbar.contracts",
          "label": "Contracts",
          "path": "/browse/contracts",
          "icon": "folder",
          "order": 35
        }
      ]
    }
  }
}
```

Most examples later in this reference start at `overrides` or `slots`: they show the contents of
this `extensions` key, and in a package's `manifest.json` they go inside it. At the top level of a
fragment those keys are ignored without an error. The JSON schema the generator writes flags them in
your editor; the package build does not.

### Presales presets

A demo server can carry several named configurations and switch between them per browser, without
reinstalling anything. A bootstrap fragment declares them:

```json
{
  "presales": {
    "presetSwitching": true,
    "presets": {
      "acme": {
        "label": "Acme Insurance",
        "bootstrap": { "branding": { "applicationTitle": "Acme Insurance" } },
        "manifest": { "labels": { "nav.item.browse": "Claims" } }
      }
    }
  }
}
```

Open the application with `?preset=acme` — before or after the `#` — and that preset's `bootstrap`
and `manifest` are applied after every package's fragments. The choice is remembered in
`localStorage` (`agentic-ui.preset`) until `?preset=` clears it, and a badge in the header names
the preset in force. **Nothing happens unless a package sets `presetSwitching: true`**: on any
other server the parameter and the stored choice are both ignored, and the diagnostics and the browser console say so. A
later fragment's `presetSwitching` wins, so a customer package can switch it off. A preset name
is up to 64 letters, digits, `.`, `_` and `-`, starting with a letter or digit; a preset whose
name breaks that rule is skipped, and an unknown name is reported and forgotten.

Presets are package content, served anonymously like every fragment. Switching chooses among them
for one browser; it grants nothing and changes nothing on the server.

### Feature toggles

A manifest fragment's top-level `featureToggles` turns a packaged feature on or off by name. A value
that is not `true` or `false` is ignored, and a later fragment's value wins.

```json
{ "version": 1, "featureToggles": { "permissions.externalUsers": false } }
```

| Toggle                      | Default | What it controls                                                                                                                                                                                                                                 |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `permissions.externalUsers` | `true`  | The "Permissions Assigned to External Users" card on a document's Permissions tab, with sharing by email. Web UI's `org.nuxeo.web.ui.permissions.externalUsers`. Turning it off hides the card; shares already made stay in force on the server. |

---

## 2. Slots

A slot is a named, ordered list of descriptors. Thirteen exist for Beta, of which seven
carry packaged entries.

| Slot               | What it addresses                                  | Status in Beta                                                                       |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `navbar`           | Primary platform navigation entries                | **Populated** — packaged entries in section 3                                        |
| `bulk-actions`     | Actions over a multi-document selection            | **Populated** — packaged entries in section 5                                        |
| `sidebar`          | Drawer content behind a navbar entry               | Resolves; **no packaged entries** — see section 6                                    |
| `routes`           | Application routes                                 | Resolves; **no packaged entries** — see section 11                                   |
| `toolbar`          | Document-detail toolbar and overflow menu          | **Populated** — 16 packaged actions, section 8                                       |
| `contextMenu`      | The browse "More actions" menu                     | **Populated** — 4 packaged actions, section 10                                       |
| `rowActions`       | The menu on each row of browse's list              | **Populated** — 5 packaged actions, section 10a                                      |
| `tabs`             | Document-detail tab children                       | **Populated** — 6 packaged tabs, section 9                                           |
| `documentList`     | Document list columns                              | **Populated** — 12 packaged columns, section 7                                       |
| `documentView`     | The View tab body on document detail               | Resolves; **no packaged entries** — see section 9a                                   |
| `documentMetadata` | A type's layout in the document-detail Properties  | Resolves; **no packaged entries** — see section 9c                                   |
| `documentEdit`     | The form of the document-detail Edit dialog        | Resolves; **no packaged entries** — see section 9c                                   |
| `documentCreate`   | The form filling in a new document of a given type | Resolves in the create form, which **no screen opens yet**; no packaged entries — 9c |

Read the three states precisely, because they are different promises:

- **Populated** — packaged descriptors exist, the surface renders from them, and
  your `overrides` and `slots` entries change what a user sees.
- **Resolves** — the host asks the registry for this slot, so a descriptor you
  contribute does take effect, but nothing of ours is registered there.
- **Nothing resolves it** — the id is reserved and the registry accepts entries,
  but no code reads them. Contributing to one of these does nothing today.

`rules` was listed as a slot in an earlier version of this document. It is not
one: rules are registered in `ExtensionRuleRegistry` and are referenced by
descriptors, not contributed as descriptors. A manifest writing `slots.rules` was
silently inert, and the constant has been removed rather than left implying
otherwise. See section 4 for how rules are actually addressed.

Deferred to GA and deliberately absent: `content-metadata-presets`, `badges`,
`userProfileSections`, `search` filters, `create`.

### Slots are additive

Slot IDs are plain strings. There is no enum, union or `switch` on slot identity in the registry, so
a new slot needs no change to the existing ones and no new release of the registry —
`libs/shared/extensions/src/lib/extension-slot-registry.service.spec.ts` proves it by registering a
slot the library has never heard of and showing the existing ones unchanged.

### Fields every descriptor honours

| Field      | Meaning                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | Required. The address. An entry without one is dropped and reported — see §2a.                                                                                                      |
| `order`    | Ascending. Absent sorts as `Number.MAX_SAFE_INTEGER` — after any ordinary number, tied with that value, before `Infinity`. `null` sorts as `0`. Packaged entries are spaced by ten. |
| `disabled` | `true` removes the entry. ACA's semantics: any truthy value does, the string `"false"` too.                                                                                         |
| `rule`     | A rule ID, or a nested rule reference — see section 4.                                                                                                                              |

Action descriptors (`bulk-actions`, and the other action slots when they are
populated) honour four more:

| Field         | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `label`       | Required. Menu text, and the accessible name of an icon-only control.         |
| `icon`        | Icon name understood by the host's icon set.                                  |
| `tooltip`     | Hover text. Falls back to `label`.                                            |
| `enabledRule` | A rule ID. When it denies, the control renders **disabled** rather than gone. |
| `action`      | Registered handler ID. Defaults to the descriptor `id`.                       |

### Per-ID overrides

`extensions.overrides` is keyed by **descriptor ID, never by slot**, so a slot invented after Beta
ships is hideable, reorderable, relabellable and gateable with no schema change.

| Key       | Effect                                                                                |
| --------- | ------------------------------------------------------------------------------------- |
| `visible` | `false` removes the entry.                                                            |
| `order`   | Replaces the packaged order.                                                          |
| `label`   | Replaces the packaged text with a **literal**, in every language. See the note below. |
| `rule`    | Replaces the packaged rule. **`null` clears it**, ungating the entry.                 |

#### Relabelling: two mechanisms, and which one you want

Packaged entries carry both a `label` (the English literal) and a `labelKey` (a translation key).
The renderer prefers the key when it resolves. That gives you two ways to change the text, and
they are not interchangeable.

| You want                    | Set                                         | Result                                                                    |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| One wording, every language | `overrides["app.navbar.collections"].label` | Your literal, verbatim, in all locales. Translation is bypassed entirely. |
| Replace a translation key   | `labels["nav.item.collections"]` (Layer 0)  | Your text wherever that key resolves, the same in every language.         |

The manifest's `labels` map is not keyed by language: `AppTranslateLoader` layers the same map
over every language's catalogue. Per-language wording is not configurable today.

**Setting `label` disables the key for that entry**, deliberately and by design: a manifest
literal is an instruction to show exactly that string, so it must win. If you set both, `label`
wins and your `labels` entry does nothing — that is defined behaviour, not a bug, but it is the
most likely way to confuse yourself.

Your `label` is **never** treated as a translation key. It is rendered as written, so a literal
containing dots — `"v2.0 Archive"` — is safe.

Find an entry's `labelKey` in `PACKAGED_NAV_ITEMS`; they follow `nav.item.<slug>`.

```json
{
  "overrides": {
    "app.navbar.trash": { "visible": false },
    "app.navbar.collections": { "label": "Repository", "order": 5 },
    "app.navbar.administration": { "rule": "app.rules.isAdministrator" }
  }
}
```

---

## 2a. What is refused, and how you hear about it

The manifest is read **tolerantly**: something malformed costs you that slot, that entry, that
override or that one key, never the application. What it must not cost you is the explanation.
Every refusal below names what was refused, the reason and the contribution it came from, in two
places:

- **a signal on `AppExtensionsService`** — `refusedSlotEntries()` for a slot or slot entry,
  `refusedOverrides()` for a per-ID override, `refusedSections()` for a whole `slots` or
  `overrides` map, alongside `missingLayers()` and `invalidRoutes()`. The template application
  renders all five; a fork should too.
- **the browser console**, prefixed `[agentic-ui-extensions]`, **once per load**. This is where
  support looks, because the product application has no diagnostics page.

Three signals rather than one because the three are addressed differently, and a field left empty
on one of them would be worse than a list of its own. A slot refusal names the slot it belongs to.
An override belongs to no slot — `overrides` is keyed by descriptor ID precisely so a slot added
after Beta needs no schema change (§2). A map lost whole has neither a slot nor an ID, because
what went wrong is the key itself.

### In `slots`

| What you wrote                                   | What happens                  | Reported as                                       |
| ------------------------------------------------ | ----------------------------- | ------------------------------------------------- |
| `"documentView": { … }` instead of `[ … ]`       | the **whole slot** is dropped | `a slot must be a list of entries, not an object` |
| a slot named `__proto__`                         | the **whole slot** is dropped | `a slot may not be named "__proto__"`             |
| an entry that is not an object                   | that entry is dropped         | `entry 2 must be an object, not a string`         |
| an entry with no `id`, or a non-string one       | that entry is dropped         | `entry 2 has no string "id"`                      |
| an entry whose `id` is blank or whitespace       | that entry is dropped         | `entry 2 has a blank "id"`                        |
| the same `id` twice **in one slot of one layer** | the two merge into one        | `entry 2 repeats the id "…"`                      |

### In `overrides`

| What you wrote                                     | What happens       | Reported as                                    |
| -------------------------------------------------- | ------------------ | ---------------------------------------------- |
| `"app.navbar.trash": true` instead of `{ … }`      | that override goes | `an override must be an object, not a boolean` |
| `"app.navbar.trash": [ … ]`, or `"x"`, `3`, `null` | that override goes | `an override must be an object, not a list`    |
| an override keyed `__proto__`                      | that override goes | `an override may not be keyed "__proto__"`     |

The one most worth knowing is the first. `{ "overrides": { "app.navbar.trash": true } }` looks
like it should hide the entry; it is not an override at all, and before this was reported it cost
you nothing but silence. What you want is `{ "app.navbar.trash": { "visible": false } }` — the
keys are in §2.

### A whole `slots` or `overrides` map of the wrong shape

Both keys are objects — `slots` keyed by slot ID, `overrides` keyed by descriptor ID. When either
is something else, **every entry under it in that contribution is gone**, and that is reported on
`refusedSections()`:

| What you wrote                                     | What happens                             | Reported as                                                        |
| -------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| `"overrides": [ { "id": "…", "visible": false } ]` | **every override** in that layer is gone | `"overrides" must be an object keyed by descriptor id, not a list` |
| `"slots": "x"`, or `3`, `true`, `null`             | **every slot** in that layer is gone     | `"slots" must be an object keyed by slot id, not a string`         |

The first is the one worth knowing, and it is an easy mistake to make: a `slots` **entry** is a
list, so writing the `overrides` **map** as a list looks consistent. It is not — the map is keyed
by ID, and the ID is the key:

```json
{ "overrides": { "app.navbar.trash": { "visible": false } } }
```

The other keys of that contribution still apply, and so do your other contributions. Only the one
key is lost. An **absent** key is not a refusal, and nor is an empty one: `"overrides": {}` is a
contribution that overrides nothing, which is a perfectly good thing for a generated manifest to
write.

The contribution is named by its `$name` when it declares one, by the `$layers` entry it sits in
when that is where it was written, and by its position in contribution order otherwise
(`contribution 2`). Writing `$name` on your layer is what makes the message say which file to
open, which is most of why `$name` exists.

### What is still silent, and why

Some things have no effect and say nothing. They are listed here rather than left to be
discovered.

**Two leave an override in place that never does anything**, and are deliberate, on the §1
tolerance rule:

- **an unknown key inside an override** — `{ "visibl": false }` is kept and ignored.
- **an override for an ID nothing registers** — `"app.navbr.trash"` is kept and never matches.

Overrides are read before any descriptor registers, and you may legitimately override an ID a
library registers later, or a key a newer release adds — so a warning would fire on manifests that
are correct for the build they were written against. Check an ID against the tables in §3 onward.

**Three lose a layer _name_** — not a map, and not the same as each other:

| What you wrote                                    | What happens                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `"$references": { … }`, or a bare string          | reads as an **empty** list — no layer referenced, none ignored         |
| `"$references": ["brand", 42, "acme"]`            | only the `42` is lost; `brand` and `acme` still apply. **Not** emptied |
| `"$layers": "x"`, or a body that is not an object | that layer is skipped                                                  |

`$ignoreReferenceList` reads exactly as `$references` does, in both of the first two rows.

None of the three is reported, because a name that was never read is a name nothing can go looking
for. A layer that **is** referenced and does not resolve is a different thing and **is** reported,
on `missingLayers()` (§12) — which is where a skipped `$layers` body shows up, once you reference
it.

These are about layer **resolution** rather than configuration, which is why `refusedSections()`
covers only `slots` and `overrides`.

### A repeated `id` across layers is **not** reported, and that is deliberate

Reusing an `id` is the override mechanism, not a mistake:

- a `$references` layer patching an entry an earlier layer declared (§12);
- a `slots` entry reusing a **packaged** `id`, which patches the packaged descriptor — minus its
  `action`, per §1;
- your own extension library re-registering an `id` through `provideSatoriExtensions` (§14).

A diagnostic on any of those would fire on every correctly layered manifest, so none of them says
anything. **The one case that is reported is two entries with the same `id` inside a single slot of
a single layer** — there is no override to express there, because you would have edited the row, so
it is a copy-paste duplicate.

The pair is still merged exactly as before, and the report deliberately **does not say which of the
two rows survives** — nor does this document. That outcome is not a property of the duplicate: it
falls out of where your layers sit in the stack, which of them set the same slot and in what order,
and whether the `id` is one of ours. It is **not specified**, and a manifest should not depend on it.

What is certain is that one of your two rows is gone, so the fix is the same in every case: **give
each entry its own `id`.** If you meant to change an entry you already declared, edit that entry; to
override one of ours, use `overrides` (§2) or declare an `id` of your own.

> The behaviour is pinned by tests in `app-extensions.service.spec.ts` rather than described here,
> after four review rounds each falsified a different attempt to state it as a rule — including
> "the later entry wins", and keying it on whether an array merge ran. If you need to know what a
> specific stack does, read those cases: a sentence short enough for this document has been wrong
> every time.

Entries dropped for an unreachable `path` are reported the same way, on
`invalidRoutes()` — see §11.

---

## 3. `navbar` — the packaged navigation

Registered by `PACKAGED_NAV_ITEMS` in `libs/shared/extensions/src/lib/nav-items.ts`.

| ID                              | Label               | Path                   | Order | Rule                                | Notes    |
| ------------------------------- | ------------------- | ---------------------- | ----- | ----------------------------------- | -------- |
| `app.navbar.knowledgeDiscovery` | Knowledge Discovery | `/knowledge-discovery` | 10    | —                                   | Disabled |
| `app.navbar.dashboard`          | Dashboard           | `/dashboard`           | 20    | —                                   | —        |
| `app.navbar.browse`             | Browse              | `/browse`              | 30    | —                                   | —        |
| `app.navbar.recentlyViewed`     | Recently viewed     | `/recently-viewed`     | 50    | —                                   | —        |
| `app.navbar.search`             | Search filters      | `/search`              | 60    | —                                   | —        |
| `app.navbar.expiredQueue`       | Expired Queue       | `/expired-queue`       | 70    | —                                   | —        |
| `app.navbar.assets`             | Assets              | `/documents`           | 80    | —                                   | —        |
| `app.navbar.tasks`              | Tasks               | `/tasks`               | 90    | —                                   | —        |
| `app.navbar.favorites`          | Favorites           | `/favorites`           | 100   | —                                   | —        |
| `app.navbar.collections`        | Collections         | `/collections`         | 110   | —                                   | —        |
| `app.navbar.personalSpace`      | Personal Space      | `/personal-space`      | 120   | —                                   | —        |
| `app.navbar.clipboard`          | Clipboard           | `/clipboard`           | 130   | —                                   | —        |
| `app.navbar.trash`              | Trash               | `/trash`               | 140   | —                                   | —        |
| `app.navbar.administration`     | Administration      | `/administration`      | 150   | `app.rules.hasAdministrationAccess` | —        |

`app.navbar.browse` is the one browse entry, at `/browse`. The adf-hx proof of concept's entry,
app.navbar.browseAdfHx at `/browse-adf-hx`, is **retired** with its route — written here without
backticks because it is no longer an ID you can address. An `overrides` key naming it changes
nothing. A `navbar` slot entry naming it no longer patches anything, so it is added as an entry of
its own, blank unless it gives a path and a label: delete it. A `labels` entry for its key,
nav.item.browse-adf-hx, no longer reaches any entry: set `nav.item.browse` instead. Old `/#/browse-adf-hx` and `/#/search-adf-hx` links redirect to
`/browse` and `/search` with their query string intact, and a `?path=` folder opens in `/browse`.
Until then `app.navbar.browse` shipped `disabled: true`; a manifest restating it with
`"disabled": false` is now redundant but harmless.

**Hiding an entry hides the navigation, not the route.** `{"visible": false}` and a
denying `rule` both remove the entry from the sidebar; neither removes the route,
and a user with the URL still reaches the page. The page keeps its title when
hidden, because the title falls back to the packaged label — a hidden entry
should not turn the page heading into the product name. Removing access is a
Nuxeo ACL or a route guard, not a manifest edit.

`app.navbar.settings` exists as the settings drawer entry and is rendered by the shell rather than
resolved from the slot; it is listed for ID reservation, not as an extension point.

Adding an entry:

```json
{
  "slots": {
    "navbar": [
      {
        "id": "acme.navbar.contracts",
        "label": "Contracts",
        "path": "/browse/default-domain/contracts",
        "icon": "folder",
        "order": 35,
        "hasDrawer": true
      }
    ]
  }
}
```

`hasDrawer: true` opens the secondary drawer. Its content comes from the `sidebar` slot — see
section 6. Without a registered sidebar component the drawer shows a placeholder, which is a
supported state but not a useful one.

---

## 4. `rules` — the registered predicates

Referenced as a bare string (`"app.rules.canWrite"`) or as an object with parameters
(`{ "type": "core.every", "parameters": [...] }`). `parameters` must be a JSON array; anything
else — `"parameters": "File"` with the brackets forgotten — is read as an empty list rather than
breaking the slot it sits in.

### Document rules

Registered by `DOCUMENT_RULE_EVALUATORS`. These wrap the existing pure predicates in
`libs/shared/nuxeo-client/src/lib/utils/document-permissions.ts` — the permission logic is unchanged.

| ID                               | True when                                                         |
| -------------------------------- | ----------------------------------------------------------------- |
| `app.rules.canWrite`             | The user has `Write` or `WriteProperties` on the focused document |
| `app.rules.canRemove`            | The user has `Remove`                                             |
| `app.rules.canAddChildren`       | The user has `AddChildren`                                        |
| `app.rules.canManagePermissions` | The user has `WriteSecurity` or `Everything`                      |
| `app.rules.canPublish`           | Web UI's `isPublishable`: see below                               |
| `app.rules.hasDocument`          | A document is in focus                                            |
| `app.rules.isType`               | The focused document's type is one of the `parameters`            |
| `app.rules.hasFacet`             | The focused document carries at least one facet in `parameters`   |
| `app.rules.hasFile`              | The focused document holds a main file (`file:content`)           |
| `app.rules.isTrashed`            | The focused document is in the trash                              |
| `app.rules.isNotTrashed`         | A document is in focus and is not in the trash                    |

`app.rules.canPublish` is Nuxeo Web UI's `isPublishable`: the focused document is not a proxy, a
record or in the trash, carries the `Publishable` facet, and the user has `WriteVersion`. It is
true on a version — Web UI publishes a version as it is — and needs no version to exist, because
publishing a live document creates one.

`app.rules.isType` and `app.rules.hasFacet` take the type or facet names as `parameters`, matched
exactly — Nuxeo names are case-sensitive. With no string parameters — or `parameters` that is not
an array — both answer `false`, so a misconfigured entry is hidden rather than shown everywhere.
Nuxeo Web UI offers the same two tests through `nuxeo-filter`'s `type` and `facet`. Show the
Publishing tab only on Case and Claim documents:

```json
{
  "overrides": {
    "app.tabs.publishing": {
      "rule": { "type": "app.rules.isType", "parameters": ["Case", "Claim"] }
    }
  }
}
```

and negate with `core.not`, or combine with `core.every` — `hasFacet("Versionable")` alongside
`isType("Claim")` is an ordinary composite.

**Scope, stated plainly.** "The focused document" means the document open on
`/#/doc/:uid`. That page is the only surface that publishes one, and it clears it
when you navigate away, so all ten answer `false` everywhere else — with one
exception: browse's row menu (section 10a) resolves its own slot with each row's
document in focus, for that slot only. In particular the two
type rules gate document-detail **tabs and toolbar actions**; they cannot vary browse list
columns by type, because a list has no single focused document. An earlier
version of this document described the first five as functional with no caveat
while nothing populated the context at all, so they answered `false` everywhere.
That is fixed; the remaining limit is which surfaces have a focused document.

### Selection rules

| ID                               | True when                            |
| -------------------------------- | ------------------------------------ |
| `app.rules.hasSelection`         | At least one document is selected    |
| `app.rules.hasSingleSelection`   | Exactly one document is selected     |
| `app.rules.hasMultipleSelection` | More than one document is selected   |
| `app.rules.canWriteSelection`    | Every selected document is writable  |
| `app.rules.canRemoveSelection`   | Every selected document is removable |

The first three read the selection **count**, which the shell publishes, so they
are live and `app.bulkActions.compare` uses one of them today.

**Caveat, unchanged:** the last two are still inert. `SelectionService` tracks
IDs, labels and previews — not documents — so there are no permissions to test
and both answer `false`. Populating them would cost a fetch per selected row.
Do not reference those two yet.

### User rules

These three **fail closed**: if one is referenced before it is registered, it
denies rather than permits.

| ID                                  | True when                       |
| ----------------------------------- | ------------------------------- |
| `app.rules.isAdministrator`         | The user is in `administrators` |
| `app.rules.isPowerUser`             | The user is in `powerusers`     |
| `app.rules.hasAdministrationAccess` | Either of the above             |

`rule: null` in an override still clears the gate, so a customer who genuinely
wants an entry ungated has a Layer 1 route to it. Fail-closed is about the
unknown-ID case, not about making the gate un-overridable.

### Surface-state rules

Registered by `SURFACE_RULE_EVALUATORS`. Where the document rules above read the
document, these read what the open surface has published about its own state —
whether the document is already a favourite, whether an operation is in flight.
They exist so that a **toggle** is two addressable descriptors rather than one
descriptor whose label the component rewrites: `app.toolbar.addToFavorites` and
`app.toolbar.removeFromFavorites` are separate ids gated by opposite rules, so a
manifest can relabel, reorder or hide either half and the label it sets is the
label that renders.

| ID                        | True when                                          |
| ------------------------- | -------------------------------------------------- |
| `app.rules.isFavorite`    | The focused document is in the user's favourites   |
| `app.rules.isLocked`      | The focused document is locked                     |
| `app.rules.isSubscribed`  | The user has notifications on the focused document |
| `app.rules.isInClipboard` | The focused document is in the clipboard           |
| `app.rules.hasVersion`    | The focused document has at least one version      |
| `app.rules.isAiEnabled`   | The AI feature flag is on                          |
| `app.rules.isNote`        | The focused document's type is `Note`              |
| `app.rules.isNotBusy`     | None of the named operations is in flight          |

Only the positive form of each is registered. The negative half is an ordinary
composite a manifest can write for itself:
`{ "type": "core.not", "parameters": ["app.rules.isFavorite"] }`.

`app.rules.isNote` is the exception in this table: it reads the focused document, not
something the surface published, and answers exactly as
`{ "type": "app.rules.isType", "parameters": ["Note"] }`. It used to read a `note` flag
that document detail derived from that same document, so its answer is unchanged on every
surface. It stays registered by `SURFACE_RULE_EVALUATORS`.

`app.rules.isNotBusy` takes the operation names as parameters, because an
operation name is data rather than contract:
`{ "type": "app.rules.isNotBusy", "parameters": ["trash"] }`. With no parameters
it is vacuously true. The packaged toolbar uses it as an `enabledRule`, so a
control greys out while its own request is in flight instead of disappearing.

**Same caveat as the document rules.** These describe the surface, not the
server. Nuxeo evaluates the real permission on every operation regardless.

### Composites and constants

| ID           | Semantics                                       |
| ------------ | ----------------------------------------------- |
| `core.every` | All nested rules pass. Empty list is `true`.    |
| `core.some`  | Any nested rule passes. Empty list is `false`.  |
| `core.not`   | True when **every** nested rule is false (NOR). |
| `core.true`  | Always `true`.                                  |
| `core.false` | Always `false`.                                 |

```json
{
  "overrides": {
    "app.navbar.trash": {
      "rule": {
        "type": "core.every",
        "parameters": ["app.rules.isAdministrator", "app.rules.hasDocument"]
      }
    }
  }
}
```

A self-referential or mutually recursive composite is broken rather than allowed to overflow the
stack; the cycle evaluates to `true`.

---

## 5. `bulk-actions` — the packaged actions over a selection

Registered by `PACKAGED_BULK_ACTIONS` in
`libs/shared/extensions/src/lib/packaged-actions.ts`, rendered by the selection
topbar that appears when at least one document is selected.

| ID                                | Label               | Icon            | Order | Enabled when                     |
| --------------------------------- | ------------------- | --------------- | ----- | -------------------------------- |
| `app.bulkActions.downloadZip`     | Download All as Zip | `download`      | 10    | always                           |
| `app.bulkActions.addToCollection` | Add to Collection   | `library_add`   | 20    | always                           |
| `app.bulkActions.compare`         | Compare             | `compare`       | 30    | `app.rules.hasMultipleSelection` |
| `app.bulkActions.addToClipboard`  | Add to Clipboard    | `content_paste` | 40    | always                           |
| `app.bulkActions.publish`         | Publish Document    | `publish`       | 50    | always                           |
| `app.bulkActions.delete`          | Delete selected     | `delete`        | 60    | always                           |

None of them carries a `rule`, deliberately: all six are offered whatever the
user may do with the selection, exactly as they were before they became
descriptors. **Nuxeo decides whether the operation succeeds**, server-side, on
every one of them. Adding `app.rules.canRemoveSelection` to Delete would hide it
from everyone, because that rule is still inert — see section 4.

Adding your own:

```json
{
  "slots": {
    "bulk-actions": [
      { "id": "acme.bulkActions.archive", "label": "Archive", "icon": "inventory_2", "order": 15 }
    ]
  }
}
```

The descriptor decides where and when; a registered handler decides what. A
descriptor with no handler renders and is inert rather than throwing, so a
manifest can be written before the Layer 2 library that backs it ships.

```ts
import { ExtensionActionRegistry } from '@nuxeo/satori-platform/extensions';

inject(ExtensionActionRegistry).register({
  'acme.bulkActions.archive': inject(AcmeArchiveActionService),
});
```

Handlers are objects with an `execute(context)` method — the shape adf-hx uses
for its own `*-action.service` classes. Re-registering one of our IDs replaces
the behaviour without forking, and it stays replaced: the packaged surfaces
register their own handlers in a lower-precedence tier, so yours answers whether
it was registered before or after the page that ships the ID, and navigating away
from that page does not withdraw it.

`register()` returns a registration. A handler that closes over a component must
withdraw it — `registration.unregister()` — when that component is destroyed, or
the registry keeps the destroyed component reachable. Withdrawal is per
registration and never by ID alone, because an ID is shared: yours and ours can
both be registered under `app.toolbar.delete` at once.

Section 14 has the full rules, including why your handler outranks ours whatever the
registration order. Prefer it over this paragraph if the two ever disagree.

---

## 6. `sidebar` — drawer components

Two mechanisms share this name, and the distinction matters.

- The IDs in the table below are **component-registry** IDs, not slot
  descriptors. The drawer resolves them by convention: a nav entry
  `app.navbar.<name>` is served by a registered component `app.sidebar.<name>`.
  That is what a manifest-added nav entry picks up with no further wiring.
- The `sidebar` **slot** is consulted first, and has **no packaged entries**.
  Contribute a descriptor there — `{ "id": "acme.navbar.contracts", "componentId":
"app.sidebar.searchFilters" }` — when you want a nav entry served by a component
  whose ID does not follow the convention.

An earlier version of this document listed the slot as "Implemented" and pointed
at the table below, conflating the two.

Components are referenced by ID and must already be compiled in. Contributing a new one is Layer 2.

| Component ID                           | Renders                                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.sidebar.assets`                   | Asset facet filters                                                                                                                                      |
| `app.sidebar.searchFilters`            | Search filter panel                                                                                                                                      |
| `app.sidebar.trashFilters`             | Trash filter panel                                                                                                                                       |
| `app.page.contracts`                   | A full-page surface, for the `routes` slot                                                                                                               |
| `nxs.components.permissionsPanel`      | Local and inherited permissions in the document-detail, browse and collection Permissions tabs                                                           |
| `nxs.components.adminUsersGroupsPage`  | The users and groups administration screen at `/administration/users-groups`: search, recently created, and create, edit and delete for users and groups |
| `nxs.components.adminUserDetailsPage`  | One user at `/administration/users-groups/user/:userId`: profile, groups, and direct and group permissions                                               |
| `nxs.components.adminGroupDetailsPage` | One group at `/administration/users-groups/group/:groupId`: members, nested groups, and permissions                                                      |

`app.page.contracts` is the first component registered for the **`routes`** slot rather than for a
drawer, and it exists because that slot went live with **no component in the product able to serve
it** — live and unusable, which is the "registered surface with no consumer" failure this programme
has been caught by before. Route to it, and give it a nav entry, entirely from a manifest:

```json
{
  "extensions": {
    "slots": {
      "routes": [{ "id": "app.page.contracts", "path": "contracts" }],
      "navbar": [
        { "id": "acme.navbar.contracts", "label": "Contracts", "path": "/contracts", "order": 15 }
      ]
    }
  }
}
```

Several nav entries may point at one page; `inputs` on the route descriptor is how you vary what it
shows. The component itself must be compiled in — **that** part is Layer 2, once. Everything after
it, including moving the page, renaming it and rule-gating it, is Layer 1 and needs no build.

The packaged nav entries with bespoke drawer markup (browse tree, tasks, clipboard, favorites,
collections, recently viewed, expired queue, personal space, settings, administration) are rendered
directly by the shell and are not addressable as sidebar components in Beta.

By convention a nav item `app.navbar.<name>` is served by `app.sidebar.<name>`. A manifest-added nav
item whose ID follows the convention picks up a registered component with no further wiring.

---

## 6a. `nxs.primitives.*` — Satori if available, Material otherwise

Thirteen component-registry IDs for the primitives. Eleven have a Satori twin; `banner` and
`chipSet` have no Satori wrapper yet, so they stay Material-only. Each resolves to a Material
implementation from `@nuxeo/satori-platform/components`, and all but those two to a Satori-backed
one when `@nuxeo/satori-platform/components-satori` is provided after it. That second entry point is the only
one in the package that imports `@hylandsoftware/satori-ui`, an **optional** peer: without GitHub
Packages access, leave it out and every ID still resolves, on Material.

| Component ID                 | Inputs (all text arrives translated)                                                                                         | Material implementation       | Satori-backed by                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| `nxs.primitives.avatar`      | `initials`, `color`, `size`, `label`                                                                                         | `NxsAvatarComponent`          | `sat-avatar`                                             |
| `nxs.primitives.breadcrumbs` | `items`, `label`                                                                                                             | `NxsBreadcrumbsComponent`     | `sat-breadcrumbs`                                        |
| `nxs.primitives.tag`         | `label`, `color`                                                                                                             | `NxsTagComponent`             | `sat-category-tag`                                       |
| `nxs.primitives.statusTag`   | `label`, `status`, `hideIcon`                                                                                                | `NxsStatusTagComponent`       | `sat-status-tag`                                         |
| `nxs.primitives.richTooltip` | `heading`, `content`, `triggerLabel`, `icon`                                                                                 | `NxsRichTooltipComponent`     | `sat-rich-tooltip`                                       |
| `nxs.primitives.errorState`  | `status`, `heading`, `headingLevel`, `retryable`, `retryHandler`                                                             | `NxsErrorStateComponent`      | `sat-401-error-state` … `sat-500-error-state`            |
| `nxs.primitives.tabs`        | `tabs`, `label`, `selectedIndex`, `body`, `selectHandler`                                                                    | `NxsTabsComponent`            | `sat-navigation-tabs`                                    |
| `nxs.primitives.actionBar`   | `actions`, `label`, `moreLabel`, `actionHandler`                                                                             | `NxsDocumentToolbarComponent` | Satori's action-bar button, `button[satActionBarButton]` |
| `nxs.primitives.card`        | `heading`, `subheading`, `selected`, `selectionLabel`, `selectionHandler`, `openHandler`, `media`, `headerAction`, `actions` | `NxsCardComponent`            | `sat-interactive-card`                                   |
| `nxs.primitives.emptyState`  | `heading`, `headingLevel`, `message`, `icon`, `actions`                                                                      | `NxsEmptyStateComponent`      | `sat-empty-state`                                        |
| `nxs.primitives.upload`      | `label`, `buttonLabel`, `multiple`, `accept`, `disabled`, `filesHandler`                                                     | `NxsDropzoneComponent`        | `sat-upload-field`                                       |
| `nxs.primitives.banner`      | `message`, `tone`, `announce`, `actions`                                                                                     | `NxsBannerComponent`          | — (Material only for now)                                |
| `nxs.primitives.chipSet`     | `items`, `label`, `removeHandler`                                                                                            | `NxsChipSetComponent`         | — (Material only for now)                                |

Both implementations of an ID declare the same inputs (`Nxs…Inputs` in `/components`; a spec in
`/components-satori` compares them), so whoever renders an ID passes the same `componentInputs`
whichever is registered. Registration layers like every other contribution — in provider order,
later wins per ID — so the order is the mechanism:

```ts
providers: [
  provideNxsComponents(), // Material, from @nuxeo/satori-platform/components
  provideNxsSatoriComponents(), // optional: Satori, from @nuxeo/satori-platform/components-satori
  provideSatoriExtensions({ components: { 'nxs.primitives.tag': AcmeTag } }), // yours wins
];
```

A host that shows `nxs-tag-editor` also lists `provideNxsTagWrites()` once in the same providers.
It registers no ID; it keeps the editor's tag changes for as long as the application runs, so
closing the panel that holds the editor mid-change neither cancels nor drops one, and the next
editor for that document shows what Nuxeo stored.

`provideNxsSatoriComponents()` also needs what any Satori host provides: `provideSatori()` for the
theme and icons, and Satori's `sat.*` catalogue in ngx-translate (upstream's
`provideAndConfigureSatoriUITranslations`, or seeded into your own loader). Without the catalogue
the breadcrumbs' landmark and the tooltip's close hint render as raw keys. An override of yours
implements the matching `Nxs…Inputs` interface.

**Callbacks and templates are inputs.** A `lib-extension-outlet` sets inputs and does nothing else:
it projects no content and binds no outputs. So the IDs that need either take it as an input —
`retryHandler` on the error state; `body`, the template every tab's body renders from, and
`selectHandler` on the tabs; `actionHandler` on the action bar; on the card, `openHandler`,
`selectionHandler` and the `media`, `headerAction` and `actions` templates; on the empty state, the
`actions` template; on the upload, `filesHandler`, since its Material implementation reports files
through an output a host using the element can still bind — both are called, so a host never has to
pick. A host using the element instead of the ID may project the empty state's actions
as content, which both implementations also accept. `selectHandler` is called whenever the
selection changes, whoever changed it, but not for the first; `actionHandler` never for a disabled
entry. The Material implementations take the same inputs and keep their outputs
(`selectedIndexChange`, `selected`) for a template that renders them directly.

**What a click on a card does.** Both implementations open the item from the heading and from a
click anywhere on the card that is not on another control, and neither opens it from the checkbox or
from a button you pass in `headerAction` or `actions`. The one difference: on Satori a click on the
few pixels of padding _around_ those controls opens the item, where on Material it does nothing. A
replacement you register decides this for itself.

**Where packaged screens render them.** The screens place no `sat-avatar`, `sat-category-tag` or
`sat-breadcrumbs` of their own: each of those uses is resolved through its ID, so an override of the
ID reaches it. The uses resolved by ID are these:

| Component ID                 | Rendered on                                                                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nxs.primitives.avatar`      | browse (the history tab's users, the info panel's creator and contributor, activity), document detail (activity), the collection page (the history tab's users), the dashboard, `nxs-document-list` |
| `nxs.primitives.tag`         | browse (a trashed child's type), search (a list row's type), document detail (the AI primary category, a publication's version), task detail, trash, `nxs-document-list`                            |
| `nxs.primitives.breadcrumbs` | browse, document detail, the collection page, the tasks page                                                                                                                                        |
| `nxs.primitives.statusTag`   | browse, document detail, the collection page, task detail                                                                                                                                           |
| `nxs.primitives.card`        | browse's and search's card views, one per document; the card shows the type as its subheading                                                                                                       |
| `nxs.primitives.tabs`        | document detail's tab strip (sections 8 and 9)                                                                                                                                                      |
| `nxs.primitives.actionBar`   | document detail's header action row (sections 8 and 9)                                                                                                                                              |

Search shows no avatar, breadcrumb trail or status tag.

Breadcrumb page layout belongs to the screen, not the registered implementation. Browse,
document detail, collections and tasks wrap both the outlet and its fallback in the same layout
container, preserving spacing and compact header typography when the registration changes.
The built-in Material breadcrumb inherits that compact typography in headers; its own component
still owns separators, folding and RTL mirroring. The packaged Satori registration retains the
screens' compact text separators, scoped through the wrapper rather than the outlet's internals.
Custom implementations own their internal separators and may deliberately supply their own typography.

**Not reached by an override yet.** Four library components on document detail draw the built-in
`nxs-avatar` or `nxs-tag` themselves rather than resolving the ID, so an override does not replace
them there: `nxs-comments` (each author's avatar), `nxs-document-history` (each entry's avatar and
lifecycle tag), `nxs-properties-panel` (the creator and contributor avatars, and its state, tag,
coverage and collection tags) and `nxs-tag-editor` (each tag). Nor does an override of the tabs or
the action bar reach any other tab group or action row: browse's and the collection page's tabs are
Material tab groups and their header actions their own markup, the search and trash toolbars are
their own markup, and the metadata editor writes `nxs-tabs` into its template. Nothing in a packaged screen renders
`nxs.primitives.errorState`, `nxs.primitives.richTooltip`, `nxs.primitives.emptyState` or
`nxs.primitives.upload` by ID yet, so an override of those four reaches only a host of yours that
renders them. Browse's create-import dialog writes `<nxs-dropzone>` into its own template, as the
document list and the document history do with the empty state. The empty state in
particular is registered but not yet resolved anywhere we ship: `nxs-document-list` and
`nxs-document-history` write `<nxs-empty-state>` into their own templates, so replacing the ID does
not change what they show. Registering it makes it addressable from a manifest in **your** hosts
today; routing our own screens through it is separate work. Where a host resolves an ID through a
`lib-extension-outlet` with a `componentId`, and in the library's Storybook, the IDs render as
described above.

### `nxs-` components registered for a slot

`provideNxsComponents()` registers each of these under an ID ready for the slot named, and nothing
places them: a manifest entry in that slot does, with `componentId` set to the ID (for `routes`, a
`path`). `npx nx g ./tools/satori-generators:satori-component` adds a row here with the component.

<!-- satori:register:nxs-components — `satori-component` appends a row to the table below -->

| Component ID | Element | For the slot |
| ------------ | ------- | ------------ |

---

## 7. `documentList` — the packaged columns

Twelve columns, registered by the application and resolved by browse. So `overrides` and
`slots` entries here take effect on the rendered list.

**Nine of the twelve ship `hiddenByDefault`.** That is not the same as `disabled`:
a hidden column is still offered in the column picker, so a user can switch it on,
whereas a `disabled` column is dropped from the resolved list and disappears from the
picker too. Collapsing the two would make "hide by default" indistinguishable from
"remove", and a manifest could then only ever delete a column, never pre-fold one.

| ID                                 | Label            | Field             | Order | Sortable | Hidden by default |
| ---------------------------------- | ---------------- | ----------------- | ----- | -------- | ----------------- |
| `app.documentList.title`           | Title            | `title`           | 10    | yes      | no                |
| `app.documentList.type`            | Type             | `type`            | 20    | yes      | yes               |
| `app.documentList.modified`        | Modified         | `modified`        | 30    | yes      | no                |
| `app.documentList.lastContributor` | Last Contributor | `lastContributor` | 40    | yes      | no                |
| `app.documentList.state`           | State            | `state`           | 50    | yes      | yes               |
| `app.documentList.version`         | Version          | `version`         | 60    | no       | yes               |
| `app.documentList.created`         | Created          | `created`         | 70    | yes      | yes               |
| `app.documentList.author`          | Author           | `author`          | 80    | yes      | yes               |
| `app.documentList.nature`          | Nature           | `nature`          | 90    | no       | yes               |
| `app.documentList.coverage`        | Coverage         | `coverage`        | 100   | no       | yes               |
| `app.documentList.subjects`        | Subjects         | `subjects`        | 110   | no       | yes               |
| `app.documentList.flags`           | Flags            | `flags`           | 120   | no       | yes               |

Move a column and rename it, without a rebuild:

```json
{
  "extensions": {
    "overrides": {
      "app.documentList.lastContributor": { "label": "Updated by", "order": 5 },
      "app.documentList.modified": { "visible": false }
    }
  }
}
```

**`overrides` honours exactly four keys: `order`, `label`, `rule`, `visible`.** Anything
else in an override is silently dropped — see `applyOverride` in
`extension-slot-registry.service.ts`. This example previously used
`"hiddenByDefault": false` in an `overrides` block, which does nothing at all: the
column stayed hidden and the manifest looked correct. Corrected 2026-08-25 after it
was run against a live instance.

To change `hiddenByDefault`, `disabled`, `sortable` or `field`, contribute the
descriptor through `slots` instead. Re-stating an id in `slots.documentList` merges
over the packaged descriptor:

```json
{
  "extensions": {
    "slots": {
      "documentList": [
        { "id": "app.documentList.author", "hiddenByDefault": false },
        { "id": "app.documentList.state", "disabled": true }
      ]
    }
  }
}
```

Verified behaviour of those two, in the user's own column picker:

- `disabled` removes the column from the picker entirely, so a stored user preference
  cannot resurrect it.
- `hiddenByDefault` only sets the starting state; the column is still offered,
  unchecked, and a user may switch it on. The preference lives in
  `localStorage.browse_column_settings` as a flat array of `field` keys, and `[]`
  means the user switched everything off.

`order` is spaced by ten so an entry can be inserted between two packaged columns
without restating the list.

## 8. `toolbar` — the packaged document-detail actions

Registered by `PACKAGED_DOCUMENT_TOOLBAR_ACTIONS` in
`libs/shared/extensions/src/lib/packaged-actions.ts`, rendered by the header of
`/#/doc/:uid` through whatever is registered as `nxs.primitives.actionBar` (section 6a): Material's
icon buttons from `provideNxsComponents()`, Satori's action-bar buttons in our app, or a component
of yours. All three receive the same entries. Seventeen descriptors, which is more controls than a customer ever
sees at once: the toggles are mutually exclusive pairs, and every entry is gated.

`overflow: true` puts an entry behind the **More actions** menu; the rest are
icon buttons in the header row. `overflow` is a descriptor field like any other,
so `slots.toolbar` can move a packaged action between the two.

| ID                                | Label                 | Icon                   | Order | Overflow | Shown when                             |
| --------------------------------- | --------------------- | ---------------------- | ----- | -------- | -------------------------------------- |
| `app.toolbar.edit`                | Edit                  | `edit`                 | 10    | no       | not trashed, writable¹ and not a Note  |
| `app.toolbar.editProperties`      | Edit properties       | `edit`                 | 10    | no       | not trashed, writable¹ and a Note      |
| `app.toolbar.addToCollection`     | Add to collection     | `library_add`          | 20    | no       | not trashed                            |
| `app.toolbar.delete`              | Delete                | `delete`               | 30    | no       | not trashed and `app.rules.canRemove`  |
| `app.toolbar.lock`                | Lock                  | `lock_open`            | 40    | no       | not trashed, writable and not locked ¹ |
| `app.toolbar.unlock`              | Unlock                | `lock`                 | 40    | no       | not trashed and locked ¹ ²             |
| `app.toolbar.addToFavorites`      | Add to Favorites      | `star_border`          | 50    | yes      | not trashed and not a favourite        |
| `app.toolbar.removeFromFavorites` | Remove from Favorites | `star`                 | 50    | yes      | not trashed and a favourite            |
| `app.toolbar.share`               | Share                 | `share`                | 60    | yes      | not trashed                            |
| `app.toolbar.publish`             | Publish document      | `publish`              | 70    | yes      | not trashed and `app.rules.canPublish` |
| `app.toolbar.subscribe`           | Notify Me             | `notifications`        | 80    | yes      | not trashed and not subscribed         |
| `app.toolbar.unsubscribe`         | Unsubscribe           | `notifications_active` | 80    | yes      | not trashed and subscribed             |
| `app.toolbar.addToClipboard`      | Add to Clipboard      | `content_paste`        | 90    | yes      | not trashed and not in the clipboard   |
| `app.toolbar.removeFromClipboard` | Remove from Clipboard | `content_paste_off`    | 90    | yes      | not trashed and in the clipboard       |
| `app.toolbar.export`              | Export                | `download`             | 100   | yes      | always                                 |
| `app.toolbar.startProcess`        | Start Process         | `play_circle`          | 110   | yes      | not trashed                            |

¹ For Edit and Edit properties, writable also means **not `Immutable`** — the rule is
`app.rules.canWrite` and `core.not` over `app.rules.hasFacet` with `["Immutable"]`. Nuxeo
marks versions and publications `Immutable`. A version's `permissions` enricher still lists
`Write` while the server refuses to modify it, so `app.rules.canWrite` alone would offer
Edit on a version; Web UI hides Edit on every `Immutable` document.

For Lock and Unlock, neither is offered on a version, an immutable document or the repository root —
`core.not` over `app.rules.hasFacet` `["Immutable"]` and over `app.rules.isType` `["Root"]`, as
Nuxeo Web UI does. Versions carry the `Immutable` facet. The icon shows the document's state,
also as Web UI does: the open padlock while unlocked, the closed one while locked.

² Unlock is shown to anyone who can read a locked document, so every reader can see who holds
the lock — its tooltip reads "Locked by {owner} on {date}" unless a manifest sets `tooltip`. It is
**enabled** only for
`app.rules.canWrite`: Nuxeo's default lock policy takes Write on a locked document away from
everyone but its owner and administrators, so they are the users offered it enabled. With the
policy disabled other Write holders are offered it too, and the server refuses them with a 409.
The server decides either way — this rule only decides what the interface offers.
Moved to the overflow menu with `"overflow": true`, Unlock keeps its tooltip on hover, but a
reader's disabled entry there cannot take keyboard focus — Material menus skip disabled items —
so the owner and date are then reachable by pointer only. Keep it inline where that matters.

`app.toolbar.export` is the one entry with no `rule`, deliberately: it was
outside the trashed-document guard in the markup this replaced, and exporting a
trashed document still works.

The document-specific header controls that are **not** in this table —
attachments, Knowledge Enrichment, the trashed-document restore banner, the
version banner and its Restore button — remain markup. They are conditional on
document shape rather than on user intent, and
extracting them would have changed behaviour rather than made it addressable.

Adding your own works exactly as for `bulk-actions`: a descriptor decides where
and when, a handler registered against the ID decides what, and a descriptor with
no handler renders inert rather than throwing.

```json
{
  "slots": {
    "toolbar": [
      { "id": "acme.toolbar.archive", "label": "Archive", "icon": "inventory_2", "order": 35 }
    ]
  },
  "overrides": {
    "app.toolbar.startProcess": { "visible": false },
    "app.toolbar.share": { "order": 15 }
  }
}
```

Moving `app.toolbar.share` to order 15 reorders it **within the overflow menu**;
`overflow` is what decides which of the two groups it is in.

---

## 9. `tabs` — the packaged document-detail tabs

Registered by `PACKAGED_DOCUMENT_TABS` in
`libs/shared/extensions/src/lib/packaged-tabs.ts`, and drawn by whatever is registered as
`nxs.primitives.tabs` (section 6a) — Material's tab group from `provideNxsComponents()`, Satori's
navigation tabs in our app, or a component of yours — which is handed the tabs and the one template
their bodies render from.

| ID                     | Label       | Icon           | Order | Shown when              |
| ---------------------- | ----------- | -------------- | ----- | ----------------------- |
| `app.tabs.view`        | View        | —              | 10    | always                  |
| `app.tabs.annotations` | Annotations | —              | 20    | always                  |
| `app.tabs.permissions` | Permissions | —              | 30    | always                  |
| `app.tabs.history`     | History     | —              | 40    | always                  |
| `app.tabs.publishing`  | Publishing  | —              | 50    | always                  |
| `app.tabs.aiInsights`  | AI Insights | `auto_awesome` | 60    | `app.rules.isAiEnabled` |

Hiding, reordering and relabelling these is a manifest edit. **Their bodies are
not addressable**, and that asymmetry is deliberate and worth stating: the six
packaged bodies are still markup in the host template, matched by ID. Extracting
a thousand-plus lines of tab body into separately registered components would
have been a rewrite, and the point of this slot is to make the tab strip
addressable without one. There are two exceptions. The body of `app.tabs.view` can be
replaced per document by a `documentView` entry — section 9a. And the local and inherited
half of `app.tabs.permissions` renders the component registered as
`nxs.components.permissionsPanel`, as does the Permissions tab of `/browse`, so re-registering
that ID from your library (section 14) replaces the panel in both; the external-user section
under it stays packaged. The component receives `documentId`, and
`permissionsChanged`, a callback to invoke after any write that may have changed the ACL, so the
host reads the external-user section again. A replacement that does not declare it leaves that
section as it was until the tab reloads. A collection's Permissions tab also passes `offer: 'type'`:
offer only the type's `userVisiblePermissions`, as Web UI does. An input your component does not
declare is not set.

A tab you contribute names a registered component instead, through `componentId`,
and is rendered by the same `ExtensionOutletComponent` the sidebar uses. The
component must already be compiled in — contributing one is Layer 2.

```json
{
  "slots": {
    "tabs": [
      {
        "id": "acme.tabs.claims",
        "label": "Claims",
        "icon": "assignment",
        "order": 15,
        "componentId": "acme.components.claimsPanel"
      }
    ]
  }
}
```

`componentId` defaults to the descriptor `id`, so registering the component under
the tab's own ID is enough. A contributed tab with no registered component
renders an empty body rather than throwing, so the manifest can precede the
library.

---

## 9a. `documentView` — a different View per document type

Resolves, with no packaged entries. The host asks this slot for the body of the
View tab each time the focused document changes, so a Claim can open on a claim
summary while a File keeps the packaged viewer and a Note keeps the note editor.
Nothing of ours is registered here: with no entries, the View tab is exactly what
it was before the slot existed.

| Field         | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `componentId` | Registered component rendering the tab body. Defaults to the descriptor `id`. |
| `rule`        | When it denies for the focused document, the entry is skipped.                |
| `inputs`      | Static values set on the component's declared inputs. Unknown keys ignored.   |

**Which entry wins.** Entries whose rule passes are taken in ascending `order`, and the
first whose component is registered renders. Nothing matching, or nothing registered,
renders the packaged view. A registered component whose lazy loader fails also falls
back to the packaged view rather than leaving the tab blank, so a broken chunk costs the
customer their custom view, not the document. The load is retried when the document is
refetched or another document using the same entry opens — at most twice, so a chunk that
is permanently missing is requested three times in all. The packaged view stays on screen
while a retry is in flight.

**A component that throws while it is drawn** falls back the same way, and one warning is
written to the console naming the component the entry asked for — its `componentId`, which is
the descriptor `id` unless you set it to something else. That covers the mistakes a manifest can
make: a component with a required input the entry's `inputs` does not supply, an input name
spelled wrong, or a view that cannot read a particular document. Until this was contained, such
an entry left the View tab **empty**, with no fallback and nothing said — the throw escaped the
change detection that draws the tab body, so whatever Angular was drawing at that moment was
abandoned (NXSAT-746, which also reported the surrounding tab group disappearing; on the build
the fix landed on, the tab strip survives and only the body is lost).

What is covered, precisely. The host draws your component itself — once when it first puts it on
the page, and again each time it hands it a new document — and those are the passes where a throw
is caught. So a view that cannot be drawn at all falls back, and so does one that draws some
documents and throws on another; the next document is drawn afresh, so a failure on one does not
cost you the view for the rest of the session.

The limit, because Angular has no error boundary: a component that draws successfully and throws
**later**, on a change detection the host did not trigger — when its own asynchronous state
settles, or on a signal it writes to itself — throws on a pass nobody is guarding, and that still
takes the surrounding view with it. A custom view is ordinary Angular code and has to handle its
own failures. What is guaranteed is narrower than "it cannot break the page": it is that the
drawing the host asks for cannot.

One known wrinkle if your view **measures layout or moves focus** in `ngAfterViewInit`. When a
view is drawn as a _recovery_ — the attempt after a failed load or a failed draw of the same slot
— the host may still be hiding the slot at that moment, because it stops hiding it only once the
draw has succeeded. In the View tab that means `display: none`, so a one-shot
`getBoundingClientRect()` reads zero and `focus()` does nothing; the element becomes visible
immediately afterwards, but the hook does not run again. A view that measures in
`afterNextRender`, or watches with a `ResizeObserver`, is unaffected. Tracked as NXSAT-758.

The same containment applies to every slot that names a component, not just this one: the host
shows whatever it falls back to when the slot is empty.

**The document is the host's.** The component receives the focused document on its
`document` input. A manifest `inputs.document` is overwritten, so configuration cannot
make the tab show a different document from the one the toolbar and properties panel act
on. Declare `document` as an `input()` to receive it; a component that does not declare
it is still rendered, and the value is not set.

The natural rule is a type check, with the packaged `app.rules.isType` (section 4). Any
registered rule works, including one your library registers:

```json
{
  "slots": {
    "documentView": [
      {
        "id": "acme.documentView.claim",
        "componentId": "acme.components.claimView",
        "rule": { "type": "app.rules.isType", "parameters": ["Claim"] },
        "order": 10,
        "inputs": { "heading": "Claim summary" }
      }
    ]
  }
}
```

For Notes alone, the packaged `app.rules.isNote` reads the same way:

```json
{
  "slots": {
    "documentView": [
      {
        "id": "acme.documentView.notes",
        "componentId": "acme.components.noteView",
        "rule": "app.rules.isNote"
      }
    ]
  }
}
```

What this slot does **not** do:

- **Only the View tab.** The other tabs, the toolbar and the properties panel are
  unchanged by any `documentView` entry. Which properties the panel shows per type is a
  layout file, section 9b, or a `documentMetadata` entry, section 9c — not this slot.
- **The packaged views are not entries.** Which one renders is decided per document type
  by a single table inside document detail: a Note gets the note editor, and every other
  type — File, Picture, Video, Audio, your own — gets the document viewer, which picks its
  presentation from the content (mime type, picture views, transcoded videos), not the
  type. That packaged view is also the fallback when your entry's component fails to load,
  so a broken Note view falls back to the note editor. A manifest cannot hide or reorder
  the packaged views — only outrank them with an entry of your own. Registering them as
  entries would publish new ids and is a separate decision.
- **Like every slot, it is not a security control.** Whatever your component reads is
  still gated by Nuxeo server-side.

---

## 9b. Per-type layouts — which properties a document type shows

Not a slot and not an ID: a **layout file** per document type and mode, shipped in your
configuration package, as Nuxeo Web UI keeps a layout per type and mode. This build renders three
modes:

- **`metadata`** — the Properties panel on document detail, beneath the packaged rows (title, tags,
  description and the Dublin Core vocabularies) and above Attachments. Read-only.
- **`edit`** — the form of the Edit dialog on document detail, beneath the Dublin Core fields the
  form always has (title, description, nature, subjects, coverage, expires). Saving sends only the
  properties the user changed.
- **`create`** — the same form for a new document of the type. It is built and tested, but **no
  screen opens it yet**: Browse's create dialog keeps its own fields until it moves onto this form
  in a later change.

To replace the whole Properties section or form with a component of your own rather than a list
of fields, use the `documentMetadata`, `documentEdit` and `documentCreate` slots, section 9c.

**With no file, the layout is generated from the type's own schemas,** and, for `metadata` and
`edit`, from those a dynamic facet adds to the document (next paragraph); a document being created
has no facets yet, so `create` reads the type's alone. One section per schema,
fields by name, each value shown by its schema type. Schemas the panel and viewers already
present are left out — `common`, `dublincore`, `uid`, `file`, `files`, `note`, `facetedTag`,
`relatedtext`, `picture`, `image_metadata`, `iptc`, `video`, `audio`, and the `collectionMember`,
`notification` and `thumbnail` schemas Nuxeo's own facets add to a document as it is collected,
subscribed to and given content — so a stock File or Note shows nothing new, a Claim shows its
`claim` schema, and a schema you add to File appears on File. A type never falls back to its
parent type's file, in any mode. Generated `edit` and `create` layouts leave out `blob` fields:
files are added through the attachment and main-file actions, not typed into a form.

**A schema a dynamic facet adds to one document gets a section on that document.** A facet added
after creation (`Document.AddFacet`, or an integration such as HxAI's `Hxai`) brings schemas the
type does not declare, so a File given `ExternalEntity` shows an `externalEntity` section and a
File without it does not. Those sections come after the type's own, in schema-name order, so a
facet never moves the sections every document of the type shows. Each such schema is read once
per session; one that cannot be read is left out, with the reason in the console, and the rest of
the layout still renders.

**A file replaces the generated layout whole.** Only the fields it lists are shown, in its order;
nothing generated is merged in. The type must match exactly.

```json
{
  "version": 1,
  "display": "sections",
  "sections": [
    {
      "id": "summary",
      "label": "Claim summary",
      "fields": [
        "claim:number",
        { "field": "claim:status", "label": "Status" },
        "claim:serviceDate"
      ]
    },
    {
      "id": "amounts",
      "labelKey": "acme.layout.amounts",
      "fields": ["claim:billedAmount", "claim:allowedAmount"]
    }
  ]
}
```

| Key                   | Meaning                                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`             | Required, `1`. Any other value and the file is refused.                                                                                                                                                   |
| `display`             | `"sections"` (default), or `"tabs"` for one tab per section.                                                                                                                                              |
| `sections`            | Required list, may be empty — an empty layout shows nothing.                                                                                                                                              |
| `sections[].id`       | Required, unique; 1 to 64 letters, digits, `.`, `_` or `-`, starting with a letter or digit.                                                                                                              |
| `sections[].label`    | Heading, as a literal. Wins over `labelKey`. A section with neither has no heading (a tab is named from `id`).                                                                                            |
| `sections[].labelKey` | Heading, as a translation key.                                                                                                                                                                            |
| `sections[].fields`   | Required list of `"<prefix>:<field>"`, or `{ "field", "label"?, "labelKey"?, "required"? }`. Top-level fields only, each once per section. May be empty, but a section with no field to show is left out. |
| `fields[].required`   | `true` makes the field required in an `edit` or `create` form, on top of the schema's own constraints. Ignored in `metadata`.                                                                             |

A field neither the type nor the document's facets have, an entry that is not `<prefix>:<field>`, or a field listed twice in
one section is skipped and the rest of the file applies; a file that is refused shows the generated layout instead. Both are logged in
the browser console under `[agentic-ui-layouts]`, and the page never breaks. A schema with no prefix
is addressed by its name, as Nuxeo does: `file:content`. Unknown keys are ignored without a message,
so that a file written for a later version still loads.

**A section left with no field is not shown** — whether it listed none or every field it listed
was skipped. There is no heading with nothing under it, and in `"tabs"` display no tab with
nothing in it, the same way the generated layout leaves out a schema with no fields. A file whose
every section ends up empty therefore shows nothing at all, as an empty `sections` list does.
The skipped fields are still named in the console, so a typo is still reported even where the
section holding it has gone.

A file may name a field of a facet's schema, such as `externalEntity:origin` in a File layout. It
shows on a document that carries the facet; on one that does not, it is skipped and logged as for
any field the document lacks, so expect that message for every such document — and a section
holding only such fields is left out on those documents, rather than showing a dangling heading.
If the facet's schema could not be read, the message says so instead of calling the field absent.

How each value is shown is decided by its schema type — there is no widget name to set:

| Field type                     | Shown as                                                                                                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `string`                       | text                                                                                                                                                                                                      |
| `string` bound to a vocabulary | the entry's label, read for the entries the document holds only, so a vocabulary of any size costs a read per value; `Parent/Child` for an `l10n…` vocabulary, in English as the panel's own Subjects row |
| `string[]` and other lists     | one chip per item (vocabulary items labelled)                                                                                                                                                             |
| `date`                         | a long date, in UTC, so a calendar date is the same day everywhere                                                                                                                                        |
| `long`, `double`               | a number in the user's locale                                                                                                                                                                             |
| `boolean`                      | Yes or No, translated                                                                                                                                                                                     |
| `blob`                         | the file name                                                                                                                                                                                             |
| `complex`, `complex[]`         | its sub-fields, one group per item                                                                                                                                                                        |

In an `edit` or `create` form, the schema type picks the control:

| Field type                         | Control                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `string`                           | a text field                                                                                |
| `string` bound to a vocabulary     | a searchable select; an `l10n…` vocabulary is grouped under its parent entries              |
| `string[]` bound to a vocabulary   | the same select, choosing several, each choice a removable chip                             |
| `string[]` and other scalar lists  | a chip input: type a value, press Enter                                                     |
| `date`                             | a date field with a picker. A typed date is read in the locale's order, which the hint says |
| `long`, `integer`                  | a number field accepting whole numbers                                                      |
| `double`                           | a number field                                                                              |
| `boolean`                          | a checkbox                                                                                  |
| `complex`                          | a labelled group of its sub-fields, each with its own control                               |
| `complex[]`                        | one group per item, with Add and Remove                                                     |
| `blob`, or `complex` nested deeper | shown, not editable                                                                         |

**A `date` field edits a calendar day, and that day is anchored in UTC.** A day picked or typed is
sent as that day at UTC midnight — 6 March 2024 is always `2024-03-06T00:00:00.000Z`, whatever zone
the user is in — and a stored value is read back as the day it names in UTC, so the form opens on
the day that was saved everywhere. This is the same anchoring the view uses (`date` renders in UTC,
above) and the same one Nuxeo itself applies to a day-only write, so one picked day is one stored
value and every surface showing it agrees.

Two consequences worth designing around:

- A `date` property that carries a meaningful time of day is **not** a calendar day, and the form
  does not treat it as one beyond its day: it is shown and edited by day, and written back
  unchanged — time of day included — as long as the day is not altered. Alter the day and the time
  is replaced by UTC midnight.
- A value written by another client at midnight in a local zone (Nuxeo Web UI does this) names the
  previous UTC day when that zone is ahead of UTC, and will be shown and edited as that previous
  day. Nothing records the zone it was written in, so it cannot be recovered.

**Validation before saving.** Save checks the schema's constraints in the browser first: a
required field (`NotNullConstraint`, or `"required": true` in the file), a `PatternConstraint`
(the whole value must match), a `LengthConstraint` and a `NumericIntervalConstraint`, inclusive or
not. Each error is written under its field and tied to it for screen readers; a summary at the top
counts the fields to correct, and focus moves to the first, opening its tab when the layout uses
tabs. Nothing is sent until every field passes. Constraints the form does not check in the browser
— `EnumConstraint`, `DateIntervalConstraint`, membership of a vocabulary — are still enforced by
Nuxeo: when the server refuses a value, its message is shown under the field it names, and the
dialog stays open with the user's input.

**Labels.** A field's `label` is shown verbatim; else its `labelKey` if it translates; else the
key `layout.field.<prefix>:<field>`; else a readable form of the field name (`billedAmount` →
"Billed amount"). Generated section headings look up `layout.schema.<schema>` first. So a manifest
`labels` entry renames a generated label with no layout file at all:

```json
{ "labels": { "layout.field.claim:memberId": "Member ID", "layout.schema.claim": "Claim details" } }
```

**Shipping one.** Put the file in your configuration package's bundle and contribute it from the
component that `<require>`s `org.nuxeo.agentic.ui.config.defaults`:

```xml
<extension target="org.nuxeo.agentic.ui.config" point="configuration">
  <layout type="Claim" mode="metadata" src="agentic-ui-config/layouts/Claim/metadata.layout.json" />
  <layout type="Claim" mode="edit" src="agentic-ui-config/layouts/Claim/edit.layout.json" />
</extension>
```

A later package's file for the same type and mode replaces yours whole; `enabled="false"` removes
the one in force. While developing, `npm run config:dev -- --layout Claim/edit=claim-edit.layout.json`
serves it to `nx serve` the same way. Each mode reads its own file: an `edit` file does not change
the Properties panel, and a type with only a `metadata` file gets a generated `edit` form.

What a layout file does **not** do:

- **Not `view`, and not `create` on screen yet.** The View tab body is the `documentView` slot,
  section 9a; a `create` file is read by the create form, which no screen opens yet. A file for
  any other mode is served but not rendered.
- **Not the packaged rows above it.** Title, tags, description and the Dublin Core vocabularies are
  still the panel's own; a `dc:` field you list appears in your layout as well. In an `edit` or
  `create` form the Dublin Core fields are the form's own, so a `dc:` field you list is shown once,
  in their place.
- **Not new controls.** The schema type picks the control; a file cannot name a widget, and a
  `blob` field it lists is shown, not edited.
- **Folderish types.** Document detail redirects them to Browse, so their Properties panel is never
  shown.
- **Like every configuration, it is not a security control.** A field left out of a layout is still
  returned by the REST API to anyone who may read the document.

---

## 9c. `documentMetadata`, `documentEdit`, `documentCreate` — a component in place of a layout

Each resolves, with no packaged entries. A layout file (section 9b) chooses fields; an entry in
one of these slots puts a component of your own where the layout would render, for the documents
or types its rule admits — when a list of fields cannot say what the type needs, such as a claim
form whose fields depend on each other.

| Slot               | Replaces                                                                                            | The component receives                         |
| ------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `documentMetadata` | the type's layout in the Properties panel. The packaged rows above it stay                          | `document`                                     |
| `documentEdit`     | the whole form in the Edit dialog, Dublin Core fields included. The dialog's title and buttons stay | `document`, `showErrors`, `onChange`           |
| `documentCreate`   | the whole form for a new document of the type. **No screen opens the create form yet** (section 9b) | `type`, `parentPath`, `showErrors`, `onChange` |

The descriptor fields are those of `documentView` (section 9a): `componentId` (defaulting to the
`id`), `rule` and static `inputs`. **Which entry wins** is decided the same way: entries whose rule
passes, in ascending `order`; the first whose component is registered renders; nothing matching,
or nothing registered, renders the layout. A component that is registered but fails to load also
gives way to the layout, so a broken chunk costs the customer their custom form, not the ability
to edit.

**A create's rule reads the type being created.** For `documentCreate` the rule context's
`document` is the new document as far as it is known — its `type`, a `path` inside the target
folder, no `uid`, no properties and no facets — so `app.rules.isType` answers for what is being
created rather than for the folder it goes in.

**The host's values win.** `document`, `type` and `parentPath` are set by the host after your
manifest `inputs`, so configuration cannot point the form at another document or type.

**A form component reports, the host saves.** An `edit` or `create` component does not call Nuxeo.
It calls its `onChange` input with a `DocumentLayoutChange` — `{ properties, valid }` — whenever
its values change, and the host's Save sends `properties` once the last report said `valid: true`;
until a report arrives, the form counts as not valid. For an edit, report only the properties the
user changed; Save closes without a request when there are none. `showErrors` turns `true` when the
user presses Save, which is the moment to show every field's error, and messages the server
returns are shown by the host, above the form. Both types are exported from
`@nuxeo/satori-platform/extensions`:

```ts
import { Component, input } from '@angular/core';
import type { DocumentLayoutChange } from '@nuxeo/satori-platform/extensions';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

@Component({ selector: 'acme-claim-form', templateUrl: './claim-form.html' })
export class ClaimFormComponent {
  readonly document = input<NuxeoDocument | null>(null);
  readonly showErrors = input(false);
  readonly onChange = input<((change: DocumentLayoutChange) => void) | null>(null);
}
```

```json
{
  "slots": {
    "documentEdit": [
      {
        "id": "acme.documentEdit.claim",
        "componentId": "acme.components.claimForm",
        "rule": { "type": "app.rules.isType", "parameters": ["Claim"] }
      }
    ]
  }
}
```

**Why one slot per mode, not one `documentLayout` slot.** Nuxeo Web UI resolves a layout per type
_and_ mode, and a single slot whose entries carry a `mode` field was considered. It was rejected
because the modes do not share a contract: the metadata component is read-only and receives a
document, the edit form receives a document and must report changes, and the create form receives
a type and a folder because there is no document yet — its rule must be judged against the type
being created, which a slot shared with document-scoped modes would get wrong. One slot per mode
also keeps each entry's effect to a single surface, as every other slot does, and leaves
`documentView` (section 9a) as it shipped.

What these slots do **not** do:

- **Not the dialog around the form.** The Edit dialog's title, Save and Cancel are the host's; the
  dialog still opens only where `app.toolbar.edit`'s rule allows it: not in the trash, not
  `Immutable`, not a Note, and Write or WriteProperties on the document (`app.rules.canWrite`).
- **Not a security control.** A field your component does not show is still writable through the
  REST API by anyone with Write, and Nuxeo's own constraints still apply to what you send.

---

## 10. `contextMenu` — the browse "More actions" menu

Registered by `PACKAGED_BROWSE_CONTEXT_MENU` in
`libs/shared/extensions/src/lib/packaged-actions.ts`, rendered by the browse
header. The actions apply to the folder or document currently open.

| ID                            | Label       | Icon                | Order | Shown when     |
| ----------------------------- | ----------- | ------------------- | ----- | -------------- |
| `app.contextMenu.share`       | Share       | `share`             | 10    | always         |
| `app.contextMenu.subscribe`   | Notify Me   | `notifications`     | 20    | not subscribed |
| `app.contextMenu.unsubscribe` | Unsubscribe | `notifications_off` | 20    | subscribed     |
| `app.contextMenu.export`      | Export      | `ios_share`         | 30    | always         |

This menu acts on the folder open. The menu on each row of the list, acting on that row's document,
is a separate slot, `rowActions` — section 10a.

---

## 10a. `rowActions` — the menu on each row of browse's list

Registered by `PACKAGED_ROW_ACTIONS` in `libs/shared/extensions/src/lib/packaged-actions.ts`,
rendered as the "Actions for …" menu at the end of each row of browse's document list.

Each row resolves the slot with **that row's document in focus**, so `rule`, `enabledRule` and the
document rules of section 4 read the row's own permissions and properties, not the folder's. A
row whose entries are all hidden has no menu button.

| ID                        | Label    | Icon                        | Order | Shown when                                |
| ------------------------- | -------- | --------------------------- | ----- | ----------------------------------------- |
| `app.rowActions.download` | Download | `download`                  | 10    | not trashed, holds a file                 |
| `app.rowActions.rename`   | Rename   | `drive_file_rename_outline` | 20    | not trashed, `canWrite`, not `Immutable`¹ |
| `app.rowActions.copyTo`   | Copy to… | `file_copy`                 | 30    | not trashed                               |
| `app.rowActions.moveTo`   | Move to… | `drive_file_move`           | 40    | not trashed, `canRemove`                  |
| `app.rowActions.delete`   | Delete   | `delete`                    | 50    | not trashed, `canRemove`                  |

¹ As Edit in section 8: Nuxeo marks versions and publications `Immutable`, and their
`permissions` enricher still lists `Write` while the server refuses to change them, so a
publication listed in a section offers no Rename.

What each does: **Download** saves the document's main file under its own name. **Rename** opens
`nxs-rename-dialog`, which changes `dc:title` — as Nuxeo Web UI's title edit does, the name in the
path stays. **Copy to…** and **Move to…** open `nxs-folder-picker-dialog` and run `Document.Copy` or
`Document.Move` into the folder chosen; a folder cannot be chosen as its own destination, nor, when
moving, the folder the document is already in. **Delete** asks, then moves the document to the
trash, as the header's Delete does; a collection goes through the collection's own delete.

A collection listed in browse also keeps its **Edit** entry, first in its menu. That entry is not a
slot descriptor, and a manifest cannot hide it.

Add your own entry the same way as to any action slot, with a handler that reads the row from the
context it receives:

```json
{
  "slots": {
    "rowActions": [
      { "id": "acme.rowActions.audit", "label": "Audit trail", "icon": "fact_check", "order": 25 }
    ]
  }
}
```

```ts
inject(ExtensionActionRegistry).register({
  'acme.rowActions.audit': { execute: (context) => openAudit(context.document) },
});
```

As everywhere in this document, hiding an entry is not a permission: Nuxeo checks the copy, the
move, the rename and the delete on the request itself.

---

## 11. `routes` — manifest-contributed routes

Resolves, with no packaged entries: the application's own routes are still
imported directly by `app.routes.ts`, so none of them is addressable by ID. What
this slot does is let a manifest add a route that did not exist at build time,
serving a component registered under Layer 2.

| Field         | Meaning                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| `path`        | Required. Relative router path — see the validation note below this table. |
| `componentId` | Registered component ID. Defaults to the descriptor `id`.                  |
| `inputs`      | Static values bound to the component's inputs via route data.              |

A `path` must be a non-empty string, must not begin with `/`, and must not contain
whitespace, `?` or `#`. An entry failing any of those is dropped and reported on
`AppExtensionsService.invalidRoutes()`, alongside the reason — the rest of the batch
still registers. Angular's own router validation runs only in a development build, so
without this an invalid path threw on a dev server and became a permanently unmatchable
route in production.

```json
{
  "slots": {
    "routes": [
      {
        "id": "acme.routes.reports",
        "path": "reports",
        "componentId": "acme.components.reports",
        "inputs": { "reportSet": "claims" }
      }
    ]
  }
}
```

Contributed routes are appended to the shell's children, so they inherit the
navigation and the authentication guard, and they are re-applied whenever the
manifest changes. A `navbar` entry with `"path": "/reports"` then reaches it.

**A route is not an authorisation boundary.** Adding one exposes a component;
whatever it calls is still gated by Nuxeo server-side, and removing a route does
not protect anything the API would otherwise return.

---

## 12. `$references` — layering your JSON over ours

Semantics are ACA's. The merge is our own copy of `mergeObjects` from `@alfresco/adf-extensions`
9.0.0, pinned case by case to its output, so behaviour matches the upstream documentation, apart
from the `null` and `__proto__` items below, where ACA's merge threw or rewrote a prototype.

- Layers apply in the order `$references` lists them. **Later wins.**
- `$`-prefixed keys are **metadata and do not merge** — `$references` from a referenced layer never
  leaks into the result. They are dropped at the top level and inside any object two layers both
  set; inside a value only one layer sets, they are kept as written.
- Arrays of objects merge **by `id`**, so a layer patches one entry without restating the list.
  Entries with an `id` come first, in the earlier layer's order except that integer-like ids such as
  `"2"` go ahead of the rest, ascending; then the earlier layer's entries without an `id`; then the
  later layer's new entries.
- `"<key>.$replace"` replaces instead of merging. Below the top level — `"rule.$replace"` inside an
  override — it takes effect only where an earlier layer set the same parent, and is otherwise kept
  as a literal key.
- A later scalar does **not** replace an earlier object: a number or boolean is ignored and a
  string is spread into it. A later non-array is appended to an earlier array. Use `.$replace`.
- `null` meeting an object, in either order, takes the later layer's value. ACA's merge threw
  there, which broke every slot; `"rule": null` is how a later layer ungates an entry.
- A `__proto__` key never replaces an object's prototype. The merge skips it wherever it iterates
  an object, and a slot or override id named `__proto__` is dropped when the layer is read; inside a
  value taken whole it stays an ordinary data property.
- `$ignoreReferenceList` drops a layer even when it is referenced.
- A layer that cannot be resolved is reported on `AppExtensionsService.missingLayers()`, not silently
  dropped, and the rest of the stack still applies.
- A malformed slot, slot entry or override **inside** a layer is reported on
  `AppExtensionsService.refusedSlotEntries()` or `refusedOverrides()` and in the console —
  including in a layer you listed in `$ignoreReferenceList`, which is read even though it does not
  apply, so the message names the layer rather than implying it took effect. Patching an entry or
  an override by `id` from a later layer is the point of layering and is never reported. §2a has
  the whole list.
- A layer whose **whole `slots` or `overrides` key** is not an object loses every entry under that
  key, and is reported on `refusedSections()` and in the console, per layer. The layer's other
  keys still apply, and so do the other layers in the stack. A `$layers` body that is not an
  object is skipped instead, and referencing it shows up on `missingLayers()` above.

```json
{
  "extensions": {
    "$references": ["baseline", "acme"],
    "$layers": {
      "baseline": { "overrides": { "app.navbar.trash": { "visible": false } } },
      "acme": { "overrides": { "app.navbar.collections": { "label": "Repository" } } }
    }
  }
}
```

References resolve one level deep. A referenced layer's own `$references` is metadata and is skipped,
so nesting is ignored rather than half-honoured.

---

## 13. What Beta does not yet address

Stated so nobody plans around a capability that is not there.

The first two are a **deliberate Beta boundary**, not an oversight: Layer 1 is additive for
Beta. You can add surfaces and you can hide, reorder or relabel packaged ones. You cannot
replace a shipped route or change what a packaged tab renders, beyond outranking the View tab
body per document through `documentView`. Making either addressable is a
rewrite rather than a refactor, so it is deferred to GA. If you need to replace a shipped page,
that is Layer 2 — see section 14.

- **Tab and toolbar bodies.** The six packaged tab bodies and the document-specific header
  controls listed in section 8 are still markup. The tab strip and the toolbar are addressable;
  what a packaged tab renders is not, except the View tab, which a `documentView` entry can
  replace per document (section 9a).

- **The packaged routes.** `app.routes.ts` imports each feature library's `Routes` array
  directly, so no packaged route carries an ID and none can be moved, guarded or removed from a
  manifest. Section 11 covers what the slot does do — add routes that did not exist at build
  time.

  `toolbar`, `tabs`, `contextMenu`, `bulk-actions` and `documentList` were once in this list and
  are **not** any more: all five are Populated per the table in section 2. This bullet named
  document-list columns for weeks after the consumer landed, which is the kind of stale exclusion
  that gets a working capability left out of a demo. The table in section 2 is the authoritative
  statement of slot state and is gated by `npm run beta:reference`; this prose is not.

- **The two selection permission rules**, for the reason given in section 4.
- **An in-app editor** for configuration. Configuration is the fragments in a configuration
  package (section 1), so a change is a new version of that package, built and installed. On a
  demo server, a preset (section 1) switches between configurations per browser.

- **The Permissions tabs refuse some edits rather than guess.** All three — document detail,
  `/browse` and a collection — use `nxs.components.permissionsPanel`. A collection's tab offers
  the server's list for the type alone — `Read`, `ReadCanCollect`, `ReadWrite` and `Everything` on
  a stock server — as Web UI does. The other two offer the server's list
  for the document type, then `Write`, `ReadVersion`, `WriteVersion`, `AddChildren`,
  `RemoveChildren`, `Remove`, `Version`, `WriteSecurity`, `Unlock`, `SetRetention` and
  `UnsetRetention`, then any other permission the server reports. Nuxeo reports only the
  permissions the user holds, so that last group is every permission the server defines only for a
  user holding `Everything`; a manager with `WriteSecurity` alone is not offered a custom permission
  they do not hold. It writes one
  entry per change, so an entry nobody touched is never written. What it still refuses, before
  writing anything and naming each entry and why: an entry that changed on the server after the
  page loaded, editing a deny (Nuxeo's write operations only grant), an entry with no identifier,
  an entry naming no user or group, a time frame that ends before it starts, and a permission the
  server does not define. Its labels for permissions outside that standard set
  are the Nuxeo identifiers, not translated names.

---

## 14. Registering from your own library (Layer 2)

```ts
import {
  AppExtensionsService,
  ExtensionComponentRegistry,
} from '@nuxeo/satori-platform/extensions';

const extensions = inject(AppExtensionsService);
const components = inject(ExtensionComponentRegistry);

extensions.registerRules({
  'acme.rules.isContract': (context) => context.document?.type === 'AcmeContract',
});

components.register({
  'acme.sidebar.contracts': () => import('./contracts-drawer').then((m) => m.ContractsDrawer),
});

extensions.register('navbar', [
  {
    id: 'acme.navbar.contracts',
    label: 'Contracts',
    path: '/contracts',
    icon: 'folder',
    order: 35,
  },
]);
```

Register from an `APP_INITIALIZER`, not a component constructor. Unregistered rules fail open, so a
late registration means a gated entry is briefly visible.

Re-registering one of our IDs replaces it — that is the supported way to override a packaged rule or
component without forking.

### Replacing what a packaged action does

Section 1 explains why a manifest cannot rebind a packaged action. Here is where you can:

```ts
import { ExtensionActionRegistry } from '@nuxeo/satori-platform/extensions';

const actions = inject(ExtensionActionRegistry);

const registration = actions.register({
  'app.toolbar.delete': { execute: (context) => myArchiveFlow(context.document) },
});
```

`register` puts your handler in the **customer tier**, which always answers ahead of ours — timing
does not matter. That guarantee is deliberate: you register from an `APP_INITIALIZER`, while a
packaged surface registers handlers closing over a live component in `ngOnInit`. Ours is therefore
always the _later_ call, so a single last-wins map would have silently outranked every override you
wrote. `registerPackaged` is the tier we use, and it is only consulted when nobody has overridden
the ID.

`register` returns a registration, and `unregister()` on it withdraws **exactly** the handlers that
call added:

```ts
inject(DestroyRef).onDestroy(() => registration.unregister());
```

It is scoped to the call rather than taking a list of IDs because an ID is shared — we register
`app.toolbar.delete` too, and "withdraw the handlers for these IDs" would have deleted yours the
first time the user navigated away from a document. Withdrawing is only necessary if your handler
closes over something with a lifetime, such as a component instance.
