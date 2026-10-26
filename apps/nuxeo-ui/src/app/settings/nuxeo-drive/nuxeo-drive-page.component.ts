import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { SettingsService, type SynchronizationRootRow } from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './nuxeo-drive-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './nuxeo-drive-page.component.scss',
})
export class NuxeoDrivePageComponent {
  private readonly settingsService = inject(SettingsService);

  readonly title = 'Nuxeo Drive';

  readonly synchronizationRoots = signal<SynchronizationRootRow[]>([]);
  readonly synchronizationRootsLoading = signal(true);
  readonly synchronizationRootPendingIds = signal<string[]>([]);

  constructor() {
    this.loadSynchronizationRoots();
  }

  private loadSynchronizationRoots(): void {
    this.synchronizationRootsLoading.set(true);

    this.settingsService
      .getSynchronizationRoots()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (roots) => {
          this.synchronizationRoots.set(roots);
          this.synchronizationRootsLoading.set(false);
        },
        error: () => {
          this.synchronizationRoots.set([]);
          this.synchronizationRootsLoading.set(false);
        },
      });
  }

  removeSynchronizationRoot(root: SynchronizationRootRow): void {
    if (!root.id || this.isRootActionPending(root.id)) {
      return;
    }

    this.synchronizationRootPendingIds.update((ids) => [...ids, root.id]);

    this.settingsService
      .setSynchronizationRoot(root.id, false)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: () => {
          this.clearPendingRoot(root.id);
          this.loadSynchronizationRoots();
        },
        error: () => {
          this.clearPendingRoot(root.id);
        },
      });
  }

  isRootActionPending(rootId: string): boolean {
    return this.synchronizationRootPendingIds().includes(rootId);
  }

  private clearPendingRoot(rootId: string): void {
    this.synchronizationRootPendingIds.update((ids) => ids.filter((id) => id !== rootId));
  }
}
