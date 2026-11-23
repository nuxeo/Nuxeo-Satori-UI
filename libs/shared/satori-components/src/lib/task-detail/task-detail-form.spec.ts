import {
  ChangeDetectionStrategy,
  Component,
  type DoCheck,
  input,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import {
  CURRENT_USERNAME,
  DocumentDetailService,
  TaskService,
  UserService,
  WorkflowService,
  type NuxeoTask,
} from '@nuxeo/satori-platform/nuxeo-client';
import { ExtensionComponentRegistry } from '@nuxeo/satori-platform/extensions';
import { Subject, of, throwError } from 'rxjs';
import { vi, type Mock } from 'vitest';

import { NxsToastService } from '../toast/toast.service';
import {
  NXS_TASK_FORM_ID,
  NxsTaskDetailComponent,
  type NxsTaskForm,
} from './task-detail.component';

// The panel with a task form: the component registered under NXS_TASK_FORM_ID draws the step's
// fields and hands the panel its form, which the panel validates, completes the task with, and
// gives the server's refusal to.

const P = 'satori-components.task-detail';
const ENGLISH: Record<string, string> = {
  [`${P}.task-completed`]: 'Task completed successfully.',
  [`${P}.complete-failed`]: 'Failed to complete the task.',
  [`${P}.participants`]: 'Participants',
};

function makeTask(overrides: Partial<NuxeoTask> = {}): NuxeoTask {
  return {
    id: 'task-1',
    name: 'wf.claims.determine',
    directive: 'Determine the claim',
    workflowInstanceId: 'wf-1',
    workflowModelName: 'claimDetermination',
    workflowTitle: 'Claim determination',
    created: '2026-11-01T10:00:00.000Z',
    dueDate: '',
    state: 'opened',
    nodeName: 'determine',
    targetDocumentIds: [{ uid: 'doc-1', title: 'CLM-1' }],
    actors: [{ id: 'jdoe' }],
    delegatedActors: [],
    comments: [],
    variables: {},
    taskInfo: {
      taskActions: [
        { name: 'approve', label: 'Approve', validate: true },
        { name: 'start_review', label: 'Start Review', validate: true },
        { name: 'cancel', label: 'Cancel', validate: false },
      ],
    },
    ...overrides,
  };
}

/** What the registered form was given, and the form it hands, which each test steers. */
const given = {
  tasks: [] as string[],
  disabled: [] as boolean[],
  headingLevels: [] as number[],
  onForm: null as ((form: NxsTaskForm | null) => void) | null,
};

@Component({
  selector: 'nxs-test-task-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<p class="acme-task-form">form for {{ task()?.id }}</p>`,
})
class AcmeTaskFormComponent implements DoCheck {
  readonly task = input<NuxeoTask | null>(null);
  readonly disabled = input(false);
  readonly headingLevel = input(0);
  readonly onForm = input<((form: NxsTaskForm | null) => void) | null>(null);
  ngDoCheck(): void {
    const id = this.task()?.id;
    if (id && given.tasks.at(-1) !== id) given.tasks.push(id);
    if (given.disabled.at(-1) !== this.disabled()) given.disabled.push(this.disabled());
    if (given.headingLevels.at(-1) !== this.headingLevel())
      given.headingLevels.push(this.headingLevel());
    given.onForm = this.onForm();
  }
}

describe('NxsTaskDetailComponent, with a task form', () => {
  let fixture: ComponentFixture<NxsTaskDetailComponent>;
  let completeTask: Mock;
  let toastError: Mock;
  let taskDone: Mock;
  let form: { validate: Mock; variables: Mock; showFailure: Mock };

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  async function render(task: NuxeoTask = makeTask()) {
    fixture.componentRef.setInput('task', task);
    await settle();
  }
  async function hand(handed: NxsTaskForm | null = form) {
    given.onForm?.(handed);
    await settle();
  }
  async function click(label: string) {
    const target = button(label);
    expect(target, `a button labelled "${label}"`).toBeTruthy();
    target?.click();
    await settle();
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    given.tasks = [];
    given.disabled = [];
    given.headingLevels = [];
    given.onForm = null;
    completeTask = vi.fn(() => of(makeTask()));
    form = {
      validate: vi.fn(() => true),
      variables: vi.fn(() => ({ decision: 'approve', allowedAmount: 900 })),
      showFailure: vi.fn(() => null),
    };
    vi.spyOn(NxsToastService.prototype, 'show').mockImplementation(() => undefined);
    toastError = vi.spyOn(NxsToastService.prototype, 'error').mockImplementation(() => undefined);
    taskDone = vi.fn();
    await TestBed.configureTestingModule({
      imports: [NxsTaskDetailComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        {
          provide: TaskService,
          useValue: { completeTask, notifyTasksChanged: vi.fn() },
        },
        { provide: WorkflowService, useValue: {} },
        { provide: CURRENT_USERNAME, useValue: signal('jdoe') },
        {
          provide: UserService,
          useValue: { searchUsers: () => of([]), searchGroups: () => of([]) },
        },
        { provide: DocumentDetailService, useValue: { searchUsersGroups: () => of([]) } },
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).setTranslation('en', ENGLISH);
    TestBed.inject(TranslateService).use('en');
    TestBed.inject(ExtensionComponentRegistry).register({
      [NXS_TASK_FORM_ID]: AcmeTaskFormComponent,
    });
    fixture = TestBed.createComponent(NxsTaskDetailComponent);
    fixture.componentRef.setInput('taskDone', taskDone);
  });

  afterEach(() => vi.restoreAllMocks());

  it('draws the registered task form, given the task', async () => {
    await render();
    expect(el().querySelector('.acme-task-form')?.textContent).toContain('form for task-1');
    expect(given.tasks).toEqual(['task-1']);
  });

  it('completes the task with the form’s variables and the comment, once the form passes', async () => {
    await render();
    await hand();
    (fixture.componentInstance as unknown as { comment: { set(v: string): void } }).comment.set(
      'Within policy',
    );
    await click('Approve');
    expect(form.validate).toHaveBeenCalled();
    expect(completeTask).toHaveBeenCalledWith(
      'task-1',
      'approve',
      { decision: 'approve', allowedAmount: 900, comment: 'Within policy' },
      'Within policy',
    );
    expect(taskDone).toHaveBeenCalled();
  });

  it('sends nothing while the form says its values are not ready', async () => {
    form.validate.mockReturnValue(false);
    await render();
    await hand();
    await click('Approve');
    expect(completeTask).not.toHaveBeenCalled();
    expect(form.variables).not.toHaveBeenCalled();
  });

  it('skips the form for an action that skips it, such as Cancel', async () => {
    form.validate.mockReturnValue(false);
    await render();
    await hand();
    await click('Cancel');
    expect(form.validate).not.toHaveBeenCalled();
    expect(completeTask).toHaveBeenCalledWith('task-1', 'cancel', {}, undefined);
  });

  it('puts the form in place of the participants fields, which it does not send', async () => {
    // A step whose action starts a review is a participants step to the panel's own form.
    await render();
    expect(el().querySelector('nxs-user-group-picker')).not.toBeNull();
    await hand();
    expect(el().querySelector('nxs-user-group-picker')).toBeNull();
    await click('Start Review');
    expect(completeTask).toHaveBeenCalledWith(
      'task-1',
      'start_review',
      { decision: 'approve', allowedAmount: 900 },
      undefined,
    );
  });

  it('gives the server’s refusal to the form, and says what it could not place', async () => {
    const refusal = { status: 400, error: { message: 'Constraint violation' } };
    completeTask.mockReturnValue(throwError(() => refusal));
    form.showFailure.mockReturnValue(['The step needs a reviewer.']);
    await render();
    await hand();
    await click('Approve');
    expect(form.showFailure).toHaveBeenCalledWith(refusal);
    expect(toastError).toHaveBeenCalledWith('The step needs a reviewer.');
    expect(taskDone).not.toHaveBeenCalled();
  });

  it('says the task was not completed when the form placed every message beside its field', async () => {
    completeTask.mockReturnValue(throwError(() => ({ status: 400, error: { message: 'x' } })));
    form.showFailure.mockReturnValue([]);
    await render();
    await hand();
    await click('Approve');
    expect(toastError).toHaveBeenCalledWith('Failed to complete the task.');
  });

  it('says the server’s own reason for a failure that is not a validation failure', async () => {
    completeTask.mockReturnValue(
      throwError(() => ({ error: { message: 'Task already completed' } })),
    );
    await render();
    await hand();
    await click('Approve');
    expect(toastError).toHaveBeenCalledWith('Task already completed');
  });

  it('tells the form while the request runs', async () => {
    const response = new Subject<NuxeoTask>();
    completeTask.mockReturnValue(response);
    await render();
    await hand();
    await click('Approve');
    expect(given.disabled.at(-1)).toBe(true);
    response.next(makeTask());
    response.complete();
    await settle();
    expect(given.disabled.at(-1)).toBe(false);
  });

  it('never takes a form handed for another task: the panel’s own fields show for the new one', async () => {
    await render();
    const forFirst = given.onForm;
    await render(makeTask({ id: 'task-2' }));
    forFirst?.(form);
    await settle();
    expect(el().querySelector('nxs-user-group-picker')).not.toBeNull();
    await click('Start Review');
    expect(form.validate).not.toHaveBeenCalled();
  });

  it('never puts a refusal that lands after the host moved on on the next task’s form', async () => {
    const response = new Subject<NuxeoTask>();
    completeTask.mockReturnValue(response);
    await render();
    await hand();
    await click('Approve');
    await render(makeTask({ id: 'task-2' }));
    await hand();
    response.error({ status: 422, error: { message: 'Constraint violation' } });
    await settle();
    expect(form.showFailure).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Constraint violation');
  });

  it('lets a late call for an earlier task neither hand nor withdraw the current one’s form', async () => {
    await render();
    const forFirst = given.onForm;
    await render(makeTask({ id: 'task-2' }));
    await hand();
    forFirst?.(null);
    await settle();
    expect(el().querySelector('nxs-user-group-picker')).toBeNull();
    await click('Approve');
    expect(form.validate).toHaveBeenCalled();
  });

  it('gives the form the heading level one below the task’s', async () => {
    fixture.componentRef.setInput('headingLevel', 2);
    await render();
    expect(given.headingLevels.at(-1)).toBe(3);
  });

  it('goes back to its own fields when the form is withdrawn', async () => {
    await render();
    await hand();
    await hand(null);
    expect(el().querySelector('nxs-user-group-picker')).not.toBeNull();
  });
});
