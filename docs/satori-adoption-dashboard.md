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
| Icons                 | 6 Material font, 492 Satori  | ❌    |
| Componentry           | 0 legacy of 1,604 components | ✅    |
| DS-internal overrides | 1 (0.05 per 1k of 18,488)    | ❌    |
| A11y overrides        | 0 — not penalised            | —     |

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

## Score Breakdown and Path to 100

The score weights six KPIs. Four pass outright; two have a remainder:

| KPI                    | Check | Remainder              | Path to fix                          |
| ---------------------- | ----- | ---------------------- | ------------------------------------ |
| Angular version        | ✅    | —                      | Already compliant                    |
| Satori UI version      | ✅    | —                      | Already compliant                    |
| Design language (MDS3) | ✅    | —                      | All MDS2 checks passing              |
| Icon adoption          | ❌    | 6 Material font icons  | Migrate to Satori SVG icons          |
| Componentry            | ✅    | —                      | No legacy component violations       |
| Styling hygiene        | ❌    | 1 DS-internal override | Remove CSS overrides of DS internals |

The per-KPI weights are the checker's, not ours, so this table deliberately gives raw counts rather
than percentages. The earlier version quoted "0%" and "~82%" against figures that no longer held,
which made both the weighting and the gap look authoritative when neither had been checked.

### What is left

Two items, and both are small enough to finish:

1. **6 Material font icons.** `npm run satori:icons` lists the distinct ones to map to Satori SVG
   equivalents. Down from 513.
2. **1 DS-internal override** — a CSS rule reaching into a Material or Satori internal selector or
   custom property. `npm run lint:styles` points at it. Down from 167.

Finishing both would make `no-ds-internals-overrides` safe to promote from `warning` to `error` in
`.stylelintrc.mjs`, which is the condition that comment has been waiting on.
