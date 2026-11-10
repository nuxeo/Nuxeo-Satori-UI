<!-- Generated from packages/satori-ui/logo/docs/logo-overview.mdx. Do not edit here; edit the source MDX. -->

# Logo

The Logo components provide the official Hyland branding elements with proper spacing, sizing, and theme adaptation to maintain consistent brand identity.

## Demo Showcase

```html
<sat-h-mark-logo [style.width]="'56px'"></sat-h-mark-logo>
```

## Guidelines

### Sizing Recommendations

- **H-Mark Logo** - Minimum recommended size is 56px in width for proper visibility
- **Word-Mark Logo** - Minimum recommended size is 106px in width for legibility
- **Horizontal Combined Logo** - In the horizontal configuration, both the H Mark and Word Mark logos will occupy a defined portion of the total container width, while their height will scale to 100% of the parent container (`sat-logo`) according to the aspect ratio.
- **Vertical Combined Logo** - In the vertical configuration, both the H Mark and Word Mark logos will occupy a defined portion of the container’s height, while their width will scale to 100% of the parent container (`sat-logo`), maintaining the appropriate aspect ratio.

### Layout Guidance

- Maintain the logo’s aspect ratios when providing size to the components. The component maintains the correct aspect ratio automatically so whenever you provide a size, ensure it is consistent with the aspect ratio by only specifying one dimension (width OR height).
- Always maintain adequate clear space around logos to ensure visibility and impact
- When using the combined logo, try not to create your own arrangement - use the provided `sat-logo` component and provide the `direction` prop to control the layout.
- Do not alter the proportions, colors, or arrangement of the logo components.

## Accessibility

Both `sat-h-mark-logo` and `sat-word-mark-logo` are accessible out of the box. The SVG element inside each component is annotated with `role="img"` and a default `aria-label` of `"Hyland logo"`.

### Default behavior

No additional configuration is required for basic compliance. Screen readers will announce the logo as _"Hyland logo"_.

### Overriding the label

Use the `ariaLabel` input to provide a context-specific label when the default text is insufficient:

```html
<sat-h-mark-logo ariaLabel="Hyland — navigate to home"></sat-h-mark-logo>
<sat-word-mark-logo ariaLabel="Hyland corporate logo"></sat-word-mark-logo>
```

## Examples

### Hyland H Mark Logo

The H-mark is the distinctive, colorful Glyph shaped icon that serves as the visual symbol of the Satori brand.

```html
<sat-h-mark-logo [style.width]="'56px'"></sat-h-mark-logo>
```

### Hyland Word Mark Logo

The word-mark displays the **HYLAND** text with precise typography. It has two different colors based on the current theme - displaying in dark blue for light themes and white for dark themes.

```html
<sat-word-mark-logo [style.width]="'106px'"></sat-word-mark-logo>
```

### Combined Logo

The combined logo component creates a properly spaced arrangement of both the `H Mark Logo` and `Word Mark Logo` components. It supports both horizontal (default) and vertical orientations to accommodate different layout requirements.

```html
<sat-logo [style.width]="'600px'">
  <sat-h-mark-logo></sat-h-mark-logo>
  <sat-word-mark-logo></sat-word-mark-logo>
</sat-logo>
```

#### Horizontal Combined Logo Implementation (Default)

```html
<sat-logo [style.width]="'600px'">
  <sat-h-mark-logo></sat-h-mark-logo>
  <sat-word-mark-logo></sat-word-mark-logo>
</sat-logo>
```

#### Vertical Combined Logo Implementation

```html
<sat-logo [direction]="'vertical'" style="width: 600px;">
  <sat-h-mark-logo></sat-h-mark-logo>
  <sat-word-mark-logo></sat-word-mark-logo>
</sat-logo>
```

## Product Logos

In addition to the Hyland brand logo, the following Hyland product logos are available.

Each product logo is theme-aware: it renders as a single SVG whose surface and detail colors adapt automatically to the active light or dark theme (following the page's `color-scheme`), so no configuration is required to switch between themes.

Like the brand logos, each product logo exposes an `ariaLabel` input and renders `role="img"` with a default label if none is provided.

### OnBase

```html
<sat-onbase-logo [style.width]="'80px'"></sat-onbase-logo>
```

### Alfresco

```html
<sat-alfresco-logo [style.width]="'80px'"></sat-alfresco-logo>
```

### Nuxeo

```html
<sat-nuxeo-logo [style.width]="'80px'"></sat-nuxeo-logo>
```

### Perceptive

```html
<sat-perceptive-logo [style.width]="'80px'"></sat-perceptive-logo>
```

## API

```ts
import { SatLogoModule } from '@hylandsoftware/satori-ui/logo';
```

### `<sat-alfresco-logo>`

**Inputs**

- `ariaLabel: string | null = null` — Overrides the default aria-label

### `<sat-h-mark-logo>`

**Inputs**

- `ariaLabel: string | null = null` — Overrides the default aria-label

### `<sat-logo>`

**Inputs**

- `direction: SatLogoDirection = 'horizontal'` — The direction of the logo

### `<sat-nuxeo-logo>`

**Inputs**

- `ariaLabel: string | null = null` — Overrides the default aria-label

### `<sat-onbase-logo>`

**Inputs**

- `ariaLabel: string | null = null` — Overrides the default aria-label

### `<sat-perceptive-logo>`

**Inputs**

- `ariaLabel: string | null = null` — Overrides the default aria-label

### `<sat-word-mark-logo>`

**Inputs**

- `ariaLabel: string | null = null` — Overrides the default aria-label

### Types & interfaces

```ts
type SatLogoDirection = 'horizontal' | 'vertical';
```
