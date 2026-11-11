<!-- Generated from packages/satori-ui/tag/docs/tag-overview.mdx. Do not edit here; edit the source MDX. -->

# Tag

The Tag component system in Satori UI offers versatile, customizable tags for displaying categories, statuses, or other labels with optional icons and styling. Tags are reusable and easily styled for consistent, visually appealing information display across Angular applications.

## Key features

- Flexible tag creation with custom content

## Demo showcase

```html
<sat-category-tag [category]="'purple'">
  <mat-icon aria-label="custom icon" [svgIcon]="'tag'"></mat-icon>
  Label
</sat-category-tag>
```

## Guidelines

- **Category Tag** should be only used to represent different categories or groups of items. It is styled with different colors to indicate different category types. You can provide any custom icon that fits your requirements.
- **Status Tag** should be only used to represent different statuses of an item. It is styled with different colors and icons to clearly indicate different status types. All types of status tags have a default icon. Although you can provide a custom icon if needed.
- We don't recommend customizing the predefined tag styles, as this can lead to inconsistencies in the design system.

## Examples

### Category Tags

The Category tag is used to display different types of categories mentioned in [`SatTagCategory`](#sattagcategory) such as purple, blue, pink, teal etc. It is styled with different colors to indicate different categories.

```html
<sat-category-tag [category]="'purple'">
  <mat-icon aria-label="custom icon" [svgIcon]="'tag'"></mat-icon>
  Label
</sat-category-tag>
```

### Status Tags

The Status tag is used to display different types of statuses mentioned in [`SatTagStatus`](#sattagstatus) such as important, success, warning, info etc. It is styled with different colors and different icons to clearly indicate different statuses.

```html
<sat-status-tag [status]="'success'"> Label </sat-status-tag>
```

## API

```ts
import { SatTagModule } from '@hylandsoftware/satori-ui/tag';
```

### `<sat-category-tag>`

**Inputs**

- `category: SatTagCategory (required)` — The category of the tag, which determines its style and icon

### `<sat-status-tag>`

**Inputs**

- `hideIcon: boolean = false` — Whether to hide the icon in the tag
- `status: SatTagStatus (required)` — The status of the tag, which determines its appearance and color

**Content slots** (project via directive)

- `satInteractiveTag` — Directive that transforms a tag element to make it interactive to allow to attach a tooltip or rich-tooltip

### Types & interfaces

```ts
type SatTagCategory =
  'purple' | 'blue' | 'pink' | 'teal' | 'yellow' | 'green' | 'red' | 'orange' | 'gray';
```

```ts
type SatTagStatus =
  'important-loud' | 'important' | 'success' | 'warning' | 'info' | 'neutral' | 'neutral-quiet';
```

_Deprecated: `satHideIcon`._
