import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { TaskService, CURRENT_USERNAME, type NuxeoTask } from '@nuxeo/satori-platform/nuxeo-client';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

import { TaskListComponent } from './task-list.component';

describe('TaskListComponent', () => {
  let component: TaskListComponent;
  let fixture: ComponentFixture<TaskListComponent>;
  let mockTaskService: { getUserTasks: ReturnType<typeof vi.fn> };
  let mockRouter: { navigate: ReturnType<typeof vi.fn> };
  /** Who is signed in, read through `CURRENT_USERNAME` on each call so a test can change it. */
  let currentUsername: string | null;

  /**
   * A complete `NuxeoTask`.
   *
   * These fixtures used to be bare object literals, which typechecked only because Vitest strips
   * types through esbuild — `dueDate: null` is not assignable to the model's `dueDate: string`, and
   * every required field was missing. An absent deadline is `''` in the type, which is what the
   * component's `!!task.dueDate` guard absorbs.
   */
  function task(over: Partial<NuxeoTask> = {}): NuxeoTask {
    return {
      id: 'task-1',
      name: 'wf.serialDocumentReview.validateTask.title',
      directive: '',
      workflowInstanceId: 'wf-1',
      workflowModelName: 'SerialDocumentReview',
      workflowTitle: '',
      state: 'opened',
      nodeName: 'validateNode',
      targetDocumentIds: [{ id: 'doc-1' }],
      actors: [{ id: 'user1' }],
      delegatedActors: [],
      comments: [],
      created: '2026-01-01T00:00:00.000Z',
      dueDate: '2026-01-15T00:00:00.000Z',
      variables: {},
      taskInfo: { taskActions: [] },
      ...over,
    };
  }

  const mockTasks: NuxeoTask[] = [
    task(),
    task({
      id: 'task-2',
      name: 'wf.parallelReview.approveTask.directive',
      workflowModelName: 'ParallelDocumentReview',
      targetDocumentIds: [{ id: 'doc-2' }],
      actors: [{ id: 'user2' }],
      created: '2026-01-02T00:00:00.000Z',
      dueDate: '',
    }),
  ];

  beforeEach(async () => {
    mockTaskService = {
      getUserTasks: vi.fn().mockReturnValue(of(mockTasks)),
    };

    mockRouter = {
      navigate: vi.fn(),
    };

    currentUsername = 'testuser';

    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), TaskListComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: TaskService, useValue: mockTaskService },
        { provide: Router, useValue: mockRouter },
        // Reads the mutable `currentUsername` on every call rather than closing over a fixed value,
        // so a test can change who is signed in without rebuilding the TestBed.
        { provide: CURRENT_USERNAME, useValue: () => currentUsername },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskListComponent);
    component = fixture.componentInstance;
  });

  it('creates the component', () => {
    expect(component).toBeDefined();
  });

  it('loads tasks on initialization', () => {
    fixture.detectChanges(); // triggers ngOnInit

    expect(mockTaskService.getUserTasks).toHaveBeenCalledWith('testuser', 50);
    expect(component.tasks()).toEqual(mockTasks);
    expect(component.loading()).toBe(false);
    expect(component.error()).toBeNull();
  });

  it('uses Administrator as default when currentUsername is null', () => {
    // No `TestBed.resetTestingModule()` here. Resetting discards the compilation the outer
    // `beforeEach` awaited, and `TaskListComponent` has an external `templateUrl`, so the
    // replacement module has to be compiled again before `createComponent` — a synchronous
    // `configureTestingModule` followed by `createComponent` relies on a cached compilation and can
    // fail with "Please call TestBed.compileComponents()". Flipping the mutable username instead
    // needs no second module at all.
    currentUsername = null;

    fixture.detectChanges();

    expect(mockTaskService.getUserTasks).toHaveBeenCalledWith('Administrator', 50);
  });

  it('sets loading state during task fetch', () => {
    // Starts from false and holds the request pending, so this observes the transition `loadTasks`
    // performs rather than the signal's declared default. Asserting the default `true` before
    // `detectChanges()` proved nothing about `loadTasks` — deleting `this.loading.set(true)` from it
    // would have left the old version of this test green.
    const pending = new Subject<NuxeoTask[]>();
    mockTaskService.getUserTasks.mockReturnValue(pending.asObservable());
    component.loading.set(false);

    component.loadTasks();
    expect(component.loading()).toBe(true);

    pending.next(mockTasks);
    expect(component.loading()).toBe(false);
  });

  it('handles error when loading tasks fails', () => {
    mockTaskService.getUserTasks.mockReturnValue(throwError(() => new Error('Network error')));

    fixture.detectChanges();

    expect(component.error()).toBeTruthy();
    expect(component.loading()).toBe(false);
    expect(component.tasks()).toEqual([]);
  });

  it('navigates to task detail when processTask is called', () => {
    component.processTask(mockTasks[0]);

    expect(mockRouter.navigate).toHaveBeenCalledWith(['/tasks', 'task-1']);
  });

  it('transforms task name into readable label', () => {
    const label1 = component.taskLabel(mockTasks[0]);
    expect(label1).toBe('Validate Task');

    const label2 = component.taskLabel(mockTasks[1]);
    expect(label2).toBe('Approve Task');
  });

  it('removes workflow prefix from task name', () => {
    // Named rather than `task`, which would shadow the `task()` factory declared above.
    const prefixedName = task({ name: 'wf.serialDocumentReview.someComplexTaskName.title' });

    expect(component.taskLabel(prefixedName)).toBe('Some Complex Task Name');
  });

  it('capitalizes first letter of each word in task label', () => {
    const camelCaseName = task({ name: 'wf.test.reviewAndApprove.title' });

    expect(component.taskLabel(camelCaseName)).toBe('Review And Approve');
  });

  it('extracts workflow display name from workflowModelName', () => {
    const workflow1 = component.taskWorkflow(mockTasks[0]);
    expect(workflow1).toBe('Serial Document Review');

    const workflow2 = component.taskWorkflow(mockTasks[1]);
    expect(workflow2).toBe('Parallel Document Review');
  });

  it('handles camelCase in workflow names', () => {
    const camelCaseWorkflow = task({ workflowModelName: 'myCustomWorkflowProcess' });

    expect(component.taskWorkflow(camelCaseWorkflow)).toBe('My Custom Workflow Process');
  });

  it('can reload tasks manually', () => {
    fixture.detectChanges(); // initial load
    mockTaskService.getUserTasks.mockClear();

    component.loadTasks();

    expect(mockTaskService.getUserTasks).toHaveBeenCalledTimes(1);
    expect(component.loading()).toBe(false);
  });

  describe('isOverdue', () => {
    it('returns true when due date is in the past', () => {
      const overdueTask = {
        ...mockTasks[0],
        dueDate: '2020-01-01T00:00:00.000Z', // past date
      };

      expect(component.isOverdue(overdueTask)).toBe(true);
    });

    it('returns false when due date is in the future', () => {
      const futureTask = {
        ...mockTasks[0],
        dueDate: '2030-01-01T00:00:00.000Z', // future date
      };

      expect(component.isOverdue(futureTask)).toBe(false);
    });

    it('returns false when task has no due date', () => {
      expect(component.isOverdue(task({ dueDate: '' }))).toBe(false);
    });
  });

  describe('dueLabel', () => {
    // The clock is frozen for this block. Every case here builds a due date as an offset from
    // `Date.now()` and then lets `dueLabel` read `Date.now()` again and floor the difference, so a
    // tick between the two turns "in 3 days" into "in 2 days". With real timers these tests are
    // green almost always, which is the worst kind of flake.
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns empty string when task has no due date', () => {
      expect(component.dueLabel(task({ dueDate: '' }))).toBe('');
    });

    it('returns "less than an hour" for tasks due very soon', () => {
      const soonDate = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes
      const soonTask = {
        ...mockTasks[0],
        dueDate: soonDate,
      };

      const label = component.dueLabel(soonTask);
      expect(label).toContain('less than an hour');
    });

    it('returns hours for tasks due within a day', () => {
      const hoursDate = new Date(Date.now() + 5 * 3600 * 1000).toISOString(); // 5 hours
      const hoursTask = {
        ...mockTasks[0],
        dueDate: hoursDate,
      };

      const label = component.dueLabel(hoursTask);
      expect(label).toMatch(/in \d+ hours/);
    });

    it('returns days for tasks due multiple days away', () => {
      const daysDate = new Date(Date.now() + 3 * 86400 * 1000).toISOString(); // 3 days
      const daysTask = {
        ...mockTasks[0],
        dueDate: daysDate,
      };

      const label = component.dueLabel(daysTask);
      expect(label).toContain('in 3 days');
    });

    it('returns "1 day" for exactly one day', () => {
      const oneDayDate = new Date(Date.now() + 25 * 3600 * 1000).toISOString(); // ~1 day
      const oneDayTask = {
        ...mockTasks[0],
        dueDate: oneDayDate,
      };

      const label = component.dueLabel(oneDayTask);
      expect(label).toContain('1 day');
    });

    it('returns "overdue" for past due dates with hours', () => {
      const overdueDate = new Date(Date.now() - 3 * 3600 * 1000).toISOString(); // 3 hours ago
      const overdueTask = {
        ...mockTasks[0],
        dueDate: overdueDate,
      };

      const label = component.dueLabel(overdueTask);
      expect(label).toContain('overdue');
      expect(label).toMatch(/\d+ hours overdue/);
    });

    it('returns "overdue" for past due dates with days', () => {
      const overdueDate = new Date(Date.now() - 2 * 86400 * 1000).toISOString(); // 2 days ago
      const overdueTask = {
        ...mockTasks[0],
        dueDate: overdueDate,
      };

      const label = component.dueLabel(overdueTask);
      expect(label).toContain('2 days overdue');
    });
  });
});
