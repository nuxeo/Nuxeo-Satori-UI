<!-- Generated from packages/satori-preview/ghost/docs/ghost-overview.mdx. Do not edit here; edit the source MDX. -->

# Ghost

The Ghost (skeleton loader) component provides a visual placeholder that gives users a hint about what information is waiting to be loaded. Ghosts are intentionally not operable or navigable and have no interaction states.

## Key features

- Two shape variants: `box` for rectangular placeholders and `round` for circular ones
- Customizable width, height, and corner radius
- `fitContainer` mode to stretch inside tables and lists
- Pulse animation that respects `prefers-reduced-motion`

## Demo showcase

```html
<sat-ghost [variant]="'box'"></sat-ghost>
```

## Guidelines

- Use `box` variant for text lines, buttons, and rectangular content areas.
- Use `round` variant for avatars and circular icons.

## Examples

### Box variant

The default rectangular skeleton, suitable for text lines and content blocks.

```html
<sat-ghost [variant]="'box'"></sat-ghost>
```

### Round variant

A circular skeleton for avatars or icon placeholders.

```html
<sat-ghost variant="round"></sat-ghost>
```

### Card skeleton

A composed card layout with avatar, text lines, and an action button as ghost placeholders.

```html
<div role="status" aria-live="polite" class="cdk-visually-hidden">Content is loading</div>
<mat-card appearance="outlined" aria-hidden="true">
  <mat-card-header>
    <sat-ghost mat-card-avatar variant="round" [width]="40" [height]="40"></sat-ghost>
    <mat-card-title>
      <sat-ghost variant="box" [width]="80" [height]="14"></sat-ghost>
    </mat-card-title>
  </mat-card-header>
  <mat-card-content style="display: flex; flex-direction: column; gap: 8px;">
    @for (i of ghostRows; track i) {
    <sat-ghost variant="box" [fitContainer]="true" [height]="16"></sat-ghost>
    }
    <sat-ghost variant="box" [width]="140" [height]="16"></sat-ghost>
  </mat-card-content>
  <mat-card-actions align="end">
    <sat-ghost variant="box" [width]="64" [height]="36" [radius]="20"></sat-ghost>
  </mat-card-actions>
</mat-card>
```

### Table skeleton

A data table where every cell is a ghost row, useful for list or grid loading states.

```html
<div role="status" aria-live="polite" class="cdk-visually-hidden">Content is loading</div>
<table mat-table [dataSource]="dataSource" aria-hidden="true">
  <ng-container matColumnDef="code">
    <th mat-header-cell *matHeaderCellDef>Code</th>
    <td mat-cell *matCellDef>
      <sat-ghost variant="box" [fitContainer]="true" [height]="16"></sat-ghost>
    </td>
  </ng-container>

  <ng-container matColumnDef="name">
    <th mat-header-cell *matHeaderCellDef>Name</th>
    <td mat-cell *matCellDef>
      <sat-ghost variant="box" [fitContainer]="true" [height]="16"></sat-ghost>
    </td>
  </ng-container>

  <ng-container matColumnDef="category">
    <th mat-header-cell *matHeaderCellDef>Category</th>
    <td mat-cell *matCellDef>
      <sat-ghost variant="box" [fitContainer]="true" [height]="16"></sat-ghost>
    </td>
  </ng-container>

  <ng-container matColumnDef="quantity">
    <th mat-header-cell *matHeaderCellDef>Quantity</th>
    <td mat-cell *matCellDef>
      <sat-ghost variant="box" [fitContainer]="true" [height]="16"></sat-ghost>
    </td>
  </ng-container>

  <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
  <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
</table>
```

### List skeleton

A list of items each with a round icon ghost and a text‑line ghost.

```html
<div role="status" aria-live="polite" class="cdk-visually-hidden">Content is loading</div>
<mat-list aria-hidden="true">
  @for (i of ghostItems; track i) {
  <mat-list-item>
    <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
      <sat-ghost variant="round" [width]="24" [height]="24"></sat-ghost>
      <sat-ghost variant="box" [width]="280" [height]="14"></sat-ghost>
    </div>
  </mat-list-item>
  }
</mat-list>
```

## Accessibility

Ghost is hidden from screen readers by default. It is considered a purely visual feature indicating to a user the layout they can expect when content loads. How layout looks is less of a concern to a user with visual impairment, they must however be informed of your applications' state. You must announce the loading state to a screen reader using a separate element with `role="status"` and `aria-live="polite"`. If you use the Ghost component to construct skeletons, you should hide the entire skeleton structure from screen readers by setting its container `aria-hidden` to `true`.

## API

```ts
import { SatGhostModule } from '@hylandsoftware/satori-preview/ghost';
```

### `<sat-ghost>`

**Inputs**

- `fitContainer: boolean = false` — When true the ghost expands to fill the available width of its container while maintaining its height
- `height: number | undefined` — Height override in pixels
- `radius: number | undefined` — Corner radius override in pixels
- `variant: SatGhostVariant = 'box'` — Shape variant of the ghost
- `width: number | undefined` — Width override in pixels

### Types & interfaces

```ts
type SatGhostVariant = 'box' | 'round';
```
