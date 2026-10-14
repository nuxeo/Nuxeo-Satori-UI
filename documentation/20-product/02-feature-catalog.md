---
title: Feature Catalog
parent: Product
order: 2
last_reviewed: 2026-10-08
repo_commit: 2898046
audience: product
---

# Feature Catalog

> **Last reviewed:** 2026-10-08 · **Repository:** `2898046` (`feature/nxsat-308-ci-cold-cache-tooling`)
> Only the repository links were re-verified at that commit: made relative rather than pinned to
> `feature/adf-hx-browse-poc`, every target present. The rest of the page as of 2026-08-24 · `77265f9`.
> Derived from the 23 application routes, the 9 feature libraries and the 25 Nuxeo services.
> Every row is traceable to code. Where a capability is present but limited, the limit is
> stated rather than omitted.

---

## How to read this

- **Status: Shipped** — implemented and exercised by evidence or E2E.
- **Status: Shipped, limited** — works, with a stated boundary.
- **Status: Present, unproven** — code exists; no evidence run or test covers it.
- **Status: Backend absent** — the client exists; the server-side implementation is in a
  **separate package not in this repository**.
- **Status: Reserved** — declared, nothing reads it. Not a capability.

---

## 1. Content — browse, organise, act

| Feature              | Description                                                                  | User        | Problem solved                            | Customer value                                                            | Depends on                              | Status      |
| -------------------- | ---------------------------------------------------------------------------- | ----------- | ----------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------- | ----------- |
| Repository browse    | Folder navigation with breadcrumbs, grid/list/simple views, sortable columns | All         | Find content in a hierarchy               | Familiar navigation without Web UI's Polymer stack                        | `browse.service`, OpenSearch            | **Shipped** |
| adf-hx browse        | The same surface on the real `HxpDocumentListComponent`                      | All         | Shared component investment with Alfresco | Less bespoke UI to maintain                                               | 12 adf-hx API ports                     | **Shipped** |
| Folder tree          | Secondary nav tree, synced with the main view                                | All         | Orient within deep hierarchies            |                                                                           | `browse-context.service`                | **Shipped** |
| Configurable columns | 12 packaged columns, per-user column settings dialog                         | All         | See the metadata that matters             | **Layer 1 addressable** — a manifest can change columns without a rebuild | `documentList` slot                     | **Shipped** |
| Create & import      | Create documents; single and bulk import with properties                     | Contributor | Get content in                            |                                                                           | `document-import.service` (1,054 lines) | **Shipped** |
| Drag-and-drop upload |                                                                              | Contributor |                                           |                                                                           |                                         | **Shipped** |
| Bulk actions         | Multi-select, bulk delete with confirmation                                  | Contributor | Act on many at once                       | **Layer 1 addressable** via `bulk-actions`                                | `selection.service`                     | **Shipped** |
| Clipboard            | Copy/move across the repository                                              | Contributor | Reorganise                                |                                                                           | `clipboard-target.service`              | **Shipped** |
| Trash                | Browse, filter and restore deleted content                                   | Contributor | Recover mistakes                          |                                                                           | `trash.service`, `trash-filter.service` | **Shipped** |
| Collections          | Create collections, add documents, collection detail                         | All         | Ad-hoc grouping across the hierarchy      |                                                                           | `collection.service`                    | **Shipped** |
| Favorites            |                                                                              | All         | Quick return                              |                                                                           |                                         | **Shipped** |
| Personal space       | Per-user workspace                                                           | All         | Private drafting                          |                                                                           |                                         | **Shipped** |
| Recently viewed      |                                                                              | All         | Resume work                               |                                                                           |                                         | **Shipped** |
| Folder picker        | Reusable destination chooser                                                 | Contributor | Move/copy targeting                       |                                                                           |                                         | **Shipped** |

## 2. Document detail

| Feature              | Description                                                                                                                                                                | Problem solved                    | Depends on                                 | Status                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------ | -------------------------------- |
| Metadata view & edit | Properties panel, edit dialog — fixed Dublin Core fields; custom-type fields are shown read-only by per-type layouts, not edited                                           | See and change document data      | `edit-document-dialog`                     | **Shipped, limited**             |
| Per-type layouts     | The Properties panel shows each type's own schema fields: a layout file a configuration package contributes per type (sections or tabs), or one generated from the schemas | A Claim shows its claim fields    | A configuration package (NXSAT-312)        | **Shipped, read-only**           |
| Preview / viewer     | Inline preview; ARender integration for rich formats                                                                                                                       | Read without downloading          | ARender (Docker), `arender.service`        | **Shipped**                      |
| Per-type View        | A manifest `documentView` entry replaces the View tab body for the documents its rule matches                                                                              | One type opens on its own view    | A Layer 2 registered component             | **Shipped, no packaged entries** |
| Versions             | Create a version, restore, manage-versions dialog                                                                                                                          | Audit and rollback                | adf-hx version ports                       | **Shipped**                      |
| Permissions          | View local ACLs, add/update/delete permissions, external sharing, notification email                                                                                       | Control access                    | `principal-permissions.service`, 4 dialogs | **Shipped, limited** — see below |
| History / audit      | Activity log with event labels                                                                                                                                             | Who did what                      | `administration.service` audit APIs        | **Shipped**                      |
| Comments             | Threaded comments with edit/delete on replies                                                                                                                              | Collaborate                       |                                            | **Shipped**                      |
| Publishing           | Publish dialog                                                                                                                                                             | Release content to a section      |                                            | **Shipped**                      |
| Attachments          | Add, replace, remove, preview                                                                                                                                              | Multi-file documents              | `document-detail.service` (834 lines)      | **Shipped**                      |
| Note editor          | Rich-text notes, HTML/text/XML formats, source view                                                                                                                        | Author in place                   | Quill, DOMPurify                           | **Shipped**                      |
| Nuxeo Drive          | Sync dialog, synchronisation roots                                                                                                                                         | Desktop sync                      | `nuxeo-drive.service`                      | **Shipped**                      |
| Add to collection    |                                                                                                                                                                            | Organise from the document        |                                            | **Shipped**                      |
| Tags                 | Tagging with autocomplete                                                                                                                                                  | Classify                          | `tag.service`                              | **Shipped**                      |
| Document compare     | Side-by-side field comparison                                                                                                                                              | Spot differences between versions | `document-compare.utils` (320 lines)       | **Shipped**                      |

> **Permissions limitation.** The UI reads and displays permissions and can add, update and
> delete them. But the Layer 1 **rule context** still carries selection _ids_ rather than
> documents, so `app.rules.canWriteSelection` and `canRemoveSelection` answer `false`
> everywhere. Bulk permission-gated actions are therefore not manifest-gateable yet.
> Documented in [`docs/extension-reference.md`](../../docs/extension-reference.md).

## 3. Search

| Feature                     | Description                                        | Problem solved             | Status                             |
| --------------------------- | -------------------------------------------------- | -------------------------- | ---------------------------------- |
| Full-text search            | Query with results count, sorting, grid/list views | Find by content            | **Shipped**                        |
| Faceted search              | Aggregations, filters drawer                       | Narrow results             | **Shipped**                        |
| Saved searches              |                                                    | Repeat a query             | **Shipped**                        |
| Search queue                | Queue results for batch action                     | Work through a result set  | **Shipped**                        |
| adf-hx search               | Search on the adf-hx surface                       | Shared components          | **Shipped**                        |
| NXQL admin search           | Raw NXQL console for administrators                | Diagnose                   | **Shipped**                        |
| **Natural-language search** | "documents I edited last week" → NXQL              | No query language to learn | **Backend absent** — `AI.NlToNxql` |

> **Search hardening.** The query path escapes literals before interpolation
> (`hxql-literal.ts`, removed with the adf-hx routes; NXQL literals go through
> [`nxql.utils.ts`](../../libs/shared/nuxeo-client/src/lib/utils/nxql.utils.ts)).
> An adversarial review found an injection that returned 155 documents against 0 for the
> plain term, defeating the `isVersion`/`isTrashed` hygiene filters. Nuxeo's ACL filter
> bounded the impact — no unauthorised documents were readable — but versions and trashed
> documents became visible. Fixed, with an E2E regression guard.

## 4. Administration

| Feature                                                           | Status                |
| ----------------------------------------------------------------- | --------------------- |
| Users & groups — list, detail, create/edit, change password       | **Shipped**           |
| Vocabularies — hierarchical, add/edit/delete entries, l10n labels | **Shipped**           |
| Audit log browser                                                 | **Shipped**           |
| Analytics page                                                    | **Present, unproven** |
| Cloud services / OAuth2 providers & tokens                        | **Shipped**           |
| NXQL search console                                               | **Shipped**           |
| Authorized applications                                           | **Shipped**           |
| Themes settings                                                   | **Shipped**           |
| Profile & Nuxeo Drive settings                                    | **Shipped**           |

Gated by `adminGuard` → `hasAdministrationAccess()`, and by
`app.rules.hasAdministrationAccess`, which is one of the three **fail-closed** rules.

## 5. Tasks & workflow

| Feature                                                    | Status                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Task list and task detail, with the target document banner | **Shipped**                                                       |
| Task actions (approve/reject/delegate as exposed by Nuxeo) | **Shipped, limited** — workflow is **out of Beta scope** (RFC §1) |
| Workflow models and instances                              | `workflow.service` exists; **Present, unproven**                  |

## 6. Knowledge Discovery & Enrichment

| Feature               | Description                                                 | Status                                                                                                              |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Knowledge Discovery   | Conversational discovery over content, with citations       | **Shipped, limited** — needs the KD backend. See [`docs/knowledge-discovery.md`](../../docs/knowledge-discovery.md) |
| Content Lake ingest   | Ingest documents, track status, backfill, detect duplicates | **Shipped** — `content-lake-ingest.service`                                                                         |
| Knowledge Enrichment  |                                                             | **Shipped, limited** — needs the KE backend                                                                         |
| Expired queue         | Documents past expiry                                       | **Shipped**                                                                                                         |
| Assets / DAM surfaces | Asset search results, asset queue, aggregations             | **Shipped**                                                                                                         |

## 7. Runtime AI features — 12 operations

**All 12 depend on a backend package that is not in this repository.** Absent package ⇒
HTTP 500, which is expected. Feature-flagged client-side
(`ai-feature-flag.service`, `sessionStorage` key `ai-features-enabled`).

| Operation           | Capability                                | Status             |
| ------------------- | ----------------------------------------- | ------------------ |
| `AI.NlToNxql`       | Natural language → NXQL, plus suggestions | **Backend absent** |
| `AI.Summarize`      | Document summary                          | **Backend absent** |
| `AI.SuggestTags`    | Tag suggestions                           | **Backend absent** |
| `AI.Classify`       | Document classification                   | **Backend absent** |
| `AI.Similar`        | Similar documents                         | **Backend absent** |
| `AI.Chat`           | Conversational assistant                  | **Backend absent** |
| `AI.Insights`       | Document insights                         | **Backend absent** |
| `AI.Sentiment`      | Sentiment                                 | **Backend absent** |
| `AI.Anomalies`      | Anomaly detection                         | **Backend absent** |
| `AI.AuditSummarize` | Summarise audit history                   | **Backend absent** |
| `AI.AuditNlFilter`  | NL filtering of audit entries             | **Backend absent** |
| `AI.NlPermissions`  | NL permission queries                     | **Backend absent** |

> This is the single biggest gap between how the product **demos** and what this repository
> **contains**. The client is thin and complete; the intelligence is elsewhere. See
> [Runtime AI Features](../30-engineering/10-runtime-ai-features.md).

## 8. Platform & extensibility — the differentiating capability

| Feature                      | Description                                                                                                                                                                                                                                       | Customer value                                                                                                | Status                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Layer 0 configuration**    | Theme tokens, branding and logo, languages in a `bootstrap` fragment of the customer's package. The logo replaces the header word mark and the login logo, not the navigation-rail mark, the "Content Innovation Cloud" rail title or the favicon | Rebrand with no code and no rebuild of the application; **survives upgrade**                                  | **Shipped**                                         |
| **Layer 1 manifest**         | JSON in a `manifest` fragment of the customer's package: add slot entries, override descriptors by ID, feature toggles                                                                                                                            | Reconfigure the addressable surface with no rebuild of the application; versioned with the customer's package | **Shipped**                                         |
| **52 registered IDs**        | 17 navbar, 15 rules, 3 sidebar, 1 route, plus actions and components                                                                                                                                                                              | A documented, drift-gated contract                                                                            | **Shipped**                                         |
| 9 extension slots            |                                                                                                                                                                                                                                                   |                                                                                                               | **6 Populated, 3 resolve with no packaged entries** |
| **`@nuxeo-satori/platform`** | 4 published entry points, 10 peers                                                                                                                                                                                                                | Build extensions against a versioned API                                                                      | **Shipped**, not yet published                      |
| **App template**             | Forkable, ships no design system                                                                                                                                                                                                                  | Bring your own design system                                                                                  | **Shipped**                                         |
| **5 Nx generators**          | Configuration package, library, rule, action, component — shipped inside the package                                                                                                                                                              | Correct, registered, tested scaffolding by default                                                            | **Shipped**                                         |
| **Customer guardrail**       | 5 checks a customer runs in their own CI                                                                                                                                                                                                          | An agent can verify its own output                                                                            | **Shipped**                                         |
| **Upgrade rehearsal**        | Proves a Layer 0/1/2 customisation survives a version bump                                                                                                                                                                                        | The upgrade promise is tested, not asserted                                                                   | **Shipped**                                         |
| Document-type rules          | `app.rules.isType`, `app.rules.hasFacet` — Web UI `nuxeo-filter` type and facet                                                                                                                                                                   | Different tabs and actions per Case, Claim or Member — document detail, not browse columns                    | **Shipped**                                         |
| Rule composites              | `core.every`, `core.some`, `core.not`, `core.true`, `core.false` — ACA-compatible                                                                                                                                                                 | Manifests written against ACA docs work                                                                       | **Shipped**                                         |
| Fail-closed security rules   | 3 rules deny when unregistered                                                                                                                                                                                                                    | A registration gap cannot expose Administration                                                               | **Shipped**                                         |

## 9. Cross-cutting

| Feature                                                                            | Status                                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Authentication — Basic, SSO-cookie detection, share tokens, session-expiry warning | **Shipped**                                                                                |
| Authorisation — route guards, admin guard, power-user detection                    | **Shipped**                                                                                |
| i18n — `@ngx-translate`, layered catalogues incl. adf-core and adf-hx              | **Shipped**                                                                                |
| Runtime theming from Layer 0 tokens                                                | **Shipped**                                                                                |
| Accessibility                                                                      | **Shipped** — WCAG 2.1 AA met on 15 scanned cases; `KNOWN_VIOLATIONS` empty                |
| Notification email on permission grant                                             | **Shipped** — Mailpit locally                                                              |
| Marketplace packaging with upgrade-safe config                                     | **Shipped** — upgrade with customer configuration packages installed rehearsed (NXSAT-312) |

---

## Capabilities hidden in the tooling

Easy to miss, and part of the product for a customer who forks:

| Capability                                             | Where                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| A customer's agent can scaffold a conforming extension | 5 generators, shipped in the package                                   |
| …and verify its own work before human review           | `check-extension-library.mjs`, 5 checks                                |
| …guided by a versioned knowledge base                  | `libs/platform/AGENTS.md` + the extension reference, shipped as assets |
| Contract drift is detectable                           | `beta:reference` — fails in **both** directions                        |
| Upgrade safety is testable by the customer             | The rehearsal pattern is reproducible in their CI                      |

---

## What is deliberately out of scope for Beta

From RFC §1: **workflow, users and groups, administration and publishing are out of scope**
for the Beta slice.

Note the tension worth flagging to product: administration and publishing surfaces **are
implemented** in this repository (see §4 above, ~7.3k lines) even though the RFC scopes them
out. That is extra delivered value, but it is also surface area that is not covered by the
Beta quality bar — `administration` sits at 62.1% line coverage with 3 spec files.
