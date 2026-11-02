# Nuxeo Satori beta — Nuxeo Satori configuration

The package the hosted Beta environment installs, `https://satori-ui.beta.nuxeocloud.com/`. It
configures one thing: it points the Annotations tab at the Nuxeo Enhanced Viewer deployed beside it
at `https://nev-satori.beta.nuxeocloud.com`. Nothing else is overridden — the Beta runs Satori's own
branding, themes and navigation, so this package adds `integrations.arender.viewerOrigin` and
nothing more.

Without it the Annotations tab reads "Annotations are not available for this document", which is
the correct and documented behaviour of an unconfigured deployment: `ARENDER_CONFIG` has no
compiled-in default, by design, so the annotation viewer is off until a bootstrap fragment names a
viewer (`docs/arender-setup.md`). The viewer being deployed and healthy is not enough on its own —
the browser is told where it is only here. See NXSAT-301.

`viewerOrigin` is a public host name, not a credential: it is the URL the user's own browser frames,
and it is already visible to anyone who loads the page. The OAuth2 client secret NEV uses to reach
Nuxeo lives in `nuxeo.conf` on the server and must never appear in this package.

It contributes two fragments to the
`org.nuxeo.agentic.ui.config` extension point, and the server serves them after Satori's own
defaults at `/nuxeo/agentic-ui-config/bootstrap.json` and `manifest.json`.

Nothing is edited on the server and nothing is stored in the repository: a change reaches a server
only as a new version of this package, built from reviewed source.

| File                                      | What it is                                                           |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `bundle/agentic-ui-config/bootstrap.json` | Layer 0 — branding, logo, themes, languages, endpoints, sign-in      |
| `bundle/agentic-ui-config/manifest.json`  | Layer 1 — hide, reorder, relabel and gate what the application shows |
| `bundle/agentic-ui-config/assets/`        | Images a fragment names, such as a logo                              |
| `bundle/OSGI-INF/`                        | The Nuxeo component that contributes the fragments                   |
| `package/package.xml`                     | Package name, version, and the dependency on `nuxeo-agentic-ui`      |
| `schema/`                                 | JSON schemas your editor uses to check the fragments as you type     |
| `build.mjs`                               | Checks the package and writes the installable zip                    |

The keys each fragment accepts are documented in `@nuxeo/satori-platform`'s
`extension-reference.md`.

## Change, build, install

```bash
# 1. edit the fragments, and raise the version in package/package.xml
node build.mjs                                      # checks the fragments, writes dist/satori-beta-<version>.zip
nuxeoctl mp-install dist/satori-beta-<version>.zip   # on the Nuxeo server, then restart Nuxeo
```

Run it in this directory. `build.mjs` needs only Node 20 — nothing to install, no registry token —
so the package can live in your own repository. In an Nx workspace, `npx nx build satori-beta` runs
the same script and writes the zip to `dist/config-packages/satori-beta/` at the workspace root instead.

`build.mjs` refuses — with the file and the reason — what the server would
leave out: a fragment or layout body, in a file or inline, that does not parse, is not an object,
repeats a key, or exceeds 1 MiB; an asset over 2 MiB or not named as a plain image file; an entry
whose name or layer the server rejects, or that has no body. It also refuses XML that is not
well-formed UTF-8, a `src` or `Nuxeo-Component` that names no packaged file, a symbolic link in `bundle/`
or `package/`, a package name or version that is not a plain file name, and a component that does
not `<require>` Satori's defaults.

**Raise the version for every change you install.** Nuxeo installs a higher version as an upgrade;
the same version is the package it already has.

The server reads the fragments once, at startup. A change applies after the restart that installing
the package requires, and a browser picks it up on its next load. **While you are still deciding
what a value should be, do not pay that.** Switch on the development override directory below,
edit a file, reload the tab.

## The fast loop while you are tuning a value

Everything above is the way a change reaches a customer: reviewed, versioned, built from source,
installed. It is also two to four minutes per iteration and a restart that drops every open
session, which is the wrong price for finding out whether a title fits in the header.

A development server can read a directory on its own disk on every request instead
(NXSAT-312). Switch it on in `nuxeo.conf`:

```
nuxeo.agentic.ui.config.dev=true
# optional; defaults to ${nuxeo.data.dir}/agentic-ui-config-dev
# nuxeo.agentic.ui.config.dev.dir=/var/lib/nuxeo/agentic-ui-config-dev
```

Restart once, for that line only. From then on the loop is **edit the file, reload the tab** —
no rebuild, no version bump, no reinstall, no restart. Measured on a local Docker Nuxeo: 0.1 s
against 8.5 s for the restart alone on that same container, and the plan's figure for a real
demo server is 60–120 s.

The directory has the same shape as `bundle/agentic-ui-config/`, so you copy a file across rather
than learn a second layout:

| File                                     | What it contributes                                             |
| ---------------------------------------- | --------------------------------------------------------------- |
| `bootstrap.json`                         | a bootstrap fragment named `dev`, applied after every package's |
| `bootstrap.<name>.json`                  | a bootstrap fragment named `<name>`                             |
| `manifest.json` / `manifest.<name>.json` | the same, in the manifest layer                                 |
| `layouts/<Type>/<mode>.layout.json`      | a per-type layout                                               |
| `assets/<file>`                          | an image a fragment names                                       |

`bootstrap.json` is named `dev`, which no package uses, so it is appended and wins on the keys it
sets. Name the file after a packaged fragment instead — `bootstrap.defaults.json` — and it
**replaces** that fragment in place, losing every key it does not restate. Both are useful; pick
deliberately. Any other file name is reported in the response's `diagnostics` rather than passed
over, so a mistyped `bootsrap.json` tells you what happened.

An override is an ordinary contribution and nothing about the contract is relaxed for it: it is
validated the same way, a malformed one is rejected and reported and the packaged fragment stays
in force, replacements keep their position, each fragment carries the file it came from in its
provenance, and a contributed image is served with the same `default-src 'none'; sandbox` policy
and the same name allow-list. That is deliberate — an override that skipped validation would be
worse than the restart it saves.

### Getting the file onto the server

Docker, which is what a local Nuxeo usually is:

```bash
docker cp bundle/agentic-ui-config/bootstrap.json \
  nuxeo:/var/lib/nuxeo/agentic-ui-config-dev/bootstrap.json
```

To watch and copy on every save, with `fswatch` (macOS) or `inotifywait` (Linux):

```bash
fswatch -o bundle/agentic-ui-config | while read -r _; do
  docker cp bundle/agentic-ui-config/. nuxeo:/var/lib/nuxeo/agentic-ui-config-dev/
done
```

**`nuxeo sync` does not help in Docker mode, and this is worth knowing before you try.** The
Nuxeo CLI watcher is real and does exactly this job, but `generator-nuxeo`'s configure step skips
the destination prompt when the deployment is Docker and hardcodes
`/opt/nuxeo/server/nxserver/nuxeo.war/ui/`, which is Web UI's directory, not ours
(`generators/synchronize/configure-delegate.js`, verified against `generator-nuxeo@4.0.7`). In
**local** deployment mode `dest` is prompted and free, so on a non-containerised server
`nuxeo sync` can target the override directory and works.

### Before you put it on anything shared

- **It is off unless that property is set.** With the property unset the directory is not read,
  not stat-ed and not reached, whatever is in it — asserted on the response bytes by
  `AgenticUiConfigDevOverrideTest`, and by the `checkDevConfigOverrideIsNotProductionReachable`
  guardrail on anything this repository ships.
- **Never set it in production.** It makes configuration editable by anyone who can write to the
  server's filesystem, which is exactly the privilege separation a regulated customer is relying
  on. It belongs on a development box or a demo box, nowhere else.
- **A value you keep is not finished until it is in the package.** The override directory is for
  deciding; `bundle/agentic-ui-config/` plus a version bump is how the decision ships.

## Publish it to a Nuxeo Cloud environment

`nuxeoctl mp-install` above installs a zip you already have. A hosted environment installs from
the Marketplace instead, so the package has to be published there first — that is what the
**Publish Configuration Package** workflow does. Dispatch it with this directory's name:

```bash
gh workflow run publish-config-package.yml -f package=satori-beta -f publishToPreprod=true
```

It builds the zip with the same `build.mjs`, so the published bytes are the ones reviewed here,
and uploads it to preprod Connect (`nos-preprod-connect.nuxeocloud.com`). Leave
`publishToPreprod` off to get the zip as a run artifact without publishing anything.

Two things it does **not** do, both deliberate:

- **It does not stamp a version.** `nuxeo-agentic-ui` gets a build timestamp because every merge
  produces a new one; a configuration package's version is a reviewed property of the source,
  and it is what `nuxeoctl` compares to decide whether an install is an upgrade. Raise it in
  `package/package.xml` in the same commit as the change.
- **It does not publish to production Connect.** `connect.nuxeo.com` is a separate decision with
  a separate credential, not a flag on this run.

`package.xml` declares `<visibility>PRIVATE</visibility>`, as `nuxeo-agentic-ui` does. That does
**not** hide the listing: on preprod, `nuxeo-agentic-ui` is reachable at
`/nuxeo/site/marketplace/package/nuxeo-agentic-ui` and is returned by searching the catalogue for
"satori", both without signing in. What needs credentials is downloading it — the package zip is
`401` to an anonymous request. So a reviewer can be pointed at the listing URL; installing it is
what requires a Nuxeo Online Services account.

## Three things to know

- **Everything in a fragment is public.** The application reads its configuration before anyone
  signs in, so both endpoints are served without authentication. Put no secret, token or internal
  host name in a fragment.
- **Hiding something is not a security control.** A manifest can hide an action; Nuxeo's
  permissions still decide whether a user may perform it.
- **It will only install on a Nuxeo Satori that has the configuration service.** `package.xml`
  depends on `nuxeo-agentic-ui:2026.0.2` — a minimum, with no maximum. Below it
  `org.nuxeo.agentic.ui.config.defaults` does not exist, this package's component `<require>`s a
  component that is not there, and Nuxeo refuses to start; remove the package to recover. The
  service landed in `2026.0.2`, so the whole published `2026.0.1` line is that broken install and
  the floor is what stops the Marketplace offering it. A timestamped build satisfies the floor —
  Nuxeo sorts `2026.0.2-20261013051939-BUILD-1884` **above** bare `2026.0.2`, not below it as
  Maven would — so this constrains nothing that is actually published at or after `2026.0.2`.

## Order, when there is more than one package

Fragments apply in the order Nuxeo registers their components, and a later key wins. This package
is ordered after Satori by two declarations: the dependency in `package.xml` (installation order)
and the `<require>` in `bundle/OSGI-INF/satori-beta-config.xml` (contribution order). To layer a second package on
this one — a regional variant, say — give it the same two declarations naming **this** package and
component.

A later fragment with the same `name` and layer replaces an earlier one in place;
`<fragment name="…" layer="…" enabled="false" />` removes one.

## Remove

```bash
nuxeoctl mp-remove satori-beta      # then restart; Satori's defaults apply again
```
