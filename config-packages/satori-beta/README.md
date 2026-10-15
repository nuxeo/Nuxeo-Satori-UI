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
the package requires, and a browser picks it up on its next load.

## Three things to know

- **Everything in a fragment is public.** The application reads its configuration before anyone
  signs in, so both endpoints are served without authentication. Put no secret, token or internal
  host name in a fragment.
- **Hiding something is not a security control.** A manifest can hide an action; Nuxeo's
  permissions still decide whether a user may perform it.
- **Install it on a Nuxeo Satori that has the configuration service.** `package.xml` depends on
  `nuxeo-agentic-ui` without a minimum version, because no published version yet separates a
  build with the service from one without it. On an older build Nuxeo refuses to start, because
  `org.nuxeo.agentic.ui.config.defaults` does not exist there; remove this package to recover.

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
