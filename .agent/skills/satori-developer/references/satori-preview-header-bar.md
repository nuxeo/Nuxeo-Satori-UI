<!-- Generated from packages/satori-preview/header-bar/docs/header-bar-overview.mdx. Do not edit here; edit the source MDX. -->

# Header Bar

The Header Bar component displays a title and provides leading and trailing slots for navigation and contextual actions. It supports a one-row and two-row layout variant.

## Key Features

- **Three content slots**: `satHeaderBarLeading` for navigation actions (back button or nav trigger), the default slot for heading text, and `satHeaderBarTrailing` for page-level actions.
- **Three layout variants**: `one-row` places the heading inline between leading and trailing slots; `two-row` promotes the leading/trailing to a top row and moves the heading to a second row; `dynamic` automatically switches between the two: at scroll position 0, uses `two-row` when the heading would truncate in `one-row`; collapses to `one-row` once the user has scrolled.
- **Sticky positioning**: The header bar sticks to the top of its scroll container by default.
- **Text truncation with tooltip**: Long heading text is automatically truncated with an ellipsis; a tooltip with the full text is shown on hover.
- **Roving-tabindex keyboard navigation**: Leading and trailing slots behave as independent toolbar groups - arrow keys navigate within a slot, Tab/Shift+Tab moves between slots and exits the header bar.

## Demo Showcase

### Default (Dynamic Variant)

```html
<sat-header-bar-container>
  <sat-header-bar [variant]="variant()">
    @if (showLeading()) {
    <button mat-icon-button satHeaderBarLeading aria-label="Navigate back">
      <mat-icon svgIcon="arrow_left"></mat-icon>
    </button>
    } {{ heading() }} @if (showTrailing()) {
    <div satHeaderBarTrailing>
      <button mat-icon-button aria-label="About">
        <mat-icon svgIcon="info"></mat-icon>
      </button>
      <button mat-icon-button aria-label="More options">
        <mat-icon svgIcon="more_vert"></mat-icon>
      </button>
    </div>
    }
  </sat-header-bar>
  <div satHeaderBarContent>
    <sat-navigation-tabs style="padding: 0 16px 16px 16px;">
      <a satNavigationTab [active]="true" href="#"> Home </a>
      <a satNavigationTab href="#"> Dashboard </a>
      <a satNavigationTab href="#"> Reports </a>
      <a satNavigationTab href="#"> Analytics </a>
      <a satNavigationTab href="#"> Settings </a>
    </sat-navigation-tabs>
    <p>
      Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut
      labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco
      laboris nisi ut aliquip ex ea commodo consequat.
    </p>
    <p>
      Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
      pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt
      mollit anim id est laborum.
    </p>
    <p>
      Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam varius, turpis molestie
      pretium placerat, arcu purus aliquam erat, eu metus sapien nulla in sem. Donec nec ante a mi
      elementum condimentum.
    </p>
    <p>
      Phasellus ultrices nulla quis nibh. Quisque a lectus. Donec consectetuer ligula vulputate sem
      tristique cursus. Nam nulla quam, gravida non, commodo a, sodales sit amet, nisi.
    </p>
    <p>
      Nullam varius, turpis molestie pretium placerat, arcu purus aliquam erat, eu metus sapien
      nulla in sem. Curabitur pretium tincidunt lacus. Nulla gravida orci a odio, et tempus feugiat.
      Donec aliquet, tortor sed accumsan bibendum, erat ligula aliquet magna.
    </p>
    <p>
      Fusce fermentum. Nullam varius, turpis molestie pretium placerat, arcu purus aliquam erat.
      Vivamus aliquet elit ac nisl. Fusce fermentum. Nullam varius, turpis molestie pretium
      placerat, arcu purus aliquam erat, eu metus sapien nulla in sem.
    </p>
    <p>
      Sed lectus. Integer euismod lacus luctus magna. Quisque cursus, metus vitae pharetra auctor,
      sem massa mattis sem, at interdum magna augue eget diam. Vestibulum ante ipsum primis in
      faucibus orci luctus et ultrices posuere cubilia curae.
    </p>
    <p>
      Morbi in ipsum sit amet pede facilisis laoreet. Donec lacus nunc, viverra nec, blandit vel,
      egestas et, augue. Vestibulum tincidunt malesuada tellus. Ut ultrices ultrices enim. Curabitur
      sit amet mauris. Morbi in dui quis est pulvinar ullamcorper.
    </p>
    <p>
      Nulla facilisi. Integer lacinia sollicitudin massa. Cras metus. Sed aliquet risus a tortor.
      Integer id quam. Morbi mi. Quisque nisl felis, venenatis tristique, dignissim in, ultrices sit
      amet, augue.
    </p>
    <p>
      Proin sodales libero eget ante. Nulla quam. Aenean laoreet. Vestibulum nisi lectus, commodo
      ac, facilisis ac, ultricies eu, pede. Ut orci risus, accumsan porttitor, cursus quis, aliquet
      eget, justo.
    </p>
  </div>
</sat-header-bar-container>
```

```typescript
export class HeaderBarExample {
  readonly variant = input<'one-row' | 'two-row' | 'dynamic'>('dynamic');
  readonly heading = input('Header text');
  readonly showLeading = input(true);
  readonly showTrailing = input(true);
}
```

### One-Row

```typescript
// Code from HeaderBarStories.oneRow
// [Story code could not be extracted]
```

### Two-Row

```typescript
// Code from HeaderBarStories.twoRow
// [Story code could not be extracted]
```

### Without Leading Slot

```typescript
// Code from HeaderBarStories.noLeading
// [Story code could not be extracted]
```

### Long Heading (Truncation)

```typescript
// Code from HeaderBarStories.longHeading
// [Story code could not be extracted]
```

## Components

### `sat-header-bar-container`

A layout container that pairs `sat-header-bar` with scrollable page content.

```html
<sat-header-bar-container>
  <sat-header-bar>Page title</sat-header-bar>
  <div satHeaderBarContent>
    <!-- scrollable content -->
  </div>
</sat-header-bar-container>
```

**Content projection**

- `sat-header-bar` - the header bar element placed as a direct child.
- `[satHeaderBarContent]` / `[sat-header-bar-content]` - the scrollable content area.

### `sat-header-bar`

The header bar itself. Displays a title/heading and provides three content slots.

**Inputs**

- **`variant: 'one-row' | 'two-row' | 'dynamic'`** - Layout variant (default: `'dynamic'`).
  - `one-row`: heading is placed inline between the leading and trailing slots.
  - `two-row`: leading and trailing slots occupy the top row; the heading moves to a second row below them.
  - `dynamic`: at scroll position 0, uses `two-row` when the heading would truncate in `one-row`; collapses to `one-row` once the user has scrolled.
- **`background: 'surface-container-low' | 'surface-container-lowest'`** - Background token of the header bar (default: `'surface-container-low'`).

**Content projection slots**

- **`[satHeaderBarLeading]`** / `[sat-header-bar-leading]` - Leading slot. Intended for a back-navigation icon button or a platform-nav trigger. Typically holds a single `mat-icon-button`.
- **Default slot** - Heading text or rich heading content. Long text is automatically truncated with an ellipsis and revealed as a tooltip on hover.
- **`[satHeaderBarTrailing]`** / `[sat-header-bar-trailing]` - Trailing slot. Intended for page-level actions such as icon buttons or text buttons.

## Basic Usage

```html
<sat-header-bar-container>
  <sat-header-bar>
    <button mat-icon-button satHeaderBarLeading aria-label="Navigate back">
      <mat-icon svgIcon="arrow_left"></mat-icon>
    </button>
    Page title
    <div satHeaderBarTrailing>
      <button mat-icon-button aria-label="More options">
        <mat-icon svgIcon="more_vert"></mat-icon>
      </button>
    </div>
  </sat-header-bar>
  <div satHeaderBarContent>
    <!-- page content -->
  </div>
</sat-header-bar-container>
```

## Keyboard Navigation

Leading and trailing slots each form an independent roving-tabindex group following the [ARIA toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/).

| Key                          | Behavior                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Tab**                      | Enters the leading slot (first / last-focused item), then moves to the trailing slot, then exits the header bar. |
| **Shift+Tab**                | Reverses Tab order.                                                                                              |
| **Arrow Left / Arrow Right** | Moves focus within the active slot; wraps around.                                                                |
| **Home**                     | Jumps to the first item in the slot.                                                                             |
| **End**                      | Jumps to the last item in the slot.                                                                              |

## Accessibility

- The host element has `role="banner"`.
- When the heading overflows, a `matTooltip` containing the full text is attached so the complete value is accessible on hover and via assistive technologies.
- Use descriptive `aria-label` values on icon buttons placed in the leading and trailing slots.

## API

```ts
import { SatHeaderBarModule } from '@hylandsoftware/satori-preview/header-bar';
```

### `<sat-header-bar>`

**Inputs**

- `variant: "one-row" | "two-row" | "dynamic" = 'dynamic'` — Layout variant of the header bar

### `<sat-header-bar-container>`

### `<sat-header-bar-group>`
