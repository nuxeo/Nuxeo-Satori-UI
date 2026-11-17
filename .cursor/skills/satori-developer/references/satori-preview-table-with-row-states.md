<!-- Generated from packages/satori-preview/table-with-row-states/docs/table-with-row-states-overview.mdx. Do not edit here; edit the source MDX. -->

# Table With Row States

The **Table with Row States** directives add interactive row styling and keyboard navigation to Angular Material tables.

## Key Features

- **Material table enhancement**: Adds active-row and selected-row styling to a standard Angular Material table without replacing `mat-table`.
- **Keyboard support**: Supports roving focus across rows with ArrowUp and ArrowDown, moves within row controls with ArrowLeft and ArrowRight, activates the primary action with Enter, and toggles the selection control with Space.
- **Primary-action forwarding**: Clicking a non-interactive part of a row forwards the interaction to the row's primary action.
- **Optional selection control integration**: Works with checkbox-style row selection when the control is marked with `satRowStateSelectionControl`.

## Demo Showcase

```html
<div class="story-layout">
  <div>
    <sat-action-bar>
      <sat-selection-bar
        [count]="selectedCount()"
        [actions]="actions()"
        (cleared)="clearSelection()"
      />
    </sat-action-bar>

    <mat-table [dataSource]="dataSource" satTableWithRowStates aria-label="Periodic Elements">
      <!-- Checkbox Column -->
      <ng-container matColumnDef="select">
        <mat-header-cell *matHeaderCellDef>
          <mat-checkbox
            (change)="$event ? toggleAllRows() : null"
            [checked]="selection.hasValue() && isAllSelected()"
            [indeterminate]="selection.hasValue() && !isAllSelected()"
            [aria-label]="checkboxLabel()"
          >
          </mat-checkbox>
        </mat-header-cell>
        <mat-cell *matCellDef="let row">
          @if (activeRow() === row) {
          <span class="sat-active-row-indicator"></span>
          }
          <mat-checkbox
            satRowStateSelectionControl
            (change)="$event ? toggleRow(row) : null"
            [checked]="selection.isSelected(row)"
            [aria-label]="checkboxLabel(row)"
          >
          </mat-checkbox>
        </mat-cell>
      </ng-container>

      <!-- Position Column -->
      <ng-container matColumnDef="position">
        <mat-header-cell *matHeaderCellDef>No.</mat-header-cell>
        <mat-cell *matCellDef="let element">{{ element.position }}</mat-cell>
      </ng-container>

      <!-- Name Column (Primary Action) -->
      <ng-container matColumnDef="name">
        <mat-header-cell *matHeaderCellDef>Name</mat-header-cell>
        <mat-cell *matCellDef="let element">
          <button
            satRowPrimaryAction
            (click)="activeRow.set(element)"
            aria-label="Open detail for {{ element.name }}"
          >
            {{ element.name }}
          </button>
        </mat-cell>
      </ng-container>

      <!-- Weight Column -->
      <ng-container matColumnDef="weight">
        <mat-header-cell *matHeaderCellDef>Weight</mat-header-cell>
        <mat-cell *matCellDef="let element">{{ element.weight }}</mat-cell>
      </ng-container>

      <!-- Symbol Column -->
      <ng-container matColumnDef="symbol">
        <mat-header-cell *matHeaderCellDef>Symbol</mat-header-cell>
        <mat-cell *matCellDef="let element">{{ element.symbol }}</mat-cell>
      </ng-container>

      <mat-header-row *matHeaderRowDef="displayedColumns"></mat-header-row>
      <mat-row
        *matRowDef="let row; columns: displayedColumns"
        satRowState
        [active]="activeRow() === row"
        [selected]="selection.isSelected(row)"
      ></mat-row>
    </mat-table>
  </div>

  <div class="story-detail-panel" [class.story-detail-panel--empty]="!activeRow()">
    @if (activeRow(); as row) {
    <p>
      <strong>{{ row.name }}</strong>
    </p>
    <p>Weight: {{ row.weight }}</p>
    <p>Symbol: {{ row.symbol }}</p>
    <button
      mat-icon-button
      (click)="closeSidePanel()"
      style="position: absolute; top: 0; right: 0;"
      aria-label="Close detail panel"
    >
      <mat-icon svgIcon="x_large"></mat-icon>
    </button>
    }
  </div>
</div>
```

```typescript
export class TableRowStatesStoryComponent {
  readonly displayedColumns = ['select', 'position', 'name', 'weight', 'symbol'];

  readonly dataSource = new MatTableDataSource(ELEMENT_DATA);
  readonly selection = new SelectionModel<PeriodicElement>(true, []);
  readonly activeRow = signal<PeriodicElement | null>(null);

  readonly selectedCount = signal(0);
  readonly actions = computed<SatActionGroupItem[]>(() => [
    {
      icon: 'trash',
      label: 'Delete',
      action: () => this.deleteSelected(),
      disabled: this.selectedCount() < 1,
    },
  ]);

  isAllSelected(): boolean {
    return this.selection.selected.length === this.dataSource.data.length;
  }

  toggleRow(row: PeriodicElement) {
    this.selection.toggle(row);
    this.updateSelectionCount();
  }

  toggleAllRows(): void {
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      this.selection.select(...this.dataSource.data);
    }
    this.updateSelectionCount();
  }

  checkboxLabel(row?: PeriodicElement): string {
    if (row) {
      return `${this.selection.isSelected(row) ? 'deselect' : 'select'} ${row.name}`;
    } else {
      return `${this.isAllSelected() ? 'deselect' : 'select'} all periodic elements`;
    }
  }

  closeSidePanel(): void {
    this.activeRow.set(null);
    this.focusTableRows();
  }

  deleteSelected() {
    const selectedItems = this.selection.selected;
    const currentData = this.dataSource.data;
    const newData = currentData.filter((item) => !selectedItems.includes(item));

    this.dataSource.data = newData;
    this.clearSelection();

    const activeRow = this.activeRow();
    if (activeRow && selectedItems.includes(activeRow)) {
      this.activeRow.set(null);
    }
  }

  clearSelection() {
    this.selection.clear();
    this.updateSelectionCount();
    this.focusTableRows();
  }

  private updateSelectionCount() {
    this.selectedCount.set(this.selection.selected.length);
  }

  private focusTableRows() {
    // Deferred after rerender to account for, for example, rows being deleted.
    setTimeout(() => {
      document.querySelector<HTMLElement>('mat-row[tabindex="0"]')?.focus();
    });
  }
}
```

## When To Use

Use Table With Row States when each row has a clear primary action and the table needs to reflect additional row state such as:

- an active row that opens a detail panel
- selected rows for bulk actions
- richer keyboard navigation across row-level controls

If you do not need an active row or row states, prefer a regular Angular Material table. `satTableWithRowStates` adds interaction rules and accessibility expectations that are only justified when the row itself behaves like an interactive surface.

## Valid Consumption Pattern

The example story shows the intended composition:

- apply `satTableWithRowStates` to the `mat-table`
- apply `satRowState` to each `mat-row`
- include exactly one primary action inside the row with `satRowPrimaryAction`
- mark the (optional) selection control with `satRowStateSelectionControl`

```html
<mat-table [dataSource]="dataSource" satTableWithRowStates aria-label="Periodic Elements">
  <ng-container matColumnDef="select">
    <mat-header-cell *matHeaderCellDef>
      <mat-checkbox
        (change)="$event ? toggleAllRows() : null"
        [checked]="selection.hasValue() && isAllSelected()"
        [indeterminate]="selection.hasValue() && !isAllSelected()"
        [aria-label]="checkboxLabel()"
      >
      </mat-checkbox>
    </mat-header-cell>

    <mat-cell *matCellDef="let row">
      <mat-checkbox
        satRowStateSelectionControl
        (change)="$event ? selection.toggle(row) : null"
        [checked]="selection.isSelected(row)"
        [aria-label]="checkboxLabel(row)"
      >
      </mat-checkbox>
    </mat-cell>
  </ng-container>

  <ng-container matColumnDef="name">
    <mat-header-cell *matHeaderCellDef>Name</mat-header-cell>
    <mat-cell *matCellDef="let element">
      <button
        satRowPrimaryAction
        (click)="activeRow.set(element)"
        aria-label="Open detail for {{ element.name }}"
      >
        {{ element.name }}
      </button>
    </mat-cell>
  </ng-container>

  <mat-row
    *matRowDef="let row; columns: displayedColumns"
    satRowState
    [active]="activeRow() === row"
    [selected]="selection.isSelected(row)"
  >
  </mat-row>
</mat-table>
```

## Directives

### `satTableWithRowStates`

Apply to `mat-table` to enable row-state styling and keyboard navigation.

### `satRowState`

Apply to `mat-row` to mark the row as part of the row-state interaction model.

**Inputs**

- **`active: boolean`**: Marks the currently active row.
- **`selected: boolean`**: Marks the row as selected.

### `satRowPrimaryAction`

Required marker directive for the row's primary action element.

Apply it to the button or link that should run when the user:

- clicks a non-interactive area of the row
- presses Enter while the row itself is focused

### `satRowStateSelectionControl`

Optional marker directive for the row selection control, typically a checkbox.

Apply it when the row supports selection so Space on the focused row can toggle the control and the row ripple is suppressed while the pointer is over the control.

## Accessibility

### Required Primary Action

Every `satRowState` row must contain an element marked with `satRowPrimaryAction`. This is not optional. The row directive forwards row clicks and Enter key presses to that element, and it derives the row's accessible label from that element.

If you omit the primary action, the row logs a console warning and loses the intended activation behavior and accessible naming.

### Use Real Interactive Elements

The primary action should be a real button or link with meaningful visible text content, as shown in the story. The row label is derived from that element's text content, so an icon-only control is not a valid primary action for this pattern.

### Explicit Labels

- Provide an `aria-label` for the `mat-table`.
- Provide meaningful checkbox labels for row selection.
- If opening an active-row detail panel, ensure the panel content and close control are clearly labeled.

### Keyboard Navigation

- **ArrowUp and ArrowDown** move focus between rows.
- **ArrowLeft and ArrowRight** move focus between interactive elements inside the current row.
- **Enter** activates the primary action when the row is focused.
- **Space** toggles the selection control when the row is focused and a selection control is present.

## API

```ts
import { SatTableWithRowStatesModule } from '@hylandsoftware/satori-preview/table-with-row-states';
```

**Content slots** (project via directive)

- `sat-row-state`
  - `active: boolean = false` — Whether this row is currently active
  - `selected: boolean = false` — Whether this row is currently selected
- `sat-row-primary-action` — Marker directive applied to the primary action element within a satRowState row
- `sat-row-state-selection-control` — Marker directive applied to the selection control element (e.g
- `sat-table-with-row-states` — Marker directive applied to a `mat-table` element to opt into the Satori row-states styling system
