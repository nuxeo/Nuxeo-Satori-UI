<!-- Generated from packages/satori-preview/illustration/docs/illustration-overview.mdx. Do not edit here; edit the source MDX. -->

# Illustration

The Illustration component is designed to display a SVG illustration.

## Key Features

- Display SVG illustrations with consistent styling
- Three sizes available: small (80px), medium (120px), and large (200px)
- Theme support by CSS custom properties
- Seamless integration with `@hylandsoftware/satori-illustrations`

## Demo

```html
<sat-illustration
  [illustration]="'add-process'"
  aria-label="Illustration example using: 'add-process'"
></sat-illustration>
```

## Guidelines

### Accessibility

Provide an `aria-label` attribute to supply alternative text for the illustration, ensuring it is accessible to screen readers.
Alternatively, if an illustration is purely decorative and does not convey meaningful information, use `aria-hidden="true"` to hide it from assistive technologies.

### Use with Satori Illustrations

#### 1. Install the illustrations package

```bash
npm install @hylandsoftware/satori-illustrations
```

#### 2. Configure assets in your `project.json`

```json
{
  "targets": {
    "build": {
      "options": {
        "assets": [
          {
            "glob": "**/*.svg",
            "input": "node_modules/@hylandsoftware/satori-illustrations/dist",
            "output": "satori-svg"
          }
        ]
      }
    }
  }
}
```

#### 3. Register the SVG resolver

In your application configuration:

```typescript
import { provideSatoriIllustrations } from '@hylandsoftware/satori-preview/illustration';

export const appConfig: ApplicationConfig = {
  providers: [
    provideSatoriIllustrations({
      svgPath: 'satori-svg', // path where SVGs are served, defaults to 'satori-svg'
      namespace: 'sat-illustrations', // namespace for the illustrations, defaults to 'sat-illustrations'
    }),
  ],
};
```

### Custom SVG

You can also use a custom SVG by adding it to MatIconRegistry with the same namespace.

The SVG must use satori tokens color for illustrations to be properly affected by themes.

- `--sat-illustration-medium`
- `--sat-illustration-light`
- `--sat-illustration-lighter`
- `--sat-illustration-lightest`
- `--sat-illustration-white`
- `--sat-illustration-accent`
- `--sat-illustration-gradient-dark`
- `--sat-illustration-gradient-light`

## API

```ts
import { SatIllustrationModule } from '@hylandsoftware/satori-preview/illustration';
```

### `<sat-illustration>`

**Inputs**

- `illustration: string | null = null` — The name of the illustration to display
- `size: "large" | "medium" | "small" = 'large'` — The size of the illustration
