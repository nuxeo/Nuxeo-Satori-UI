<!-- Generated from packages/satori-preview/empty-state/docs/empty-state-overview.mdx. Do not edit here; edit the source MDX. -->

# Empty State

An empty state communicates a message when there is no content to display. Use it with an illustration and text to communicate a message or indicate that content is unavailable. The component provides slots for an illustration, headline, description, and a singular action. Illustrations are decorative and hidden from screen readers via `aria-hidden="true"`.

## Key Features

- **Illustration slot**: Project any decorative illustration, automatically wrapped in `aria-hidden="true"`.
- **Headline slot**: Displays a prominent headline in `headline-medium` typography.
- **Description slot**: Displays a supporting description in `body-large` typography.
- **Action slot**: Provides a single call-to-action button.
- **Pre-configured error states**: Ready-to-use components for 401, 403, 404, and 500 HTTP error codes with built-in illustrations and i18n descriptions.
- **Responsive width**: Max-width of 700px when the empty-state container is at least 600px wide, 320px otherwise. Uses a CSS container query, so the breakpoint is based on the component's own container width, not the viewport.
- **Accessible**: Uses `role="status"` on the container and hides decorative illustrations from screen readers.

## Demo Showcase

### 404 Not Found

```html
<sat-404-error-state>
  <button mat-button satErrorStateAction>
    <mat-icon svgIcon="search" />What were you looking for?
  </button>
</sat-404-error-state>
```

### 401 Unauthorized

```html
<sat-401-error-state>
  <button mat-flat-button satErrorStateAction>Back to login</button>
</sat-401-error-state>
```

### 403 Forbidden

```html
<sat-403-error-state>
  <button mat-flat-button satErrorStateAction>Request access</button>
</sat-403-error-state>
```

### 500 Something Went Wrong

```html
<sat-500-error-state>
  <button mat-flat-button satErrorStateAction>Reload</button>
</sat-500-error-state>
```

### Empty state

```html
<sat-empty-state>
  <sat-illustration satEmptyStateIllustration [illustration]="illustration"></sat-illustration>
  <h3 satEmptyStateHeadline>{{ headline }}</h3>
  <span satEmptyStateDescription>{{ description }}</span>
  <button mat-flat-button satEmptyStateAction>{{ action }}</button>
</sat-empty-state>
```

## Components

### `sat-empty-state`

The base component for displaying empty states. Use this when none of the pre-configured error state components fit your use case.

**Content Projection Slots**

| Selector                                                      | Purpose                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| `[satEmptyStateIllustration], [sat-empty-state-illustration]` | Decorative illustration (wrapped in `aria-hidden="true"`) |
| `[satEmptyStateHeadline], [sat-empty-state-headline]`         | Headline text (`headline-medium` typography)              |
| `[satEmptyStateDescription], [sat-empty-state-description]`   | Description text (`body-large` typography)                |
| `[satEmptyStateAction], [sat-empty-state-action]`             | Single action button                                      |

```html
<sat-empty-state>
  <sat-illustration
    satEmptyStateIllustration
    illustration="documents-no-search-results"
  ></sat-illustration>
  <h3 satEmptyStateHeadline>No items yet</h3>
  <span satEmptyStateDescription>Once items are added they will appear here.</span>
  <button mat-flat-button satEmptyStateAction>Add item</button>
</sat-empty-state>
```

### Pre-configured error state components

Four components ship with a built-in illustration, headline, and a translated description.

| Component             | HTTP status | Default illustration          |
| --------------------- | ----------- | ----------------------------- |
| `sat-401-error-state` | 401         | `window-error`                |
| `sat-403-error-state` | 403         | `window-x`                    |
| `sat-404-error-state` | 404         | `documents-no-search-results` |
| `sat-500-error-state` | 500         | `plugs`                       |

Each component accepts an optional action slot using `[satErrorStateAction]`:

```html
<sat-404-error-state>
  <button mat-button satErrorStateAction>Go home</button>
</sat-404-error-state>
```

#### Overriding defaults

All three default slots — illustration, headline, and description — can be replaced via content projection. When a custom value is projected, the built-in default is suppressed.

**Override slots**

| Selector                                                      | Replaces              |
| ------------------------------------------------------------- | --------------------- |
| `[satErrorStateIllustration], [sat-error-state-illustration]` | Built-in illustration |
| `[satErrorStateHeadline], [sat-error-state-headline]`         | Built-in headline     |
| `[satErrorStateDescription], [sat-error-state-description]`   | Built-in description  |
| `[satErrorStateAction], [sat-error-state-action]`             | Action slot           |

```html
<sat-404-error-state>
  <sat-illustration satErrorStateIllustration illustration="plugs"></sat-illustration>
  <h3 satErrorStateHeadline>No results found</h3>
  <span satErrorStateDescription>Try broadening your search or removing some filters.</span>
  <button mat-flat-button satErrorStateAction>Clear filters</button>
</sat-404-error-state>
```

## Accessibility

- The container uses `role="status"` so screen readers announce when the empty state appears.
- Projected illustration content is hidden from assistive technology by default — the component wraps the illustration slot in `aria-hidden="true"`. You do not need to add `aria-hidden` to the projected element.
- Use descriptive text for the headline and description (e.g., "No tasks to show" instead of just "Empty").

## API

```ts
import { SatEmptyStateModule } from '@hylandsoftware/satori-preview/empty-state';
```

### `<sat-401-error-state>`

### `<sat-403-error-state>`

### `<sat-404-error-state>`

### `<sat-500-error-state>`

### `<sat-empty-state>`

**Content slots** (project via directive)

- `sat-error-state-description` — Marker directive that allows overriding the default description in pre-configured error state components (`sat-401-error-state`, etc.)
- `sat-error-state-headline` — Marker directive that allows overriding the default headline in pre-configured error state components (`sat-401-error-state`, etc.)
- `sat-error-state-illustration` — Marker directive that allows overriding the default illustration in pre-configured error state components (`sat-401-error-state`, etc.)
