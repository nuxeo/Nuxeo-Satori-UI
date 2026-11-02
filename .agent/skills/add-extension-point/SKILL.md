---
name: add-extension-point
description: Make something in Nuxeo-Satori-UI customer-customisable through the extension manifest rather than hardcoded — register a rule, action, route, nav item, tab or component by ID so a JSON manifest can rewire it without a rebuild. Use when asked to make a feature configurable or extensible, add an extension point, register an evaluator or action, drive navigation or routes from the manifest, or move a hardcoded list into Layer 0 or Layer 1.
---

# Add an extension point

Every hardcoded action list, nav entry and theme value is a future customer
support ticket. This skill converts one of them into something a manifest can
address.

Context: `AGENTS/11-beta-program.md` sections 2 and 7, `.cursor/rules/beta-program.mdc`.
Framework: our own, in `libs/shared/extensions`. It follows ACA's extension model and
reproduces `@alfresco/adf-extensions` 9.0.0's merge and ordering semantics without
importing it, so this work needs no privileged registry access.

## 1. Decide the layer

| If the customer wants to...                                | Layer | Mechanism                               |
| ---------------------------------------------------------- | ----- | --------------------------------------- |
| change a colour, label, icon, or hide an action            | 0     | config value or manifest flag, no build |
| reorder, add or gate an existing action, nav item or route | 1     | manifest referencing a registered ID    |
| add behaviour that does not exist yet                      | 2     | their own library, registered by ID     |

If it is Layer 0 or 1, it must not require a rebuild. That is the whole point —
verify it by changing the manifest and reloading, not by recompiling.

## 2. Give it a stable ID

IDs are a public contract: once a customer references `app.toolbar.delete` in
their manifest, renaming it is a breaking change. Use
`<owner>.<surface>.<name>` — `app.toolbar.delete`, `app.rules.canWrite`,
`app.navbar.browse`.

Choose the ID deliberately and record it in the extension reference doc.

## 3. Register it in code

Rules first — the repository already has the right shape. The pure predicates in
`libs/shared/nuxeo-client/src/lib/utils/document-permissions.ts`
(`canWriteDocument`, `canRemoveDocument`, `canAddChildren`,
`canManageDocumentPermissions`) are `(doc) => boolean` functions called inline
from templates. Registering them by name turns them into manifest-referenceable
evaluators with no logic change.

Components, evaluators and guards are registered by ID at bootstrap. Actions
should follow the upstream `*-action.service` pattern that adf-hx already uses,
rather than a new invention.

## 4. Convert the consumer

Replace the hardcoded markup with a loop over resolved entries. The big ones,
in rough order of value:

- `apps/nuxeo-ui/src/app/platform-nav-items.ts` — already a declarative array;
  turn the `const` into an injected token fed by the manifest.
- `apps/nuxeo-ui/src/app/shell/nav-drawer/nav-drawer.component.ts` — roughly
  fifteen hardcoded path getters around lines 389-459. Until these go, a
  manifest-added nav item renders an empty drawer, which makes the nav array
  pointless.
- `apps/nuxeo-ui/src/app/app.routes.ts` — feature libs already export `Routes`
  arrays, so route injection is one indirection.
- `document-detail.html` — the toolbar, the seven-item overflow menu and five
  hardcoded tabs. Largest single refactor in Layer 1.
- `selection-topbar.component.html` — six fixed buttons, each wired to a named
  `@Output` threaded through the app shell. Adding one bulk action currently
  touches three files across two projects.

## 5. Do not break the default

The shipped default manifest must reproduce today's behaviour exactly. A customer
who changes nothing should see no difference. Prove that with evidence, not
inspection.

## 6. Configuration must survive upgrade

Anything a customer changes cannot live in our package — an upgrade replaces it.
Since NXSAT-312 both halves are fragments the customer's own Marketplace package
contributes to `org.nuxeo.agentic.ui.config`, served after our defaults at
`agentic-ui-config/bootstrap.json` and `manifest.json`, anonymously. Nothing is
edited on the server and nothing is read from the repository.

If your change adds a customer-editable value, state in the PR where it lives and
how it survives an upgrade. If you cannot answer that, the change is not done.

## 7. Prove it without a rebuild

The assertion that matters is that configuration alone changes behaviour:

```js
h.step('Manifest can hide a toolbar action without a rebuild');
await h.goToDoc(docUid); // the toolbar slot renders on document detail
await h.expectVisible('delete action present by default', '[data-action-id="app.toolbar.delete"]');
await h.screenshot('action-visible-default');
// apply the override manifest, reload — no recompilation
await h.check('delete action hidden after override' /* ... */);
await h.screenshot('action-hidden-by-manifest');
```

```bash
npm run beta:gate -- --phase phase-2-registry
npm run beta:evidence -- phase-2-registry
```

## 8. Document the ID

Every registered ID goes in the customer-facing extension reference with its
surface, its rules, and an example manifest snippet. An extension point nobody
can discover is not an extension point.
