import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { afterAll, beforeAll, vi, type MockInstance } from 'vitest';

import {
  TaskService,
  UserService,
  WorkflowService,
  DocumentService,
  NuxeoApiBase,
  type NuxeoDocument,
  type NuxeoTask,
  type NuxeoUser,
} from '@nuxeo/satori-platform/nuxeo-client';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

import { TaskDetailComponent } from './task-detail.component';

/**
 * jsdom implements neither object-URL method, and the preview flow mints and revokes them.
 *
 * `vi.spyOn(URL, 'createObjectURL')` is not an option: `typeof URL.createObjectURL` is `'undefined'`
 * under jsdom, and `spyOn` throws "not a function" on an absent property. So they are assigned, and
 * `afterAll` removes them again — which is the restoration a spy would have provided, and without it
 * these stubs outlive the file and leak into any other spec sharing the worker.
 */
const priorCreateObjectURL = URL.createObjectURL;
const priorRevokeObjectURL = URL.revokeObjectURL;

beforeAll(() => {
  global.URL.createObjectURL = vi.fn(() => 'blob:http://localhost/test');
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
 * rot this file's model fixtures were fixed for. Binding to `T` means the compiler rejects a stub
 * whose return type no longer matches the service.
 */
type ServiceMock<T, K extends keyof T> = {
  [P in K]: T[P] extends (...args: infer A) => infer R ? MockInstance<(...args: A) => R> : T[P];
};

describe('TaskDetailComponent', () => {
  let component: TaskDetailComponent;
  let fixture: ComponentFixture<TaskDetailComponent>;
  let mockTaskService: ServiceMock<TaskService, 'getTask' | 'completeTask'>;
  let mockUserService: ServiceMock<UserService, 'searchUsers' | 'searchGroups'>;
  let mockDocService: ServiceMock<DocumentService, 'getById'>;
  let mockWorkflowService: ServiceMock<WorkflowService, 'cancelWorkflow'>;
  let mockHttp: ServiceMock<HttpClient, 'get'>;
  let mockRouter: ServiceMock<Router, 'navigate'>;
  /** Only the slice of `ActivatedRoute` this component reads. */
  let mockRoute: { snapshot: { paramMap: { get: MockInstance<(key: string) => string | null> } } };
  let snackBarOpen: MockInstance<MatSnackBar['open']>;

  // Typed as the real models, not left as object literals: `test` runs through esbuild, which
  // strips types, so only `typecheck`/`spec-types` would catch a fixture that has drifted from the
  // interface the component actually consumes.
  const mockTask: NuxeoTask = {
    id: 'task-1',
    name: 'wf.serialDocumentReview.validateTask',
    directive: '',
    workflowInstanceId: 'wf-1',
    workflowModelName: 'SerialDocumentReview',
    workflowTitle: 'Document Review',
    state: 'opened',
    nodeName: 'validateNode',
    targetDocumentIds: [{ id: 'doc-1' }],
    actors: [{ id: 'user1' }],
    delegatedActors: [],
    comments: [],
    created: '2026-01-01T00:00:00.000Z',
    dueDate: '2026-01-15T00:00:00.000Z',
    variables: {},
    taskInfo: {
      taskActions: [
        { name: 'approve', label: 'Approve' },
        { name: 'reject', label: 'Reject' },
      ],
    },
  };

  /** A complete `NuxeoUser`, for the participant-search results. */
  const mockSearchUser: NuxeoUser = {
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

  const mockDoc: NuxeoDocument = {
    uid: 'doc-1',
    title: 'Test Document',
    type: 'File',
    path: '/default-domain/workspaces/test',
    lastModified: '2026-01-01T00:00:00.000Z',
    properties: {},
  };

  beforeEach(async () => {
    // Every `vi.fn` here is parameterised with the service method's own type. A bare `vi.fn()`
    // produces `Mock<Procedure>`, whose `mockReturnValue` accepts anything and which is assignable
    // to the typed field — so declaring the *variable* as `ServiceMock<...>` checked later
    // `.mockReturnValue` calls but not this object literal. That is how
    // `completeTask: vi.fn().mockReturnValue(of({}))` survived here while `completeTask` returns
    // `Observable<NuxeoTask>`. Binding the mock itself is what rejects it.
    mockTaskService = {
      getTask: vi.fn<TaskService['getTask']>().mockReturnValue(of(mockTask)),
      completeTask: vi.fn<TaskService['completeTask']>().mockReturnValue(of(mockTask)),
    };

    mockUserService = {
      searchUsers: vi.fn<UserService['searchUsers']>().mockReturnValue(of([])),
      searchGroups: vi.fn<UserService['searchGroups']>().mockReturnValue(of([])),
    };

    mockDocService = {
      getById: vi.fn<DocumentService['getById']>().mockReturnValue(of(mockDoc)),
    };

    mockRoute = {
      snapshot: {
        paramMap: {
          get: vi.fn<(key: string) => string | null>().mockReturnValue('task-1'),
        },
      },
    };

    mockRouter = {
      navigate: vi.fn<Router['navigate']>().mockResolvedValue(true),
    };

    mockWorkflowService = {
      // `Observable<void>`, so `of(undefined)` — `of({})` does not satisfy it.
      cancelWorkflow: vi.fn<WorkflowService['cancelWorkflow']>().mockReturnValue(of(undefined)),
    };

    mockHttp = {
      get: vi
        .fn<HttpClient['get']>()
        .mockReturnValue(of(new Blob(['thumb'], { type: 'image/png' }))),
    };

    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), TaskDetailComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: TaskService, useValue: mockTaskService },
        { provide: UserService, useValue: mockUserService },
        { provide: WorkflowService, useValue: mockWorkflowService },
        { provide: DocumentService, useValue: mockDocService },
        {
          provide: NuxeoApiBase,
          useValue: {
            apiUrl: vi.fn((path: string) => `http://localhost:8080${path}`),
          },
        },
        { provide: HttpClient, useValue: mockHttp },
        { provide: ActivatedRoute, useValue: mockRoute },
        { provide: Router, useValue: mockRouter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskDetailComponent);
    component = fixture.componentInstance;

    // `MatSnackBar` cannot be replaced with a root provider here: `MatSnackBarModule` is in this
    // standalone component's own `imports`, and an NgModule imported that way contributes its
    // providers to the component's node injector, which shadows the TestBed root. A
    // `{ provide: MatSnackBar, useValue: ... }` override is silently ignored, so the spy has to go
    // on the instance the component actually resolved.
    snackBarOpen = vi
      .spyOn(fixture.debugElement.injector.get(MatSnackBar), 'open')
      .mockReturnValue({ afterDismissed: () => of({}) } as never);
  });

  it('creates the component', () => {
    expect(component).toBeDefined();
  });

  it('loads task on initialization when taskId is present', () => {
    fixture.detectChanges();

    expect(mockTaskService.getTask).toHaveBeenCalledWith('task-1');
    expect(component.task()).toEqual(mockTask);
    expect(component.loading()).toBe(false);
  });

  it('shows error when no taskId is provided', () => {
    mockRoute.snapshot.paramMap.get.mockReturnValue(null);

    fixture.detectChanges();

    expect(component.error()).toBeTruthy();
    expect(component.loading()).toBe(false);
    expect(mockTaskService.getTask).not.toHaveBeenCalled();
  });

  it('handles error when loading task fails', () => {
    mockTaskService.getTask.mockReturnValue(throwError(() => new Error('Load failed')));

    fixture.detectChanges();

    expect(component.error()).toBeTruthy();
    expect(component.loading()).toBe(false);
  });

  it('loads target document when task has targetDocumentIds', () => {
    fixture.detectChanges();

    expect(mockDocService.getById).toHaveBeenCalledWith('doc-1');
    expect(component.targetDoc()).toEqual(mockDoc);
    expect(component.docLoading()).toBe(false);
  });

  it('handles missing target document gracefully', () => {
    mockTaskService.getTask.mockReturnValue(of({ ...mockTask, targetDocumentIds: [] }));

    fixture.detectChanges();

    expect(mockDocService.getById).not.toHaveBeenCalled();
    expect(component.docLoading()).toBe(false);
  });

  it('handles document loading error', () => {
    mockDocService.getById.mockReturnValue(throwError(() => new Error('Doc failed')));

    fixture.detectChanges();

    expect(component.docLoading()).toBe(false);
  });

  describe('isChooseParticipants', () => {
    it('returns true for chooseparticipants task names', () => {
      component.task.set({
        ...mockTask,
        name: 'wf.test.chooseParticipants',
      });

      expect(component.isChooseParticipants).toBe(true);
    });

    it('returns true for choose_participants task names', () => {
      component.task.set({
        ...mockTask,
        name: 'wf.test.choose_participants',
      });

      expect(component.isChooseParticipants).toBe(true);
    });

    it('returns true for choose participants with spaces', () => {
      component.task.set({
        ...mockTask,
        name: 'wf.test.choose participants.task',
      });

      expect(component.isChooseParticipants).toBe(true);
    });

    it('returns false for other task names', () => {
      component.task.set({
        ...mockTask,
        name: 'wf.test.validateTask',
      });

      expect(component.isChooseParticipants).toBe(false);
    });

    it('returns false when task is null', () => {
      component.task.set(null);

      expect(component.isChooseParticipants).toBe(false);
    });
  });

  describe('actions', () => {
    it('returns task actions from taskInfo', () => {
      component.task.set(mockTask);

      expect(component.actions).toEqual([
        { name: 'approve', label: 'Approve' },
        { name: 'reject', label: 'Reject' },
      ]);
    });

    it('returns empty array when taskInfo is missing', () => {
      // `taskInfo` is required on `NuxeoTask`, so this is an off-model probe: Nuxeo omits the block
      // for a task with no available actions, and `?.taskActions ?? []` is what absorbs it. Cast
      // through `unknown` rather than `any` so it crosses exactly that boundary and nothing else.
      component.task.set({ ...mockTask, taskInfo: undefined } as unknown as NuxeoTask);

      expect(component.actions).toEqual([]);
    });

    it('returns empty array when task is null', () => {
      component.task.set(null);

      expect(component.actions).toEqual([]);
    });
  });

  describe('taskOverdue', () => {
    it('returns true when due date is in the past', () => {
      component.task.set({
        ...mockTask,
        dueDate: '2020-01-01T00:00:00.000Z',
      });

      expect(component.taskOverdue()).toBe(true);
    });

    it('returns false when due date is in the future', () => {
      component.task.set({
        ...mockTask,
        dueDate: '2030-01-01T00:00:00.000Z',
      });

      expect(component.taskOverdue()).toBe(false);
    });

    it('returns false when there is no due date', () => {
      component.task.set({ ...mockTask, dueDate: '' });

      expect(component.taskOverdue()).toBe(false);
    });

    it('returns false when the server omitted the due date entirely', () => {
      // `NuxeoTask.dueDate` is declared non-optional, so this shape is off-type on purpose: Nuxeo
      // omits the field for a task with no deadline, and `!!t?.dueDate` is what absorbs it.
      component.task.set({ ...mockTask, dueDate: undefined } as unknown as NuxeoTask);

      expect(component.taskOverdue()).toBe(false);
    });

    it('returns false when task is null', () => {
      component.task.set(null);

      expect(component.taskOverdue()).toBe(false);
    });
  });

  describe('searchUsers', () => {
    it('searches users when input is at least 2 characters', () => {
      component.participantInput = 'jo';

      component.searchUsers();

      expect(mockUserService.searchUsers).toHaveBeenCalledWith('jo');
      expect(component.searching()).toBe(false);
    });

    it('clears results when input is less than 2 characters', () => {
      component.participantInput = 'j';

      component.searchUsers();

      expect(mockUserService.searchUsers).not.toHaveBeenCalled();
      expect(component.userResults()).toEqual([]);
      expect(component.groupResults()).toEqual([]);
    });

    it('trims whitespace from search query', () => {
      component.participantInput = '  test  ';

      component.searchUsers();

      expect(mockUserService.searchUsers).toHaveBeenCalledWith('test');
    });
  });

  describe('pre-fills form data from task variables', () => {
    it('sets participants from task variables', () => {
      const taskWithParticipants = {
        ...mockTask,
        variables: {
          participants: ['user1', 'user2'],
        },
      };
      mockTaskService.getTask.mockReturnValue(of(taskWithParticipants));

      fixture.detectChanges();

      expect(component.participants).toEqual(['user1', 'user2']);
    });

    it('sets dueDate from task variables end_date', () => {
      const taskWithEndDate = {
        ...mockTask,
        variables: {
          end_date: '2026-02-15T00:00:00.000Z',
        },
      };
      mockTaskService.getTask.mockReturnValue(of(taskWithEndDate));

      fixture.detectChanges();

      expect(component.dueDate).toBeInstanceOf(Date);
      expect(component.dueDate?.toISOString()).toContain('2026-02-15');
    });

    it('sets default dueDate to 5 days from now when not in variables', () => {
      fixture.detectChanges();

      expect(component.dueDate).toBeInstanceOf(Date);
      const daysDiff = Math.floor(
        (component.dueDate!.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24),
      );
      expect(daysDiff).toBeGreaterThanOrEqual(4);
      expect(daysDiff).toBeLessThanOrEqual(5);
    });
  });

  describe('participant management', () => {
    it('adds a participant and clears the search state', () => {
      component.participantInput = 'jo';
      component.userResults.set([{ id: 'user:john' }] as never);

      component.addParticipant('user:john');

      expect(component.participants).toEqual(['user:john']);
      expect(component.participantInput).toBe('');
      expect(component.userResults()).toEqual([]);
      expect(component.groupResults()).toEqual([]);
    });

    it('does not add the same participant twice', () => {
      component.participants = ['user:john'];
      component.addParticipant('user:john');
      expect(component.participants).toEqual(['user:john']);
    });

    it('removes a participant', () => {
      component.participants = ['user:john', 'user:jane'];
      component.removeParticipant('user:john');
      expect(component.participants).toEqual(['user:jane']);
    });

    it('strips the user: and group: prefixes from a participant label', () => {
      expect(component.formatParticipantLabel('user:john')).toBe('john');
      expect(component.formatParticipantLabel('group:reviewers')).toBe('reviewers');
      expect(component.formatParticipantLabel('john')).toBe('john');
    });

    it('clears searching when the user search fails', () => {
      mockUserService.searchUsers.mockReturnValue(throwError(() => new Error('nope')));
      component.participantInput = 'jo';

      component.searchUsers();

      expect(component.searching()).toBe(false);
    });

    it('keeps user results when only the group search fails', () => {
      mockUserService.searchUsers.mockReturnValue(of([mockSearchUser]));
      mockUserService.searchGroups.mockReturnValue(throwError(() => new Error('nope')));
      component.participantInput = 'jo';

      component.searchUsers();

      expect(component.userResults()).toEqual([mockSearchUser]);
      expect(component.groupResults()).toEqual([]);
    });
  });

  describe('executeAction', () => {
    const approve = { name: 'approve', label: 'Approve' };

    beforeEach(() => {
      fixture.detectChanges();
    });

    /** The `variables` argument of the most recent `completeTask` call, asserted to exist. */
    function lastCompleteTaskVariables(): Record<string, unknown> {
      const call = mockTaskService.completeTask.mock.calls.at(-1);
      expect(call).toBeDefined();
      return call![2] as Record<string, unknown>;
    }

    it('does nothing when no task is loaded', () => {
      component.task.set(null);
      component.executeAction(approve);
      expect(mockTaskService.completeTask).not.toHaveBeenCalled();
    });

    it('completes the task with the comment as both a variable and an argument', () => {
      component.comment = 'Looks good';

      component.executeAction(approve);

      expect(mockTaskService.completeTask).toHaveBeenCalledWith(
        'task-1',
        'approve',
        { comment: 'Looks good' },
        'Looks good',
      );
    });

    it('sends no variables for a plain action with no comment', () => {
      component.comment = '';

      component.executeAction(approve);

      expect(mockTaskService.completeTask).toHaveBeenCalledWith('task-1', 'approve', {}, undefined);
    });

    it('sends participants, end_date and the review mode for a choose-participants task', () => {
      component.task.set({ ...mockTask, name: 'wf.test.chooseParticipants' });
      component.participants = ['user:john', 'jane'];
      component.dueDate = new Date('2026-12-31T00:00:00.000Z');

      component.executeAction({ name: 'start_review', label: 'Start review' });

      expect(mockTaskService.completeTask).toHaveBeenCalledWith(
        'task-1',
        'start_review',
        {
          participants: ['user:john', 'user:jane'],
          end_date: '2026-12-31T00:00:00.000Z',
          validationOrReview: 'simpleReview',
        },
        undefined,
      );
    });

    it('omits end_date when no due date is set', () => {
      component.task.set({ ...mockTask, name: 'wf.test.chooseParticipants' });
      component.participants = ['user:john'];
      component.dueDate = null;

      component.executeAction({ name: 'start_review', label: 'Start review' });

      const variables = lastCompleteTaskVariables();
      expect(variables).not.toHaveProperty('end_date');
      expect(variables['participants']).toEqual(['user:john']);
    });

    it('confirms completion and returns to the task list', () => {
      component.executeAction(approve);

      expect(snackBarOpen).toHaveBeenCalled();
      expect(component.submitting()).toBe(false);
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/tasks']);
    });

    it('surfaces the server message on failure and stays on the task', () => {
      mockTaskService.completeTask.mockReturnValue(
        throwError(() => ({ error: { message: 'Task already closed' } })),
      );
      snackBarOpen.mockClear();
      mockRouter.navigate.mockClear();

      component.executeAction(approve);

      expect(snackBarOpen.mock.calls[0][0]).toBe('Task already closed');
      expect(component.submitting()).toBe(false);
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('falls back to a generic message when the failure carries none', () => {
      mockTaskService.completeTask.mockReturnValue(throwError(() => new Error('boom')));
      snackBarOpen.mockClear();

      component.executeAction(approve);

      expect(snackBarOpen.mock.calls[0][0]).toBe('Failed to complete the task.');
    });
  });

  describe('abandonWorkflow', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('does nothing when no task is loaded', () => {
      component.task.set(null);
      component.abandonWorkflow();
      expect(mockWorkflowService.cancelWorkflow).not.toHaveBeenCalled();
    });

    it('does nothing when the task has no workflow instance', () => {
      component.task.set({ ...mockTask, workflowInstanceId: undefined } as never);
      component.abandonWorkflow();
      expect(mockWorkflowService.cancelWorkflow).not.toHaveBeenCalled();
    });

    it('cancels the workflow instance and returns to the task list', () => {
      component.task.set({ ...mockTask, workflowInstanceId: 'wf-1' } as never);

      component.abandonWorkflow();

      expect(mockWorkflowService.cancelWorkflow).toHaveBeenCalledWith('wf-1');
      expect(snackBarOpen).toHaveBeenCalled();
      expect(component.submitting()).toBe(false);
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/tasks']);
    });

    it('reports a failure and stays on the task', () => {
      component.task.set({ ...mockTask, workflowInstanceId: 'wf-1' } as never);
      mockWorkflowService.cancelWorkflow.mockReturnValue(throwError(() => new Error('nope')));
      snackBarOpen.mockClear();
      mockRouter.navigate.mockClear();

      component.abandonWorkflow();

      expect(snackBarOpen).toHaveBeenCalled();
      expect(component.submitting()).toBe(false);
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });
  });

  describe('goBack', () => {
    it('navigates to the task list', () => {
      component.goBack();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/tasks']);
    });
  });

  describe('document preview', () => {
    it('fetches the thumbnail rendition for a previewable document', () => {
      fixture.detectChanges();

      // `mockDoc.type` is 'File', which `hasVisualPreview` accepts.
      expect(mockHttp.get.mock.calls[0][0]).toContain('/@rendition/thumbnail');
      expect(component.docPreviewUrl()).toBe('blob:http://localhost/test');
    });

    it('does not fetch a preview for a document type that has none', () => {
      mockDocService.getById.mockReturnValue(of({ ...mockDoc, type: 'Workspace' }));

      fixture.detectChanges();

      expect(mockHttp.get).not.toHaveBeenCalled();
      expect(component.docPreviewUrl()).toBeNull();
    });

    it('leaves no preview URL when the rendition request fails', () => {
      mockHttp.get.mockReturnValue(throwError(() => new Error('404')));

      fixture.detectChanges();

      expect(component.docPreviewUrl()).toBeNull();
    });

    it('revokes the object URL when the component is destroyed', () => {
      fixture.detectChanges();
      expect(component.docPreviewUrl()).not.toBeNull();
      vi.mocked(URL.revokeObjectURL).mockClear();

      fixture.destroy();

      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/test');
    });

    it('accepts picture, file, video and note as previewable types', () => {
      for (const type of ['Picture', 'File', 'Video', 'Note']) {
        component.targetDoc.set({ ...mockDoc, type });
        expect(component.hasVisualPreview()).toBe(true);
      }
    });

    it('rejects other document types and a missing document', () => {
      component.targetDoc.set({ ...mockDoc, type: 'Workspace' });
      expect(component.hasVisualPreview()).toBe(false);

      component.targetDoc.set(null);
      expect(component.hasVisualPreview()).toBe(false);
    });

    it('builds the download URL from the target document', () => {
      component.targetDoc.set(mockDoc);
      expect(component.docDownloadUrl()).toContain('/nuxeo/api/v1/id/doc-1/@blob/file:content');
    });

    it('has no download URL without a target document', () => {
      component.targetDoc.set(null);
      expect(component.docDownloadUrl()).toBeNull();
    });
  });

  describe('formatting helpers', () => {
    it('humanises the task label from its workflow-prefixed name', () => {
      expect(component.taskLabel({ ...mockTask, name: 'wf.review.validateTask' })).toBe(
        'Validate Task',
      );
    });

    it('strips a trailing .title or .directive from the task label', () => {
      expect(component.taskLabel({ ...mockTask, name: 'wf.review.validateTask.directive' })).toBe(
        'Validate Task',
      );
    });

    it('prefers the workflow title over the model name', () => {
      expect(
        component.taskWorkflow({ ...mockTask, workflowTitle: 'Document Review' } as never),
      ).toBe('Document Review');
      expect(
        component.taskWorkflow({
          ...mockTask,
          workflowTitle: '',
          workflowModelName: 'SerialDocumentReview',
        } as never),
      ).toBe('Serial Document Review');
    });

    it('humanises an action label, falling back to its name', () => {
      expect(component.actionLabel({ name: 'start_review', label: '' })).toBe('Start Review');
      expect(component.actionLabel({ name: 'approve', label: 'wf.review.approveIt' })).toBe(
        'Approve It',
      );
    });

    it('colours destructive actions warn and progressive ones primary', () => {
      expect(component.actionColor({ name: 'reject' })).toBe('warn');
      expect(component.actionColor({ name: 'cancel_review' })).toBe('warn');
      expect(component.actionColor({ name: 'approve' })).toBe('primary');
      expect(component.actionColor({ name: 'validate' })).toBe('primary');
      expect(component.actionColor({ name: 'start_review' })).toBe('primary');
      expect(component.actionColor({ name: 'comment' })).toBe('');
    });

    it('picks an icon per action kind', () => {
      expect(component.actionIcon({ name: 'approve' })).toBe('circle_check');
      expect(component.actionIcon({ name: 'validate' })).toBe('circle_check');
      expect(component.actionIcon({ name: 'reject' })).toBe('x_large');
      expect(component.actionIcon({ name: 'start_review' })).toBe('triangle_right');
      expect(component.actionIcon({ name: 'cancel_workflow' })).toBe('block');
      expect(component.actionIcon({ name: 'comment' })).toBe('send');
    });
  });
});
