# Architecture boundaries

Nx monorepo: `apps/nuxeo-ui` (shell) and libraries under `libs/`. Path aliases are defined in `tsconfig.base.json`.

## Stack version (authoritative)

The repo targets **Angular 20.3.x** (`@angular/*` and `@angular/build` in the **20.3** line—see root `package.json`). This document describes that stack. It is **not** aligned with Angular 21 APIs or CLI behavior; if you upgrade major versions, revisit routing, builders, and Material/Satori peer ranges.

**Tooling (web vs libraries):**

- **`apps/nuxeo-ui`**: Built and served with the root [`angular.json`](../angular.json) and `ng` CLI (`@angular/build:application`). Nx targets in [`apps/nuxeo-ui/project.json`](../apps/nuxeo-ui/project.json) delegate to `ng build` / `ng serve` / `ng test` (Karma) for compatibility with the current Nx + application-builder setup.
- **Libraries** under `libs/*`: Unit tests use **Vitest** and **Analog** (Angular 20–compatible), not Karma.

The shell uses **Hyland Satori Platform Nav** (`sat-platform-nav-container`, list items, main content with `router-outlet`). Navigation labels and paths are defined in `apps/nuxeo-ui/src/app/platform-nav-items.ts` and stay in the app until another surface needs the same config. With `@hylandsoftware/satori-ui` **0.2.x**, the sidebar product title is whatever Satori renders by default (Figma-specific title may require a newer Satori release or internal customization).

**adf-hx browse POC — removed:** the parallel `/#/browse-adf-hx` and `/#/search-adf-hx` routes and `libs/shared/adf-hx-bridge`, which implemented HxPR API tokens over Nuxeo for them, were removed on 2026-10-14 (NXSAT-635). Browse is one surface, at `/#/browse`; both old paths redirect with their query string intact (`apps/nuxeo-ui/src/app/retired-routes.ts`).

**Auth / Nuxeo (PoC):** Login, session storage, route guards, and the Nuxeo Basic-auth HTTP interceptor currently live under `apps/nuxeo-ui/src/app/auth/` (and related shell config). Per the layer rules below, these concerns are intended to move into **`libs/core`** and be consumed via `@agentic-ui/core` as the implementation hardens.

## Layers

| Layer           | Location           | Responsibility                                                                                                                                                              |
| --------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core**        | `libs/core`        | Nuxeo HTTP client, auth/session, interceptors, guards, app-wide singletons. **Must not** import from `libs/features/*`.                                                     |
| **Shared UI**   | `libs/shared/ui`   | Presentational components, Satori-aligned primitives. **Must not** import features.                                                                                         |
| **Shared util** | `libs/shared/util` | Pure TypeScript helpers, validators. No Angular UI.                                                                                                                         |
| **Features**    | `libs/features/*`  | Smart containers, feature routes (e.g. `lib.routes.ts` exporting a `*Routes` array), feature services. **No imports between features**; use the router or shared contracts. |

## Routing

- Shell routes live in `apps/nuxeo-ui/src/app/app.routes.ts`.
- Each feature exports a `*Routes` array from its public API and is lazy-loaded via `loadChildren` (or `loadComponent` for standalone entry components).
- Router uses `withComponentInputBinding()` in `app.config.ts` for route → component input binding.

**Local Nuxeo:** Dev server proxy for `/nuxeo` → Nuxeo is configured in `apps/nuxeo-ui/proxy.conf.json` and referenced from `angular.json` serve options.

## Nx projects

Run `npx nx graph` to view the dependency graph. Common commands:

- `npx nx serve nuxeo-ui` — dev server
- `npx nx build nuxeo-ui` — production build
- `npx nx test <project>` — unit tests for a library or app

## Import paths

| Alias                                 | Entry                                        |
| ------------------------------------- | -------------------------------------------- |
| `@agentic-ui/core`                    | `libs/core/src/index.ts`                     |
| `@nuxeo-satori/platform/ui`           | `libs/shared/ui/src/index.ts`                |
| `@agentic-ui/shared/util`             | `libs/shared/util/src/index.ts`              |
| `@agentic-ui/feature-browse`          | `libs/features/browse/src/index.ts`          |
| `@agentic-ui/feature-search`          | `libs/features/search/src/index.ts`          |
| `@agentic-ui/feature-document-detail` | `libs/features/document-detail/src/index.ts` |
