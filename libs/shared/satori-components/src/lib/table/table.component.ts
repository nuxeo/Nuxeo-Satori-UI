import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
} from '@angular/core';
import { MatTableModule } from '@angular/material/table';

/** A row of a table: its cells' text, already translated, in the order of the table's columns. */
export type NxsTableRow = readonly string[];

/**
 * A table of text: Angular Material's table, the design system's, drawn on a native `<table>`, in
 * the theme's colours.
 *
 * `caption` names it, as a native `<caption>`: shown above it, or said only to assistive technology
 * with `hideCaption`, where a heading or a label beside it already says what it is. `columns` are
 * its headers, each a `<th scope="col">`, and `rows` its rows, each cell's text in the columns'
 * order: a row shorter than the columns leaves the rest of its cells empty. All of it arrives
 * already translated. `emptyText`, when set, is said in one row across the columns while there
 * are no rows; blank, an empty table shows its headers alone. `dense` draws the rows at a compact
 * height, for a table inside a card or a panel.
 *
 * It shows text, and takes no focus: a table whose rows are chosen or opened is `nxs-document-list`.
 */
@Component({
  selector: 'nxs-table',
  standalone: true,
  templateUrl: './table.component.html',
  styleUrl: './table.component.scss',
  imports: [MatTableModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-table', '[class.nxs-table--dense]': 'dense()' },
})
export class NxsTableComponent {
  /** The table's caption, already translated: its accessible name. Required. */
  readonly caption = input.required<string>();
  /** Says the caption only to assistive technology, where a heading or label beside it shows it. */
  readonly hideCaption = input(false, { transform: booleanAttribute });
  /** The column headers, already translated, in order. */
  readonly columns = input.required<readonly string[]>();
  /** The rows, each its cells' text, already translated, in the columns' order. None by default. */
  readonly rows = input<readonly NxsTableRow[]>([]);
  /**
   * Said in one row across the columns while there are no rows, already translated. Blank, the
   * default, shows the headers alone.
   */
  readonly emptyText = input('');
  /** Draws the rows at a compact height, for a table inside a card or a panel. */
  readonly dense = input(false, { transform: booleanAttribute });

  /** Each column's name for Material's table: its position, so two headers may say the same. */
  protected readonly columnIds = computed(() =>
    this.columns().map((_, index) => `column-${index}`),
  );
}
