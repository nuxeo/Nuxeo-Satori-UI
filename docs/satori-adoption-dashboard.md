# Satori Adoption Dashboard Integration

## Current State

| Metric                | Value                          |
| --------------------- | ------------------------------ |
| **Adoption Score**    | 73.11                          |
| Angular version       | 22.2.3 (compliant)             |
| Satori UI version     | 1.0.0-alpha.171 (compliant)    |
| Design language       | MDS3 (all MDS2 checks passing) |
| Material font icons   | 513 (0 Satori SVG)             |
| Satori components     | 105                            |
| Material components   | 1,469                          |
| DS-internal overrides | 167 (9.05 per 1k LOC)          |
| A11y overrides        | 0                              |

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

The score formula weights six KPIs. Current gaps:

| KPI                    | Status | Gap                       | Path to fix                          |
| ---------------------- | ------ | ------------------------- | ------------------------------------ |
| Angular version        | 100%   | —                         | Already compliant                    |
| Satori UI version      | 100%   | —                         | Already compliant                    |
| Design language (MDS3) | 100%   | —                         | All MDS2 checks passing              |
| Icon adoption          | 0%     | 513 Material font icons   | Migrate to Satori SVG icons          |
| Componentry            | 100%   | —                         | No legacy component violations       |
| Styling hygiene        | ~82%   | 167 DS-internal overrides | Remove CSS overrides of DS internals |

### Biggest opportunities

1. **Icon migration (513 icons → 0)** — largest scoring impact. Run `npm run satori:icons` for the full list of 122 distinct Material icons to map to Satori SVG equivalents.
2. **DS-internal overrides (167)** — CSS rules that override Material/Satori internal selectors or custom properties. Run `npm run lint:styles` to see each one.
