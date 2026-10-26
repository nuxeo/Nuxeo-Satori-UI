import { ComponentFixture, TestBed } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { HttpErrorResponse, provideHttpClient, withXhr } from '@angular/common/http';
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
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { BehaviorSubject, NEVER, Observable, Subject, of, throwError } from 'rxjs';
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
} from '@nuxeo/satori-platform/nuxeo-client';
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
} from '@nuxeo/satori-platform/extensions';

import { DocumentDetailComponent } from './document-detail';
import { NxsToastService } from '@nuxeo/satori-platform/components';

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
  getVersionsDirect: vi.fn((): Observable<NuxeoDocument[]> => of([])),
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
    const found = component.toolbarActions().find((a) => a.id === id);
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
    mockDetailService.getVersionsDirect.mockReturnValue(of([]));
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
      imports: [
        testTranslateModule(),
        testTranslateModule(),
        MatIconTestingModule,
        DocumentDetailComponent,
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        provideHttpClient(withXhr()),
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
            addTag: vi.fn(() => of([])),
            removeTag: vi.fn(() => of([])),
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

    describe('when a manifest has cleared the Lock rule', () => {
      /** What `rule: null` in an override leaves: the packaged descriptor, ungated. */
      function ungated(id: string): ExtensionActionDescriptor {
        const packaged = PACKAGED_DOCUMENT_TOOLBAR_ACTIONS.find((a) => a.id === id);
        if (!packaged) throw new Error(`no packaged action "${id}"`);
        const { rule: _cleared, ...rest } = packaged;
        return rest;
      }

      it('still reaches the handler for an ordinary document', async () => {
        await build();

        component.runToolbarAction(ungated('app.toolbar.lock'));

        expect(mockDetailService.lockDocument).toHaveBeenCalledWith('doc-1');
      });

      it('refuses to lock a version, on which an administrator keeps Write', async () => {
        await build(doc({ facets: ['Immutable', 'Versionable'] }));

        component.runToolbarAction(ungated('app.toolbar.lock'));

        expect(mockDetailService.lockDocument).not.toHaveBeenCalled();
        expect(component.isLocked()).toBe(false);
      });

      it('refuses to lock the repository root', async () => {
        await build(doc({ type: 'Root' }));

        component.runToolbarAction(ungated('app.toolbar.lock'));

        expect(mockDetailService.lockDocument).not.toHaveBeenCalled();
      });
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

  describe('lock owner and who may unlock', () => {
    const LOCKED_AT = '2026-08-24T10:00:00.000Z';
    /** What Nuxeo's lock policy leaves a non-owner with ReadWrite: Write is gone, Read is not. */
    const NON_OWNER_PERMISSIONS = ['Read', 'ReadWrite', 'ReadProperties', 'Browse'];
    const lockedByAlice = (permissions: string[] = ['Read', 'Write', 'ReadWrite']): NuxeoDocument =>
      doc({ lockOwner: 'alice', lockCreated: LOCKED_AT, contextParameters: { permissions } });

    it('opens a document locked earlier as locked, and remembers who holds it since when', async () => {
      await build(doc({ lockOwner: 'alice', lockCreated: LOCKED_AT }));

      expect(component.isLocked()).toBe(true);
      expect(component.lockOwner()).toBe('alice');
      expect(component.lockCreated()).toBe(LOCKED_AT);
    });

    it('treats a lock date with no owner as locked', async () => {
      await build(doc({ lockOwner: null, lockCreated: LOCKED_AT }));

      expect(component.isLocked()).toBe(true);
    });

    it('names the owner and the localised date in the Unlock tooltip', async () => {
      await build(lockedByAlice());

      expect(component.toolbarTooltip(offered('app.toolbar.unlock'))).toBe(
        'Locked by alice on August 24, 2026',
      );
    });

    it('leaves the tooltip to the label while the document is unlocked', async () => {
      await build();

      expect(component.toolbarTooltip(offered('app.toolbar.lock'))).toBeNull();
    });

    it('keeps a manifest tooltip that is deliberately empty', async () => {
      await build(lockedByAlice());

      const silenced = { ...offered('app.toolbar.unlock'), tooltip: '' };

      expect(component.toolbarTooltip(silenced)).toBe('');
    });

    it('lets a lock request from the previous document neither hold nor clear the busy flag', async () => {
      await build();
      const first = new Subject<NuxeoDocument>();
      mockDetailService.lockDocument.mockReturnValueOnce(first);
      component.toggleLock();

      // What the route handler does before it switches `docUid`.
      component['releaseLockRequest']();
      component['docUid'] = 'doc-2';
      expect(component.actionInProgress()).toBeNull();

      mockDetailService.lockDocument.mockReturnValueOnce(NEVER);
      component.toggleLock();
      first.next(doc({ lockOwner: 'tester', lockCreated: LOCKED_AT }));

      expect(mockDetailService.lockDocument).toHaveBeenLastCalledWith('doc-2');
      expect(component.actionInProgress()).toBe('lock');
      expect(component.isLocked()).toBe(false);
    });

    it('lets a tooltip a manifest sets win over the lock owner', async () => {
      await build(lockedByAlice());

      const relabelled = { ...offered('app.toolbar.unlock'), tooltip: 'Release the lock' };

      expect(component.toolbarTooltip(relabelled)).toBe('Release the lock');
    });

    /** nxs-document-toolbar names the button "Unlock. Locked by …" from these two (NXSAT-528). */
    it('hands the toolbar the Unlock label and who holds the lock as its tooltip', async () => {
      await build(lockedByAlice());

      const unlock = component.toolbarEntries().find((entry) => entry.id === 'app.toolbar.unlock');
      expect(unlock?.label).toBe('Unlock');
      expect(unlock?.tooltip).toBe('Locked by alice on August 24, 2026');
    });

    it('shows the closed padlock, marked active, while locked and the open one while unlocked', async () => {
      await build(lockedByAlice());
      const unlock = offered('app.toolbar.unlock');
      expect(unlock.icon).toBe('lock');
      expect(component.isToolbarActionActive(unlock)).toBe(true);

      component.toggleLock();
      await fixture.whenStable();

      const lock = offered('app.toolbar.lock');
      expect(lock.icon).toBe('unlocked');
      expect(component.isToolbarActionActive(lock)).toBe(false);
    });

    it('shows a locked document to a user the lock policy has left read-only, with Unlock disabled', async () => {
      await build(lockedByAlice(NON_OWNER_PERMISSIONS));

      const unlock = offered('app.toolbar.unlock');

      expect(component.isToolbarActionEnabled(unlock)).toBe(false);
      expect(component.toolbarTooltip(unlock)).toBe('Locked by alice on August 24, 2026');
    });

    it('does not run a disabled toolbar action', async () => {
      await build(lockedByAlice(NON_OWNER_PERMISSIONS));

      component.runToolbarAction(offered('app.toolbar.unlock'));

      expect(mockDetailService.unlockDocument).not.toHaveBeenCalled();
      expect(component.isLocked()).toBe(true);
    });

    it('enables Unlock for the lock owner', async () => {
      await build(doc({ lockOwner: 'tester', lockCreated: LOCKED_AT }));

      expect(component.isToolbarActionEnabled(offered('app.toolbar.unlock'))).toBe(true);
    });

    it('enables Unlock for an administrator on a lock another user holds', async () => {
      // An administrator keeps Write and Everything on a document another user locked.
      await build(lockedByAlice(['Read', 'Write', 'Everything', 'Unlock']));

      expect(component.isToolbarActionEnabled(offered('app.toolbar.unlock'))).toBe(true);
    });

    it('offers neither half to a read-only user on an unlocked document', async () => {
      await build(doc({ contextParameters: { permissions: ['Read'] } }));

      const ids = component.toolbarActions().map((a) => a.id);

      expect(ids).not.toContain('app.toolbar.lock');
      expect(ids).not.toContain('app.toolbar.unlock');
    });

    it('offers no lock control on a version, which carries the Immutable facet', async () => {
      await build(doc({ isVersion: true, facets: ['Immutable', 'Versionable'] }));

      const ids = component.toolbarActions().map((a) => a.id);

      expect(ids).not.toContain('app.toolbar.lock');
      expect(ids).not.toContain('app.toolbar.unlock');
    });

    it('offers no lock control on a locked immutable document', async () => {
      await build(doc({ lockOwner: 'alice', lockCreated: LOCKED_AT, facets: ['Immutable'] }));

      expect(component.toolbarActions().map((a) => a.id)).not.toContain('app.toolbar.unlock');
    });

    it('offers no lock control on the repository root', async () => {
      // No `Folderish` facet: the page hands folderish documents to browse before the toolbar
      // resolves, which would make this pass without the rule being consulted at all.
      await build(doc({ type: 'Root' }));

      expect(component.toolbarActions().map((a) => a.id)).not.toContain('app.toolbar.lock');
    });

    it('records the owner and date the server returns from Lock', async () => {
      await build();
      mockDetailService.lockDocument.mockReturnValue(
        of(doc({ lockOwner: 'tester', lockCreated: '2026-09-01T08:00:00.000Z' })),
      );

      component.toggleLock();
      await fixture.whenStable();

      expect(component.lockCreated()).toBe('2026-09-01T08:00:00.000Z');
      expect(component.toolbarTooltip(offered('app.toolbar.unlock'))).toBe(
        'Locked by tester on September 1, 2026',
      );
    });

    it('clears the lock date on unlock', async () => {
      await build(doc({ lockOwner: 'tester', lockCreated: LOCKED_AT }));

      component.toggleLock();

      expect(component.lockCreated()).toBeNull();
    });

    it.each([
      [
        'succeeds',
        (pending: Subject<NuxeoDocument>) =>
          pending.next(doc({ lockOwner: 'tester', lockCreated: LOCKED_AT })),
      ],
      [
        'is refused',
        (pending: Subject<NuxeoDocument>) => pending.error(new HttpErrorResponse({ status: 409 })),
      ],
    ])('ignores a Lock that %s after navigating to another document', async (_how, settle) => {
      await build();
      const pending = new Subject<NuxeoDocument>();
      mockDetailService.lockDocument.mockReturnValue(pending);

      component.toggleLock();
      component['docUid'] = 'doc-2';
      toast.show.mockClear();
      toast.error.mockClear();
      settle(pending);

      expect(mockDetailService.lockDocument).toHaveBeenCalledWith('doc-1');
      expect(component.isLocked()).toBe(false);
      expect(component.lockOwner()).toBeNull();
      expect(component.actionInProgress()).toBeNull();
      expect(toast.show).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it.each([
      [false, 409, 'Document already locked by another user, please refresh your page.'],
      [false, 403, "You don't have permission to lock this document."],
      [true, 409, "You can't unlock this document because it is locked by another user."],
      [true, 403, "You don't have permission to unlock this document."],
      [true, 500, 'Failed to toggle lock'],
    ])('locked=%s: explains a %i refusal specifically', async (locked, status, message) => {
      await build(locked ? doc({ lockOwner: 'tester', lockCreated: LOCKED_AT }) : doc());
      const refusal = throwError(() => new HttpErrorResponse({ status }));
      mockDetailService.lockDocument.mockReturnValue(refusal);
      mockDetailService.unlockDocument.mockReturnValue(refusal);

      component.toggleLock();

      expect(toast.error).toHaveBeenCalledWith(message);
      expect(component.isLocked()).toBe(locked);
      expect(component.actionInProgress()).toBeNull();
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

    it('does not mark the document it moved on to when the last one’s answer arrives', async () => {
      const route = new BehaviorSubject(convertToParamMap({ uid: 'doc-1' }));
      TestBed.overrideProvider(ActivatedRoute, {
        useValue: {
          paramMap: route,
          queryParamMap: of(convertToParamMap({})),
          snapshot: { queryParamMap: convertToParamMap({}) },
        },
      });
      await build();
      const answer = new Subject<undefined>();
      mockDetailService.addToFavorites.mockReturnValue(answer);
      component.toggleFavorite();

      mockDetailService.getFullDocument.mockReturnValue(of(doc({ uid: 'doc-2' })));
      route.next(convertToParamMap({ uid: 'doc-2' }));
      await fixture.whenStable();
      answer.next(undefined);
      answer.complete();

      expect(mockDetailService.addToFavorites).toHaveBeenCalledWith('doc-1');
      expect(component.isFavorite()).toBe(false);
      expect(component.actionInProgress()).toBeNull();
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
    const WITH_WRITE_VERSION = ['Read', 'Write', 'WriteVersion', 'ReadWrite', 'Remove'];
    const version = (major: number, minor: number): NuxeoDocument =>
      doc({
        uid: `v-${major}-${minor}`,
        isVersion: true,
        properties: { 'uid:major_version': major, 'uid:minor_version': minor },
        contextParameters: { permissions: WITH_WRITE_VERSION },
      });

    it('restores a version and reloads the document', async () => {
      await build();
      mockDetailService.getFullDocument.mockClear();

      component.restoreVersion(version(3, 1));

      expect(mockDetailService.restoreVersion).toHaveBeenCalledWith('v-3-1');
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

    it('refuses to restore a version without WriteVersion, which is what Nuxeo checks', async () => {
      await build();

      component.restoreVersion({
        ...version(1, 0),
        contextParameters: { permissions: ['Read', 'Write'] },
      });

      expect(mockDetailService.restoreVersion).not.toHaveBeenCalled();
    });

    it('returns to the live document after restoring the version it shows', async () => {
      await build();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      component.restoreVersion({ ...version(1, 0), versionableId: 'doc-live' });

      expect(navigate).toHaveBeenCalledWith(['/doc', 'doc-live']);
    });

    it('reloads the document after nxs-manage-versions created a version', async () => {
      await build();
      mockDetailService.getFullDocument.mockClear();

      component.onVersionCreated();

      expect(mockDetailService.getFullDocument).toHaveBeenCalledWith('doc-1');
    });
  });

  describe('publish dialog', () => {
    /** Web UI's `isPublishable`: the `Publishable` facet and `WriteVersion`. */
    const publishable = (over: Partial<NuxeoDocument> = {}): NuxeoDocument =>
      doc({
        facets: ['Publishable', 'Versionable'],
        properties: { 'uid:major_version': 1 },
        contextParameters: { permissions: ['Read', 'Write', 'ReadWrite', 'WriteVersion'] },
        ...over,
      });

    it('publishes the document on screen, with its versions read from the repository', async () => {
      const v = doc({ uid: 'v1', properties: { 'uid:major_version': 1 } });
      mockDetailService.getVersionsDirect.mockReturnValue(of([v]));
      await build(publishable());
      mockDialog.open.mockClear();

      component.openPublishDialog();

      expect(mockDetailService.getVersionsDirect).toHaveBeenCalledWith('doc-1');
      expect(lastDialogData()).toMatchObject({ documentUid: 'doc-1', versions: [v] });
    });

    it('publishes a version as it is, as Web UI does, listing its live document’s versions', async () => {
      await build(
        publishable({
          uid: 'v-1-0',
          isVersion: true,
          versionableId: 'doc-live',
          facets: ['Publishable', 'Immutable'],
        }),
      );
      mockDialog.open.mockClear();

      component.openPublishDialog();

      expect(toast.error).not.toHaveBeenCalled();
      expect(mockDetailService.getVersionsDirect).toHaveBeenCalledWith('doc-live');
      expect(lastDialogData()).toMatchObject({ documentUid: 'v-1-0', versionLabel: '1.0' });
    });

    it('still opens the dialog with no versions when the fetch fails', async () => {
      mockDetailService.getVersionsDirect.mockReturnValue(throwError(() => new Error('500')));
      await build(publishable());
      mockDialog.open.mockClear();

      component.openPublishDialog();

      expect(lastDialogData()).toMatchObject({ versions: [] });
    });

    it('offers the renditions the document actually has', async () => {
      await build(
        publishable({
          contextParameters: {
            permissions: ['Read', 'Write', 'WriteVersion'],
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
      await build(publishable());
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

    it('re-reads the publications once something was published', async () => {
      await build(publishable());
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(true) }));
      mockDetailService.getPublishedVersions.mockClear();

      component.openPublishDialog();

      expect(mockDetailService.getPublishedVersions).toHaveBeenCalledWith('doc-1');
    });

    it('refuses to open without WriteVersion, even with Write', async () => {
      await build(
        publishable({ contextParameters: { permissions: ['Read', 'Write', 'ReadWrite'] } }),
      );
      mockDialog.open.mockClear();

      component.openPublishDialog();

      expect(mockDialog.open).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('You do not have permission to perform this action');
    });

    it('refuses to open on a proxy or a document that is not Publishable', async () => {
      await build(publishable({ isProxy: true }));
      mockDialog.open.mockClear();
      component.openPublishDialog();
      expect(mockDialog.open).not.toHaveBeenCalled();

      await build(publishable({ facets: ['Versionable'] }));
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

    it('shows the day a share ends as the panel does, not its UTC date', async () => {
      await build();

      // Midnight in Paris on 15 July, which Nuxeo holds as 22:00 UTC on the 14th.
      expect(component.aceTimeFrame(ace({ end: '2030-07-14T22:00:00.000Z' }))).toBe(
        'Until Jul 15, 2030',
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

      expect(
        component.breadcrumbItems().map((i) => [i.label, 'href' in i ? i.href : undefined]),
      ).toEqual([
        ['default-domain', '/browse/default-domain'],
        ['workspaces', '/browse/default-domain/workspaces'],
        ['ws', '/browse/default-domain/workspaces/ws'],
      ]);
    });

    it('cycles tag colours so adjacent tags differ', async () => {
      await build();

      expect(component.tagCategory(0)).not.toBe(component.tagCategory(1));
      expect(component.tagCategory(0)).toBe(component.tagCategory(7));
    });
  });
});
