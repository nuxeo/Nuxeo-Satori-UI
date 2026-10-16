---
title: Deployment & Troubleshooting
parent: Engineering
order: 13
last_reviewed: 2026-10-15
repo_commit: c053e63
audience: engineering
---

# Deployment & Troubleshooting

> **Last reviewed:** 2026-10-15 · **Repository:** `c053e63` (`integration/nxsat-308`)
> Only the Runtime table's i18n row was re-verified at that commit, for NXSAT-648, and its
> `NG0201` row, about adf-hx's API ports, was removed with them. On 2026-10-14 at `d36176c`
> (`feature/nxsat-308-remove-adf-packages`) the `E404` row was re-verified, for NXSAT-637. On 2026-10-08 at `2898046`
> (`feature/nxsat-308-ci-cold-cache-tooling`) the repository links were made relative rather than
> pinned to `feature/adf-hx-browse-poc`, every target present. The rest of the page as of
> 2026-08-24 · `77265f9`.
> Packaging detail: [`NUXEO_MARKETPLACE_GUIDE.md`](../../NUXEO_MARKETPLACE_GUIDE.md)

---

## 1. What ships

Three artifacts:

| Artifact                     | Built by                           | Contains                                                                                                              |
| ---------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Marketplace package**      | Maven — `nuxeo-agentic-ui-package` | The built Angular app, the OSGi bundle, and the seed config                                                           |
| **`nuxeo-agentic-core`**     | Maven                              | 189 lines of Java/OSGi: an `AgenticNotificationDocumentIdCodec`, an auth-config fragment, a login start-page fragment |
| **`@nuxeo/satori-platform`** | `nx build platform`                | The npm package customers depend on. 347 kB, 25 files, 4 entry points. **`private: true` — not yet published**        |

`pom.xml` is a Maven parent over three modules: `apps/nuxeo-ui`, `nuxeo-agentic-core`,
`nuxeo-agentic-ui-package`.

```bash
npx nx build nuxeo-ui --configuration=production
mvn package                       # produces the marketplace ZIP
npx nx build platform             # produces dist/libs/platform
```

CI: `build-marketplace.yml` (3 jobs) on PR and manual dispatch — it does not run on merge to
`main`, and publishes to Marketplace preprod only when dispatched with `publishToPreprod`
checked, which `release.yml` (also manual) does for a release.

---

## 2. `install.xml` — the most consequential 20 lines in the repository

```xml
<install>
  <update file="${package.root}/install/bundles" todir="${env.bundles}" />
  <copy dir="${package.root}/web" todir="${env.server.home}/nxserver" overwrite="true" />
</install>
```

Two steps, and **no configuration file**. Since NXSAT-312 configuration is contributed by
Marketplace packages to an extension point and served by a servlet; nothing is edited on the
server and nothing is read from the repository.

### Where configuration comes from

The `nuxeo-agentic-core` bundle declares the component `org.nuxeo.agentic.ui.config` with the
extension point `configuration`, and contributes our defaults to it as one ordinary contribution,
`org.nuxeo.agentic.ui.config.defaults`
(`agentic-ui-config/bootstrap.defaults.json`, `manifest.defaults.json`). A customer ships their own
package:

- `package.xml` declares a dependency on `nuxeo-agentic-ui`, which orders installation;
- its component `<require>`s `org.nuxeo.agentic.ui.config.defaults`, which orders the
  contributions, so the browser applies theirs after ours;
- it contributes `<fragment name layer="bootstrap|manifest" src|<json>>`,
  `<layout type mode src|<json>>` and `<asset name src>` (an image their logo can name). `src`
  is read from their bundle.

A later fragment with the same name and layer replaces the earlier one in place; a later layout
with the same type and mode replaces the file whole; `enabled="false"` removes either. The full
contract is in [`docs/extension-reference.md`](../../docs/extension-reference.md).

### What the servlet serves

`AgenticUiConfigServlet` is mapped at `/agentic-ui-config/*` by the bundle's deployment fragment
(`web#SERVLET`, `web#SERVLET-MAPPING`). A servlet mapping is more specific than Tomcat's default
servlet, so it alone answers for that path; nothing on disk under
`nxserver/nuxeo.war/agentic-ui-config` is served.

| Path                                | Body                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `bootstrap.json`, `manifest.json`   | Envelope `nuxeo-agentic-ui-config/1`: ordered `fragments`, `diagnostics`, and for bootstrap the `assets` |
| `layouts.json`                      | Index of the layouts in force                                                                            |
| `layouts/<type>/<mode>.layout.json` | The layout file in force, whole                                                                          |
| `assets/<name>`                     | A contributed image, with its own content type                                                           |

Every fragment and asset carries its provenance — contributing component, bundle and `src` (or
`inline`). Every 200 has an `ETag` that hashes the body, which is fixed for as long as the
configuration built at startup stands, plus `Cache-Control: no-cache`,
`X-Content-Type-Options: nosniff` and a `sandbox` CSP. `If-None-Match` answers 304. GET and HEAD
only. A fragment that is not a JSON object, is larger than 1 MiB, or
cannot be read is left out and reported in `diagnostics`; the server still starts. When such a
fragment, layout or asset was meant to replace an earlier one, the earlier one stays in force where
it was, and a `kept` warning says so.

**Anonymous by design.** The application reads its configuration before sign-in, so no
authentication filter is mapped on the path. **Nothing sensitive may be contributed** — every
fragment is public.

### No migration from `bootstrap.json` or the Note

The old mechanism — a `bootstrap.json` edited beside the bundle, and a manifest Note at
`/default-domain/config/agentic-ui` — is **removed with no migration**, in two steps that ship
together. The server side (NXSAT-312 slice 1) stops serving files from disk: a file left in
`nxserver/nuxeo.war/agentic-ui-config` is not read, served or reported. The client side (slice 2)
stops reading the Note: the application makes no request for it, before or after sign-in, and
applies only the fragments the server serves. A Note left in the repository is inert. Anyone
using either must re-create their settings in a configuration package, or as a preset in a demo
package. In a clone of this repository,
`node tools/satori-generators/src/config-package/create.mjs <name> --owner=<owner>` scaffolds one
with Node 20 alone — no `npm ci`, no registry token — and `node config-packages/<name>/build.mjs`
checks its fragments and writes the zip `nuxeoctl mp-install` takes, to `config-packages/<name>/dist/`.
Where Nx is installed, the `config-package` generator writes the same files
(`npx nx g ./tools/satori-generators:config-package <name> --owner=<owner>` after a full install,
or `npx nx g @nuxeo/satori-platform:config-package …` from the published package) and
`npx nx build <name>` runs the same `build.mjs`. `config-packages/presales-demo` is the demo
package presales installs.

### How the application loads it

At startup, before anything renders and before anyone signs in, the application fetches
`agentic-ui-config/bootstrap.json` and `manifest.json` — siblings, resolved from its base href —
in parallel and anonymously. It folds each response's fragments over its compiled defaults in the
order served, then applies a presales preset if a package enables switching and one is chosen.
Nothing is fetched again when a user signs in, out, or switches: both halves are the same for
everyone. Only the `nuxeo-agentic-ui-config/1` envelope is accepted; a bare JSON object, an error
status, an unreachable server or one that does not answer within 10 s leaves the compiled defaults
in force, and `AppConfigService.diagnostics()` records why. Every reason, and every diagnostic the server
reports, is also written to the browser console as a warning prefixed `[agentic-ui-config]`. The
template app's home page lists the package behind every fragment. "Anonymously" means neither URL
needs credentials: once a user has signed in with a password, the auth interceptor adds them to
these requests as it does to every `/nuxeo/` request, and the servlet ignores them.

Under `nx serve` there is no servlet: `npm run config:dev` writes both files, as envelopes, into
the gitignored `apps/nuxeo-ui/public/agentic-ui-config/`, from our defaults plus any fragment
files given. Run it before starting the dev server, which serves only files that existed when it
started.

### Why the package installs no file a customer edits (NXSAT-317)

`overwrite="false"` broke the upgrade when it was used to protect an edited `bootstrap.json`. An
upgrade is an uninstall of the old version, which deletes each package file only while its md5
still matches, then an install of the new one, whose `overwrite="false"` copy throws on the file
left behind. The install rolls back only its own commands: **no version is installed** and
`/nuxeo/agentic-ui/` returns 404. `review-guardrails.mjs` (`checkInstallerOwnsNoCustomerFile`)
refuses any non-overwriting copy, any copy into `agentic-ui-config`, and any `src/main/config`
directory in the package.

### Why the web destination is what it is

The `nuxeo` context declares `docBase="../nxserver/nuxeo.war"`, so `/nuxeo/agentic-ui/` resolves
to `nxserver/nuxeo.war/agentic-ui/`. **`nxserver/web` holds only `root.war` and is not a docBase —
anything placed there is never served.** An earlier version shipped `nxserver/web/…` and would have
404'd on every install.

> **Changing `install.xml` or marketplace packaging is a hard stop** in the phase skill — escalate
> rather than attempt it. The reasoning above is why.

---

## 3. Local development stack

| Component          | How                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nuxeo + OpenSearch | Docker, container `nuxeo`, port 8080. See [`docs/opensearch-setup.md`](../../docs/opensearch-setup.md)                                                                                |
| Server-side config | [`nuxeo-conf/`](../../nuxeo-conf) — read its README                                                                                                                                   |
| The app            | `npx nx serve nuxeo-ui` → `:4200`, proxying `/nuxeo` → `:8080`                                                                                                                        |
| ARender            | `docker compose -f arender-docker-compose.yml --env-file .env.arender up -d`. nginx auth proxy + UI + document-service-broker. [`docs/arender-setup.md`](../../docs/arender-setup.md) |
| Mailpit            | `docker compose -f mailpit-docker-compose.yml up -d` — local SMTP for permission notifications                                                                                        |

Verify with `npm run beta:backend`.

---

## 4. Configuration reference

| Setting                     | Lives in                                                  | Changed by                           |
| --------------------------- | --------------------------------------------------------- | ------------------------------------ |
| Nuxeo API origin            | A `bootstrap` fragment → `nuxeoApiOrigin`                 | Customer's configuration package     |
| Branding, themes, languages | A `bootstrap` fragment                                    | Customer's configuration package     |
| Feature toggles             | A `manifest` fragment → `featureToggles`                  | Customer's configuration package     |
| Per-type layouts            | A `<layout type mode>` contribution                       | Customer's configuration package     |
| AI backend URL              | `AI_BACKEND_URL` token                                    | Deployment                           |
| Bundle budgets              | `angular.json`                                            | Engineering                          |
| Total payload ceiling       | `ci.yml` → `NUXEO_UI_BUNDLE_SIZE_LIMIT_BYTES` = **6 MiB** | Engineering, with recorded reasoning |

---

## 5. Troubleshooting

### Build and install

| Symptom                                                                                                       | Cause                                                                                            | Fix                                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `E404` on `@hylandsoftware/*`                                                                                 | Token missing or lacks `read:packages` on the **Hyland** org                                     | Set `SATORI_GH_READONLY_TOKEN`; it needs `read:packages` on the Hyland org                                  |
| `npm ci` fails on CI, green locally                                                                           | A bare `npm install` on macOS pruned Linux-only optional entries                                 | Restore a known-good lock, merge only new entries, run the lockfile gate                                    |
| CI fetches from the wrong registry after an `.npmrc` change                                                   | `npm ci` installs from each entry's `resolved` URL and **ignores** the mapping                   | Regenerate the lock                                                                                         |
| `/nuxeo/agentic-ui-config/bootstrap.json` 404s                                                                | The servlet is not mapped: `nuxeo-agentic-core` not deployed, or `web.xml` not regenerated       | `nuxeoctl mp-list`; `nuxeo.war/WEB-INF/web.xml` must name "Agentic UI Configuration". Restart. See §2       |
| Nuxeo will not start after a configuration package: `requires [service:org.nuxeo.agentic.ui.config.defaults]` | Our package is missing or older than NXSAT-312; strict mode aborts on the unresolved `<require>` | Install or upgrade `nuxeo-agentic-ui` first, or `mp-remove` the configuration package                       |
| A contributed setting does nothing                                                                            | The fragment was rejected, or applied before ours because the component lacks the `<require>`    | Read `diagnostics` in the served response; add `<require>org.nuxeo.agentic.ui.config.defaults</require>`    |
| An edited `bootstrap.json` on the server has no effect                                                        | Removed in NXSAT-312 with no migration                                                           | Re-create the settings in a configuration package or a preset. See §2                                       |
| `npx nx g …:config-package` stops at `Could not find Nx modules … Have you run npm/yarn install?`             | No install in this clone, and `npm ci` needs a GitHub Packages token                             | `node tools/satori-generators/src/config-package/create.mjs <name> --owner=<owner>`: same files, no install |
| Upgrade fails: `overwrite flag on false but destination file exists`                                          | A pre-NXSAT-317 package upgraded after `bootstrap.json` was edited                               | Move the file out of `nxserver`, `mp-install`, move it back. See §2                                         |
| Marketplace build fails                                                                                       | Java/Maven version                                                                               | Java 17+, Maven 3.9+                                                                                        |

### Runtime

| Symptom                                                    | Cause                                                                                                         | Fix                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Unresolved `sat.*` keys, or English in another language    | Missing from the build: satori-ui's catalogue is caught to `{}`; the app's falls back to English **silently** | `npm run beta:bundle` — asserts both runtime catalogues ship, each resolving a key the app renders   |
| An edited manifest Note has no effect                      | The application no longer reads it (NXSAT-312), with no migration                                             | Re-create its content as a `manifest` fragment in a configuration package                            |
| `?preset=` does nothing and no badge appears               | No package sets `presales.presetSwitching: true`, or the preset name is not defined                           | The console shows `[agentic-ui-config] preset … ignored: …`; enable it in the demo package only      |
| Under `nx serve`, configuration falls back to the defaults | `public/agentic-ui-config/*.json` missing, created after the server started, or not an envelope               | `npm run config:dev`, then restart `nx serve`                                                        |
| Empty lists; intermittent 403 on `/nuxeo/api`              | XHRs unauthenticated                                                                                          | Session satisfies the _guard_; `httpCredentials` authenticates _requests_. Both needed               |
| HTTP 500 from `AI.*`                                       | The AI backend is a **separate package not in this repo**                                                     | Expected. Install it, or accept the 500                                                              |
| Broken image, or an internal API URL in the DOM            | `<img [src]>` bound to a Nuxeo URL — bypasses the interceptor entirely                                        | Fetch the blob via a service, use a blob URL, revoke on destroy                                      |
| Memory growth over a session                               | An un-revoked blob URL                                                                                        | Track the raw URL at creation — a `SafeUrl` cannot be read back — and revoke on destroy and on reset |
| A nav entry lands on the wrong page                        | A registered path with **no route** — it falls through the wildcard                                           | The host must map the path; `ExtensionOutletComponent` resolves the component by ID                  |
| A manifest entry silently does nothing                     | The slot is **reserved** (`routes`, `toolbar`, `contextMenu`, `tabs`) or was renamed                          | Check the slot list. `beta:upgrade` catches the rename class                                         |
| Preview fails for rich formats                             | ARender not running                                                                                           | Start the compose stack                                                                              |
| Permission emails not arriving                             | No SMTP locally                                                                                               | Start Mailpit                                                                                        |
| A rule permits when it should deny                         | Unregistered rule IDs **fail open** by design                                                                 | Add it to `failClosedRules` if it gates a surface                                                    |

### Diagnosis limits, stated honestly

There is **no APM, structured logging, metrics export or error reporting**. In a customer
environment you have: the browser console, Nuxeo's server logs, and whatever the user tells you.
That is the largest operational gap in the product — see
[Scalability & Operations](../10-leadership/06-scalability-and-operations.md).

---

## 6. Publishing the platform package

Deliberately deferred. `private: true` is the last thing standing between a mistyped
`npm publish` and a public release of an unfinished package.

- Scope and registry are **decided**: `@nuxeo/satori-platform` on
  `https://packages.nuxeo.com/repository/npm-public/` — the registry `nuxeo-elements` already
  publishes to.
- Runbook: [`docs/publishing-to-nuxeo-registry.md`](../../docs/publishing-to-nuxeo-registry.md)
- Readiness and what is deliberately not done: [`docs/publish-readiness.md`](../../docs/publish-readiness.md)

Before publishing, `npm run beta:publishable` must pass. It runs a real `npm publish --dry-run`,
which is **the only check that executes `prepublishOnly`** — and for the whole of Phase 4 the
package could not be published at all because it was compiled in full compilation mode, while six
other gates were green.

---

## 7. Rollback

**Not verified in repository.** Marketplace package rollback is presumably Nuxeo's standard
mechanism, but nothing here tests it and no runbook exists. The _upgrade_ path is tested on every
build by `beta:upgrade`; the rollback path is not.

Worth establishing before a customer goes live, alongside the observability gap.
