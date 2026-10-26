import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal, LOCALE_ID } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, of, throwError } from 'rxjs';
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  type MockInstance,
} from 'vitest';

import { TasksPageComponent } from './tasks-page.component';
import {
  TaskService,
  UserService,
  WorkflowService,
  DocumentService,
  NuxeoApiBase,
  CURRENT_USERNAME,
  type NuxeoDocument,
  type NuxeoTask,
  type NuxeoUser,
} from '@nuxeo/satori-platform/nuxeo-client';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

/**
 * jsdom has no `ResizeObserver`, and `SatBreadcrumbs` inside this template constructs one. The stub
 * is intentionally inert: recording calls would imply this file asserts something about resizing.
 */
class ResizeObserverStub {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

const priorCreateObjectURL = URL.createObjectURL;
const priorRevokeObjectURL = URL.revokeObjectURL;

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

  // jsdom implements neither object-URL method, and the preview flow mints and revokes them.
  // `vi.spyOn(URL, 'createObjectURL')` cannot be used: the property is `undefined` under jsdom and
  // `spyOn` throws on an absent one. Hence assignment, with the prior values captured above so
  // `afterAll` restores rather than deleting unconditionally.
  global.URL.createObjectURL = vi.fn(() => 'blob:http://localhost/test-blob-url');
  global.URL.revokeObjectURL = vi.fn();
});

afterAll(() => {
  restoreObjectUrlMethod('createObjectURL', priorCreateObjectURL);
  restoreObjectUrlMethod('revokeObjectURL', priorRevokeObjectURL);
});

/**
 * Puts `prior` back, or removes the stub entirely when there was nothing there to begin with.
 *
 * Restoring rather than always deleting matters if another suite in the same worker has provided
 * real implementations: an unconditional `delete` would remove theirs for every later spec.
 */
function restoreObjectUrlMethod<K extends 'createObjectURL' | 'revokeObjectURL'>(
  name: K,
  prior: (typeof URL)[K] | undefined,
): void {
  if (prior === undefined) {
    delete (URL as Partial<typeof URL>)[name];
    return;
  }
  URL[name] = prior;
}

/**
 * A Vitest double for the subset of `T` this spec stubs, bound to the real method signatures.
 *
 * These service doubles were `any`, which defeats the point: `spec-types` cannot see drift through
 * `any`, so a renamed or re-signatured service method would leave the spec green — the same fixture
 * rot the model fixtures in this file were fixed for.
 */
type ServiceMock<T, K extends keyof T> = {
  [P in K]: T[P] extends (...args: infer A) => infer R ? MockInstance<(...args: A) => R> : T[P];
};

describe('TasksPageComponent', () => {
  let component: TasksPageComponent;
  let fixture: ComponentFixture<TasksPageComponent>;
  let mockTaskService: ServiceMock<
    TaskService,
    | 'getUserTasks'
    | 'getTask'
    | 'completeTask'
    | 'delegateTask'
    | 'reassignTask'
    | 'notifyTasksChanged'
  >;
  let mockUserService: ServiceMock<UserService, 'searchUsers' | 'searchGroups'>;
  let mockWorkflowService: ServiceMock<WorkflowService, 'cancelWorkflow' | 'getWorkflowGraph'>;
  let mockDocService: ServiceMock<DocumentService, 'getById'>;
  let mockNuxeoApi: ServiceMock<NuxeoApiBase, 'apiUrl'>;
  let mockHttp: ServiceMock<HttpClient, 'get'>;
  let mockRouter: ServiceMock<Router, 'navigate' | 'navigateByUrl'>;
  /** Only the slice of `ActivatedRoute` this component reads. */
  let mockActivatedRoute: {
    snapshot: { paramMap: { get: MockInstance<(key: string) => string | null> } };
  };
  let snackBarOpen: MockInstance<MatSnackBar['open']>;

  // Typed as the real models, not left as object literals: `test` runs through esbuild, which
  // strips types, so only `typecheck`/`spec-types` would catch a fixture that has drifted from the
  // interface the component actually consumes.
  const mockTask: NuxeoTask = {
    id: 'task-1',
    name: 'wf.serialDocumentReview.reviewTask',
    directive: 'Please review',
    dueDate: new Date(Date.now() + 86400000).toISOString(),
    nodeName: 'reviewNode',
    state: 'opened',
    targetDocumentIds: [{ id: 'doc-1', uid: 'doc-1' }],
    actors: [{ id: 'user:admin' }],
    comments: [],
    delegatedActors: [],
    taskInfo: {
      taskActions: [
        { name: 'approve', label: 'Approve' },
        { name: 'reject', label: 'Reject' },
      ],
    },
    variables: {},
    workflowInstanceId: 'wf-1',
    workflowModelName: 'SerialDocumentReview',
    workflowTitle: 'Document Review',
    created: new Date().toISOString(),
  };

  const mockDocument: NuxeoDocument = {
    uid: 'doc-1',
    title: 'Test Document',
    type: 'File',
    path: '/default-domain/workspaces/test',
    lastModified: new Date().toISOString(),
    properties: {
      'file:content': {
        name: 'test.pdf',
        'mime-type': 'application/pdf',
        length: 102400,
      },
    },
  };

  const mockUser: NuxeoUser = {
    'entity-type': 'user',
    id: 'user:john',
    properties: {
      username: 'john',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      groups: [],
    },
  };

  beforeEach(() => {
    // Every `vi.fn` here is parameterised with the service method's own type. A bare `vi.fn()`
    // produces `Mock<Procedure>`, whose `mockReturnValue` accepts anything and which is assignable
    // to the typed field — so declaring the *variable* as `ServiceMock<...>` checked later
    // `.mockReturnValue` calls but not this object literal. Binding the mock itself is what
    // rejects a stub whose return type has drifted from the service.
    mockTaskService = {
      getUserTasks: vi.fn<TaskService['getUserTasks']>().mockReturnValue(of([mockTask])),
      getTask: vi.fn<TaskService['getTask']>().mockReturnValue(of(mockTask)),
      completeTask: vi.fn<TaskService['completeTask']>().mockReturnValue(of(mockTask)),
      // `delegateTask` and `reassignTask` return `Observable<void>`, not `Observable<{}>`.
      delegateTask: vi.fn<TaskService['delegateTask']>().mockReturnValue(of(undefined)),
      reassignTask: vi.fn<TaskService['reassignTask']>().mockReturnValue(of(undefined)),
      notifyTasksChanged: vi.fn<TaskService['notifyTasksChanged']>(),
    };

    mockUserService = {
      searchUsers: vi.fn<UserService['searchUsers']>().mockReturnValue(of([mockUser])),
      searchGroups: vi.fn<UserService['searchGroups']>().mockReturnValue(of([])),
    };

    mockWorkflowService = {
      cancelWorkflow: vi.fn<WorkflowService['cancelWorkflow']>().mockReturnValue(of(undefined)),
      getWorkflowGraph: vi
        .fn<WorkflowService['getWorkflowGraph']>()
        .mockReturnValue(of({ nodes: [] })),
    };

    mockDocService = {
      getById: vi.fn<DocumentService['getById']>().mockReturnValue(of(mockDocument)),
    };

    mockNuxeoApi = {
      apiUrl: vi.fn<NuxeoApiBase['apiUrl']>((path: string) => `http://localhost:8080${path}`),
    };

    mockHttp = {
      get: vi
        .fn<HttpClient['get']>()
        .mockReturnValue(of(new Blob(['test'], { type: 'application/pdf' }))),
    };

    mockRouter = {
      navigate: vi.fn<Router['navigate']>().mockResolvedValue(true),
      navigateByUrl: vi.fn<Router['navigateByUrl']>().mockResolvedValue(true),
    };

    mockActivatedRoute = {
      snapshot: {
        paramMap: {
          get: vi.fn<(key: string) => string | null>().mockReturnValue(null),
        },
      },
    };

    TestBed.configureTestingModule({
      imports: [testTranslateModule(), TasksPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: TaskService, useValue: mockTaskService },
        { provide: UserService, useValue: mockUserService },
        { provide: WorkflowService, useValue: mockWorkflowService },
        { provide: DocumentService, useValue: mockDocService },
        { provide: NuxeoApiBase, useValue: mockNuxeoApi },
        { provide: HttpClient, useValue: mockHttp },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: CURRENT_USERNAME, useValue: signal('Administrator') },
        { provide: LOCALE_ID, useValue: 'en-US' },
      ],
    });

    fixture = TestBed.createComponent(TasksPageComponent);
    component = fixture.componentInstance;

    // `MatSnackBar` cannot be mocked with a root provider here: `MatSnackBarModule` is in this
    // standalone component's own `imports`, and an NgModule imported that way contributes its
    // providers to the *component's* node injector, which shadows anything TestBed provides at the
    // root. A `{ provide: MatSnackBar, useValue: ... }` override is therefore silently ignored —
    // the component resolves the real service and the spy records nothing. Spying on the instance
    // the component actually resolved is the only thing that observes the call.
    snackBarOpen = vi
      .spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open')
      .mockReturnValue({ afterDismissed: () => of({}) } as never);
  });

  describe('Component Initialization', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should load tasks on init', () => {
      fixture.detectChanges();
      expect(mockTaskService.getUserTasks).toHaveBeenCalledWith('Administrator', 50);
      expect(component.tasks().length).toBe(1);
    });

    it('should handle empty task list', () => {
      mockTaskService.getUserTasks.mockReturnValue(of([]));
      fixture.detectChanges();
      expect(component.tasks()).toEqual([]);
    });

    it('should handle task loading error', () => {
      mockTaskService.getUserTasks.mockReturnValue(throwError(() => new Error('Failed')));
      fixture.detectChanges();
      expect(component.listError()).toBeTruthy();
    });
  });

  describe('Task Selection', () => {
    it('should select task when selectTask is called', () => {
      fixture.detectChanges();
      component.selectTask(mockTask);
      expect(component.selectedTask()).toEqual(mockTask);
    });

    it('should load target document when task has targetDocumentIds', () => {
      fixture.detectChanges();
      component.selectTask(mockTask);
      expect(mockDocService.getById).toHaveBeenCalledWith('doc-1');
    });

    it('should handle task with no target document', () => {
      // An empty list means `loadTasks` auto-selects nothing, so the only `getById` call that could
      // happen is the one this selection would make.
      mockTaskService.getUserTasks.mockReturnValue(of([]));
      fixture.detectChanges();

      component.selectTask({ ...mockTask, targetDocumentIds: [] });

      expect(mockDocService.getById).not.toHaveBeenCalled();
      expect(component.targetDoc()).toBeNull();
      // The trap the component documents: a selection with no document must not leave the panel
      // stuck on its loading state.
      expect(component.docLoading()).toBe(false);
    });

    it('should populate form from task variables', () => {
      const taskWithVars = {
        ...mockTask,
        variables: {
          participants: ['user1', 'user2'],
          end_date: '2026-12-31T00:00:00.000Z',
        },
      };
      fixture.detectChanges();
      component.selectTask(taskWithVars);
      expect(component.participants).toEqual(['user1', 'user2']);
      expect(component.dueDate).toBeInstanceOf(Date);
    });
  });

  describe('User and Group Search', () => {
    it('should not search with less than 2 characters', () => {
      component.participantInput = 'a';
      component.searchUsers();
      expect(mockUserService.searchUsers).not.toHaveBeenCalled();
    });

    it('should search users with 2+ characters', () => {
      component.participantInput = 'jo';
      component.searchUsers();
      expect(mockUserService.searchUsers).toHaveBeenCalledWith('jo');
      expect(mockUserService.searchGroups).toHaveBeenCalledWith('jo');
    });

    it('should clear results when input is empty', () => {
      component.participantInput = '';
      component.searchUsers();
      expect(component.userResults()).toEqual([]);
      expect(component.groupResults()).toEqual([]);
    });

    it('should trim whitespace from search query', () => {
      component.participantInput = '  test  ';
      component.searchUsers();
      expect(mockUserService.searchUsers).toHaveBeenCalledWith('test');
    });
  });

  describe('Participant Management', () => {
    it('should add participant', () => {
      component.participants = [];
      component.addParticipant('user:john');
      expect(component.participants).toContain('user:john');
    });

    it('should prevent duplicate participants', () => {
      component.participants = ['user:john'];
      component.addParticipant('user:john');
      expect(component.participants).toEqual(['user:john']);
    });

    it('should remove participant', () => {
      component.participants = ['user:john', 'user:jane'];
      component.removeParticipant('user:john');
      expect(component.participants).toEqual(['user:jane']);
    });

    it('should format participant display by removing the user: prefix', () => {
      expect(component.formatParticipant('user:john')).toBe('john');
    });

    it('should format participant display by removing the group: prefix', () => {
      expect(component.formatParticipant('group:reviewers')).toBe('reviewers');
    });

    it('should leave an unprefixed participant untouched', () => {
      expect(component.formatParticipant('john')).toBe('john');
    });
  });

  describe('Execute Action', () => {
    const approve = { name: 'approve', label: 'Approve' };

    beforeEach(() => {
      fixture.detectChanges();
      component.selectTask(mockTask);
    });

    it('should return early if no task selected', () => {
      component.selectedTask.set(null);
      component.executeAction(approve);
      expect(mockTaskService.completeTask).not.toHaveBeenCalled();
    });

    it('should complete task with the action name and the comment', () => {
      component.comment = 'Test comment';

      component.executeAction(approve);

      expect(mockTaskService.completeTask).toHaveBeenCalledWith(
        'task-1',
        'approve',
        { comment: 'Test comment' },
        'Test comment',
      );
    });

    it('should omit the comment variable when the comment is empty', () => {
      component.comment = '';

      component.executeAction(approve);

      expect(mockTaskService.completeTask).toHaveBeenCalledWith('task-1', 'approve', {}, undefined);
    });

    it('should send participants and an end_date for a choose-participants task', () => {
      component.selectTask({
        ...mockTask,
        taskInfo: { taskActions: [{ name: 'start_review', label: 'Start review' }] },
      });
      component.participants = ['user:john', 'jane'];
      component.dueDate = new Date('2026-12-31T00:00:00.000Z');

      component.executeAction({ name: 'start_review', label: 'Start review' });

      expect(mockTaskService.completeTask).toHaveBeenCalledWith(
        'task-1',
        'start_review',
        {
          // Bare ids are prefixed; already-prefixed ones are left alone.
          participants: ['user:john', 'user:jane'],
          end_date: '2026-12-31T00:00:00.000Z',
          validationOrReview: 'simpleReview',
        },
        undefined,
      );
    });

    it('should default participants to the current user when none were picked', () => {
      component.selectTask({
        ...mockTask,
        taskInfo: { taskActions: [{ name: 'start_review', label: 'Start review' }] },
      });
      component.participants = [];

      component.executeAction({ name: 'start_review', label: 'Start review' });

      const call = mockTaskService.completeTask.mock.calls.at(-1);
      expect(call).toBeDefined();
      expect((call![2] as Record<string, unknown>)['participants']).toEqual(['user:Administrator']);
    });

    it('should show success snackbar on completion', () => {
      component.executeAction(approve);
      expect(snackBarOpen).toHaveBeenCalled();
    });

    it('should clear the selection and navigate back to the task list', () => {
      component.executeAction(approve);

      expect(component.selectedTask()).toBeNull();
      expect(component.targetDoc()).toBeNull();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/tasks'], { replaceUrl: true });
    });

    it('should reload tasks after completion', async () => {
      mockTaskService.getUserTasks.mockClear();

      component.executeAction(approve);
      // The reload is chained off `router.navigate`'s promise, so it lands a microtask later.
      await Promise.resolve();

      expect(mockTaskService.getUserTasks).toHaveBeenCalled();
    });

    it('should notify task change after completion', () => {
      component.executeAction(approve);
      expect(mockTaskService.notifyTasksChanged).toHaveBeenCalled();
    });

    it('should show error snackbar on failure and keep the selection', () => {
      mockTaskService.completeTask.mockReturnValue(throwError(() => new Error('Failed')));
      snackBarOpen.mockClear();

      component.executeAction(approve);

      expect(snackBarOpen).toHaveBeenCalled();
      expect(component.submitting()).toBe(false);
      expect(component.selectedTask()).not.toBeNull();
    });

    it('should surface the server message when the failure carries one', () => {
      mockTaskService.completeTask.mockReturnValue(
        throwError(() => ({ error: { message: 'Task is already closed' } })),
      );
      snackBarOpen.mockClear();

      component.executeAction(approve);

      expect(snackBarOpen.mock.calls[0][0]).toBe('Task is already closed');
    });
  });

  describe('Abandon Workflow', () => {
    beforeEach(() => {
      fixture.detectChanges();
      component.selectTask(mockTask);
    });

    it('should return early if no task selected', () => {
      component.selectedTask.set(null);
      component.abandonWorkflow();
      expect(mockWorkflowService.cancelWorkflow).not.toHaveBeenCalled();
    });

    it('should return early when the task has no workflow instance', () => {
      component.selectedTask.set({
        ...mockTask,
        workflowInstanceId: undefined,
      } as unknown as NuxeoTask);
      component.abandonWorkflow();
      expect(mockWorkflowService.cancelWorkflow).not.toHaveBeenCalled();
    });

    it('should cancel the workflow instance behind the task', () => {
      component.abandonWorkflow();
      expect(mockWorkflowService.cancelWorkflow).toHaveBeenCalledWith('wf-1');
    });

    it('should show success snackbar', () => {
      component.abandonWorkflow();
      expect(snackBarOpen).toHaveBeenCalled();
    });

    it('should clear the selection and navigate back to the task list', () => {
      component.abandonWorkflow();

      expect(component.selectedTask()).toBeNull();
      expect(component.targetDoc()).toBeNull();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/tasks'], { replaceUrl: true });
    });

    it('should reload tasks after abandoning', async () => {
      mockTaskService.getUserTasks.mockClear();

      component.abandonWorkflow();
      await Promise.resolve();

      expect(mockTaskService.getUserTasks).toHaveBeenCalled();
      expect(mockTaskService.notifyTasksChanged).toHaveBeenCalled();
    });

    it('should show error snackbar on failure and keep the selection', () => {
      mockWorkflowService.cancelWorkflow.mockReturnValue(throwError(() => new Error('Failed')));
      snackBarOpen.mockClear();

      component.abandonWorkflow();

      expect(snackBarOpen).toHaveBeenCalled();
      expect(component.submitting()).toBe(false);
      expect(component.selectedTask()).not.toBeNull();
    });
  });

  describe('Delegate Panel', () => {
    beforeEach(() => {
      fixture.detectChanges();
      component.selectTask(mockTask);
    });

    it('should open delegate panel', () => {
      component.openDelegatePanel();
      expect(component.showDelegatePanel()).toBe(true);
    });

    it('should close the reassign panel when the delegate panel opens', () => {
      component.openReassignPanel();
      component.openDelegatePanel();

      expect(component.showDelegatePanel()).toBe(true);
      expect(component.showReassignPanel()).toBe(false);
    });

    it('should close delegate panel and discard what was typed into it', () => {
      component.openDelegatePanel();
      component.delegateInput = 'jo';
      component.delegateActors = ['user:john'];
      component.delegateComment = 'Please handle';
      component.delegateUserResults.set([mockUser]);

      component.closeDelegatePanel();

      expect(component.showDelegatePanel()).toBe(false);
      expect(component.delegateInput).toBe('');
      expect(component.delegateActors).toEqual([]);
      expect(component.delegateComment).toBe('');
      expect(component.delegateUserResults()).toEqual([]);
    });

    it('should search delegate users and groups', () => {
      component.delegateInput = 'test';

      component.searchDelegateUsers();

      expect(mockUserService.searchUsers).toHaveBeenCalledWith('test');
      expect(mockUserService.searchGroups).toHaveBeenCalledWith('test');
      expect(component.delegateUserResults()).toEqual([mockUser]);
    });

    it('should not search delegate users for fewer than two characters', () => {
      mockUserService.searchUsers.mockClear();
      component.delegateUserResults.set([mockUser]);
      component.delegateInput = 'a';

      component.searchDelegateUsers();

      expect(mockUserService.searchUsers).not.toHaveBeenCalled();
      expect(component.delegateUserResults()).toEqual([]);
    });

    it('should add delegate actor and clear the search state', () => {
      component.delegateActors = [];
      component.delegateInput = 'jo';
      component.delegateUserResults.set([mockUser]);

      component.addDelegateActor('user:john');

      expect(component.delegateActors).toContain('user:john');
      expect(component.delegateInput).toBe('');
      expect(component.delegateUserResults()).toEqual([]);
    });

    it('should not add the same delegate actor twice', () => {
      component.delegateActors = ['user:john'];
      component.addDelegateActor('user:john');
      expect(component.delegateActors).toEqual(['user:john']);
    });

    it('should remove a delegate actor', () => {
      component.delegateActors = ['user:john', 'user:jane'];
      component.removeDelegateActor('user:john');
      expect(component.delegateActors).toEqual(['user:jane']);
    });

    it('should submit delegation', () => {
      component.delegateActors = ['user:john'];
      component.delegateComment = 'Please handle';

      component.confirmDelegate();

      expect(mockTaskService.delegateTask).toHaveBeenCalledWith(
        'task-1',
        ['user:john'],
        'Please handle',
      );
      // The panel closes and the task is re-fetched so the new delegate shows up.
      expect(component.showDelegatePanel()).toBe(false);
      expect(component.submitting()).toBe(false);
      expect(mockTaskService.getTask).toHaveBeenCalledWith('task-1');
    });

    it('should not submit delegation with no actors chosen', () => {
      component.delegateActors = [];
      component.confirmDelegate();
      expect(mockTaskService.delegateTask).not.toHaveBeenCalled();
    });

    it('should surface the server message when delegation fails', () => {
      mockTaskService.delegateTask.mockReturnValue(
        throwError(() => ({ error: { message: 'Not permitted' } })),
      );
      snackBarOpen.mockClear();
      component.openDelegatePanel();
      component.delegateActors = ['user:john'];

      component.confirmDelegate();

      expect(snackBarOpen.mock.calls[0][0]).toBe('Not permitted');
      expect(component.submitting()).toBe(false);
      // The panel stays open on failure, so the chosen actors are not lost to a retry.
      expect(component.showDelegatePanel()).toBe(true);
      expect(component.delegateActors).toEqual(['user:john']);
    });
  });

  describe('Reassign Panel', () => {
    beforeEach(() => {
      fixture.detectChanges();
      component.selectTask(mockTask);
    });

    it('should open reassign panel', () => {
      component.openReassignPanel();
      expect(component.showReassignPanel()).toBe(true);
    });

    it('should close the delegate panel when the reassign panel opens', () => {
      component.openDelegatePanel();
      component.openReassignPanel();

      expect(component.showReassignPanel()).toBe(true);
      expect(component.showDelegatePanel()).toBe(false);
    });

    it('should close reassign panel and discard what was typed into it', () => {
      component.openReassignPanel();
      component.reassignInput = 'ja';
      component.reassignActors = ['user:jane'];
      component.reassignComment = 'Reassigning';
      component.reassignUserResults.set([mockUser]);

      component.closeReassignPanel();

      expect(component.showReassignPanel()).toBe(false);
      expect(component.reassignInput).toBe('');
      expect(component.reassignActors).toEqual([]);
      expect(component.reassignComment).toBe('');
      expect(component.reassignUserResults()).toEqual([]);
    });

    it('should search reassign users and groups', () => {
      component.reassignInput = 'test';

      component.searchReassignUsers();

      expect(mockUserService.searchUsers).toHaveBeenCalledWith('test');
      expect(mockUserService.searchGroups).toHaveBeenCalledWith('test');
      expect(component.reassignUserResults()).toEqual([mockUser]);
    });

    it('should not search reassign users for fewer than two characters', () => {
      mockUserService.searchUsers.mockClear();
      component.reassignUserResults.set([mockUser]);
      component.reassignInput = 'a';

      component.searchReassignUsers();

      expect(mockUserService.searchUsers).not.toHaveBeenCalled();
      expect(component.reassignUserResults()).toEqual([]);
    });

    it('should add a reassign actor and clear the search state', () => {
      component.reassignActors = [];
      component.reassignInput = 'ja';
      component.reassignUserResults.set([mockUser]);

      component.addReassignActor('user:jane');

      expect(component.reassignActors).toContain('user:jane');
      expect(component.reassignInput).toBe('');
      expect(component.reassignUserResults()).toEqual([]);
    });

    it('should not add the same reassign actor twice', () => {
      component.reassignActors = ['user:jane'];
      component.addReassignActor('user:jane');
      expect(component.reassignActors).toEqual(['user:jane']);
    });

    it('should remove a reassign actor', () => {
      component.reassignActors = ['user:jane', 'user:john'];
      component.removeReassignActor('user:jane');
      expect(component.reassignActors).toEqual(['user:john']);
    });

    it('should submit reassignment', () => {
      component.reassignActors = ['user:jane'];
      component.reassignComment = 'Reassigning';

      component.confirmReassign();

      expect(mockTaskService.reassignTask).toHaveBeenCalledWith(
        'task-1',
        ['user:jane'],
        'Reassigning',
      );
      expect(component.showReassignPanel()).toBe(false);
      expect(component.submitting()).toBe(false);
      expect(mockTaskService.getTask).toHaveBeenCalledWith('task-1');
    });

    it('should not submit reassignment with no actors chosen', () => {
      component.reassignActors = [];
      component.confirmReassign();
      expect(mockTaskService.reassignTask).not.toHaveBeenCalled();
    });

    it('should surface the server message when reassignment fails', () => {
      mockTaskService.reassignTask.mockReturnValue(
        throwError(() => ({ error: { message: 'Not permitted' } })),
      );
      snackBarOpen.mockClear();
      component.openReassignPanel();
      component.reassignActors = ['user:jane'];

      component.confirmReassign();

      expect(snackBarOpen.mock.calls[0][0]).toBe('Not permitted');
      expect(component.submitting()).toBe(false);
      expect(component.showReassignPanel()).toBe(true);
    });
  });

  describe('Computed Properties', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should compute isChooseParticipants based on task name', () => {
      component.selectTask({ ...mockTask, name: 'wf.test.chooseParticipants' });
      expect(component.isChooseParticipants).toBe(true);
    });

    it('should return false for non-choose-participants tasks', () => {
      component.selectTask(mockTask);
      expect(component.isChooseParticipants).toBe(false);
    });

    it('should extract actions from task', () => {
      component.selectTask(mockTask);
      expect(component.actions).toEqual([
        { name: 'approve', label: 'Approve' },
        { name: 'reject', label: 'Reject' },
      ]);
    });

    it('should return empty actions when taskInfo is missing', () => {
      component.selectTask({ ...mockTask, taskInfo: undefined } as unknown as NuxeoTask);
      expect(component.actions).toEqual([]);
    });

    it('should report a task with a past due date as overdue', () => {
      expect(component.isOverdue({ ...mockTask, dueDate: '2020-01-01T00:00:00.000Z' })).toBe(true);
    });

    it('should not report a task with a future due date as overdue', () => {
      expect(component.isOverdue({ ...mockTask, dueDate: '2030-01-01T00:00:00.000Z' })).toBe(false);
    });

    it('should not report a task with no due date as overdue', () => {
      expect(component.isOverdue({ ...mockTask, dueDate: undefined } as unknown as NuxeoTask)).toBe(
        false,
      );
    });

    it('should expose the actors assigned to the selected task', () => {
      component.selectTask({ ...mockTask, actors: [{ id: 'user:admin' }, { id: 'group:qa' }] });
      expect(component.taskActors()).toEqual(['user:admin', 'group:qa']);
    });

    it('should expose no actors when nothing is selected', () => {
      component.selectedTask.set(null);
      expect(component.taskActors()).toEqual([]);
    });

    it('should expose delegated actors on the selected task', () => {
      component.selectTask({ ...mockTask, delegatedActors: [{ id: 'user:jane' }] });
      expect(component.delegatedActorsList).toEqual(['user:jane']);
    });

    it('should report hasSelection only while a task is selected', () => {
      component.selectedTask.set(null);
      expect(component.hasSelection()).toBe(false);

      component.selectTask(mockTask);
      expect(component.hasSelection()).toBe(true);
    });

    it('should build breadcrumbs from the target document path', () => {
      component.targetDoc.set(mockDocument);

      expect(component.breadcrumbItems()).toEqual([
        { label: 'default-domain', href: '/browse/default-domain' },
        { label: 'workspaces', href: '/browse/default-domain/workspaces' },
        { label: 'test', href: '/browse/default-domain/workspaces/test' },
      ]);
    });

    it('should build no breadcrumbs without a target document', () => {
      component.targetDoc.set(null);
      expect(component.breadcrumbItems()).toEqual([]);
    });
  });

  describe('Document Viewer', () => {
    beforeEach(() => {
      fixture.detectChanges();
      component.selectTask(mockTask);
    });

    it('should provide document download URL', () => {
      expect(component.downloadUrl()).toContain('/nuxeo/api/v1/id/doc-1/@blob/file:content');
    });

    it('should return null when no document is loaded', () => {
      component.targetDoc.set(null);
      expect(component.downloadUrl()).toBeNull();
    });

    it("should report the document's own MIME type from its metadata", () => {
      component.targetDoc.set(mockDocument);
      expect(component.mimeType()).toBe('application/pdf');
    });

    it('should report no MIME type when the document has no content', () => {
      component.targetDoc.set({ ...mockDocument, properties: {} });
      expect(component.mimeType()).toBe('');
    });

    it('should bind the served blob type to the viewer once a blob has arrived', () => {
      component.targetDoc.set(mockDocument);
      component.previewBlobType.set('image/png');

      // A PDF previews as a thumbnail, so what the viewer is handed must describe the blob
      // (image/png), not the document (application/pdf).
      expect(component.viewerMimeType()).toBe('image/png');
    });

    it("should fall back to the document's MIME type before a blob has arrived", () => {
      component.targetDoc.set(mockDocument);
      component.previewBlobType.set('');

      expect(component.viewerMimeType()).toBe('application/pdf');
    });

    it('should fetch a thumbnail rendition for a non-media document', () => {
      component.targetDoc.set(mockDocument);
      mockHttp.get.mockClear();

      component.selectTask(mockTask);

      expect(mockHttp.get.mock.calls[0][0]).toContain('/@rendition/thumbnail');
    });

    it('should fetch the real blob for an image document', () => {
      mockDocService.getById.mockReturnValue(
        of({
          ...mockDocument,
          properties: { 'file:content': { name: 'p.png', 'mime-type': 'image/png' } },
        }),
      );
      mockHttp.get.mockClear();

      component.selectTask(mockTask);

      expect(mockHttp.get.mock.calls[0][0]).toContain('/@blob/file:content');
    });

    it('should mint an object URL for the fetched preview blob', () => {
      component.selectTask(mockTask);

      expect(component.rawPreviewUrl()).toBe('blob:http://localhost/test-blob-url');
      expect(component.previewUrl()).not.toBeNull();
    });

    it('should revoke the previous object URL when the selection changes', () => {
      component.selectTask(mockTask);
      expect(component.rawPreviewUrl()).not.toBeNull();
      vi.mocked(URL.revokeObjectURL).mockClear();

      component.selectTask({ ...mockTask, id: 'task-2', targetDocumentIds: [] });

      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/test-blob-url');
      expect(component.rawPreviewUrl()).toBeNull();
      expect(component.previewBlobType()).toBe('');
    });

    it('should report the file name from the content, falling back to the title', () => {
      component.targetDoc.set(mockDocument);
      expect(component.fileName()).toBe('test.pdf');

      component.targetDoc.set({ ...mockDocument, properties: {} });
      expect(component.fileName()).toBe('Test Document');
    });

    it('should format the file size in the largest unit that fits', () => {
      component.targetDoc.set(mockDocument);
      expect(component.fileSize()).toBe('100.00 KB');

      component.targetDoc.set({
        ...mockDocument,
        properties: { 'file:content': { length: 512 } },
      });
      expect(component.fileSize()).toBe('512 B');

      component.targetDoc.set({
        ...mockDocument,
        properties: { 'file:content': { length: 5 * 1024 * 1024 } },
      });
      expect(component.fileSize()).toBe('5.00 MB');
    });

    it('should report no file size when the content has no length', () => {
      component.targetDoc.set({ ...mockDocument, properties: {} });
      expect(component.fileSize()).toBe('');
    });

    it('should read an arbitrary property off the target document', () => {
      component.targetDoc.set(mockDocument);
      expect(component.docProp('file:content')).toEqual(mockDocument.properties['file:content']);
      expect(component.docProp('dc:missing')).toBeNull();
    });
  });

  describe('Loading States', () => {
    it('should show loading during task list fetch', () => {
      expect(component.listLoading()).toBe(true);
      fixture.detectChanges();
      expect(component.listLoading()).toBe(false);
    });

    it('should show loading during document fetch', () => {
      fixture.detectChanges();
      component.selectTask(mockTask);
      // Document loading happens asynchronously
      expect(mockDocService.getById).toHaveBeenCalled();
    });

    it('should show submitting while an action is in flight and clear it when it lands', () => {
      const completion = new Subject<NuxeoTask>();
      mockTaskService.completeTask.mockReturnValue(completion.asObservable());
      fixture.detectChanges();
      component.selectTask(mockTask);

      component.executeAction({ name: 'approve', label: 'Approve' });
      expect(component.submitting()).toBe(true);

      completion.next(mockTask);
      completion.complete();
      expect(component.submitting()).toBe(false);
    });
  });

  describe('Workflow Graph', () => {
    beforeEach(() => {
      fixture.detectChanges();
      component.selectTask(mockTask);
    });

    it('should load the graph for the selected workflow instance', () => {
      component.openGraphPanel();

      expect(mockWorkflowService.getWorkflowGraph).toHaveBeenCalledWith('wf-1');
      expect(component.showGraphPanel()).toBe(true);
      expect(component.graphLoading()).toBe(false);
      expect(component.graphData()).toEqual({ nodes: [] });
    });

    it('should not open the graph panel when the task has no workflow instance', () => {
      component.selectedTask.set({
        ...mockTask,
        workflowInstanceId: undefined,
      } as unknown as NuxeoTask);

      component.openGraphPanel();

      expect(component.showGraphPanel()).toBe(false);
      expect(mockWorkflowService.getWorkflowGraph).not.toHaveBeenCalled();
    });

    it('should record an error in the graph data when the load fails', () => {
      mockWorkflowService.getWorkflowGraph.mockReturnValue(throwError(() => new Error('nope')));

      component.openGraphPanel();

      expect(component.graphData()).toEqual({ error: 'Failed to load graph' });
      expect(component.graphLoading()).toBe(false);
    });

    it('should close the graph panel and discard its data', () => {
      component.openGraphPanel();
      component.closeGraphPanel();

      expect(component.showGraphPanel()).toBe(false);
      expect(component.graphData()).toBeNull();
    });

    it("should mark the node matching the task's nodeName as current", () => {
      component.graphData.set({
        nodes: [
          { id: 'reviewNode', title: 'Review', state: 'running' },
          { id: 'approveNode', title: 'Approve', state: 'ready' },
        ],
      });

      expect(component.graphNodes()).toEqual([
        { id: 'reviewNode', title: 'Review', state: 'running', isCurrent: true },
        { id: 'approveNode', title: 'Approve', state: 'ready', isCurrent: false },
      ]);
    });

    it('should read nodes from an `elements` key too', () => {
      component.graphData.set({ elements: [{ id: 'n1' }] });

      // No `title`, so it falls back to the id.
      expect(component.graphNodes()).toEqual([
        { id: 'n1', title: 'n1', state: '', isCurrent: false },
      ]);
    });

    it('should expose no graph nodes for missing or failed graph data', () => {
      component.graphData.set(null);
      expect(component.graphNodes()).toEqual([]);

      component.graphData.set({ error: 'Failed to load graph' });
      expect(component.graphNodes()).toEqual([]);
    });
  });

  describe('Task Comments', () => {
    /**
     * Sets `selectedTask` with a `comments` array in whichever shape Nuxeo happened to send.
     *
     * `NuxeoTask.comments` is `{ author; text; date }[]`, but `taskComments` exists precisely
     * because the server also sends bare strings and the `{ comment, creationDate }` spelling. Each
     * case below is therefore off-model on purpose; the cast is confined to this helper so the
     * individual tests read cleanly and no `any` is involved.
     */
    function selectTaskWithComments(comments: readonly unknown[]): void {
      component.selectedTask.set({ ...mockTask, comments } as unknown as NuxeoTask);
    }

    it('should normalise object comments', () => {
      selectTaskWithComments([{ author: 'admin', text: 'Looks good', date: '2026-01-01' }]);

      expect(component.taskComments).toEqual([
        { author: 'admin', text: 'Looks good', date: '2026-01-01' },
      ]);
    });

    it('should normalise plain-string comments', () => {
      selectTaskWithComments(['Just a string']);

      expect(component.taskComments).toEqual([{ author: '', text: 'Just a string', date: '' }]);
    });

    it('should accept the alternate `comment` and `creationDate` keys', () => {
      selectTaskWithComments([
        { author: 'admin', comment: 'Via comment key', creationDate: '2026-02-02' },
      ]);

      expect(component.taskComments).toEqual([
        { author: 'admin', text: 'Via comment key', date: '2026-02-02' },
      ]);
    });

    it('should expose no comments when the task has none', () => {
      component.selectedTask.set({ ...mockTask, comments: undefined } as unknown as NuxeoTask);
      expect(component.taskComments).toEqual([]);
    });
  });

  describe('Formatting Helpers', () => {
    // `dueLabel` reads `Date.now()` itself and floors the difference, while the cases below build a
    // due date from an earlier `Date.now()`. A tick between the two turns "Due in 3 days" into
    // "Due in 2 days", so the clock is frozen rather than padded with a margin.
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should humanise the task label from its workflow-prefixed name', () => {
      expect(component.taskLabel({ ...mockTask, name: 'wf.review.validateTask' })).toBe(
        'Validate Task',
      );
    });

    it('should strip a trailing .title or .directive from the task label', () => {
      expect(component.taskLabel({ ...mockTask, name: 'wf.review.validateTask.title' })).toBe(
        'Validate Task',
      );
    });

    it('should humanise the directive when the task has one', () => {
      expect(component.taskDirective({ ...mockTask, directive: 'wf.review.pleaseApprove' })).toBe(
        'Please Approve',
      );
    });

    it('should fall back to the task label when there is no directive', () => {
      const task = { ...mockTask, directive: '', name: 'wf.review.validateTask' };
      expect(component.taskDirective(task)).toBe(component.taskLabel(task));
    });

    it('should prefer the workflow title over the model name', () => {
      expect(component.taskWorkflow(mockTask)).toBe('Document Review');
      expect(
        component.taskWorkflow({
          ...mockTask,
          workflowTitle: '',
          workflowModelName: 'SerialReview',
        }),
      ).toBe('Serial Review');
    });

    it('should humanise an action label, falling back to its name', () => {
      expect(component.actionLabel({ name: 'start_review', label: '' })).toBe('Start Review');
      expect(component.actionLabel({ name: 'approve', label: 'wf.review.approveIt' })).toBe(
        'Approve It',
      );
    });

    it('should colour destructive actions warn and progressive ones primary', () => {
      expect(component.actionColor({ name: 'reject' })).toBe('warn');
      expect(component.actionColor({ name: 'cancel_review' })).toBe('warn');
      expect(component.actionColor({ name: 'approve' })).toBe('primary');
      expect(component.actionColor({ name: 'validate' })).toBe('primary');
      expect(component.actionColor({ name: 'comment' })).toBe('');
    });

    it('should pick an icon per action kind', () => {
      expect(component.actionIcon({ name: 'approve' })).toBe('circle_check');
      expect(component.actionIcon({ name: 'reject' })).toBe('cancel');
      expect(component.actionIcon({ name: 'start_review' })).toBe('play_arrow');
      expect(component.actionIcon({ name: 'cancel_workflow' })).toBe('block');
      expect(component.actionIcon({ name: 'comment' })).toBe('send');
    });

    it('should format a due date and return empty for none', () => {
      expect(component.dueDateFormatted({ ...mockTask, dueDate: '2026-03-05T00:00:00.000Z' })).toBe(
        'March 5, 2026',
      );
      expect(
        component.dueDateFormatted({ ...mockTask, dueDate: undefined } as unknown as NuxeoTask),
      ).toBe('');
    });

    it('should label a future due date as "Due in" and a past one as overdue', () => {
      const inThreeDays = new Date(Date.now() + 3 * 86_400_000).toISOString();
      expect(component.dueLabel({ ...mockTask, dueDate: inThreeDays })).toBe('Due in 3 days');

      const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
      expect(component.dueLabel({ ...mockTask, dueDate: twoDaysAgo })).toBe('2 days overdue');
    });

    it('should use singular days and an hours label under a day', () => {
      const inOneDay = new Date(Date.now() + 86_400_000 + 60_000).toISOString();
      expect(component.dueLabel({ ...mockTask, dueDate: inOneDay })).toBe('Due in 1 day');

      const inFiveHours = new Date(Date.now() + 5 * 3_600_000).toISOString();
      expect(component.dueLabel({ ...mockTask, dueDate: inFiveHours })).toBe('Due in 5 hours');

      const inThirtyMinutes = new Date(Date.now() + 30 * 60_000).toISOString();
      expect(component.dueLabel({ ...mockTask, dueDate: inThirtyMinutes })).toBe(
        'Due in less than an hour',
      );
    });

    it('should produce no due label without a due date', () => {
      expect(component.dueLabel({ ...mockTask, dueDate: undefined } as unknown as NuxeoTask)).toBe(
        '',
      );
    });
  });

  describe('Route-driven selection', () => {
    it('should select the routed task from the list it just loaded', () => {
      mockActivatedRoute.snapshot.paramMap.get.mockReturnValue('task-1');

      fixture.detectChanges();

      expect(component.selectedTask()?.id).toBe('task-1');
      // Already in the list, so no separate fetch is needed.
      expect(mockTaskService.getTask).not.toHaveBeenCalled();
    });

    it('should fetch a routed task that is not in the list', () => {
      mockActivatedRoute.snapshot.paramMap.get.mockReturnValue('task-99');
      mockTaskService.getTask.mockReturnValue(of({ ...mockTask, id: 'task-99' }));

      fixture.detectChanges();

      expect(mockTaskService.getTask).toHaveBeenCalledWith('task-99');
      expect(component.selectedTask()?.id).toBe('task-99');
      expect(component.taskLoading()).toBe(false);
    });

    it('should clear taskLoading when the routed task cannot be fetched', () => {
      mockActivatedRoute.snapshot.paramMap.get.mockReturnValue('task-99');
      mockTaskService.getTask.mockReturnValue(throwError(() => new Error('gone')));

      fixture.detectChanges();

      expect(component.taskLoading()).toBe(false);
      expect(component.selectedTask()).toBeNull();
    });
  });

  describe('Breadcrumb navigation', () => {
    it('should navigate to the clicked breadcrumb href instead of following the link', () => {
      const anchor = document.createElement('a');
      anchor.setAttribute('href', '/browse/default-domain');
      const event = { target: anchor, preventDefault: vi.fn() } as unknown as MouseEvent;

      component.onBreadcrumbClick(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/browse/default-domain');
    });

    it('should ignore a click that did not land on a link', () => {
      const span = document.createElement('span');
      const event = { target: span, preventDefault: vi.fn() } as unknown as MouseEvent;

      component.onBreadcrumbClick(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
    });
  });
});
