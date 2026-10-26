# Agentic Development System — Design & Implementation Plan

**Repository:** `agentic-ui-poc`  
**Status:** Proposed — pre-implementation  
**Authors:** Narasimha Koppula  
**Last updated:** April 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Assessment](#2-current-state-assessment)
3. [System Architecture](#3-system-architecture)
4. [The Agent Catalog — All Tiers & Roles](#4-the-agent-catalog--all-tiers--roles)
   - Tier 1 (4.1–4.8): IDE-Resident Agents
   - Tier 2 (4.9): Continuous Quality Agents (GitHub Actions)
   - Tier 3 (4.10): Scheduled & Maintenance Agents
   - Tier 4 (4.11): Additional IDE Agents
5. [Tool-Agnostic Context Architecture](#5-tool-agnostic-context-architecture)
6. [Repository Structure Changes](#6-repository-structure-changes)
7. [Core Artifact: AGENTS.md](#7-core-artifact-agentsmd)
8. [Cursor Rules — Full Definitions](#8-cursor-rules--full-definitions)
9. [GitHub Actions Workflows](#9-github-actions-workflows)
10. [End-to-End Workflow Examples](#10-end-to-end-workflow-examples)
11. [Implementation Plan](#11-implementation-plan)
12. [Required Tools](#12-required-tools)
13. [Risks & Limitations](#13-risks--limitations)
14. [Definition of Done](#14-definition-of-done)

---

## 1. Executive Summary

This document describes the design for transforming the `agentic-ui-poc` repository into a **self-directing development system** where most of the software development lifecycle is automated through AI agents.

**The core insight:** This repository already has ~60% of the required infrastructure. The goal is not to build from scratch but to **wire together existing tools and fill the gaps** with structured context and workflow rules.

**What changes for developers:**

- Before: Write detailed prompts explaining architecture, patterns, file locations, and steps
- After: Write one sentence of intent → agent handles requirements, planning, implementation, tests, commit, and PR

**What does NOT change:**

- Human approval of final PRs remains mandatory
- Architecture decisions remain human-driven (documented, then replicated by agents)
- The agent is a force multiplier, not a replacement for engineering judgment

---

## 2. Current State Assessment

### What Already Exists

| Capability                              | Tool                         | Status           |
| --------------------------------------- | ---------------------------- | ---------------- |
| AI-assisted development                 | Cursor Agent (Claude)        | ✅ Active        |
| Codebase conventions                    | `.cursor/rules/` (3 rules)   | ✅ Partial       |
| Automated PR code review                | GitHub Copilot               | ✅ Active        |
| Security scanning                       | GitHub CodeQL                | ✅ Active        |
| Affected-only CI builds                 | Nx affected + GitHub Actions | ✅ Active        |
| Test runner                             | Vitest                       | ✅ Configured    |
| Test execution in CI                    | ci.yml                       | ❌ Commented out |
| Shared codebase context                 | None                         | ❌ Missing       |
| Full convention coverage                | Cursor rules                 | ❌ Only 3 rules  |
| PR feedback automation                  | None                         | ❌ Missing       |
| New developer onboarding context        | None                         | ❌ Missing       |
| Agent skill files                       | None                         | ❌ Missing       |
| Tool-agnostic context (non-Cursor IDEs) | None                         | ❌ Missing       |
| Scheduled quality maintenance           | None                         | ❌ Missing       |

### Gap Analysis

The four critical gaps that prevent full autonomy today:

1. **No shared context layer** — Every AI session starts cold regardless of IDE. Agents (and new developers) must rediscover architecture, file locations, and patterns every time. This is the root cause of most repeated prompting.

2. **Context is Cursor-only** — The three existing `.cursor/rules/` files only work in Cursor. Developers using VS Code + Copilot, Claude Code, Windsurf, or JetBrains AI get no project context at all.

3. **Tests not running in CI** — The test step is commented out in `ci.yml`. Agents generate code but regressions are not automatically caught.

4. **PR feedback requires manual re-prompting** — When Copilot leaves review comments, a human must open their IDE, describe the comments, and ask the agent to fix them. This loop can be automated.

---

## 3. System Architecture

### High-Level Flow

```
┌──────────────────────────────────────────────────────────────────┐
│  INTENT LAYER                                                     │
│                                                                   │
│  Option A — Free text:                                           │
│    "Add bulk export to search results"                           │
│                                                                   │
│  Option B — JIRA user story (recommended):                       │
│    "Implement NCO-1234"  →  agent fetches story via Atlassian   │
│    MCP, extracts Acceptance Criteria, and treats them as the    │
│    technical spec input for the Requirement Agent               │
│                                                                   │
│  Works from: Cursor, VS Code + Copilot, Claude Code,            │
│              Windsurf, JetBrains AI, or any LLM CLI             │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  CONTEXT LAYER  (AGENTS/ + tool-specific adapters)               │
│                                                                   │
│  Universal (all tools):                                          │
│  • AGENTS/ directory — 11 markdown knowledge files              │
│  • AGENTS.md — summary and quick reference                      │
│                                                                   │
│  Tool adapters that load the above automatically:                │
│  • .cursor/rules/     → Cursor                                  │
│  • CLAUDE.md          → Claude Code                             │
│  • .windsurfrules     → Windsurf                                │
│  • copilot-instructions.md → GitHub Copilot (VS Code/JetBrains) │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  AGENT PIPELINE  (Tier 1 + 4 — any AI-assisted IDE)             │
│                                                                   │
│  1. Requirement Agent  ──► Expand intent to technical spec       │
│  2. Planning Agent     ──► Create todo list, find touch points   │
│  3. Development Agent  ──► Write code following all conventions  │
│  4. QA Agent           ──► Generate + run unit tests             │
│  5. Git Agent          ──► Commit, push, create PR               │
│  + Conflict, Migration, Estimation, Bisect agents (Tier 4)      │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  AUTOMATION LAYER  (Tier 2 + 3 — GitHub Actions, IDE-agnostic)  │
│                                                                   │
│  Every PR: lint → build → test → bundle-size → a11y →           │
│            perf → api-drift → broken-links → CodeQL → Copilot   │
│                          │                                        │
│  On merge: changelog-gen → staleness-check                      │
│  Scheduled: dead-code → stale-branches → AGENTS.md-drift        │
│  Manual: release-agent                                           │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  HUMAN REVIEW                                                    │
│  Developer reviews diff → approves PR → merges                  │
└──────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer                               | Owner                       | Updates when             |
| ----------------------------------- | --------------------------- | ------------------------ |
| Intent                              | Developer                   | Per task                 |
| Context (`AGENTS/` + tool adapters) | Team (part of PR checklist) | Any architectural change |
| Agent pipeline (Tier 1 + 4)         | Any AI-assisted IDE         | Every task               |
| Automation (Tier 2 + 3)             | GitHub Actions              | CI config changes        |
| Human review                        | Developer                   | Every PR                 |

---

## 4. The Agent Catalog — All Tiers & Roles

Agents in this system are organized into four tiers based on where they run and what triggers them. **No single tier requires a specific IDE** — Tier 2 and Tier 3 run entirely in GitHub Actions with no IDE dependency whatsoever.

### Agent Tiers Overview

| Tier                               | Agents  | Runs where                 | Tool dependency                                           | Trigger             |
| ---------------------------------- | ------- | -------------------------- | --------------------------------------------------------- | ------------------- |
| **Tier 1 — IDE-Resident**          | 4.1–4.8 | Inside any AI-assisted IDE | Cursor, Claude Code, Windsurf, Copilot Chat, JetBrains AI | Developer prompt    |
| **Tier 2 — CI Quality Gates**      | 4.9     | GitHub Actions (every PR)  | None — pure CI                                            | PR open/update      |
| **Tier 3 — Scheduled Maintenance** | 4.10    | GitHub Actions (cron)      | None — pure CI                                            | Time-based schedule |
| **Tier 4 — Extended IDE Agents**   | 4.11    | Inside any AI-assisted IDE | Same as Tier 1                                            | Developer prompt    |

Tier 2 and Tier 3 agents run automatically regardless of what IDE the developer uses. See [Section 5](#5-tool-agnostic-context-architecture) for how Tier 1 and Tier 4 agents deliver consistent quality across all IDEs.

---

All Tier 1 and Tier 4 agents are implemented as **AI-assistant sessions** guided by the `AGENTS/` context directory and `AGENTS.md`. No separate agent infrastructure is required.

### 4.1 Requirement Understanding Agent

**Role:** Converts a one-sentence developer intent into a full technical specification.

**Inputs:** Single sentence of intent (e.g. "Add bulk export to browse page")

**Outputs:**

- Which files need to change
- Which Nuxeo APIs to call
- Which existing patterns to follow
- What new components/services are needed

**Enabler:** `AGENTS.md` (full service/API map) + `00-master-context.mdc` rule

**Example expansion:**

```
Input:  "Add bulk export to browse page"

Output: "This requires:
  1. A new 'Export' option in the bulk actions menu in browse.html
  2. An ExportDialogComponent in libs/shared/ui/src/lib/export-dialog/
     (already exists — check if it covers this use case)
  3. A new bulkExport() method in DocumentDetailService calling
     POST /nuxeo/api/v1/automation/Blob.BulkDownload
  4. Wiring the selection from SelectionService into the dialog
  5. Unit tests for the new service method
  6. Update docs/api-integrations.md with the new automation call"
```

---

### 4.2 Planning Agent

**Role:** Breaks the technical specification into an ordered, dependency-aware task list.

**Inputs:** Technical specification from Requirement Agent

**Outputs:** Structured todo list (using Cursor's built-in `TodoWrite` tool)

**Example todo list:**

```
☐ Check if ExportDialogComponent in libs/shared/ui already handles bulk export
☐ Add bulkExport(uids: string[]) to DocumentDetailService
☐ Add 'Export' button to bulk selection topbar in BrowseComponent
☐ Wire SelectionService.selectedIds() into the new export action
☐ Open ExportDialogComponent with the selected UIDs on click
☐ Write unit tests: DocumentDetailService.bulkExport() happy + error path
☐ Run: npx nx affected -t lint && npx nx affected -t test
☐ Commit on branch feature/bulk-export
☐ Create PR via gh pr create
```

**Note:** This is already built into Cursor Agent. The key improvement is the context layer ensuring the agent knows _exactly_ what exists and where, so the plan is accurate from the start.

---

### 4.3 Development Agent

**Role:** Implements the planned tasks, following all established conventions.

**Key capabilities enabled by context:**

- Knows exact file locations for any service, component, or model
- Knows the Angular patterns (standalone, inject(), signal(), takeUntilDestroyed)
- Knows Nuxeo API payloads from the api-integrations.md registry
- Knows which shared components exist to avoid duplication
- Knows Nx boundary rules (features never import from features)

**Quality gates enforced by rules:**

- Every new service method must have an accompanying test
- Every new Observable subscription must have takeUntilDestroyed()
- Every createObjectURL must have revokeObjectURL in cleanup
- No hardcoded credentials
- No direct `<img [src]="nuxeoUrl">` for authenticated content

---

### 4.4 Test & QA Agent

**Role:** Generates comprehensive unit tests for all new code and validates them against the test runner.

**Trigger:** Runs automatically after Development Agent completes each service or component

**Test standards:**

- Location: same folder as the implementation file, `*.spec.ts`
- Framework: Vitest + Angular testing utilities
- Coverage: happy path, error path, loading/empty states
- For services: mock HttpClient, test Observable emissions
- For components: test signal state changes, not DOM structure

**CI integration:**

- `npx nx affected -t test` runs on every PR (once the commented step is enabled)
- Coverage report posted as PR comment

---

### 4.5 Bug Detection Agent

**Role:** Continuously scans code for known anti-patterns, edge cases, and logical errors.

**Mechanism:** The `bug-patterns.mdc` Cursor rule applies to every file the agent touches. Every session includes a passive scan against the known bug pattern catalog.

**Known patterns tracked:**

- Observable subscriptions without `takeUntilDestroyed()`
- `URL.createObjectURL()` without `revokeObjectURL()` cleanup
- Direct `<img src>` for authenticated Nuxeo content (bypasses auth interceptor)
- Hardcoded credentials or base64-encoded passwords
- Signal state not reset on navigation changes
- Race conditions in async blob fetches

**Additional tooling:** GitHub CodeQL (already active) catches security vulnerabilities at PR time.

---

### 4.6 Code Review Agent

**Role:** Reviews all code changes against project standards before merge.

**Primary tool:** GitHub Copilot (already configured as a required PR reviewer)

**Enhanced with:**

- Expanded `copilot-instructions.md` covering Nuxeo-specific patterns
- Angular anti-pattern detection rules
- Security rules specific to this codebase

**What Copilot currently catches (proven):**

- XSS vulnerabilities
- Race conditions
- Dead code
- Credential leaks
- Angular CSS scoping errors

**What needs to be added to copilot-instructions.md:**

- "Flag any `<img [src]>` binding to Nuxeo content URLs"
- "Flag any `.subscribe()` without `takeUntilDestroyed()`"
- "Flag imports between feature libraries (Nx boundary violations)"
- "Flag any Basic auth credentials in TypeScript files"

---

### 4.7 Git Agent

**Role:** Handles all git operations — branching, committing, pushing, and PR creation.

**Governed by:** `git-workflow.mdc` Cursor rule

**Operations performed automatically:**

- Creates feature branch with correct naming convention
- Stages only relevant files
- Writes Conventional Commit message from the task description
- Runs lint + build + test before committing (pre-commit hook via Husky, already configured)
- Pushes branch and creates PR via `gh pr create`
- Fills PR body from `PULL_REQUEST_TEMPLATE.md`

**Branch naming:**

```
feature/<description>   → feature/bulk-export
fix/<description>       → fix/thumbnail-memory-leak
docs/<description>      → docs/update-api-registry
```

**Commit format (Conventional Commits):**

```
feat: add bulk export to browse page
fix: resolve thumbnail blob URL memory leak in app shell
docs: update api-integrations.md for Blob.BulkDownload
test: add unit tests for DocumentDetailService.bulkExport
```

---

### 4.8 PR Feedback Agent

**Role:** Reads GitHub PR review comments from Copilot (and human reviewers) and automatically implements the fixes.

**Current state:** Requires a human to summarize comments and re-prompt the agent.

**Target state:** Developer types `"fix PR comments"` and the agent:

1. Runs `gh pr view <number> --json reviews,comments`
2. Parses all open, unresolved review comments
3. Implements fixes for each one
4. Commits the fixes as a follow-up commit
5. Responds to each GitHub comment with what was done

**Governed by:** `pr-feedback.mdc` Cursor rule + `pr-auto-fix.yml` GitHub Actions workflow (for triggering)

---

### 4.9 Tier 2: Continuous Quality Agents (GitHub Actions)

These agents run on every PR in GitHub Actions CI. They are **completely tool-agnostic** — they enforce standards regardless of which IDE the developer used.

#### Bundle Size Agent

**Trigger:** Every PR  
**Action:** Fails the PR if the Angular production bundle grows by more than 5% compared to `main`. Prevents performance regressions from being silently merged.  
**Implementation:** `npx nx build nuxeo-ui --prod` + compare `stats.json` against a baseline stored as a CI artifact.

#### Dependency Vulnerability Agent

**Trigger:** Every push to `main`; weekly schedule  
**Action:** Scans `package.json` dependencies for known CVEs. Opens a Dependabot PR to upgrade the vulnerable package.  
**Implementation:** GitHub Dependabot (`.github/dependabot.yml` with `ecosystem: npm`). Zero setup cost — already supported on the repo.

#### API Drift Agent

**Trigger:** Every PR that modifies files in `libs/shared/nuxeo-client/src/lib/services/`  
**Action:** Compares the list of `/nuxeo/api` endpoint strings found in service files against the registry in `docs/api-integrations.md`. Files an inline PR comment if a new endpoint URL appears in code but is not yet documented.  
**Implementation:** `rg '/nuxeo/api' libs/shared/nuxeo-client/` + diff against `docs/api-integrations.md` in a shell script step.

#### Broken Link Agent

**Trigger:** Every PR touching `docs/` or any `.md` file  
**Action:** Checks all hyperlinks in Markdown files — internal anchors, relative file links, and external URLs. Reports broken links as PR annotations.  
**Implementation:** `markdown-link-check` npm package in CI.

#### Accessibility Agent

**Trigger:** Every PR  
**Action:** Runs `axe-core` via Playwright against the built Angular application and reports WCAG 2.1 AA violations as PR annotations. New violations block the PR.  
**Implementation:** `@axe-core/playwright` in a Playwright test step.

#### Performance Agent

**Trigger:** Every PR  
**Action:** Runs Lighthouse CI against the built app. Enforces minimum scores (Performance ≥ 80, Accessibility ≥ 90, Best Practices ≥ 90). Posts score deltas as a PR comment so regressions are visible before merge.  
**Implementation:** `@lhci/cli` + `lighthouserc.json` configuration file.

---

### 4.10 Tier 3: Scheduled & Maintenance Agents

These agents run on GitHub Actions cron schedules. No developer action required — they run overnight or weekly and file issues/PRs when action is needed.

#### Stale Branch Agent

**Schedule:** Daily at 02:00 UTC  
**Action:** Applies the `stale` label to PRs with no activity for 14 days. Closes them after 21 days of continued inactivity with an explanatory comment. Keeps the PR list clean without manual triage.  
**Implementation:** `actions/stale@v9` GitHub Action — single workflow block, ~10 lines.

#### Dead Code Agent

**Schedule:** Weekly (Monday 06:00 UTC)  
**Action:** Runs `knip` to detect unused exports, unreferenced components, and dead service methods. Opens a GitHub Issue listing findings grouped by file. This surfaces cleanup opportunities that are easy to miss in day-to-day development.  
**Implementation:** `npx knip` in a scheduled workflow + `gh issue create --title "Dead code report"`.

#### Changelog Agent

**Trigger:** Every merge to `main`  
**Action:** Auto-generates `CHANGELOG.md` entries from Conventional Commit messages since the last tag. Commits the update directly to `main` so the changelog stays current without manual writing.  
**Implementation:** `git-cliff` or `conventional-changelog-cli`.

> **Status:** implemented as `changelog.yml` and then removed. The repository rules reject a direct
> push to `main`, and with no release tags `conventional-changelog-cli` prepended the full commit
> history as a `0.0.0` section to the hand-curated `CHANGELOG.md`, again on every run.
> `CHANGELOG.md` is written by hand.

#### AGENTS.md Staleness Agent

**Schedule:** Weekly  
**Action:** Compares the list of `.service.ts` files in `libs/shared/nuxeo-client/src/lib/services/` against the services listed in `AGENTS.md` section 3. If drift is detected — a new service file not mentioned in `AGENTS.md`, or a deleted service still listed — it opens a GitHub Issue titled `"AGENTS.md is out of date: <list of drifted files>"`.  
**Implementation:** Shell script using `find` + `rg` + `gh issue create`.

#### Release Agent

**Trigger:** Manual `workflow_dispatch`  
**Action:** Bumps the version in the root `package.json`, creates a tagged GitHub Release with the changelog since the last tag, and triggers `build-marketplace.yml` to build the Nuxeo Marketplace package. Codifies the entire release process so it is consistent and repeatable.  
**Implementation:** `actions/github-script` + `gh release create --generate-notes`.

#### Refactoring Opportunity Agent

**Schedule:** Weekly  
**Action:** Scans for structural anti-patterns: services exceeding 300 lines, components importing more than 8 services, logic duplicated across two or more feature modules, and files modified in every PR over the last 30 days (high churn = refactor candidate). Opens a GitHub Issue with findings ranked by severity.  
**Implementation:** Shell script using `wc -l`, `rg`, and `git log --diff-filter=M` + `gh issue create`.

---

### 4.11 Tier 4: Additional IDE Agents

These extend the Tier 1 agents with higher-level capabilities. They run inside any AI-assisted IDE and are guided by the same `AGENTS/` context directory.

#### Conflict Resolution Agent

**Role:** When a merge conflict is detected, reads both sides of the conflict, traces their origins via `git log`, understands the intent of each change, and suggests the correct resolution with a brief explanation of which side to keep and why.  
**Trigger:** Developer: `"resolve merge conflicts in <file>"`  
**Enabler:** `AGENTS/06-git-workflow.md` + `git log --merge` + `git diff --merge`

#### Architecture Decision Agent

**Role:** When a PR introduces a new architectural pattern — a new shared library, a new state management approach, a new inter-layer communication pattern — this agent prompts the developer to document the decision as an Architecture Decision Record (ADR) and creates the file using a standard template.  
**Trigger:** Agent detects structural change outside established patterns; developer confirms  
**Output:** `docs/decisions/ADR-NNN-<title>.md` using the MADR template

#### Estimation Agent

**Role:** Given a one-sentence feature intent, estimates implementation complexity as **S / M / L / XL** by analyzing: how many files will need to change, whether new services or feature modules are required, whether API integration is involved, and whether tests need to be written.  
**Trigger:** Developer: `"estimate: Add download history to user profile"`  
**Output:** Size estimate + reasoning broken down by category (UI / API / Tests / Risk)

#### Migration Agent

**Role:** Handles planned dependency upgrades — Angular major version, Nx workspace version, Satori UI version. Runs the official migration schematic (`ng update` or `nx migrate`), fixes TypeScript and template compilation errors, updates deprecated API usage, and verifies the build before committing.  
**Trigger:** Developer: `"migrate Angular to version 20"`  
**Enabler:** `AGENTS/00-architecture.md` (knows all components and services to check)

#### Regression Bisect Agent

**Role:** Given a bug description and a last-known-good commit reference, runs `git bisect` to find the exact commit that introduced the regression. Reads the diff of the identified commit and explains what specific change caused the bug, saving hours of manual archaeology.  
**Trigger:** Developer: `"find when thumbnail loading broke — was working in commit abc123"`  
**Implementation:** `git bisect start` → `git bisect good <ref>` → automated `nx build` or `nx test` as the bisect test command

#### Onboarding Agent

**Role:** Provides an interactive question-and-answer guide for new developers. Answers questions about architecture, conventions, and how to accomplish common tasks using `AGENTS.md` and the `AGENTS/` directory as its knowledge base — without needing a colleague to explain things.  
**Trigger:** Developer: `"explain how to add a new Nuxeo API service method"`  
**Output:** Step-by-step instructions referencing exact file locations in this repository

---

## 5. Tool-Agnostic Context Architecture

A critical requirement: **not all developers use Cursor.** The system must deliver consistent AI quality regardless of whether a developer uses Cursor, VS Code with GitHub Copilot, JetBrains AI Assistant, Claude Code, Windsurf, Cody, or any other AI-assisted tool.

### The Problem

The Cursor rules in `.cursor/rules/` are **only read by Cursor**. A developer using any other tool starts with no context, leading to lower-quality AI output, inconsistent code patterns, and more review cycles.

### The Solution: Decouple Content from Format

Separate the **knowledge** (what the AI needs to know) from the **delivery format** (how each tool ingests it).

```
SINGLE SOURCE OF TRUTH
        ▼
  AGENTS/ directory          ← Plain markdown. Any AI can read these.
  + AGENTS.md                   No tool-specific syntax. No proprietary format.
        │
        ├──► .cursor/rules/               ← Cursor reads these automatically
        ├──► CLAUDE.md                    ← Claude Code reads this at session start
        ├──► .windsurfrules               ← Windsurf reads this automatically
        ├──► .github/copilot-instructions.md  ← GitHub Copilot (VS Code + JetBrains)
        └──► AGENTS.md (root)             ← Universal fallback; any AI can be told to read it
```

### The `AGENTS/` Directory — Universal Knowledge Base

All project knowledge lives in plain markdown files in `AGENTS/`. These are not config files — they are **knowledge articles** that any AI assistant can be instructed to read.

| File                               | Contents                                                               |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `AGENTS/00-architecture.md`        | 4-layer model, Nx boundary rules, layer diagram, import rules          |
| `AGENTS/01-services.md`            | All 23 services + every public method signature                        |
| `AGENTS/02-nuxeo-apis.md`          | All API endpoints, request payloads, enrichers, automation operations  |
| `AGENTS/03-angular-conventions.md` | Signals, `inject()`, standalone, `takeUntilDestroyed`, template rules  |
| `AGENTS/04-feature-scaffold.md`    | Exact step-by-step scaffold for a new feature module                   |
| `AGENTS/05-test-standards.md`      | Test templates, coverage requirements, Vitest patterns                 |
| `AGENTS/06-git-workflow.md`        | Branch naming, Conventional Commit format, PR process                  |
| `AGENTS/07-security.md`            | Security rules: credentials, XSS, blob URL lifecycle, auth interceptor |
| `AGENTS/08-bug-patterns.md`        | Known anti-patterns with BAD/GOOD side-by-side examples                |
| `AGENTS/09-pr-feedback.md`         | How to read and resolve GitHub PR review comments                      |
| `AGENTS/10-ai-features.md`         | AI backend routes, HAIP config, feature flag system                    |

### Tool-Specific Adapter Files

Each AI tool gets a thin adapter that points to the `AGENTS/` directory. The adapters are kept minimal — all real content stays in `AGENTS/` so it only needs to be updated in one place.

#### Cursor — `.cursor/rules/00-master-context.mdc`

Already defined in [Section 8](#8-cursor-rules--full-definitions). Instructs Cursor to read `AGENTS.md` and the `AGENTS/` directory at the start of every session.

#### Claude Code — `CLAUDE.md` (root)

Claude Code automatically reads `CLAUDE.md` at session start (equivalent to Cursor's `alwaysApply: true` rule).

```markdown
# CLAUDE.md — Nuxeo Agentic UI Context

Read AGENTS.md and every file in the AGENTS/ directory before starting any task.
They contain the complete codebase knowledge: architecture, all services,
all Nuxeo API endpoints, Angular conventions, security rules, git workflow,
and the definition of done.

Quick reference: AGENTS.md
Full knowledge base: AGENTS/00-architecture.md through AGENTS/10-ai-features.md
```

#### Windsurf — `.windsurfrules` (root)

Windsurf reads `.windsurfrules` automatically at workspace open.

```
Read AGENTS.md in the root directory and all files in AGENTS/ before any task.
These files contain the complete codebase context for this Angular/Nuxeo monorepo.

Non-negotiable conventions:
- Standalone Angular components only — no NgModules
- All state via signal() — no BehaviorSubject or plain class properties for UI state
- All DI via inject() — not constructor parameters
- All Nuxeo calls via NuxeoApiBase — not HttpClient directly in components or features
- All subscriptions must use takeUntilDestroyed()
- Never import from a sibling feature library (Nx boundary rule)
- Always external templates (templateUrl) — no inline templates
```

#### GitHub Copilot — `.github/copilot-instructions.md`

Copilot reads this file automatically in VS Code and JetBrains. The existing file must be **significantly expanded** to include:

- Angular anti-patterns to flag on every PR:
  - `<img [src]="nuxeoUrl">` binding (bypasses auth interceptor — use `fetchBlob()`)
  - `.subscribe()` without `takeUntilDestroyed()` (memory leak)
  - Cross-feature imports (Nx boundary violation)
  - Inline component templates (project convention requires external templates)
- Security patterns to block:
  - Hardcoded credentials or base64-encoded auth strings in TypeScript files
  - `fetch()` API calls to Nuxeo URLs (bypasses Angular auth interceptor)
  - `URL.createObjectURL()` without a corresponding `revokeObjectURL()` in cleanup
- Project conventions that Copilot should replicate, not override:
  - Signal-based state (`signal()`, `computed()`, `effect()`) — not RxJS subjects for UI state
  - `inject()` for dependency injection — not constructor parameters
  - Nuxeo Automation operations (e.g., `Collection.Create`) — not raw REST POST to collection folders

#### JetBrains AI Assistant

JetBrains AI does not auto-read project files, but the workflow is simple and documented:

1. Add to `README.md`: "JetBrains users: start every AI session by typing `@AGENTS.md` to load project context"
2. Add to `AGENTS.md` section 0: "If you are a JetBrains AI user, you were manually loaded. You now have full context."
3. The `AGENTS/` files can be opened as tabs and referenced with `@filename` in JetBrains AI chat

#### Any CLI / API-based Tool

Any tool that can call an LLM API can be given the context programmatically via a helper script:

```bash
#!/bin/bash
# scripts/agent-context.sh — Universal context loader for any LLM CLI tool
CONTEXT=$(cat AGENTS.md)
for f in AGENTS/*.md; do
  CONTEXT="$CONTEXT\n\n---\n\n$(cat $f)"
done
echo "$CONTEXT"
# Usage: ./scripts/agent-context.sh | <your-llm-cli> --system-prompt -
```

### Maintenance Rule for Tool-Agnostic Architecture

| When...                             | Update...                                                              |
| ----------------------------------- | ---------------------------------------------------------------------- |
| A new service is added              | `AGENTS/01-services.md` + `AGENTS.md` section 3                        |
| A new Nuxeo endpoint is called      | `AGENTS/02-nuxeo-apis.md` + `docs/api-integrations.md`                 |
| A new bug pattern is discovered     | `AGENTS/08-bug-patterns.md`                                            |
| A new Angular convention is adopted | `AGENTS/03-angular-conventions.md` + `.github/copilot-instructions.md` |
| Architecture changes                | `AGENTS/00-architecture.md` + `AGENTS.md` section 1                    |

**All adapters (`.cursor/rules/`, `CLAUDE.md`, `.windsurfrules`) point to `AGENTS/`. Update `AGENTS/` once — all tools benefit automatically.**

---

## 6. Repository Structure Changes

### New Files to Create

```
agentic-ui-poc/
│
├── AGENTS.md                                    ← NEW — summary + index to AGENTS/ directory
│
├── AGENTS/                                      ← NEW — universal knowledge base (any IDE)
│   ├── 00-architecture.md                       ← 4-layer model, Nx rules, layer diagram
│   ├── 01-services.md                           ← All 23 services + method signatures
│   ├── 02-nuxeo-apis.md                         ← All API endpoints + payloads
│   ├── 03-angular-conventions.md                ← Signals, inject(), standalone, subscriptions
│   ├── 04-feature-scaffold.md                   ← Step-by-step new feature module guide
│   ├── 05-test-standards.md                     ← Test templates, coverage requirements
│   ├── 06-git-workflow.md                       ← Branch naming, commits, PR process
│   ├── 07-security.md                           ← Credential, XSS, blob URL rules
│   ├── 08-bug-patterns.md                       ← Known anti-patterns BAD/GOOD examples
│   ├── 09-pr-feedback.md                        ← How to resolve GitHub review comments
│   └── 10-ai-features.md                        ← AI backend routes, HAIP, feature flags
│
├── CLAUDE.md                                    ← NEW — Claude Code adapter (reads AGENTS/)
├── .windsurfrules                               ← NEW — Windsurf adapter (reads AGENTS/)
│
├── scripts/
│   └── agent-context.sh                        ← NEW — CLI context loader for any LLM tool
│
├── .cursor/
│   ├── rules/
│   │   ├── angular-conventions.mdc              ← EXISTS (keep, minor additions)
│   │   ├── angular-templates.mdc                ← EXISTS (keep)
│   │   ├── ai-features-docs.mdc                 ← EXISTS (keep)
│   │   ├── 00-master-context.mdc                ← NEW (alwaysApply: true)
│   │   ├── nuxeo-api-patterns.mdc               ← NEW
│   │   ├── feature-module-scaffold.mdc          ← NEW
│   │   ├── test-generation.mdc                  ← NEW
│   │   ├── git-workflow.mdc                     ← NEW
│   │   ├── security.mdc                         ← NEW
│   │   ├── bug-patterns.mdc                     ← NEW
│   │   └── pr-feedback.mdc                      ← NEW
│   │
│   └── skills/                                  ← NEW directory
│       ├── new-feature.md                       ← NEW
│       ├── fix-pr-comments.md                   ← NEW
│       ├── add-nuxeo-api.md                     ← NEW
│       └── generate-tests.md                    ← NEW
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                               ← EXISTS (add test + quality steps)
│   │   ├── build-marketplace.yml                ← EXISTS (keep)
│   │   ├── pr-auto-fix.yml                      ← NEW (Tier 2 PR feedback)
│   │   ├── test-coverage.yml                    ← NEW (Tier 2 coverage report)
│   │   ├── stale.yml                            ← NEW (Tier 3 Stale Branch Agent)
│   │   ├── dead-code.yml                        ← NEW (Tier 3 Dead Code Agent)
│   │   ├── changelog.yml                        ← NEW (Tier 3 Changelog Agent)
│   │   ├── staleness-check.yml                  ← NEW (Tier 3 AGENTS.md drift)
│   │   └── release.yml                          ← NEW (Tier 3 Release Agent)
│   │
│   ├── dependabot.yml                           ← NEW (Tier 3 Vulnerability Agent)
│   ├── PULL_REQUEST_TEMPLATE.md                 ← NEW
│   └── copilot-instructions.md                  ← EXISTS (expand significantly)
│
└── docs/
    ├── agentic-development-system.md            ← THIS FILE
    └── agent-workflows/                          ← NEW directory
        ├── new-feature-workflow.md              ← NEW
        ├── bug-fix-workflow.md                  ← NEW
        └── pr-review-response-workflow.md       ← NEW
```

---

## 7. Core Artifact: AGENTS.md

`AGENTS.md` is the single most important file in this system. It is the **persistent memory** shared across all agents and all developers. Every Cursor session reads it automatically via the `00-master-context.mdc` rule.

### What it must contain

````markdown
# AGENTS.md — Nuxeo Agentic UI: Complete Codebase Context

## 1. Architecture in 60 Seconds

4-layer system, enforced by Nx boundary rules:

App Shell (apps/nuxeo-ui)
↓ lazy-loads
Feature Modules (libs/features/_) ← no cross-feature imports
↓ imports from
Shared Libraries (libs/shared/_)
↓ Nuxeo calls via
Nuxeo Server (via Angular proxy in dev, same-origin in prod)

CRITICAL RULES:

- Features NEVER import from other features
- Services ALWAYS go in libs/shared/nuxeo-client/src/lib/services/
- Components NEVER import NuxeoApiBase directly — use domain services
- Standalone: true on EVERY component — no NgModules anywhere

## 2. All Feature Modules

| Module          | Route           | Main component               | Key files               |
| --------------- | --------------- | ---------------------------- | ----------------------- |
| browse          | /browse         | BrowseComponent              | browse.ts, browse.html  |
| search          | /search         | SearchComponent              | search.ts               |
| document-detail | /doc/:id        | DocumentDetailComponent      | document-detail.ts      |
| collections     | /collections    | CollectionDetailComponent    | collection-detail.ts    |
| tasks           | /tasks          | TasksPageComponent           | tasks-page.ts           |
| administration  | /administration | AdministrationShellComponent | admin-shell.ts          |
| assets          | /documents      | AssetSearchResultsComponent  | asset-search-results.ts |
| trash           | /trash          | TrashComponent               | trash.ts                |

## 3. All Shared Services and Their Primary Methods

### DocumentDetailService (libs/shared/nuxeo-client/src/lib/services/document-detail.service.ts)

- fetchDoc(uid): Observable<NuxeoDocument>
- fetchBlob(blobUrl): Observable<Blob>
- fetchThumbnail(uid): Observable<Blob>
- fetchPdfRendition(uid): Observable<Blob>
- fetchVersionHistory(uid): Observable<NuxeoDocument[]>
- createCollection(title, description): Observable<NuxeoDocument>

### BrowseService (.../browse.service.ts)

- getChildren(path, params?): Observable<PaginatedList<NuxeoDocument>>
- getDocument(path): Observable<NuxeoDocument>

### SearchService (.../search.service.ts)

- search(nxql, params?): Observable<PaginatedList<NuxeoDocument>>
- getSavedSearches(): Observable<SavedSearch[]>
- saveSavedSearch(search): Observable<SavedSearch>

[... all 23 services listed with their methods ...]

## 4. Nuxeo API Endpoints Used

| Service               | Method | Endpoint                                   |
| --------------------- | ------ | ------------------------------------------ |
| List folder children  | GET    | /nuxeo/api/v1/path/:path/@children         |
| Fetch document by UID | GET    | /nuxeo/api/v1/id/:uid                      |
| NXQL search           | POST   | /nuxeo/api/v1/search/lang/NXQL/execute     |
| Create collection     | POST   | /nuxeo/api/v1/automation/Collection.Create |
| Upload file           | POST   | /nuxeo/api/v1/upload                       |
| Complete task         | PUT    | /nuxeo/api/v1/task/:taskId                 |

[... all endpoints ...]

## 5. AI Operations

All called as POST /nuxeo/api/v1/automation/AI.\* — served by a separate marketplace package

| Operation      | Purpose                 |
| -------------- | ----------------------- |
| AI.NlToNxql    | NL → NXQL query         |
| AI.Summarize   | Document summary        |
| AI.SuggestTags | Tag suggestions         |
| /ai/classify   | Document classification | GPT-4o      |
| /ai/similar    | Similar document NXQL   | GPT-4o-mini |
| /ai/chat       | RAG streaming chat      | GPT-4o      |
| /ai/insights   | Dashboard KPI cards     | GPT-4o      |
| /ai/anomalies  | Audit anomaly detection | GPT-4o      |

## 6. Angular Conventions (non-negotiable)

```typescript
// EVERY component — no exceptions
@Component({ standalone: true, imports: [...], templateUrl: '...' })
export class MyComponent {
  private readonly service = inject(MyService);   // inject(), never constructor params
  readonly items = signal<Item[]>([]);             // signal() for all state
  readonly count = computed(() => this.items().length);  // computed() for derived
  readonly loading = signal(false);

  // Subscriptions MUST use takeUntilDestroyed()
  this.service.getItems().pipe(takeUntilDestroyed()).subscribe(...)

  // External templates (always)
  templateUrl: './my-component.html'
}
```

## 7. How to Add a New Feature Module

1. `npx nx g @nx/angular:library --name=feature-<name> --directory=libs/features/<name>`
2. Create `src/lib/<name>/` with `<name>.ts` and `<name>.html`
3. Create `src/lib/lib.routes.ts` exporting `<name>Routes: Routes`
4. Update `src/index.ts` to export the routes and main component
5. Add lazy route to `apps/nuxeo-ui/src/app/app.routes.ts`
6. Add nav item to `apps/nuxeo-ui/src/app/platform-nav-items.ts`

## 8. How to Add a New Nuxeo API Service Method

1. Add method to the appropriate service in libs/shared/nuxeo-client/src/lib/services/
2. Export from libs/shared/nuxeo-client/src/index.ts if needed
3. Update docs/api-integrations.md with the new endpoint
4. Write unit test in the same folder as the service

## 9. Where Things Live — Quick Reference

| I need to...         | File location                                                 |
| -------------------- | ------------------------------------------------------------- |
| Add a Nuxeo API call | libs/shared/nuxeo-client/src/lib/services/<domain>.service.ts |
| Add a shared dialog  | libs/shared/ui/src/lib/<dialog-name>/<dialog>.ts              |
| Add a feature page   | libs/features/<feature>/src/lib/<feature>/<feature>.ts        |
| Change routing       | apps/nuxeo-ui/src/app/app.routes.ts                           |
| Change navigation    | apps/nuxeo-ui/src/app/platform-nav-items.ts                   |
| Add an AI call       | libs/shared/ai-client/src/lib/ai-gateway.service.ts           |
| Change auth behavior | apps/nuxeo-ui/src/app/auth/                                   |
| Add a data model     | libs/shared/nuxeo-client/src/lib/models/                      |

## 10. Definition of Done for Any Change

- [ ] npx nx affected -t lint passes
- [ ] npx nx affected -t build passes
- [ ] npx nx affected -t test passes
- [ ] Unit tests written for any new service method
- [ ] docs/api-integrations.md updated if a new Nuxeo endpoint was called
- [ ] docs/ai-features.md updated if AI backend changed
- [ ] AGENTS.md updated if architecture changed
- [ ] PR created on a feature/_ or fix/_ branch (never commit directly to main)
````

### Maintenance Rule

`AGENTS.md` must be kept current. Add to the PR checklist:

- "If you changed the architecture → update AGENTS.md section 2 or 4"
- "If you added a new service → update AGENTS.md section 3"
- "If you added a new Nuxeo API call → update AGENTS.md section 4"

---

## 8. Cursor Rules — Full Definitions

### 8.1 `00-master-context.mdc` (NEW — most important)

```yaml
---
description: Master context loader — reads AGENTS.md at the start of every session
globs: "**/*"
alwaysApply: true
---

# Master Context

At the start of every session, read AGENTS.md in the root of this repository.
It contains the full architecture map, all services and their methods, all Nuxeo
API endpoints, all Angular conventions, and the definition of done.

Do not proceed with any task until you have internalized:
1. The 4-layer architecture and what imports what
2. Where the relevant service/component for this task lives
3. Which existing patterns to replicate
4. The definition of done (section 10 of AGENTS.md)

If AGENTS.md does not exist, stop and tell the developer to create it first.
```

---

### 8.2 `feature-module-scaffold.mdc` (NEW)

```yaml
---
description: Exact scaffold pattern for new feature modules
globs: "libs/features/**"
alwaysApply: false
---

# Feature Module Scaffold

When creating a new feature module, ALWAYS follow this exact structure:

libs/features/<name>/
├── src/
│   ├── index.ts                    ← exports routes + main component
│   └── lib/
│       ├── lib.routes.ts           ← Routes array, exported as <name>Routes
│       ├── <name>/
│       │   ├── <name>.ts           ← Main smart container component
│       │   └── <name>.html         ← External template (always external)
│       └── dialogs/                ← Only if the feature has dialogs
│           └── <dialog-name>/
│               ├── <dialog>.ts
│               └── <dialog>.html

lib.routes.ts template:
  import { Routes } from '@angular/router';
  import { MyComponent } from './my/my.component';
  export const myRoutes: Routes = [
    { path: '', component: MyComponent }
  ];

index.ts template:
  export { myRoutes } from './lib/lib.routes';
  export { MyComponent } from './lib/my/my.component';

After creating, add to app.routes.ts:
  { path: '<name>', loadChildren: () => import('@agentic-ui/feature-<name>').then(m => m.<name>Routes) }
```

---

### 8.3 `nuxeo-api-patterns.mdc` (NEW)

```yaml
---
description: How to correctly call Nuxeo APIs from Angular services
globs: "libs/shared/nuxeo-client/**"
alwaysApply: false
---

# Nuxeo API Patterns

## Adding a new service method

Always inject NuxeoApiBase (not HttpClient directly):
  private readonly api = inject(NuxeoApiBase);

Standard GET:
  getDocument(uid: string): Observable<NuxeoDocument> {
    return this.api.get<NuxeoDocument>(`/nuxeo/api/v1/id/${uid}`);
  }

With enrichers:
  return this.api.get<NuxeoDocument>(`/nuxeo/api/v1/id/${uid}`, {
    headers: { 'enrichers-document': 'thumbnail,permissions,subtypes' }
  });

Automation operation:
  return this.api.post<NuxeoDocument>('/nuxeo/api/v1/automation/Collection.Create', {
    params: { name: title, description },
    context: {},
  });

File upload (multipart):
  const form = new FormData();
  form.append('file', file);
  return this.api.post<NuxeoDocument>('/nuxeo/api/v1/upload', form);

## NEVER do these
- Never call HttpClient directly from a feature component
- Never hardcode /nuxeo/api/v1 URLs in components — use services
- Never use .snapshot for route params in reusable components
- Never use the fetch() API for Nuxeo calls (bypasses auth interceptor)
```

---

### 8.4 `test-generation.mdc` (NEW)

```yaml
---
description: Test generation standards — all new code requires tests
globs: "**/*.spec.ts"
alwaysApply: false
---

# Test Generation Standards

## When to generate tests
- After writing ANY new service method → write a corresponding spec
- After writing ANY new component with business logic → write a spec
- After fixing a bug → write a regression test that would have caught it

## Service test template
  import { TestBed } from '@angular/core/testing';
  import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
  import { MyService } from './my.service';

  describe('MyService', () => {
    let service: MyService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
      TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
      service = TestBed.inject(MyService);
      httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpMock.verify());

    it('should fetch document by uid', () => {
      service.fetchDoc('abc-123').subscribe(doc => {
        expect(doc.uid).toBe('abc-123');
      });
      const req = httpMock.expectOne(r => r.url.includes('/id/abc-123'));
      req.flush({ uid: 'abc-123', title: 'Test' });
    });

    it('should handle server error gracefully', () => {
      service.fetchDoc('bad-uid').subscribe({
        error: err => expect(err.status).toBe(404)
      });
      httpMock.expectOne(r => r.url.includes('/id/bad-uid'))
        .flush('Not found', { status: 404, statusText: 'Not Found' });
    });
  });

## Component test — check signal state, not DOM
  it('should set loading to false after fetch completes', fakeAsync(() => {
    component.loadDocs();
    expect(component.loading()).toBe(true);
    tick();
    expect(component.loading()).toBe(false);
    expect(component.docs().length).toBeGreaterThan(0);
  }));

## Run after generating
  npx nx test <project-name>
  If tests fail, fix the implementation or the test before committing.
```

---

### 8.5 `git-workflow.mdc` (NEW)

```yaml
---
description: Git workflow — branching, commits, PRs
globs: "**/*"
alwaysApply: false
---

# Git Workflow

## Branch naming
  feature/<description>     feature/bulk-export
  fix/<description>         fix/thumbnail-memory-leak
  docs/<description>        docs/update-api-registry
  refactor/<description>    refactor/search-aggregation-service

Never commit directly to main. Always use a feature/fix branch.

## Commit message format (Conventional Commits)
  feat: add bulk export to browse page
  fix: resolve thumbnail blob URL memory leak in app shell
  docs: update api-integrations.md for Blob.BulkDownload
  test: add unit tests for DocumentDetailService.bulkExport
  refactor: extract tag service from document-detail component

## Before committing — always run
  npx nx affected -t lint    (must pass)
  npx nx affected -t build   (must pass)
  npx nx affected -t test    (must pass)

Husky pre-commit hook runs lint automatically. If it fails, fix before retrying.

## PR creation
  gh pr create \
    --title "feat: add bulk export to browse page" \
    --body "$(cat .github/PULL_REQUEST_TEMPLATE.md)" \
    --base main

Always fill the PR template body with:
- What changed and why
- Which files were modified
- Test plan (what to verify)
- Link to related issue/ticket if applicable

## Never
- Never force-push to main
- Never --no-verify to skip hooks
- Never commit .env files
- Never commit node_modules
```

---

### 8.6 `security.mdc` (NEW)

```yaml
---
description: Security rules — enforced on every change
globs: "**/*.ts"
alwaysApply: true
---

# Security Rules

## Credentials
- NEVER hardcode usernames, passwords, API keys, or tokens in TypeScript files
- NEVER commit .env files (they are gitignored — keep them that way)
- NEVER use Basic auth with hardcoded credentials even as fallback defaults
- All sensitive config MUST come from environment variables

## XSS Prevention
- NEVER use innerHTML or outerHTML with user-provided content
- NEVER use DomSanitizer.bypassSecurityTrust* unless the source is guaranteed safe
- Always use Angular's built-in template binding ({{ }}) for user content

## Nuxeo Auth
- NEVER add Authorization headers manually in components — use the interceptor
- NEVER call Nuxeo URLs with fetch() (bypasses the auth interceptor)
- NEVER put credentials in query string parameters

## Blob URLs
- ALWAYS revoke blob URLs created with URL.createObjectURL() in ngOnDestroy
- NEVER store blob URLs as plain strings in component properties without cleanup

## PR blocker
If any of the above are violated, the PR MUST NOT be merged until fixed.
```

---

### 8.7 `bug-patterns.mdc` (NEW)

```yaml
---
description: Known bug patterns — scan every file you touch
globs: "**/*.ts"
alwaysApply: false
---

# Known Bug Patterns

When reading or modifying any file, check for these patterns and fix them:

## Memory leaks
BAD:  this.service.getData().subscribe(data => this.data.set(data));
GOOD: this.service.getData().pipe(takeUntilDestroyed()).subscribe(data => this.data.set(data));

BAD:  const url = URL.createObjectURL(blob); // never revoked
GOOD: const url = URL.createObjectURL(blob);
      // + in ngOnDestroy: URL.revokeObjectURL(url);

## Authenticated content loaded without HttpClient
BAD:  <img [src]="doc.properties['file:content']?.data">
      (browser fetches this directly — no auth header sent)
GOOD: Fetch via DocumentDetailService.fetchBlob() which uses HttpClient
      (interceptor adds auth header) then use createObjectURL

## State not reset on navigation
BAD:  Component has signals that are never reset when route params change
GOOD: Use effect() to watch input() changes and reset all state signals

## Retry blocked by lingering error state
BAD:  error: () => { this.loading.set(false); }
      (loaded flag stays true, user cannot retry)
GOOD: error: () => { this.loading.set(false); this.error.set(true); }

## Copilot will flag these — fix before PR
These patterns trigger Copilot review comments. Fix them proactively.
```

---

### 8.8 `pr-feedback.mdc` (NEW)

```yaml
---
description: How to handle PR review comments from Copilot and reviewers
globs: "**/*"
alwaysApply: false
---

# PR Feedback Handling

When asked to "fix PR comments" or "address review feedback":

1. Fetch all open review comments:
   gh pr view <PR-number> --json reviews,comments \
     | jq '.reviews[] | select(.state == "CHANGES_REQUESTED") | .body'

2. List all inline comments:
   gh api repos/nuxeo/agentic-ui-poc/pulls/<PR-number>/comments \
     | jq '.[] | { path: .path, line: .line, body: .body }'

3. For each comment:
   - Read the file at the specified line
   - Understand what the reviewer wants changed
   - Implement the fix following all Cursor rules
   - Do NOT just suppress linter errors — fix the root cause

4. After all fixes:
   - Run npx nx affected -t lint
   - Run npx nx affected -t build
   - Run npx nx affected -t test
   - Commit with: git commit -m "fix: address PR review comments"
   - Push: git push

5. Reply to each comment with what was done (optional but good practice):
   gh api repos/nuxeo/agentic-ui-poc/pulls/<PR-number>/comments/<comment-id>/replies \
     -f body="Fixed: <brief description of what was changed>"

Common Copilot comments and what they mean:
- "Missing unsubscribe" → add takeUntilDestroyed()
- "Potential XSS" → use Angular template binding, not innerHTML
- "Hardcoded credential" → move to environment variable
- "Race condition" → add stale check before setting signal after async operation
```

---

## 9. GitHub Actions Workflows

### 9.1 Updated `ci.yml` — Enable Tests

Change: un-comment the test step (line 54 in current file)

```yaml
# ADD to ci.yml — replace the commented test step with:
- name: Test affected projects
  run: npx nx affected -t test --base=$NX_BASE --head=$NX_HEAD

- name: Generate coverage report
  run: npx nx affected -t test --coverage --base=$NX_BASE --head=$NX_HEAD
  continue-on-error: true

- name: Post coverage comment
  uses: davelosert/vitest-coverage-report-action@v2
  if: always()
```

---

### 9.2 `pr-auto-fix.yml` (NEW)

```yaml
name: PR Review Summary

on:
  pull_request_review:
    types: [submitted]
  issue_comment:
    types: [created]

jobs:
  collect-review-comments:
    if: |
      (github.event_name == 'issue_comment' && 
       contains(github.event.comment.body, '/fix-comments')) ||
      (github.event_name == 'pull_request_review' &&
       github.event.review.state == 'CHANGES_REQUESTED')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Collect all open review comments
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          PR_NUMBER=${{ github.event.pull_request.number || github.event.issue.number }}

          echo "## Open PR Review Comments" > /tmp/pr-comments-summary.md
          echo "" >> /tmp/pr-comments-summary.md

          gh api repos/${{ github.repository }}/pulls/${PR_NUMBER}/comments \
            | jq -r '.[] | "### \(.path) line \(.line // "N/A")\n\(.body)\n"' \
            >> /tmp/pr-comments-summary.md

          cat /tmp/pr-comments-summary.md

      - name: Post summary as PR comment
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          PR_NUMBER=${{ github.event.pull_request.number || github.event.issue.number }}
          SUMMARY=$(cat /tmp/pr-comments-summary.md)
          gh pr comment ${PR_NUMBER} --body "**Agent Fix Summary Ready**

          The following review comments need to be addressed. 
          Open Cursor Agent and run: 'fix all PR review comments for PR #${PR_NUMBER}'

          ${SUMMARY}"
```

---

### 9.3 `PULL_REQUEST_TEMPLATE.md` (NEW)

```markdown
## What changed and why

<!-- Describe the change in 2-3 sentences -->

## Files modified

<!-- List the key files changed -->

## How to test

<!-- Step-by-step test plan -->

- [ ] Navigate to ...
- [ ] Verify that ...
- [ ] Check that ...

## Checklist

- [ ] `npx nx affected -t lint` passes
- [ ] `npx nx affected -t build` passes
- [ ] `npx nx affected -t test` passes
- [ ] Unit tests written for new code
- [ ] `docs/api-integrations.md` updated (if new Nuxeo endpoint used)
- [ ] `docs/ai-features.md` updated (if AI backend changed)
- [ ] `AGENTS.md` updated (if architecture changed)
- [ ] No hardcoded credentials
- [ ] No direct `<img [src]>` for Nuxeo authenticated content
```

---

## 10. End-to-End Workflow Examples

### 10.1 Workflow A: New Feature

**Intent:** "Add bulk export to search results"

**Step 1 — Developer input:**

```
Cursor Agent: "Add bulk export to search results"
```

**Step 2 — Agent reads context (automatic):**

- Reads `AGENTS.md` → finds `SearchComponent` location, `SelectionService`, existing bulk action pattern in `BrowseComponent`
- Reads `feature-module-scaffold.mdc` → knows dialog pattern
- Reads `nuxeo-api-patterns.mdc` → knows how to call `Blob.BulkDownload` automation

**Step 3 — Agent expands requirement:**

```
Technical spec generated:
1. Add 'Export' to SelectionTopbarComponent actions (libs/shared/ui)
2. Reuse ExportDialogComponent (already exists in libs/shared/ui)
3. Add bulkDownload(uids: string[]) to DocumentDetailService
   → POST /nuxeo/api/v1/automation/Blob.BulkDownload
4. Wire SelectionService.selectedUids() into the export action
5. Unit test: DocumentDetailService.bulkDownload() happy + error path
6. Update docs/api-integrations.md
```

**Step 4 — Agent creates todo list (automatic):**

```
☐ Read SelectionTopbarComponent to understand current action structure
☐ Add bulkDownload() to DocumentDetailService
☐ Add Export action to SelectionTopbarComponent
☐ Wire search component selection into the export button
☐ Write unit test for bulkDownload()
☐ Run: npx nx affected -t lint && test
☐ Update docs/api-integrations.md
☐ git checkout -b feature/bulk-export && git add . && git commit
☐ gh pr create
```

**Step 5 — Agent implements all steps**

**Step 6 — CI runs automatically:**

- Lint → pass
- Build → pass
- Tests → pass (new test verifies bulkDownload)
- CodeQL → scans for security issues
- Copilot → reviews PR

**Step 7 — If Copilot flags issues:**

```
Developer: "fix PR comments"
Agent: reads gh pr view --json reviews → implements fixes → pushes
```

**Step 8 — Developer reviews diff → approves → merges**

**Total human input:** 1 sentence + final PR approval

---

### 10.2 Workflow B: Bug Fix

**Intent:** "Thumbnail images not loading in search results"

**Agent flow:**

1. Reads `bug-patterns.mdc` → immediately suspects direct `<img [src]>` pattern
2. Searches `app-shell.component.html` for `<img` tags
3. Finds `<img [src]="result.thumbnailUrl">` — bypasses auth interceptor
4. Fixes: replaces with `HttpClient`-based fetch via `DocumentDetailService.fetchThumbnail()`
5. Writes regression test: "should fetch thumbnails via HttpClient, not direct src"
6. Commits on `fix/search-thumbnails`, creates PR

**Total human input:** 1 sentence

---

### 10.3 Workflow C: New Developer Onboarding (Any IDE)

**Day 1 for a new developer — regardless of which IDE they use:**

1. Clone repo, run `npm install`
2. Read `AGENTS.md` — 10 minutes to understand full architecture
3. Open their AI assistant of choice:
   - **Cursor:** `00-master-context.mdc` loads `AGENTS/` automatically
   - **Claude Code:** `CLAUDE.md` loads `AGENTS/` automatically
   - **Windsurf:** `.windsurfrules` loads `AGENTS/` automatically
   - **VS Code + Copilot:** `copilot-instructions.md` provides context for PR reviews
   - **JetBrains AI:** Type `@AGENTS.md` at start of chat session
4. Type first task: "Add a notification bell for workflow tasks to the app header"
5. Agent knows (from `AGENTS/`):
   - Where the header is (`AppShellComponent`)
   - How to call the task API (`TaskService.getTasks()`)
   - The Angular signal patterns to use
   - How to add a new feature dialog
6. Agent scaffolds the feature with zero onboarding friction

**Result:** New developer ships code on day 1 without needing architecture explanation from a colleague — regardless of their IDE.

---

### 10.4 Workflow D: PR Review Response

**After Copilot posts review comments:**

```
Developer: "fix all Copilot review comments on PR #42"

Agent:
1. gh pr view 42 --json reviews,comments
2. Parses:
   - "Missing unsubscribe in search.ts line 145"
   - "Potential XSS in document-detail.html line 89"
   - "Hardcoded fallback in config.ts line 12"
3. Fixes each one:
   - Adds takeUntilDestroyed() to subscription in search.ts
   - Replaces innerHTML with Angular template binding in document-detail.html
   - Moves fallback to environment variable in config.ts
4. Runs lint + build + test
5. git commit -m "fix: address Copilot review comments"
6. git push
```

**Total human input:** 1 sentence

---

### 10.5 Workflow E: Scheduled Maintenance (Tier 3 — No Developer Input)

**What happens every Monday at 06:00 UTC — automatically:**

```
1. Dead Code Agent (dead-code.yml):
   → Runs: npx knip
   → Finds: 3 unused exports in libs/shared/ui
   → Opens GitHub Issue: "Dead code report 2026-04-13"

2. AGENTS.md Staleness Agent (staleness-check.yml):
   → Detects: audit.service.ts exists but is not in AGENTS/01-services.md
   → Opens GitHub Issue: "AGENTS/ out of date: audit.service.ts missing from 01-services.md"

3. Stale Branch Agent (stale.yml — runs daily):
   → Finds: branch fix/old-bug has no activity for 14 days
   → Labels: adds "stale" label to the open PR
```

**Developer sees on Monday morning:** 2 GitHub Issues and 1 stale PR label — all created with zero human input.

**Total human input:** Zero.

---

## 11. Implementation Plan

### Phase 0 — Tool-Agnostic Foundation (Day 1) — Prerequisite

Before creating Cursor rules, establish the universal context layer so all IDE users benefit from day one.

| Task                                               | File                            | Effort  |
| -------------------------------------------------- | ------------------------------- | ------- |
| Create `AGENTS/` directory with 11 knowledge files | `AGENTS/00` through `AGENTS/10` | 3 hours |
| Create `CLAUDE.md` (Claude Code adapter)           | `/CLAUDE.md`                    | 15 min  |
| Create `.windsurfrules` (Windsurf adapter)         | `/.windsurfrules`               | 15 min  |
| Add JetBrains instructions to `README.md`          | `/README.md`                    | 15 min  |
| Create `scripts/agent-context.sh` (CLI fallback)   | `/scripts/agent-context.sh`     | 15 min  |

**Total Phase 0:** ~4 hours. Delivers cross-tool AI context immediately.

---

### Phase 1 — Context Layer (Week 1) — Highest ROI

The context layer pays dividends immediately for every subsequent task. Phase 0 is a prerequisite — `AGENTS/` files must exist before creating the Cursor rules that reference them.

| Task                                                          | File              | Effort  |
| ------------------------------------------------------------- | ----------------- | ------- |
| Write `AGENTS.md` (summary, references `AGENTS/`)             | `/AGENTS.md`      | 2 hours |
| Create `00-master-context.mdc` (references `AGENTS/`)         | `.cursor/rules/`  | 30 min  |
| Create `nuxeo-api-patterns.mdc`                               | `.cursor/rules/`  | 1 hour  |
| Create `feature-module-scaffold.mdc`                          | `.cursor/rules/`  | 1 hour  |
| Create `git-workflow.mdc`                                     | `.cursor/rules/`  | 30 min  |
| Create `security.mdc`                                         | `.cursor/rules/`  | 30 min  |
| Create `bug-patterns.mdc`                                     | `.cursor/rules/`  | 1 hour  |
| Write agent skill files (4)                                   | `.cursor/skills/` | 2 hours |
| Add `PULL_REQUEST_TEMPLATE.md`                                | `.github/`        | 30 min  |
| Expand `copilot-instructions.md` with Nuxeo-specific patterns | `.github/`        | 1 hour  |

**Total Phase 1:** ~10 hours

---

### Phase 2 — Test Automation (Week 2)

| Task                                   | File                        | Effort  |
| -------------------------------------- | --------------------------- | ------- |
| Un-comment test step in `ci.yml`       | `.github/workflows/ci.yml`  | 15 min  |
| Add coverage reporting to CI           | `.github/workflows/ci.yml`  | 1 hour  |
| Create `test-generation.mdc`           | `.cursor/rules/`            | 1 hour  |
| Write unit tests for existing services | `libs/shared/nuxeo-client/` | 4 hours |
| Write unit tests for key components    | `libs/features/*/`          | 4 hours |

**Total Phase 2:** ~10 hours

---

### Phase 3 — PR Automation (Week 3)

| Task                          | File                    | Effort  |
| ----------------------------- | ----------------------- | ------- |
| Create `pr-feedback.mdc`      | `.cursor/rules/`        | 1 hour  |
| Create `pr-auto-fix.yml`      | `.github/workflows/`    | 2 hours |
| Create workflow playbooks     | `docs/agent-workflows/` | 2 hours |
| Test full end-to-end workflow | —                       | 2 hours |

**Total Phase 3:** ~7 hours

---

### Phase 4 — Ongoing Maintenance (Continuous)

- Update `AGENTS/` files as part of every PR that changes architecture, services, or APIs
- Add new bug patterns to `AGENTS/08-bug-patterns.md` as they're discovered
- Refine Cursor rules based on common agent mistakes
- Quarterly review of all files to remove stale or redundant guidance
- Sync `AGENTS/` changes to `CLAUDE.md`, `.windsurfrules`, and `copilot-instructions.md` adapters

---

### Phase 5 — Tier 2/3 Agent Automation (Week 4–5)

| Task                                                  | File                                    | Effort    |
| ----------------------------------------------------- | --------------------------------------- | --------- |
| Add bundle size check to `ci.yml`                     | `.github/workflows/ci.yml`              | 1 hour    |
| Add `markdown-link-check` step to `ci.yml`            | `.github/workflows/ci.yml`              | 30 min    |
| Create `dependabot.yml` for npm updates               | `.github/dependabot.yml`                | 30 min    |
| Create `stale.yml` (Stale Branch Agent)               | `.github/workflows/stale.yml`           | 30 min    |
| Create `dead-code.yml` (Dead Code Agent)              | `.github/workflows/dead-code.yml`       | 1 hour    |
| Create `changelog.yml` (Changelog Agent)              | `.github/workflows/changelog.yml`       | 1 hour    |
| Create `staleness-check.yml` (AGENTS.md drift)        | `.github/workflows/staleness-check.yml` | 1.5 hours |
| Create `release.yml` (Release Agent)                  | `.github/workflows/release.yml`         | 1.5 hours |
| Add API drift check step to `ci.yml`                  | `.github/workflows/ci.yml`              | 1 hour    |
| Document all new workflows in `docs/agent-workflows/` | `docs/agent-workflows/`                 | 1 hour    |

**Total Phase 5:** ~9.5 hours

---

## 12. Required Tools

| Tool                         | Status             | Cost             | Purpose                                |
| ---------------------------- | ------------------ | ---------------- | -------------------------------------- |
| Cursor Agent (Claude Sonnet) | ✅ Active          | Already licensed | Tier 1 + Tier 4 IDE agents             |
| Claude Code                  | Optional           | Free/paid        | Tier 1 + Tier 4 for non-Cursor users   |
| Windsurf                     | Optional           | Free/paid        | Tier 1 + Tier 4 for non-Cursor users   |
| GitHub Copilot Chat          | ✅ Active          | Already licensed | Tier 1 + Tier 4 in VS Code / JetBrains |
| GitHub Copilot PR Review     | ✅ Active          | Already licensed | Tier 2 PR code review                  |
| GitHub CodeQL                | ✅ Active          | Free             | Tier 2 security scanning               |
| GitHub Dependabot            | ✅ Available       | Free             | Tier 3 vulnerability agent             |
| Nx CLI                       | ✅ Active          | Free             | Affected builds/tests in all tiers     |
| Vitest                       | ✅ Active          | Free             | Test runner (Tier 2 CI)                |
| GitHub Actions               | ✅ Active          | Free tier        | All Tier 2 + Tier 3 agents             |
| `gh` CLI                     | ✅ Available       | Free             | PR management, issue creation          |
| `jq`                         | ✅ Available in CI | Free             | JSON parsing for PR comments           |
| `knip`                       | ➕ New             | Free (npm)       | Dead Code Agent                        |
| `git-cliff`                  | ➕ New             | Free (npm)       | Changelog Agent                        |
| `markdown-link-check`        | ➕ New             | Free (npm)       | Broken Link Agent                      |
| `@lhci/cli`                  | ➕ New             | Free (npm)       | Performance Agent (Lighthouse CI)      |
| `@axe-core/playwright`       | ➕ New             | Free (npm)       | Accessibility Agent                    |
| `actions/stale@v9`           | ➕ New             | Free (GH Action) | Stale Branch Agent                     |

**No new infrastructure. No new licenses. Four npm dev dependencies and two free GitHub Actions added.**

---

## 13. Risks & Limitations

### Technical Risks

| Risk                                            | Severity | Probability | Mitigation                                                                                 |
| ----------------------------------------------- | -------- | ----------- | ------------------------------------------------------------------------------------------ |
| `AGENTS/` files go stale                        | High     | High        | AGENTS.md Staleness Agent (Tier 3) auto-detects drift; PR checklist requires update        |
| Agent hallucinates Nuxeo API payloads           | High     | Medium      | `AGENTS/02-nuxeo-apis.md` provides exact examples; CI build catches compilation errors     |
| Generated tests pass but miss edge cases        | Medium   | High        | Tests are a minimum floor — complex business logic still needs human test design           |
| Agent makes cross-feature imports               | Medium   | Low         | Nx boundary lint rule catches this immediately in CI                                       |
| Context window limit on very large sessions     | Medium   | Low         | `AGENTS/` files are scoped and concise; IDE semantic search handles file-level context     |
| PR feedback loop still requires a human trigger | Low      | Certain     | Reduced to one sentence; full zero-human trigger requires webhook infrastructure           |
| AGENTS/ files inconsistent across tools         | Medium   | Medium      | Single source in `AGENTS/`; thin adapters reference it — update once, propagate everywhere |
| Tier 2/3 CI agents produce false positives      | Low      | Medium      | All Tier 2 checks use `continue-on-error: true` initially; tuned before strict enforcement |

### Organizational Risks

| Risk                                              | Mitigation                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Developers over-trust agent output without review | Final PR approval remains human — enforce this                                                  |
| `AGENTS/` directory becomes a bureaucratic burden | Keep files focused (one topic per file, max 3 pages each); automate updates via staleness agent |
| Team uses system for architecture decisions       | Document clearly: agent executes, humans architect                                              |
| Non-Cursor developers feel left out               | Tool-agnostic architecture (Section 5) ensures equal context quality for all IDEs               |
| Tier 3 agents open too many noisy issues          | Tune schedules and thresholds; suppress known-false-positives via `.knip.json` etc.             |

### What This System Cannot Do

1. **It does not operate autonomously without a human trigger.** Minimum input is still one sentence per task. True zero-human automation requires a much more complex orchestration layer (LangGraph, AutoGen, etc.) and is not appropriate for a production codebase today.

2. **It does not guarantee correctness.** Human PR approval remains mandatory. The agent's output is a high-quality first draft, not a certified artifact.

3. **It does not make architectural decisions.** When a new major pattern is needed, a human architect decides and documents it, then agents replicate it.

4. **Generated tests do not replace thoughtful test design.** Agents generate tests that pass the happy path and obvious error path. Complex business logic edge cases still require human test design.

---

## 14. Definition of Done

### Phase 0 — Tool-Agnostic Foundation

- [ ] `AGENTS/` directory created with all 11 knowledge files (`00` through `10`)
- [ ] `CLAUDE.md` created at repo root
- [ ] `.windsurfrules` created at repo root
- [ ] `scripts/agent-context.sh` created
- [ ] `README.md` updated with "Working with AI Assistants" IDE guide

### Phase 1 — Cursor Context Layer

- [ ] `AGENTS.md` written and committed
- [ ] All 8 Cursor rules created in `.cursor/rules/`
- [ ] Agent skill files created in `.cursor/skills/`
- [ ] `PULL_REQUEST_TEMPLATE.md` added to `.github/`
- [ ] `copilot-instructions.md` expanded with Nuxeo-specific patterns

### Phase 2 — Test Automation

- [ ] Test step un-commented in `ci.yml`
- [ ] Coverage reporting step added to `ci.yml`
- [ ] Unit tests written for all existing shared services

### Phase 3 — PR Automation

- [ ] `pr-auto-fix.yml` workflow created
- [ ] Agent workflow playbooks written in `docs/agent-workflows/`
- [ ] End-to-end test: one full feature built using only 1-sentence intent

### Phase 5 — Tier 2/3 Agents

- [ ] Bundle size check in `ci.yml`
- [ ] `markdown-link-check` in `ci.yml`
- [ ] `dependabot.yml` enabled
- [ ] `stale.yml` workflow active
- [ ] `dead-code.yml` workflow running weekly
- [ ] `changelog.yml` generating on every `main` merge
- [ ] `staleness-check.yml` monitoring `AGENTS/` drift
- [ ] `release.yml` workflow tested with manual dispatch

### For the agentic system (ongoing)

- Every PR includes a check: "Did you update `AGENTS/`?"
- Every new service method has a unit test
- CI test step is passing (not just lint + build)
- New developers on **any** IDE can contribute on day 1 using `AGENTS.md` + `AGENTS/`
- Tier 2 CI checks are all green on the `main` branch

---

_This document describes the design. Implementation begins with Phase 0 (Tool-Agnostic Foundation) followed by Phase 1 (Context Layer). The system is designed to work for all developers regardless of IDE._
