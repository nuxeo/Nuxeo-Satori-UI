# Nuxeo Satori UI

[![CI](https://github.com/nuxeo/Nuxeo-Satori-UI/actions/workflows/ci.yml/badge.svg)](https://github.com/nuxeo/Nuxeo-Satori-UI/actions/workflows/ci.yml)
[![CodeQL](https://github.com/nuxeo/Nuxeo-Satori-UI/actions/workflows/codeql.yml/badge.svg)](https://github.com/nuxeo/Nuxeo-Satori-UI/actions/workflows/codeql.yml)
[![A11y](https://github.com/nuxeo/Nuxeo-Satori-UI/actions/workflows/a11y.yml/badge.svg)](https://github.com/nuxeo/Nuxeo-Satori-UI/actions/workflows/a11y.yml)

A modern web interface for [Nuxeo](https://www.nuxeo.com/) content repositories, delivered as a
Nuxeo Marketplace package. Built with Angular 22 on the Hyland Satori design system, and
customisable by configuration or with your own code.

|                  |                                                                                 |
| ---------------- | ------------------------------------------------------------------------------- |
| **Status**       | Beta                                                                            |
| **Package**      | `nuxeo-agentic-ui` (Nuxeo Marketplace)                                          |
| **Programme**    | Nuxeo Satori                                                                    |
| **Repository**   | `nuxeo/Nuxeo-Satori-UI`                                                         |
| **Requirements** | Node.js `^24.15.0` (see [`.nvmrc`](.nvmrc)), npm 11, a Nuxeo server             |
| **Security**     | [SECURITY.md](SECURITY.md) — report vulnerabilities privately, never via issues |

## Contents

- [Choose your path](#choose-your-path)
- [Features](#features)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Technology stack](#technology-stack)
- [Getting started (contributors)](#getting-started-contributors)
- [Local development stack](#local-development-stack)
- [Common commands](#common-commands)
- [Testing](#testing)
- [Quality gates](#quality-gates)
- [Build and package](#build-and-package)
- [Internationalisation](#internationalisation)
- [CI/CD workflows](#cicd-workflows)
- [Configuration and environment](#configuration-and-environment)
- [Customisation model](#customisation-model)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Security](#security)

## Choose your path

| You want to…                                                        | Go to                                                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Rebrand or rearrange the product (name, logo, colours, menus, tabs) | [CUSTOMISING.md](CUSTOMISING.md) — needs Node.js only, no registry token, no account                 |
| Understand what the product does and does not do                    | [The short version](documentation/20-product/00-the-short-version.md) (five minutes)                 |
| Customise with an AI coding agent                                   | [Prompt library](https://github.com/nuxeo-sandbox/nuxeo-agentic-ui-prompts)                          |
| Work on Satori itself                                               | Continue below, then [Developer getting started](documentation/30-engineering/01-getting-started.md) |
| Install the platform packages in your own project                   | [docs/installing-satori-platform.md](docs/installing-satori-platform.md)                             |

> The commands under [Getting started](#getting-started-contributors) are for people developing
> Satori itself and need credentials a customer has no reason to hold. **Customising Satori does
> not.**

## Features

- **Content management** — browse, search (full text, filters, saved searches), preview, create,
  upload, edit, move, copy, delete, and restore from the trash.
- **Governance** — versions, permissions, history, comments, tags, collections, favourites and
  publishing.
- **Work** — workflow tasks, plus administration of users, groups and vocabularies.
- **Localised** — English, French, German, Japanese, Dutch, Thai and Simplified Chinese.
- **Accessible** — WCAG 2.1 AA is the quality bar, checked in CI.
- **Optional server-side capabilities** — AI features (natural-language search, summaries, tag
  suggestions, chat), Knowledge Discovery and the ARender annotation viewer each need a separate
  server component. Without them those features are unavailable and the rest of the application
  works normally. See [docs/ai-features.md](docs/ai-features.md) and
  [docs/knowledge-discovery.md](docs/knowledge-discovery.md).

## Architecture

An Nx monorepo with strict, lint-enforced layering. Features never import one another.

```text
apps/nuxeo-ui          Application shell: routing, auth, global search
        │ lazy-loads
libs/features/*        Feature libraries: browse, search, document-detail, …
        │ imports from
libs/shared/*          Nuxeo client, Satori components, extensions, AI client, utilities
        │ calls
Nuxeo server           Dev-server proxy locally, same origin in production
```

- UI is built on the `nxs-` components in [`libs/shared/satori-components`](libs/shared/satori-components),
  a wrapper layer over `@hylandsoftware/satori-ui`. Features use the wrappers and never import
  the design system directly.
- Module boundaries are enforced by `@nx/enforce-module-boundaries` rules in
  [`eslint.config.mjs`](eslint.config.mjs); every project carries `scope:` and `type:` tags.
- Full detail: [docs/architecture.md](docs/architecture.md) and
  [AGENTS/00-architecture.md](AGENTS/00-architecture.md).

## Repository layout

| Path                              | Purpose                                                           |
| --------------------------------- | ----------------------------------------------------------------- |
| `apps/nuxeo-ui`                   | The application (shell and top-level routes)                      |
| `apps/nuxeo-ui-e2e`               | End-to-end tests (Playwright)                                     |
| `apps/nuxeo-satori-template`      | Starter application for customer projects                         |
| `libs/features/*`                 | Feature libraries, lazy-loaded                                    |
| `libs/shared/*`                   | Shared libraries: Nuxeo client, components, extensions, AI client |
| `libs/core`                       | Core services                                                     |
| `libs/platform`                   | Publishable platform packages for customers                       |
| `libs/extensions/acme-extensions` | Reference customer extension library                              |
| `libs/integration-tests`          | Integration tests against a live Nuxeo                            |
| `nuxeo-agentic-core`              | Nuxeo server-side module (Maven)                                  |
| `nuxeo-agentic-ui-package`        | Nuxeo Marketplace package (Maven)                                 |
| `scripts/`, `tools/`              | Quality gates, evidence harness, i18n and documentation tooling   |
| `docs/`, `documentation/`         | Engineering records and the structured documentation set          |
| `AGENTS/`, `.cursor/`             | Contracts and playbooks for AI coding agents                      |

## Technology stack

| Area             | Technology                                                                |
| ---------------- | ------------------------------------------------------------------------- |
| Framework        | Angular ~22.2 (standalone components, signals), TypeScript, RxJS          |
| Monorepo         | Nx 23, enforced module boundaries and tags                                |
| UI               | `@hylandsoftware/satori-ui`, Angular Material, in-house `nxs-` components |
| i18n             | `@ngx-translate/core`, Crowdin                                            |
| Unit tests       | Vitest                                                                    |
| E2E and a11y     | Playwright and axe-core (installed on demand, not a tracked dependency)   |
| Quality          | ESLint, Prettier, Husky, lint-staged, SonarCloud, CodeQL                  |
| Server packaging | Java 17+ and Maven 3.9+ (Nuxeo Marketplace package and OSGi bundle)       |
| Local backend    | Nuxeo Server and OpenSearch in Docker; optional ARender and Mailpit       |

The full matrix, with the reason for each choice, is in
[Technology stack](documentation/30-engineering/05-technology-stack.md).

## Getting started (contributors)

### Prerequisites

- **Node.js** `^24.15.0` — `nvm use` reads [`.nvmrc`](.nvmrc). Angular 22 refuses Node 20.
- **Docker**, to run a local Nuxeo server with OpenSearch.
- **`SATORI_GH_READONLY_TOKEN`** — a GitHub token with `read:packages` on the Hyland organisation.
  `@hylandsoftware/satori-ui` is installed from GitHub Packages, so without the token `npm ci`
  fails with `E401`.

### Install and run

```bash
export SATORI_GH_READONLY_TOKEN=<token>
npm ci
```

```bash
export NUXEO_USER=<user> NUXEO_PASS=<password>   # no defaults; see the engineering docs
npm run dev                                       # http://localhost:4200
```

The dev server proxies API calls to Nuxeo on `localhost:8080` through
[`apps/nuxeo-ui/proxy.conf.json`](apps/nuxeo-ui/proxy.conf.json).

> **Always use `npm ci`.** A bare `npm install` on macOS prunes optional platform entries that
> Linux needs, and the committed lockfile then fails to install in CI. See
> [tools and commands](documentation/30-engineering/06-tools-and-commands.md).

A complete walk-through, including starting Nuxeo, is in
[Developer getting started](documentation/30-engineering/01-getting-started.md).

## Local development stack

The application is a client; it needs a running Nuxeo to be useful.

| Component          | How to run                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Nuxeo + OpenSearch | Docker, container `nuxeo`, port 8080. See [docs/opensearch-setup.md](docs/opensearch-setup.md)                                |
| Server-side config | Fragments in [`nuxeo-conf/`](nuxeo-conf)                                                                                      |
| The app            | `npm run dev` serves on `:4200` and proxies `/nuxeo` to `:8080`                                                               |
| ARender (preview)  | `docker compose -f arender-docker-compose.yml --env-file .env.arender up -d` — [docs/arender-setup.md](docs/arender-setup.md) |
| Mailpit (SMTP)     | `docker compose -f mailpit-docker-compose.yml up -d` — captures permission-notification email                                 |

Check the backend is reachable with `npm run beta:backend`.

## Common commands

| Command                                                 | What it does                               |
| ------------------------------------------------------- | ------------------------------------------ |
| `npm run dev`                                           | Serve the app at http://localhost:4200     |
| `npx nx build nuxeo-ui`                                 | Production build                           |
| `npx nx test <project>`                                 | Unit tests for one project (e.g. `browse`) |
| `npm run lint`                                          | Lint every project                         |
| `npm run a11y`                                          | Accessibility scan                         |
| `npx nx graph`                                          | Visualise the project dependency graph     |
| `npm run beta:state`                                    | Programme status, checked against evidence |
| `npm run beta:gate -- --gates lockfile,guardrails,lint` | Fast inner-loop quality gates              |

Every command above runs the same in PowerShell, macOS and Linux terminals.

## Testing

| Level         | Command                    | Notes                                                          |
| ------------- | -------------------------- | -------------------------------------------------------------- |
| Unit          | `npx nx test <project>`    | Vitest. Runs without a backend                                 |
| Integration   | `npm run beta:integration` | Runs against a live Nuxeo; needs `NUXEO_USER` and `NUXEO_PASS` |
| End to end    | `npm run beta:e2e`         | Playwright against the running app                             |
| Accessibility | `npm run a11y`             | axe-core scan; WCAG 2.1 AA is the bar                          |
| Coverage      | `npm run beta:coverage`    | Enforces the coverage target                                   |

Test standards are in [AGENTS/05-test-standards.md](AGENTS/05-test-standards.md).

## Quality gates

`npm run beta:gate` runs the full pipeline: lockfile integrity, guardrails, lint, unit tests,
build and typecheck. Run it before opening a pull request.

```bash
npm run beta:gate -- --phase <phase-id>   # full gate for a phase
```

Two things to know:

- **`test` does not typecheck.** Vitest strips types, so a green test run is not type safety;
  only `build` and `typecheck` catch a `TS` error.
- **A gate is only trusted once seen failing.** Break it on purpose and confirm it goes red.

Details: [Dev harness and gates](documentation/30-engineering/08-dev-harness-and-gates.md) and
[Testing and evidence](documentation/30-engineering/12-testing-and-evidence.md).

## Build and package

Three artifacts ship from this repository:

| Artifact                 | Built by                           | Contains                                                      |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------- |
| Marketplace package      | Maven — `nuxeo-agentic-ui-package` | The built Angular app, the OSGi bundle and the default config |
| `nuxeo-agentic-core`     | Maven                              | Small OSGi module: auth and start-page configuration          |
| `@nuxeo/satori-platform` | `npx nx build platform`            | The npm package customers extend the product with             |

```bash
npx nx build nuxeo-ui --configuration=production   # Angular application
mvn package                                        # Marketplace ZIP (Java 17+, Maven 3.9+)
npx nx build platform                              # dist/libs/platform
```

Deployment, the server-side configuration model, rollback and publishing are covered in
[Deployment and troubleshooting](documentation/30-engineering/13-deployment-and-troubleshooting.md).

## Configuration and environment

| Variable                   | Purpose                                             | Required for         |
| -------------------------- | --------------------------------------------------- | -------------------- |
| `SATORI_GH_READONLY_TOKEN` | GitHub Packages read access for `@hylandsoftware/*` | `npm ci`             |
| `NUXEO_USER`, `NUXEO_PASS` | Credentials for a Nuxeo server; no defaults         | Tests, evidence runs |

Credentials come from the environment only. Never hard-code them or put them in a URL.

## Internationalisation

The UI ships in English, French, German, Japanese, Dutch, Thai and Simplified Chinese. Strings
are managed in Crowdin (see [`crowdin-conf.yml`](crowdin-conf.yml)); push, pull and status run
as GitHub Actions workflows.

```bash
npm run i18n:pseudo    # generate the pseudo-locale
npm run i18n:audit     # find untranslated or truncated strings
```

Plan and current coverage: [docs/i18n-localization-plan.md](docs/i18n-localization-plan.md) and
[docs/i18n-status.md](docs/i18n-status.md).

## CI/CD workflows

| Workflow                                                | Purpose                                        |
| ------------------------------------------------------- | ---------------------------------------------- |
| `ci.yml`                                                | Lint, test, build, typecheck and bundle budget |
| `a11y.yml`                                              | Accessibility scan                             |
| `codeql.yml`, `sonarcloud.yml`, `dependency-review.yml` | Static analysis and dependency review          |
| `build-marketplace.yml`                                 | Builds the Marketplace package                 |
| `release.yml`                                           | Manual release                                 |
| `publish-platform.yml`                                  | Publishes the platform package                 |
| `storybook-pages.yml`                                   | Publishes the component Storybook              |
| `crowdin-push.yaml`, `crowdin-pull.yaml`                | Translation sync                               |

## Customisation model

Every change falls into one of four layers, so customers can upgrade without losing their work:

| Layer | What you change                                                       | Code needed | Rebuild |
| ----- | --------------------------------------------------------------------- | ----------- | ------- |
| 0     | Settings: product name, logo, colours, language, wording              | No          | No      |
| 1     | Arrangement: menu entries, buttons, tabs, columns, order and audience | No          | No      |
| 2     | Your own screens, actions and conditions                              | Yes         | Yes     |
| 3     | Agent harness: instructions, generators and checks for AI agents      | Shipped     | —       |

Your configuration ships as your own Marketplace package that depends on ours; upgrades never
overwrite it. The registered extension IDs are listed in
[docs/extension-reference.md](docs/extension-reference.md).

> Hiding an action in a manifest is not a security control. Server-side Nuxeo permissions still
> gate every operation.

## Troubleshooting

| Symptom                                      | Cause and fix                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm ci` fails with `E401` or `E404`         | `SATORI_GH_READONLY_TOKEN` is missing or lacks `read:packages` on the Hyland organisation            |
| `npm ci` passes locally, fails in CI         | A bare `npm install` pruned Linux-only entries. Restore the lockfile and run `npm run beta:lockfile` |
| Build refuses to start                       | Wrong Node version. Run `nvm use` (Node 24)                                                          |
| Empty lists, or 403 on `/nuxeo/api`          | Nuxeo isn't running on `:8080`, or the session is unauthenticated                                    |
| HTTP 500 from `AI.*` operations              | The AI backend is a separate Nuxeo package that isn't installed. Expected without it                 |
| Rich-format preview fails                    | ARender isn't running. Start its compose stack                                                       |
| Permission emails don't arrive               | No SMTP locally. Start Mailpit                                                                       |
| Config change has no effect under `nx serve` | Run `npm run config:dev` and restart the dev server                                                  |

More rows: [Deployment and troubleshooting](documentation/30-engineering/13-deployment-and-troubleshooting.md).

## Documentation

| Document                                                   | Audience                       |
| ---------------------------------------------------------- | ------------------------------ |
| [documentation/README.md](documentation/README.md)         | Index, by role                 |
| [CUSTOMISING.md](CUSTOMISING.md)                           | Customers                      |
| [docs/architecture.md](docs/architecture.md)               | Engineers                      |
| [docs/developer-guide.md](docs/developer-guide.md)         | Engineers                      |
| [docs/api-integrations.md](docs/api-integrations.md)       | Engineers — Nuxeo API registry |
| [docs/beta-plan.md](docs/beta-plan.md)                     | Plan of record for the Beta    |
| [docs/extension-reference.md](docs/extension-reference.md) | Extension authors              |
| [AGENTS.md](AGENTS.md) and [`AGENTS/`](AGENTS)             | AI coding agents               |
| [CHANGELOG.md](CHANGELOG.md)                               | Everyone                       |

## Contributing

1. Branch from `main` and keep changes focused.
2. Follow the conventions in [AGENTS.md](AGENTS.md): standalone components, `inject()`, signals,
   `takeUntilDestroyed()`, external templates, no cross-feature imports.
3. Run `npm run beta:gate` and make sure it is green.
4. Open a pull request using the [template](.github/PULL_REQUEST_TEMPLATE.md).

## Security

Do not report vulnerabilities through public issues or pull requests. Follow
[SECURITY.md](SECURITY.md).

## Licence

This repository does not currently ship a `LICENSE` file. Confirm terms with Hyland before
redistributing.
