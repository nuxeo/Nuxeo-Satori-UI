<!-- Generated from packages/satori-preview/card-surface/docs/card-surface-overview.mdx. Do not edit here; edit the source MDX. -->

# Card Surface

The `satCardSurfaceContainerLowest` directive applies the `surface-container-lowest` background token to an Angular Material card. Use it to visually distinguish cards that sit on a `surface-container-low` background, creating a subtle depth hierarchy.

## Key features

- Applies the `surface-container-lowest` background to Material cards
- Works with all card appearances
- Provides visual hierarchy when cards sit on a `surface-container-low` background

## Demo showcase

```html
<mat-card appearance="raised" satCardSurfaceContainerLowest style="max-width: 400px;">
  <mat-card-header>
    <mat-card-title>Surface Container Lowest</mat-card-title>
    <mat-card-subtitle>Card with lowest surface background</mat-card-subtitle>
  </mat-card-header>
  <mat-card-content>
    <p>
      This card uses the <code>surface-container-lowest</code> background token, making it appear
      lighter than the default <code>surface-container-low</code> background.
    </p>
  </mat-card-content>
  <mat-card-actions align="end">
    <button mat-button>Cancel</button>
    <button mat-button>Save</button>
  </mat-card-actions>
</mat-card>
```

## Examples

### Surface Container Lowest

Apply `satCardSurfaceContainerLowest` to any `mat-card` to use the lowest surface token.

```html
<mat-card appearance="raised" satCardSurfaceContainerLowest style="max-width: 400px;">
  <mat-card-header>
    <mat-card-title>Surface Container Lowest</mat-card-title>
    <mat-card-subtitle>Card with lowest surface background</mat-card-subtitle>
  </mat-card-header>
  <mat-card-content>
    <p>
      This card uses the <code>surface-container-lowest</code> background token, making it appear
      lighter than the default <code>surface-container-low</code> background.
    </p>
  </mat-card-content>
  <mat-card-actions align="end">
    <button mat-button>Cancel</button>
    <button mat-button>Save</button>
  </mat-card-actions>
</mat-card>
```

### Comparison

Side-by-side comparison of a default card and one with `satCardSurfaceContainerLowest`.

```html
<div style="display: flex; gap: 16px; flex-wrap: wrap;">
  <mat-card appearance="raised" style="max-width: 300px;">
    <mat-card-header>
      <mat-card-title>Default</mat-card-title>
      <mat-card-subtitle>surface-container-low</mat-card-subtitle>
    </mat-card-header>
    <mat-card-content>
      <p>Standard card background using the default surface token.</p>
    </mat-card-content>
  </mat-card>

  <mat-card appearance="raised" satCardSurfaceContainerLowest style="max-width: 300px;">
    <mat-card-header>
      <mat-card-title>Lowest</mat-card-title>
      <mat-card-subtitle>surface-container-lowest</mat-card-subtitle>
    </mat-card-header>
    <mat-card-content>
      <p>Card with the <code>satCardSurfaceContainerLowest</code> directive applied.</p>
    </mat-card-content>
  </mat-card>
</div>
```

## API

```ts
import { SatCardSurfaceModule } from '@hylandsoftware/satori-preview/card-surface';
```

**Content slots** (project via directive)

- `sat-card-surface-container-lowest` — Directive that applies the surface-container-lowest background to an Angular Material card
