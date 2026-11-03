import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
  type InputSignal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { Observable, Subscription } from 'rxjs';

import {
  CURRENT_USERNAME,
  TaskService,
  WorkflowService,
  taskDueDistance,
  type NuxeoTask,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsAvatarComponent } from '../avatar/avatar.component';
import type { NxsHeadingLevel } from '../heading-level';
import { NxsToastService, provideNxsToast } from '../toast/toast.service';
import {
  NxsUserGroupPickerComponent,
  type NxsPrincipal,
} from '../user-group-picker/user-group-picker.component';

/** The ID the tasks page renders this panel under, through `lib-extension-outlet`. */
export const NXS_TASK_DETAIL_ID = 'nxs.components.taskDetail';

/** How a task left the user's inbox: one of its actions was run, or its workflow was abandoned. */
export type NxsTaskOutcome = 'completed' | 'abandoned';

/** One of the actions a task offers, as Nuxeo returns it in `taskInfo.taskActions`. */
interface TaskAction {
  readonly name: string;
  readonly label: string;
}

/** A node of the workflow graph, as the panel lists it. */
interface GraphNode {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly isCurrent: boolean;
}

/** A comment recorded on the task. */
interface TaskComment {
  readonly author: string;
  readonly text: string;
  readonly date: string;
}

type Panel = 'delegate' | 'reassign' | null;
type Graph = { readonly status: 'loading' } | { readonly status: 'failed' } | GraphLoaded;
interface GraphLoaded {
  readonly status: 'loaded';
  readonly nodes: readonly GraphNode[];
}

const DUE_KEYS = {
  due: {
    one: 'satori-components.task-detail.due-in-days-one',
    many: 'satori-components.task-detail.due-in-days-many',
    hours: 'satori-components.task-detail.due-in-hours-many',
    underTwoHours: 'satori-components.task-detail.due-in-less-than-an-hour',
  },
  overdue: {
    one: 'satori-components.task-detail.overdue-days-one',
    many: 'satori-components.task-detail.overdue-days-many',
    hours: 'satori-components.task-detail.overdue-hours-many',
    underTwoHours: 'satori-components.task-detail.overdue-less-than-an-hour',
  },
} as const;

/** Nuxeo asks for an end date when participants are chosen; Web UI proposes five days out. */
const DEFAULT_DUE_DAYS = 5;

/**
 * One workflow task, and everything the user can do with it: run one of its actions, abandon its
 * workflow, delegate it, reassign it, and look at its workflow graph. A "choose participants" step
 * also asks for the participants and the review type, with `nxs-user-group-picker`.
 *
 * It writes through `TaskService` and `WorkflowService`, and tells the user the outcome in a toast.
 * It does not navigate and does not load the task: the host passes `task`, and is called back with
 * `taskDone` when the task has left the inbox and with `taskChanged` when its assignees changed, so
 * it can move on or fetch the task again.
 */
@Component({
  selector: 'nxs-task-detail',
  standalone: true,
  templateUrl: './task-detail.component.html',
  styleUrl: './task-detail.component.scss',
  providers: [provideNxsToast()],
  imports: [
    FormsModule,
    MatButtonModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTooltipModule,
    NxsAvatarComponent,
    NxsUserGroupPickerComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-task-detail' },
})
export class NxsTaskDetailComponent {
  private readonly taskService = inject(TaskService);
  private readonly workflowService = inject(WorkflowService);
  private readonly currentUsername = inject(CURRENT_USERNAME);
  private readonly toast = inject(NxsToastService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  /** The task to show, as `TaskService.getTask` or `getUserTasks` returns it. */
  readonly task = input.required<NuxeoTask>();
  /**
   * Called once the task has left the user's inbox: an action ran, or the workflow was abandoned.
   * The host moves on to another task.
   */
  readonly taskDone = input<(task: NuxeoTask, outcome: NxsTaskOutcome) => void>(() => undefined);
  /** Called after the task was delegated or reassigned, so the host can fetch it again. */
  readonly taskChanged = input<(task: NuxeoTask) => void>(() => undefined);
  /**
   * The level of the task's heading in the page outline. The delegate, reassign and graph panels
   * sit one level below it.
   */
  // Annotated rather than inferred, so the published API snapshot does not move with unrelated code.
  readonly headingLevel: InputSignal<NxsHeadingLevel> = input<NxsHeadingLevel>(3);

  private readonly taskId = computed(() => this.task().id);

  protected readonly panelHeadingLevel = computed(() => Math.min(this.headingLevel() + 1, 6));
  protected readonly actions = computed<readonly TaskAction[]>(
    () => this.task().taskInfo?.taskActions ?? [],
  );
  protected readonly choosesParticipants = computed(() => isChooseParticipants(this.task()));
  protected readonly actors = computed(() => (this.task().actors ?? []).map((actor) => actor.id));
  protected readonly delegatedActors = computed(() =>
    (this.task().delegatedActors ?? []).map((actor) => actor.id),
  );
  protected readonly comments = computed(() => (this.task().comments ?? []).map(toComment));
  protected readonly overdue = computed(() => {
    const due = this.task().dueDate;
    return !!due && new Date(due).getTime() < Date.now();
  });
  protected readonly dueLabel = computed<string>(() => {
    const due = this.task().dueDate;
    if (!due) return '';
    const { due: ahead, unit, count } = taskDueDistance(due);
    const keys = ahead ? DUE_KEYS.due : DUE_KEYS.overdue;
    const key =
      unit === 'days'
        ? count === 1
          ? keys.one
          : keys.many
        : unit === 'hours'
          ? keys.hours
          : keys.underTwoHours;
    return this.translate.instant(key, { count });
  });

  // Everything the user types belongs to one task, and starts again when the host shows another.
  protected readonly comment = linkedSignal({ source: this.taskId, computation: () => '' });
  protected readonly participants = linkedSignal<string, readonly NxsPrincipal[]>({
    source: this.taskId,
    computation: () => untracked(() => storedParticipants(this.task())),
  });
  protected readonly reviewType = linkedSignal({
    source: this.taskId,
    computation: () => 'simpleReview',
  });
  protected readonly panel = linkedSignal<string, Panel>({
    source: this.taskId,
    computation: () => null,
  });
  protected readonly assignees = linkedSignal<string, readonly NxsPrincipal[]>({
    source: this.taskId,
    computation: () => [],
  });
  protected readonly panelComment = linkedSignal({ source: this.taskId, computation: () => '' });
  protected readonly graph = linkedSignal<string, Graph | null>({
    source: this.taskId,
    computation: () => null,
  });

  protected readonly submitting = signal(false);

  private graphRequest?: Subscription;

  constructor() {
    this.destroyRef.onDestroy(() => this.graphRequest?.unsubscribe());
  }

  /** Runs one of the task's actions, with the comment and, for a participants step, the choices. */
  protected execute(action: TaskAction): void {
    const task = this.task();
    const variables: Record<string, unknown> = {};
    if (this.choosesParticipants()) {
      const chosen = this.participants().map((principal) => principal.prefixedId);
      variables['participants'] = chosen.length
        ? chosen
        : [`user:${this.currentUsername() ?? 'Administrator'}`];
      variables['end_date'] = endDate(task).toISOString();
      variables['validationOrReview'] = this.reviewType();
    }
    const comment = this.comment();
    if (comment) variables['comment'] = comment;

    this.submit(
      this.taskService.completeTask(task.id, action.name, variables, comment || undefined),
      () => {
        this.toast.show(this.translate.instant('satori-components.task-detail.task-completed'));
        this.taskService.notifyTasksChanged();
        this.taskDone()(task, 'completed');
      },
      (err) =>
        this.toast.error(
          serverMessage(err) ||
            this.translate.instant('satori-components.task-detail.complete-failed'),
        ),
    );
  }

  /** Cancels the workflow the task belongs to. */
  protected abandon(): void {
    const task = this.task();
    if (!task.workflowInstanceId) return;
    this.submit(
      this.workflowService.cancelWorkflow(task.workflowInstanceId),
      () => {
        this.toast.show(this.translate.instant('satori-components.task-detail.workflow-abandoned'));
        this.taskService.notifyTasksChanged();
        this.taskDone()(task, 'abandoned');
      },
      () =>
        this.toast.error(this.translate.instant('satori-components.task-detail.abandon-failed')),
    );
  }

  protected openPanel(panel: Exclude<Panel, null>): void {
    this.panel.set(panel);
    this.assignees.set([]);
    this.panelComment.set('');
  }

  protected closePanel(): void {
    this.panel.set(null);
    this.assignees.set([]);
    this.panelComment.set('');
  }

  protected setParticipants(value: NxsPrincipal | readonly NxsPrincipal[] | null): void {
    this.participants.set(asList(value));
  }

  protected setAssignees(value: NxsPrincipal | readonly NxsPrincipal[] | null): void {
    this.assignees.set(asList(value));
  }

  /** Delegates or reassigns the task to the users and groups chosen in the open panel. */
  protected confirmPanel(): void {
    const panel = this.panel();
    const actors = this.assignees().map((principal) => principal.prefixedId);
    if (!panel || actors.length === 0) return;
    const task = this.task();
    const comment = this.panelComment() || undefined;
    const delegate = panel === 'delegate';
    this.submit(
      delegate
        ? this.taskService.delegateTask(task.id, actors, comment)
        : this.taskService.reassignTask(task.id, actors, comment),
      () => {
        this.toast.show(
          this.translate.instant(
            delegate
              ? 'satori-components.task-detail.task-delegated'
              : 'satori-components.task-detail.task-reassigned',
          ),
        );
        this.closePanel();
        this.taskService.notifyTasksChanged();
        this.taskChanged()(task);
      },
      (err) =>
        this.toast.error(
          serverMessage(err) ||
            this.translate.instant(
              delegate
                ? 'satori-components.task-detail.delegate-failed'
                : 'satori-components.task-detail.reassign-failed',
            ),
        ),
    );
  }

  /** Shows the task's workflow graph, with the task's own node marked. */
  protected openGraph(): void {
    const task = this.task();
    if (!task.workflowInstanceId) return;
    this.graphRequest?.unsubscribe();
    this.graph.set({ status: 'loading' });
    this.graphRequest = this.workflowService
      .getWorkflowGraph(task.workflowInstanceId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          if (this.taskId() !== task.id) return;
          this.graph.set({ status: 'loaded', nodes: graphNodes(data, task.nodeName) });
        },
        error: () => {
          if (this.taskId() === task.id) this.graph.set({ status: 'failed' });
        },
      });
  }

  protected closeGraph(): void {
    this.graphRequest?.unsubscribe();
    this.graph.set(null);
  }

  /** The task's directive when it has one, else its name, as a title. */
  protected title(): string {
    const task = this.task();
    return humanise(task.directive || task.name);
  }

  protected actionLabel(action: TaskAction): string {
    return (action.label || action.name)
      .replace(/^wf\.\w+\./, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /** `primary` for an action that moves the task forward, `warn` for one that turns it back. */
  protected actionTone(action: TaskAction): 'primary' | 'warn' | '' {
    const name = action.name.toLowerCase();
    if (name.includes('reject') || name.includes('cancel')) return 'warn';
    if (name.includes('approve') || name.includes('validate') || name.includes('start')) {
      return 'primary';
    }
    return '';
  }

  protected principalLabel(id: string): string {
    return id.replace(/^(user:|group:)/, '');
  }

  protected initial(id: string): string {
    return this.principalLabel(id).charAt(0).toUpperCase();
  }

  private submit<T>(
    request: Observable<T>,
    done: () => void,
    failed: (err: unknown) => void,
  ): void {
    this.submitting.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.submitting.set(false);
        done();
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        failed(err);
      },
    });
  }
}

/** A "choose participants" step: it starts the review, or its name or directive says so. */
function isChooseParticipants(task: NuxeoTask): boolean {
  const name = (task.name || '').toLowerCase();
  const directive = (task.directive || '').toLowerCase();
  return (
    (task.taskInfo?.taskActions ?? []).some((action) => action.name === 'start_review') ||
    name.includes('chooseparticipants') ||
    name.includes('choose_participants') ||
    name.includes('choose participants') ||
    directive.includes('select') ||
    directive.includes('chooseparticipants')
  );
}

/** The participants already stored on the task, as the picker holds them. */
function storedParticipants(task: NuxeoTask): readonly NxsPrincipal[] {
  const stored = task.variables?.['participants'];
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((entry): entry is string => typeof entry === 'string' && entry !== '')
    .map((entry) => {
      const kind = entry.startsWith('group:') ? 'group' : 'user';
      const id = entry.replace(/^(user:|group:)/, '');
      return { id, label: id, kind, prefixedId: `${kind}:${id}` };
    });
}

/** The end date stored on the task, or the default a few days from now. */
function endDate(task: NuxeoTask): Date {
  const stored = task.variables?.['end_date'];
  if (typeof stored === 'string' && stored) return new Date(stored);
  const date = new Date();
  date.setDate(date.getDate() + DEFAULT_DUE_DAYS);
  return date;
}

function asList(value: NxsPrincipal | readonly NxsPrincipal[] | null): readonly NxsPrincipal[] {
  if (!value) return [];
  return 'prefixedId' in value ? [value] : value;
}

/** The message Nuxeo put in an error response body, if it put one there. */
function serverMessage(err: unknown): string {
  const message = (err as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === 'string' ? message : '';
}

/** Turns `wf.serialDocumentReview.chooseParticipants.title` into "Choose Participants". */
function humanise(raw: string): string {
  return raw
    .replace(/^wf\.\w+\./, '')
    .replace(/\.(title|directive)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\./g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Comments are objects with an author, a text and a date, or bare strings. */
function toComment(raw: unknown): TaskComment {
  if (typeof raw === 'string') return { author: '', text: raw, date: '' };
  const comment = (raw ?? {}) as Record<string, string | undefined>;
  return {
    author: comment['author'] ?? '',
    text: comment['text'] ?? comment['comment'] ?? '',
    date: comment['date'] ?? comment['creationDate'] ?? '',
  };
}

/** The nodes of a workflow graph, which Nuxeo lists under `nodes` or `elements`. */
function graphNodes(data: unknown, currentNode: string | undefined): readonly GraphNode[] {
  const graph = (data ?? {}) as Record<string, unknown>;
  const nodes = (graph['nodes'] ?? graph['elements'] ?? []) as Record<string, unknown>[];
  if (!Array.isArray(nodes)) return [];
  return nodes.map((node) => {
    const id = typeof node['id'] === 'string' ? node['id'] : '';
    const title = typeof node['title'] === 'string' ? node['title'] : id;
    return {
      id,
      title,
      state: typeof node['state'] === 'string' ? node['state'] : '',
      isCurrent: id !== '' && id === currentNode,
    };
  });
}
