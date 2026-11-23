# Phase 1 improvements

Hi all,

Thanks for the feedback. It came from a few different places, so I've put it all in one list: what you asked for, and what we've done so far. At the end you'll find how to install the `satori-beta` package, a prototype of what we're planning for GA, and links to the docs.

## Status

**1. The generator needed `npm ci` and access to a private package registry**

- Done. The generator no longer depends on any third-party UI packages. We built our own component library, and it works with or without Satori.
- To make a config package you only need Node.js now. You don't need `npm ci`, a token or an account.
- Config packages have moved to their own public repo, nuxeo/Nuxeo-Satori-Config. It builds every PR and can publish to the pre-prod Marketplace. It also sets the version number for you.
- What's left: installing the full UI repo still needs a GitHub token, because Satori UI comes from GitHub Packages. The Nx generator needs that full install too. The easy way around it is to copy `presales-demo` in the config repo.
- To try it, install the `satori-beta` package from the pre-prod Marketplace: [satori-beta 1.1.0](https://nos-preprod-connect.nuxeocloud.com/nuxeo/site/marketplace/package/satori-beta?version=1.1.0-20261112020624-BUILD-1). The steps are in [Installing the satori-beta package](#installing-the-satori-beta-package) below.

**2. No config stored as a Note, and no forking**

- Done. The config only comes from Marketplace packages now. Nothing is saved as a Note or stored in the repository, and nobody edits it on the server.
- Customisation that used to live in the Angular Web UI is now a config package. You install your own package on top of the default one.
- We ship the default package, `nuxeo-agentic-ui`. Your package depends on it and loads after it, so your settings win.
- When we upgrade our package, yours stays as it is. We tested that. If you remove yours, you're back on the defaults.
- We also fixed the bug where an upgrade failed after someone had edited the config on the server.

**3. Static files in `nuxeo.war` and `nuxeo sync` instead of the servlet**

- We kept the servlet on purpose. With static files, your config and ours would be the same file, so one package would overwrite the other. Editing that file on the server is also what broke Marketplace upgrades.
- For quick changes there's now a dev mode. Set `nuxeo.agentic.ui.config.dev=true` in `nuxeo.conf` and restart Nuxeo once. After that, the server reads your files from its dev folder on every request: `agentic-ui-config-dev` in the Nuxeo data directory, or the folder you set in `nuxeo.agentic.ui.config.dev.dir`. You edit a file and reload the page, without rebuilding or restarting.
- `nuxeo sync` works with that folder on a local install. In Docker it doesn't, because there it always writes to Web UI's folder. The extension reference has a small `docker cp` script for that case.
- About the prompts: the two branding prompts in nuxeo-agentic-ui-prompts still copy `bootstrap.json` into `nxserver/nuxeo.war/agentic-ui-config/`, and they read a file that no longer exists. The servlet owns that path now and ignores files on disk there, so the branding never shows up. I think that's behind a lot of the "overkill" feeling, and the agents getting confused.

**4. A quick branding swap for demos**

- Done. Copy `presales-demo`, rename it (the README says where), and change the title, logo, favicon and theme in `bootstrap.json`. Then run the Publish workflow with "publish to preprod" ticked.
- If you're trying things out on your own demo server, the dev mode from point 3 is quicker.
- The presets for "one server, many customers" are still there, but they stay off unless a package turns them on. You can ignore them.

**5. Changing the top-left icon without forking**

- Partly done. `branding.logo` changes the logo in the header and on the sign-in page, and `branding.favicon` changes the browser tab icon.
- Not yet: the small mark at the top of the left navigation rail, and the "Content Innovation Cloud" title you see when the rail is open. Those come from the Satori design system, and we haven't started on them.

**6. Views per document type**

- Mostly done. The `app.rules.isType` and `app.rules.hasFacet` rules let you show or hide actions and tabs by type or facet.
- A layout file in your package decides which properties each type shows. Without one, we show the fields from the type's schemas.
- Editing works too. The Edit and Create dialogs show the type's own fields, from its schemas or from an edit or create layout in your package. The Properties panel itself is read-only.
- Two things don't work yet. Folder types like a Case folder open in Browse, so you never see their Properties panel. And a fully custom view or form for one type needs code, which is blocked by point 7.

**7. Building a real app on our components**

- Not yet. `@nuxeo/satori-platform` is ready (Satori is optional, and it falls back to Material), but we haven't published it, so it isn't on any registry. Publishing it is planned.
- Until then, code changes have to be built from our repo. Custom code also doesn't plug into the app we ship. You build your own app from our template.

**8. Making the "what configuration can't do" list configurable**

- Partly done. The logo, the favicon, type and facet rules, and per-type layouts (including the Edit and Create forms) are all configuration now.
- These still need code, or aren't possible yet: the rail mark, your own rule conditions (like "the user is in the legal team"), new screens, buttons that do something new (configuration can only place a button for an action that already exists in the code), and installing from a public registry.

**9. Using the Nuxeo JS client instead of our own**

- No decision yet. The UI still talks to Nuxeo through its own Angular services, 26 of them. We owe you an answer on this one.

**10. Streaming previews instead of loading the whole file**

- Not started. Right now the viewer downloads the whole file and then shows it, so a big video or PDF doesn't start until the download is done. We do it this way so credentials never end up in a URL.
- The fix is to let the browser load the file from Nuxeo directly, a piece at a time. The app already has a Nuxeo browser session (we use it for images in notes), so it's more a design change than new infrastructure.
- If NEV (ARender) is installed, you can already switch the View tab to it with a manifest rule. NEV renders on the server.

**11. All the permission levels, not just three**

- Done. The old Browse page that only had Read, ReadWrite and Everything is gone, and its links now open `/browse`.
- The Permissions tab on a document and on `/browse` now offers the full list: what the server suggests for that type, the standard ones (Write, Remove, WriteSecurity, Unlock and so on), and any other permission the server reports. Nuxeo only reports the permissions you hold yourself, so you see all the custom ones only if you have Everything.
- Collections show the server's list for the type, like Web UI does.

**12. Moving existing Studio customisations to Satori**

- Not yet. Studio is still on Polymer, so there's no way to extract existing Studio customisations and import them into Satori.
- This is difficult without access to the Studio API. We'll look into it and let you know.

Thanks too for the kind words about the registered IDs, the API snapshot, the fork and upgrade tests, and the drift check. They're all staying, and the config repo now runs the drift check every Monday as well.

## Installing the satori-beta package

`satori-beta` is a sample config package that shows most of what configuration can do. It brands the UI for a made-up insurer, Acme, and also sets a theme, languages, session timeouts, sign-in options, demo presets and some navigation changes. It has preset switching turned on, so put it on a demo server only, never on a customer's server.

1. **Check the server.** You need Nuxeo LTS with Nuxeo Satori (`nuxeo-agentic-ui`) 2026.0.2 or later. On an older Satori, Nuxeo won't start with this package installed. If that happens, remove the package to recover.
2. **Download the package.** Open the [satori-beta listing](https://nos-preprod-connect.nuxeocloud.com/nuxeo/site/marketplace/package/satori-beta?version=1.1.0-20261112020624-BUILD-1) on the pre-prod Marketplace and download version `1.1.0-20261112020624-BUILD-1`. The listing is public, but you need a Nuxeo Online Services account to download it.
3. **Install it.** On the Nuxeo server (inside the container, if you run Nuxeo in Docker), run:

   ```bash
   nuxeoctl mp-install satori-beta-1.1.0-20261112020624-BUILD-1.zip
   ```

   A Nuxeo Cloud environment installs it from the Marketplace like any other package.

4. **Restart Nuxeo.** The server only reads config packages when it starts.
5. **Hard refresh the browser.** The UI reads its config once, when it loads.
6. **Check that it worked.** You should see the Acme branding: "Acme Claims" in the browser tab, the Acme logo in the header and on the sign-in page, and the Acme theme. If you don't, open `/nuxeo/agentic-ui-config/bootstrap.json` on the server. The satori-beta fragment should be listed after `org.nuxeo.agentic.ui.config.defaults`.
7. **To remove it**, run `nuxeoctl mp-remove satori-beta` and restart Nuxeo. You're back on the defaults.

## Prototype: work in progress for GA

Below is an interactive prototype of some changes we are planning for the GA release:

[Nuxeo Workspace Prototype](https://claude.ai/artifact/G6JrRe2PgHvA3ETLTVJzVS?sk=dMCRJmfEjv6KXFEuSot_ZA)

The navigation and search will be almost the same as in the prototype. We are still discussing the other parts and features. It is still a prototype, and we welcome your feedback on any part of it, including the design, the layout and the features.

## Links

- [README](https://github.com/nuxeo/Nuxeo-Satori-UI/blob/main/README.md): what Satori UI is and where to start
- [CUSTOMISING.md](https://github.com/nuxeo/Nuxeo-Satori-UI/blob/main/CUSTOMISING.md): the whole no-code customisation path on one page
- [Customising the Nuxeo Satori UI without rebuilding](https://hyland.atlassian.net/wiki/x/LDJhAgE) on Confluence (being updated)
