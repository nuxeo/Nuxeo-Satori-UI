# Agentic System — File-by-File Guide

**Who is this for:** Any developer (or AI assistant) wanting to understand how the agentic development system works — what each file does, what triggers it, and why it exists.

---

## Table of Contents

1. [The AGENTS/ Directory — The Brain](#1-the-agents-directory--the-brain)
2. [Root Adapter Files — Cross-Tool Context](#2-root-adapter-files--cross-tool-context)
3. [Cursor Rules — IDE-Specific Instructions](#3-cursor-rules--ide-specific-instructions)
4. [Cursor Skills — Reusable Playbooks](#4-cursor-skills--reusable-playbooks)
5. [GitHub PR Template — Consistent PRs](#5-github-pr-template--consistent-prs)
6. [Copilot Instructions — Automated Code Review](#6-copilot-instructions--automated-code-review)
7. [GitHub Actions Workflows — Automated Agents](#7-github-actions-workflows--automated-agents)
8. [Agent Workflow Playbooks — Documentation](#8-agent-workflow-playbooks--documentation)
9. [At a Glance — Trigger Summary](#9-at-a-glance--trigger-summary)

---

## 1. The `AGENTS/` Directory — The Brain

These are plain markdown files. Think of them as a **permanent memory card** that any AI reads before starting work. They never run automatically — they are passively read by whichever AI assistant is being used.

### Why they exist

Before this system, every Cursor session started cold. The AI had to rediscover the architecture, service file locations, API patterns, and coding conventions from scratch on every task. This caused repeated mistakes, inconsistent patterns, and wasted time re-prompting.

The `AGENTS/` files solve this by giving every AI tool — regardless of brand — a single, always-accurate knowledge base to work from.

---

### `AGENTS.md` (root)

|                      |                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------ |
| **What it contains** | One-page summary: architecture diagram, service map, where things live, definition of done |
| **Who reads it**     | Every AI tool at the start of every session                                                |
| **Triggered by**     | The tool-specific adapters (Cursor rule, CLAUDE.md, .windsurfrules)                        |
| **Updated when**     | Any architectural change, new service added, new feature module added                      |

This is the single entry point. Every tool adapter points here first.

---

### `AGENTS/00-architecture.md`

|                         |                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **What it contains**    | The 4-layer system (App Shell → Features → Shared → Nuxeo), Nx boundary rules, directory map, routing table, auth flow |
| **When an AI reads it** | Any task involving folder structure, routing, or inter-layer dependencies                                              |
| **Key rule enforced**   | Features never import from other features — shared logic goes in `libs/shared/`                                        |

---

### `AGENTS/01-services.md`

|                         |                                                                            |
| ----------------------- | -------------------------------------------------------------------------- |
| **What it contains**    | Every public method on all 23 services with TypeScript signatures          |
| **When an AI reads it** | Before calling or adding a Nuxeo API — to check if a method already exists |
| **Key benefit**         | Prevents duplicate service methods from being created                      |

---

### `AGENTS/02-nuxeo-apis.md`

|                         |                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| **What it contains**    | Every REST endpoint, Automation operation, NXQL query pattern, document properties, enricher headers |
| **When an AI reads it** | When writing a new API call or debugging a 404/401                                                   |
| **Key benefit**         | AI writes correct API calls without guessing endpoint paths                                          |

---

### `AGENTS/03-angular-conventions.md`

|                         |                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **What it contains**    | How to write Angular code in this repo: `signal()`, `inject()`, `takeUntilDestroyed()`, blob URL lifecycle, template patterns |
| **When an AI reads it** | Every code-writing session                                                                                                    |
| **Key benefit**         | All AI-generated code matches the existing codebase style — no mixed patterns                                                 |

---

### `AGENTS/04-feature-scaffold.md`

|                         |                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| **What it contains**    | Exact steps to create a new feature module or dialog — folder structure, file templates, routing wiring |
| **When an AI reads it** | When building a new page or feature from scratch                                                        |
| **Key benefit**         | New features are always structured consistently                                                         |

---

### `AGENTS/05-test-standards.md`

|                         |                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------- |
| **What it contains**    | Test templates for services and components, coverage requirements, how to run tests |
| **When an AI reads it** | When writing unit tests                                                             |
| **Key benefit**         | Tests always cover happy path, error path, and correct HTTP method/URL              |

---

### `AGENTS/06-git-workflow.md`

|                         |                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| **What it contains**    | Branch naming convention, Conventional Commit format, how to create a PR, how to link a JIRA ticket |
| **When an AI reads it** | Before committing or pushing                                                                        |
| **Key benefit**         | Every commit and branch follows the same standard — consistent git history                          |

---

### `AGENTS/07-security.md`

|                         |                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **What it contains**    | Security rules: no hardcoded credentials, no direct `fetch()` to Nuxeo, no `<img [src]>` to Nuxeo URLs, mandatory blob URL cleanup |
| **When an AI reads it** | Every code-writing session (`alwaysApply: true` in the Cursor rule)                                                                |
| **Key benefit**         | Security violations are caught at generation time, not at PR review                                                                |

---

### `AGENTS/08-bug-patterns.md`

|                         |                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| **What it contains**    | 10 known anti-patterns found in this codebase, each with a BAD example and a GOOD fix           |
| **When an AI reads it** | Before committing any file — passive scan                                                       |
| **Key benefit**         | Bugs that were previously caught in code review are now prevented before the PR is even created |

The 10 patterns covered:

1. Observable subscription without `takeUntilDestroyed()` (memory leak)
2. Blob URL never revoked (memory leak)
3. Direct `<img [src]>` to Nuxeo URL (auth failure)
4. State not reset on route change (stale data)
5. Loading flag not reset on error (user can't retry)
6. `fetch()` instead of `HttpClient` (auth failure)
7. Hardcoded credentials (security)
8. Cross-feature import (Nx boundary violation)
9. Constructor injection instead of `inject()`
10. Inline template instead of `templateUrl`

---

### `AGENTS/09-pr-feedback.md`

|                         |                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| **What it contains**    | How to fetch GitHub PR review comments via `gh` CLI, a comment→fix mapping table, how to reply to comments |
| **When an AI reads it** | When asked to "fix PR comments"                                                                            |
| **Key benefit**         | Turns multi-step manual PR feedback process into a single developer prompt                                 |

---

### `AGENTS/10-ai-features.md`

|                         |                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| **What it contains**    | All AI backend routes, HAIP configuration, the feature flag system, how to add a new AI endpoint    |
| **When an AI reads it** | Any task involving the AI backend or AI features in the UI                                          |
| **Key benefit**         | AI assistant knows the AI feature flag is on by default, still gated, and user opt-out is respected |

---

## 2. Root Adapter Files — Cross-Tool Context

The `AGENTS/` files contain the knowledge. These adapter files tell each specific tool where to find it.

---

### `CLAUDE.md`

|                       |                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------- |
| **Read by**           | Claude Code (Anthropic's terminal-based AI tool)                                       |
| **When**              | Automatically at the start of every Claude Code session                                |
| **What it does**      | Instructs Claude to read `AGENTS.md` and the `AGENTS/` folder before starting any task |
| **No setup required** | Claude Code reads `CLAUDE.md` in the root of the repository automatically              |

---

### `.windsurfrules`

|                       |                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------- |
| **Read by**           | Windsurf IDE                                                                              |
| **When**              | Automatically when the workspace is opened in Windsurf                                    |
| **What it does**      | Points to `AGENTS/`, lists non-negotiable conventions as plain text for immediate context |
| **No setup required** | Windsurf reads `.windsurfrules` from the repo root automatically                          |

---

### `scripts/agent-context.sh`

|                  |                                                                           |
| ---------------- | ------------------------------------------------------------------------- |
| **Run by**       | A developer using any other LLM tool (e.g., a terminal CLI tool)          |
| **When**         | Manually, before starting a task                                          |
| **What it does** | Concatenates all `AGENTS/` files into one text block and prints to stdout |
| **Usage**        | `./scripts/agent-context.sh \| <any-llm-cli>` or save to file and paste   |

This is the fallback for tools that do not auto-read project files.

---

### JetBrains AI Assistant (no file needed)

JetBrains AI does not auto-read project files. The workflow is documented in `AGENTS.md` itself:

> Type `@AGENTS.md` at the start of every JetBrains AI session to load context manually.

---

## 3. Cursor Rules — IDE-Specific Instructions

These files live in `.cursor/rules/` and are read by Cursor automatically based on their configuration.

---

### `00-master-context.mdc`

|                      |                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**          | `alwaysApply: true` — fires at the start of **every single Cursor session**                                                                                   |
| **What it does**     | Forces Cursor to read `AGENTS.md` before any task                                                                                                             |
| **JIRA integration** | If a ticket ID is provided (e.g. "NCO-1234"), instructs Cursor to fetch the story via the Atlassian MCP and use the Acceptance Criteria as the technical spec |

This is the most important rule. Without it, every session would start cold.

---

### `security.mdc`

|                  |                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Trigger**      | `alwaysApply: true` — fires on every `*.ts` file                                                                                                                         |
| **What it does** | Enforces security rules at the moment of code generation — no hardcoded credentials, no `fetch()` to Nuxeo, no direct `<img [src]>` bindings, mandatory blob URL cleanup |
| **Effect**       | Security violations are prevented before they are written, not caught in review                                                                                          |

---

### `nuxeo-api-patterns.mdc`

|                  |                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Trigger**      | Auto-applied to files in `libs/shared/nuxeo-client/**`                                                                         |
| **What it does** | Shows Cursor exactly how to write a new service method — inject `NuxeoApiBase`, use `api.get()`, update docs and AGENTS/ after |

---

### `feature-module-scaffold.mdc`

|                  |                                                                             |
| ---------------- | --------------------------------------------------------------------------- |
| **Trigger**      | Auto-applied to files in `libs/features/**`                                 |
| **What it does** | Enforces the exact folder structure for new feature modules — no deviations |

---

### `test-generation.mdc`

|                  |                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------- |
| **Trigger**      | Applied to `*.spec.ts` files                                                                  |
| **What it does** | Provides test templates and reminds Cursor to cover happy path, error path, and loading state |

---

### `git-workflow.mdc`

|                  |                                                                           |
| ---------------- | ------------------------------------------------------------------------- |
| **Trigger**      | Applied on demand when git operations are needed                          |
| **What it does** | Enforces branch naming, Conventional Commit format, and PR creation steps |

---

### `bug-patterns.mdc`

|                  |                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------- |
| **Trigger**      | Applied to `*.ts` files when the task involves reviewing or modifying existing code |
| **What it does** | Lists the 10 known bug patterns — Cursor scans touched files for them proactively   |

---

### `pr-feedback.mdc`

|                  |                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------ |
| **Trigger**      | Applied when the task involves PR review feedback                                          |
| **What it does** | Guides Cursor through fetching GitHub comments via `gh` CLI and applying the correct fixes |

---

## 4. Cursor Skills — Reusable Playbooks

Skills live in `.cursor/skills/` and are read when the developer's request matches the skill's purpose. They are step-by-step instruction sets for common task types.

---

### `new-feature.md`

|                  |                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------- |
| **You say**      | "Add bulk export to the browse page" or "Implement NCO-1234"                            |
| **What it does** | Load context → expand intent → create todo list → implement → write tests → commit → PR |
| **JIRA support** | If a ticket ID is given, fetches the story via Atlassian MCP first                      |

---

### `fix-pr-comments.md`

|                  |                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| **You say**      | "Fix PR comments on PR #42"                                                                        |
| **What it does** | Fetches all open GitHub review comments → maps each to a known fix → implements → commits → pushes |

---

### `add-nuxeo-api.md`

|                  |                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **You say**      | "Add a method to lock a document"                                                                                          |
| **What it does** | Checks if the method already exists → finds the right service → adds the method → updates AGENTS/ and docs → writes a test |

---

### `generate-tests.md`

|                  |                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| **You say**      | "Write tests for DocumentDetailService"                                                                   |
| **What it does** | Reads the implementation → generates happy path, error path, and state tests → runs them → fixes failures |

---

## 5. GitHub PR Template — Consistent PRs

### `.github/PULL_REQUEST_TEMPLATE.md`

|                       |                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------- |
| **Trigger**           | Automatically pre-fills every new PR opened on GitHub                                   |
| **No setup required** | GitHub reads this file automatically                                                    |
| **What it does**      | Forces every PR to include: what changed and why, JIRA link, test plan, and a checklist |

The checklist includes: lint passes, build passes, tests pass, unit tests written, `docs/api-integrations.md` updated, `AGENTS/` updated if architecture changed, no hardcoded credentials, no direct `<img [src]>` bindings.

---

## 6. Copilot Instructions — Automated Code Review

### `.github/copilot-instructions.md`

|                       |                                                                   |
| --------------------- | ----------------------------------------------------------------- |
| **Read by**           | GitHub Copilot, in VS Code and JetBrains                          |
| **When**              | Automatically, every time Copilot reviews a PR in this repository |
| **No setup required** | Copilot reads this file from the repo automatically               |
| **What it does**      | Tells Copilot exactly what to flag on PRs                         |

**What Copilot will flag after this change:**

- Missing `takeUntilDestroyed()` on subscriptions
- `<img [src]>` bound directly to a Nuxeo URL
- `fetch()` calls to Nuxeo endpoints
- Hardcoded credentials
- Cross-feature imports (Nx boundary violations)
- Inline templates
- `any` type without justification
- `console.log` in production code
- New AI UI not gated behind the feature flag

---

## 7. GitHub Actions Workflows — Automated Agents

These run entirely in the cloud. No developer or AI tool involvement after setup.

---

### `ci.yml` (updated)

|             |                                                                                |
| ----------- | ------------------------------------------------------------------------------ |
| **Trigger** | Every PR opened against `main`; every push to `main`                           |
| **Runs**    | Lint → Build → **Tests (now enabled)** → Bundle size check                     |
| **Effect**  | PRs cannot be merged if tests fail. Test regressions are caught automatically. |

The test step was previously commented out — it is now active.

---

### `pr-auto-fix.yml`

|                  |                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Trigger**      | (1) Any reviewer clicks "Request Changes" on a PR, or (2) anyone comments `/fix-comments`                                      |
| **What it does** | Collects all open review comments and posts: "Open your AI assistant and run: fix all PR review comments on PR #N"             |
| **Effect**       | Turns a multi-step manual process (read comments, open IDE, describe each, ask agent to fix) into a single one-sentence prompt |

---

### `dependabot.yml`

|                           |                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**               | Every Monday at 06:00 UTC, automatically                                                                                        |
| **What it does**          | Scans `package.json` for npm packages with known security vulnerabilities (CVEs). Opens a PR to upgrade the vulnerable package. |
| **No human input needed** | Developer just reviews and merges the Dependabot PR                                                                             |

---

### `stale.yml`

|                  |                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**      | Runs daily at 02:00 UTC                                                                                                       |
| **What it does** | Scans open PRs. After 14 days of no activity, adds a `stale` label and warns. After 7 more days, closes the PR automatically. |
| **Effect**       | PR list stays clean without anyone manually triaging                                                                          |

---

### `dead-code.yml`

|                  |                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**      | Every Monday at 06:00 UTC                                                                                                             |
| **What it does** | Runs `knip` — finds unused TypeScript exports, unreferenced components, dead service methods. Opens a GitHub Issue with the findings. |
| **Effect**       | Dead code is surfaced weekly. Developers choose to clean it up or add it to the ignore list.                                          |

---

### `CHANGELOG.md` (no workflow)

`changelog.yml` was removed. `CHANGELOG.md` is written by hand, in the PR that makes the change.
The workflow's direct push to `main` was rejected by the repository rules on every run, and its
generator, with no release tags to start from, prepended the full commit history as a `0.0.0`
section above the curated file, and prepended it again on each later run.

---

### `staleness-check.yml`

|                  |                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Trigger**      | Every Monday at 07:00 UTC                                                                                                                                                      |
| **What it does** | Compares `.service.ts` files in the codebase against the list in `AGENTS/01-services.md`. If a new service exists in code but is missing from `AGENTS/`, opens a GitHub Issue. |
| **Effect**       | The AI knowledge base cannot drift silently. New services are flagged within one week of being added.                                                                          |

This is the **self-healing mechanism** for the `AGENTS/` directory.

---

### `release.yml`

|                  |                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger**      | Manual — a developer goes to GitHub Actions → Release Agent → Run workflow → selects patch / minor / major                            |
| **What it does** | Bumps version in `package.json`, generates a GitHub Release with changelog, creates the git tag, triggers the Nuxeo Marketplace build |
| **Effect**       | A multi-step manual release process is replaced with one button click                                                                 |

---

## 8. Agent Workflow Playbooks — Documentation

These files in `docs/agent-workflows/` explain the full step-by-step flow for the three most common tasks. They are read by AI assistants during a session and by developers wanting to understand the system.

| File                             | Describes                                                                  |
| -------------------------------- | -------------------------------------------------------------------------- |
| `new-feature-workflow.md`        | The complete flow from one-sentence intent (or JIRA ticket) to a merged PR |
| `bug-fix-workflow.md`            | From bug description to regression test to merged fix                      |
| `pr-review-response-workflow.md` | From Copilot review comment to fixed commit in one developer sentence      |

---

## 9. At a Glance — Trigger Summary

| File                                   | Who/What triggers it                   | Human input required |
| -------------------------------------- | -------------------------------------- | -------------------- |
| `AGENTS/*.md`                          | AI assistant reads at session start    | None                 |
| `AGENTS.md`                            | AI assistant reads at session start    | None                 |
| `CLAUDE.md`                            | Claude Code — on session start         | None                 |
| `.windsurfrules`                       | Windsurf — on workspace open           | None                 |
| `scripts/agent-context.sh`             | Developer runs manually                | One command          |
| `.cursor/rules/00-master-context.mdc`  | Cursor — every session                 | None                 |
| `.cursor/rules/security.mdc`           | Cursor — every `*.ts` file             | None                 |
| `.cursor/rules/nuxeo-api-patterns.mdc` | Cursor — `libs/shared/nuxeo-client/**` | None                 |
| `.cursor/skills/new-feature.md`        | Developer prompt: "add X"              | One sentence         |
| `.cursor/skills/fix-pr-comments.md`    | Developer prompt: "fix PR #N"          | One sentence         |
| `.github/PULL_REQUEST_TEMPLATE.md`     | GitHub — every new PR                  | None                 |
| `.github/copilot-instructions.md`      | GitHub Copilot — every PR review       | None                 |
| `ci.yml`                               | Every PR / push to `main`              | None                 |
| `pr-auto-fix.yml`                      | PR review "Request Changes" event      | None                 |
| `dependabot.yml`                       | Monday 06:00 UTC                       | None                 |
| `stale.yml`                            | Daily 02:00 UTC                        | None                 |
| `dead-code.yml`                        | Monday 06:00 UTC                       | None                 |
| `staleness-check.yml`                  | Monday 07:00 UTC                       | None                 |
| `release.yml`                          | Manual GitHub Actions dispatch         | One click            |

---

_This document is a companion to `docs/agentic-development-system.md` which covers the overall design and architecture of the system._
