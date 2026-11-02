# Nuxeo Agentic UI

A modern web interface for Nuxeo, delivered as a Marketplace package, that you change by configuration or with your own code. You will also see it called **Nuxeo Satori** — the programme name, the title the Marketplace listing shows, and the name of this repository (`nuxeo/Nuxeo-Satori-UI`, renamed from `nuxeo/agentic-ui-poc` on 30 October 2026); the package itself is `nuxeo-agentic-ui`.

> **Not a developer on this repository?** Read [the short version](documentation/20-product/00-the-short-version.md): five minutes on what it does, what it does not, what you can change without code, and how to start. To customise it with an AI coding agent, use the [prompt library](https://github.com/nuxeo-sandbox/nuxeo-agentic-ui-prompts).

The rest of this page is for developers. Nx + **Angular 22** monorepo for Nuxeo Agentic UI, built with AI coding agents. PoC charter: [README.charter.md](README.charter.md). Boundaries and aliases: [docs/architecture.md](docs/architecture.md).

The `nuxeo-ui` app uses a root [`angular.json`](angular.json) for `ng build` / `ng serve` / `ng test` (Karma); Nx targets in [`apps/nuxeo-ui/project.json`](apps/nuxeo-ui/project.json) delegate to the Angular CLI (`nx:run-commands`) to avoid an Nx 22 + Angular application-builder schema bug (`visitor is not a function`). Libraries use **Vitest 4** and **Analog 2.9** (aligned with Angular 21).

## Structure

| Path                            | Nx project         | Role                                                  |
| ------------------------------- | ------------------ | ----------------------------------------------------- |
| `apps/nuxeo-ui`                 | `nuxeo-ui`         | Application shell, top-level routes                   |
| _(separate repo)_               | —                  | AI operations, shipped as a Nuxeo marketplace package |
| `libs/core`                     | `core`             | Nuxeo API, auth, interceptors (to be implemented)     |
| `libs/shared/ui`                | `ui`               | Shared presentational / Satori-oriented UI            |
| `libs/shared/util`              | `shared-util`      | Pure TypeScript utilities                             |
| `libs/features/browse`          | `browse`           | Browse feature (lazy route)                           |
| `libs/features/search`          | `search`           | Search feature (lazy route)                           |
| `libs/features/document-detail` | `document-detail`  | Document detail feature (lazy route)                  |
| `libs/shared/ai-client`         | `shared-ai-client` | Angular AI gateway service + chat state + models      |

## Commands

```bash
npm install
npm run dev                   # http://localhost:4200
npx nx serve nuxeo-ui         # same as above
npx nx build nuxeo-ui
npx nx graph                  # dependency graph
npx nx test <project>         # e.g. core, nuxeo-ui, browse
```

## Docs

- [documentation/README.md](documentation/README.md) — **documentation home**: where to start, by who you are
- [docs/ai-features.md](docs/ai-features.md) — **AI features guide** (NL search, summarization, chat, tagging, anomaly detection, etc.)
- [docs/knowledge-discovery.md](docs/knowledge-discovery.md) — Knowledge Discovery page setup and flow (via Nuxeo CIC connector)
- [docs/developer-guide.md](docs/developer-guide.md) — Coding conventions, project patterns, how-to guides
- [docs/api-integrations.md](docs/api-integrations.md) — **Nuxeo API integration registry** (update when adding new APIs)
- [docs/architecture.md](docs/architecture.md) — Layer boundaries, routing, import aliases
- [docs/mvp-v1.md](docs/mvp-v1.md) — MVP checklist (fill in)
- [docs/adf-hx-beta-plan.md](docs/adf-hx-beta-plan.md) — **plan of record** for the Beta: extensibility layers, phases, timelines, risks (NXENG-615 / NXENG-619)
- [docs/adf-hx-poc-action-plan.md](docs/adf-hx-poc-action-plan.md) — earlier POC action plan (superseded)
- [docs/obstacles-log.md](docs/obstacles-log.md) — PoC friction / human intervention log
