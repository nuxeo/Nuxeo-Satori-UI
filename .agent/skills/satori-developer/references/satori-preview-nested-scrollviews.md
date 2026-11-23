<!-- Generated from packages/satori-preview/nested-scrollviews/docs/nested-scrollviews-overview.mdx. Do not edit here; edit the source MDX. -->

# Nested Scrollviews

## Key Features

- **Independent Scrolling Areas**: Leading and trailing elements that scroll independently from the main content area.
- **App Header Integration**: Automatically positions Nested Scrollviews below the App Header using `SatAppHeaderService.verticalSpace`.
- **Sticky Positioning**: Nested Scrollviews remain fixed in the viewport as the user scrolls the main content, with dynamic height adjustments based on available viewport space.
- **Flexible Layout**: Built with a flex container that adapts to any width combination of leading area, main content, and trailing area.
- **Zero Configuration**: Directives automatically apply all necessary CSS for sticky behavior, overflow scrolling, and height calculations.

## Demo Showcase

```typescript
// Code from NestedScrollviewsStories.nestedScrollviews
// [Story code could not be extracted]
```

This example shows a typical three-area layout with:

- A **leading area** containing navigation links (project list)
- A **main content area** with a data table featuring sticky headers
- A **trailing area** with a details form and sticky toolbar

## Components

### `sat-nested-scrollviews`

The container component that provides the flex layout structure for nested scrollview panes.

```html
<sat-nested-scrollviews>
  <div satLeadingNestedScrollview>Leading content</div>
  <div>Main content area</div>
  <div satTrailingNestedScrollview>Trailing content</div>
</sat-nested-scrollviews>
```

**Layout behavior:**

- Arranges children horizontally
- Leading and trailing panes maintain their specified widths
- Main content area fills remaining space

### `satLeadingNestedScrollview` Directive

Applied to an element to make it a sticky, independently scrollable leading area.

```html
<mat-nav-list satLeadingNestedScrollview style="width: 320px;">
  <a mat-list-item routerLink="/project-a">Project A</a>
  <a mat-list-item routerLink="/project-b">Project B</a>
  <!-- More items... -->
</mat-nav-list>
```

### `satTrailingNestedScrollview` Directive

Applied to an element to make it a sticky, independently scrollable trailing area.

```html
<div satTrailingNestedScrollview style="width: 360px;">
  <mat-toolbar>Details</mat-toolbar>
  <form>
    <!-- Form fields... -->
  </form>
</div>
```

## Guidelines

- **Set explicit widths** on Leading and Trailing Nested Scrollviews

- **Combine with sticky table headers** in the main content area using `SatAppHeaderService.verticalSpace`:

```html
<table mat-table [dataSource]="data">
  <ng-container matColumnDef="name">
    <th mat-header-cell *matHeaderCellDef [style.top.px]="appHeaderService.verticalSpace()">
      Name
    </th>
    <td mat-cell *matCellDef="let row">{{ row.name }}</td>
  </ng-container>
  <tr mat-header-row *matHeaderRowDef="columns; sticky: true"></tr>
  <tr mat-row *matRowDef="let row; columns: columns"></tr>
</table>
```

## Examples

### Basic three-pane layout

```html
<sat-nested-scrollviews>
  <nav satLeadingNestedScrollview style="width: 280px; padding: 16px;">
    <a href="/section-1">Section 1</a>
    <a href="/section-2">Section 2</a>
  </nav>

  <main style="padding: 16px;">
    <h1>Main Content</h1>
    <p>Your primary content goes here...</p>
  </main>

  <aside satTrailingNestedScrollview style="width: 320px; padding: 16px;">
    <h2>Details</h2>
    <p>Supplementary information...</p>
  </aside>
</sat-nested-scrollviews>
```

### Two-pane layout (leading only)

```html
<sat-nested-scrollviews>
  <mat-nav-list satLeadingNestedScrollview style="width: 256px;">
    <a mat-list-item routerLink="/dashboard">Dashboard</a>
    <a mat-list-item routerLink="/reports">Reports</a>
    <a mat-list-item routerLink="/settings">Settings</a>
  </mat-nav-list>

  <router-outlet></router-outlet>
</sat-nested-scrollviews>
```

### Two-pane layout (trailing only)

```html
<sat-nested-scrollviews>
  <div style="flex: 1;">
    <table mat-table [dataSource]="items">
      <!-- Table columns... -->
    </table>
  </div>

  <div satTrailingNestedScrollview style="width: 400px;">
    <mat-toolbar>Item Details</mat-toolbar>
    <your-item-detail-form [item]="selectedItem"></your-item-detail-form>
  </div>
</sat-nested-scrollviews>
```

## API

```ts
import { SatNestedScrollviewsModule } from '@hylandsoftware/satori-preview/nested-scrollviews';
```

### `<sat-nested-scrollviews>`

**Content slots** (project via directive)

- `satLeadingNestedScrollview`
- `satTrailingNestedScrollview`
