import {
  Component,
  DestroyRef,
  inject,
  signal,
  OnInit,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  NuxeoTask,
  NuxeoDocument,
  TaskService,
  DocumentService,
  NuxeoApiBase,
  CURRENT_USERNAME,
  trustObjectUrl,
} from '@nuxeo/satori-platform/nuxeo-client';

import { DocumentViewerComponent } from '@nuxeo/satori-platform/ui';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import {
  NXS_PRIMITIVE_IDS,
  NXS_TASK_DETAIL_ID,
  NxsBreadcrumbsComponent,
  NxsTaskDetailComponent,
  type NxsBreadcrumbItem,
} from '@nuxeo/satori-platform/components';
import { SatHeaderBar } from '@hylandsoftware/satori-ui/header-bar';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'lib-tasks-page',
  standalone: true,
  imports: [
    TranslatePipe,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    DocumentViewerComponent,
    ExtensionOutletComponent,
    NxsBreadcrumbsComponent,
    NxsTaskDetailComponent,
    SatHeaderBar,
  ],
  templateUrl: './tasks-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './tasks-page.component.scss',
})
export class TasksPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);
  readonly router = inject(Router);
  private readonly taskService = inject(TaskService);
  private readonly docService = inject(DocumentService);
  private readonly nuxeoApi = inject(NuxeoApiBase);
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly currentUsername = inject(CURRENT_USERNAME);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // The preview object URL was only revoked when the selection changed, so navigating away while
    // a preview was on screen leaked it for the lifetime of the tab. `review-guardrails.mjs` sees a
    // `revokeObjectURL` in this file and is satisfied; it cannot tell that no destroy path reaches
    // it. Pre-existing, and fixed here because this component's preview flow changed.
    this.destroyRef.onDestroy(() => this.clearPreviewBlob());
  }

  /* ─── Task list ─── */
  readonly tasks = signal<NuxeoTask[]>([]);
  readonly listLoading = signal(true);
  readonly listError = signal<string | null>(null);

  /* ─── Selected task & document ─── */
  readonly selectedTask = signal<NuxeoTask | null>(null);
  readonly targetDoc = signal<NuxeoDocument | null>(null);
  readonly previewBlobUrl = signal<SafeResourceUrl | null>(null);
  /**
   * The unwrapped object URL behind `previewBlobUrl`, forwarded to the viewer's `rawBlobUrl` for
   * its `SecurityContext.NONE` bindings (`source[src]`, `audio[src]`, `video[poster]`), where a
   * `SafeResourceUrl` stringifies instead of being unwrapped.
   */
  readonly rawPreviewUrl = signal<string | null>(null);
  /** `Blob.type` of the preview blob. See `DocumentViewerComponent.blobType`. */
  readonly previewBlobType = signal<string>('');
  readonly taskLoading = signal(false);
  readonly docLoading = signal(false);

  /**
   * Bumped on every task selection. `takeUntilDestroyed` cancels on teardown but not on *reselection*,
   * so without this a slow response for a previously selected task can land after a faster one and
   * overwrite `targetDoc` and the preview with stale content. Every async continuation below compares
   * the generation it captured against the current one and drops out if it has been superseded.
   */
  private selectionGeneration = 0;

  /** The task panel renders by ID, so an override of `nxs.components.taskDetail` reaches it. */
  protected readonly taskDetailId = NXS_TASK_DETAIL_ID;

  /** The task panel ran an action or abandoned the workflow: move on to the next task. */
  protected readonly onTaskDone = (): void => {
    this.selectedTask.set(null);
    this.targetDoc.set(null);
    // Navigate to /tasks (no task ID) so loadTasks picks the next available task
    void this.router.navigate(['/tasks'], { replaceUrl: true }).then(() => this.loadTasks());
  };

  /** The task panel delegated or reassigned the task: fetch it and the inbox again. */
  protected readonly onTaskChanged = (): void => {
    this.refreshCurrentTask();
    this.loadTasks();
  };

  private breadcrumbPathCache: string | null = null;
  private breadcrumbItemsCache: NxsBreadcrumbItem[] = [];
  /** The target document's trail renders by ID, so an override of `nxs.primitives.breadcrumbs` reaches it. */
  protected readonly breadcrumbsId = NXS_PRIMITIVE_IDS.breadcrumbs;

  /* ─── Computed ─── */
  readonly hasSelection = computed(() => this.selectedTask() !== null);
  readonly breadcrumbItems = computed<NxsBreadcrumbItem[]>(() => {
    const doc = this.targetDoc();
    if (!doc?.path) return [];

    if (doc.path === this.breadcrumbPathCache) {
      return this.breadcrumbItemsCache;
    }

    this.breadcrumbPathCache = doc.path;
    // Router links, so the trail routes itself in the app whichever component renders it,
    // including links Material folds into a menu outside its host.
    const parts = doc.path.split('/').filter(Boolean);
    this.breadcrumbItemsCache = parts.map((s, index) => ({
      label: decodeURIComponent(s),
      routerLink: ['/browse', ...parts.slice(0, index + 1)],
    }));
    return this.breadcrumbItemsCache;
  });

  /* ════════════════════════════════════════════════════════
     Lifecycle
     ════════════════════════════════════════════════════════ */

  ngOnInit(): void {
    this.loadTasks();
  }

  /* ════════════════════════════════════════════════════════
     Task List
     ════════════════════════════════════════════════════════ */

  loadTasks(): void {
    this.listLoading.set(true);
    this.listError.set(null);
    const userId = this.currentUsername() ?? 'Administrator';

    this.taskService.getUserTasks(userId, 50).subscribe({
      next: (entries) => {
        this.tasks.set(entries);
        this.listLoading.set(false);

        const taskId = this.route.snapshot.paramMap.get('taskId');
        if (taskId) {
          const found = entries.find((t) => t.id === taskId);
          if (found) this.selectTask(found);
          else this.loadAndSelectTask(taskId);
        } else if (entries.length > 0) {
          this.selectTask(entries[0]);
        }
      },
      error: () => {
        this.listError.set(this.translate.instant('tasks.message.failed-to-load-tasks'));
        this.listLoading.set(false);
      },
    });
  }

  selectTask(task: NuxeoTask): void {
    const gen = ++this.selectionGeneration;
    this.selectedTask.set(task);
    this.targetDoc.set(null);
    this.clearPreviewBlob();
    // Reset here, not only in the response handlers. A superseded response returns early on the
    // generation guard without clearing this, and a selection with no target document never starts
    // a request to clear it — so without this line, selecting a task with no document while another
    // is still loading leaves its "No document" placeholder stuck on "Loading...".
    this.docLoading.set(false);
    // `taskLoading` needs the same treatment, for the same reason, and did not get it when
    // `loadAndSelectTask` gained its generation guard: the superseded route response now returns at
    // the guard *before* reaching `taskLoading.set(false)`, so a click during a pending route load
    // left the page on its loading state permanently. The trap was already documented two lines up
    // for `docLoading`; the guard reintroduced it one field over.
    this.taskLoading.set(false);
    this.router.navigate(['/tasks', task.id], { replaceUrl: true });

    const targetRef = task.targetDocumentIds?.[0];
    const docId = targetRef?.uid || targetRef?.id;

    // If the enricher already provided a full document object, use it directly
    if (targetRef?.uid && targetRef?.title) {
      this.targetDoc.set({
        uid: targetRef.uid,
        title: targetRef.title,
        type: targetRef.type ?? '',
        path: targetRef.path ?? '',
        lastModified: '',
        properties: {},
      });
      // Still fetch full doc to get properties (file:content etc.) for preview
      this.fetchTargetDoc(targetRef.uid, gen);
    } else if (docId) {
      this.fetchTargetDoc(docId, gen);
    }
  }

  /**
   * Fetch the task's target document, ignoring the response if the selection has moved on.
   * @param gen the `selectionGeneration` captured when this fetch was requested
   */
  private fetchTargetDoc(docId: string, gen: number): void {
    this.docLoading.set(true);
    this.docService
      .getById(docId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (doc) => {
          if (gen !== this.selectionGeneration) return;
          this.targetDoc.set(doc);
          this.docLoading.set(false);
          this.loadPreviewBlob(doc, gen);
        },
        error: () => {
          if (gen !== this.selectionGeneration) return;
          this.docLoading.set(false);
        },
      });
  }

  private loadAndSelectTask(taskId: string): void {
    // Claims the selection before the request, so a click during it wins.
    //
    // `selectionGeneration` previously only covered work started *by* `selectTask`, and this route
    // request was not tied to it until its response arrived. So: route opens task A, the user clicks
    // task B while A is still loading, then A's response lands and calls `selectTask(A)` — silently
    // switching the user back to a task they had navigated away from.
    const gen = ++this.selectionGeneration;
    this.taskLoading.set(true);
    this.taskService
      .getTask(taskId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (task) => {
          if (gen !== this.selectionGeneration) return;
          this.taskLoading.set(false);
          this.selectTask(task);
        },
        error: () => {
          // Guarded too: a stale failure would otherwise clear the loading state of a newer selection.
          if (gen !== this.selectionGeneration) return;
          this.taskLoading.set(false);
        },
      });
  }

  /** Re-fetch the currently selected task to refresh its actors / state. */
  private refreshCurrentTask(): void {
    const current = this.selectedTask();
    if (!current) return;
    // Reads the generation without incrementing it: this refreshes the existing selection rather than
    // making a new one. The guard is still needed — the same defect as `loadAndSelectTask`, one method
    // down and not flagged in review: a refresh of task A landing after the user selected task B would
    // overwrite B with A.
    const gen = this.selectionGeneration;
    this.taskService
      .getTask(current.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          if (gen !== this.selectionGeneration) return;
          this.selectedTask.set(updated);
        },
        error: () => {
          /* keep current */
        },
      });
  }

  /* ════════════════════════════════════════════════════════
     URL Helpers
     ════════════════════════════════════════════════════════ */

  /** @param gen the `selectionGeneration` captured when this preview was requested */
  private loadPreviewBlob(doc: NuxeoDocument, gen: number): void {
    this.clearPreviewBlob();
    const fc = doc.properties?.['file:content'] as Record<string, unknown> | null;
    if (!fc) return;

    const mime = (fc['mime-type'] as string) ?? '';
    // Audio and video need the real blob, not a thumbnail image: the viewer dispatches on the
    // document's own MIME type, so a thumbnail rendition would be handed to <audio>/<video>.
    // Everything else that is not an image previews as a thumbnail image of itself.
    //
    // The `application/(g|m)xf` arm mirrors `DocumentViewerComponent.contentType`, which classifies
    // those broadcast containers as 'video'. Matching only `video/` here left them fetching a
    // thumbnail that the viewer then fed to <video>. If that classifier gains a MIME type, this
    // must follow — the two are coupled by the viewer's dispatch and nothing enforces it.
    const needsOwnBlob =
      /^image\//.test(mime) ||
      /^audio\//.test(mime) ||
      /^video\//.test(mime) ||
      /^application\/(g|m)xf$/.test(mime);
    const url = this.nuxeoApi.apiUrl(
      needsOwnBlob
        ? `/nuxeo/api/v1/id/${doc.uid}/@blob/file:content`
        : `/nuxeo/api/v1/id/${doc.uid}/@rendition/thumbnail`,
    );

    this.http
      .get(url, { responseType: 'blob' })
      // Without this, a request in flight when the component is destroyed still mints an object URL
      // — after the destroy hook that would have revoked it has already run.
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          // A response for a superseded selection must not install itself over the current preview.
          if (gen !== this.selectionGeneration) return;
          // Revoke whatever is currently held before replacing it, or the outgoing object URL leaks
          // for the lifetime of the document.
          this.clearPreviewBlob();
          const rawUrl = URL.createObjectURL(blob);
          this.rawPreviewUrl.set(rawUrl);
          // The served Content-Type, which is what gates the viewer's iframe branches.
          this.previewBlobType.set(blob.type);
          this.previewBlobUrl.set(trustObjectUrl(this.sanitizer, rawUrl));
        },
        error: () => {
          /* preview not available */
        },
      });
  }

  private clearPreviewBlob(): void {
    const raw = this.rawPreviewUrl();
    if (raw) {
      URL.revokeObjectURL(raw);
      this.rawPreviewUrl.set(null);
    }
    this.previewBlobType.set('');
    this.previewBlobUrl.set(null);
  }

  previewUrl(): SafeResourceUrl | null {
    return this.previewBlobUrl();
  }

  downloadUrl(): string | null {
    const doc = this.targetDoc();
    if (!doc) return null;
    return this.nuxeoApi.apiUrl(`/nuxeo/api/v1/id/${doc.uid}/@blob/file:content`);
  }

  download(): void {
    const url = this.downloadUrl();
    if (url) window.open(url, '_blank');
  }

  fileSize(): string {
    const doc = this.targetDoc();
    const content = doc?.properties?.['file:content'] as Record<string, unknown> | undefined;
    if (!content?.['length']) return '';
    const bytes = content['length'] as number;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  /** The document's own content type, from metadata. Describes the *document*, not what we fetched. */
  mimeType(): string {
    const doc = this.targetDoc();
    const fc = doc?.properties?.['file:content'] as Record<string, unknown> | undefined;
    return (fc?.['mime-type'] as string) ?? '';
  }

  /**
   * What to tell the viewer the blob *is* — the served type once a blob has arrived, metadata before.
   *
   * These genuinely differ here, and passing metadata was a live bug. `loadPreviewBlob` only fetches
   * the real blob for image/audio/video; for everything else it fetches `@rendition/thumbnail`, which
   * is an image. So a PDF task document handed the viewer `application/pdf` while the blob behind the
   * URL was a PNG. That was harmless-looking until the viewer began checking the served type, at
   * which point `contentType()` saw a PDF claim with a non-PDF blob and correctly refused to render
   * anything — the preview went blank.
   *
   * Describing the blob is also the more correct dispatch: the thumbnail now takes the `image` branch
   * and renders in `<img>` rather than being displayed inside an iframe.
   */
  viewerMimeType(): string {
    return this.previewBlobType() || this.mimeType();
  }

  fileName(): string {
    const doc = this.targetDoc();
    const content = doc?.properties?.['file:content'] as Record<string, unknown> | undefined;
    return (content?.['name'] as string) || doc?.title || '';
  }

  docProp(key: string): unknown {
    return this.targetDoc()?.properties?.[key] ?? null;
  }
}
