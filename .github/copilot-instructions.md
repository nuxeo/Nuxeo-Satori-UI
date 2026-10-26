# Copilot Code Review Instructions

When reviewing pull requests in this Angular 19 + Nx monorepo, enforce the following conventions.

---

## Architecture

- **Shared code lives in `libs/shared/`**. Feature libs must NOT define their own copies of constants, models, or utilities that already exist in `@nuxeo/satori-platform/nuxeo-client` or `@nuxeo/satori-platform/ui`.
- **`NuxeoApiBase`** is a thin HTTP wrapper. Domain-specific API methods belong in their respective services — never in `NuxeoApiBase` directly.
- **Features never import from other features.** If `libs/features/browse` imports from `libs/features/search`, flag it as an Nx boundary violation. Shared logic belongs in `libs/shared/`.
- If a constant or utility is duplicated across feature libraries, flag it and recommend importing from the shared library.

---

## Security — Block These (PR must not merge with these present)

- **Hardcoded credentials**: Any username, password, API key, or base64-encoded auth string in TypeScript source files. Even as a fallback default (e.g. `?? 'admin:admin'`).
- **Direct `fetch()` to Nuxeo URLs**: Use `NuxeoApiBase` (Angular `HttpClient`). Native `fetch()` bypasses the auth interceptor and sends no `Authorization` header.
- **`<img [src]>` binding to Nuxeo content URLs**: Thumbnails and blobs must be fetched via `DocumentDetailService.fetchThumbnail()` or `fetchBlob()` and displayed as blob URLs. Direct src bindings fail with 401.
- **`URL.createObjectURL()` without `revokeObjectURL()`**: Every blob URL creation must have a corresponding cleanup in `ngOnDestroy`.

---

## Angular / TypeScript

- **No unused imports or injections.** Every `inject()` call must be referenced in the class body.
- **Dependency injection:** Use `inject()` function, not constructor parameters.
- **State management:** Use Angular signals (`signal()`, `computed()`, `effect()`). Do not use `BehaviorSubject` or plain class properties for mutable UI state.
- **Subscriptions:** Every `.subscribe()` call must be preceded by `.pipe(takeUntilDestroyed())`. Flag any subscription without it as a memory leak.
- **Route param handling:** Components that read route params must use `input()` signal with `withComponentInputBinding()`, or subscribe to `ActivatedRoute.paramMap` — never `.snapshot.paramMap` in reusable components.
- **State reset on route change:** When route params change, all component signals and boolean flags (loaded, error, etc.) must be reset before loading new data. Use `effect()` to watch `input()` changes.
- **Error recovery:** `loading` signal must be reset to `false` in the error handler so the user can retry.
- **No inline templates.** All components must use `templateUrl`, never `template`.
- **All components `standalone: true`.** No NgModules allowed.

---

## Templates / Accessibility

- **Never use `<div (click)="...">` for interactive elements.** Use `<button type="button">` or `<a>` instead.
- **Button reset styles:** When styling a `<button>` as a custom card or row, include reset styles: `border: none; background: none; font: inherit; text-align: left; width: 100%`.
- **No `innerHTML` with user content.** Use Angular template binding `{{ }}`.

---

## CSS / Layout

- Flex containers with text truncation (`text-overflow: ellipsis`) must have `flex: 1` and `min-width: 0` on the text element.

---

## General

- No `console.log` in production code (only `console.warn` and `console.error` are acceptable).
- Use strict equality (`===`) everywhere.
- No duplicate imports from the same module.
- No `any` type without justification comment.

---

## AI Features

- All new UI that calls AI must be gated behind `@if (aiFeatureFlagService.aiEnabled())`.
- No direct calls from Angular components to the HAIP API — all AI calls go through `AiGatewayService`, which posts to Nuxeo Automation operations (`/nuxeo/api/v1/automation/AI.*`) provided by a separate marketplace package.
- The feature flag defaults to `true`; users can still explicitly disable AI features from the UI.
- Default-on is acceptable for the Agentic UI PoC because HAIP is configured through Nuxeo/cloud secrets; keep clear opt-out UX and do not hardcode credentials or call HAIP directly.
