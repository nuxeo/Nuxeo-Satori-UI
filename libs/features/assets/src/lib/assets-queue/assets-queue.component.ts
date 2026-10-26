import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MatIconModule } from '@angular/material/icon';
import {
  AssetAggregationService,
  DocumentDetailService,
  type AssetQueueItem,
} from '@nuxeo/satori-platform/nuxeo-client';
import { catchError, of } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'lib-assets-queue',
  standalone: true,
  imports: [TranslatePipe, MatIconModule],
  templateUrl: './assets-queue.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './assets-queue.component.scss',
})
export class AssetsQueueComponent {
  private readonly assetAggregationService = inject(AssetAggregationService);
  private readonly detailService = inject(DocumentDetailService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly objectUrls = new Map<string, string>();
  private readonly inFlight = new Set<string>();
  /**
   * The ids currently in `items()`, maintained by the effect below.
   *
   * Needed because a thumbnail response can arrive after its asset left the results, and the callback
   * has no other way to know that. Without it a late response minted a URL for an item no longer
   * displayed, which then had no render path and no revocation until teardown.
   */
  private activeIds = new Set<string>();

  readonly items = computed(() => this.assetAggregationService.items());
  readonly thumbnailMap = signal<Record<string, string | null>>({});
  readonly selectedItemId = input<string>('');
  readonly itemSelected = output<AssetQueueItem>();

  constructor() {
    effect(() => {
      const queueItems = this.items();
      const thumbnailMap = untracked(() => this.thumbnailMap());

      // Reconcile the ledger with the current results before fetching anything.
      //
      // This effect only ever ADDED. `objectUrls` and `thumbnailMap` kept every id they had ever seen
      // until `onDestroy`, and this component stays mounted across searches — so every prior result's
      // thumbnail blob was retained for the lifetime of the page, growing without bound. The
      // per-id revoke-before-replace below only covers re-fetching the SAME id; it never saw an id
      // that simply stopped being in the results.
      this.activeIds = new Set(queueItems.map((item) => item.id));
      for (const [id, url] of [...this.objectUrls]) {
        if (this.activeIds.has(id)) continue;
        URL.revokeObjectURL(url);
        this.objectUrls.delete(id);
      }
      const stale = Object.keys(thumbnailMap).filter((id) => !this.activeIds.has(id));
      if (stale.length > 0) {
        this.thumbnailMap.update((current) => {
          const next = { ...current };
          for (const id of stale) delete next[id];
          return next;
        });
      }

      for (const item of queueItems) {
        if (thumbnailMap[item.id] || this.inFlight.has(item.id)) continue;
        this.inFlight.add(item.id);
        this.detailService
          .fetchThumbnail(item.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .pipe(catchError(() => of(null)))
          .subscribe((blob) => {
            this.inFlight.delete(item.id);
            if (!blob) return;
            // Dropped if this id left the results while the request was in flight: minting here would
            // add a URL with no render path and no revocation until teardown.
            if (!this.activeIds.has(item.id)) return;

            const previousUrl = this.objectUrls.get(item.id);
            if (previousUrl) URL.revokeObjectURL(previousUrl);

            const url = URL.createObjectURL(blob);
            this.objectUrls.set(item.id, url);
            this.thumbnailMap.update((current) => ({
              ...current,
              [item.id]: url,
            }));
          });
      }
    });

    this.destroyRef.onDestroy(() => {
      for (const url of this.objectUrls.values()) {
        URL.revokeObjectURL(url);
      }
      this.objectUrls.clear();
      this.inFlight.clear();
    });
  }

  onItemClick(item: AssetQueueItem): void {
    this.itemSelected.emit(item);
  }

  thumbnailFor(id: string): string | null {
    return this.thumbnailMap()[id] ?? null;
  }
}
