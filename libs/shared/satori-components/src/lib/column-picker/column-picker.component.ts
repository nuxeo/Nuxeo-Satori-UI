import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { TranslatePipe } from '@ngx-translate/core';

/** One column the user may show or hide. */
export interface NxsPickableColumn {
  /** The host's key for the column; what `apply` emits. */
  readonly key: string;
  /** The column's name, already translated. */
  readonly label: string;
  /** Whether the column is shown now. */
  readonly visible: boolean;
}

/**
 * The panel a user opens from a table header to choose which columns show.
 *
 * Presentational: it is handed the columns and emits the keys chosen, in the columns' own order so
 * a reorder in the host's column set is respected. Where the columns come from — Layer 1
 * descriptors on browse, a fixed set on search — and where the choice is persisted stay the host's.
 *
 * Changes are buffered until Done, so Escape and the backdrop genuinely discard them. It is a
 * modal dialog while open: it takes focus when it appears, keeps Tab and Shift+Tab inside itself,
 * and hands focus back to whatever had it (the header's "Manage columns" button) when it goes. The panel hangs from the top-right corner
 * of the nearest positioned ancestor, so the host renders it inside the table's wrapper.
 */
@Component({
  selector: 'nxs-column-picker',
  standalone: true,
  templateUrl: './column-picker.component.html',
  styleUrl: './column-picker.component.scss',
  imports: [CdkTrapFocus, MatButtonModule, MatCheckboxModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nxs-column-picker',
    '(document:keydown.escape)': 'cancel()',
  },
})
export class NxsColumnPickerComponent implements AfterViewInit, OnDestroy {
  /** Every column the user may choose from, in display order. */
  readonly columns = input.required<readonly NxsPickableColumn[]>();
  /** Keys that cannot be switched off — the identity column, so no row is left unlabelled. */
  readonly required = input<readonly string[]>([]);
  /** The keys Reset returns to: the host's defaults, not a copy of a packaged list. */
  readonly defaults = input<readonly string[]>([]);

  /** Done: the chosen keys, in column order. */
  readonly apply = output<readonly string[]>();
  /** Escape or the backdrop: close without applying. */
  readonly dismiss = output<void>();

  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly opener = inject(DOCUMENT).activeElement as HTMLElement | null;
  private readonly pending = signal<readonly string[] | null>(null);

  protected readonly chosen = computed<readonly string[]>(
    () =>
      this.pending() ??
      this.columns()
        .filter((column) => column.visible)
        .map((column) => column.key),
  );

  ngAfterViewInit(): void {
    this.panel().nativeElement.focus();
  }

  ngOnDestroy(): void {
    if (this.opener?.isConnected) this.opener.focus();
  }

  protected isChosen(key: string): boolean {
    return this.chosen().includes(key);
  }

  protected isRequired(key: string): boolean {
    return this.required().includes(key);
  }

  protected toggle(key: string): void {
    if (this.isRequired(key)) return;
    const current = this.chosen();
    this.pending.set(current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
  }

  protected reset(): void {
    this.pending.set([...this.defaults()]);
  }

  protected commit(): void {
    const chosen = this.chosen();
    this.apply.emit(
      this.columns()
        .filter((column) => chosen.includes(column.key) || this.isRequired(column.key))
        .map((column) => column.key),
    );
    this.pending.set(null);
  }

  protected cancel(): void {
    this.pending.set(null);
    this.dismiss.emit();
  }
}
