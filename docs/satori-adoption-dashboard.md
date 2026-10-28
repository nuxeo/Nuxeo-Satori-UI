# Satori Adoption Dashboard Integration

## Current State

**Do not trust the numbers below without checking the date.** They are a snapshot, and the first
version of this table was believed for long enough to be wrong by 26 points: it still said 73.11,
with 513 Material icons and 167 overrides, after the icon migration and the override cleanup had
both landed. The command is the source of truth, and it takes about a minute:

```bash
npm run satori:check          # the breakdown below
npm run satori:score          # the number alone
npx sdsc check all --json     # the snapshot the dashboard reads
```

Measured 2026-10-28, from `npx sdsc check all --json`:

| Metric                | Value                        | Check |
| --------------------- | ---------------------------- | ----- |
| **Adoption Score**    | **99.69**                    |       |
| Angular version       | 22.2.3                       | ✅    |
| Satori UI version     | 1.0.0-alpha.171              | ✅    |
| Design language       | 3.0 — all MDS2 checks pass   | ✅    |
| Icons                 | 6 Material font, 492 Satori  | ❌\*  |
| Componentry           | 0 legacy of 1,604 components | ✅    |
| DS-internal overrides | 1 unsuppressed (of 155)      | ❌†   |
| A11y overrides        | 0 — not penalised            | —     |

\* The icon check fails, but five of its six findings are a reverted experiment and one is not
cheap — see [The 6 icons are not a migration backlog](#the-6-icons-are-not-a-migration-backlog).
Do not read that ❌ as a backlog item.

† One **unsuppressed** finding. 154 further overrides are suppressed with
`stylelint-disable-next-line` across 32 files, so 167 → 1 was largely suppression rather than
removal — see [What is actually left](#what-is-actually-left--and-what-1-override-does-not-mean).

Of the 1,604 components the checker counts, 100 are Satori and 1,261 Material. Neither number
moves the score: adoption measures _conformance_ — supported versions, the MDS3 design language,
Satori's SVG icons rather than Material's font icons, and CSS that does not reach into design-system
internals. A Material component used correctly costs nothing; one overridden CSS internal does.

## Dashboard

The central Satori Adoption Dashboard lives at:
`https://sturdy-barnacle-ozo3pr1.pages.github.io/?path=/story/satori-adoption-dashboard--satori-adoption-dashboard`

It is an app (`apps/satori-adoption-dashboard`) in the Satori Design System monorepo. It reads
adoption snapshots from an `adoption-data/` directory and displays scores over time for all
registered products.

### Data flow

```
Your CI                     Dashboard Repo                  GitHub Pages
─────────                   ──────────────                  ────────────
sdsc check all --json  →  adoption-data/<product>/        → Dashboard reads
                          └── 2026-10-25.json               & renders scores
                          repos.json (product registry)
```

## How to Register

1. **Generate a snapshot locally:**

   ```bash
   npm run satori:check          # human-readable
   npm run satori:score          # score only
   npx sdsc check all --json     # JSON for the dashboard
   ```

2. **Ask the Satori team** to add this product to `adoption-data/repos.json` in the dashboard
   repo. Provide:
   - Product name: `Nuxeo-UI`
   - Snapshot contract version: `0.0.0` (current)
   - Any KPI exclusions (none currently)

3. **Set up CI** to push dated snapshots:
   ```yaml
   - name: Satori adoption snapshot
     run: npx sdsc check all --json --output adoption-snapshot.json
   - name: Upload snapshot
     # Push to dashboard repo or use webhook — confirm mechanism with Satori team
   ```

## Tooling Installed

| Package                                        | Version         | Purpose                       |
| ---------------------------------------------- | --------------- | ----------------------------- |
| `@hylandsoftware/satori-design-system-checker` | 1.0.0-alpha.171 | CLI adoption scoring (`sdsc`) |
| `@hylandsoftware/satori-lint`                  | 1.0.0-alpha.171 | ESLint + Stylelint rules      |
| `@hylandsoftware/satori-migrations`            | 1.0.0-alpha.171 | Angular/Nx schematics         |

### npm Scripts

| Script                 | What it does                             |
| ---------------------- | ---------------------------------------- |
| `npm run satori:check` | Full SDSC compliance report              |
| `npm run satori:score` | Adoption score number                    |
| `npm run satori:icons` | List distinct Material icons to migrate  |
| `npm run lint:styles`  | Run Stylelint with Satori adoption rules |

### Configuration files

- **`.sdscrc.json`** — SDSC product prefixes and ignore paths
- **`.stylelintrc.mjs`** — Stylelint with Satori adoption rules (overrides as warnings)
- **`eslint.config.mjs`** — ESLint with `satori-lint/flat/recommended` (icon rule as warning)

## Score Breakdown

The score weights six KPIs. Four pass outright; two have a remainder:

| KPI                    | Check | Remainder               | Is it work?                    |
| ---------------------- | ----- | ----------------------- | ------------------------------ |
| Angular version        | ✅    | —                       | Already compliant              |
| Satori UI version      | ✅    | —                       | Already compliant              |
| Design language (MDS3) | ✅    | —                       | All MDS2 checks passing        |
| Icon adoption          | ❌    | 6 Material font icons   | Mostly **no** — see below      |
| Componentry            | ✅    | —                       | No legacy component violations |
| Styling hygiene        | ❌    | 1 unsuppressed override | Yes, but read the caveat below |

The per-KPI weights are the checker's, not ours, so this table deliberately gives raw counts rather
than percentages. An earlier version quoted "0%" and "~82%" against figures that no longer held,
which made both the weighting and the gap look authoritative when neither had been checked.

### The 6 icons are not a migration backlog

This section used to say "migrate to Satori SVG icons", and the heading above used to say "Path to
100". Both were wrong. `sdsc check icons --debug` gives the six, and five of them are deliberate:

| Where                            | Form                                  | Verdict                     |
| -------------------------------- | ------------------------------------- | --------------------------- |
| `banner.component.html:1`        | `{{ icon() }}` — tone icon            | Deliberate                  |
| `banner.component.html:17/32/47` | `{{ action.icon }}` — caller-supplied | Deliberate                  |
| `chip-set.component.html:15`     | `cancel` literal                      | Deliberate                  |
| `status-tag.component.html:2`    | `{{ icon() }}` — status icon          | Migratable, but not cheaply |

`banner` and `chipSet` are the two primitives of thirteen with **no Satori twin yet**.
`provide-nxs-satori-components.ts` is explicit that this is a gap and not a decision — they "keep
their Material implementations here, **until their Satori wrappers are written**" — and
`docs/extension-reference.md` §6a says they "have no Satori wrapper **yet**". Do not read the rows
above as an architectural ban on Satori implementations for these two.

What is settled is the attempt, which NXSAT-677 already made and reverted:

> The chip set and banner are registered on Material only, and their Storybook registers no Satori
> SVG icons, so a `circle_x` or `svgIcon` name rendered blank and logged lookup errors. Use the
> Material ligatures instead.

So five of the six are a reverted experiment rather than untouched work: switching them back today
re-breaks the rendering. They become migratable when those wrappers are written, not before.

`status-tag` is the exception, with a caveat. It has a Satori twin, but that only takes effect for
callers resolving through the extension registry after `provideNxsSatoriComponents()`. Anything
importing `NxsStatusTagComponent` directly still renders the Material one with its ligature —
`status-tag.stories.ts` does, and the `:satori` Storybook configuration only swaps the stylesheet
(`project.json` overrides `outputDir` and `styles`, nothing else), so the ligature does render in
the Satori-themed Storybook. It is reachable code, not dead code.

Moving it to `svgIcon` would still hit the NXSAT-677 failure in the Material-only Storybook, which
registers no Satori icon set. Doing it properly means registering that icon set in the token-free
Material path — **check `scripts/storybook-publication-gate.mjs` first**, whose path rule matches
`satori-icons`, before assuming that is allowed.

**So the icon KPI cannot reach 100 today by migrating icons.** It waits on Satori wrappers for
`banner` and `chipSet`, or on Satori's icon set reaching the Material-only path. Neither is a
cleanup item, and neither is blocked forever.

A blind spot while you are here: `card.stories.ts` hard-codes four ligatures (`description`,
`star_border`, `download`, `more_vert`) that the checker never sees — its globs read the file, but
the rule only inspects real Angular templates, not template strings. They do not count against the
score and would render blank on a Satori-only host.

### What is actually left — and what "1 override" does not mean

The checker's `cssOverridesCount: 1` is **one unsuppressed finding**, not one override in the
codebase. There are **154 `stylelint-disable-next-line` suppressions of
`no-ds-internals-overrides`, across 32 files** — `browse.scss`, `tabs.component.scss`,
`document-detail.scss`, `tasks-page.component.scss`, `note-editor.scss` and more.

That reframes the headline improvement. 167 → 1 was mostly **suppression, not removal**: the
overrides are still there, each with a comment telling the linter to look away. The score rose
accordingly, which is worth knowing before anyone reports 99.69 as a cleanup result.

It also means promoting the rule to `error` is **not** the finish line it looks like. A
`stylelint-disable-next-line` suppresses an error exactly as it suppresses a warning, so the flip
would change nothing for those 154 and would only bind the one remaining finding plus anything new.
Worth doing — it stops the count growing — but it is a ratchet, not a cleanup.

So the honest remaining list is:

1. **1 unsuppressed override.** `npm run lint:styles` points at it.
2. **154 suppressed ones**, if the goal is actually fewer overrides rather than a higher score.
   Each suppression is a deliberate, reviewable decision; this document takes no view on whether
   they should be revisited, only on the fact that they exist.
