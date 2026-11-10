<!-- Generated from packages/satori-preview/split-button/docs/split-button-overview.mdx. Do not edit here; edit the source MDX. -->

# Split Button

A split button displays a primary action button with a dropdown menu for additional related actions.

## Key features

- The leading button triggers the primary action; the trailing button is typically wired to open a `mat-menu` of secondary actions (e.g. via `[matMenuTriggerFor]`), but can be configured to trigger other UI patterns
- Works with Material button variants that use filled/protected/outlined containers: `mat-flat-button`, `mat-raised-button`, and `mat-stroked-button`
- Dropdown button aria-label is automatically translated with an optional override via `[ariaLabel]`
- Validates at runtime that exactly one main button and one dropdown button are present, logging warnings for misconfiguration

## Demo showcase

```html
<sat-split-button>
  <button mat-flat-button sat-split-button-main>
    <mat-icon [svgIcon]="'save'"></mat-icon>
    Save Document
  </button>

  <button
    mat-flat-button
    sat-split-button-dropdown
    [matMenuTriggerFor]="menu"
    [ariaLabel]="'More save options'"
  >
    <mat-icon [svgIcon]="'chevron_down'"></mat-icon>
  </button>
</sat-split-button>

<mat-menu #menu="matMenu">
  <button mat-menu-item>
    <mat-icon [svgIcon]="'save'"></mat-icon>
    <span>Save</span>
  </button>
  <button mat-menu-item>
    <mat-icon [svgIcon]="'save_as'"></mat-icon>
    <span>Save As...</span>
  </button>
  <button mat-menu-item>
    <mat-icon [svgIcon]="'copy'"></mat-icon>
    <span>Save as a copy</span>
  </button>
</mat-menu>
```

## Components

### `sat-split-button`

The container component that groups the main action button and the dropdown trigger.

Both child buttons should use the same Material button style for visual consistency (e.g. both `mat-flat-button`).

### `[sat-split-button-main]` / `[satSplitButtonMain]`

Directive applied to the primary action button. Use this for the button that performs the default action.

The main button can include a leading icon and a text label.

### `[sat-split-button-dropdown]` / `[satSplitButtonDropdown]`

Directive applied to the dropdown trigger button. Use this for the button that opens the `mat-menu` with additional actions.

The dropdown button should contain only a `chevron_down` icon with no text label — the `aria-label` is the only accessible name.

## Accessibility

- The accessible name of the main button should match its visible text label. Include additional context in the label only when it improves clarity for screen reader users.
- The dropdown button uses only a `chevron_down` icon with no visible text. Provide a clear label that communicates both that it opens additional options and that those options relate to the primary action (e.g. `"More save options"`).
- The default accessible label for the dropdown button is `"More options"`. Override it per-instance using the `[ariaLabel]` input when more specific context is needed.

## API

```ts
import { SatSplitButtonModule } from '@hylandsoftware/satori-preview/split-button';
```

### `<sat-split-button>`

**Content slots** (project via directive)

- `satSplitButtonDropdown` — Directive for the dropdown trigger button in a split button
  - `ariaLabel: string | null = null` — Overrides the default aria-label
- `satSplitButtonMain` — Directive for the main action button in a split button
