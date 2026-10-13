import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  numberAttribute,
  output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Previous and Next for a list the server pages, with the range on screen.
 *
 * Next/previous rather than numbered, because Nuxeo knows a listing's total only when it fits on
 * one page: `@children` reports a negative count otherwise, and `isNextPageAvailable` is the only
 * reliable fact. So Next follows `hasNextPage`, Previous follows the page index, and "of N" shows
 * only when `totalSize` is a real, non-negative total.
 *
 * It renders nothing while everything fits on one page — a first page with no next page.
 */
@Component({
  selector: 'nxs-pager',
  standalone: true,
  templateUrl: './pager.component.html',
  styleUrl: './pager.component.scss',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-pager' },
})
export class NxsPagerComponent {
  /** The page on screen, from zero. */
  readonly pageIndex = input(0, { transform: numberAttribute });
  /** How many items a full page holds. */
  readonly pageSize = input(50, { transform: numberAttribute });
  /** How many items the page on screen holds. */
  readonly itemCount = input(0, { transform: numberAttribute });
  /** Every item across every page; negative when the server did not count them. */
  readonly totalSize = input(-1, { transform: numberAttribute });
  /** Whether the server has another page. */
  readonly hasNextPage = input(false, { transform: booleanAttribute });
  /** Disables both buttons while a page loads. */
  readonly disabled = input(false, { transform: booleanAttribute });
  /** The navigation landmark's accessible name, already translated. Blank names it "Pages". */
  readonly label = input('');

  /** The page index to load: one less or one more than `pageIndex`. */
  readonly pageChange = output<number>();

  protected readonly visible = computed(() => this.pageIndex() > 0 || this.hasNextPage());
  protected readonly first = computed(() =>
    this.itemCount() > 0 ? this.pageIndex() * this.pageSize() + 1 : 0,
  );
  protected readonly last = computed(() => this.pageIndex() * this.pageSize() + this.itemCount());
  protected readonly knownTotal = computed((): number | null => {
    const total = this.totalSize();
    return Number.isFinite(total) && total >= 0 ? total : null;
  });
  protected readonly canPrevious = computed(() => !this.disabled() && this.pageIndex() > 0);
  protected readonly canNext = computed(() => !this.disabled() && this.hasNextPage());
  protected readonly ownLabel = computed(() => this.label().trim());

  previous(): void {
    if (this.canPrevious()) this.pageChange.emit(this.pageIndex() - 1);
  }

  next(): void {
    if (this.canNext()) this.pageChange.emit(this.pageIndex() + 1);
  }
}
