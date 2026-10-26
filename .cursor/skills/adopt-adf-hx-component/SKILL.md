---
name: adopt-adf-hx-component
description: Retired, kept as a record — adf-hx, the POC route and the bridge it describes were removed (NXSAT-635, NXSAT-637); do not follow it. Replace one hand-written hxp-* component in agentic-ui-poc with the real published adf-hx component — confirm the upstream export, provide the API tokens it needs, swap it behind the POC route, delete the local clone, and prove parity with image evidence. Use when asked to adopt, swap in or migrate to an adf-hx component (document list, document tree, breadcrumb, metadata sidebar, permissions, manage versions, document viewer), or to remove a hand-written hxp-* lookalike.
---

# Adopt a real adf-hx component

> **Retired — kept as a record.** The surface this skill describes no longer exists: the
> `/#/browse-adf-hx` POC route, the adopted upstream components and `libs/shared/adf-hx-bridge` were
> removed on 2026-10-14 (NXSAT-635), and the adf-hx and ADF packages by NXSAT-637. Do not follow
> it. The product's components are now the `nxs-` components in `libs/shared/satori-components`; a
> new one starts from the `satori-component` generator (`AGENTS/00-architecture.md`, "Adding a
> component").

The POC hand-wrote thirteen `hxp-*` components that imitate adf-hx. This skill
replaces one of them with the genuine article. Do **one component per change** —
the failure modes are subtle and batching them makes attribution impossible.

Context: `AGENTS/11-beta-program.md` sections 3 and 7,
`.cursor/rules/adf-hx-browse-poc.mdc`.

## Recommended order

`document-list` first — it is the gating spike that prices the rest. Then
`breadcrumb`, `document-tree`, `metadata-sidebar`, `permissions`,
`manage-versions`, `document-viewer`, `search`.

## 1. Confirm the upstream export exists

Never assume from the source repository — check the **published** package, which
is what we install.

```bash
node -e "console.log(require.resolve('@alfresco/adf-hx-content-services/package.json'))"
# read ui/index.d.ts in that package and find the exported class
```

Verified present in `7.20.0-automate.292`: `HxpDocumentListComponent`,
`HxpDocumentTreeComponent`, `HxpBreadcrumbComponent`,
`HxpMetadataSidebarComponent`, `HxpPropertiesSidebarComponent`,
`ManageVersionsSidebarComponent`, `HxpUiDocumentViewerComponent`, permissions
dialogs and panels, content share and delete components, column management and
search filters — several with companion `*-action.service` classes.

## 2. Expect the ADF stack to come with it

`HxpDocumentListComponent` imports `DataTableComponent`,
`DataColumnListComponent`, `ContextMenuOverlayService` and `provideTranslations`
from `@alfresco/adf-core`, plus `@angular/material`. The published package
declares only `@angular/core` as a peer while importing thirteen packages, so
npm will not warn you. Add every new external to our own pin manifest explicitly.

## 3. Provide what it needs

The component resolves its data through the upstream API tokens. Make sure the
ports it uses are implemented — see [`implement-api-port`](../implement-api-port/SKILL.md) —
and registered against the **upstream** tokens, not the bridge's local clones.

Also required: `provideTranslations` wiring, and `ROOT_DOCUMENT` /
`DEFAULT_REPOSITORY_ID` imported from `@alfresco/adf-hx-content-services/api`
rather than the bridge's local re-declarations.

## 4. Swap behind the POC route

Change `libs/features/browse/src/lib/browse-adf-hx-poc/` to import the upstream
component instead of the local one. Keep the route stable at
`/#/browse-adf-hx` — production `/#/browse` is untouched until parity is agreed.

Then **delete the hand-written component and its barrel export** in the same
change. Two implementations of the same thing is worse than either.

Note the `.cursor/rules/adf-hx-browse-poc.mdc` prohibition on Material in the
POC page: that rule was written for hand-built components. Adopting adf-hx
necessarily brings Material in transitively through adf-core. Update the rule in
the same PR rather than silently violating it.

## 5. Watch for mapping fidelity

This is the real risk, and the reason for the spike. Component inputs are typed
on the HxPR SDK `Document`, and the upstream neutral-type work has not started.
Our mapper approximates several fields — check each one the component actually
renders:

| Mapped field               | Known approximation                                    |
| -------------------------- | ------------------------------------------------------ |
| `sys_effectivePermissions` | hardcoded to full rights for every document            |
| `sys_name`                 | set to the title, not the path segment                 |
| `sys_created`              | falls back to last-modified when absent                |
| `sys_typeLabel`            | raw Nuxeo type string, used as a user-facing label     |
| document state             | read from `dc:nature`, not `ecm:currentLifeCycleState` |

If the component renders a field the mapper fakes, fix the mapper as part of this
change. Shipping a real component fed by fabricated data is worse than the
hand-written one it replaced.

## 6. Prove parity with evidence

Add a step to `scripts/beta-harness/steps/phase-3-adf-hx.mjs` that asserts the
**specific** behaviour, not just that the element rendered:

```js
h.step('Real adf-hx document list renders Nuxeo children');
await h.goTo('/#/browse-adf-hx?path=%2Fdefault-domain%2Fworkspaces');
await h.expectVisible('adf datatable rendered', 'adf-datatable');
await h.expectText('first row is a known folder', 'adf-datatable', 'Workspaces');
await h.screenshot('adf-hx-document-list');
h.expectNoConsoleErrors();
```

Then:

```bash
npm run beta:gate -- --phase phase-3-adf-hx
npm run beta:evidence -- phase-3-adf-hx
```

Capture the equivalent screenshot of the hand-written component **before** you
delete it, so the report shows a genuine before and after.

## 7. Record what you learned

The first adoption prices the remaining ones. Write down in the PR: how long it
took, which ports it needed, which mapper fields had to be fixed, and what broke
unexpectedly. Update the phase 3 estimate in `docs/adf-hx-poc-action-plan.md` if
reality disagreed with it.
