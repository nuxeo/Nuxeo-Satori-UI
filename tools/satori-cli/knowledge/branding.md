# Branding, and what the app shows

## The title and the colours: `bootstrap.json`

Write `bundle/agentic-ui-config/bootstrap.json` whole, with `write_package_file`:

```json
{
  "$schema": "../../schema/bootstrap.schema.json",
  "branding": { "applicationTitle": "Acme Claims", "documentTitle": "Acme Claims" },
  "themes": [
    {
      "id": "acme",
      "label": "Acme",
      "base": "nuxeo",
      "tokens": {
        "--mat-sys-primary": "#0B5FFF",
        "--mat-sys-on-primary": "#FFFFFF",
        "--mat-sys-primary-container": "#DCE6FF",
        "--mat-sys-on-primary-container": "#001A5C",
        "--mat-sys-tertiary": "#FF6B00"
      }
    }
  ],
  "defaultThemeId": "acme"
}
```

- **A theme of the customer's own**: an `id`, a `base` the colours start from (`nuxeo`, `dark`,
  `kawaii` or `light`), and `tokens`, CSS custom properties. `defaultThemeId` chooses it; a theme
  it does not name is refused.
- **Colours in pairs.** Set a colour with the one read on it: `--mat-sys-primary` with
  `--mat-sys-on-primary`. The shades you do not set stay the base's. Primary also paints the side
  navigation, unless `--sat-platform-nav-background` is set. [theme-tokens.md](theme-tokens.md)
  lists every colour token and what it changes.
- **A colour is a CSS colour**: `#rrggbb`, `rgb()`, `hsl()`, or `var(--another-token)`. A name a
  browser would not read is refused.
- **The logo** is `branding.logo`, `{ "src": "assets/logo.svg", "alt": "Acme" }`. The image is a
  file a person adds to `bundle/agentic-ui-config/assets/`, with the line
  `<asset name="logo.svg" src="agentic-ui-config/assets/logo.svg" />` in the component's
  configuration extension. No tool writes an asset: say where it goes.

## What the app shows: `manifest.json`

Write `bundle/agentic-ui-config/manifest.json` whole, with `write_package_file`. Its
`extensions.overrides` take a registered id ([registered.md](registered.md)) and hide it, rename
it or reorder it:

```json
{
  "$schema": "../../schema/manifest.schema.json",
  "version": 1,
  "extensions": {
    "overrides": {
      "app.navbar.trash": { "visible": false },
      "app.navbar.collections": { "label": "Repository" }
    }
  }
}
```

Hiding is not security: Nuxeo's permissions still decide who reads and changes what.
