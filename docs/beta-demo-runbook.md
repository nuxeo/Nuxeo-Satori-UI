# Beta demo runbook — Nuxeo Satori

**Every claim in this file was executed against a live instance on 2026-08-25.** Nothing is
inferred from documentation. Where something could not be verified it says so; where a doc said
one thing and the running system did another, the running system wins and the doc was corrected.

Read Part 0 and Part 6 before anything else. Part 6 is the list of things that do not work — it
is the more useful half of this document, because the failure mode of a demo like this is
confidently showing something that is not there.

---

## Part 0 — Pre-flight, 30 minutes before

Run these in order. Every one has an expected output; if you get something else, stop and fix it
before continuing.

### 0.1 Docker and Nuxeo

Nuxeo is **not** in this repo — it is two containers managed outside it. On 2026-08-25 both were
stopped and the Docker daemon was off, which would have ended the demo at the first click.

```bash
open -a Docker                      # wait for the daemon; ~10s
docker start nuxeo-opensearch       # OpenSearch first, Nuxeo depends on it
sleep 15
docker start nuxeo
```

Wait for readiness, then confirm:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/nuxeo/runningstatus   # → 200
```

> The daemon dropped out once mid-restart during rehearsal. If `docker start` reports a socket
> error, re-run `open -a Docker`, wait, and try again. Do not assume it came up.

### 0.2 The app

```bash
curl -s -o /dev/null -w '4200: %{http_code}\n' http://localhost:4200                      # → 200
curl -s -o /dev/null -w 'proxy: %{http_code}\n' -u Administrator:Administrator \
  http://localhost:4200/nuxeo/api/v1/path/default-domain                                  # → 200
curl -s -o /dev/null -w 'bootstrap: %{http_code}\n' \
  http://localhost:4200/agentic-ui-config/bootstrap.json                                  # → 404
```

The `404` is correct: with no configuration the app runs on its compiled defaults. The dev server
serves `apps/nuxeo-ui/public/agentic-ui-config/bootstrap.json` and `manifest.json`, which are
gitignored and absent until `npm run config:dev` writes them — do that before starting the dev
server (§0.6). On a server, since NXSAT-312,
configuration comes only from Marketplace packages through the configuration service; the package
installs no file to copy or edit.

### 0.3 The customer-extension app — a **separate** app on a **separate** port

The customer extension is **not loaded by the product app.** See F0 in Part 6. If you are showing
Layer 2 you must start a second server yourself — **nothing is listening on :4310 by default:**

```bash
npx nx serve nuxeo-satori-template --port 4310    # --port is required; it defaults to 4200
```

```bash
curl -s -o /dev/null -w '4310: %{http_code}\n' http://localhost:4310                      # → 200
```

### 0.4 Clear stored state that silently overrides the manifest

In devtools console on `http://localhost:4200`:

```js
localStorage.removeItem('browse_column_settings'); // user column picks beat the manifest
localStorage.removeItem('agentic_ui_color_theme'); // a stored theme beats defaultThemeId
```

### 0.5 Warm the slow routes

Visit this once, then return to the dashboard:

- `http://localhost:4200/#/browse`

_Changed by NXSAT-635 (2026-10):_ the slow route was the adf-hx one, whose lazy ~1.3 MB chunk took
about 4 seconds on first load. It and the adf-hx search route were removed on 2026-10-14 and now
redirect to `/#/browse` and `/#/search`.

### 0.6 Write the dev configuration

Every customisation beat needs it. On a server, configuration is fragments contributed by
Marketplace packages and served by `nuxeo-agentic-core`; under `nx serve` there is no server
side, so `npm run config:dev` writes the same response into the gitignored
`apps/nuxeo-ui/public/agentic-ui-config/`: our defaults, then any fragment files you name.
Nothing is created in the repository — the manifest Note this section used to create is no
longer read (NXSAT-312).

```bash
npm run config:dev            # before `nx serve`: the dev server serves only files present at start
```

Save this as `/tmp/apply-manifest.sh` and `chmod +x` it. You will use it for every beat:

```bash
#!/usr/bin/env bash
# Usage: apply-manifest.sh <manifest-fragment.json>; set BOOTSTRAP=<file> to keep Beat 3's branding.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
npm run --silent config:dev -- ${BOOTSTRAP:+--bootstrap "$BOOTSTRAP"} --manifest "$1"
```

Each beat's file is a **manifest fragment** — the JSON a configuration package would contribute.
The script rewrites both files, so a bootstrap fragment you are not passing is dropped.

**After every manifest change you must hard-reload (⌘⇧R).** `withHashLocation()` means hash
navigation is same-document, so `APP_INITIALIZER` never re-runs and the old value survives. This
was verified by watching a label fail to change on a hash nav. Measured on a warm dev server:
nav updates 245 ms after reload, the browse table 273 ms.

### 0.7 On a demo **server**: install the presales package

`config-packages/presales-demo` is the configuration package for a demo server, generated by the
`config-package` generator. Installed, it changes nothing until a URL picks one of its presets, so
the server looks like the product for everyone else:

```bash
node config-packages/presales-demo/build.mjs   # Node alone; or `npx nx build presales-demo`, which writes dist/config-packages/presales-demo/
nuxeoctl mp-install config-packages/presales-demo/dist/presales-demo-1.0.0.zip   # then restart Nuxeo
```

| URL                                   | Shows                                                       |
| ------------------------------------- | ----------------------------------------------------------- |
| `/nuxeo/agentic-ui/?preset=insurance` | Acme Claims Cloud — Acme logo, Collections as "Claim files" |
| `/nuxeo/agentic-ui/?preset=logistics` | Globex Shipment Records — Globex logo, "Shipments"          |
| `/nuxeo/agentic-ui/?preset=`          | Satori as installed                                         |

The preset is remembered in that browser only, and a badge in the header names it. A new demo
customer is a new entry under `presales.presets` in the package's `bootstrap.json`, a version bump
in its `package.xml`, and a reinstall. Never install it on a customer's server: preset switching
is for demos.

---

## Part 1 — What is adf-hx, and what is ours

> _Changed by NXSAT-635 and NXSAT-638 (2026-10):_ **Do not demo this Part.** adf-hx is no longer in
> the product: the POC routes, the adopted upstream components and the bridge library were removed
> on 2026-10-14 (NXSAT-635), and the `@alfresco` packages by NXSAT-637. Both old paths redirect to
> `/#/browse` and `/#/search`. The rest of this Part is kept as the record of what the 2026-08-25
> demo showed.

This is the question you will be asked first, and the answer is easy to get backwards. An
`hxp-*` tag says **nothing** about who wrote the component: **seven** are upstream's and
**thirteen** are ours, sharing the prefix.

> `libs/shared/adf-hx-bridge/ARCHITECTURE.md` had this inverted until 2026-08-25 — it listed
> `hxp-document-list` and `hxp-breadcrumb` as ours, and listed two things that do not exist. It
> is corrected now, but if you have read an older copy, re-read it.

The reliable test is the import. Our POC feature code aliases every upstream component as
`Upstream*` on import — see `browse-adf-hx-poc.ts:60-66`.

### Real adf-hx (from `@alfresco/adf-hx-content-services/ui`)

| Selector                           | Where                                              |
| ---------------------------------- | -------------------------------------------------- |
| `hxp-document-list`                | browse POC, adf-hx search                          |
| `hxp-ui-breadcrumb`                | browse POC, fed ancestors plus the current folder  |
| `hxp-ui-document-viewer`           | browse POC                                         |
| `hxp-permissions-management-panel` | browse POC, Permissions tab                        |
| `hxp-document-tree`                | nav drawer, wrapped by our `hxp-browse-nav-drawer` |

### Ours — 13 components in `libs/shared/adf-hx-bridge/src/lib/ui/`

`hxp-folder-header`, `hxp-domain-hint`, `hxp-browse-tabs`, `hxp-browse-toolbar`,
`hxp-browse-pager`, `hxp-column-picker`, `hxp-document-cards`,
`hxp-browse-history`, `hxp-browse-trash`, `hxp-browse-details-panel`, `hxp-browse-nav-drawer`,
`hxp-icon`, `hxp-spinner`.

**History and Trash are ours**, reading real Nuxeo audit and trash APIs. Do not attribute them to
adf-hx.

Permissions is **no longer** in that group, and earlier copies of this runbook said it was. The
read-only `hxp-browse-permissions` table was replaced on 2026-08-31 by upstream's
`hxp-permissions-management-panel`, which reads _and writes_ Nuxeo ACLs. If you are demoing from a
script that says "upstream ships nothing for permissions", it is out of date —
`docs/permissions-phase-3-decision.md` records what changed and why the original deferral was
wrong.

### Dependency versions (from the lockfile)

| Package                             | Version             |
| ----------------------------------- | ------------------- |
| `@alfresco/adf-hx-content-services` | 7.20.0-automate.292 |
| `@alfresco/adf-core`                | 9.0.0               |
| `@alfresco/adf-extensions`          | 9.0.0               |
| `@hylandsoftware/hxcs-js-client`    | 2.0.111             |
| `@hylandsoftware/satori-ui`         | 0.2.1               |

### The side-by-side, and how to show it

All routes need `/#/` — the app uses hash routing.

| Show                          | URL                                             | Point at                                                                                         |
| ----------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Ours** (baseline)           | `/#/browse/default-domain`                      | Material chrome, file-type icons, `Root › Domain` breadcrumb                                     |
| **adf-hx**                    | `/#/browse-adf-hx?path=%2Fdefault-domain`       | **The table** — that is upstream's `hxp-document-list`, driven by our Layer 1 column descriptors |
| **Properties** (best surface) | same URL → **tick a row checkbox** → Properties | Real Nuxeo data: Title, Category, Created, Creator, Path                                         |
| **Versions**                  | same → Versions                                 | "Current Version / Created By Administrator / …"                                                 |

**Tick the checkbox, do not click the row.** A row click leaves both sidebars saying _"Select a
single document in the View tab."_ This one detail is the difference between your strongest beat
and an empty panel.

The wrapping rule — _adf-hx types never appear in our public API_ — is **enforced, not just
documented**: `scripts/review-guardrails.mjs` fails the build if an `@alfresco/adf-hx-`* import is
reachable from a library's public barrel. `@alfresco/adf-extensions` was the deliberate exception,
as a declared peer, until NXSAT-308 gave the platform its own copies of the three functions it used,
so customers install no `@alfresco` package at all.

---

## Part 2 — How they are packaged separately

Two independent artefacts, and a clean support boundary.

### 1. The npm library — what customers code against

`@nuxeo/satori-platform`, six entry points: `.`, `/app-config`, `/components`, `/extensions`,
`/nuxeo-client`, `/ui`. The built package also ships `AGENTS.md`, `extension-reference.md`, five Nx generators —
four for Layer 2 libraries, one for configuration packages — and the guardrail script.

**Say "publishable", not "published".** Nothing is on any registry — that is a deliberate later
step. The built `package.json` is public and names the Nuxeo registry in `publishConfig`
(NXSAT-667); the publishability check _fails_ if `private: true` returns or the registry is
missing. Verified: `nx build platform` exit 0,
`npm publish --dry-run` succeeds, and the template app compiles against the built types.

**On the name:** the package in the repo today is `@nuxeo/satori-platform`, and that is the form
the guardrail prints on screen in Beat 10 when it lists the published entry points. A rename to
`@nuxeo/satori-platform` on `packages.nuxeo.com` is written up in
`docs/publishing-to-nuxeo-registry.md` §5.1, but **no rename decision was verified** — treat it as
a documented intention, not a fact. Safest phrasing: _"it is not published yet; the final package
name is part of that step."_ Saying a different name from the one Beat 10 prints will read as a
contradiction.

### 2. The Nuxeo marketplace package

`nuxeo-agentic-ui-package/` — a Maven module producing an addon ZIP: the OSGi bundle, which carries
our configuration defaults and the configuration servlet, and the built Angular app into
`/web/nuxeo.war/agentic-ui`.

The interesting engineering detail, and it is worth reading aloud from
`nuxeo-agentic-ui-package/src/main/resources/install.xml`:

- the app bundle is copied with `overwrite="true"` — replaced on every upgrade;
- **no configuration file is installed at all.** Configuration is contributed by Marketplace
  packages to the `org.nuxeo.agentic.ui.config` extension point and served at
  `/nuxeo/agentic-ui-config/` (NXSAT-312). A customer's configuration is their own package, which
  depends on ours, so nothing our installer copies can replace it.

> **History (NXSAT-317, superseded by NXSAT-312).** Until NXSAT-317 the package installed
> `bootstrap.json` itself with `overwrite="false"`, and upgrading after an edit **failed and left no
> version installed** — `/nuxeo/agentic-ui/` 404. NXSAT-317 shipped a sample instead; NXSAT-312
> removed configuration files from the server altogether. The `review-guardrails` gate now fails on
> any copy into `agentic-ui-config` and on any copy not declared `overwrite="true"`.

### The support boundary

|                           |                                                                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer depends on       | `@nuxeo/satori-platform` + peers: Angular 22.2, Material/CDK 22.2, `@hylandsoftware/satori-ui ^0.4`, `@ngx-translate/core ^17`, `rxjs ^7.8`                                                                            |
| Customer **cannot** reach | adf-hx, at all. `libs/shared/adf-hx-bridge`, which held the twelve API ports, the Nuxeo↔Hx mappers and thirteen of our `hxp-`* components, was internal and never published, and was removed on 2026-10-14 (NXSAT-635) |

**The line for leadership:** adf-hx is an implementation detail of the product, not part of the
customer contract. Customers get the Layer 0/1/2 extensibility surface and are insulated from
adf-hx entirely. _Changed by NXSAT-638 (2026-10):_ adf-hx is no longer in the product at all.

---

## Part 3 — The four customer journeys

| Journey                                                     | Layer                   | Needs a build?   | Where it runs |
| ----------------------------------------------------------- | ----------------------- | ---------------- | ------------- |
| Rebrand the shipped app                                     | 0 (bootstrap fragment)  | **No**           | `:4200`       |
| Reconfigure the shipped app — labels, nav, columns, actions | 0/1 (manifest fragment) | **No**           | `:4200`       |
| Add their own features to the shipped app                   | 2 (their library)       | Yes, their build | `:4310`       |
| Build a UI from scratch on our platform                     | 2                       | Yes, their build | `:4310`       |

**There are two Layer 0 stores and conflating them is the most likely thing to trip you up:**

|                      | Lives in                                                  | Holds                                                               |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| **bootstrap**        | `bootstrap` fragments, `agentic-ui-config/bootstrap.json` | branding, themes, SSO, session, integrations                        |
| **runtime manifest** | `manifest` fragments, `agentic-ui-config/manifest.json`   | `labels`, `featureToggles`, and the whole Layer 1 `extensions` tree |

`runtime-manifest.ts` has no `branding` or `themes` key. **Branding is not a manifest edit.**

---

## Part 4 — The demo script

Timings are measured on a warm dev server.

### Beat 1 — The product as shipped (2 min)

`/#/browse/default-domain`. Real repository, 113 documents. This is the baseline; everything after
it is customisation without forking.

### Beat 2 — adf-hx vs ours (4 min)

> _Changed by NXSAT-635 (2026-10):_ **Skip this beat.** The adf-hx browse route was removed on
> 2026-10-14 and redirects to `/#/browse`, so there is no second stack to switch to. Kept as the
> record of the beat.

Follow the table in Part 1. Open `/#/browse` and `/#/browse-adf-hx?path=%2Fdefault-domain` in two
tabs and switch between them. The folder tabs are the same on both: View, Permissions, History and
Trash. Properties and Versions are not browse tabs on either — open a document for them.

### Beat 3 — Rebrand, no rebuild (3 min)

Save this as `/tmp/acme-bootstrap.json` — a bootstrap fragment, as the prospect's configuration
package would contribute it; anything left out keeps its compiled default:

```json
{
  "branding": {
    "applicationTitle": "Acme Content Cloud",
    "documentTitle": "Acme Content Cloud",
    "logo": { "src": "assets/acme-logo.svg", "alt": "Acme Content Cloud" }
  },
  "defaultThemeId": "acme",
  "themes": [
    {
      "id": "acme",
      "label": "Acme Brand",
      "base": "light",
      "preview": {
        "sidebar": "#2d0b4e",
        "surface": "#f6f2fb",
        "header": "#e6dcf5",
        "accent": "#7b2ff7",
        "tile": "#d9c9f0"
      },
      "tokens": { "--mat-sys-primary": "rgb(123, 47, 247)", "--agentic-pill-radius": "4px" }
    }
  ]
}
```

Then write it — gitignored, so nothing here can reach a commit:

```bash
npm run config:dev -- --bootstrap /tmp/acme-bootstrap.json
```

Put the prospect's logo at `apps/nuxeo-ui/public/agentic-ui-config/assets/acme-logo.svg` — under
`nx serve` that directory is served at `/agentic-ui-config/`, so the logo is at the same path a
server serves a package's `<asset>` at, `agentic-ui-config/assets/<name>`, and the fragment above
goes into the configuration package unchanged. Like the configuration files, the logo is only
picked up if it exists when `nx serve` starts.

Hard-reload, open `/#/settings/themes`. The audience sees the **logo** in the header and on the
login page, the **browser tab title** change, a fifth theme card "Acme Brand", and the purple
accent applied.

**Demo** `documentTitle`**, not** `applicationTitle` — see F2. The logo is demoable since NXSAT-313,
with limits worth saying before anyone asks: it does not replace the Hyland mark at the top of the
navigation rail or the "Content Innovation Cloud" title shown when the rail is expanded (both
hard-coded in Satori's `sat-platform-nav`), nor the favicon.

The strongest version of this beat: point out that the JavaScript bundle is byte-identical before
and after. It was verified by hashing `main-*.js` across a rebrand — `sha256` unchanged.

Reset: `npm run config:dev` and delete `apps/nuxeo-ui/public/agentic-ui-config/assets/acme-logo.svg`,
which is not gitignored. On a server, remove the configuration package.

### Beat 4 — Relabel the product (2 min)

```json
{
  "version": 1,
  "labels": {
    "settings.themes.title": "Appearance",
    "settings.themes.apply": "Use this one"
  }
}
```

`./apply-manifest.sh that.json`, hard-reload, open `/#/settings/themes`. Heading becomes
"Appearance", button "Use this one". The manifest layers **last** over the shipped catalogue, so
the customer always wins.

`labels` **does** relabel navigation too, through each descriptor's `labelKey` —
`labels["nav.item.collections"]` renames Collections. The manifest's `labels` map is not keyed by
language, so that text replaces the key in every language's catalogue; per-language wording is not
configurable today. `overrides.<id>.label` also shows one literal in every locale, but bypasses
the key entirely; set both and the override wins.
This corrects F5, which was withdrawn on 2026-09-26.

### Beat 5 — Nav: hide one, add one, and the security question (4 min)

```json
{
  "version": 1,
  "extensions": {
    "$name": "acme-demo",
    "overrides": { "app.navbar.browse": { "visible": false } },
    "slots": {
      "navbar": [
        {
          "id": "acme.navbar.contracts",
          "label": "Contracts",
          "path": "/browse",
          "icon": "folder",
          "order": 35
        }
      ]
    }
  }
}
```

"Browse" disappears; "Contracts" appears where it was. `order` is spaced by ten, so 35 lands
exactly between 30 and 40.

> **The figures below were re-derived, not re-verified live.** They were "15 entries,
> `acme.navbar.contracts` at index 3, between `app.navbar.browse` and `app.navbar.recentlyViewed`",
> measured before `app.navbar.browse` was given `disabled: true`. With the legacy Browse entry no
> longer rendered, the navigation renders 14 of the 15 packaged entries, this manifest still
> renders 14, and
> `acme.navbar.contracts` lands at index 2 — between `app.navbar.dashboard` and
> `app.navbar.recentlyViewed`. Read the numbers off the screen before you quote them.
> _Changed by NXSAT-635 (2026-10):_ the entry this manifest used to hide, the adf-hx Browse, is
> retired and `app.navbar.browse` is rendered again, so the manifest now hides that. The figures
> above predate both changes.

> **Expand the nav rail before this beat.** It is collapsed by default, so labels are hidden by CSS
> and a new entry shows only as an icon — measured: every item's `innerText` is empty while
> `textContent` reads correctly. Expand or hover so the audience can read "Contracts".

**Then type** `/#/browse` **in the address bar. The page still loads.** Do this deliberately.
It is your honest answer to _"so I can hide admin actions from users?"_ — **no.** Hiding is
presentation; Nuxeo's server-side ACLs are authorisation. Volunteering this earns more trust than
being caught by it.

### Beat 5a — Custom page for a nav entry (5 min, optional)

**This beat shows creating a custom page with widgets for the Contracts entry.** Skip this if time is
tight; Beats 5-7 already demonstrate the extensibility story.

**1. Create the component:**

```bash
cat > apps/nuxeo-ui/src/app/features/contracts/contracts-page.component.ts <<'TS'
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-contracts-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div style="padding: 2rem;">
      <h1>Contracts Dashboard</h1>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-top: 2rem;">
        <div style="padding: 1.5rem; border: 1px solid #ddd; border-radius: 8px;">
          <h3>Active Contracts</h3>
          <p style="font-size: 2rem; margin: 1rem 0;">24</p>
          <p style="color: #666;">Updated 2 hours ago</p>
        </div>
        <div style="padding: 1.5rem; border: 1px solid #ddd; border-radius: 8px;">
          <h3>Expiring Soon</h3>
          <p style="font-size: 2rem; margin: 1rem 0; color: #f57c00;">3</p>
          <p style="color: #666;">Next 30 days</p>
        </div>
        <div style="padding: 1.5rem; border: 1px solid #ddd; border-radius: 8px;">
          <h3>Total Value</h3>
          <p style="font-size: 2rem; margin: 1rem 0;">$2.4M</p>
          <p style="color: #666;">Current quarter</p>
        </div>
      </div>
      <div style="margin-top: 2rem; padding: 1.5rem; border: 1px solid #ddd; border-radius: 8px;">
        <h3>Recent Activity</h3>
        <ul>
          <li style="padding: 0.5rem 0;">Contract ABC-123 renewed - 2 days ago</li>
          <li style="padding: 0.5rem 0;">Contract XYZ-789 pending review - 3 days ago</li>
          <li style="padding: 0.5rem 0;">Contract DEF-456 signed - 1 week ago</li>
        </ul>
      </div>
    </div>
  `
})
export class ContractsPageComponent {}
TS
```

**2. Add the route** in `apps/nuxeo-ui/src/app/app.routes.ts`:

```typescript
// Add this import at the top
import { ContractsPageComponent } from './features/contracts/contracts-page.component';

// Add this route in the routes array (after the browse routes)
{
  path: 'contracts',
  component: ContractsPageComponent,
  canActivate: [authGuard]
},
```

**3. Update the manifest** to point to the custom route:

```json
{
  "version": 1,
  "extensions": {
    "$name": "acme-demo",
    "overrides": { "app.navbar.browse": { "visible": false } },
    "slots": {
      "navbar": [
        {
          "id": "acme.navbar.contracts",
          "label": "Contracts",
          "path": "/contracts",
          "icon": "folder",
          "order": 35
        }
      ]
    }
  }
}
```

Apply: `./apply-manifest.sh /tmp/beat5a.json`, hard-reload, click **Contracts** in the nav.

**The audience sees** a custom dashboard with stat tiles (Active: 24, Expiring: 3, Total: $2.4M) and
recent activity. This demonstrates that **manifest-driven nav entries can point to custom code**
without forking — the component is added to the product app, and the manifest wires it up.

**Clean up after the beat** (if you showed it):

```bash
rm apps/nuxeo-ui/src/app/features/contracts/contracts-page.component.ts
# Revert the route addition in app.routes.ts
git checkout -- apps/nuxeo-ui/src/app/app.routes.ts
```

### Beat 6 — Columns (3 min)

```json
{
  "version": 1,
  "extensions": {
    "overrides": {
      "app.documentList.lastContributor": { "label": "Updated by", "order": 5 },
      "app.documentList.modified": { "visible": false }
    }
  }
}
```

`/#/browse` headers go from `Title, Modified, Last Contributor` to `Updated by, Title`.
_Changed by NXSAT-635 (2026-10):_ until 2026-10-14 the same relabel also landed in upstream's
`hxp-document-list` on the adf-hx POC route, which is removed.

For the picker contrast, use `slots` (**not** `overrides` — see F4):

```json
{
  "version": 1,
  "extensions": {
    "slots": {
      "documentList": [
        { "id": "app.documentList.state", "disabled": true },
        { "id": "app.documentList.version", "hiddenByDefault": true }
      ]
    }
  }
}
```

Click "Manage columns": **State is absent entirely; Version is offered, unchecked.** `disabled`
takes it away from the user; `hiddenByDefault` only sets the starting state.

### Beat 7 — Bulk actions and rules (4 min)

```json
{
  "version": 1,
  "extensions": {
    "overrides": { "app.bulkActions.publish": { "visible": false } },
    "slots": {
      "bulk-actions": [
        {
          "id": "acme.bulkActions.archive",
          "label": "Archive",
          "icon": "inventory_2",
          "order": 15
        },
        {
          "id": "acme.bulkActions.merge",
          "label": "Merge selected",
          "icon": "merge",
          "order": 25,
          "rule": "app.rules.hasMultipleSelection"
        },
        {
          "id": "acme.bulkActions.review",
          "label": "Send for review",
          "icon": "rate_review",
          "order": 26,
          "enabledRule": "app.rules.hasMultipleSelection"
        }
      ]
    }
  }
}
```

On `/#/browse`, wait ~2.5 s for the table, then select rows.

- **Two rows:** Archive present, Publish gone, Merge present, Send-for-review enabled.
- **One row:** Merge **disappears**; Send-for-review is **present but greyed**.

That contrast is the beat: `rule` removes, `enabledRule` disables. Same declarative gate, two
different user experiences, no code.

### Beat 8 — Upgrade safety (3 min)

```bash
npm run beta:upgrade                          # exit 0, ~4s warm
npm run beta:upgrade -- --break-slot toolbar  # exit 1
```

The passing run reports _"all 3 manifest-named slot(s) still exist in the upgraded package"_ and
_"all 21 customer file(s) byte-identical"_. The broken run reports _"The manifest names 1 slot(s)
the upgraded package no longer has: toolbar."_

Run the failing form **second**. The tool prints its own justification: a pass means nothing until
you have watched it fail.

### Beat 9 — A customer's own code (6 min) — **on** `:4310`

1. `http://localhost:4310/` signed out — sidebar reads **"Acme Insurance"**, and only
   **"Diagnostics"** is in the nav. The other four entries are rule-gated **fail-closed**, so they
   are genuinely absent rather than greyed.
2. Sign in `Administrator` / `Administrator`. Nav becomes
   `Documents, Search, Diagnostics, Reports, AcmeExtensions`.
3. **"AcmeExtensions" is the customer's** — contributed by `libs/extensions/acme-extensions`,
   ordered last via `order: 500`, gated on `acme.rules.canUseAcme`.
4. Click it → `/acme-extensions`. The panel renders. **The host never imports this class:**
   the route maps only a path, and `ExtensionOutletComponent` resolves the component by **ID**
   from the registry, honouring the library's lazy import.
5. Click **"Export summary"** with devtools open — it dispatches by ID through
   `ExtensionActionRegistry` rather than calling a method, which is why a manifest can move the
   affordance without touching the panel.
6. Open `/home` — the **Diagnostics page** is the strongest single screen in this track. It lists
   live config sources, the fallback chain, and every registered extension ID, with `acme.rules.*`
   sitting alongside the platform's `app.rules.*`.

"Zero edits to our libraries" is verified: every non-relative import across all six source files
is `@angular/*` or `@nuxeo/satori-platform/extensions`. One published entry point. 291 lines.

### Beat 10 — The guardrail that makes it safe (3 min)

```bash
npm run beta:customer-guardrails
# → pass — libs/extensions/acme-extensions (owner `acme`), 6 source file(s), 2 spec file(s)
```

This is gate 17 of 17, and it ships **inside** the customer package. Then show it failing — a copy
with a deep import into internals gives:

```
- src/lib/rules.service.ts imports `@nuxeo/satori-platform/extensions/internal/rule-registry`,
  which is not a published entry point.
    A deep path into internals will break without that being a breaking change.
```

Three more real failures are available: exporting a component from the barrel, deleting
`failClosedRules`, and specs that name no registry. All exit 1.

The honest framing: `eslint.config.mjs` says in its own comment that the Nx tag constraint
**cannot** enforce entry-point discipline, because path aliases make a supported import and a raw
internal one the same graph edge. This script is what actually enforces it.

### Beat 11 — From scratch (4 min)

> **Detailed walkthrough:** See `docs/demo-beat-11-12-walkthrough.md` for a complete
> step-by-step demo script with talking points, live coding examples, and Q&A.

`apps/nuxeo-satori-template` is a complete working Nuxeo UI — browse, document detail, search,
sign-in, theming, diagnostics — in **1,401 lines of TypeScript** plus ~1,000 of template/style,
built **only** on published entry points. Zero imports from `libs/shared/`*, `libs/features/*` or
the product app. It ships no Angular Material at all. Production build: 402 kB initial.

```bash
npx nx build nuxeo-satori-template     # exit 0
```

### Beat 12 — The generators (3 min, optional)

Five Nx generators ship in the package. The four for a Layer 2 library, verified end to end in an
isolated worktree:

```bash
npx nx g ./tools/satori-generators:extension-library contoso-extensions --owner=contoso
npx nx g ./tools/satori-generators:extension-rule      is-underwriter --library=contoso-extensions
npx nx g ./tools/satori-generators:extension-action    export-policy  --library=contoso-extensions
npx nx g ./tools/satori-generators:extension-component claim-summary  --library=contoso-extensions
```

The generated library then passed `check-extension-library`, `nx test` (6 tests), `nx typecheck`
and `nx lint` from scratch. The library generator's console output tells you it is **"TWO STEPS,
not one"** and hands you the route, because a nav entry alone would fall through the wildcard.

The fifth scaffolds the configuration package that carries Layer 0 and 1 — no code at all — and
needs neither this repository's install nor its token. Show it the way a customer runs it, with Node
alone:

```bash
node tools/satori-generators/src/config-package/create.mjs contoso-config --owner=contoso
node config-packages/contoso-config/build.mjs   # refuses a bad fragment; writes config-packages/contoso-config/dist/contoso-config-1.0.0.zip
```

With the full install, the Nx generator writes the same files, byte for byte, and `nx build` runs
the same `build.mjs`:

```bash
npx nx g ./tools/satori-generators:config-package contoso-config --owner=contoso
npx nx build contoso-config     # writes dist/config-packages/contoso-config/contoso-config-1.0.0.zip
```

`config-packages/presales-demo` (Part 0.7) was made by the generator and installed on a real Nuxeo.

**Be honest if asked:** the three contribution generators write registrations but **no specs**.

### Beat 13 — AI-Assisted Development (8 min, optional)

**Purpose:** Show customers they can clone the repo and use AI agents (Claude, GitHub Copilot, etc.)
to build features immediately, leveraging `@nuxeo/satori-platform` components and the extension system.

**What to demonstrate:** An AI agent can read the codebase, understand the architecture, and build
complete features using the platform APIs and UI components. This is not theoretical — the showcase
pages you've seen were built with AI assistance.

#### Example Prompt 1: Build a Dashboard Widget (5 min)

Clone a fresh copy and give this prompt to an AI coding agent:

> "Create a new dashboard page in `apps/nuxeo-satori-template` at `/dashboard` that shows:
>
> - A 3-column grid using `WidgetGridComponent` from `@nuxeo/satori-platform/ui`
> - Three stat tiles: Active Documents (fetch count via `DocumentService`), Recent Uploads (last 7 days), Storage Used
> - A Recent Activity section using `WidgetContainerComponent`
> - Add it to the navbar with order 15
>
> Follow the existing patterns in the template app. Use the same imports and styling approach."

**Expected outcome:**

- Agent reads `apps/nuxeo-satori-template/src/app/pages/` for patterns
- Creates `dashboard/dashboard.ts`, `.html`, `.scss` following template conventions
- Imports from `@nuxeo/satori-platform/ui` and `@nuxeo/satori-platform/nuxeo-client`
- Adds route to `app.routes.ts`
- Adds nav entry to `extensions/template-extensions.ts`
- Working page in 2-3 minutes

**Why this works:** The codebase has clear patterns, documented APIs in `AGENTS.md`, and the
platform package exports are well-typed. The AI can see how `components.ts` uses the widgets
and replicate the pattern.

#### Example Prompt 2: Add a Custom Action (3 min)

> "Add a custom bulk action to the template app called 'Export to CSV'. It should:
>
> - Be registered in `template-extensions.ts` as `template.actions.exportCsv`
> - Show a toast notification with the count of selected items
> - Be available in the `browse-toolbar-actions` slot
> - Follow the same pattern as the existing `template.actions.exportSummary` action"

**Expected outcome:**

- Agent finds the existing action in `template-extensions.ts`
- Adds the new action with proper signature: `execute: (context) => { ... }`
- Uses the selection count from context
- Follows the template's code style and conventions

#### Example Prompt 3: Fetch Real Data (Optional, if time)

> "Update the dashboard stat tiles to show real data:
>
> - Active Documents: Use `SearchService.search()` to get total count
> - Recent Uploads: Search with `dc:created` filter for last 7 days
> - Storage Used: Sum `file:content.length` from search results
>
> Handle loading states and errors properly."

**Expected outcome:**

- Agent reads `SearchService` from `@nuxeo/satori-platform/nuxeo-client`
- Sees the existing `search/search.ts` page for patterns
- Implements signal-based state management
- Adds `toSignal()` and RxJS operators correctly

#### Key Message for Customers

"You don't need to learn every API before starting. Clone the repo, point an AI agent at it,
describe what you want in plain English, and the agent will:

1. **Read the architecture** — `AGENTS.md`, `ARCHITECTURE.md`, the component showcase
2. **Follow existing patterns** — it sees how we use signals, services, and widgets
3. **Use the right imports** — `@nuxeo/satori-platform/*` entry points are discoverable
4. **Generate working code** — not pseudocode, actual components that compile and run

The platform is designed for this workflow: clear conventions, typed APIs, documented extension
points, and plenty of working examples to learn from."

#### What to Show on Screen

1. Open the template app's `components.ts` page — "This was built with AI assistance"
2. Show the import statements: `from '@nuxeo/satori-platform/ui'`
3. Open `AGENTS.md` — "The AI reads this to understand the architecture"
4. Show a split screen: AI prompt on left, generated code on right
5. Run the generated feature: `npx nx serve nuxeo-satori-template --port 4310`

#### Talking Points

- **"The codebase is the documentation."** Every page in the template is a working example.
- **"AI knows the patterns."** It reads how we use signals, services, and Material components.
- **"Iteration is fast."** Ask for changes, the agent updates the code, HMR reloads, you see it.
- **"No framework lock-in."** The AI uses standard Angular patterns — signals, standalone components, inject().

#### Caveats to Mention

- **AI output needs review** — always check what it generates, especially security-sensitive code
- **Tests aren't automatic** — the generators don't write specs; you'll want to add them
- **Nuxeo API knowledge helps** — the AI can't invent document types or workflow states
- **The first prompt matters** — be specific about which patterns to follow and where to look

---

## Part 5 — Questions you will be asked

**"Can I hide actions from users I don't trust?"**
No. Manifest visibility is presentation. Nuxeo's server-side permissions are the authorisation
boundary, and they still apply. Demonstrate it — Beat 5.

**"Does my customisation survive your upgrades?"**
Customisation lives in the customer's own Marketplace package, which depends on ours, and our
`install.xml` replaces only the application bundle: it installs no configuration file, and the
`review-guardrails` gate fails on any copy into `agentic-ui-config`. That is the design; say so.
Then show Beat 8, and say what it proves: the **npm** upgrade rehearsal, eight assertions across
Layers 0-2, not the marketplace installer.

**"Can I change the logo?"**
Yes, in a bootstrap fragment with no rebuild of the application: `branding.logo` names an `<asset>` the configuration
package contributes, served at `agentic-ui-config/assets/<name>`, and it replaces the Satori word
mark in the header and the lockup on the login page. It does not replace the Hyland mark at the top
of the navigation rail or the "Content Innovation Cloud" title shown when the rail is expanded (both
hard-coded in Satori's `sat-platform-nav`), and the favicon cannot be changed yet.

**"Is this adf-hx or your own UI?"**
Both, deliberately. Six upstream components render real adf-hx surfaces; the surrounding chrome is
ours. Use the Part 1 table.

**"Can I install it from npm today?"**
No. It is publishable and verified by dry run; the first publish is a deliberate later step, and the
final package name is part of that step. Today's name in the repo is `@nuxeo/satori-platform` — the
same form the guardrail prints in Beat 10.

**"How big is the bundle?"**
3.56 MB initial against a 4 MB build-failure budget — 0.44 MB of headroom. adf-core registers
eleven root services, so it is eager: every user pays it, including users who never open the
adf-hx route. This is a known constraint, not a surprise.

**"What about ng-mocks in the runtime bundle?"**
adf-hx's shipped bundle imports a test library containing two `eval()` calls. It is replaced with
a stub that throws if called. Expect this question from a security reviewer; the answer is that it
is neutralised, not tolerated.

**"Can I edit metadata in the adf-hx panel?"**
No. Upstream does not export the cache service its metadata sidebar needs. Browse no longer
renders upstream's read-only properties panel either; metadata is on the document page.

---

## Part 6 — Do NOT demo these

| #       | What                                                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F0**  | **The customer extension on** `:4200`                                                                              | `nuxeo-ui` never registers `acme.`*. No manifest can add it — Layer 1 only addresses IDs that code registered. Layer 2 lives on `:4310`.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **F1**  | ~~**A logo change**~~ — **withdrawn 2026-10-06, it is demoable**                                                   | NXSAT-313 added `branding.logo` to `AppBrandingConfig`: an image the configuration package contributes replaces the Satori word mark in the header and the lockup on the login page, with no rebuild of the application (the configuration package is still built and installed). See Beat 3. The navigation-rail mark and the expanded rail's "Content Innovation Cloud" title (hard-coded in Satori's `sat-platform-nav`) and the **favicon** have no key and remain out of scope.                                                                         |
| **F2**  | `applicationTitle` **in the header**                                                                               | The route label wins. With the brand set, `/#/browse` still reads "Browse". It only surfaces on a route no nav entry matches. Demo `documentTitle` — the browser tab — which changes everywhere.                                                                                                                                                                                                                                                                                                                                                             |
| **F3**  | **Branding in a manifest fragment**                                                                                | Two separate layers. Branding is a `bootstrap` fragment; `runtime-manifest.ts` has no `branding` key.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **F4**  | `overrides` **with** `hiddenByDefault` **/** `sortable` **/** `field`                                              | Silently dropped; `overrides` honours only `order`, `label`, `rule`, `visible`. Use `slots.documentList`. The doc example was wrong and is now fixed.                                                                                                                                                                                                                                                                                                                                                                                                        |
| **F5**  | ~~`labels` **to rename nav entries**~~ — **withdrawn 2026-09-26, it is demoable**                                  | This entry was wrong. Descriptors carry `labelKey`, the rail (`app-shell.component.html:25`) and the drawer (`nav-drawer.component.html:10`) both resolve it, and the manifest's `labels` layer last over the catalogue (`app-translate-loader.ts:220`). So `labels["nav.item.<slug>"]` renames a nav entry, with the same text in every locale; per-language wording is not configurable. `overrides.<id>.label` bypasses the key and wins when both are set.                                                                                               |
| **F6**  | ~~`toolbar`**,** `contextMenu`**,** `tabs`**,** `routes` **slots**~~ — **withdrawn 2026-09-26, all four are live** | This entry was wrong, and `docs/demo-deck-claims.md` recorded it as withdrawn while this row still told presenters the opposite. All four are registered (`provide-app-extensions.ts:104-106`) and consumed: `toolbar` at `document-detail.html:156`, `tabs` at `document-detail.ts:397`, `contextMenu` at `browse.ts:469-471`, and `routes` through `provideExtensionRoutes()` (`provide-app-extensions.ts:218`), which calls `router.resetConfig` at `extension-routes.ts:112`. Re-checked against those lines on 2026-09-26.                              |
| **F7**  | `app.rules.canWriteSelection` **/** `canRemoveSelection`                                                           | Still inert, always `false`, so they hide whatever you gate on them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **F8**  | `npm run beta:evidence -- showcase-adf-hx` **live**                                                                | It **fails** (21/22). Three of ten screenshots are byte-identical duplicates, and steps 8-10 photograph the repository root, so panels captioned "reads real Nuxeo ACLs" show "no local permissions" and "No audit entries found." Use only `02-agentic-ui-production-browse.png` + `03-adf-hx-browse-list.png`.                                                                                                                                                                                                                                             |
| **F9**  | ~~`/#/search-adf-hx` **with an empty box**~~ — **withdrawn 2026-10-14, the route is removed**                      | NXSAT-635 removed it; the old path redirects to `/#/search`. It showed repository plumbing: personal workspaces, `My Favorites`, rows titled `1783067622304`, and had **no nav entry**.                                                                                                                                                                                                                                                                                                                                                                      |
| **F10** | `acme.panel.policySummary`**,** `acme.actions.exportClaim`**,** `acme.rules.isLegalTeam`                           | Registered but never placed. Nothing renders them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **F11** | **A statically served production build past sign-in**                                                              | Stock Docker Nuxeo sends no CORS headers, so a static bundle cannot authenticate. Use `nx serve`. The rebrand _is_ demoable statically, because brand and tab title render pre-sign-in.                                                                                                                                                                                                                                                                                                                                                                      |
| **F12** | **Layer 1 on the template app**                                                                                    | The template serves a manifest with **no fragments** — deliberately, so the "before" state is honest. `manifest.example.json` is visible only once it is added as a fragment to `apps/nuxeo-satori-template/public/agentic-ui-config/manifest.json`.                                                                                                                                                                                                                                                                                                         |
| **F13** | ~~**"The marketplace package builds"**~~ — **withdrawn 2026-09-26, it builds and publishes**                       | This entry was wrong from the day CI started running Maven on every pull request. `2026.0.1-20260926071953-BUILD-1109` was built and published to preprod by run 36226401180 and is live on the listing under the title **Nuxeo Satori**. Demo it by opening the listing. **Install and upgrade were rehearsed on 2026-10-07** with `nuxeoctl mp-install`: the original `overwrite="false"` design broke the upgrade after a customer edit and was fixed by NXSAT-317. Claim install and upgrade for `nuxeoctl`; the Admin Center path is still unrehearsed. |

### Cosmetic things a sharp audience will notice

- ~~The nav entry literally reads **"Browse (adf-hx POC)"**~~ — fixed. It reads **"Browse"**, and
  the production `app.navbar.browse` entry ships `disabled`, so there is one Browse in the nav.
  `/#/browse` is still routable and still reachable from the dashboard.
- The POC filter row is visibly unstyled: native `dd/mm/yyyy` date inputs, a bare `Columns`
  button. **Those are ours, not upstream's** — do not blame adf-hx.
- The POC list has no file-type icons; production browse does.
- Upstream's breadcrumb under-reports: "Home" at `/default-domain`, where production shows
  `Root › Domain`.
- `HTTP 500 /nuxeo/api/v1/automation/AI.Insights` on the dashboard — the AI marketplace package
  is not installed. Expected.
- A `403` on first load — the anonymous startup manifest fetch. Expected.
- `HTTP 404 /nuxeo/api/v1/group/Administrator` on the Permissions tab — Administrator is a user,
  not a group.

---

## Part 7 — Reset

**Between beats** — return to inert without deleting:

```bash
echo '{"version":1}' > /tmp/inert.json && ./apply-manifest.sh /tmp/inert.json
```

**Branding:**

```bash
npm run config:dev
```

**Full reset to a clean, unconfigured instance:** nothing in the repository holds configuration,
so `npm run config:dev` is the whole reset. On a server, `nuxeoctl mp-remove` the configuration
and demo packages.

**Browser state:** clear `localStorage.browse_column_settings` and
`localStorage.agentic_ui_color_theme`.

---

## Part 8 — Timing and risk

| Risk                                            | Mitigation                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| Docker/Nuxeo not running                        | Part 0.1. This was the actual state found during rehearsal.                             |
| Dev configuration missing or written too late   | Part 0.6: `npm run config:dev`, then restart `nx serve`.                                |
| Manifest edit appears not to work               | You did not hard-reload. Hash navigation does not re-read it.                           |
| First adf-hx load takes ~4 s                    | Warm it — Part 0.5.                                                                     |
| Clicking a checkbox too early selects nothing   | `/#/browse` needs ~2.5 s before the table is interactive.                               |
| `/#/doc/:uid` never settles                     | AI polling keeps the network busy. Do not wait for it.                                  |
| Stored column/theme prefs override the manifest | Part 0.4.                                                                               |
| Two nav entries sharing a `path`                | Drawer resolution matches by path; the first wins. Give every demo entry a unique path. |

**Suggested order if you have 30 minutes:** Beats 1, 2, 3, 5, 7, 9, 10 — the product, the
provenance, a no-rebuild rebrand, declarative nav with the honest security answer, rules, the
customer's own code, and the guardrail. Beats 4, 6, 8, 11, 12 are the depth reserve.
