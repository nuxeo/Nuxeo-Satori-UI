<!-- Generated from packages/satori-preview/action-bar/docs/action-bar-overview.mdx. Do not edit here; edit the source MDX. -->

# Action Bar

The Action Bar component displays contextual actions for selected items with an intelligent overflow menu. It supports keyboard navigation, dynamic action groups, and automatically collapses actions into a menu when space is limited.

## Key Features

- **Unified action surface**: `sat-action-bar` provides a dedicated horizontal surface for bulk and contextual actions, typically placed above or below data-heavy content like tables or lists.
- **Selection-aware state**: `sat-selection-bar` reacts to the current selection count and exposes a clear action (`cleared` output) to reset the selection.
- **Compact action buttons**: `satActionBarButton` turns any button into an action-bar-styled control with consistent spacing, typography, and focus/press feedback.
- **Responsive truncation**: `sat-action-group` automatically collapses overflowing actions into a “More” menu so that the bar adapts to different viewport widths.
- **Accessible by design**: Uses `aria-live` for selection feedback, `aria-label` for icon-only actions, and keyboard-focusable buttons/menu items.
- **Internationalization-ready**: Built-in text is resolved via `@ngx-translate/core` translation keys under `sat-preview.action-bar.*`.

## Demo Showcase

### Basic Action Bar with Selection Bar

```html
<sat-action-bar>
  <sat-selection-bar
    [count]="1"
    [actions]="[
          { icon: 'circle_add', label: 'Add', disabled: true },
          { icon: 'copy', ariaLabel: 'Copy' },
          { icon: 'trash', label: 'Delete', hasTrailingDivider: true },
          { icon: 'stars', label: 'Favorite' },
          { icon: 'download', label: 'Download' },
        ]"
  />
</sat-action-bar>
```

This example shows a `sat-action-bar` containing a `sat-selection-bar` with a set of trailing actions rendered through `sat-action-group`.

### Action Bar with Table

```html
<sat-action-bar>
  <sat-selection-bar [count]="selectedCount()" [actions]="actions()" (cleared)="clearSelection()" />
</sat-action-bar>

<div class="demo-table-container mat-elevation-z8">
  <table mat-table [dataSource]="dataSource">
    <!-- Checkbox Column -->
    <ng-container matColumnDef="select">
      <th mat-header-cell *matHeaderCellDef>
        <mat-checkbox
          (change)="$event ? toggleAllRows() : null"
          [checked]="selection.hasValue() && isAllSelected()"
          [indeterminate]="selection.hasValue() && !isAllSelected()"
          [aria-label]="checkboxLabel()"
        />
      </th>
      <td mat-cell *matCellDef="let row">
        <mat-checkbox
          (click)="$event.stopPropagation()"
          (change)="$event ? toggleRow(row) : null"
          [checked]="selection.isSelected(row)"
          [aria-label]="checkboxLabel(row)"
        />
      </td>
    </ng-container>

    <!-- Position Column -->
    <ng-container matColumnDef="position">
      <th mat-header-cell *matHeaderCellDef>No.</th>
      <td mat-cell *matCellDef="let element">{{ element.position }}</td>
    </ng-container>

    <!-- Name Column -->
    <ng-container matColumnDef="name">
      <th mat-header-cell *matHeaderCellDef>Name</th>
      <td mat-cell *matCellDef="let element">{{ element.name }}</td>
    </ng-container>

    <!-- Weight Column -->
    <ng-container matColumnDef="weight">
      <th mat-header-cell *matHeaderCellDef>Weight</th>
      <td mat-cell *matCellDef="let element">{{ element.weight }}</td>
    </ng-container>

    <!-- Symbol Column -->
    <ng-container matColumnDef="symbol">
      <th mat-header-cell *matHeaderCellDef>Symbol</th>
      <td mat-cell *matCellDef="let element">{{ element.symbol }}</td>
    </ng-container>

    <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
    <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
  </table>
</div>
```

```typescript
export class ActionBarTableIntegration {
  readonly displayedColumns: string[] = ['select', 'position', 'name', 'weight', 'symbol'];

  dataSource = new MatTableDataSource(ELEMENT_DATA);
  selection = new SelectionModel<PeriodicElement>(true, []);

  readonly selectedCount = signal(0);
  readonly actions = computed<SatActionGroupItem[]>(() => [
    {
      icon: 'trash',
      label: 'Delete',
      action: () => this.deleteSelected(),
      disabled: this.selectedCount() < 1,
    },
  ]);

  /** Whether the number of selected elements matches the total number of rows. */
  isAllSelected() {
    const numSelected = this.selection.selected.length;
    const numRows = this.dataSource.data.length;
    return numSelected === numRows;
  }

  /** Selects all rows if they are not all selected; otherwise clear selection. */
  toggleAllRows() {
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      this.selection.select(...this.dataSource.data);
    }
    this.updateSelectionCount();
  }

  /** Toggle a single row and update the selection count */
  toggleRow(row: PeriodicElement) {
    this.selection.toggle(row);
    this.updateSelectionCount();
  }

  /** Update the selection count signal */
  updateSelectionCount() {
    this.selectedCount.set(this.selection.selected.length);
  }

  /** The label for the checkbox on the passed row */
  checkboxLabel(row?: PeriodicElement): string {
    if (!row) {
      return `${this.isAllSelected() ? 'deselect' : 'select'} all`;
    }
    return `${this.selection.isSelected(row) ? 'deselect' : 'select'} row ${row.position}`;
  }

  /** Delete selected items from the table */
  deleteSelected() {
    const selectedItems = this.selection.selected;
    const currentData = this.dataSource.data;
    const newData = currentData.filter((item) => !selectedItems.includes(item));

    this.dataSource.data = newData;
    this.selection.clear();
    this.updateSelectionCount();
  }

  clearSelection() {
    this.selection.clear();
    this.updateSelectionCount();
  }
}
```

This example demonstrates the Action Bar integrated with a Material table. Selecting rows updates the selection count in the action bar, and the delete button removes selected rows from the table.

## Components

### `sat-action-bar`

`sat-action-bar` is a lightweight layout container used to host selection bars, action groups, and other controls.

```html
<sat-action-bar>
  <!-- Common pattern: place a selection bar as the main content -->
  <sat-selection-bar
    [count]="selectedItems.length"
    [actions]="selectionActions"
    (cleared)="clearSelection()"
  />
</sat-action-bar>
```

- **Content projection**: The action bar does not impose a layout by itself; it simply projects its content and applies the action-bar styling container.
- **Typical usage**: Place it directly above or below the main content area that the actions operate on (e.g. a table or grid).

### `sat-selection-bar`

`sat-selection-bar` displays the current selection count and exposes a clear action along with a trailing `sat-action-group` for contextual actions.

**Inputs**

- **`count: number`**: Number of selected items. When `count` is `0`, the bar shows the “no selection” state and hides the clear button.
- **`actions: SatActionGroupItem[]`**: List of actions rendered via `sat-action-group` on the trailing side.

**Outputs**

- **`cleared: void`**: Emitted when the user activates the clear button. Typical usage is to reset the underlying selection model.

**Accessibility**

- The selection count text uses `aria-live="polite"` only when there is an active selection to announce changes non-intrusively.
- The clear button uses a translated `aria-label` to describe the action in a screen-reader-friendly way.
- The clear button displays a tooltip on hover with the same translated text for additional clarity.

```html
<sat-selection-bar
  [count]="selectedItems.length"
  [actions]="selectionActions"
  (cleared)="clearSelection()"
></sat-selection-bar>
```

```ts
selectionActions: SatActionGroupItem[] = [
  { icon: 'circle_add', label: 'Add', action: () => this.addItems() },
  { icon: 'copy', label: 'Copy', action: () => this.copyItems() },
  { icon: 'trash', label: 'Delete', hasTrailingDivider: true, action: () => this.deleteItems() },
  { icon: 'stars', label: 'Favorite', action: () => this.markFavorite() },
  { icon: 'download', label: 'Download', action: () => this.downloadItems() },
];
```

### `sat-action-group`

`sat-action-group` renders a row of icon-based actions and automatically collapses overflowing items into a “More” menu.

**Input**

- **`items: SatActionGroupItem[]`**: List of actions to render.

Each `SatActionGroupItem` has the following shape:

```ts
export type SatActionGroupItem = {
  icon: string;
  action: () => unknown;
  disabled?: boolean;
  hasTrailingDivider?: boolean;
} & ({ label: string } | { ariaLabel: string });
```

- **`icon`**: Name of the icon to be passed to `mat-icon` via `svgIcon`.
- **`action`**: Callback invoked when the user clicks the button or menu item.
- **`disabled`**: Optional flag to disable the action.
- **`hasTrailingDivider`**: Renders a vertical divider after this action when it is not the last visible item (and as a divider between menu items when collapsed).
- **`label` / `ariaLabel`**:
  - Use `label` for actions where text can be shown next to the icon.
  - Use `ariaLabel` for purely icon-only actions to provide an accessible description and tooltip; the label will be used in the overflow menu.

```html
<sat-action-group [items]="selectionActions"></sat-action-group>
```

`sat-action-group` measures its available width and moves overflowing actions into a trailing menu entry. The menu button uses a translated `aria-label` and displays a tooltip with "More actions" text.

**Keyboard Navigation**

- Automatically skips disabled items when navigating.
- The "More" menu trigger button is included in the keyboard navigation sequence.

### `satActionBarButton` (component)

`satActionBarButton` is an attribute selector component that styles a button so it fits the Action Bar's visual language and behavior (including a ripple effect).

```html
<button satActionBarButton type="button" (click)="add()">
  <mat-icon svgIcon="circle_add"></mat-icon>
  Add
</button>
```

**Key behaviors**

- Adds a ripple effect on mouse down for visual feedback.
- Applies consistent sizing and spacing for labels and icons.
- Supports the `disabled` input to reflect the disabled state in styles.

```html
<button satActionBarButton type="button" [disabled]="!isDownloadReady" (click)="download()">
  <mat-icon svgIcon="download"></mat-icon>
  Download
</button>
```

## Guidelines

### Selection behavior

- **Reflect actual selection**: Ensure the `count` input matches your selection model so users receive accurate feedback.
- **Clear action**: Handle the `cleared` output by resetting the selection and, if necessary, updating other parts of the UI (e.g., filters or bulk state).

### Action design

- **Accessibility-first**: Provide `ariaLabel` for actions that do not display text labels and ensure icons are meaningful in the current context.

## API

```ts
import { SatActionBarModule } from '@hylandsoftware/satori-preview/action-bar';
```

### `<sat-action-bar>`

### `satActionBarButton`

**Inputs**

- `disabled: boolean = false` — Whether the button is disabled

### `<sat-action-group>`

**Inputs**

- `items: SatActionGroupItem[] = []`

### `<sat-selection-bar>`

**Inputs**

- `actions: SatActionGroupItem[] = []` — Actions rendered inside the trailing action group
- `count: number = 0` — Number of items currently selected

**Outputs**

- `cleared: void` — Emitted when the clear button is activated

### Types & interfaces

```ts
type SatActionGroupItem = literal type & unknown;
```
