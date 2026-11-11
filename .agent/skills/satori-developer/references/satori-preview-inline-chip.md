<!-- Generated from packages/satori-preview/inline-chip/docs/inline-chip-overview.mdx. Do not edit here; edit the source MDX. -->

# Inline Chip

## Key Features

- **Inline with text**: Designed to appear inside a paragraph alongside body text. Supports `medium` and `large` sizes to match `mat-body-medium` and `mat-body-large` typography.
- **Button or link**: Applied as an attribute on a native `<button>` or `<a>` element, preserving correct semantics without extra ARIA.
- **Flexible content slots**: Optionally project a leading media element (icon or image) and a trailing icon.
- **Tooltip trigger variant**: Set `[triggersTooltip]="true"` to add an underline style indicating the chip opens a tooltip.

## Demo Showcase

```html
`
      <p class="${args['size'] === 'medium' ? 'mat-body-medium' : 'mat-body-large'}">
        Paragraph with long text that can wrap
        <${args['type'] === 'link' ? 'a href="#" target="_blank" rel="noopener noreferrer"' : 'button type="button"'}
          satInlineChip
          ${args['type'] === 'menu trigger button' ? '[matMenuTriggerFor]="menu"' : ''}
          ${args['type'].includes('tooltip trigger') ? '[triggersTooltip]="true" [satRichTooltipTriggerFor]="tooltip"' : ''}
          size="${args['size']}"
        >
          ${args['leadingMedia'] === 'icon' ? '<mat-icon satInlineChipLeadingMedia svgIcon="document" aria-hidden="true"></mat-icon>' : ''}
          ${args['leadingMedia'] === 'image' ? '<img satInlineChipLeadingMedia src="assets/person-200x200.jpg" aria-hidden="true" alt="">' : ''}
          {{ selectedItem() ? selectedItem() : '${args['label']}' }}
          ${args['trailingIcon'] ? `<mat-icon satInlineChipTrailingIcon svgIcon="${args['type'] === 'link' ? 'launch' : 'ai'}" aria-hidden="true"></mat-icon>` : ''}
          ${args['type'] === 'menu trigger button' ? '<mat-icon satInlineChipTrailingIcon svgIcon="arrow_submenu_down" aria-hidden="true"></mat-icon>' : ''}
        </${args['type'] === 'link' ? 'a' : 'button'}>
        to multiple lines when space is limited.
      </p>
      ${args['type'] === 'menu trigger button'
          ? `
            <mat-menu #menu="matMenu">
              @for (item of ['Short item 1', 'Longest menu item 2', 'Intermediate item 3']; track item) {
                @let isActive = selectedItem() === item;
                @let currentLabel = item + ' (current)';
                <button
                  mat-menu-item
                  role="menuitemradio"
                  (click)="selectedItem.set(item)"
                  [class.sat-selectable-menu-item-active]="isActive"
                  [attr.aria-checked]="isActive"
                  [attr.aria-label]="isActive ? currentLabel : item"
                >
                  @if (isActive) {
                    <div class="sat-selectable-menu-item-active-content">
                      {{ item }}
                      <mat-icon svgIcon="check" aria-hidden="true"></mat-icon>
                    </div>
                  } @else {
                    {{ item }}
                  }
                </button>
              }
            </mat-menu>
        `
          : ''}
      ${args['type'].includes('tooltip trigger')
          ? `
            <sat-rich-tooltip #tooltip ${args['type'].includes('persistent') ? 'behavior="persistent"' : ''}>
              <sat-rich-tooltip-title>Tooltip Title</sat-rich-tooltip-title>
              <sat-rich-tooltip-content>Tooltip content.</sat-rich-tooltip-content>
            </sat-rich-tooltip>
        `
          : ''}
    `
```

```scss
button.sat-selectable-menu-item-active {
  background-color: var(--mat-sys-secondary-container);
  color: var(--mat-sys-on-secondary-container);

  .sat-selectable-menu-item-active-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--mat-menu-item-with-icon-trailing-spacing, 12px);
    margin-right: calc(-1 * var(--mat-menu-item-with-icon-trailing-spacing, 12px));
  }
}
```

## Usage Patterns

### Button

Use a `<button>` host when the chip triggers an action (e.g. opens a menu or dialog).

```html
<p class="mat-body-medium">
  Download
  <button type="button" satInlineChip>
    <mat-icon satInlineChipLeadingMedia svgIcon="document" aria-hidden="true"></mat-icon>
    Report.pdf
  </button>
  to review the details.
</p>
```

### Link

Use an `<a>` host when the chip navigates to another location.

```html
<p class="mat-body-large">
  See the
  <a href="/details" target="_blank" rel="noopener noreferrer" satInlineChip size="large">
    Report
    <mat-icon satInlineChipTrailingIcon svgIcon="launch" aria-hidden="true"></mat-icon>
  </a>
  for more information.
</p>
```

### Menu Trigger

Combine with `[matMenuTriggerFor]` to open a menu.

```html
<p class="mat-body-medium">
  Viewing
  <button type="button" satInlineChip [matMenuTriggerFor]="menu">
    Report.pdf
    <mat-icon satInlineChipTrailingIcon svgIcon="arrow_submenu_down" aria-hidden="true"></mat-icon>
  </button>
  in the current tab.
</p>

<mat-menu #menu="matMenu">
  <button mat-menu-item>Option 1</button>
  <button mat-menu-item>Option 2</button>
</mat-menu>
```

### Tooltip Trigger

Set `[triggersTooltip]="true"` together with `[satRichTooltipTriggerFor]` to add a visual underline indicating that the chip reveals additional information.

```html
<p class="mat-body-medium">
  Learn more about
  <button type="button" satInlineChip [triggersTooltip]="true" [satRichTooltipTriggerFor]="tooltip">
    Inline Chips
  </button>
  and how to use them.
</p>
<sat-rich-tooltip #tooltip>
  <sat-rich-tooltip-title>Inline Chip</sat-rich-tooltip-title>
  <sat-rich-tooltip-content>A chip that lives inline with body text.</sat-rich-tooltip-content>
</sat-rich-tooltip>
```

## Sizing

Match the chip size to the surrounding text typography:

| `size` value | Intended context       |
| ------------ | ---------------------- |
| `medium`     | `mat-body-medium` text |
| `large`      | `mat-body-large` text  |

Always wrap the chip in a paragraph that carries the correct typography class so the chip aligns with the baseline.

## API

```ts
import { SatInlineChipModule } from '@hylandsoftware/satori-preview/inline-chip';
```

### `satInlineChip`

**Inputs**

- `size: "medium" | "large" = 'medium'` — 'medium' size is meant to be used inline with 'mat-body-medium' type
- `triggersTooltip: boolean = false` — Whether the inline chip triggers a tooltip
