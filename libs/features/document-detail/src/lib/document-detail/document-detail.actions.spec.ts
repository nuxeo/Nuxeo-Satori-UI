import { ComponentFixture, TestBed } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
  withDisabledInitialNavigation,
} from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import {
  ARenderService,
  BrowseService,
  CURRENT_USERNAME,
  CLIPBOARD_STORAGE_KEY,
  ContentLakeIngestService,
  DirectoryService,
  DocumentDetailService,
  NuxeoApiBase,
  TagService,
  TaskService,
  WorkflowService,
  type NuxeoAce,
  type NuxeoDocument,
  type NuxeoTask,
  type NuxeoWorkflow,
} from '@nuxeo-satori/platform/nuxeo-client';
import { KdClientService } from '@agentic-ui/shared/kd-client';
import {
  AiChatService,
  AiFeatureFlagService,
  AiGatewayService,
} from '@agentic-ui/shared/ai-client';
import { KeClientService, type KeEnrichmentResult } from '@agentic-ui/shared/ke-client';
import {
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  ExtensionRuleContextService,
  PACKAGED_DOCUMENT_TABS,
  PACKAGED_DOCUMENT_TOOLBAR_ACTIONS,
  provideSatoriExtensions,
  type ExtensionActionDescriptor,
} from '@nuxeo-satori/platform/extensions';

import { DocumentDetailComponent } from './document-detail';
import { NxsToastService } from '@nuxeo-satori/platform/components';

/**
 * Toolbar behaviour, document actions, and the dialogs they open.
 *
 * The load chain is covered in `document-detail.load.spec.ts`; this file starts from a
 * document that has already arrived and drives what a user can then do to it. Every
 * assertion is on a signal the template reads, on the payload handed to a dialog, or on
 * the argument a service was called with — never on "a spy fired".
 */

function doc(over: Partial<NuxeoDocument> = {}): NuxeoDocument {
  return {
    uid: 'doc-1',
    title: 'Test Document',
    type: 'File',
    path: '/default-domain/workspaces/ws/test-document',
    state: 'project',
    lastModified: '2026-08-24T10:00:00.000Z',
    properties: {},
    contextParameters: { permissions: ['Read', 'Write', 'ReadWrite', 'Everything', 'Remove'] },
    ...over,
  };
}

function ace(over: Partial<NuxeoAce> = {}): NuxeoAce {
  return {
    id: 'ace-1',
    username: 'alice',
    externalUser: false,
    permission: 'ReadWrite',
    granted: true,
    creator: 'bob',
    begin: null,
    end: null,
    status: 'effective',
    ...over,
  };
}

function task(over: Partial<NuxeoTask> = {}): NuxeoTask {
  return {
    id: 'task-1',
    name: 'wf.serialDocumentReview.AcceptReject',
    directive: '',
    workflowInstanceId: 'wf-1',
    workflowModelName: 'SerialDocumentReview',
    workflowTitle: 'Serial review',
    created: '2026-08-20T10:00:00.000Z',
    dueDate: '2026-09-01T10:00:00.000Z',
    state: 'opened',
    nodeName: 'review',
    targetDocumentIds: [],
    actors: [],
    delegatedActors: [],
    comments: [],
    variables: {},
    taskInfo: { taskActions: [] },
    ...over,
  };
}

function workflow(over: Partial<NuxeoWorkflow> = {}): NuxeoWorkflow {
  return {
    'entity-type': 'workflow',
    id: 'wf-1',
    name: 'SerialDocumentReview',
    title: 'wf.serialDocumentReview.title',
    state: 'running',
    workflowModelName: 'SerialDocumentReview',
    initiator: 'alice',
    attachedDocumentIds: [],
    variables: {},
    ...over,
  };
}

interface DialogRefLike {
  afterClosed: () => Observable<unknown>;
}

const emptyKe = (): Observable<KeEnrichmentResult> =>
  of({ textClassification: { result: '' } } as KeEnrichmentResult);

const mockDetailService = {
  getFullDocument: vi.fn((): Observable<NuxeoDocument> => of(doc())),
  fetchBlob: vi.fn((): Observable<Blob> => of(new Blob(['x'], { type: 'text/plain' }))),
  fetchBlobByXpath: vi.fn((): Observable<Blob> => of(new Blob(['x']))),
  fetchThumbnail: vi.fn((): Observable<Blob> => of(new Blob(['thumb'], { type: 'image/png' }))),
  fetchPdfRendition: vi.fn((): Observable<Blob> =>
    of(new Blob(['pdf'], { type: 'application/pdf' })),
  ),
  exportXml: vi.fn((): Observable<Blob> => of(new Blob(['<xml/>'], { type: 'text/xml' }))),
  exportZip: vi.fn((): Observable<Blob> => of(new Blob(['zip'], { type: 'application/zip' }))),
  getAllComments: vi.fn((): Observable<{ entries: unknown[] }> => of({ entries: [] })),
  getVersions: vi.fn((): Observable<{ entries: NuxeoDocument[] }> => of({ entries: [] })),
  getPublishedVersions: vi.fn((): Observable<{ entries: NuxeoDocument[] }> => of({ entries: [] })),
  getSectionTree: vi.fn((): Observable<{ entries: NuxeoDocument[] }> => of({ entries: [] })),
  getRunnableWorkflows: vi.fn((): Observable<unknown[]> => of([])),
  getAuditLog: vi.fn((): Observable<{ entries: unknown[]; resultsCount: number }> =>
    of({ entries: [], resultsCount: 0 }),
  ),
  getDocumentPermissions: vi.fn((): Observable<NuxeoDocument> => of(doc())),
  publishDocument: vi.fn((): Observable<unknown> => of({})),
  restoreVersion: vi.fn((): Observable<unknown> => of({})),
  lockDocument: vi.fn((): Observable<unknown> => of({})),
  unlockDocument: vi.fn((): Observable<unknown> => of({})),
  subscribe: vi.fn((): Observable<void> => of(undefined)),
  unsubscribe: vi.fn((): Observable<void> => of(undefined)),
  addToFavorites: vi.fn((): Observable<void> => of(undefined)),
  removeFromFavorites: vi.fn((): Observable<void> => of(undefined)),
  addToCollection: vi.fn((): Observable<void> => of(undefined)),
  trashDocument: vi.fn((): Observable<void> => of(undefined)),
  restoreFromTrash: vi.fn((): Observable<void> => of(undefined)),
  permanentlyDelete: vi.fn((): Observable<void> => of(undefined)),
  sendNotificationEmailForPermission: vi.fn((): Observable<unknown> => of({})),
  blockPermissionInheritance: vi.fn((): Observable<void> => of(undefined)),
  unblockPermissionInheritance: vi.fn((): Observable<void> => of(undefined)),
  uploadAttachment: vi.fn((): Observable<unknown> => of({})),
};

const mockWorkflowService = {
  getDocumentWorkflows: vi.fn((): Observable<NuxeoWorkflow[]> => of([])),
  startWorkflow: vi.fn((): Observable<unknown> => of({})),
  cancelWorkflow: vi.fn((): Observable<void> => of(undefined)),
};

const mockDialog = {
  open: vi.fn((_component: unknown, _config?: { data?: unknown }): DialogRefLike => ({
    afterClosed: () => of(undefined),
  })),
};

describe('DocumentDetailComponent — toolbar actions and dialogs', () => {
  let component: DocumentDetailComponent;
  let fixture: ComponentFixture<DocumentDetailComponent>;
  let ruleContext: ExtensionRuleContextService;
  let actionRegistry: ExtensionActionRegistry;
  let toast: { show: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  const revoked: string[] = [];
  let seq = 0;
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(
    () => `blob:mock/${(seq += 1)}`,
  );
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn((u: string) => {
    revoked.push(u);
  });

  async function build(initial: NuxeoDocument = doc()): Promise<void> {
    mockDetailService.getFullDocument.mockReturnValue(of(initial));
    fixture = TestBed.createComponent(DocumentDetailComponent);
    component = fixture.componentInstance;
    ruleContext = TestBed.inject(ExtensionRuleContextService);
    actionRegistry = TestBed.inject(ExtensionActionRegistry);
    await fixture.whenStable();
  }

  /**
   * The descriptor the component is currently offering for `id`.
   *
   * Deliberately looked up rather than hand-written: a handler that runs against a
   * descriptor no rule would ever surface is a handler no user can reach, so failing
   * here is the correct outcome.
   */
  function offered(id: string): ExtensionActionDescriptor {
    const found = [...component.toolbarActions(), ...component.overflowActions()].find(
      (a) => a.id === id,
    );
    if (!found) {
      throw new Error(`toolbar action "${id}" is not offered for this document`);
    }
    return found;
  }

  /** `data` from the most recent `MatDialog.open` call. */
  function lastDialogData(): unknown {
    return mockDialog.open.mock.calls.at(-1)?.[1]?.data;
  }

  function installDefaults(): void {
    mockDetailService.getFullDocument.mockReturnValue(of(doc()));
    mockDetailService.fetchBlob.mockReturnValue(of(new Blob(['x'], { type: 'text/plain' })));
    mockDetailService.fetchThumbnail.mockReturnValue(
      of(new Blob(['thumb'], { type: 'image/png' })),
    );
    mockDetailService.fetchPdfRendition.mockReturnValue(
      of(new Blob(['pdf'], { type: 'application/pdf' })),
    );
    mockDetailService.exportXml.mockReturnValue(of(new Blob(['<xml/>'], { type: 'text/xml' })));
    mockDetailService.exportZip.mockReturnValue(of(new Blob(['zip'], { type: 'application/zip' })));
    mockDetailService.getAllComments.mockReturnValue(of({ entries: [] }));
    mockDetailService.getVersions.mockReturnValue(of({ entries: [] }));
    mockDetailService.getPublishedVersions.mockReturnValue(of({ entries: [] }));
    mockDetailService.getSectionTree.mockReturnValue(of({ entries: [] }));
    mockDetailService.getRunnableWorkflows.mockReturnValue(of([]));
    mockDetailService.getAuditLog.mockReturnValue(of({ entries: [], resultsCount: 0 }));
    mockDetailService.lockDocument.mockReturnValue(of({}));
    mockDetailService.unlockDocument.mockReturnValue(of({}));
    mockDetailService.subscribe.mockReturnValue(of(undefined));
    mockDetailService.unsubscribe.mockReturnValue(of(undefined));
    mockDetailService.addToFavorites.mockReturnValue(of(undefined));
    mockDetailService.removeFromFavorites.mockReturnValue(of(undefined));
    mockDetailService.addToCollection.mockReturnValue(of(undefined));
    mockDetailService.restoreVersion.mockReturnValue(of({}));
    mockDetailService.uploadAttachment.mockReturnValue(of({}));
    mockWorkflowService.getDocumentWorkflows.mockReturnValue(of([]));
    mockWorkflowService.startWorkflow.mockReturnValue(of({}));
    mockWorkflowService.cancelWorkflow.mockReturnValue(of(undefined));
    mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(undefined) }));
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    revoked.length = 0;
    localStorage.removeItem(CLIPBOARD_STORAGE_KEY);
    toast = { show: vi.fn(), error: vi.fn() };
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    installDefaults();

    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), testTranslateModule(), DocumentDetailComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ uid: 'doc-1' })),
            queryParamMap: of(convertToParamMap({})),
            snapshot: { queryParamMap: convertToParamMap({}) },
          },
        },
        { provide: DocumentDetailService, useValue: mockDetailService },
        { provide: BrowseService, useValue: { updateDocument: vi.fn(() => of(doc())) } },
        {
          provide: DirectoryService,
          useValue: {
            getEventTypes: vi.fn(() => of([])),
            getEventCategories: vi.fn(() => of([])),
            getEntries: vi.fn(() => of([])),
            getAllL10nEntries: vi.fn(() => of([])),
          },
        },
        { provide: KeClientService, useValue: { enrich: emptyKe } },
        { provide: TaskService, useValue: { getDocumentTasks: vi.fn(() => of([])) } },
        { provide: WorkflowService, useValue: mockWorkflowService },
        {
          provide: ARenderService,
          useValue: { isAvailable: vi.fn(() => of(false)), getPreviewerUrl: vi.fn(() => of(null)) },
        },
        {
          provide: TagService,
          useValue: {
            searchTags: vi.fn(() => of([])),
            addTag: vi.fn(() => of({})),
            removeTag: vi.fn(() => of(undefined)),
          },
        },
        {
          provide: AiGatewayService,
          useValue: {
            summarize: vi.fn(() => of(null)),
            classify: vi.fn(() => of(null)),
            suggestTags: vi.fn(() => of({ tags: [] })),
            findSimilar: vi.fn(() => of({ documents: [] })),
            analyzeSentiment: vi.fn(() => of({ sentiments: [], threadSummary: null })),
          },
        },
        { provide: AiChatService, useValue: { openPanel: vi.fn() } },
        { provide: AiFeatureFlagService, useValue: { aiEnabled: signal(false) } },
        { provide: NuxeoApiBase, useValue: { nxqlSearch: vi.fn(() => of({ entries: [] })) } },
        {
          provide: ContentLakeIngestService,
          useValue: {
            startIngest: vi.fn(() => of({ commandId: 'c1' })),
            waitUntilComplete: vi.fn(() => of({})),
            markIngested: vi.fn(() => of([])),
            backfillIngestMarkerIfNeeded: vi.fn(() =>
              of({ doc: null, presentInContentLake: false }),
            ),
          },
        },
        { provide: KdClientService, useValue: { listIngestSourceIds: vi.fn(() => of([])) } },
        { provide: CURRENT_USERNAME, useValue: () => 'tester' },
        { provide: MatDialog, useValue: mockDialog },
        provideSatoriExtensions({
          slots: {
            [EXTENSION_SLOTS.toolbar]: PACKAGED_DOCUMENT_TOOLBAR_ACTIONS,
            [EXTENSION_SLOTS.tabs]: PACKAGED_DOCUMENT_TABS,
          },
        }),
      ],
    })
      .overrideComponent(DocumentDetailComponent, {
        set: { imports: [], template: '<div></div>' },
      })
      .compileComponents();
  });

  describe('toolbar dispatch through the action registry', () => {
    it('locks the document when the registered Lock handler runs', async () => {
      await build();

      component.runToolbarAction(offered('app.toolbar.lock'));

      expect(mockDetailService.lockDocument).toHaveBeenCalledWith('doc-1');
      expect(component.isLocked()).toBe(true);
      expect(component.actionInProgress()).toBeNull();
      expect(toast.show).toHaveBeenCalledWith('Document locked');
    });

    it('offers Unlock rather than Lock once the document is locked', async () => {
      await build(doc({ lockOwner: 'alice' }));

      expect(component.toolbarActions().map((a) => a.id)).toContain('app.toolbar.unlock');
      expect(component.toolbarActions().map((a) => a.id)).not.toContain('app.toolbar.lock');

      component.runToolbarAction(offered('app.toolbar.unlock'));

      expect(mockDetailService.unlockDocument).toHaveBeenCalledWith('doc-1');
      expect(component.isLocked()).toBe(false);
    });

    it('stops answering for its ids once the component is destroyed', async () => {
      await build();
      const lock = offered('app.toolbar.lock');
      const context = ruleContext.context();

      fixture.destroy();
      mockDetailService.lockDocument.mockClear();
      actionRegistry.execute(lock, context);

      // A handler left registered keeps a destroyed component reachable and runs
      // against dead state on the next invocation.
      expect(mockDetailService.lockDocument).not.toHaveBeenCalled();
    });

    it('runs a customer handler registered under a packaged id in preference to ours', async () => {
      const customerRuns: string[] = [];
      TestBed.inject(ExtensionActionRegistry).register({
        'app.toolbar.lock': { execute: () => customerRuns.push('acme') },
      });

      await build();
      component.runToolbarAction(offered('app.toolbar.lock'));

      // Layer 2's whole promise: a customer replaces a packaged action's behaviour
      // by registering under its published id, without forking.
      expect(customerRuns).toEqual(['acme']);
      expect(mockDetailService.lockDocument).not.toHaveBeenCalled();
    });

    it('leaves a customer handler registered under a packaged id alive after destroy', async () => {
      const customerRuns: string[] = [];
      TestBed.inject(ExtensionActionRegistry).register({
        'app.toolbar.lock': { execute: () => customerRuns.push('acme') },
      });

      await build();
      const lock = offered('app.toolbar.lock');
      const context = ruleContext.context();

      fixture.destroy();

      // Withdrawing our own handlers must not take the customer's with them, or the
      // first navigation away from a document silently deletes their override.
      expect(actionRegistry.execute(lock, context)).toBe(true);
      expect(customerRuns).toEqual(['acme']);
      expect(mockDetailService.lockDocument).not.toHaveBeenCalled();
    });

    it('reports Delete as disabled while a trash operation is in flight', async () => {
      await build();
      component.actionInProgress.set('trash');
      await fixture.whenStable();

      expect(component.isToolbarActionEnabled(offered('app.toolbar.delete'))).toBe(false);
    });
  });

  describe('lock', () => {
    it('records the acting user as the lock owner, not a hardcoded account', async () => {
      await build();

      component.toggleLock();

      expect(component.lockOwner()).toBe('tester');
    });

    it('clears the lock owner when unlocking', async () => {
      await build(doc({ lockOwner: 'tester' }));
      expect(component.isLocked()).toBe(true);

      component.toggleLock();

      expect(component.lockOwner()).toBeNull();
      expect(toast.show).toHaveBeenCalledWith('Document unlocked');
    });

    it('leaves the lock state untouched and releases the flag when the call fails', async () => {
      await build();
      mockDetailService.lockDocument.mockReturnValue(throwError(() => new Error('denied')));

      component.toggleLock();

      expect(component.isLocked()).toBe(false);
      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to toggle lock');
    });

    it('refuses to lock a document the user cannot write', async () => {
      await build(doc({ contextParameters: { permissions: ['Read'] } }));

      component.toggleLock();

      expect(mockDetailService.lockDocument).not.toHaveBeenCalled();
      expect(component.isLocked()).toBe(false);
    });

    it('ignores a second lock request while the first is still in flight', async () => {
      await build();
      mockDetailService.lockDocument.mockReturnValue(NEVER);

      component.toggleLock();
      component.toggleLock();

      expect(mockDetailService.lockDocument).toHaveBeenCalledTimes(1);
      expect(component.actionInProgress()).toBe('lock');
    });
  });

  describe('favourite', () => {
    it('marks the document favourite and tells the rest of the app', async () => {
      await build();
      const heard: string[] = [];
      const listener = (): void => void heard.push('favorites-changed');
      window.addEventListener('favorites-changed', listener);

      component.toggleFavorite();
      window.removeEventListener('favorites-changed', listener);

      expect(mockDetailService.addToFavorites).toHaveBeenCalledWith('doc-1');
      expect(component.isFavorite()).toBe(true);
      // The nav star elsewhere in the shell only refreshes on this event.
      expect(heard).toEqual(['favorites-changed']);
    });

    it('removes an existing favourite', async () => {
      await build(
        doc({
          contextParameters: { permissions: ['Read'], favorites: { isFavorite: true } },
        }),
      );
      expect(component.isFavorite()).toBe(true);

      component.toggleFavorite();

      expect(mockDetailService.removeFromFavorites).toHaveBeenCalledWith('doc-1');
      expect(component.isFavorite()).toBe(false);
    });

    it('leaves the flag alone when the call fails', async () => {
      await build();
      mockDetailService.addToFavorites.mockReturnValue(throwError(() => new Error('boom')));

      component.toggleFavorite();

      expect(component.isFavorite()).toBe(false);
      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to update favorites');
    });
  });

  describe('subscription', () => {
    it('subscribes to notifications', async () => {
      await build();

      component.runToolbarAction(offered('app.toolbar.subscribe'));

      expect(mockDetailService.subscribe).toHaveBeenCalledWith('doc-1');
      expect(component.isSubscribed()).toBe(true);
      expect(toast.show).toHaveBeenCalledWith('Notifications enabled');
    });

    it('unsubscribes a document that already has notifications', async () => {
      await build(
        doc({
          contextParameters: { permissions: ['Read'], subscribedNotifications: ['Modification'] },
        }),
      );
      expect(component.isSubscribed()).toBe(true);

      component.toggleSubscription();

      expect(mockDetailService.unsubscribe).toHaveBeenCalledWith('doc-1');
      expect(component.isSubscribed()).toBe(false);
    });

    it('leaves the flag alone when the call fails', async () => {
      await build();
      mockDetailService.subscribe.mockReturnValue(throwError(() => new Error('500')));

      component.toggleSubscription();

      expect(component.isSubscribed()).toBe(false);
      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to update notifications');
    });
  });

  describe('clipboard', () => {
    it('adds the document to the clipboard and persists it', async () => {
      await build(doc({ title: 'Clip me' }));

      component.toggleClipboard();

      expect(component.isInClipboard()).toBe(true);
      expect(component.clipboardDocs()).toEqual([{ uid: 'doc-1', title: 'Clip me', type: 'File' }]);
      // Survives a reload only if it reached storage.
      expect(JSON.parse(localStorage.getItem(CLIPBOARD_STORAGE_KEY) ?? '[]')).toEqual([
        { uid: 'doc-1', title: 'Clip me', type: 'File' },
      ]);
    });

    it('removes the document again on a second toggle', async () => {
      await build();

      component.toggleClipboard();
      component.toggleClipboard();

      expect(component.isInClipboard()).toBe(false);
      expect(component.clipboardDocs()).toEqual([]);
      expect(JSON.parse(localStorage.getItem(CLIPBOARD_STORAGE_KEY) ?? '[]')).toEqual([]);
    });

    it('does nothing when there is no document on screen', async () => {
      mockDetailService.getFullDocument.mockReturnValue(throwError(() => new Error('403')));
      fixture = TestBed.createComponent(DocumentDetailComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();

      component.toggleClipboard();

      expect(component.clipboardDocs()).toEqual([]);
    });
  });

  describe('rule context flags', () => {
    it('publishes the interface state the Layer 1 toolbar rules read', async () => {
      await build(
        doc({
          type: 'Note',
          properties: { 'note:note': 'hi', 'uid:major_version': 2 },
          contextParameters: {
            permissions: ['Read'],
            favorites: { isFavorite: true },
            subscribedNotifications: ['Modification'],
          },
          lockOwner: 'alice',
        }),
      );
      await fixture.whenStable();

      // No `note` flag: `app.rules.isNote` reads the document's type, which is not interface
      // state, so this bag does not repeat it.
      expect(ruleContext.flags()).toEqual({
        favorite: true,
        locked: true,
        subscribed: true,
        inClipboard: false,
        hasVersion: true,
        aiEnabled: false,
      });
      expect(ruleContext.document()?.type).toBe('Note');
    });

    it('publishes a busy flag naming the operation in flight', async () => {
      await build();
      mockDetailService.lockDocument.mockReturnValue(NEVER);

      component.toggleLock();
      await fixture.whenStable();

      expect(ruleContext.flags()['busy.lock']).toBe(true);
    });

    it('publishes the focused document and clears it on destroy', async () => {
      await build(doc({ title: 'In focus' }));
      await fixture.whenStable();
      expect(ruleContext.document()?.title).toBe('In focus');

      fixture.destroy();

      // A stale document would let a rule on another page answer about it.
      expect(ruleContext.document()).toBeNull();
      expect(ruleContext.flags()).toEqual({});
    });
  });

  describe('edit dialog', () => {
    it('shows the edited document and refetches it', async () => {
      await build();
      const edited = doc({ title: 'Renamed' });
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(edited) }));
      mockDetailService.getFullDocument.mockClear();
      mockDetailService.getFullDocument.mockReturnValue(of(edited));

      component.onEditClick();

      expect(component.doc()?.title).toBe('Renamed');
      expect(mockDetailService.getFullDocument).toHaveBeenCalledWith('doc-1');
      expect(toast.show).toHaveBeenCalledWith('Document updated');
    });

    it('leaves the document alone when the dialog is dismissed', async () => {
      await build(doc({ title: 'Original' }));
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(undefined) }));

      component.onEditClick();

      expect(component.doc()?.title).toBe('Original');
      expect(toast.show).not.toHaveBeenCalledWith('Document updated');
    });

    it('refuses to open for a document the user cannot write', async () => {
      await build(doc({ contextParameters: { permissions: ['Read'] } }));
      mockDialog.open.mockClear();

      component.openEditDialog();

      expect(mockDialog.open).not.toHaveBeenCalled();
    });
  });

  describe('add to collection', () => {
    it('adds the document to the chosen collection', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of('col-9') }));

      component.openAddToCollectionDialog();

      expect(mockDetailService.addToCollection).toHaveBeenCalledWith('doc-1', 'col-9');
      expect(component.actionInProgress()).toBeNull();
      expect(toast.show).toHaveBeenCalledWith('Added to collection');
    });

    it('does nothing when no collection is chosen', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(undefined) }));

      component.openAddToCollectionDialog();

      expect(mockDetailService.addToCollection).not.toHaveBeenCalled();
    });

    it('releases the in-progress flag when the add fails', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of('col-9') }));
      mockDetailService.addToCollection.mockReturnValue(throwError(() => new Error('denied')));

      component.openAddToCollectionDialog();

      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to add to collection');
    });
  });

  describe('share and export', () => {
    it('hands the share dialog this document title and the current URL', async () => {
      await build(doc({ title: 'Shared thing' }));

      component.shareDocument();

      expect(lastDialogData()).toEqual({
        title: 'Shared thing',
        url: window.location.href,
      });
    });

    it('exports each requested rendition through the matching service call', async () => {
      await build();
      component.exportDocument();
      const data = lastDialogData() as {
        documentUid: string;
        exportFn: (type: string, uid: string) => Observable<Blob>;
      };

      expect(data.documentUid).toBe('doc-1');

      const collect = async (type: string): Promise<string> => {
        const blob = await new Promise<Blob>((resolve) =>
          data.exportFn(type, 'doc-1').subscribe(resolve),
        );
        return blob.text();
      };

      expect(await collect('thumbnail')).toBe('thumb');
      expect(await collect('pdf')).toBe('pdf');
      expect(await collect('zip')).toBe('zip');
      expect(await collect('xml')).toBe('<xml/>');
    });

    it('names the zip after the document title', async () => {
      await build(doc({ title: 'Quarterly report' }));
      component.exportDocument();
      const data = lastDialogData() as {
        exportFn: (type: string, uid: string) => Observable<Blob>;
      };

      data.exportFn('zip', 'doc-1').subscribe();

      expect(mockDetailService.exportZip).toHaveBeenCalledWith('doc-1', 'Quarterly report.zip');
    });
  });

  describe('drive dialog', () => {
    it('opens Drive in the containing folder', async () => {
      await build(
        doc({
          path: '/default-domain/workspaces/ws/report',
          properties: { 'file:content': { name: 'report.docx', data: '/nuxeo/blob/report' } },
        }),
      );

      component.openDriveDialog();

      expect(lastDialogData()).toEqual({ folderPath: '/default-domain/workspaces/ws' });
    });

    it('opens Drive at the repository root for a document directly under it', async () => {
      await build(doc({ title: 'No blob', path: '/x', properties: {} }));

      component.openDriveDialog();

      expect(lastDialogData()).toEqual({ folderPath: '/' });
    });
  });

  describe('download', () => {
    it('saves the blob under the document filename and frees the object URL', async () => {
      const clicks: Array<{ download: string; href: string }> = [];
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        clicks.push({ download: this.download, href: this.href });
      });
      await build(
        doc({ properties: { 'file:content': { name: 'invoice.pdf', 'mime-type': 'text/plain' } } }),
      );

      component.download();

      expect(mockDetailService.fetchBlob).toHaveBeenCalledWith('doc-1', {
        clientReason: 'download',
      });
      expect(clicks).toHaveLength(1);
      expect(clicks[0].download).toBe('invoice.pdf');
      // The temporary URL for the saved copy must not outlive the click.
      expect(revoked).toContain(clicks[0].href);
      clickSpy.mockRestore();
    });

    it('reports a failed download instead of failing silently', async () => {
      await build();
      mockDetailService.fetchBlob.mockReturnValue(throwError(() => new Error('500')));

      component.download();

      expect(toast.error).toHaveBeenCalledWith('Failed to download document');
    });
  });

  describe('main blob preview', () => {
    it('does not open a viewer when no blob has been loaded', async () => {
      await build(doc({ type: 'Section', path: '/default-domain/sections/s', properties: {} }));
      mockDialog.open.mockClear();

      component.previewMainBlob();

      expect(mockDialog.open).not.toHaveBeenCalled();
    });

    it('opens the viewer with the filename and mime type of the loaded blob', async () => {
      await build(
        doc({
          properties: {
            'file:content': { name: 'photo.png', 'mime-type': 'image/png', length: 10 },
          },
        }),
      );
      mockDialog.open.mockClear();

      component.previewMainBlob();

      expect(lastDialogData()).toMatchObject({ name: 'photo.png', mimeType: 'image/png' });
    });
  });

  describe('versions', () => {
    const version = (major: number, minor: number): NuxeoDocument =>
      doc({
        uid: `v-${major}-${minor}`,
        properties: { 'uid:major_version': major, 'uid:minor_version': minor },
      });

    it('loads the version list the first time the dropdown opens and not again', async () => {
      mockDetailService.getVersions.mockReturnValue(of({ entries: [version(1, 0)] }));
      await build();

      component.toggleVersionDropdown();

      expect(component.versionDropdownOpen()).toBe(true);
      expect(component.versions().map((v) => component.versionString(v))).toEqual(['1.0']);

      component.toggleVersionDropdown();
      component.toggleVersionDropdown();

      expect(mockDetailService.getVersions).toHaveBeenCalledTimes(1);
    });

    it('clears the loading flag when the version list fails so the user can retry', async () => {
      mockDetailService.getVersions.mockReturnValue(throwError(() => new Error('500')));
      await build();

      component.toggleVersionDropdown();

      expect(component.versionsLoading()).toBe(false);
      expect(component.versions()).toEqual([]);

      mockDetailService.getVersions.mockReturnValue(of({ entries: [version(2, 0)] }));
      component.toggleVersionDropdown();
      component.toggleVersionDropdown();

      expect(component.versions()).toHaveLength(1);
    });

    it('restores a version, closes the dropdown and reloads the document', async () => {
      await build();
      component.versionDropdownOpen.set(true);
      mockDetailService.getFullDocument.mockClear();

      component.restoreVersion(version(3, 1));

      expect(mockDetailService.restoreVersion).toHaveBeenCalledWith('v-3-1');
      expect(component.versionDropdownOpen()).toBe(false);
      expect(component.actionInProgress()).toBeNull();
      expect(mockDetailService.getFullDocument).toHaveBeenCalledWith('doc-1');
      expect(toast.show).toHaveBeenCalledWith('Restored to version 3.1');
    });

    it('releases the in-progress flag when the restore fails', async () => {
      await build();
      mockDetailService.restoreVersion.mockReturnValue(throwError(() => new Error('conflict')));

      component.restoreVersion(version(1, 0));

      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to restore version');
    });

    it('refuses to restore a version without the write permission', async () => {
      await build(doc({ contextParameters: { permissions: ['Read'] } }));

      component.restoreVersion(version(1, 0));

      expect(mockDetailService.restoreVersion).not.toHaveBeenCalled();
    });

    it('reloads the document after a version is created', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(true) }));
      mockDetailService.getFullDocument.mockClear();

      component.openCreateVersionDialog();

      expect(mockDetailService.getFullDocument).toHaveBeenCalledWith('doc-1');
      expect(mockDetailService.getVersions).toHaveBeenCalled();
    });
  });

  describe('publish dialog', () => {
    it('fetches the versions the dialog needs before opening it', async () => {
      const v = doc({ uid: 'v1', properties: { 'uid:major_version': 1 } });
      mockDetailService.getVersions.mockReturnValue(of({ entries: [v] }));
      await build(doc({ properties: { 'uid:major_version': 1 } }));
      mockDialog.open.mockClear();

      component.openPublishDialog();

      expect(lastDialogData()).toMatchObject({ documentUid: 'doc-1', versions: [v] });
    });

    it('still opens the dialog with no versions when the fetch fails', async () => {
      mockDetailService.getVersions.mockReturnValue(throwError(() => new Error('500')));
      await build();
      mockDialog.open.mockClear();

      component.openPublishDialog();

      expect(lastDialogData()).toMatchObject({ versions: [] });
    });

    it('offers the renditions the document actually has', async () => {
      await build(
        doc({
          contextParameters: {
            permissions: ['Read', 'Write', 'ReadWrite', 'Everything', 'Remove'],
            renditions: [{ name: 'pdf' }, { name: 'custom' }],
          },
        }),
      );
      mockDialog.open.mockClear();

      component.openPublishDialog();

      expect(lastDialogData()).toMatchObject({
        renditions: [
          { name: 'pdf', label: 'PDF' },
          { name: 'custom', label: 'custom' },
        ],
      });
    });

    it('falls back to the four standard renditions when the enricher is absent', async () => {
      await build();
      mockDialog.open.mockClear();

      component.openPublishDialog();

      expect(lastDialogData()).toMatchObject({
        renditions: [
          { name: 'thumbnail', label: 'Thumbnail' },
          { name: 'pdf', label: 'PDF' },
          { name: 'zipExport', label: 'ZIP Export' },
          { name: 'xmlExport', label: 'XML Export' },
        ],
      });
    });

    it('refuses to open for a document the user cannot write', async () => {
      await build(doc({ contextParameters: { permissions: ['Read'] } }));
      mockDialog.open.mockClear();

      component.openPublishDialog();

      expect(mockDialog.open).not.toHaveBeenCalled();
    });
  });

  describe('workflow', () => {
    const model = { 'entity-type': 'workflowModel' as const, name: 'Review', title: 'Review' };

    it('lists the runnable workflows when the panel opens', async () => {
      mockDetailService.getRunnableWorkflows.mockReturnValue(of([model]));
      await build();

      component.openStartProcess();

      expect(component.showStartProcessPanel()).toBe(true);
      expect(component.availableWorkflows()).toEqual([model]);
      expect(component.workflowsLoading()).toBe(false);
    });

    it('shows an empty list and stops loading when the workflow lookup fails', async () => {
      mockDetailService.getRunnableWorkflows.mockReturnValue(throwError(() => new Error('500')));
      await build();

      component.openStartProcess();

      expect(component.availableWorkflows()).toEqual([]);
      expect(component.workflowsLoading()).toBe(false);
    });

    it('starts the selected workflow and closes the panel', async () => {
      await build();
      component.openStartProcess();
      component.selectedWorkflowModel.set('Review');

      component.startProcess();

      expect(mockWorkflowService.startWorkflow).toHaveBeenCalledWith('doc-1', 'Review');
      expect(component.showStartProcessPanel()).toBe(false);
      expect(component.selectedWorkflowModel()).toBe('');
      expect(component.startingWorkflow()).toBe(false);
    });

    it('does not call the server when no workflow is selected', async () => {
      await build();
      component.selectedWorkflowModel.set('');

      component.startProcess();

      expect(mockWorkflowService.startWorkflow).not.toHaveBeenCalled();
    });

    it('keeps the panel open when starting a workflow fails', async () => {
      mockWorkflowService.startWorkflow.mockReturnValue(throwError(() => new Error('500')));
      await build();
      component.openStartProcess();
      component.selectedWorkflowModel.set('Review');

      component.startProcess();

      expect(component.showStartProcessPanel()).toBe(true);
      expect(component.startingWorkflow()).toBe(false);
      expect(toast.error).toHaveBeenCalledWith('Failed to start workflow');
    });

    it('refreshes the workflow list after abandoning one', async () => {
      const wf = workflow();
      mockWorkflowService.getDocumentWorkflows.mockReturnValue(of([wf]));
      await build();
      mockWorkflowService.getDocumentWorkflows.mockReturnValue(of([]));

      component.abandonWorkflow(wf);

      expect(mockWorkflowService.cancelWorkflow).toHaveBeenCalledWith('wf-1');
      expect(component.documentWorkflows()).toEqual([]);
      expect(component.abandoningWorkflow()).toBe(false);
    });

    it('releases the abandoning flag when the cancel fails', async () => {
      mockWorkflowService.cancelWorkflow.mockReturnValue(throwError(() => new Error('500')));
      await build();

      component.abandonWorkflow(workflow());

      expect(component.abandoningWorkflow()).toBe(false);
      expect(toast.error).toHaveBeenCalledWith('Failed to abandon workflow.');
    });

    it('turns an i18n task key into a readable label', async () => {
      await build();

      expect(component.taskLabel(task())).toBe('Accept Reject');
      expect(component.taskLabel(task({ name: 'wf.review.chooseParticipants.title' }))).toBe(
        'Choose Participants',
      );
    });

    it('names a workflow from its model rather than its i18n title', async () => {
      await build();

      expect(component.workflowDisplayName(workflow())).toBe('Serial Document Review');
      expect(
        component.workflowDisplayName({
          name: 'wf.x.ParallelReview',
          title: 'wf.x.ParallelReview',
        }),
      ).toBe('Parallel Review');
    });

    it('renders a task due date and nothing at all when there is none', async () => {
      await build();

      expect(component.taskDueLabel(task({ dueDate: '2026-09-01T00:00:00.000Z' }))).toContain(
        '2026',
      );
      expect(component.taskDueLabel(task({ dueDate: '' }))).toBe('');
    });

    it('navigates to the task surface', async () => {
      await build();
      const spy = vi.spyOn(Router.prototype, 'navigateByUrl');

      component.goToTask(task({ id: 'task-9' }));

      expect(spy).toHaveBeenCalledWith('/tasks/task-9');
      spy.mockRestore();
    });
  });

  describe('permission display helpers', () => {
    it('translates known permissions and passes unknown ones through', async () => {
      await build();

      expect(component.permissionLabel('ReadWrite')).toBe('Edit');
      expect(component.permissionLabel('Everything')).toBe('Manage everything');
      expect(component.permissionLabel('CustomPermission')).toBe('CustomPermission');
    });

    it('describes an unbounded grant as permanent and a bounded one by its dates', async () => {
      await build();

      expect(component.aceTimeFrame(ace())).toBe('Permanent');
      // `From`/`Until` come from `permissions.time-frame.*` now. They used to be interpolated
      // English (`from ${date}`), which is why no locale could change them.
      expect(component.aceTimeFrame(ace({ begin: '2026-01-01' }))).toMatch(
        /^From \w{3} \d{2}, 2026$/,
      );
      expect(component.aceTimeFrame(ace({ end: '2026-12-31' }))).toMatch(
        /^Until \w{3} \d{2}, 2026$/,
      );
    });

    it('strips the transient prefix from a shared-link principal', async () => {
      await build();

      expect(component.displayUsername(ace({ username: 'transient/alice' }))).toBe('alice');
      expect(component.displayUsername(ace({ username: 'bob' }))).toBe('bob');
    });

    it('shows a dash when nobody is recorded as the grantor', async () => {
      await build();

      expect(component.aceGrantedBy(ace({ creator: 'bob' }))).toBe('bob');
      expect(component.aceGrantedBy(ace({ creator: null }))).toBe('—');
    });

    it('keeps only the external grants, which the host shows beside the panel', async () => {
      await build(
        doc({
          contextParameters: {
            permissions: ['Everything'],
            acls: [
              {
                name: 'local',
                aces: [
                  ace({ id: 'a', username: 'alice' }),
                  ace({ id: 'b', username: 'blocked', granted: false }),
                  ace({ id: 'c', username: 'transient/ext', externalUser: true }),
                ],
              },
              { name: 'inherited', aces: [ace({ id: 'd', username: 'admins' })] },
            ],
          },
        }),
      );

      expect(component.externalAces().map((a) => a.id)).toEqual(['c']);
    });
  });

  describe('properties panel and breadcrumb', () => {
    it('closes and reopens the properties panel', async () => {
      await build();
      expect(component.propertiesPanelOpen()).toBe(true);

      component.closePropertiesPanel();
      expect(component.propertiesPanelOpen()).toBe(false);

      component.openPropertiesPanel();
      expect(component.propertiesPanelOpen()).toBe(true);
    });

    it('selects show/hide details label keys from panel open state (NXENG-766)', async () => {
      await build();
      expect(component.detailsPanelToggleLabelKey()).toBe('document-detail.hide-details');
      component.closePropertiesPanel();
      expect(component.detailsPanelToggleLabelKey()).toBe('document-detail.show-details');
      component.openPropertiesPanel();
      expect(component.detailsPanelToggleLabelKey()).toBe('document-detail.hide-details');
    });

    it('routes a breadcrumb anchor through the router instead of a full page load', async () => {
      await build();
      const spy = vi.spyOn(Router.prototype, 'navigateByUrl');
      const anchor = document.createElement('a');
      anchor.setAttribute('href', '/browse/workspaces');
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      anchor.dispatchEvent(event);

      component.onBreadcrumbClick(event);

      expect(event.defaultPrevented).toBe(true);
      expect(spy).toHaveBeenCalledWith('/browse/workspaces');
      spy.mockRestore();
    });

    it('leaves a click that hit no anchor alone', async () => {
      await build();
      const spy = vi.spyOn(Router.prototype, 'navigateByUrl');
      const div = document.createElement('div');
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      div.dispatchEvent(event);

      component.onBreadcrumbClick(event);

      expect(event.defaultPrevented).toBe(false);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('builds breadcrumb links for every ancestor folder but not the document itself', async () => {
      await build(doc({ path: '/default-domain/workspaces/ws/report', title: 'Report' }));

      expect(component.breadcrumbItems().map((i) => i.label)).toEqual([
        'default-domain',
        'workspaces',
        'ws',
      ]);
    });

    it('cycles tag colours so adjacent tags differ', async () => {
      await build();

      expect(component.tagCategory(0)).not.toBe(component.tagCategory(1));
      expect(component.tagCategory(0)).toBe(component.tagCategory(7));
    });
  });
});
