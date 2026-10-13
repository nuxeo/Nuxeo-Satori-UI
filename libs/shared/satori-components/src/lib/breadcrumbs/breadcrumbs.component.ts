import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import type { NxsBreadcrumbItem, NxsBreadcrumbsInputs } from '../primitives';
import { breadcrumbsToFold, type BreadcrumbFold } from './breadcrumb-fit';

/** One entry on the trail as drawn: an item, or the "…" button that holds the folded ones. */
type TrailEntry =
  | { readonly kind: 'item'; readonly item: NxsBreadcrumbItem; readonly index: number }
  | { readonly kind: 'overflow' };

/**
 * A breadcrumb trail — the Material implementation of `nxs.primitives.breadcrumbs`.
 *
 * It stays on one line. When the trail is wider than its box, the items after the first fold into
 * a "…" menu, furthest from the current page first, as Satori's do. The first stays while it fits
 * beside the "…" and the current page; in a box too narrow for that it folds too. The current page
 * always stays, its label cut short rather than hidden. A router item needs the host to provide
 * the router, as `routerLink` always does.
 */
@Component({
  selector: 'nxs-breadcrumbs',
  standalone: true,
  templateUrl: './breadcrumbs.component.html',
  styleUrl: './breadcrumbs.component.scss',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    RouterLink,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-breadcrumbs' },
})
export class NxsBreadcrumbsComponent implements NxsBreadcrumbsInputs {
  /**
   * The trail, outermost first. An item with `routerLink` navigates in the app, one with `href` is a
   * plain link, and one with neither is text — the current page, when it is the last.
   */
  readonly items = input.required<readonly NxsBreadcrumbItem[]>();
  /** The navigation landmark's accessible name, already translated, such as "Breadcrumbs". */
  readonly label = input('');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  /** The items folded into the "…" menu, as last measured. */
  protected readonly fold = signal<BreadcrumbFold>(
    { start: 1, count: 0 },
    { equal: (a, b) => a.start === b.start && a.count === b.count },
  );

  protected readonly hiddenItems = computed(() => {
    const items = this.items();
    const { start, count } = this.foldFor(items.length);
    return items.slice(start, start + count);
  });

  protected readonly entries = computed<readonly TrailEntry[]>(() => {
    const items = this.items();
    const { start, count } = this.foldFor(items.length);
    const entries: TrailEntry[] = items.map((item, index) => ({ kind: 'item', item, index }));
    if (count === 0) return entries;
    return [...entries.slice(0, start), { kind: 'overflow' }, ...entries.slice(start + count)];
  });

  constructor() {
    // Measured from a hidden copy of the whole trail, so a width that grows back unfolds items
    // without first having to show them to find out whether they fit.
    afterRenderEffect({
      earlyRead: () => {
        this.items();
        return this.measure();
      },
      write: (fold) => this.fold.set(fold()),
    });

    // The box changing width, and the trail's own width changing once a web font arrives.
    afterNextRender(() => {
      const remeasure = () => this.fold.set(this.measure());
      const fonts = this.host.nativeElement.ownerDocument.fonts as FontFaceSet | undefined;
      fonts?.addEventListener('loadingdone', remeasure);
      this.destroyRef.onDestroy(() => fonts?.removeEventListener('loadingdone', remeasure));
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(remeasure);
      observer.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected linkKind(item: NxsBreadcrumbItem): 'router' | 'href' | 'text' {
    if (item.routerLink !== undefined) return 'router';
    if (item.href !== undefined) return 'href';
    return 'text';
  }

  /** The last measurement, kept within a trail that may have shortened since. */
  private foldFor(length: number): BreadcrumbFold {
    const { start, count } = this.fold();
    if (length <= 2) return { start: 1, count: 0 };
    return { start, count: Math.min(count, length - 1 - start) };
  }

  private measure(): BreadcrumbFold {
    const host = this.host.nativeElement;
    const measured = host.querySelector('.nxs-breadcrumbs__measure');
    if (!measured) return { start: 1, count: 0 };
    // The gap between items is part of what each one costs, except after the last.
    const gap = parseFloat(getComputedStyle(measured).columnGap) || 0;
    const width = (element: Element | null) => element?.getBoundingClientRect().width ?? 0;
    const elements = [
      ...measured.querySelectorAll(
        ':scope > .nxs-breadcrumbs__item:not(.nxs-breadcrumbs__overflow-item)',
      ),
    ];
    const items = elements.map(
      (item, index) => width(item) + (index < elements.length - 1 ? gap : 0),
    );
    const overflow =
      width(measured.querySelector(':scope > .nxs-breadcrumbs__overflow-item')) + gap;
    // The stylesheet cuts the last label no shorter than 4em.
    const last = elements.at(-1);
    const lastMinimum = last ? 4 * parseFloat(getComputedStyle(last).fontSize) : Number.NaN;
    return breadcrumbsToFold(items, overflow, host.clientWidth, lastMinimum);
  }
}
