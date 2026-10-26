---
name: implement-api-port
description: Retired, kept as a record — the adf-hx bridge and API ports it describes were removed (NXSAT-635, NXSAT-637); do not follow it. Implement one of the twelve adf-hx API ports against Nuxeo REST in the agentic-ui-poc bridge library — pick the port, map the upstream interface, implement over existing nuxeo-client services, register the upstream injection token, add unit tests including error paths, and gate it. Use when asked to implement or wire an adf-hx API port (document, query, upload, version, download, renditions, user, group, move, copy, checkIn, model), to back adf-hx with Nuxeo, or to extend libs/shared/adf-hx-bridge.
---

# Implement an adf-hx API port over Nuxeo

> **Retired — kept as a record.** The surface this skill describes no longer exists:
> `libs/shared/adf-hx-bridge`, its twelve API ports and the POC routes were removed on 2026-10-14
> (NXSAT-635), and the adf-hx packages by NXSAT-637. Do not follow it. Components now read Nuxeo
> through the `nuxeo-client` domain services directly: a new call is
> [`add-nuxeo-api`](../add-nuxeo-api.md), and a new `nxs-` component in
> `libs/shared/satori-components` starts from the `satori-component` generator
> (`AGENTS/00-architecture.md`, "Adding a component").

This is the most repeated task in Beta phase 3 — roughly ten of these. Follow the
same shape every time so the tenth is as cheap as the second.

Context: `AGENTS/11-beta-program.md` sections 3 and 7, `AGENTS/02-nuxeo-apis.md`,
`libs/shared/adf-hx-bridge/ARCHITECTURE.md`.

## The twelve ports

`CHECKIN`, `COPY`, `DOCUMENT`, `DOWNLOAD`, `GROUP`, `MODEL`, `MOVE`, `QUERY`,
`RENDITIONS`, `UPLOAD`, `USER`, `VERSION` — each exposed upstream as an
overridable injection token, aggregated in
`ADF_HX_CONTENT_SERVICES_API_PROVIDERS`.

Implemented today: `DOCUMENT` and `QUERY`, in
`libs/shared/adf-hx-bridge/src/lib/api/`. The rest are the work.

## 1. Read the upstream contract first

Do not infer the interface from its name.

```bash
# the published typings are the contract we must satisfy
node -e "console.log(require.resolve('@alfresco/adf-hx-content-services/package.json'))"
# then read api/index.d.ts and the relevant provider in that package
```

Record: every method, its parameter types, its return type, and which are
optional. A partial implementation must **throw a clear error**, never return
a plausible-looking empty value — silent no-ops are the defect pattern already
present in `NuxeoQueryApi` (unknown query names return empty results).

## 2. Use the upstream token, not a local clone

The bridge currently declares its own `DOCUMENT_API_TOKEN` and `QUERY_API_TOKEN`
in `src/lib/tokens/adf-hx-bridge.tokens.ts`. Those are clones with the same
description string but different identities — Angular resolves by identity, so
they do **not** satisfy adf-hx components.

Import the upstream token and provide against it. Delete the local clone in the
same change; leaving both is how you get two DI graphs that look identical and
behave differently.

## 3. Implement over existing services

Never call `HttpClient` or `fetch` directly. Go through the domain services in
`libs/shared/nuxeo-client/src/lib/services/` — check `AGENTS/01-services.md`
first, because the method you need probably exists. Add to the domain service if
it does not, and update that doc plus `docs/api-integrations.md`.

Register the provider in `src/lib/providers/provide-adf-hx-nuxeo-bridge.ts`.

## 4. Rules specific to this work

- **Do not fabricate values to satisfy a type.** The existing mapper hardcodes
  `sys_effectivePermissions` to full rights for every document; that is the bug
  class to avoid, not a precedent to follow.
- **Honour every parameter you accept.** If the interface takes a sort or an
  offset, either implement it or throw. `NuxeoQueryApi` currently accepts a sort
  and silently discards it.
- **Preserve server totals.** Do not overwrite a result count with the length of
  the page you happen to have fetched.
- **Keep adf-hx types out of our public API.** They may appear inside the bridge
  and in the token registration, never in an exported signature of another
  library.
- **Pin the exact adf-hx version.** Never a range or a dist-tag.

## 5. Tests

One spec per port, in the same folder. Required cases:

- happy path with a realistic Nuxeo payload
- error path — the service rejects, and the port surfaces it rather than swallowing
- explicit assertion that unimplemented methods throw
- any pagination, sorting or filtering parameter is actually applied

The bridge has 11 tests for 2,949 lines. Do not add to that debt.

## 6. Gate and prove it

```bash
npm run beta:gate -- --gates guardrails,lint,test
npm run beta:gate -- --phase phase-3-adf-hx
```

Then extend `scripts/beta-harness/steps/phase-3-adf-hx.mjs` with a step that
exercises the port through the UI and asserts a visible outcome, and run
`npm run beta:evidence -- phase-3-adf-hx`. A port with green unit tests but no
rendered evidence is not finished.

## 7. Update the docs

- `AGENTS/01-services.md` — any new service method signature
- `docs/api-integrations.md` — any new Nuxeo endpoint
- `libs/shared/adf-hx-bridge/ARCHITECTURE.md` — port status table
