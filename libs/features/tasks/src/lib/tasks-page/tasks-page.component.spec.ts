import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input, provideZonelessChangeDetection, signal } from '@angular/core';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
  type ParamMap,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  type MockInstance,
} from 'vitest';

import { TasksPageComponent } from './tasks-page.component';
import { tasksRoutes } from '../lib.routes';
import {
  TaskService,
  UserService,
  WorkflowService,
  DocumentService,
  DocumentDetailService,
  NuxeoApiBase,
  CURRENT_USERNAME,
  type NuxeoDocument,
  type NuxeoTask,
} from '@nuxeo/satori-platform/nuxeo-client';
import { NXS_TASK_DETAIL_ID } from '@nuxeo/satori-platform/components';
import { provideSatoriExtensions } from '@nuxeo/satori-platform/extensions';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

/**
 * jsdom has no `ResizeObserver`, which a component this template renders may construct. The stub
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

/**
 * The slice of `ActivatedRoute` this component reads, moving the way the router's own does when it
 * reuses an instance for a new `:taskId`: `snapshot` is replaced first, then `paramMap` emits.
 *
 * Both move, rather than only the one the component reads, so a component that went back to reading
 * `snapshot` once still passes every first-load spec here and fails only the ones that change the
 * route on a live component — the failure points at the defect, not at a missing mock property.
 */
class FakeTaskRoute {
  readonly paramMap = new BehaviorSubject<ParamMap>(convertToParamMap({}));
  snapshot: { paramMap: ParamMap } = { paramMap: this.paramMap.value };

  /** Route to `/tasks/<taskId>`, or to `/tasks` for `null`. */
  routeTo(taskId: string | null): void {
    // The router emits only when the params change; a navigation to the current URL emits nothing.
    if (this.snapshot.paramMap.get('taskId') === taskId) return;
    const params = convertToParamMap(taskId ? { taskId } : {});
    this.snapshot = { paramMap: params };
    this.paramMap.next(params);
  }
}

describe('TasksPageComponent', () => {
  let component: TasksPageComponent;
  let fixture: ComponentFixture<TasksPageComponent>;
  let mockTaskService: ServiceMock<TaskService, 'getUserTasks' | 'getTask'>;
  let mockDocService: ServiceMock<DocumentService, 'getById'>;
  let mockNuxeoApi: ServiceMock<NuxeoApiBase, 'apiUrl'>;
  let mockHttp: ServiceMock<HttpClient, 'get'>;
  let mockRouter: ServiceMock<Router, 'navigate' | 'navigateByUrl'>;
  let mockActivatedRoute: FakeTaskRoute;

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

  beforeEach(() => {
    // Every `vi.fn` here is parameterised with the service method's own type. A bare `vi.fn()`
    // produces `Mock<Procedure>`, whose `mockReturnValue` accepts anything and which is assignable
    // to the typed field — so declaring the *variable* as `ServiceMock<...>` checked later
    // `.mockReturnValue` calls but not this object literal. Binding the mock itself is what
    // rejects a stub whose return type has drifted from the service.
    mockTaskService = {
      getUserTasks: vi.fn<TaskService['getUserTasks']>().mockReturnValue(of([mockTask])),
      getTask: vi.fn<TaskService['getTask']>().mockReturnValue(of(mockTask)),
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

    mockActivatedRoute = new FakeTaskRoute();

    TestBed.configureTestingModule({
      imports: [testTranslateModule(), TasksPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: TaskService, useValue: mockTaskService },
        // What the packaged task panel injects when the page renders it as the fallback.
        { provide: UserService, useValue: {} },
        { provide: WorkflowService, useValue: {} },
        { provide: DocumentDetailService, useValue: {} },
        { provide: DocumentService, useValue: mockDocService },
        { provide: NuxeoApiBase, useValue: mockNuxeoApi },
        { provide: HttpClient, useValue: mockHttp },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: CURRENT_USERNAME, useValue: signal('Administrator') },
      ],
    });

    fixture = TestBed.createComponent(TasksPageComponent);
    component = fixture.componentInstance;
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
  });

  describe('Computed Properties', () => {
    beforeEach(() => {
      fixture.detectChanges();
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
        { label: 'default-domain', routerLink: ['/browse', 'default-domain'] },
        { label: 'workspaces', routerLink: ['/browse', 'default-domain', 'workspaces'] },
        { label: 'test', routerLink: ['/browse', 'default-domain', 'workspaces', 'test'] },
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

      // A non-media document previews as a thumbnail, so what the viewer is handed must describe the blob
      // (image/png), not the document (application/pdf).
      expect(component.viewerMimeType()).toBe('image/png');
    });

    it("should fall back to the document's MIME type before a blob has arrived", () => {
      component.targetDoc.set(mockDocument);
      component.previewBlobType.set('');

      expect(component.viewerMimeType()).toBe('application/pdf');
    });

    it('should fetch a thumbnail rendition for a non-media document', () => {
      mockDocService.getById.mockReturnValue(
        of({
          ...mockDocument,
          properties: {
            'file:content': {
              name: 'notes.docx',
              'mime-type':
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
          },
        }),
      );
      mockHttp.get.mockClear();

      component.selectTask(mockTask);

      expect(mockHttp.get.mock.calls[0][0]).toContain('/@rendition/thumbnail');
    });

    it('should fetch the real blob for a PDF so every page is available', () => {
      mockHttp.get.mockClear();

      component.selectTask(mockTask);

      expect(mockHttp.get.mock.calls[0][0]).toContain('/@blob/file:content');
      expect(mockHttp.get.mock.calls[0][0]).not.toContain('/@rendition/thumbnail');
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
  });

  describe('Superseded and partial responses', () => {
    const otherTask: NuxeoTask = { ...mockTask, id: 'task-2', targetDocumentIds: [] };

    it('shows the document the enricher returned while it fetches the full one', () => {
      mockDocService.getById.mockReturnValue(new Subject<NuxeoDocument>());
      component.selectTask({
        ...mockTask,
        targetDocumentIds: [
          { uid: 'doc-9', title: 'Enriched', type: 'Note', path: '/ws/enriched' },
        ],
      });
      expect(component.targetDoc()).toMatchObject({
        uid: 'doc-9',
        title: 'Enriched',
        type: 'Note',
      });
      expect(mockDocService.getById).toHaveBeenCalledWith('doc-9');
    });

    it('stops loading when the target document cannot be fetched', () => {
      mockDocService.getById.mockReturnValue(throwError(() => new Error('403')));
      component.selectTask(mockTask);
      expect(component.docLoading()).toBe(false);
      expect(component.targetDoc()).toBeNull();
    });

    it('drops a document, or its failure, that lands for a superseded selection', () => {
      const first = new Subject<NuxeoDocument>();
      const second = new Subject<NuxeoDocument>();
      mockDocService.getById.mockReturnValueOnce(first).mockReturnValueOnce(second);
      component.selectTask(mockTask);
      component.selectTask(otherTask);
      first.next(mockDocument);
      expect(component.targetDoc()).toBeNull();

      component.selectTask(mockTask);
      expect(component.docLoading()).toBe(true);
      const third = new Subject<NuxeoDocument>();
      mockDocService.getById.mockReturnValueOnce(third);
      component.selectTask({ ...mockTask, id: 'task-3' });
      second.error(new Error('late'));
      expect(component.docLoading()).toBe(true);
    });

    it('fetches no preview for a document without a file', () => {
      mockDocService.getById.mockReturnValue(of({ ...mockDocument, properties: {} }));
      component.selectTask(mockTask);
      expect(mockHttp.get).not.toHaveBeenCalled();
      expect(component.rawPreviewUrl()).toBeNull();
    });

    it('drops a preview that lands for a superseded selection', () => {
      const preview = new Subject<Blob>();
      mockHttp.get.mockReturnValue(preview);
      component.selectTask(mockTask);
      component.selectTask(otherTask);
      preview.next(new Blob(['late'], { type: 'application/pdf' }));
      expect(component.rawPreviewUrl()).toBeNull();
    });

    it('keeps a newer routed fetch loading when an older one fails after it', () => {
      const older = new Subject<NuxeoTask>();
      mockActivatedRoute.routeTo('task-99');
      mockTaskService.getUserTasks.mockReturnValue(of([]));
      mockTaskService.getTask.mockReturnValueOnce(older).mockReturnValueOnce(new Subject());
      fixture.detectChanges();

      component['loadAndSelectTask']('task-77');
      older.error(new Error('gone'));
      expect(component.taskLoading()).toBe(true);
    });

    it('fetches nothing when the panel reports a change with no task selected', () => {
      mockTaskService.getUserTasks.mockReturnValue(of([]));
      fixture.detectChanges();
      component['onTaskChanged']();
      expect(mockTaskService.getTask).not.toHaveBeenCalled();
    });
  });

  describe('Download', () => {
    it('opens the document file in a new tab', () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      component.selectTask(mockTask);
      component.download();
      expect(open).toHaveBeenCalledWith(
        'http://localhost:8080/nuxeo/api/v1/id/doc-1/@blob/file:content',
        '_blank',
      );
      open.mockRestore();
    });

    it('opens nothing without a document', () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      component.download();
      expect(open).not.toHaveBeenCalled();
      open.mockRestore();
    });
  });

  describe('Route-driven selection', () => {
    it('should select the routed task from the list it just loaded', () => {
      mockActivatedRoute.routeTo('task-1');

      fixture.detectChanges();

      expect(component.selectedTask()?.id).toBe('task-1');
      // Already in the list, so no separate fetch is needed.
      expect(mockTaskService.getTask).not.toHaveBeenCalled();
    });

    it('should fetch a routed task that is not in the list', () => {
      mockActivatedRoute.routeTo('task-99');
      mockTaskService.getTask.mockReturnValue(of({ ...mockTask, id: 'task-99' }));

      fixture.detectChanges();

      expect(mockTaskService.getTask).toHaveBeenCalledWith('task-99');
      expect(component.selectedTask()?.id).toBe('task-99');
      expect(component.taskLoading()).toBe(false);
    });

    it('should clear taskLoading when the routed task cannot be fetched', () => {
      mockActivatedRoute.routeTo('task-99');
      mockTaskService.getTask.mockReturnValue(throwError(() => new Error('gone')));

      fixture.detectChanges();

      expect(component.taskLoading()).toBe(false);
      expect(component.selectedTask()).toBeNull();
    });

    describe('when the route names another task on a live page', () => {
      const secondTask: NuxeoTask = {
        ...mockTask,
        id: 'task-2',
        targetDocumentIds: [{ id: 'doc-2', uid: 'doc-2' }],
      };

      beforeEach(() => {
        mockTaskService.getUserTasks.mockReturnValue(of([mockTask, secondTask]));
        mockActivatedRoute.routeTo('task-1');
        fixture.detectChanges();
        expect(component.selectedTask()?.id).toBe('task-1');
        mockTaskService.getUserTasks.mockClear();
        mockDocService.getById.mockClear();
        mockRouter.navigate.mockClear();
      });

      it('selects it from the loaded list', () => {
        mockActivatedRoute.routeTo('task-2');

        expect(component.selectedTask()?.id).toBe('task-2');
        expect(mockDocService.getById).toHaveBeenCalledWith('doc-2');
        // Taken from the list: neither the inbox nor the task is fetched again.
        expect(mockTaskService.getUserTasks).not.toHaveBeenCalled();
        expect(mockTaskService.getTask).not.toHaveBeenCalled();
      });

      it('fetches it when it is not in the list', () => {
        mockTaskService.getTask.mockReturnValue(of({ ...mockTask, id: 'task-99' }));

        mockActivatedRoute.routeTo('task-99');

        expect(mockTaskService.getTask).toHaveBeenCalledWith('task-99');
        expect(component.selectedTask()?.id).toBe('task-99');
        expect(component.taskLoading()).toBe(false);
      });

      it('does not select again on the navigation its own selection makes', () => {
        // `selectTask` navigates to the task it selected, which the router reports as a route change.
        mockRouter.navigate.mockImplementation((commands) => {
          mockActivatedRoute.routeTo(String(commands[1]));
          return Promise.resolve(true);
        });

        component.selectTask(secondTask);

        expect(mockActivatedRoute.snapshot.paramMap.get('taskId')).toBe('task-2');
        expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
        expect(mockDocService.getById).toHaveBeenCalledTimes(1);
      });

      it('lets a route back to the shown task win over a routed fetch still in flight', () => {
        const pending = new Subject<NuxeoTask>();
        mockTaskService.getTask.mockReturnValue(pending);
        mockActivatedRoute.routeTo('task-99');
        // The panel keeps the shown task while the routed one loads.
        expect(component.selectedTask()?.id).toBe('task-1');

        mockActivatedRoute.routeTo('task-1');
        pending.next({ ...mockTask, id: 'task-99' });

        expect(component.selectedTask()?.id).toBe('task-1');
        expect(component.taskLoading()).toBe(false);
      });

      it('leaves a route change made while the list reloads to the reloaded list', () => {
        const reload = new Subject<NuxeoTask[]>();
        mockTaskService.getUserTasks.mockReturnValue(reload);
        component.loadTasks();

        mockActivatedRoute.routeTo('task-3');
        // Not in the list on screen, but the reload may bring it: nothing is fetched alone yet.
        expect(mockTaskService.getTask).not.toHaveBeenCalled();

        reload.next([mockTask, secondTask, { ...mockTask, id: 'task-3' }]);

        expect(component.selectedTask()?.id).toBe('task-3');
        expect(mockTaskService.getTask).not.toHaveBeenCalled();
      });
    });
  });

  describe('Task panel', () => {
    it('renders the selected task in the packaged panel when nothing re-registers the ID', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const panel = (fixture.nativeElement as HTMLElement).querySelector(
        '.task-form-panel nxs-task-detail',
      );
      expect(panel?.querySelector('.nxs-task-detail__title')?.textContent?.trim()).toBe(
        'Please Review',
      );
    });

    it('moves on when the panel hands the task back as done', async () => {
      fixture.detectChanges();
      mockTaskService.getUserTasks.mockClear();
      component['onTaskDone']();
      expect(component.selectedTask()).toBeNull();
      expect(component.targetDoc()).toBeNull();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/tasks'], { replaceUrl: true });
      await fixture.whenStable();
      expect(mockTaskService.getUserTasks).toHaveBeenCalledWith('Administrator', 50);
    });

    it('fetches the task and the inbox again when the panel changed its assignees', () => {
      fixture.detectChanges();
      mockTaskService.getUserTasks.mockClear();
      const reassigned = { ...mockTask, actors: [{ id: 'user:jdoe' }] };
      mockTaskService.getTask.mockReturnValue(of(reassigned));
      component['onTaskChanged']();
      expect(mockTaskService.getTask).toHaveBeenCalledWith('task-1');
      expect(mockTaskService.getUserTasks).toHaveBeenCalled();
    });
  });
});

/**
 * The suite above stands in for the router, so it can only assert what the page does with a route
 * change it is handed. This one drives the feature's real routes, which is what shows the defect
 * happens at all: `/tasks/a` to `/tasks/b` reuses the instance, so `ngOnInit` does not run again.
 */
describe('TasksPageComponent under its own routes', () => {
  const task = (id: string): NuxeoTask => ({
    id,
    name: 'wf.serialDocumentReview.reviewTask',
    directive: 'Please review',
    dueDate: '',
    nodeName: 'reviewNode',
    state: 'opened',
    targetDocumentIds: [],
    actors: [{ id: 'user:admin' }],
    comments: [],
    delegatedActors: [],
    taskInfo: { taskActions: [] },
    variables: {},
    workflowInstanceId: 'wf-1',
    workflowModelName: 'SerialDocumentReview',
    workflowTitle: 'Document Review',
    created: '',
  });

  it('selects the task a new id names on the instance it reuses', async () => {
    const getUserTasks = vi
      .fn<TaskService['getUserTasks']>()
      .mockReturnValue(of([task('task-1'), task('task-2')]));
    const getTask = vi.fn<TaskService['getTask']>();
    TestBed.configureTestingModule({
      imports: [testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: 'tasks', children: tasksRoutes }]),
        { provide: TaskService, useValue: { getUserTasks, getTask } },
        { provide: UserService, useValue: {} },
        { provide: WorkflowService, useValue: {} },
        { provide: DocumentDetailService, useValue: {} },
        { provide: DocumentService, useValue: { getById: () => of(null) } },
        { provide: NuxeoApiBase, useValue: { apiUrl: (path: string) => path } },
        { provide: HttpClient, useValue: { get: () => of(new Blob()) } },
        { provide: CURRENT_USERNAME, useValue: signal('Administrator') },
      ],
    });
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/tasks/task-1', TasksPageComponent);
    expect(page.selectedTask()?.id).toBe('task-1');

    await harness.navigateByUrl('/tasks/task-2');

    expect(harness.routeDebugElement?.componentInstance).toBe(page);
    expect(page.selectedTask()?.id).toBe('task-2');
    expect(TestBed.inject(Router).url).toBe('/tasks/task-2');
    expect(getUserTasks).toHaveBeenCalledTimes(1);
    expect(getTask).not.toHaveBeenCalled();
  });
});

@Component({
  selector: 'lib-acme-task-panel',
  standalone: true,
  template: `<p class="acme-task-panel">{{ task().id }}</p>`,
})
class AcmeTaskPanelComponent {
  readonly task = input.required<NuxeoTask>();
}

describe('TasksPageComponent with the task panel re-registered', () => {
  it('renders the registered component in place of the packaged panel', async () => {
    const task: NuxeoTask = {
      id: 'task-7',
      name: 'wf.x.review',
      directive: '',
      workflowInstanceId: '',
      workflowModelName: '',
      workflowTitle: '',
      created: '',
      dueDate: '',
      state: 'opened',
      nodeName: '',
      targetDocumentIds: [],
      actors: [],
      delegatedActors: [],
      comments: [],
      variables: {},
      taskInfo: { taskActions: [] },
    };
    TestBed.configureTestingModule({
      imports: [testTranslateModule(), TasksPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideSatoriExtensions({ components: { [NXS_TASK_DETAIL_ID]: AcmeTaskPanelComponent } }),
        {
          provide: TaskService,
          useValue: { getUserTasks: () => of([task]), getTask: () => of(task) },
        },
        { provide: DocumentService, useValue: { getById: () => of(null) } },
        { provide: NuxeoApiBase, useValue: { apiUrl: (path: string) => path } },
        { provide: HttpClient, useValue: { get: () => of(new Blob()) } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true), url: '/tasks' } },
        { provide: ActivatedRoute, useValue: new FakeTaskRoute() },
        { provide: CURRENT_USERNAME, useValue: signal('Administrator') },
      ],
    });
    const page = TestBed.createComponent(TasksPageComponent);
    page.detectChanges();
    await page.whenStable();
    page.detectChanges();
    const host = page.nativeElement as HTMLElement;
    expect(host.querySelector('.task-form-panel .acme-task-panel')?.textContent).toBe('task-7');
    expect(host.querySelector('nxs-task-detail')).toBeNull();
  });
});
