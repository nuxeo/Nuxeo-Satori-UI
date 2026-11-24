<!-- Generated from packages/satori-preview/interactive-card/docs/interactive-card-overview.mdx. Do not edit here; edit the source MDX. -->

# Interactive Card

The Interactive Card component provides a structured card layout with header, content, and actions sections. The header supports a title, subtitle, and header actions.

## Key Features

- **Three interaction patterns**: Single action (button/anchor), nested actions, and selection control.
- **Automatic accessibility**: The component sets `aria-labelledby` on the card host when used as a native interactive element (`<button>` or `<a>`).
- **Visual states**: Supports `active` and `border` styling inputs along with background `surface` variants.

## Demo Showcase

```html
<button sat-interactive-card style="width: 100%;">
  <h3 satInteractiveCardTitle>Button Card</h3>
  <h4 satInteractiveCardSubtitle>This Card Is A Button</h4>

  <sat-interactive-card-content>
    This is the card content area. It can contain any arbitrary content such as text, images, or
    other components.
  </sat-interactive-card-content>
</button>
```

## Choosing the Right Pattern

The host element you choose determines how the card behaves for keyboard and screen-reader users. Pick the pattern that matches the number of interactive targets inside the card.

### Single Action

Use a **`<button>`** or **`<a>`** as the host element when the entire card represents one action.

- `<button sat-interactive-card>` — for actions (e.g. opening a dialog, triggering a command).
- `<a sat-interactive-card>` — for navigation (with `href` or `routerLink`).

The component **automatically** sets `aria-labelledby` pointing to the `satInteractiveCardTitle` element, so no manual ARIA attributes are needed.

```html
<button sat-interactive-card>
  <h3 satInteractiveCardTitle>Button Card</h3>
  <h4 satInteractiveCardSubtitle>This Card Is A Button</h4>

  <sat-interactive-card-content> Card content goes here. </sat-interactive-card-content>
</button>
```

```html
<button sat-interactive-card style="width: 100%;">
  <h3 satInteractiveCardTitle>Button Card</h3>
  <h4 satInteractiveCardSubtitle>This Card Is A Button</h4>

  <sat-interactive-card-content>
    This is the card content area. It can contain any arbitrary content such as text, images, or
    other components.
  </sat-interactive-card-content>
</button>
```

### Nested Action

Use the **`<sat-interactive-card>`** element when the card contains **multiple interactive elements** on top of the link title (the primary action), like Buttons or an Icon Button.

Because the card container is not itself interactive, the component does **not** set `aria-labelledby` on the host. Each nested interactive element carries its own accessible name instead.

- Apply `satInteractiveCardTitle` to an anchor `<a>` to make the title the primary action. Clicking anywhere on the card (outside another interactive element) forwards to this action.
- Add header actions with `satInteractiveCardHeaderAction` — provide an explicit **`aria-label`**.
- Footer actions in `<sat-interactive-card-actions>` receive their accessible names from their own text content.

```html
<sat-interactive-card>
  <a satInteractiveCardTitle href="/details"><h3>Link Title</h3></a>
  <h4 satInteractiveCardSubtitle>This Card's Title Is A Link</h4>
  <button mat-icon-button aria-label="More actions" satInteractiveCardHeaderAction>
    <mat-icon svgIcon="more_vert"></mat-icon>
  </button>

  <sat-interactive-card-content> Card content goes here. </sat-interactive-card-content>

  <sat-interactive-card-actions>
    <button mat-button>Cancel</button>
    <button mat-flat-button>Confirm</button>
  </sat-interactive-card-actions>
</sat-interactive-card>
```

```html
<sat-interactive-card>
  <a satInteractiveCardTitle href="#"><h3>Link Title</h3></a>
  <h4 satInteractiveCardSubtitle>This Card's Title Is A Link</h4>
  <button mat-icon-button aria-label="More actions" satInteractiveCardHeaderAction>
    <mat-icon svgIcon="more_vert"></mat-icon>
  </button>

  <sat-interactive-card-content>
    This is the card content area. It can contain any arbitrary content such as text, images, or
    other components.
  </sat-interactive-card-content>

  <sat-interactive-card-actions>
    <button mat-button>Button 1</button>
    <button mat-button>Button 2</button>
  </sat-interactive-card-actions>
</sat-interactive-card>
```

### Selection Control

Use the **`<sat-interactive-card>`** element when the card toggles a selection control such as a checkbox, radio button, or slide toggle.

- Place the control (e.g. `<mat-slide-toggle>`) with the `satInteractiveCardSelectionControl` directive. Clicking anywhere on the card forwards to this control.
- You **must** manually bind `[aria-labelledby]` on the control, pointing it to the title element's `id`. Use a template reference variable on the `satInteractiveCardTitle` element to access its auto-generated `id`.

```html
<sat-interactive-card>
  <mat-slide-toggle satInteractiveCardSelectionControl [aria-labelledby]="title.id">
  </mat-slide-toggle>

  <h3 satInteractiveCardTitle #title>Card Title</h3>
  <h4 satInteractiveCardSubtitle>Card Subtitle</h4>

  <sat-interactive-card-content> Card content goes here. </sat-interactive-card-content>
</sat-interactive-card>
```

```typescript
// Code from InteractiveCardStories.selectionControl
// [Story code could not be extracted]
```

## Accessibility

| Pattern           | Host element             | `aria-labelledby` on host                           | Manual ARIA needed                            |
| ----------------- | ------------------------ | --------------------------------------------------- | --------------------------------------------- |
| Single action     | `<button>` or `<a>`      | **Automatic** (points to `satInteractiveCardTitle`) | None                                          |
| Nested action     | `<sat-interactive-card>` | Not set (container is non-interactive)              | `aria-label` on icon-only buttons             |
| Selection control | `<sat-interactive-card>` | Not set (container is non-interactive)              | `[aria-labelledby]="title.id"` on the control |

## Components

### `sat-interactive-card`

The main card container. Can also be applied as an attribute on `<a>` or `<button>` elements.

**Inputs**

- **`surface: 'container-low' | 'container-lowest'`** — Background surface variant. Defaults to `'container-low'`.
- **`active: boolean`** — Whether the card appears active. Defaults to `false`.
- **`border: boolean`** — Whether to display a border. Defaults to `true`.

### `satInteractiveCardTitle`

Directive applied to the card's title element. Automatically receives a unique `id` used by `aria-labelledby`.

### `satInteractiveCardSubtitle`

Directive applied to the card's subtitle element.

### `sat-interactive-card-content`

Container for the card's body content.

### `sat-interactive-card-actions`

Container for the card's footer action buttons (used in the nested action pattern).

### `satInteractiveCardHeaderAction`

Directive applied to a header action Icon Button (e.g. a More Actions menu button).

### `satInteractiveCardSelectionControl`

Directive applied to a selection control (i.e. `<mat-slide-toggle>`, `<mat-checkbox>`, `<mat-radio-button>`). Clicking the card surface forwards to the interactive element in this control.

## API

```ts
import { SatInteractiveCardModule } from '@hylandsoftware/satori-preview/interactive-card';
```

### `sat-interactive-card`

**Inputs**

- `active: boolean = false` — Whether the interactive card is active
- `border: boolean = true` — Whether the interactive card has a border, defaults to true
- `surface: "container-low" | "container-lowest" = 'container-low'` — The surface variant (background) of the interactive card

### `<sat-interactive-card-actions>`

### `<sat-interactive-card-content>`

**Content slots** (project via directive)

- `satInteractiveCardHeaderAction`
- `satInteractiveCardSelectionControl`
- `satInteractiveCardSubtitle`
- `satInteractiveCardTitle`
