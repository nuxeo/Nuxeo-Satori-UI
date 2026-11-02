import {
  Component,
  DestroyRef,
  LOCALE_ID,
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
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDividerModule } from '@angular/material/divider';

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
  CURRENT_USERNAME,
  trustObjectUrl,
  taskDueDistance,
} from '@nuxeo/satori-platform/nuxeo-client';

import {
  DocumentViewerComponent,
  provideSatoriDateAdapter,
  provideTranslatedDatepickerIntl,
} from '@nuxeo/satori-platform/ui';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import {
  NXS_PRIMITIVE_IDS,
  NxsBreadcrumbsComponent,
  type NxsBreadcrumbItem,
} from '@nuxeo/satori-platform/components';
import { SatHeaderBar } from '@hylandsoftware/satori-ui/header-bar';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

const DUE_LABEL_KEYS = {
  due: {
    one: 'tasks.due-label.due-in-days-one',
    many: 'tasks.due-label.due-in-days-many',
    hours: 'tasks.due-label.due-in-hours-many',
    underTwoHours: 'tasks.due-label.due-in-less-than-an-hour',
  },
  overdue: {
    one: 'tasks.due-label.overdue-days-one',
    many: 'tasks.due-label.overdue-days-many',
    hours: 'tasks.due-label.overdue-hours-many',
    underTwoHours: 'tasks.due-label.overdue-less-than-an-hour',
  },
} as const;

@Component({
  selector: 'lib-tasks-page',
  standalone: true,
  providers: [provideSatoriDateAdapter(), provideTranslatedDatepickerIntl()],
  imports: [
    TranslatePipe,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatTabsModule,
    MatDividerModule,
    DocumentViewerComponent,
    ExtensionOutletComponent,
    NxsBreadcrumbsComponent,
    SatHeaderBar,
  ],
  templateUrl: './tasks-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './tasks-page.component.scss',
})
export class TasksPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  readonly router = inject(Router);
  private readonly taskService = inject(TaskService);
  private readonly userService = inject(UserService);
  private readonly workflowService = inject(WorkflowService);
  private readonly docService = inject(DocumentService);
  private readonly nuxeoApi = inject(NuxeoApiBase);
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly currentUsername = inject(CURRENT_USERNAME);
  private readonly snackBar = inject(MatSnackBar);
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
  readonly submitting = signal(false);

  /**
   * Bumped on every task selection. `takeUntilDestroyed` cancels on teardown but not on *reselection*,
   * so without this a slow response for a previously selected task can land after a faster one and
   * overwrite `targetDoc` and the preview with stale content. Every async continuation below compares
   * the generation it captured against the current one and drops out if it has been superseded.
   */
  private selectionGeneration = 0;

  /* ─── Form fields ─── */
  comment = '';
  participants: string[] = [];
  participantInput = '';
  dueDate: Date | null = null;
  validationOrReview = 'simpleReview';

  /* ─── Delegate / Reassign dialogs ─── */
  readonly showDelegatePanel = signal(false);
  readonly showReassignPanel = signal(false);
  delegateInput = '';
  delegateActors: string[] = [];
  reassignInput = '';
  reassignActors: string[] = [];
  delegateComment = '';
  reassignComment = '';

  /* ─── Delegate/Reassign search results ─── */
  readonly delegateUserResults = signal<NuxeoUser[]>([]);
  readonly delegateGroupResults = signal<NuxeoGroup[]>([]);
  readonly reassignUserResults = signal<NuxeoUser[]>([]);
  readonly reassignGroupResults = signal<NuxeoGroup[]>([]);

  /* ─── View Graph ─── */
  readonly showGraphPanel = signal(false);
  readonly graphData = signal<unknown>(null);
  readonly graphLoading = signal(false);

  /* ─── User search ─── */
  readonly userResults = signal<NuxeoUser[]>([]);
  readonly groupResults = signal<NuxeoGroup[]>([]);
  readonly searching = signal(false);
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

  /** Actors assigned to the current task (from task actors list). */
  readonly taskActors = computed<string[]>(() => {
    const task = this.selectedTask();
    if (!task) return [];
    return (task.actors ?? []).map((a) => a.id);
  });

  get isChooseParticipants(): boolean {
    const t = this.selectedTask();
    if (!t) return false;
    const name = (t.name || '').toLowerCase();
    const directive = (t.directive || '').toLowerCase();
    const hasStartReview = (t.taskInfo?.taskActions ?? []).some((a) => a.name === 'start_review');
    return (
      hasStartReview ||
      name.includes('chooseparticipants') ||
      name.includes('choose_participants') ||
      name.includes('choose participants') ||
      directive.includes('select') ||
      directive.includes('chooseparticipants')
    );
  }

  get actions(): { name: string; label: string }[] {
    return this.selectedTask()?.taskInfo?.taskActions ?? [];
  }

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
    this.resetForm();
    this.router.navigate(['/tasks', task.id], { replaceUrl: true });

    const vars = task.variables ?? {};
    if (Array.isArray(vars['participants'])) {
      this.participants = vars['participants'] as string[];
    }
    if (vars['end_date']) {
      this.dueDate = new Date(vars['end_date'] as string);
    } else {
      const d = new Date();
      d.setDate(d.getDate() + 5);
      this.dueDate = d;
    }

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

  private resetForm(): void {
    this.comment = '';
    this.participants = [];
    this.participantInput = '';
    this.dueDate = null;
    this.validationOrReview = 'simpleReview';
    this.userResults.set([]);
    this.groupResults.set([]);
    this.closeDelegatePanel();
    this.closeReassignPanel();
    this.closeGraphPanel();
  }

  /* ════════════════════════════════════════════════════════
     User / Group Search
     ════════════════════════════════════════════════════════ */

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
        /* swallow */
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

  formatParticipant(id: string): string {
    return id.replace(/^(user:|group:)/, '');
  }

  /* ════════════════════════════════════════════════════════
     Task Actions
     ════════════════════════════════════════════════════════ */

  executeAction(action: { name: string; label: string }): void {
    const task = this.selectedTask();
    if (!task) return;

    this.submitting.set(true);
    const variables: Record<string, unknown> = {};

    if (this.isChooseParticipants) {
      variables['participants'] =
        this.participants.length > 0
          ? this.participants.map((p) => (p.includes(':') ? p : `user:${p}`))
          : [`user:${this.currentUsername() ?? 'Administrator'}`];
      if (this.dueDate) {
        variables['end_date'] = this.dueDate.toISOString();
      } else {
        // Nuxeo requires an end_date — default to 7 days from now
        const d = new Date();
        d.setDate(d.getDate() + 7);
        variables['end_date'] = d.toISOString();
      }
      if (this.validationOrReview) variables['validationOrReview'] = this.validationOrReview;
    }
    if (this.comment) variables['comment'] = this.comment;

    this.taskService
      .completeTask(task.id, action.name, variables, this.comment || undefined)
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.snackBar.open(
            this.translate.instant('tasks.message.task-completed-successfully'),
            this.translate.instant('common.close'),
            {
              duration: 4000,
            },
          );
          this.selectedTask.set(null);
          this.targetDoc.set(null);
          // Navigate to /tasks (no task ID) so loadTasks picks the next available task
          this.router.navigate(['/tasks'], { replaceUrl: true }).then(() => {
            this.loadTasks();
          });
          this.taskService.notifyTasksChanged();
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
    const task = this.selectedTask();
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
        this.selectedTask.set(null);
        this.targetDoc.set(null);
        this.router.navigate(['/tasks'], { replaceUrl: true }).then(() => {
          this.loadTasks();
        });
        this.taskService.notifyTasksChanged();
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

  /* ════════════════════════════════════════════════════════
     Delegate Task
     ════════════════════════════════════════════════════════ */

  openDelegatePanel(): void {
    this.showDelegatePanel.set(true);
    this.showReassignPanel.set(false);
  }

  closeDelegatePanel(): void {
    this.showDelegatePanel.set(false);
    this.delegateInput = '';
    this.delegateActors = [];
    this.delegateComment = '';
    this.delegateUserResults.set([]);
    this.delegateGroupResults.set([]);
  }

  searchDelegateUsers(): void {
    const q = this.delegateInput.trim();
    if (q.length < 2) {
      this.delegateUserResults.set([]);
      this.delegateGroupResults.set([]);
      return;
    }
    this.userService.searchUsers(q).subscribe({
      next: (users) => this.delegateUserResults.set(users),
      error: () => {
        /* swallow */
      },
    });
    this.userService.searchGroups(q).subscribe({
      next: (groups) => this.delegateGroupResults.set(groups),
      error: () => {
        /* swallow */
      },
    });
  }

  addDelegateActor(id: string): void {
    if (!this.delegateActors.includes(id)) {
      this.delegateActors = [...this.delegateActors, id];
    }
    this.delegateInput = '';
    this.delegateUserResults.set([]);
    this.delegateGroupResults.set([]);
  }

  removeDelegateActor(id: string): void {
    this.delegateActors = this.delegateActors.filter((a) => a !== id);
  }

  confirmDelegate(): void {
    const task = this.selectedTask();
    if (!task || this.delegateActors.length === 0) return;

    this.submitting.set(true);
    this.taskService
      .delegateTask(task.id, this.delegateActors, this.delegateComment || undefined)
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.snackBar.open(
            this.translate.instant('tasks.message.task-delegated-successfully'),
            this.translate.instant('common.close'),
            { duration: 4000 },
          );
          this.closeDelegatePanel();
          this.refreshCurrentTask();
          this.loadTasks();
          this.taskService.notifyTasksChanged();
        },
        error: (err) => {
          this.submitting.set(false);
          const msg =
            err?.error?.message || this.translate.instant('tasks.message.failed-to-delegate-task');
          this.snackBar.open(msg, this.translate.instant('common.close'), { duration: 6000 });
        },
      });
  }

  /* ════════════════════════════════════════════════════════
     Reassign Task
     ════════════════════════════════════════════════════════ */

  openReassignPanel(): void {
    this.showReassignPanel.set(true);
    this.showDelegatePanel.set(false);
  }

  closeReassignPanel(): void {
    this.showReassignPanel.set(false);
    this.reassignInput = '';
    this.reassignActors = [];
    this.reassignComment = '';
    this.reassignUserResults.set([]);
    this.reassignGroupResults.set([]);
  }

  searchReassignUsers(): void {
    const q = this.reassignInput.trim();
    if (q.length < 2) {
      this.reassignUserResults.set([]);
      this.reassignGroupResults.set([]);
      return;
    }
    this.userService.searchUsers(q).subscribe({
      next: (users) => this.reassignUserResults.set(users),
      error: () => {
        /* swallow */
      },
    });
    this.userService.searchGroups(q).subscribe({
      next: (groups) => this.reassignGroupResults.set(groups),
      error: () => {
        /* swallow */
      },
    });
  }

  addReassignActor(id: string): void {
    if (!this.reassignActors.includes(id)) {
      this.reassignActors = [...this.reassignActors, id];
    }
    this.reassignInput = '';
    this.reassignUserResults.set([]);
    this.reassignGroupResults.set([]);
  }

  removeReassignActor(id: string): void {
    this.reassignActors = this.reassignActors.filter((a) => a !== id);
  }

  confirmReassign(): void {
    const task = this.selectedTask();
    if (!task || this.reassignActors.length === 0) return;

    this.submitting.set(true);
    this.taskService
      .reassignTask(task.id, this.reassignActors, this.reassignComment || undefined)
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.snackBar.open(
            this.translate.instant('tasks.message.task-reassigned-successfully'),
            this.translate.instant('common.close'),
            { duration: 4000 },
          );
          this.closeReassignPanel();
          this.refreshCurrentTask();
          this.loadTasks();
          this.taskService.notifyTasksChanged();
        },
        error: (err) => {
          this.submitting.set(false);
          const msg =
            err?.error?.message || this.translate.instant('tasks.message.failed-to-reassign-task');
          this.snackBar.open(msg, this.translate.instant('common.close'), { duration: 6000 });
        },
      });
  }

  /* ════════════════════════════════════════════════════════
     View Graph
     ════════════════════════════════════════════════════════ */

  openGraphPanel(): void {
    const task = this.selectedTask();
    if (!task?.workflowInstanceId) return;

    this.showGraphPanel.set(true);
    this.graphLoading.set(true);
    this.graphData.set(null);

    this.workflowService.getWorkflowGraph(task.workflowInstanceId).subscribe({
      next: (data) => {
        this.graphData.set(data);
        this.graphLoading.set(false);
      },
      error: () => {
        this.graphData.set({ error: 'Failed to load graph' });
        this.graphLoading.set(false);
      },
    });
  }

  closeGraphPanel(): void {
    this.showGraphPanel.set(false);
    this.graphData.set(null);
  }

  /** Get graph node entries for rendering. */
  graphNodes(): { id: string; title: string; state: string; isCurrent: boolean }[] {
    const data = this.graphData() as Record<string, unknown> | null;
    if (!data || data['error']) return [];
    const nodes = (data['nodes'] ?? data['elements'] ?? []) as Record<string, unknown>[];
    const currentNode = this.selectedTask()?.nodeName;
    return nodes.map((n) => ({
      id: (n['id'] as string) ?? '',
      title: (n['title'] as string) ?? (n['id'] as string) ?? '',
      state: (n['state'] as string) ?? '',
      isCurrent: (n['id'] as string) === currentNode,
    }));
  }

  /* ════════════════════════════════════════════════════════
     Task Comments (from task.comments array)
     ════════════════════════════════════════════════════════ */

  get taskComments(): { author: string; text: string; date: string }[] {
    const task = this.selectedTask();
    if (!task?.comments) return [];
    // Comments can be objects {author, text, date} or plain strings
    return task.comments.map((c: unknown) => {
      if (typeof c === 'string') return { author: '', text: c, date: '' };
      const obj = c as Record<string, string>;
      return {
        author: obj['author'] ?? '',
        text: obj['text'] ?? obj['comment'] ?? '',
        date: obj['date'] ?? obj['creationDate'] ?? '',
      };
    });
  }

  /** Delegated actors on the current task. */
  get delegatedActorsList(): string[] {
    const task = this.selectedTask();
    if (!task?.delegatedActors) return [];
    return task.delegatedActors.map((a) => a.id);
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

  /* ════════════════════════════════════════════════════════
     Formatting Helpers
     ════════════════════════════════════════════════════════ */

  taskLabel(task: NuxeoTask): string {
    const key = task.name.replace(/^wf\.\w+\./, '').replace(/\.(title|directive)$/i, '');
    return key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\./g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  taskDirective(task: NuxeoTask): string {
    if (task.directive) {
      const d = task.directive.replace(/^wf\.\w+\./, '').replace(/\.(title|directive)$/i, '');
      return d
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\./g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return this.taskLabel(task);
  }

  taskWorkflow(task: NuxeoTask): string {
    const raw = task.workflowTitle || task.workflowModelName || '';
    const key = raw.replace(/^wf\.\w+\./, '');
    return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  dueDateFormatted(task: NuxeoTask): string {
    if (!task.dueDate) return '';
    return new Date(task.dueDate).toLocaleDateString(this.locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
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
    if (n.includes('approve') || n.includes('validate')) return 'circle_check';
    if (n.includes('reject')) return 'x_large';
    if (n.includes('start')) return 'triangle_right';
    if (n.includes('cancel')) return 'block';
    return 'send';
  }

  isOverdue(task: NuxeoTask): boolean {
    return !!task.dueDate && new Date(task.dueDate) < new Date();
  }

  dueLabel(task: NuxeoTask): string {
    if (!task.dueDate) return '';
    const { due, unit, count } = taskDueDistance(task.dueDate);
    const keys = due ? DUE_LABEL_KEYS.due : DUE_LABEL_KEYS.overdue;
    const key =
      unit === 'days'
        ? count === 1
          ? keys.one
          : keys.many
        : unit === 'hours'
          ? keys.hours
          : keys.underTwoHours;
    return this.translate.instant(key, { count });
  }

  docProp(key: string): unknown {
    return this.targetDoc()?.properties?.[key] ?? null;
  }
}
