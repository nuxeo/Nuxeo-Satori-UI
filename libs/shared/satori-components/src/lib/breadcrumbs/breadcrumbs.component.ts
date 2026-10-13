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
import { breadcrumbsToFold } from './breadcrumb-fit';

/** One entry on the trail as drawn: an item, or the "…" button that holds the folded ones. */
type TrailEntry =
  | { readonly kind: 'item'; readonly item: NxsBreadcrumbItem; readonly index: number }
  | { readonly kind: 'overflow' };

/**
 * A breadcrumb trail — the Material implementation of `nxs.primitives.breadcrumbs`.
 *
 * It stays on one line. When the trail is wider than its box, the items after the first fold into
 * a "…" menu, furthest from the current page first, as Satori's do; the first and the last always
 * stay, and when even they do not fit the last one's label is cut short rather than hidden. A
 * router item needs the host to provide the router, as `routerLink` always does.
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
  /** How many items, from the second, are folded into the "…" menu. */
  protected readonly folded = signal(0);

  protected readonly hiddenItems = computed(() => {
    const items = this.items();
    return items.slice(1, 1 + this.foldable(items.length));
  });

  protected readonly entries = computed<readonly TrailEntry[]>(() => {
    const items = this.items();
    const folded = this.foldable(items.length);
    const entries: TrailEntry[] = items.map((item, index) => ({ kind: 'item', item, index }));
    if (folded === 0) return entries;
    return [entries[0], { kind: 'overflow' }, ...entries.slice(1 + folded)];
  });

  constructor() {
    // Measured from a hidden copy of the whole trail, so a width that grows back unfolds items
    // without first having to show them to find out whether they fit.
    afterRenderEffect({
      earlyRead: () => {
        this.items();
        return this.measure();
      },
      write: (fold) => this.folded.set(fold()),
    });

    // The box changing width, and the trail's own width changing once a web font arrives.
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => this.folded.set(this.measure()));
      observer.observe(this.host.nativeElement);
      const measured = this.host.nativeElement.querySelector('.nxs-breadcrumbs__measure');
      if (measured) observer.observe(measured);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected linkKind(item: NxsBreadcrumbItem): 'router' | 'href' | 'text' {
    if (item.routerLink !== undefined) return 'router';
    if (item.href !== undefined) return 'href';
    return 'text';
  }

  private foldable(count: number): number {
    return Math.min(this.folded(), Math.max(0, count - 2));
  }

  private measure(): number {
    const host = this.host.nativeElement;
    const measured = host.querySelector('.nxs-breadcrumbs__measure');
    if (!measured) return 0;
    // The gap between items is part of what each one costs, except after the last.
    const gap = parseFloat(getComputedStyle(measured).columnGap) || 0;
    const width = (element: Element | null) => element?.getBoundingClientRect().width ?? 0;
    const items = [
      ...measured.querySelectorAll(
        ':scope > .nxs-breadcrumbs__item:not(.nxs-breadcrumbs__overflow-item)',
      ),
    ].map((item, index, all) => width(item) + (index < all.length - 1 ? gap : 0));
    const overflow =
      width(measured.querySelector(':scope > .nxs-breadcrumbs__overflow-item')) + gap;
    return breadcrumbsToFold(items, overflow, host.clientWidth);
  }
}
