# Customising Nuxeo Satori

**You need Node.js 20 or later, a text editor, and a Nuxeo server with Nuxeo Satori on it. Nothing
else — no dependencies to fetch, no build tooling, no registry token, no account.**

This page is the whole customer path, end to end. It covers what you can change without writing
code: the product name, the logo, the colours, the wording, and which menu entries, buttons, tabs
and list columns appear, in what order, under what name, and for whom.

You do that by shipping your **own Nuxeo Marketplace package** that depends on ours. The server
reads your configuration after Satori's own defaults, so your settings win, and an upgrade of ours
never touches them. Nothing is edited on the server and nothing is stored in the content
repository: a change reaches a server only as a new version of your package, built from source you
reviewed.

The rest of this repository is a development workspace for people working on Satori itself. You do
not need any of it, and the commands in [`README.md`](README.md) are not for this path — they need
credentials you have no reason to have.

---

## 1. Get the scaffolder

The generator lives in this repository, which is public, so a clone needs no account:

```bash
git clone --depth 1 https://github.com/nuxeo/Nuxeo-Satori-UI.git
cd Nuxeo-Satori-UI
```

> Cloning our repository to reach the scaffolder is a rough edge we intend to remove — the
> generator will be distributed on its own. Until it is, this is the route, and it is the only
> thing you need the clone for: your package is a directory of JSON and XML that you move into your
> own repository once it is created.

## 2. Create your configuration package

```bash
node tools/satori-generators/src/config-package/create.mjs acme-config --owner=acme
```

Use your own name and owner prefix. The name becomes the Marketplace package name, and the owner
prefixes the Nuxeo component (`acme.config.acme-config`) so it cannot collide with ours or with
another customer's. `--help` lists the rest: `--title`, `--vendor`, `--version`, `--directory`.

It writes `config-packages/acme-config/`:

| Path                                      | What it is                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `bundle/agentic-ui-config/bootstrap.json` | **Layer 0** — product name, logo, themes, languages, sign-in                            |
| `bundle/agentic-ui-config/manifest.json`  | **Layer 1** — hide, reorder, relabel and gate what the application shows                |
| `bundle/agentic-ui-config/assets/`        | Images a fragment names, such as a logo                                                 |
| `bundle/OSGI-INF/acme-config-config.xml`  | The Nuxeo component that contributes the two fragments, ordered after Satori's defaults |
| `package/package.xml`                     | Package name, version, and the dependency on `nuxeo-agentic-ui`                         |
| `schema/`                                 | JSON schemas, so your editor checks the fragments as you type                           |
| `build.mjs`                               | Checks the package and writes the installable zip                                       |

Move that directory wherever you keep your own source. It is self-contained: `build.mjs` has no
dependencies, so it builds the same way from anywhere.

## 3. Change something

Open `bundle/agentic-ui-config/bootstrap.json`. This renames the product, adds a theme of your own
and makes it the default:

```json
{
  "$schema": "../../schema/bootstrap.schema.json",
  "branding": {
    "applicationTitle": "Acme Documents",
    "documentTitle": "Acme Documents"
  },
  "themes": [{ "id": "acme-dark", "label": "Acme Dark", "base": "dark" }],
  "defaultThemeId": "acme-dark"
}
```

**`defaultThemeId` has to name a theme that exists, or nothing happens and nothing says so.** The
four that ship are `nuxeo` (the default), `dark`, `kawaii` and `light`; to select one of those, set
`defaultThemeId` to its ID and leave `themes` out. An ID that matches none of them falls back to
the first theme, so the application looks exactly as it did and the only symptom is that your
change had no effect. Your own entry needs an `id`; `base` says which shipped theme it starts from,
and `tokens` overrides individual colours on top of that. Themes you list are merged over the
shipped ones by `id`, so restyling one does not mean restating the other three.

And `bundle/agentic-ui-config/manifest.json` hides the Trash entry, renames Collections, and shows
Administration to administrators only:

```json
{
  "$schema": "../../schema/manifest.schema.json",
  "version": 1,
  "extensions": {
    "overrides": {
      "app.navbar.trash": { "visible": false },
      "app.navbar.collections": { "label": "Repository" },
      "app.navbar.administration": { "rule": "app.rules.isAdministrator" }
    }
  }
}
```

**Every name you can address is listed in [`docs/extension-reference.md`](docs/extension-reference.md).**
If an ID is not in that file, do not depend on it. The conditions you can put in a `rule` are a
fixed list that ships with the product; adding your own is code, which is a different path.

Three things to know before you put anything in a fragment:

- **Everything in a fragment is public.** The application reads its configuration before anyone
  signs in, so both files are served without authentication. Put no secret, token or internal host
  name in them.
- **Hiding something is not a security control.** A manifest changes what the screen offers, not
  what the server allows. Nuxeo checks permissions on every operation; restrict access with Nuxeo
  permissions.
- **Raise the version in `package/package.xml` for every change you install.** Nuxeo treats the
  same version as the package it already has and will not replace it.

## 4. Build the package

```bash
node config-packages/acme-config/build.mjs
```

```
built config-packages/acme-config/dist/acme-config-1.0.0.zip  (1549 bytes, sha256 aaba4c94…)
  bundle  META-INF/MANIFEST.MF
  bundle  OSGI-INF/acme-config-config.xml
  bundle  agentic-ui-config/bootstrap.json
  bundle  agentic-ui-config/manifest.json
```

That zip is a complete Nuxeo Package. The build is reproducible — fixed timestamps, entries sorted
by code point — so the same reviewed source always produces the same bytes.

`build.mjs` applies the checks the server applies, and **refuses rather than writing a zip Nuxeo
would install and then silently ignore.** It names the file and the reason. It catches JSON that
does not parse, is not an object, repeats a key or nests too deeply; a fragment over 1 MiB or an
asset over 2 MiB; a fragment name, layer, layout type or mode the server would reject; a `src` that
names no packaged file; XML that is not well-formed; a symbolic link, which would package bytes you
did not review; and a component missing the `<require>` that orders your fragments after ours.

## 5. Install it on the server

Copy the zip to the Nuxeo server and, as the user Nuxeo runs as:

```bash
nuxeoctl mp-install acme-config-1.0.0.zip
```

Then restart Nuxeo. The server reads the fragments once, at startup, so the change applies after
that restart, and a browser picks it up on its next load. To confirm it took, fetch the endpoint
the application reads — your values should be there, merged over Satori's defaults:

```bash
curl http://<server>/nuxeo/agentic-ui-config/bootstrap.json
```

To go back, `nuxeoctl mp-remove acme-config` and restart; Satori's defaults apply again.

> Your package declares a dependency on `nuxeo-agentic-ui:2026.0.2` as a minimum. Below that
> version the server has no `org.nuxeo.agentic.ui.config.defaults` for your component to require,
> and Nuxeo refuses to start — remove the package to recover.

---

## If something goes wrong

| What you see                                          | What it means                                                                         | What to do                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `build.mjs` exits non-zero naming a file and a reason | The server would have rejected that fragment, so the zip was not written              | Fix what it names. It is quoting the rule the server applies                              |
| `"<name>" is a name Satori itself uses`               | `defaults` and `nuxeo-agentic-ui` are ours; a package of that name would replace ours | Choose another name                                                                       |
| The package installs, Nuxeo starts, nothing changes   | Almost always the version: Nuxeo kept the package it already had                      | Raise the version in `package/package.xml`, rebuild, install again, restart               |
| Nuxeo refuses to start after installing               | The server is older than `nuxeo-agentic-ui:2026.0.2`                                  | `nuxeoctl mp-remove acme-config`, restart, then upgrade Satori                            |
| `curl` returns Satori's defaults and not your values  | The fragments registered before ours instead of after                                 | Check the `<require>org.nuxeo.agentic.ui.config.defaults</require>` in your component XML |
| An override you wrote does nothing                    | The ID is not one the product registers                                               | Check it against [`docs/extension-reference.md`](docs/extension-reference.md)             |
| The colours did not change, and nothing said why      | `defaultThemeId` names a theme that does not exist, so the first one was used instead | Define it in `themes`, or name one of `nuxeo`, `dark`, `kawaii`, `light`                  |

## What this path does not cover

Configuration cannot add a new screen, make a shipped button do something different, or add a
condition of your own — those are code, written against `@nuxeo/satori-platform` in your own
repository, and they are a separate path with its own prerequisites. The product side of that
decision is in
[the short version](documentation/20-product/00-the-short-version.md#what-needs-code).

## Read next

| To…                                                | Read                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Know every name a fragment can address             | [Extension reference](docs/extension-reference.md)                                                |
| Understand the product and what it does not do yet | [The short version](documentation/20-product/00-the-short-version.md)                             |
| See a finished example                             | [`config-packages/presales-demo`](config-packages/presales-demo)                                  |
| Troubleshoot an install                            | [Deployment & troubleshooting](documentation/30-engineering/13-deployment-and-troubleshooting.md) |
