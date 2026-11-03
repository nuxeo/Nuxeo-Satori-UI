import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import {
  CURRENT_USERNAME,
  DocumentDetailService,
  TaskService,
  UserService,
  WorkflowService,
  type NuxeoTask,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  ExtensionOutletComponent,
  provideSatoriExtensions,
} from '@nuxeo/satori-platform/extensions';
import { Subject, of, throwError } from 'rxjs';
import { vi, type Mock } from 'vitest';

import { NxsToastService } from '../toast/toast.service';
import {
  NxsUserGroupPickerComponent,
  type NxsPrincipal,
} from '../user-group-picker/user-group-picker.component';
import { NXS_TASK_DETAIL_ID, NxsTaskDetailComponent } from './task-detail.component';

const P = 'satori-components.task-detail';
const ENGLISH: Record<string, string> = {
  [`${P}.delegate`]: 'Delegate',
  [`${P}.reassign`]: 'Reassign',
  [`${P}.view-graph`]: 'View Graph',
  [`${P}.delegate-task`]: 'Delegate Task',
  [`${P}.reassign-task`]: 'Reassign Task',
  [`${P}.close`]: 'Close',
  [`${P}.cancel`]: 'Cancel',
  [`${P}.workflow-graph`]: 'Workflow Graph',
  [`${P}.graph-failed`]: 'Could not load the workflow graph.',
  [`${P}.no-graph-data`]: 'No graph data available',
  [`${P}.abandon-workflow`]: 'Abandon Workflow',
  [`${P}.comments`]: 'Comments',
  [`${P}.due-in-days-one`]: 'Due in 1 day',
  [`${P}.due-in-days-many`]: 'Due in {{ count }} days',
  [`${P}.due-in-hours-many`]: 'Due in {{ count }} hours',
  [`${P}.due-in-less-than-an-hour`]: 'Due in less than an hour',
  [`${P}.overdue-days-one`]: '1 day overdue',
  [`${P}.overdue-days-many`]: '{{ count }} days overdue',
  [`${P}.overdue-hours-many`]: '{{ count }} hours overdue',
  [`${P}.overdue-less-than-an-hour`]: 'less than an hour overdue',
  [`${P}.task-completed`]: 'Task completed successfully.',
  [`${P}.complete-failed`]: 'Failed to complete the task.',
  [`${P}.workflow-abandoned`]: 'Workflow abandoned.',
  [`${P}.abandon-failed`]: 'Failed to abandon workflow.',
  [`${P}.task-delegated`]: 'Task delegated successfully.',
  [`${P}.delegate-failed`]: 'Failed to delegate task.',
  [`${P}.task-reassigned`]: 'Task reassigned successfully.',
  [`${P}.reassign-failed`]: 'Failed to reassign task.',
  [`${P}.participants-required`]: 'Choose at least one participant.',
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const inFuture = (ms: number): string => new Date(Date.now() + ms).toISOString();

function makeTask(overrides: Partial<NuxeoTask> = {}): NuxeoTask {
  return {
    id: 'task-1',
    name: 'wf.parallelDocumentReview.documentReview',
    directive: 'wf.parallelDocumentReview.consolidateReview',
    workflowInstanceId: 'wf-1',
    workflowModelName: 'ParallelDocumentReview',
    workflowTitle: 'wf.parallelDocumentReview.ParallelDocumentReview',
    created: '2026-11-01T10:00:00.000Z',
    dueDate: inFuture(3 * DAY + HOUR),
    state: 'opened',
    nodeName: 'Task5a',
    targetDocumentIds: [{ uid: 'doc-1', title: 'Contract' }],
    actors: [{ id: 'jdoe' }, { id: 'group:legal' }],
    delegatedActors: [],
    comments: [],
    variables: {},
    taskInfo: {
      taskActions: [
        { name: 'approve', label: 'wf.parallelDocumentReview.approve' },
        { name: 'reject', label: 'wf.parallelDocumentReview.reject' },
        { name: 'comment', label: '' },
      ],
    },
    ...overrides,
  };
}

const CHOOSE: Partial<NuxeoTask> = {
  name: 'wf.serialDocumentReview.chooseParticipants',
  directive: 'wf.serialDocumentReview.pleaseSelect',
  taskInfo: {
    taskActions: [
      { name: 'cancel', label: 'wf.serialDocumentReview.cancel', validate: false },
      { name: 'start_review', label: 'wf.serialDocumentReview.startReview', validate: true },
    ],
  },
};

const principal = (kind: 'user' | 'group', id: string): NxsPrincipal => ({
  id,
  label: id,
  kind,
  prefixedId: `${kind}:${id}`,
});

/** The members the template uses, reached by element access. */
type Detail = Record<string, (...args: unknown[]) => unknown>;

describe('NxsTaskDetailComponent', () => {
  let fixture: ComponentFixture<NxsTaskDetailComponent>;
  let tasks: Record<string, Mock>;
  let workflows: Record<string, Mock>;
  let toastShow: Mock;
  let toastError: Mock;
  let taskDone: Mock;
  let taskChanged: Mock;
  const username = signal<string | null>('jdoe');

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const detail = (): Detail => fixture.componentInstance as unknown as Detail;
  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
  const pickers = (): NxsUserGroupPickerComponent[] =>
    fixture.debugElement
      .queryAll(By.directive(NxsUserGroupPickerComponent))
      .map((debug) => debug.componentInstance as NxsUserGroupPickerComponent);

  async function render(task: NuxeoTask = makeTask(), inputs: Record<string, unknown> = {}) {
    fixture.componentRef.setInput('task', task);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function click(label: string): Promise<void> {
    const target = button(label);
    expect(target, `a button labelled "${label}"`).toBeTruthy();
    target?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    tasks = {
      completeTask: vi.fn(() => of(makeTask())),
      delegateTask: vi.fn(() => of(undefined)),
      reassignTask: vi.fn(() => of(undefined)),
      notifyTasksChanged: vi.fn(),
    };
    workflows = {
      cancelWorkflow: vi.fn(() => of(undefined)),
      getWorkflowGraph: vi.fn(() => of({ nodes: [] })),
    };
    toastShow = vi.spyOn(NxsToastService.prototype, 'show').mockImplementation(() => undefined);
    toastError = vi.spyOn(NxsToastService.prototype, 'error').mockImplementation(() => undefined);
    taskDone = vi.fn();
    taskChanged = vi.fn();
    username.set('jdoe');

    await TestBed.configureTestingModule({
      imports: [NxsTaskDetailComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        { provide: TaskService, useValue: tasks },
        { provide: WorkflowService, useValue: workflows },
        { provide: CURRENT_USERNAME, useValue: username },
        {
          provide: UserService,
          useValue: { searchUsers: () => of([]), searchGroups: () => of([]) },
        },
        { provide: DocumentDetailService, useValue: { searchUsersGroups: () => of([]) } },
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).setTranslation('en', ENGLISH);
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(NxsTaskDetailComponent);
    fixture.componentRef.setInput('taskDone', taskDone);
    fixture.componentRef.setInput('taskChanged', taskChanged);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('what it shows', () => {
    it('titles the task with its directive, humanised, at the heading level it is given', async () => {
      await render(makeTask(), { headingLevel: 2 });
      const title = el().querySelector('.nxs-task-detail__title');
      expect(title?.textContent?.trim()).toBe('Consolidate Review');
      expect(title?.getAttribute('aria-level')).toBe('2');
    });

    it('falls back to the task name when it has no directive', async () => {
      await render(makeTask({ directive: '', name: 'wf.x.documentReview.title' }));
      expect(el().querySelector('.nxs-task-detail__title')?.textContent?.trim()).toBe(
        'Document Review',
      );
    });

    it('offers one button per action, classed by its tone for a theme to style', async () => {
      await render();
      expect(button('Approve')?.classList).toContain('nxs-task-detail__action--primary');
      expect(button('Reject')?.classList).toContain('nxs-task-detail__action--warn');
      const plain = button('Comment');
      expect(plain?.classList).not.toContain('nxs-task-detail__action--primary');
      expect(plain?.classList).not.toContain('nxs-task-detail__action--warn');
    });

    it('offers no action button when the task lists none', async () => {
      await render(makeTask({ taskInfo: undefined as unknown as NuxeoTask['taskInfo'] }));
      expect(el().querySelectorAll('.nxs-task-detail__actions button')).toHaveLength(0);
    });

    it('lists the actors and the delegated actors without their prefixes', async () => {
      await render(makeTask({ delegatedActors: [{ id: 'user:asmith' }] }));
      const lists = el().querySelectorAll('.nxs-task-detail__actors');
      expect(lists[0].textContent).toContain('jdoe');
      expect(lists[0].textContent).toContain('legal');
      expect(lists[0].textContent).not.toContain('group:');
      expect(lists[1].textContent).toContain('asmith');
    });

    it('shows no delegated list and no actors when the task has none', async () => {
      await render(makeTask({ actors: undefined as unknown as NuxeoTask['actors'] }));
      expect(el().querySelectorAll('.nxs-task-detail__actors')).toHaveLength(1);
      expect(el().querySelectorAll('.nxs-task-detail__actor')).toHaveLength(0);
    });

    it.each([
      [3 * DAY + HOUR, 'Due in 3 days', false],
      [DAY + HOUR, 'Due in 1 day', false],
      [5 * HOUR + 60_000, 'Due in 5 hours', false],
      [30 * 60_000, 'Due in less than an hour', false],
      [-(3 * DAY + HOUR), '3 days overdue', true],
      [-(DAY + HOUR), '1 day overdue', true],
      [-(5 * HOUR + 60_000), '5 hours overdue', true],
      [-30 * 60_000, 'less than an hour overdue', true],
    ])('says how far off the due date is (%d ms)', async (offset, label, overdue) => {
      await render(makeTask({ dueDate: inFuture(offset) }));
      const due = el().querySelector('.nxs-task-detail__due');
      expect(due?.textContent?.trim()).toBe(label);
      expect(due?.classList.contains('nxs-task-detail__due--overdue')).toBe(overdue);
    });

    it('shows no due line for a task without a due date', async () => {
      await render(makeTask({ dueDate: '' }));
      expect(el().querySelector('.nxs-task-detail__due')).toBeNull();
    });

    it('lists the comments recorded on the task, in any of the shapes Nuxeo returns', async () => {
      await render(
        makeTask({
          comments: [
            { author: 'jdoe', text: 'Looks good', date: '2026-11-02' },
            'A bare comment',
            { comment: 'From the alternate key', creationDate: '2026-11-03' },
          ] as unknown as NuxeoTask['comments'],
        }),
      );
      const items = Array.from(el().querySelectorAll('.nxs-task-detail__comment'));
      expect(items).toHaveLength(3);
      expect(items[0].querySelector('.nxs-task-detail__comment-author')?.textContent).toContain(
        'jdoe',
      );
      expect(items[0].querySelector('.nxs-task-detail__comment-date')?.textContent).toBe(
        '2026-11-02',
      );
      expect(items[1].querySelector('.nxs-task-detail__comment-header')).toBeNull();
      expect(items[1].textContent).toContain('A bare comment');
      expect(items[2].textContent).toContain('From the alternate key');
      expect(items[2].querySelector('.nxs-task-detail__comment-author')).toBeNull();
    });

    it('shows no comments section when the task has none', async () => {
      await render(makeTask({ comments: undefined as unknown as NuxeoTask['comments'] }));
      expect(el().querySelector('.nxs-task-detail__comments')).toBeNull();
    });

    it('asks for participants and a review type only on a choose-participants step', async () => {
      await render();
      expect(pickers()).toHaveLength(0);
      await render(makeTask(CHOOSE));
      expect(pickers()).toHaveLength(1);
      expect(el().querySelector('mat-select')).toBeTruthy();
    });

    it.each([
      ['its name', { name: 'wf.x.choose_participants', directive: '' }],
      ['its name, spaced', { name: 'Choose participants', directive: '' }],
      ['its name, camel-cased', { name: 'wf.x.chooseParticipants', directive: '' }],
      ['its directive', { name: 'wf.x.step', directive: 'wf.x.chooseParticipants' }],
    ])('recognises a choose-participants step by %s', async (_how, overrides) => {
      await render(makeTask({ ...overrides, taskInfo: { taskActions: [] } }));
      expect(pickers()).toHaveLength(1);
    });
  });

  describe('running an action', () => {
    it('completes the task with the action and the comment, then hands it back as done', async () => {
      const task = makeTask();
      await render(task);
      (fixture.componentInstance as unknown as { comment: { set(v: string): void } }).comment.set(
        'Fine by me',
      );
      await click('Approve');

      expect(tasks['completeTask']).toHaveBeenCalledWith(
        'task-1',
        'approve',
        { comment: 'Fine by me' },
        'Fine by me',
      );
      expect(toastShow).toHaveBeenCalledWith('Task completed successfully.');
      expect(tasks['notifyTasksChanged']).toHaveBeenCalled();
      expect(taskDone).toHaveBeenCalledWith(task, 'completed');
    });

    it('sends no comment when none was typed', async () => {
      await render();
      await click('Reject');
      expect(tasks['completeTask']).toHaveBeenCalledWith('task-1', 'reject', {}, undefined);
    });

    it('disables the actions while the request runs, and enables them when it lands', async () => {
      const response = new Subject<NuxeoTask>();
      tasks['completeTask'].mockReturnValue(response);
      await render();
      await click('Approve');
      expect(button('Approve')?.disabled).toBe(true);
      expect(button('Abandon Workflow')?.disabled).toBe(true);
      expect(el().querySelector('.nxs-task-detail__actions mat-spinner')).toBeTruthy();

      response.next(makeTask());
      response.complete();
      fixture.detectChanges();
      expect(button('Approve')?.disabled).toBe(false);
      expect(el().querySelector('.nxs-task-detail__actions mat-spinner')).toBeNull();
    });

    it("shows the server's reason when it refuses, keeps the task and enables the actions", async () => {
      tasks['completeTask'].mockReturnValue(
        throwError(() => ({ error: { message: 'Task already completed' } })),
      );
      await render();
      await click('Approve');
      expect(toastError).toHaveBeenCalledWith('Task already completed');
      expect(taskDone).not.toHaveBeenCalled();
      expect(tasks['notifyTasksChanged']).not.toHaveBeenCalled();
      expect(button('Approve')?.disabled).toBe(false);
    });

    it('says the task could not be completed when the refusal carries no reason', async () => {
      tasks['completeTask'].mockReturnValue(throwError(() => new Error('offline')));
      await render();
      await click('Approve');
      expect(toastError).toHaveBeenCalledWith('Failed to complete the task.');
    });

    it('sends the participants chosen, the end date stored on the task and the review type', async () => {
      await render(makeTask({ ...CHOOSE, variables: { end_date: '2026-12-01T00:00:00.000Z' } }));
      pickers()[0].value.set([principal('user', 'asmith'), principal('group', 'legal')]);
      (
        fixture.componentInstance as unknown as { reviewType: { set(v: string): void } }
      ).reviewType.set('validation');
      fixture.detectChanges();
      await click('Start Review');

      expect(tasks['completeTask']).toHaveBeenCalledWith(
        'task-1',
        'start_review',
        {
          participants: ['user:asmith', 'group:legal'],
          end_date: '2026-12-01T00:00:00.000Z',
          validationOrReview: 'validation',
        },
        undefined,
      );
    });

    it('assigns the current user, five days out, when no participant was chosen', async () => {
      await render(makeTask(CHOOSE));
      await click('Start Review');
      const variables = tasks['completeTask'].mock.calls[0][2] as Record<string, string>;
      expect(variables['participants']).toEqual(['user:jdoe']);
      expect(variables['validationOrReview']).toBe('simpleReview');
      const days = (new Date(variables['end_date']).getTime() - Date.now()) / DAY;
      expect(days).toBeGreaterThan(4.9);
      expect(days).toBeLessThan(5.1);
    });

    it('refuses, and says why, when nobody is chosen and nobody is signed in', async () => {
      username.set(null);
      await render(makeTask(CHOOSE));
      await click('Start Review');
      expect(tasks['completeTask']).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith('Choose at least one participant.');
      expect(button('Start Review')?.disabled).toBe(false);
    });

    it('cancels a participants step without choosing or sending participants', async () => {
      username.set(null);
      await render(makeTask(CHOOSE));
      await click('Cancel');
      expect(toastError).not.toHaveBeenCalled();
      expect(tasks['completeTask']).toHaveBeenCalledWith('task-1', 'cancel', {}, undefined);
    });

    it('starts from the participants already stored on the task', async () => {
      await render(
        makeTask({
          ...CHOOSE,
          variables: { participants: ['user:asmith', 'group:legal', 'bob', ''] },
        }),
      );
      expect(pickers()[0].value()).toEqual([
        principal('user', 'asmith'),
        principal('group', 'legal'),
        principal('user', 'bob'),
      ]);
    });

    it('ignores stored participants that are not a list', async () => {
      await render(makeTask({ ...CHOOSE, variables: { participants: 'user:asmith' } }));
      expect(pickers()[0].value()).toEqual([]);
    });

    it('starts again when the host shows another task, but not when it refreshes the same one', async () => {
      const instance = fixture.componentInstance as unknown as {
        comment: { (): string; set(v: string): void };
      };
      await render(makeTask(CHOOSE));
      instance.comment.set('half typed');
      pickers()[0].value.set([principal('user', 'asmith')]);
      fixture.detectChanges();

      await render(makeTask({ ...CHOOSE, actors: [{ id: 'jdoe' }, { id: 'asmith' }] }));
      expect(instance.comment()).toBe('half typed');
      expect(pickers()[0].value()).toEqual([principal('user', 'asmith')]);

      await render(makeTask({ ...CHOOSE, id: 'task-2' }));
      expect(instance.comment()).toBe('');
      expect(pickers()[0].value()).toEqual([]);
    });
  });

  describe('a write that lands after the host shows another task', () => {
    it('announces the completion but leaves the new task and the selection alone', async () => {
      const response = new Subject<NuxeoTask>();
      tasks['completeTask'].mockReturnValue(response);
      await render();
      await click('Approve');
      await render(makeTask({ id: 'task-2' }));
      expect(button('Approve')?.disabled).toBe(false);

      response.next(makeTask());
      fixture.detectChanges();
      expect(toastShow).toHaveBeenCalledWith('Task completed successfully.');
      expect(tasks['notifyTasksChanged']).toHaveBeenCalled();
      expect(taskDone).not.toHaveBeenCalled();
    });

    it("keeps the new task's busy state and open panel when an old delegation lands", async () => {
      const response = new Subject<void>();
      tasks['delegateTask'].mockReturnValue(response);
      await render();
      await click('Delegate');
      pickers()[0].value.set([principal('user', 'asmith')]);
      fixture.detectChanges();
      (el().querySelector('.nxs-task-detail__confirm') as HTMLButtonElement).click();

      await render(makeTask({ id: 'task-2' }));
      await click('Reassign');
      const slow = new Subject<NuxeoTask>();
      tasks['completeTask'].mockReturnValue(slow);
      await click('Approve');
      response.next();
      response.error(new Error('ignored after next'));
      fixture.detectChanges();

      expect(el().querySelector('[data-panel="reassign"]')).toBeTruthy();
      expect(button('Approve')?.disabled).toBe(true);
      expect(taskChanged).not.toHaveBeenCalled();
      expect(toastShow).toHaveBeenCalledWith('Task delegated successfully.');
    });

    it("drops an old failure's effect on the new task's busy state", async () => {
      const response = new Subject<void>();
      workflows['cancelWorkflow'].mockReturnValue(response);
      await render();
      await click('Abandon Workflow');
      await render(makeTask({ id: 'task-2' }));
      tasks['completeTask'].mockReturnValue(new Subject<NuxeoTask>());
      await click('Approve');
      response.error(new Error('403'));
      fixture.detectChanges();
      expect(toastError).toHaveBeenCalledWith('Failed to abandon workflow.');
      expect(button('Approve')?.disabled).toBe(true);
    });
  });

  describe('abandoning the workflow', () => {
    it('cancels the workflow behind the task, then hands the task back as abandoned', async () => {
      const task = makeTask();
      await render(task);
      await click('Abandon Workflow');
      expect(workflows['cancelWorkflow']).toHaveBeenCalledWith('wf-1');
      expect(toastShow).toHaveBeenCalledWith('Workflow abandoned.');
      expect(tasks['notifyTasksChanged']).toHaveBeenCalled();
      expect(taskDone).toHaveBeenCalledWith(task, 'abandoned');
    });

    it('says so when the workflow could not be abandoned, and keeps the task', async () => {
      workflows['cancelWorkflow'].mockReturnValue(throwError(() => new Error('403')));
      await render();
      await click('Abandon Workflow');
      expect(toastError).toHaveBeenCalledWith('Failed to abandon workflow.');
      expect(taskDone).not.toHaveBeenCalled();
      expect(button('Abandon Workflow')?.disabled).toBe(false);
    });

    it('offers neither abandon nor the graph for a task outside a workflow', async () => {
      await render(makeTask({ workflowInstanceId: '' }));
      expect(button('Abandon Workflow')).toBeUndefined();
      expect(button('View Graph')).toBeUndefined();
      detail()['abandon']();
      detail()['openGraph']();
      expect(workflows['cancelWorkflow']).not.toHaveBeenCalled();
      expect(workflows['getWorkflowGraph']).not.toHaveBeenCalled();
    });
  });

  describe.each([
    [
      'Delegate',
      'delegateTask',
      'Delegate Task',
      'Task delegated successfully.',
      'Failed to delegate task.',
    ],
    [
      'Reassign',
      'reassignTask',
      'Reassign Task',
      'Task reassigned successfully.',
      'Failed to reassign task.',
    ],
  ])('%s', (label, method, heading, done, failed) => {
    const panel = (): HTMLElement | null =>
      el().querySelector(`.nxs-task-detail__panel[data-panel="${label.toLowerCase()}"]`);
    const confirm = (): HTMLButtonElement | null => el().querySelector('.nxs-task-detail__confirm');

    it('opens a panel with its heading one level below the task title', async () => {
      await render();
      const opener = button(label);
      expect(opener?.getAttribute('aria-expanded')).toBe('false');
      await click(label);
      expect(opener?.getAttribute('aria-expanded')).toBe('true');
      const title = panel()?.querySelector('.nxs-task-detail__panel-title');
      expect(title?.textContent?.trim()).toBe(heading);
      expect(title?.getAttribute('aria-level')).toBe('4');
    });

    it('cannot be confirmed until someone is chosen', async () => {
      await render();
      await click(label);
      expect(confirm()?.disabled).toBe(true);
      detail()['confirmPanel']();
      expect(tasks[method]).not.toHaveBeenCalled();
    });

    it('sends the users and groups chosen with the comment, then asks the host to refresh', async () => {
      const task = makeTask();
      await render(task);
      await click(label);
      pickers()[0].value.set(principal('user', 'asmith'));
      (
        fixture.componentInstance as unknown as { panelComment: { set(v: string): void } }
      ).panelComment.set('While I am away');
      fixture.detectChanges();
      expect(confirm()?.disabled).toBe(false);
      confirm()?.click();
      fixture.detectChanges();

      expect(tasks[method]).toHaveBeenCalledWith('task-1', ['user:asmith'], 'While I am away');
      expect(toastShow).toHaveBeenCalledWith(done);
      expect(tasks['notifyTasksChanged']).toHaveBeenCalled();
      expect(taskChanged).toHaveBeenCalledWith(task);
      expect(panel()).toBeNull();
    });

    it("shows the server's reason, or says it failed, and keeps the panel open", async () => {
      tasks[method]
        .mockReturnValueOnce(throwError(() => ({ error: { message: 'Not allowed' } })))
        .mockReturnValueOnce(throwError(() => new Error('offline')));
      await render();
      await click(label);
      pickers()[0].value.set([principal('group', 'legal')]);
      fixture.detectChanges();

      confirm()?.click();
      expect(tasks[method]).toHaveBeenCalledWith('task-1', ['group:legal'], undefined);
      expect(toastError).toHaveBeenLastCalledWith('Not allowed');
      confirm()?.click();
      expect(toastError).toHaveBeenLastCalledWith(failed);
      fixture.detectChanges();
      expect(panel()).toBeTruthy();
      expect(taskChanged).not.toHaveBeenCalled();
    });

    it('closes from Cancel and from the close button, forgetting the choice', async () => {
      await render();
      await click(label);
      pickers()[0].value.set([principal('user', 'asmith')]);
      fixture.detectChanges();
      await click('Cancel');
      expect(panel()).toBeNull();

      await click(label);
      expect(pickers()[0].value()).toEqual([]);
      (panel()?.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(panel()).toBeNull();
    });
  });

  it('replaces the delegate panel with the reassign panel', async () => {
    await render();
    await click('Delegate');
    await click('Reassign');
    expect(el().querySelector('[data-panel="delegate"]')).toBeNull();
    expect(el().querySelector('[data-panel="reassign"]')).toBeTruthy();
  });

  describe('the workflow graph', () => {
    const graphPanel = (): HTMLElement | null => el().querySelector('[data-panel="graph"]');

    it('shows a spinner while the graph loads, then its nodes with the task’s own marked', async () => {
      const response = new Subject<unknown>();
      workflows['getWorkflowGraph'].mockReturnValue(response);
      await render();
      await click('View Graph');
      expect(workflows['getWorkflowGraph']).toHaveBeenCalledWith('wf-1');
      expect(graphPanel()?.querySelector('[role="status"] mat-spinner')).toBeTruthy();

      response.next({
        nodes: [
          { id: 'Task1', title: 'Choose participants', state: 'done' },
          { id: 'Task5a', title: 'Review' },
          { id: 'Task9' },
        ],
      });
      fixture.detectChanges();
      const nodes = Array.from(graphPanel()?.querySelectorAll('li') ?? []);
      expect(nodes.map((node) => node.textContent?.trim())).toEqual([
        'Choose participants',
        'Review',
        'Task9',
      ]);
      expect(nodes[0].classList).toContain('nxs-task-detail__graph-node--done');
      expect(nodes[1].getAttribute('aria-current')).toBe('step');
      expect(nodes[2].getAttribute('aria-current')).toBeNull();
    });

    it('reads the nodes from an `elements` key too', async () => {
      workflows['getWorkflowGraph'].mockReturnValue(
        of({ elements: [{ id: 'A', title: 'Start' }] }),
      );
      await render();
      await click('View Graph');
      expect(graphPanel()?.querySelector('li')?.textContent?.trim()).toBe('Start');
    });

    it.each([
      ['no nodes', { nodes: [] }],
      ['no graph at all', null],
      ['nodes that are not a list', { nodes: 'none' }],
    ])('says there is nothing to show for %s', async (_case, data) => {
      workflows['getWorkflowGraph'].mockReturnValue(of(data));
      await render();
      await click('View Graph');
      expect(graphPanel()?.textContent).toContain('No graph data available');
    });

    it('says the graph could not be loaded, as an alert', async () => {
      workflows['getWorkflowGraph'].mockReturnValue(throwError(() => new Error('500')));
      await render();
      await click('View Graph');
      expect(graphPanel()?.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
        'Could not load the workflow graph.',
      );
    });

    it('closes, and drops a response that lands for a task no longer shown', async () => {
      const response = new Subject<unknown>();
      workflows['getWorkflowGraph'].mockReturnValue(response);
      await render();
      await click('View Graph');
      await render(makeTask({ id: 'task-2' }));
      expect(graphPanel()).toBeNull();
      response.next({ nodes: [{ id: 'X', title: 'Stale' }] });
      response.error(new Error('late'));
      fixture.detectChanges();
      expect(graphPanel()).toBeNull();

      workflows['getWorkflowGraph'].mockReturnValue(of({ nodes: [{ id: 'A', title: 'Start' }] }));
      await click('View Graph');
      expect(graphPanel()).toBeTruthy();
      (graphPanel()?.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(graphPanel()).toBeNull();
    });

    it('stops listening for the graph when it is destroyed', async () => {
      const response = new Subject<unknown>();
      workflows['getWorkflowGraph'].mockReturnValue(response);
      await render();
      await click('View Graph');
      fixture.destroy();
      expect(response.observed).toBe(false);
    });
  });

  it('crosses the deadline on screen while the same task stays open', async () => {
    // A tick schedules change detection for every attached view, the suite's own fixture included.
    fixture.componentRef.setInput('task', makeTask());
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-03T10:00:00.000Z'));
      const clocked = TestBed.createComponent(NxsTaskDetailComponent);
      clocked.componentRef.setInput('task', makeTask({ dueDate: '2026-11-03T10:00:30.000Z' }));
      clocked.detectChanges();
      const due = (): Element | null =>
        (clocked.nativeElement as HTMLElement).querySelector('.nxs-task-detail__due');
      expect(due()?.textContent?.trim()).toBe('Due in less than an hour');
      expect(due()?.classList).not.toContain('nxs-task-detail__due--overdue');

      vi.advanceTimersByTime(60_000);
      clocked.detectChanges();
      expect(due()?.textContent?.trim()).toBe('less than an hour overdue');
      expect(due()?.classList).toContain('nxs-task-detail__due--overdue');
      clocked.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says the due line in the language the user switches to', async () => {
    await render();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('fr', {
      ...ENGLISH,
      [`${P}.due-in-days-many`]: 'Échéance dans {{ count }} jours',
    });
    translate.use('fr');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('.nxs-task-detail__due')?.textContent?.trim()).toBe(
      'Échéance dans 3 jours',
    );
  });

  it('caps the panel headings at level six', async () => {
    await render(makeTask(), { headingLevel: 6 });
    await click('Delegate');
    expect(el().querySelector('.nxs-task-detail__panel-title')?.getAttribute('aria-level')).toBe(
      '6',
    );
  });
});

@Component({
  standalone: true,
  imports: [ExtensionOutletComponent],
  template: `<lib-extension-outlet [componentId]="id" [componentInputs]="{ task }" />`,
})
class OutletHost {
  readonly id = NXS_TASK_DETAIL_ID;
  readonly task = makeTask();
}

describe(NXS_TASK_DETAIL_ID, () => {
  it('renders the panel wherever a host resolves the ID it is registered under', async () => {
    await TestBed.configureTestingModule({
      imports: [OutletHost],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        provideSatoriExtensions({ components: { [NXS_TASK_DETAIL_ID]: NxsTaskDetailComponent } }),
        { provide: TaskService, useValue: {} },
        { provide: WorkflowService, useValue: {} },
        { provide: CURRENT_USERNAME, useValue: signal('jdoe') },
        { provide: UserService, useValue: {} },
        { provide: DocumentDetailService, useValue: {} },
      ],
    }).compileComponents();
    const host = TestBed.createComponent(OutletHost);
    host.detectChanges();
    await host.whenStable();
    host.detectChanges();
    const rendered = (host.nativeElement as HTMLElement).querySelector(
      'lib-extension-outlet > nxs-task-detail',
    );
    expect(rendered?.querySelector('.nxs-task-detail__title')?.textContent?.trim()).toBe(
      'Consolidate Review',
    );
  });
});
