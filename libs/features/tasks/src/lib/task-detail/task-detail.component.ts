import {
  Component,
  DestroyRef,
  inject,
  signal,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import {
  NuxeoTask,
  NuxeoUser,
  NuxeoGroup,
  NuxeoDocument,
  TaskService,
  UserService,
  WorkflowService,
  DocumentService,
  NuxeoApiBase,
} from '@nuxeo/satori-platform/nuxeo-client';
import { SatHeaderBar } from '@hylandsoftware/satori-ui/header-bar';
import { SatTagModule } from '@hylandsoftware/satori-ui/tag';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  provideSatoriDateAdapter,
  provideTranslatedDatepickerIntl,
} from '@nuxeo/satori-platform/ui';

@Component({
  selector: 'lib-task-detail',
  standalone: true,
  providers: [provideSatoriDateAdapter(), provideTranslatedDatepickerIntl()],
  imports: [
    TranslatePipe,
    DatePipe,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatSnackBarModule,
    SatHeaderBar,
    SatTagModule,
  ],
  templateUrl: './task-detail.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './task-detail.component.scss',
})
export class TaskDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly taskService = inject(TaskService);
  private readonly userService = inject(UserService);
  private readonly workflowService = inject(WorkflowService);
  private readonly docService = inject(DocumentService);
  private readonly nuxeoApi = inject(NuxeoApiBase);
  private readonly snackBar = inject(MatSnackBar);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly task = signal<NuxeoTask | null>(null);
  readonly targetDoc = signal<NuxeoDocument | null>(null);
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly docLoading = signal(true);

  // Form fields
  comment = '';
  participants: string[] = [];
  participantInput = '';
  dueDate: Date | null = null;
  validationOrReview = 'simpleReview';

  // User search
  readonly userResults = signal<NuxeoUser[]>([]);
  readonly groupResults = signal<NuxeoGroup[]>([]);
  readonly searching = signal(false);

  /** Whether this task is a "choose participants" step. */
  get isChooseParticipants(): boolean {
    const t = this.task();
    if (!t) return false;
    const name = t.name.toLowerCase();
    return (
      name.includes('chooseparticipants') ||
      name.includes('choose_participants') ||
      name.includes('choose participants')
    );
  }

  /** Dynamic actions from the task (start_review, approve, reject, etc.). */
  get actions(): { name: string; label: string }[] {
    return this.task()?.taskInfo?.taskActions ?? [];
  }

  /** Whether the current task is overdue. */
  taskOverdue(): boolean {
    const t = this.task();
    return !!t?.dueDate && new Date(t.dueDate) < new Date();
  }

  constructor() {
    // The last preview must be revoked when the component goes away, not only when the
    // next one replaces it.
    this.destroyRef.onDestroy(() => this.clearPreview());
  }

  ngOnInit(): void {
    const taskId = this.route.snapshot.paramMap.get('taskId');
    if (!taskId) {
      this.error.set(this.translate.instant('tasks.message.no-task-id-provided'));
      this.loading.set(false);
      return;
    }
    this.loadTask(taskId);
  }

  private loadTask(taskId: string): void {
    this.loading.set(true);
    this.taskService.getTask(taskId).subscribe({
      next: (task) => {
        this.task.set(task);
        this.loading.set(false);

        // Pre-fill participants from task variables if present
        const vars = task.variables ?? {};
        if (Array.isArray(vars['participants'])) {
          this.participants = vars['participants'] as string[];
        }
        if (vars['end_date']) {
          this.dueDate = new Date(vars['end_date'] as string);
        } else {
          // Default: 5 days from now
          const d = new Date();
          d.setDate(d.getDate() + 5);
          this.dueDate = d;
        }

        // Fetch target document info
        const docId = task.targetDocumentIds?.[0]?.id;
        if (docId) {
          this.docLoading.set(true);
          this.docService.getById(docId).subscribe({
            next: (doc) => {
              this.targetDoc.set(doc);
              this.docLoading.set(false);
              this.loadPreview(doc);
            },
            error: () => this.docLoading.set(false),
          });
        } else {
          this.docLoading.set(false);
        }
      },
      error: () => {
        this.error.set(this.translate.instant('tasks.message.failed-to-load-task-details'));
        this.loading.set(false);
      },
    });
  }

  searchUsers(): void {
    const q = this.participantInput.trim();
    if (q.length < 2) {
      this.userResults.set([]);
      this.groupResults.set([]);
      return;
    }
    this.searching.set(true);
    this.userService.searchUsers(q).subscribe({
      next: (users) => {
        this.userResults.set(users);
        this.searching.set(false);
      },
      error: () => this.searching.set(false),
    });
    this.userService.searchGroups(q).subscribe({
      next: (groups) => this.groupResults.set(groups),
      error: () => {
        /* group search failed, ignore */
      },
    });
  }

  addParticipant(id: string): void {
    if (!this.participants.includes(id)) {
      this.participants = [...this.participants, id];
    }
    this.participantInput = '';
    this.userResults.set([]);
    this.groupResults.set([]);
  }

  removeParticipant(id: string): void {
    this.participants = this.participants.filter((p) => p !== id);
  }

  formatParticipantLabel(id: string): string {
    return id.replace(/^(user:|group:)/, '');
  }

  executeAction(action: { name: string; label: string }): void {
    const task = this.task();
    if (!task) return;

    this.submitting.set(true);
    const variables: Record<string, unknown> = {};

    if (this.isChooseParticipants) {
      // Format participants as Nuxeo expects
      variables['participants'] = this.participants.map((p) => (p.includes(':') ? p : `user:${p}`));
      if (this.dueDate) {
        variables['end_date'] = this.dueDate.toISOString();
      }
      if (this.validationOrReview) {
        variables['validationOrReview'] = this.validationOrReview;
      }
    }

    if (this.comment) {
      variables['comment'] = this.comment;
    }

    this.taskService
      .completeTask(task.id, action.name, variables, this.comment || undefined)
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.snackBar.open(
            this.translate.instant('tasks.task-completed', { name: this.taskLabel(task) }),
            this.translate.instant('common.close'),
            {
              duration: 4000,
            },
          );
          this.router.navigate(['/tasks']);
        },
        error: (err) => {
          this.submitting.set(false);
          const msg =
            err?.error?.message || this.translate.instant('tasks.message.failed-to-complete-task');
          this.snackBar.open(msg, this.translate.instant('common.close'), { duration: 6000 });
        },
      });
  }

  abandonWorkflow(): void {
    const task = this.task();
    if (!task?.workflowInstanceId) return;

    this.submitting.set(true);
    this.workflowService.cancelWorkflow(task.workflowInstanceId).subscribe({
      next: () => {
        this.submitting.set(false);
        this.snackBar.open(
          this.translate.instant('tasks.message.workflow-abandoned'),
          this.translate.instant('common.close'),
          { duration: 4000 },
        );
        this.router.navigate(['/tasks']);
      },
      error: () => {
        this.submitting.set(false);
        this.snackBar.open(
          this.translate.instant('tasks.message.failed-to-abandon-workflow'),
          this.translate.instant('common.close'),
          {
            duration: 4000,
          },
        );
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/tasks']);
  }

  taskLabel(task: NuxeoTask): string {
    const key = task.name.replace(/^wf\.\w+\./, '').replace(/\.(title|directive)$/i, '');
    return key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\./g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  taskWorkflow(task: NuxeoTask): string {
    const raw = task.workflowTitle || task.workflowModelName;
    const key = raw.replace(/^wf\.\w+\./, '');
    return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  actionLabel(action: { name: string; label: string }): string {
    const raw = action.label || action.name;
    const key = raw.replace(/^wf\.\w+\./, '');
    return key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  actionColor(action: { name: string }): string {
    const n = action.name.toLowerCase();
    if (n.includes('reject') || n.includes('cancel')) return 'warn';
    if (n.includes('approve') || n.includes('validate') || n.includes('start')) return 'primary';
    return '';
  }

  actionIcon(action: { name: string }): string {
    const n = action.name.toLowerCase();
    if (n.includes('approve') || n.includes('validate')) return 'check_circle';
    if (n.includes('reject')) return 'cancel';
    if (n.includes('start')) return 'play_arrow';
    if (n.includes('cancel')) return 'block';
    return 'send';
  }

  /**
   * The preview image, as a blob URL.
   *
   * This used to return the Nuxeo rendition URL directly for the template to put in
   * `<img [src]>`. That is the pattern CLAUDE.md forbids outright: the browser issues that
   * request itself, so it never passes through the HTTP interceptor and carries no
   * `Authorization` header — it worked only by falling back on an ambient session cookie,
   * and it put an internal API URL in the DOM where it is visible in devtools and leaks in
   * a referrer. `tasks-page.component.ts`, in this same library, already did it correctly.
   */
  readonly docPreviewUrl = signal<string | null>(null);

  /** Retained handle for revoking {@link docPreviewUrl} on destroy. */
  private rawPreviewUrl: string | null = null;

  private loadPreview(doc: NuxeoDocument): void {
    this.clearPreview();
    if (!this.hasVisualPreview()) return;

    this.http
      .get(this.nuxeoApi.apiUrl(`/nuxeo/api/v1/id/${doc.uid}/@rendition/thumbnail`), {
        responseType: 'blob',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.rawPreviewUrl = URL.createObjectURL(blob);
          this.docPreviewUrl.set(this.rawPreviewUrl);
        },
        // A document with no rendition is ordinary, not an error worth surfacing. The
        // template's `@if (docPreviewUrl())` already handles the absent case, which is why
        // the old `(error)` handler that hid the broken image by hand is gone.
        error: () => this.clearPreview(),
      });
  }

  private clearPreview(): void {
    if (this.rawPreviewUrl) {
      URL.revokeObjectURL(this.rawPreviewUrl);
      this.rawPreviewUrl = null;
    }
    this.docPreviewUrl.set(null);
  }

  /** URL for downloading the document's main file. */
  docDownloadUrl(): string | null {
    const doc = this.targetDoc();
    if (!doc) return null;
    return this.nuxeoApi.apiUrl(`/nuxeo/api/v1/id/${doc.uid}/@blob/file:content`);
  }

  /** True if the doc type is likely to have a visual preview. */
  hasVisualPreview(): boolean {
    const doc = this.targetDoc();
    if (!doc) return false;
    const type = doc.type?.toLowerCase() ?? '';
    return ['picture', 'file', 'video', 'note'].includes(type);
  }
}
