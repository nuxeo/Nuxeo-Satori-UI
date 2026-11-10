<!-- Generated from packages/satori-ui/avatar/docs/avatar-overview.mdx. Do not edit here; edit the source MDX. -->

# Avatar

The Avatar component displays user initials in a circular container with customizable colors, sizes, and status indicators. It's designed to represent users in a consistent and visually appealing way throughout your application.

## Key Features

- **Multiple sizes**: From 24px to 128px for different UI contexts
- **Color categories**: 8 predefined color schemes (purple, blue, pink, teal, yellow, green, red, orange)
- **Status indicators**: Visual indicators for user status (active, away, offline, readonly)
- **Smart initials display**: Shows 1 character for the smallest size, 2 characters for larger sizes
- **Borderless option**: Can be displayed with or without borders
- **Avatar image**: Optionally display an image in lieu of category-colored initials
- **Avatar With Tooltip**: Display tooltip with username on hover over Avatar. When using the Avatar component in a layout where the Avatar element is not immediately followed or preceded by the user's username, you should include a tooltip placed on the Avatar with the username (should be equal to aria-label)

## Demo Showcase

```html
<sat-avatar aria-label="William Wilberforce" [size]="'80'" [category]="'purple'" [initials]="'WW'">
</sat-avatar>
```

## Examples

### Image

```html
<sat-avatar aria-label="William Wilberforce">
  <img src="assets/person-200x200.jpg" alt="" aria-hidden="true" />
  <!-- image alt can stay empty as accessibility is handled by the parent avatar component -->
</sat-avatar>
```

### Different Size

```html
<sat-avatar size="64" initials="JD" aria-label="John Doe"></sat-avatar>
```

### Status Variation

```html
<sat-avatar indicator="away" initials="JD" aria-label="John Doe, Status: Away"></sat-avatar>
```

### Borderless Style

```html
<sat-avatar [borderless]="true" initials="JD" aria-label="John Doe"></sat-avatar>
```

### With Tooltip

```html
<sat-avatar matTooltip="William Wilberforce" aria-label="William Wilberforce"></sat-avatar>
```

## API

```ts
import { SatAvatarModule } from '@hylandsoftware/satori-ui/avatar';
```

### `<sat-avatar>`

**Inputs**

- `borderless: boolean = false` — Whether to not display a border around the avatar
- `category: SatAvatarCategory = 'purple'` — One out of: purple, blue, pink, teal, yellow, green, red, orange
- `indicator: SatAvatarIndicator` — One out of: active, away, offline, readonly
- `initials: string = 'WW'` — The first two character of this string, or the first character of this string in size 24 will be displayed uppercase in the avatar
- `size: SatAvatarSize = '24'` — One out of: 24, 28, 36, 64, 80, 128

### Types & interfaces

```ts
type SatAvatarCategory =
  'purple' | 'blue' | 'pink' | 'teal' | 'yellow' | 'green' | 'red' | 'orange';
```

```ts
type SatAvatarIndicator = 'active' | 'away' | 'offline' | 'readonly';
```

```ts
type SatAvatarSize = '128' | '80' | '64' | '36' | '28' | '24';
```
