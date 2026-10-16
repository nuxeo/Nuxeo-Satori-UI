import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CdkAriaLive } from '@angular/cdk/a11y';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { WidgetContainerComponent, WidgetGridComponent } from '@nuxeo-satori/platform/ui';
import type { CreateImportDialogResult } from '@agentic-ui/feature-browse';

import {
  NuxeoDocument,
  NuxeoTask,
  DocumentService,
  DocumentDetailService,
  TaskService,
  CollectionService,
  docTypeIcon,
  docTypeLabel,
  FOLDERISH_TYPES,
  avatarColor,
  formatRelativeTime,
} from '@nuxeo-satori/platform/nuxeo-client';
import { AuthService } from '../auth/auth.service';
import { SatTagModule } from '@hylandsoftware/satori-ui/tag';
import { SatAvatarModule } from '@hylandsoftware/satori-ui/avatar';
import {
  AiGatewayService,
  AiFeatureFlagService,
  aiErrorMessage,
  type Insight,
} from '@agentic-ui/shared/ai-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [
    TranslatePipe,
    DatePipe,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    CdkAriaLive,
    WidgetGridComponent,
    WidgetContainerComponent,
    SatTagModule,
    SatAvatarModule,
  ],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.scss',
})
export class DashboardPageComponent {
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly docService = inject(DocumentService);
  private readonly taskService = inject(TaskService);
  private readonly collectionService = inject(CollectionService);
  private readonly detailService = inject(DocumentDetailService);
  private readonly auth = inject(AuthService);
  private readonly aiGateway = inject(AiGatewayService);
  readonly featureFlags = inject(AiFeatureFlagService);

  readonly thumbnailMap = signal<Record<string, string | null>>({});

  readonly recentlyEdited = signal<NuxeoDocument[]>([]);
  readonly recentlyEditedLoading = signal(true);
  readonly recentlyEditedError = signal<string | null>(null);

  readonly tasks = signal<NuxeoTask[]>([]);
  readonly tasksLoading = signal(true);
  readonly tasksError = signal<string | null>(null);

  readonly recentlyViewed = signal<NuxeoDocument[]>([]);
  readonly recentlyViewedLoading = signal(true);
  readonly recentlyViewedError = signal<string | null>(null);

  readonly favorites = signal<NuxeoDocument[]>([]);
  readonly favoritesLoading = signal(true);
  readonly favoritesError = signal<string | null>(null);

  readonly aiInsights = signal<Insight[]>([]);
  readonly aiInsightsLoading = signal(true);
  readonly aiInsightsError = signal<string | null>(null);

  constructor() {
    this.destroyRef.onDestroy(() => this.revokeThumbnails());

    const userId = this.auth.username() ?? 'Administrator';

    this.docService.getRecentlyEdited(10).subscribe({
      next: (res) => {
        this.recentlyEdited.set(res.entries);
        this.recentlyEditedLoading.set(false);
        this.loadThumbnails(res.entries);
      },
      error: () => {
        this.recentlyEditedError.set(
          this.translate.instant('app.message.failed-to-load-recently-edited-documents'),
        );
        this.recentlyEditedLoading.set(false);
      },
    });

    this.taskService.getUserTasks(userId, 10).subscribe({
      next: (entries) => {
        this.tasks.set(entries);
        this.tasksLoading.set(false);
      },
      error: () => {
        this.tasksError.set(this.translate.instant('tasks.message.failed-to-load-tasks'));
        this.tasksLoading.set(false);
      },
    });

    this.docService.getRecentlyViewed(userId, 10).subscribe({
      next: (res) => {
        this.recentlyViewed.set(res.entries);
        this.recentlyViewedLoading.set(false);
        this.loadThumbnails(res.entries);
      },
      error: () => {
        this.recentlyViewedError.set(
          this.translate.instant('app.message.failed-to-load-recently-viewed-documents'),
        );
        this.recentlyViewedLoading.set(false);
      },
    });

    this.collectionService.getFavorites(userId, 10).subscribe({
      next: (res) => {
        this.favorites.set(res.entries);
        this.favoritesLoading.set(false);
        this.loadThumbnails(res.entries);
      },
      error: () => {
        this.favoritesError.set(
          this.translate.instant('app.message.failed-to-load-favorite-items'),
        );
        this.favoritesLoading.set(false);
      },
    });

    // The banner is already hidden by the same flag, but hiding it never stopped the request:
    // an opted-out user still had their dashboard sent to `AI.Insights` on every load.
    if (!this.featureFlags.aiEnabled()) {
      this.aiInsightsLoading.set(false);
      return;
    }

    this.aiGateway.getInsights(userId).subscribe({
      next: (res) => {
        this.aiInsights.set(res.insights);
        this.aiInsightsLoading.set(false);
      },
      error: (err) => {
        this.aiInsightsError.set(
          aiErrorMessage(err, this.translate.instant('app.message.ai-insights-unavailable')),
        );
        this.aiInsightsLoading.set(false);
      },
    });
  }

  navigateToDoc(doc: NuxeoDocument): void {
    if (doc.type === 'Collection') {
      void this.router.navigate(['/collections', doc.uid]);
      return;
    }

    if (FOLDERISH_TYPES.has(doc.type)) {
      void this.router.navigate(['/browse' + doc.path]);
      return;
    }

    void this.router.navigate(['/doc', doc.uid]);
  }

  openCreateImport(): void {
    void import('@agentic-ui/feature-browse').then((m) => {
      this.dialog
        .open(m.CreateImportDialogComponent, {
          width: '960px',
          height: '680px',
          maxWidth: '95vw',
          maxHeight: '95vh',
          data: {},
        })
        .afterClosed()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((result: CreateImportDialogResult | undefined) => {
          if (result?.navigateToUrl) {
            if (result.navigateToUrl.startsWith('/doc/')) {
              const uid = result.navigateToUrl.slice('/doc/'.length);
              void this.router.navigate(['/doc', uid], {
                queryParams: { fresh: '1' },
                state: {
                  freshBlobDocument: true,
                  freshNote: result.freshNote === true,
                },
              });
            } else {
              void this.router.navigateByUrl(result.navigateToUrl);
            }
            return;
          }
          const browsePath = result?.navigateToPath?.replace(/\/+$/, '');
          if (browsePath && browsePath !== '/') {
            void this.router.navigateByUrl(`/browse${browsePath}`);
            return;
          }
          if (result?.navigateToUid) {
            void this.router.navigate(['/doc', result.navigateToUid], {
              queryParams: { fresh: '1' },
              state: {
                freshBlobDocument: true,
                freshNote: result.freshNote === true,
              },
            });
            return;
          }
          if (result?.refreshed && result.path) {
            const parts = result.path.replace(/^\/+/, '').split('/').filter(Boolean);
            void this.router.navigate(['/browse', ...parts]);
          }
        });
    });
  }

  docIcon(doc: NuxeoDocument): string {
    return docTypeIcon(doc.type);
  }

  docTypeLabel(doc: NuxeoDocument): string {
    return docTypeLabel(doc.type ?? 'File', (key) => this.translate.instant(key));
  }

  lastContributor(doc: NuxeoDocument): string {
    return (doc.properties['dc:lastContributor'] as string) ?? '';
  }

  avatarColor(name: string) {
    return avatarColor(name);
  }

  taskLabel(task: NuxeoTask): string {
    const key = task.name.replace(/^wf\.\w+\./, '').replace(/\.(title|directive)$/i, '');
    return key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\./g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  taskDocTitle(task: NuxeoTask): string {
    return task.targetDocTitle ?? '';
  }

  taskWorkflow(task: NuxeoTask): string {
    const raw = task.workflowTitle || task.workflowModelName;
    const key = raw.replace(/^wf\.\w+\./, '');
    return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  isOverdue(task: NuxeoTask): boolean {
    return !!task.dueDate && new Date(task.dueDate) < new Date();
  }

  /**
   * Localised by `Intl.RelativeTimeFormat`, which also covers the future case this used to
   * spell as `in ${label}` — a positive offset produces "in 3 days" in each language's own
   * word order. See `formatRelativeTime`.
   */
  relativeTime(dateStr: string): string {
    return formatRelativeTime(dateStr, this.translate.currentLang);
  }

  goToTask(task: NuxeoTask): void {
    this.router.navigate(['/tasks', task.id]);
  }

  insightIcon(icon: string): string {
    const map: Record<string, string> = {
      task: 'assignment',
      document: 'description',
      warning: 'warning',
      info: 'info',
      workflow: 'account_tree',
    };
    return map[icon] ?? 'info';
  }

  insightPriorityColor(priority: string): string {
    return priority === 'high' ? '#d32f2f' : priority === 'medium' ? '#ed6c02' : '#2e7d32';
  }

  navigateToInsight(link: string): void {
    if (link) void this.router.navigateByUrl(link);
  }

  private loadThumbnails(docs: NuxeoDocument[]): void {
    for (const doc of docs) {
      if (this.thumbnailMap()[doc.uid]) continue;
      this.detailService
        .fetchThumbnail(doc.uid)
        // Both operators are load-bearing and both were missing. Without
        // `takeUntilDestroyed` the subscription outlives the component and writes to a
        // dead signal; without tracking the url for `revokeObjectURL` the blob is pinned
        // in memory for the life of the document. `loadThumbnails` is called from three
        // separate responses here, so a dashboard left open accumulated one un-revoked
        // blob per document per refresh.
        .pipe(
          catchError(() => of(null)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          this.thumbnailMap.update((m) => {
            const previous = m[doc.uid];
            if (previous && previous !== url) URL.revokeObjectURL(previous);
            return {
              ...m,
              [doc.uid]: url,
            };
          });
        });
    }
  }

  /**
   * Every blob URL currently owned by this page.
   *
   * `thumbnailMap` now stores the raw object-URL strings directly, so teardown derives from the map
   * itself and revokes each current entry on destroy.
   */
  private revokeThumbnails(): void {
    for (const url of Object.values(this.thumbnailMap())) if (url) URL.revokeObjectURL(url);
  }
}
