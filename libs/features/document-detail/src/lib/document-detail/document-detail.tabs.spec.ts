import { ComponentFixture, TestBed } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
  withDisabledInitialNavigation,
} from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import {
  ARenderService,
  BrowseService,
  CURRENT_USERNAME,
  ContentLakeIngestService,
  DirectoryService,
  DocumentDetailService,
  NuxeoApiBase,
  TagService,
  TaskService,
  WorkflowService,
  type AuditEntry,
  type DirectoryEntry,
  type NuxeoAce,
  type NuxeoComment,
  type NuxeoDocument,
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
  PACKAGED_DOCUMENT_TABS,
  PACKAGED_DOCUMENT_TOOLBAR_ACTIONS,
  provideSatoriExtensions,
} from '@nuxeo-satori/platform/extensions';

import { DocumentDetailComponent } from './document-detail';
import { NxsToastService } from '@nuxeo-satori/platform/components';

/**
 * The tab surfaces: publishing, permissions, comments, activity and attachments,
 * plus the AI and Knowledge Enrichment controls that hang off the detail page.
 *
 * Tabs are addressed **by descriptor id**, never by a literal index, because a
 * manifest may hide or reorder them; `tabIndex()` below resolves the id the way
 * the template does.
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

function section(path: string, uid = path): NuxeoDocument {
  return doc({ uid, title: path.split('/').pop() ?? path, type: 'Section', path });
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

function comment(over: Partial<NuxeoComment> = {}): NuxeoComment {
  return {
    id: 'c1',
    parentId: 'doc-1',
    text: 'hello',
    author: 'alice',
    creationDate: '2026-08-24T10:00:00.000Z',
    ...over,
  };
}

/** A raw comment document, as `getAllComments` returns them. */
function commentEntry(
  uid: string,
  text: string,
  parentId = 'doc-1',
  over: Record<string, unknown> = {},
): { uid: string; properties: Record<string, unknown> } {
  return {
    uid,
    properties: {
      'comment:parentId': parentId,
      'comment:text': text,
      'comment:author': 'alice',
      'comment:creationDate': '2026-08-24T10:00:00.000Z',
      ...over,
    },
  };
}

function auditEntry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 1,
    category: 'eventDocumentCategory',
    principalName: 'alice',
    comment: '',
    docLifeCycle: 'project',
    docPath: '/x',
    docType: 'File',
    docUUID: 'doc-1',
    eventId: 'documentModified',
    repositoryId: 'default',
    eventDate: '2026-08-20T10:00:00.000Z',
    logDate: '2026-08-20T10:00:00.000Z',
    extended: {},
    ...over,
  };
}

function directoryEntry(id: string, displayLabel: string): DirectoryEntry {
  return { id, label: displayLabel, displayLabel, ordering: 0, obsolete: 0, directoryName: 'd' };
}

/** A complete enrichment result; a test supplies only the action it is exercising. */
function keResult(over: Partial<KeEnrichmentResult> = {}): KeEnrichmentResult {
  return { inProgress: false, generalProcessingErrors: [], raw: null, ...over };
}

interface DialogRefLike {
  afterClosed: () => Observable<unknown>;
}

const mockDetailService = {
  getFullDocument: vi.fn((): Observable<NuxeoDocument> => of(doc())),
  fetchBlob: vi.fn((): Observable<Blob> => of(new Blob(['x'], { type: 'text/plain' }))),
  fetchBlobByXpath: vi.fn((): Observable<Blob> => of(new Blob(['thumb']))),
  fetchThumbnail: vi.fn((): Observable<Blob> => of(new Blob(['thumb'], { type: 'image/png' }))),
  fetchPdfRendition: vi.fn((): Observable<Blob> => of(new Blob(['pdf']))),
  exportXml: vi.fn((): Observable<Blob> => of(new Blob(['<xml/>']))),
  exportZip: vi.fn((): Observable<Blob> => of(new Blob(['zip']))),
  getAllComments: vi.fn((): Observable<{ entries: unknown[] }> => of({ entries: [] })),
  createComment: vi.fn((): Observable<NuxeoComment> => of(comment())),
  createReply: vi.fn((): Observable<NuxeoComment> => of(comment({ id: 'r1' }))),
  updateComment: vi.fn((): Observable<NuxeoComment> => of(comment({ text: 'edited' }))),
  deleteComment: vi.fn((): Observable<void> => of(undefined)),
  getVersions: vi.fn((): Observable<{ entries: NuxeoDocument[] }> => of({ entries: [] })),
  getPublishedVersions: vi.fn((): Observable<{ entries: NuxeoDocument[] }> => of({ entries: [] })),
  getSectionTree: vi.fn((): Observable<{ entries: NuxeoDocument[] }> => of({ entries: [] })),
  getRunnableWorkflows: vi.fn((): Observable<unknown[]> => of([])),
  getAuditLog: vi.fn((): Observable<{ entries: AuditEntry[]; resultsCount: number }> =>
    of({ entries: [], resultsCount: 0 }),
  ),
  getDocumentPermissions: vi.fn((): Observable<NuxeoDocument> => of(doc())),
  publishDocument: vi.fn((): Observable<unknown> => of({})),
  unpublishDocument: vi.fn((): Observable<unknown> => of({})),
  sendNotificationEmailForPermission: vi.fn((): Observable<unknown> => of({})),
  blockPermissionInheritance: vi.fn((): Observable<void> => of(undefined)),
  unblockPermissionInheritance: vi.fn((): Observable<void> => of(undefined)),
  uploadAttachment: vi.fn((): Observable<unknown> => of({})),
  replaceAttachment: vi.fn((): Observable<unknown> => of({})),
  removeAttachment: vi.fn((): Observable<unknown> => of({})),
  replaceMainFile: vi.fn((): Observable<unknown> => of({})),
  removeMainFile: vi.fn((): Observable<unknown> => of({})),
};

const mockDirectoryService = {
  getEventTypes: vi.fn((): Observable<DirectoryEntry[]> => of([])),
  getEventCategories: vi.fn((): Observable<DirectoryEntry[]> => of([])),
  getEntries: vi.fn((): Observable<DirectoryEntry[]> => of([])),
  getAllL10nEntries: vi.fn((): Observable<unknown[]> => of([])),
};

const mockTagService = {
  searchTags: vi.fn((_term: string): Observable<string[]> => of([])),
  addTag: vi.fn((_uid: string, _label: string): Observable<unknown> => of({})),
  removeTag: vi.fn((_uid: string, _label: string): Observable<void> => of(undefined)),
};

const mockAiGateway = {
  summarize: vi.fn((): Observable<unknown> => of({ summary: 'ok' })),
  suggestTags: vi.fn((): Observable<{ tags: Array<{ label: string }> }> => of({ tags: [] })),
  classify: vi.fn((): Observable<unknown> => of({ category: 'Invoice' })),
  findSimilar: vi.fn((): Observable<{ documents: unknown[] }> => of({ documents: [] })),
  analyzeSentiment: vi.fn(
    (): Observable<{ sentiments: Array<{ id: string }>; threadSummary: string | null }> =>
      of({ sentiments: [], threadSummary: null }),
  ),
};

const mockKeClient = {
  enrich: vi.fn((): Observable<KeEnrichmentResult> => of(keResult())),
};

const mockIngestService = {
  startIngest: vi.fn((): Observable<{ commandId: string }> => of({ commandId: 'cmd-1' })),
  waitUntilComplete: vi.fn(
    (): Observable<{
      commandId: string;
      state: string;
      processed: number;
      error: boolean;
      errorCount: number;
    }> => of({ commandId: 'cmd-1', state: 'COMPLETED', processed: 1, error: false, errorCount: 0 }),
  ),
  markIngested: vi.fn((): Observable<NuxeoDocument[]> => of([])),
  backfillIngestMarkerIfNeeded: vi.fn(
    (): Observable<{ doc: NuxeoDocument | null; presentInContentLake: boolean }> =>
      of({ doc: null, presentInContentLake: false }),
  ),
};

const mockNuxeoApi = {
  nxqlSearch: vi.fn((): Observable<{ entries: NuxeoDocument[] }> => of({ entries: [] })),
};

const mockDialog = {
  open: vi.fn((_component: unknown, _config?: { data?: unknown }): DialogRefLike => ({
    afterClosed: () => of(undefined),
  })),
};

describe('DocumentDetailComponent — tab surfaces', () => {
  let component: DocumentDetailComponent;
  let fixture: ComponentFixture<DocumentDetailComponent>;
  let http: HttpTestingController;
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
    http = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  }

  /** The rendered position of a tab id — never a literal, because a manifest may reorder. */
  function tabIndex(id: string): number {
    const index = component.detailTabs().findIndex((t) => t.id === id);
    if (index < 0) throw new Error(`tab "${id}" is not offered`);
    return index;
  }

  function openTab(id: string): void {
    component.onTabChange(tabIndex(id));
  }

  function lastDialogData(): unknown {
    return mockDialog.open.mock.calls.at(-1)?.[1]?.data;
  }

  function installDefaults(): void {
    mockDetailService.getFullDocument.mockReturnValue(of(doc()));
    mockDetailService.fetchBlob.mockReturnValue(of(new Blob(['x'], { type: 'text/plain' })));
    mockDetailService.fetchBlobByXpath.mockReturnValue(of(new Blob(['thumb'])));
    mockDetailService.getAllComments.mockReturnValue(of({ entries: [] }));
    mockDetailService.createComment.mockReturnValue(of(comment()));
    mockDetailService.createReply.mockReturnValue(of(comment({ id: 'r1' })));
    mockDetailService.updateComment.mockReturnValue(of(comment({ text: 'edited' })));
    mockDetailService.deleteComment.mockReturnValue(of(undefined));
    mockDetailService.getVersions.mockReturnValue(of({ entries: [] }));
    mockDetailService.getPublishedVersions.mockReturnValue(of({ entries: [] }));
    mockDetailService.getSectionTree.mockReturnValue(of({ entries: [] }));
    mockDetailService.getAuditLog.mockReturnValue(of({ entries: [], resultsCount: 0 }));
    mockDetailService.getDocumentPermissions.mockReturnValue(of(doc()));
    mockDetailService.publishDocument.mockReturnValue(of({}));
    mockDetailService.unpublishDocument.mockReturnValue(of({}));
    mockDetailService.sendNotificationEmailForPermission.mockReturnValue(of({}));
    mockDetailService.blockPermissionInheritance.mockReturnValue(of(undefined));
    mockDetailService.unblockPermissionInheritance.mockReturnValue(of(undefined));
    mockDetailService.uploadAttachment.mockReturnValue(of({}));
    mockDetailService.replaceAttachment.mockReturnValue(of({}));
    mockDetailService.removeAttachment.mockReturnValue(of({}));
    mockDetailService.replaceMainFile.mockReturnValue(of({}));
    mockDetailService.removeMainFile.mockReturnValue(of({}));
    mockDirectoryService.getEventTypes.mockReturnValue(of([]));
    mockDirectoryService.getEventCategories.mockReturnValue(of([]));
    mockDirectoryService.getEntries.mockReturnValue(of([]));
    mockDirectoryService.getAllL10nEntries.mockReturnValue(of([]));
    mockTagService.addTag.mockReturnValue(of({}));
    mockAiGateway.summarize.mockReturnValue(of({ summary: 'ok' }));
    mockAiGateway.suggestTags.mockReturnValue(of({ tags: [] }));
    mockAiGateway.classify.mockReturnValue(of({ category: 'Invoice' }));
    mockAiGateway.findSimilar.mockReturnValue(of({ documents: [] }));
    mockAiGateway.analyzeSentiment.mockReturnValue(of({ sentiments: [], threadSummary: null }));
    mockKeClient.enrich.mockReturnValue(of(keResult()));
    mockIngestService.startIngest.mockReturnValue(of({ commandId: 'cmd-1' }));
    mockIngestService.waitUntilComplete.mockReturnValue(
      of({ commandId: 'cmd-1', state: 'COMPLETED', processed: 1, error: false, errorCount: 0 }),
    );
    mockIngestService.markIngested.mockReturnValue(of([]));
    mockIngestService.backfillIngestMarkerIfNeeded.mockReturnValue(
      of({ doc: null, presentInContentLake: false }),
    );
    mockNuxeoApi.nxqlSearch.mockReturnValue(of({ entries: [] }));
    mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(undefined) }));
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    revoked.length = 0;
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
        { provide: DirectoryService, useValue: mockDirectoryService },
        { provide: KeClientService, useValue: mockKeClient },
        { provide: TaskService, useValue: { getDocumentTasks: vi.fn(() => of([])) } },
        {
          provide: WorkflowService,
          useValue: {
            getDocumentWorkflows: vi.fn(() => of([])),
            startWorkflow: vi.fn(() => of({})),
            cancelWorkflow: vi.fn(() => of(undefined)),
          },
        },
        {
          provide: ARenderService,
          useValue: { isAvailable: vi.fn(() => of(false)), getPreviewerUrl: vi.fn(() => of(null)) },
        },
        { provide: TagService, useValue: mockTagService },
        { provide: AiGatewayService, useValue: mockAiGateway },
        { provide: AiChatService, useValue: { openPanel: vi.fn() } },
        { provide: AiFeatureFlagService, useValue: { aiEnabled: signal(true) } },
        { provide: NuxeoApiBase, useValue: mockNuxeoApi },
        { provide: ContentLakeIngestService, useValue: mockIngestService },
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

  afterEach(() => {
    // Resolved here, not read out of the `http` variable `build()` assigns.
    //
    // Every one of the 123 tests below happens to call `build()` today, so the guard does work
    // — but a test that returned before it would have verified the *previous* test's
    // controller, and the first such test in the file would have verified `undefined`:
    // `TypeError: Cannot read properties of undefined (reading 'verify')`, reproduced by adding
    // exactly that test and watching it happen. `TestBed.inject` here always yields this test's
    // controller, whether or not the test built anything.
    //
    // It is not hoisted into `beforeEach` — the obvious fix — because seven tests call
    // `TestBed.overrideProvider` in their own bodies, and injecting anything in `beforeEach`
    // instantiates the module: "Cannot override provider when the test module has already been
    // instantiated." Measured; that variant turned seven tests red.
    //
    // On what the guard found: it was added as Stage 2.4 (QW7 from the audit) expecting to fail
    // and expose untested HTTP surface in a 15-provider component making only two `expectOne`
    // calls. It did not. The project is green with it in place, so that surface is not there —
    // the component's other collaborators are all injected as mocks. The guard stays because it
    // is cheap and capable of failing, not because it found anything.
    TestBed.inject(HttpTestingController).verify();
  });

  describe('tab switching', () => {
    it('lazy-loads the permissions tab on first show and not again', async () => {
      await build();
      mockDetailService.getDocumentPermissions.mockClear();

      openTab('app.tabs.permissions');
      openTab('app.tabs.view');
      openTab('app.tabs.permissions');

      expect(mockDetailService.getDocumentPermissions).toHaveBeenCalledTimes(1);
    });

    it('lazy-loads the history tab with its vocabularies', async () => {
      mockDirectoryService.getEventTypes.mockReturnValue(of([directoryEntry('a', 'A')]));
      mockDirectoryService.getEventCategories.mockReturnValue(of([directoryEntry('c', 'C')]));
      mockDetailService.getAuditLog.mockReturnValue(
        of({ entries: [auditEntry()], resultsCount: 1 }),
      );
      await build();

      openTab('app.tabs.history');

      expect(component.availableActions()).toHaveLength(1);
      expect(component.availableCategories()).toHaveLength(1);
      expect(component.auditEntries()).toHaveLength(1);
    });

    it('ignores a nonsensical tab index rather than addressing nothing', async () => {
      await build();
      const before = component.activeTabId();

      component.onTabChange(-1);
      component.onTabChange(Number.NaN);

      expect(component.activeTabId()).toBe(before);
    });

    it('reports no tab id for an index past the end of the strip', async () => {
      await build();

      component.onTabChange(99);

      expect(component.activeTabId()).toBeNull();
    });
  });

  describe('permissions tab', () => {
    it('merges the refreshed ACLs into the document already on screen', async () => {
      await build(doc({ title: 'Keep me' }));
      mockDetailService.getDocumentPermissions.mockReturnValue(
        of(
          doc({
            title: 'Server copy',
            contextParameters: {
              permissions: ['Everything'],
              acls: [{ name: 'local', aces: [ace({ id: 'new', externalUser: true })] }],
            },
          }),
        ),
      );

      openTab('app.tabs.permissions');

      expect(component.externalAces().map((a) => a.id)).toEqual(['new']);
      expect(component.permissionsLoading()).toBe(false);
    });

    it('warns and allows a retry when the permission refresh fails', async () => {
      await build();
      mockDetailService.getDocumentPermissions.mockReturnValue(throwError(() => new Error('403')));

      openTab('app.tabs.permissions');

      expect(component.permissionsLoading()).toBe(false);
      expect(toast.error).toHaveBeenCalledWith('Failed to refresh permissions');

      mockDetailService.getDocumentPermissions.mockReturnValue(of(doc()));
      openTab('app.tabs.view');
      openTab('app.tabs.permissions');

      expect(mockDetailService.getDocumentPermissions).toHaveBeenCalledTimes(2);
    });

    it('describes the grant being removed in the delete confirmation', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(true) }));

      component.deletePermission(ace({ permission: 'ReadWrite', begin: '2026-01-01' }));

      expect(lastDialogData()).toMatchObject({
        documentUid: 'doc-1',
        permissionLabel: 'Edit',
      });
      expect(toast.show).toHaveBeenCalledWith('Permission deleted');
    });

    it('leaves the permissions alone when the delete is cancelled', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(undefined) }));
      mockDetailService.getDocumentPermissions.mockClear();

      component.deletePermission(ace());

      expect(mockDetailService.getDocumentPermissions).not.toHaveBeenCalled();
    });

    it('flags an external grant as external when editing it', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(true) }));

      component.editExternalPermission(ace({ externalUser: true }));

      expect(lastDialogData()).toMatchObject({ isExternal: true });
      expect(toast.show).toHaveBeenCalledWith('Permission updated');
    });

    it('reloads after an external share is created', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(true) }));
      mockDetailService.getDocumentPermissions.mockClear();

      component.openExternalPermissionDialog();

      expect(toast.show).toHaveBeenCalledWith('Shared with external user');
      expect(mockDetailService.getDocumentPermissions).toHaveBeenCalledWith('doc-1');
    });

    it('sends a notification email for a grant', async () => {
      await build();

      component.sendPermissionNotification(ace({ id: 'ace-7' }));

      expect(mockDetailService.sendNotificationEmailForPermission).toHaveBeenCalledWith(
        'doc-1',
        'ace-7',
      );
      expect(component.actionInProgress()).toBeNull();
      expect(toast.show).toHaveBeenCalledWith('Notification email sent');
    });

    it('reports a generic failure when the notification cannot be sent', async () => {
      await build();
      mockDetailService.sendNotificationEmailForPermission.mockReturnValue(
        throwError(() => new Error('500')),
      );

      component.sendPermissionNotification(ace());

      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to send notification');
    });
  });

  describe('publishing tab', () => {
    it('builds a nested section tree from the flat server list', async () => {
      mockDetailService.getSectionTree.mockReturnValue(
        of({
          entries: [
            section('/default-domain/sections'),
            section('/default-domain/sections/news'),
            section('/default-domain/sections/news/2026'),
            section('/default-domain/sections/legal'),
          ],
        }),
      );
      await build();

      openTab('app.tabs.publishing');

      const roots = component.sectionTree();
      expect(roots).toHaveLength(1);
      expect(roots[0].children.map((c) => c.doc.title)).toEqual(['news', 'legal']);
      expect(roots[0].children[0].children.map((c) => c.doc.title)).toEqual(['2026']);
      expect(component.sectionsLoading()).toBe(false);
    });

    it('retries the section tree after a failure instead of showing an empty tree forever', async () => {
      mockDetailService.getSectionTree.mockReturnValue(throwError(() => new Error('500')));
      await build();

      openTab('app.tabs.publishing');
      expect(component.sectionTree()).toEqual([]);
      expect(component.sectionsLoading()).toBe(false);

      mockDetailService.getSectionTree.mockReturnValue(
        of({ entries: [section('/default-domain/sections')] }),
      );
      openTab('app.tabs.view');
      openTab('app.tabs.publishing');

      expect(component.sectionTree()).toHaveLength(1);
    });

    it('does not refetch the section tree once it has loaded', async () => {
      mockDetailService.getSectionTree.mockReturnValue(
        of({ entries: [section('/default-domain/sections')] }),
      );
      await build();

      openTab('app.tabs.publishing');
      openTab('app.tabs.view');
      openTab('app.tabs.publishing');

      expect(mockDetailService.getSectionTree).toHaveBeenCalledTimes(1);
    });

    it('selects and deselects a section', async () => {
      await build();

      component.selectSection('sec-1');
      expect(component.selectedSectionId()).toBe('sec-1');

      component.selectSection('sec-1');
      expect(component.selectedSectionId()).toBeNull();

      component.selectSection('sec-2');
      expect(component.selectedSectionId()).toBe('sec-2');
    });

    it('collapses and expands a section node', async () => {
      mockDetailService.getSectionTree.mockReturnValue(
        of({ entries: [section('/default-domain/sections')] }),
      );
      await build();
      openTab('app.tabs.publishing');
      const node = component.sectionTree()[0];

      component.toggleSectionNode(node);

      expect(component.sectionTree()[0].expanded).toBe(false);
    });

    it('publishes to the selected section and refreshes the publication list', async () => {
      await build();
      component.selectedSectionId.set('sec-1');
      const proxy = doc({ uid: 'proxy-1', path: '/default-domain/sections/news/doc' });
      mockDetailService.getPublishedVersions.mockReturnValue(of({ entries: [proxy] }));

      component.publishToSection();

      expect(mockDetailService.publishDocument).toHaveBeenCalledWith('doc-1', 'sec-1', {
        override: true,
      });
      expect(component.selectedSectionId()).toBeNull();
      expect(component.publishedDocs()).toEqual([proxy]);
      expect(component.publishing()).toBe(false);
    });

    it('does nothing when no section is selected', async () => {
      await build();
      component.selectedSectionId.set(null);

      component.publishToSection();

      expect(mockDetailService.publishDocument).not.toHaveBeenCalled();
    });

    it('clears the publishing flag when the publish fails', async () => {
      await build();
      component.selectedSectionId.set('sec-1');
      mockDetailService.publishDocument.mockReturnValue(throwError(() => new Error('403')));

      component.publishToSection();

      expect(component.publishing()).toBe(false);
      expect(component.selectedSectionId()).toBe('sec-1');
      expect(toast.error).toHaveBeenCalledWith('Failed to publish');
    });

    it('removes just the unpublished proxy from the list', async () => {
      const a = doc({ uid: 'p1', path: '/s/a' });
      const b = doc({ uid: 'p2', path: '/s/b' });
      mockDetailService.getPublishedVersions.mockReturnValue(of({ entries: [a, b] }));
      await build();

      component.unpublishDocument(a);

      expect(mockDetailService.unpublishDocument).toHaveBeenCalledWith('p1');
      expect(component.publishedDocs().map((d) => d.uid)).toEqual(['p2']);
      expect(component.actionInProgress()).toBeNull();
    });

    it('keeps the proxy listed when the unpublish fails', async () => {
      const a = doc({ uid: 'p1', path: '/s/a' });
      mockDetailService.getPublishedVersions.mockReturnValue(of({ entries: [a] }));
      await build();
      mockDetailService.unpublishDocument.mockReturnValue(throwError(() => new Error('403')));

      component.unpublishDocument(a);

      expect(component.publishedDocs().map((d) => d.uid)).toEqual(['p1']);
      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to unpublish');
    });

    it('republishes against the section uid already in the loaded tree', async () => {
      mockDetailService.getSectionTree.mockReturnValue(
        of({ entries: [section('/default-domain/sections/news', 'sec-news')] }),
      );
      await build();
      openTab('app.tabs.publishing');

      component.republishDocument(doc({ uid: 'p1', path: '/default-domain/sections/news/doc' }));

      expect(mockNuxeoApi.nxqlSearch).not.toHaveBeenCalled();
      expect(mockDetailService.publishDocument).toHaveBeenCalledWith('doc-1', 'sec-news', {
        override: true,
      });
      expect(component.actionInProgress()).toBeNull();
    });

    it('looks the section up by path when it is not in the loaded tree', async () => {
      await build();
      mockNuxeoApi.nxqlSearch.mockReturnValue(
        of({ entries: [doc({ uid: 'sec-found', path: '/default-domain/sections/news' })] }),
      );

      component.republishDocument(doc({ uid: 'p1', path: '/default-domain/sections/news/doc' }));

      expect(mockNuxeoApi.nxqlSearch).toHaveBeenCalledWith(
        expect.stringContaining("ecm:path = '/default-domain/sections/news'"),
        1,
      );
      expect(mockDetailService.publishDocument).toHaveBeenCalledWith('doc-1', 'sec-found', {
        override: true,
      });
    });

    it('reports a missing section rather than republishing to nothing', async () => {
      await build();
      mockNuxeoApi.nxqlSearch.mockReturnValue(of({ entries: [] }));

      component.republishDocument(doc({ uid: 'p1', path: '/default-domain/sections/gone/doc' }));

      expect(mockDetailService.publishDocument).not.toHaveBeenCalled();
      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Section not found');
    });

    it('releases the in-progress flag when the section lookup fails', async () => {
      await build();
      mockNuxeoApi.nxqlSearch.mockReturnValue(throwError(() => new Error('500')));

      component.republishDocument(doc({ uid: 'p1', path: '/s/news/doc' }));

      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to republish');
    });

    it('releases the in-progress flag when the republish itself fails', async () => {
      mockDetailService.getSectionTree.mockReturnValue(
        of({ entries: [section('/s/news', 'sec-news')] }),
      );
      await build();
      openTab('app.tabs.publishing');
      mockDetailService.publishDocument.mockReturnValue(throwError(() => new Error('403')));

      component.republishDocument(doc({ uid: 'p1', path: '/s/news/doc' }));

      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to republish');
    });

    it('empties the publication list when every publication is removed', async () => {
      mockDetailService.getPublishedVersions.mockReturnValue(
        of({ entries: [doc({ uid: 'p1', path: '/s/a' }), doc({ uid: 'p2', path: '/s/b' })] }),
      );
      await build();

      component.unpublishAll();

      expect(mockDetailService.unpublishDocument).toHaveBeenCalledTimes(2);
      expect(component.publishedDocs()).toEqual([]);
      expect(component.actionInProgress()).toBeNull();
    });

    it('re-reads the publication list when removing them all partly fails', async () => {
      mockDetailService.getPublishedVersions.mockReturnValue(
        of({ entries: [doc({ uid: 'p1', path: '/s/a' })] }),
      );
      await build();
      mockDetailService.unpublishDocument.mockReturnValue(throwError(() => new Error('403')));
      const survivor = doc({ uid: 'p1', path: '/s/a' });
      mockDetailService.getPublishedVersions.mockReturnValue(of({ entries: [survivor] }));

      component.unpublishAll();

      expect(component.publishedDocs()).toEqual([survivor]);
      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to remove some publications');
    });

    it('does nothing when there is nothing published', async () => {
      await build();

      component.unpublishAll();

      expect(mockDetailService.unpublishDocument).not.toHaveBeenCalled();
    });

    it('describes a publication by path, version, rendition, author and date', async () => {
      await build(doc({ properties: { 'uid:major_version': 2, 'uid:minor_version': 1 } }));
      const proxy = doc({
        path: '/default-domain/sections/news/report',
        lastModified: '2026-08-30T00:00:00.000Z',
        properties: {
          'uid:major_version': 1,
          'uid:minor_version': 0,
          'dc:lastContributor': 'carol',
          'dc:modified': '2026-08-29T00:00:00.000Z',
        },
      });

      expect(component.publishedPath(proxy)).toBe('/default-domain/sections/news/report');
      expect(component.publishedVersion(proxy)).toBe('1.0');
      expect(component.isOlderVersion(proxy)).toBe(true);
      expect(component.publishedBy(proxy)).toBe('carol');
      expect(component.publishedDate(proxy)).toBe('2026-08-29T00:00:00.000Z');
    });

    it('does not call a publication older when it matches the live version', async () => {
      await build(doc({ properties: { 'uid:major_version': 1, 'uid:minor_version': 0 } }));
      const proxy = doc({
        path: '/s/x',
        properties: { 'uid:major_version': 1, 'uid:minor_version': 0 },
      });

      expect(component.isOlderVersion(proxy)).toBe(false);
    });

    it('names the published rendition from the nature, then the mime type, then None', async () => {
      await build();

      expect(component.publishedRendition(doc({ properties: { 'dc:nature': 'Contract' } }))).toBe(
        'Contract',
      );
      expect(
        component.publishedRendition(
          doc({ properties: { 'file:content': { 'mime-type': 'application/pdf' } } }),
        ),
      ).toBe('PDF');
      expect(component.publishedRendition(doc({ properties: {} }))).toBe('None');
    });

    it('falls back to the creator when nobody has contributed since', async () => {
      await build();

      expect(component.publishedBy(doc({ properties: { 'dc:creator': 'alice' } }))).toBe('alice');
      expect(component.publishedDate(doc({ lastModified: '2026-01-01' }))).toBe('2026-01-01');
    });

    it('distinguishes a section root from a plain section in the tree icon', async () => {
      await build();

      expect(
        component.sectionIcon({ doc: doc({ type: 'SectionRoot' }), children: [], expanded: true }),
      ).toBe('library_books');
      expect(
        component.sectionIcon({ doc: doc({ type: 'Section' }), children: [], expanded: true }),
      ).toBe('folder');
    });

    it('jumps to the publishing tab and loads it', async () => {
      await build();
      mockDetailService.getSectionTree.mockClear();
      mockDetailService.getSectionTree.mockReturnValue(of({ entries: [] }));

      component.goToPublishingTab();

      expect(component.activeTabId()).toBe('app.tabs.publishing');
      expect(mockDetailService.getSectionTree).toHaveBeenCalled();
    });
  });

  describe('comments', () => {
    it('separates top-level comments from their replies', async () => {
      mockDetailService.getAllComments.mockReturnValue(
        of({
          entries: [
            commentEntry('c1', 'top level'),
            commentEntry('r1', 'a reply', 'c1'),
            commentEntry('r2', 'another reply', 'c1'),
          ],
        }),
      );
      await build();

      component.switchPanelSubTab('comments');

      expect(component.comments().map((c) => c.id)).toEqual(['c1']);
      expect(component.replyCount('c1')).toBe(2);
      expect(component.commentsLoading()).toBe(false);
    });

    it('loads comments only the first time the sub-tab is shown', async () => {
      await build();

      component.switchPanelSubTab('comments');
      component.switchPanelSubTab('properties');
      component.switchPanelSubTab('comments');

      expect(mockDetailService.getAllComments).toHaveBeenCalledTimes(1);
    });

    it('clears the loading flag when the comment fetch fails', async () => {
      mockDetailService.getAllComments.mockReturnValue(throwError(() => new Error('500')));
      await build();

      component.switchPanelSubTab('comments');

      expect(component.commentsLoading()).toBe(false);
      expect(component.comments()).toEqual([]);
    });

    it('puts a new comment at the top of the thread and clears the box', async () => {
      await build();
      mockDetailService.createComment.mockReturnValue(of(comment({ id: 'new', text: 'fresh' })));
      component.comments.set([comment({ id: 'old' })]);
      component.newCommentText.set('  fresh  ');

      component.submitComment();

      expect(mockDetailService.createComment).toHaveBeenCalledWith('doc-1', 'fresh');
      expect(component.comments().map((c) => c.id)).toEqual(['new', 'old']);
      expect(component.newCommentText()).toBe('');
      expect(component.commentSaving()).toBe(false);
    });

    it('does not post a comment that is only whitespace', async () => {
      await build();
      component.newCommentText.set('   ');

      component.submitComment();

      expect(mockDetailService.createComment).not.toHaveBeenCalled();
    });

    it('keeps the typed text when posting a comment fails', async () => {
      await build();
      mockDetailService.createComment.mockReturnValue(throwError(() => new Error('500')));
      component.newCommentText.set('keep me');

      component.submitComment();

      expect(component.newCommentText()).toBe('keep me');
      expect(component.commentSaving()).toBe(false);
      expect(toast.error).toHaveBeenCalledWith('Failed to add comment');
    });

    it('refuses to comment on a document the user cannot write', async () => {
      await build(doc({ contextParameters: { permissions: ['Read'] } }));
      component.newCommentText.set('nope');

      component.submitComment();

      expect(mockDetailService.createComment).not.toHaveBeenCalled();
    });

    it('discards the draft comment on cancel', async () => {
      await build();
      component.newCommentText.set('draft');

      component.cancelNewComment();

      expect(component.newCommentText()).toBe('');
    });

    it('opens and closes the inline editor for a comment', async () => {
      await build();

      component.startEditComment(comment({ id: 'c9', text: 'original' }));
      expect(component.editingCommentId()).toBe('c9');
      expect(component.editingCommentText()).toBe('original');

      component.cancelEditComment();
      expect(component.editingCommentId()).toBeNull();
      expect(component.editingCommentText()).toBe('');
    });

    it('refuses to open the editor without the write permission', async () => {
      await build(doc({ contextParameters: { permissions: ['Read'] } }));

      component.startEditComment(comment({ id: 'c9' }));

      expect(component.editingCommentId()).toBeNull();
    });

    it('replaces the edited text of a top-level comment', async () => {
      await build();
      component.comments.set([comment({ id: 'c1', text: 'before' })]);
      mockDetailService.updateComment.mockReturnValue(of(comment({ id: 'c1', text: 'after' })));
      component.startEditComment(comment({ id: 'c1', text: 'before' }));
      component.editingCommentText.set('after');

      component.saveEditComment();

      expect(mockDetailService.updateComment).toHaveBeenCalledWith('doc-1', 'c1', 'after');
      expect(component.comments()[0].text).toBe('after');
      expect(component.editingCommentId()).toBeNull();
    });

    it('replaces the edited text of a reply, which is not in the top-level list', async () => {
      await build();
      component.comments.set([comment({ id: 'c1' })]);
      component.repliesMap.set({ c1: [comment({ id: 'r1', text: 'before', parentId: 'c1' })] });
      mockDetailService.updateComment.mockReturnValue(
        of(comment({ id: 'r1', text: 'after', parentId: 'c1' })),
      );
      component.editingCommentId.set('r1');
      component.editingCommentText.set('after');

      component.saveEditComment();

      expect(component.repliesMap()['c1'][0].text).toBe('after');
    });

    it('keeps the editor open when saving an edit fails', async () => {
      await build();
      mockDetailService.updateComment.mockReturnValue(throwError(() => new Error('500')));
      component.editingCommentId.set('c1');
      component.editingCommentText.set('after');

      component.saveEditComment();

      expect(component.editingCommentId()).toBe('c1');
      expect(component.commentSaving()).toBe(false);
      expect(toast.error).toHaveBeenCalledWith('Failed to update comment');
    });

    it('does not save an edit that has been emptied', async () => {
      await build();
      component.editingCommentId.set('c1');
      component.editingCommentText.set('   ');

      component.saveEditComment();

      expect(mockDetailService.updateComment).not.toHaveBeenCalled();
    });

    it('removes a deleted comment and its replies from the thread', async () => {
      await build();
      component.comments.set([comment({ id: 'c1' }), comment({ id: 'c2' })]);
      component.repliesMap.set({ c1: [comment({ id: 'r1', parentId: 'c1' })] });
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(true) }));

      component.deleteComment(comment({ id: 'c1' }));

      expect(mockDetailService.deleteComment).toHaveBeenCalledWith('doc-1', 'c1');
      expect(component.comments().map((c) => c.id)).toEqual(['c2']);
      expect(component.repliesMap()['c1']).toBeUndefined();
      expect(toast.show).toHaveBeenCalledWith('Comment deleted');
    });

    it('removes only the deleted reply and keeps its parent', async () => {
      await build();
      component.comments.set([comment({ id: 'c1' })]);
      component.repliesMap.set({
        c1: [comment({ id: 'r1', parentId: 'c1' }), comment({ id: 'r2', parentId: 'c1' })],
      });
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(true) }));

      component.deleteComment(comment({ id: 'r1', parentId: 'c1' }), 'c1');

      expect(component.comments().map((c) => c.id)).toEqual(['c1']);
      expect(component.repliesMap()['c1'].map((r) => r.id)).toEqual(['r2']);
      expect(toast.show).toHaveBeenCalledWith('Reply deleted');
    });

    it('leaves the thread alone when the delete is cancelled', async () => {
      await build();
      component.comments.set([comment({ id: 'c1' })]);
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(false) }));

      component.deleteComment(comment({ id: 'c1' }));

      expect(mockDetailService.deleteComment).not.toHaveBeenCalled();
      expect(component.comments()).toHaveLength(1);
    });

    it('keeps the comment on screen when the delete fails', async () => {
      await build();
      component.comments.set([comment({ id: 'c1' })]);
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(true) }));
      mockDetailService.deleteComment.mockReturnValue(throwError(() => new Error('403')));

      component.deleteComment(comment({ id: 'c1' }));

      expect(component.comments()).toHaveLength(1);
      expect(toast.error).toHaveBeenCalledWith('Failed to delete comment');
    });

    it('files a reply under the comment it answers', async () => {
      await build();
      mockDetailService.createReply.mockReturnValue(of(comment({ id: 'r1', text: 'replied' })));

      component.startReply('c1');
      expect(component.replyingToId()).toBe('c1');
      component.replyText.set('replied');
      component.submitReply('c1');

      expect(mockDetailService.createReply).toHaveBeenCalledWith('doc-1', 'c1', 'replied');
      // The server echoes the document uid as the parent; the reply belongs to the comment.
      expect(component.repliesMap()['c1'].map((r) => r.parentId)).toEqual(['c1']);
      expect(component.replyingToId()).toBeNull();
      expect(component.replyText()).toBe('');
    });

    it('keeps the reply box open when posting the reply fails', async () => {
      await build();
      mockDetailService.createReply.mockReturnValue(throwError(() => new Error('500')));
      component.replyText.set('keep me');

      component.submitReply('c1');

      expect(component.replyText()).toBe('keep me');
      expect(component.commentSaving()).toBe(false);
      expect(toast.error).toHaveBeenCalledWith('Failed to add reply');
    });

    it('does not post an empty reply', async () => {
      await build();
      component.replyText.set('  ');

      component.submitReply('c1');

      expect(mockDetailService.createReply).not.toHaveBeenCalled();
    });

    it('discards the draft reply on cancel', async () => {
      await build();
      component.startReply('c1');
      component.replyText.set('draft');

      component.cancelReply();

      expect(component.replyingToId()).toBeNull();
      expect(component.replyText()).toBe('');
    });

    it('reports the time of the most recent reply', async () => {
      await build();
      component.repliesMap.set({
        c1: [
          comment({ id: 'r1', creationDate: '2020-01-01T00:00:00.000Z' }),
          comment({ id: 'r2', creationDate: new Date(Date.now() - 5000).toISOString() }),
        ],
      });

      // `Intl.RelativeTimeFormat` says "now" below a minute, where the hand-rolled
      // formatter said "a few seconds ago". See `formatRelativeTime`.
      expect(component.lastReplyTime('c1')).toBe('now');
      expect(component.lastReplyTime('none')).toBe('');
      expect(component.replyCount('none')).toBe(0);
    });

    it('marks a comment edited only when it changed after creation', async () => {
      await build();

      expect(
        component.isCommentEdited(
          comment({ creationDate: '2026-01-01', modificationDate: '2026-02-01' }),
        ),
      ).toBe(true);
      expect(
        component.isCommentEdited(
          comment({ creationDate: '2026-01-01', modificationDate: '2026-01-01' }),
        ),
      ).toBe(false);
      expect(component.isCommentEdited(comment({ modificationDate: undefined }))).toBe(false);
    });

    it('describes an age in the largest unit that still fits', async () => {
      await build();
      const ago = (ms: number): string =>
        component.relativeTime(new Date(Date.now() - ms).toISOString());

      expect(ago(5_000)).toBe('now');
      expect(ago(60_000)).toBe('1 minute ago');
      expect(ago(120_000)).toBe('2 minutes ago');
      expect(ago(3_600_000)).toBe('1 hour ago');
      expect(ago(7_200_000)).toBe('2 hours ago');
      expect(ago(86_400_000)).toBe('yesterday');
      expect(ago(2 * 86_400_000)).toBe('2 days ago');
      // The old formatter switched to an absolute date past a month, to avoid "60 days ago".
      // `Intl.RelativeTimeFormat` serves that intent by coarsening the unit instead, which
      // stays relative and stays translatable.
      expect(ago(60 * 86_400_000)).toBe('2 months ago');
      expect(ago(400 * 86_400_000)).toBe('last year');
    });
  });

  describe('comment sentiment', () => {
    it('keys the sentiment results by comment id and records the thread summary', async () => {
      await build();
      component.comments.set([comment({ id: 'c1', text: 'great' })]);
      mockAiGateway.analyzeSentiment.mockReturnValue(
        of({ sentiments: [{ id: 'c1' }], threadSummary: 'mostly positive' }),
      );

      component.analyzeCommentSentiment();

      expect(component.aiSentimentMap()['c1']).toEqual({ id: 'c1' });
      expect(component.aiThreadSummary()).toBe('mostly positive');
      expect(component.aiSentimentLoading()).toBe(false);
    });

    it('does not call the model when there is nothing to analyse', async () => {
      await build();
      component.comments.set([]);

      component.analyzeCommentSentiment();

      expect(mockAiGateway.analyzeSentiment).not.toHaveBeenCalled();
    });

    it('clears the loading flag when the sentiment call fails', async () => {
      await build();
      component.comments.set([comment()]);
      mockAiGateway.analyzeSentiment.mockReturnValue(throwError(() => new Error('500')));

      component.analyzeCommentSentiment();

      expect(component.aiSentimentLoading()).toBe(false);
      expect(component.aiSentimentMap()).toEqual({});
    });
  });

  describe('panel activity', () => {
    it('loads recent activity when the activity sub-tab is opened', async () => {
      mockDetailService.getAuditLog.mockReturnValue(
        of({ entries: [auditEntry()], resultsCount: 1 }),
      );
      await build();

      component.switchPanelSubTab('activity');

      expect(mockDetailService.getAuditLog).toHaveBeenCalledWith('doc-1', 20, 0);
      expect(component.panelActivity()).toHaveLength(1);
      expect(component.panelActivityLoading()).toBe(false);
    });

    it('shows nothing for a document whose audit log the user cannot read', async () => {
      await build(doc({ contextParameters: { permissions: [] } }));
      mockDetailService.getAuditLog.mockClear();

      component.switchPanelSubTab('activity');

      expect(mockDetailService.getAuditLog).not.toHaveBeenCalled();
      expect(component.panelActivity()).toEqual([]);
      expect(component.panelActivityLoading()).toBe(false);
    });

    it('clears the loading flag when the activity fetch fails', async () => {
      mockDetailService.getAuditLog.mockReturnValue(throwError(() => new Error('500')));
      await build();

      component.switchPanelSubTab('activity');

      expect(component.panelActivityLoading()).toBe(false);
    });

    it('re-reads the activity after a download while the activity tab is showing', async () => {
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      await build();
      component.switchPanelSubTab('activity');
      mockDetailService.getAuditLog.mockClear();

      component.download();

      // The download itself is an audited event, so the panel is stale without this.
      expect(mockDetailService.getAuditLog).toHaveBeenCalledWith('doc-1', 20, 0);
      clickSpy.mockRestore();
    });

    it('does not re-read the activity after a download on another sub-tab', async () => {
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      await build();
      component.switchPanelSubTab('properties');
      mockDetailService.getAuditLog.mockClear();

      component.download();

      expect(mockDetailService.getAuditLog).not.toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('labels an audit event from the vocabulary, falling back to the raw id', async () => {
      mockDirectoryService.getEventTypes.mockReturnValue(
        of([directoryEntry('documentModified', 'Modified')]),
      );
      mockDirectoryService.getEventCategories.mockReturnValue(
        of([directoryEntry('eventDocumentCategory', 'Document')]),
      );
      await build();
      openTab('app.tabs.history');

      expect(component.eventLabel('documentModified')).toBe('Modified');
      expect(component.eventLabel('somethingElse')).toBe('Something Else');
      expect(component.categoryLabel('eventDocumentCategory')).toBe('Document');
      expect(component.categoryLabel('eventLifeCycleCategory')).toBe('Event Life Cycle');
    });
  });

  describe('attachments', () => {
    /**
     * A change event from a file picker. jsdom has no `DataTransfer`, so `files` is
     * defined directly; the component only ever reads `files?.[0]` and `value`.
     */
    function fileInput(file?: File): Event {
      const input = document.createElement('input');
      input.type = 'file';
      const list: Pick<FileList, 'length' | 'item'> & Record<number, File> = {
        length: file ? 1 : 0,
        item: (i: number) => (i === 0 ? (file ?? null) : null),
      };
      if (file) list[0] = file;
      Object.defineProperty(input, 'files', { value: list, writable: true });
      const event = new Event('change');
      Object.defineProperty(event, 'target', { value: input });
      return event;
    }

    it('lists the attachments with size and mime type from files:files', async () => {
      await build(
        doc({
          properties: {
            'files:files': [
              {
                file: {
                  name: 'a.pdf',
                  length: 2048,
                  'mime-type': 'application/pdf',
                  data: '/nuxeo/a',
                },
              },
              { file: null },
            ],
          },
        }),
      );

      expect(component.attachments()).toEqual([
        { index: 0, name: 'a.pdf', size: 2048, mimeType: 'application/pdf', url: '/nuxeo/a' },
      ]);
      expect(component.formatBytes(2048)).toBe('2.00 KB');
    });

    it('uploads a chosen file and reloads the document', async () => {
      await build();
      mockDetailService.getFullDocument.mockClear();

      component.uploadAttachment(fileInput(new File(['x'], 'notes.txt')));

      expect(mockDetailService.uploadAttachment).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ name: 'notes.txt' }),
      );
      expect(component.actionInProgress()).toBeNull();
      expect(mockDetailService.getFullDocument).toHaveBeenCalledWith('doc-1');
      expect(toast.show).toHaveBeenCalledWith('"notes.txt" attached');
    });

    it('releases the in-progress flag when the upload fails', async () => {
      await build();
      mockDetailService.uploadAttachment.mockReturnValue(throwError(() => new Error('413')));

      component.uploadAttachment(fileInput(new File(['x'], 'big.bin')));

      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to upload attachment');
    });

    it('does nothing when the file picker was dismissed', async () => {
      await build();

      component.uploadAttachment(fileInput());

      expect(mockDetailService.uploadAttachment).not.toHaveBeenCalled();
    });

    it('clears the picker and refuses to upload without the write permission', async () => {
      await build(doc({ contextParameters: { permissions: ['Read'] } }));
      const event = fileInput(new File(['x'], 'notes.txt'));

      component.uploadAttachment(event);

      expect(mockDetailService.uploadAttachment).not.toHaveBeenCalled();
      expect((event.target as HTMLInputElement).value).toBe('');
    });

    it('replaces an attachment with the file the dialog returned', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({
        afterClosed: () => of(new File(['y'], 'new.pdf')),
      }));

      component.openReplaceDialog({ index: 1, name: 'old.pdf' });

      expect(mockDetailService.replaceAttachment).toHaveBeenCalledWith(
        'doc-1',
        1,
        expect.objectContaining({ name: 'new.pdf' }),
      );
      expect(component.actionInProgress()).toBeNull();
      expect(toast.show).toHaveBeenCalledWith('"old.pdf" replaced');
    });

    it('does not replace an attachment when the dialog is dismissed', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(null) }));

      component.openReplaceDialog({ index: 0, name: 'old.pdf' });

      expect(mockDetailService.replaceAttachment).not.toHaveBeenCalled();
    });

    it('releases the in-progress flag when replacing an attachment fails', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({
        afterClosed: () => of(new File(['y'], 'new.pdf')),
      }));
      mockDetailService.replaceAttachment.mockReturnValue(throwError(() => new Error('500')));

      component.openReplaceDialog({ index: 0, name: 'old.pdf' });

      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to replace attachment');
    });

    it('removes an attachment after confirmation', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(true) }));

      component.openRemoveDialog({ index: 2, name: 'gone.pdf' });

      expect(mockDetailService.removeAttachment).toHaveBeenCalledWith('doc-1', 2);
      expect(toast.show).toHaveBeenCalledWith('"gone.pdf" removed');
    });

    it('keeps the attachment when the removal is cancelled', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(false) }));

      component.openRemoveDialog({ index: 0, name: 'keep.pdf' });

      expect(mockDetailService.removeAttachment).not.toHaveBeenCalled();
    });

    it('releases the in-progress flag when removing an attachment fails', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(true) }));
      mockDetailService.removeAttachment.mockReturnValue(throwError(() => new Error('403')));

      component.openRemoveDialog({ index: 0, name: 'x.pdf' });

      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to remove attachment');
    });

    it('replaces the main file and reloads', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({
        afterClosed: () => of(new File(['y'], 'main.pdf')),
      }));
      mockDetailService.getFullDocument.mockClear();

      component.openReplaceMainFileDialog();

      expect(mockDetailService.replaceMainFile).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ name: 'main.pdf' }),
      );
      expect(mockDetailService.getFullDocument).toHaveBeenCalledWith('doc-1');
      expect(toast.show).toHaveBeenCalledWith('Main file replaced');
    });

    it('releases the in-progress flag when replacing the main file fails', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({
        afterClosed: () => of(new File(['y'], 'main.pdf')),
      }));
      mockDetailService.replaceMainFile.mockReturnValue(throwError(() => new Error('500')));

      component.openReplaceMainFileDialog();

      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to replace main file');
    });

    it('removes the main file after confirmation', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(true) }));

      component.openRemoveMainFileDialog();

      expect(mockDetailService.removeMainFile).toHaveBeenCalledWith('doc-1');
      expect(toast.show).toHaveBeenCalledWith('Main file removed');
    });

    it('releases the in-progress flag when removing the main file fails', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(true) }));
      mockDetailService.removeMainFile.mockReturnValue(throwError(() => new Error('403')));

      component.openRemoveMainFileDialog();

      expect(component.actionInProgress()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('Failed to remove main file');
    });

    it('refuses every attachment mutation without the write permission', async () => {
      await build(doc({ contextParameters: { permissions: ['Read'] } }));
      mockDialog.open.mockClear();

      component.openReplaceDialog({ index: 0, name: 'x' });
      component.openRemoveDialog({ index: 0, name: 'x' });
      component.openReplaceMainFileDialog();
      component.openRemoveMainFileDialog();

      expect(mockDialog.open).not.toHaveBeenCalled();
    });

    it('saves an attachment under its own name', async () => {
      const clicks: Array<{ download: string; target: string }> = [];
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        clicks.push({ download: this.download, target: this.target });
      });
      await build();

      component.downloadAttachment('/nuxeo/blob/a.pdf', 'a.pdf');

      expect(clicks).toEqual([{ download: 'a.pdf', target: '_blank' }]);
      clickSpy.mockRestore();
    });

    it('previews an attachment through an authenticated fetch, not a bare URL', async () => {
      await build();
      mockDialog.open.mockClear();

      component.previewAttachment({
        name: 'a.pdf',
        url: '/nuxeo/blob/a.pdf',
        mimeType: 'application/pdf',
      });

      // Bound directly, the browser would fetch without the auth interceptor and 401.
      const req = http.expectOne('/nuxeo/blob/a.pdf');
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['pdf']));

      expect(lastDialogData()).toMatchObject({ name: 'a.pdf', mimeType: 'application/pdf' });
    });

    it('reports a failed attachment preview instead of opening an empty viewer', async () => {
      await build();
      mockDialog.open.mockClear();

      component.previewAttachment({ name: 'a.pdf', url: '/nuxeo/blob/a.pdf', mimeType: 'x' });
      http
        .expectOne('/nuxeo/blob/a.pdf')
        .error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' });

      expect(mockDialog.open).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('Failed to load preview');
    });
  });

  describe('AI insights', () => {
    it('publishes a generated summary', async () => {
      await build();
      mockAiGateway.summarize.mockReturnValue(of({ summary: 'the gist' }));

      component.generateSummary();

      expect(component.aiSummary()).toEqual({ summary: 'the gist' });
      expect(component.aiSummaryLoading()).toBe(false);
      expect(component.aiError()).toBeNull();
    });

    it('surfaces the server message when summarising fails', async () => {
      await build();
      mockAiGateway.summarize.mockReturnValue(
        throwError(() => ({ error: { error: 'model unavailable' } })),
      );

      component.generateSummary();

      // The server message is still surfaced, now behind the operation that failed, so the
      // reader learns both what broke and why rather than seeing a detached fragment.
      expect(component.aiError()).toBe('Summary generation failed: model unavailable');
      expect(component.aiSummaryLoading()).toBe(false);
    });

    it('falls back to a generic message when the failure carries no detail', async () => {
      await build();
      mockAiGateway.summarize.mockReturnValue(throwError(() => new Error('boom')));

      component.generateSummary();

      expect(component.aiError()).toBe('Summary generation failed');
    });

    it('publishes suggested tags and drops one once it is applied', async () => {
      await build();
      mockAiGateway.suggestTags.mockReturnValue(
        of({ tags: [{ label: 'invoice' }, { label: 'q3' }] }),
      );

      component.suggestTags();
      expect(component.aiSuggestedTags().map((t) => t.label)).toEqual(['invoice', 'q3']);

      component.applyAiTag('invoice');

      expect(mockTagService.addTag).toHaveBeenCalledWith('doc-1', 'invoice');
      expect(component.aiSuggestedTags().map((t) => t.label)).toEqual(['q3']);
      expect(toast.show).toHaveBeenCalledWith('Tag "invoice" applied');
    });

    it('keeps the suggestion when applying it fails', async () => {
      await build();
      mockAiGateway.suggestTags.mockReturnValue(of({ tags: [{ label: 'invoice' }] }));
      component.suggestTags();
      mockTagService.addTag.mockReturnValue(throwError(() => new Error('500')));

      component.applyAiTag('invoice');

      expect(component.aiSuggestedTags().map((t) => t.label)).toEqual(['invoice']);
      expect(toast.error).toHaveBeenCalledWith('Failed to apply tag');
    });

    it('clears the tag loading flag when the suggestion call fails', async () => {
      await build();
      mockAiGateway.suggestTags.mockReturnValue(throwError(() => new Error('500')));

      component.suggestTags();

      expect(component.aiTagsLoading()).toBe(false);
      expect(component.aiError()).toBe('Tag suggestion failed');
    });

    it('publishes a classification and reports a failure', async () => {
      await build();
      mockAiGateway.classify.mockReturnValue(of({ category: 'Invoice' }));

      component.classifyDocument();
      expect(component.aiClassification()).toEqual({ category: 'Invoice' });
      expect(component.aiClassifyLoading()).toBe(false);

      mockAiGateway.classify.mockReturnValue(throwError(() => new Error('500')));
      component.classifyDocument();

      expect(component.aiError()).toBe('Classification failed');
      expect(component.aiClassifyLoading()).toBe(false);
    });

    it('publishes similar documents and reports a failure', async () => {
      await build();
      mockAiGateway.findSimilar.mockReturnValue(of({ documents: [{ uid: 'other' }] }));

      component.findSimilar();
      expect(component.aiSimilarDocs()).toEqual([{ uid: 'other' }]);

      mockAiGateway.findSimilar.mockReturnValue(throwError(() => new Error('500')));
      component.findSimilar();

      expect(component.aiError()).toBe('Similar doc search failed');
      expect(component.aiSimilarLoading()).toBe(false);
    });

    it('navigates to a similar document', async () => {
      await build();
      const spy = vi.spyOn(Router.prototype, 'navigateByUrl');

      component.navigateToDoc('other-uid');

      expect(spy).toHaveBeenCalledWith('/doc/other-uid');
      spy.mockRestore();
    });

    it('opens the assistant scoped to this document', async () => {
      const openPanel = vi.fn();
      TestBed.overrideProvider(AiChatService, { useValue: { openPanel } });
      await build();

      component.openAiAssistant();

      expect(openPanel).toHaveBeenCalledWith(expect.objectContaining({ docId: 'doc-1' }));
    });
  });

  describe('knowledge enrichment', () => {
    it('refuses to classify when the nature vocabulary never loaded', async () => {
      mockDirectoryService.getEntries.mockReturnValue(of([]));
      await build();

      component.runTextClassification();

      expect(mockKeClient.enrich).not.toHaveBeenCalled();
      expect(component.keError()).toContain('"nature" vocabulary failed to load');
      expect(component.keActionInFlight()).toBeNull();
      // A refusal, so it is announced as an error rather than as news.
      expect(toast.error).toHaveBeenCalledWith(component.keError());
      expect(toast.show).not.toHaveBeenCalled();
    });

    it('writes the matched vocabulary id, not the label the model returned', async () => {
      mockDirectoryService.getEntries.mockReturnValue(of([directoryEntry('contract', 'Contract')]));
      const updateDocument = vi.fn(() => of(doc()));
      TestBed.overrideProvider(BrowseService, { useValue: { updateDocument } });
      await build();
      mockKeClient.enrich.mockReturnValue(
        of(keResult({ textClassification: { result: 'Contract', isSuccess: true } })),
      );

      component.runTextClassification();

      expect(updateDocument).toHaveBeenCalledWith('doc-1', { 'dc:nature': 'contract' });
      expect(component.keError()).toBeNull();
      expect(component.keActionInFlight()).toBeNull();
    });

    it('refuses to write the no-match sentinel to the vocabulary field', async () => {
      mockDirectoryService.getEntries.mockReturnValue(of([directoryEntry('contract', 'Contract')]));
      const updateDocument = vi.fn(() => of(doc()));
      TestBed.overrideProvider(BrowseService, { useValue: { updateDocument } });
      await build();
      mockKeClient.enrich.mockReturnValue(
        of(
          keResult({
            textClassification: { result: 'not_from_provided_classes', isSuccess: true },
          }),
        ),
      );

      component.runTextClassification();

      // Nuxeo rejects a value outside the vocabulary with HTTP 422.
      expect(updateDocument).not.toHaveBeenCalled();
      expect(component.keError()).toContain('could not match this document');
    });

    it('refuses to write a category that is not in the vocabulary', async () => {
      mockDirectoryService.getEntries.mockReturnValue(of([directoryEntry('contract', 'Contract')]));
      const updateDocument = vi.fn(() => of(doc()));
      TestBed.overrideProvider(BrowseService, { useValue: { updateDocument } });
      await build();
      mockKeClient.enrich.mockReturnValue(
        of(keResult({ textClassification: { result: 'Hallucination', isSuccess: true } })),
      );

      component.runTextClassification();

      expect(updateDocument).not.toHaveBeenCalled();
      expect(component.keError()).toContain('is not one of the');
    });

    it('reports an empty classification result', async () => {
      mockDirectoryService.getEntries.mockReturnValue(of([directoryEntry('contract', 'Contract')]));
      await build();
      mockKeClient.enrich.mockReturnValue(
        of(keResult({ textClassification: { result: '   ', isSuccess: true } })),
      );

      component.runTextClassification();

      expect(component.keError()).toContain('did not return a document category');
    });

    it('writes a returned summary to the description', async () => {
      const updateDocument = vi.fn(() => of(doc()));
      TestBed.overrideProvider(BrowseService, { useValue: { updateDocument } });
      await build();
      mockKeClient.enrich.mockReturnValue(
        of(keResult({ textSummary: { result: ' a summary ', isSuccess: true } })),
      );

      component.runTextSummarization();

      expect(updateDocument).toHaveBeenCalledWith('doc-1', { 'dc:description': 'a summary' });
      expect(component.keStatus()).toContain('description updated');
    });

    it('reports an empty summary rather than blanking the description', async () => {
      const updateDocument = vi.fn(() => of(doc()));
      TestBed.overrideProvider(BrowseService, { useValue: { updateDocument } });
      await build();
      mockKeClient.enrich.mockReturnValue(
        of(keResult({ textSummary: { result: '', isSuccess: true } })),
      );

      component.runTextSummarization();

      expect(updateDocument).not.toHaveBeenCalled();
      expect(component.keError()).toContain('did not return a summary');
    });

    it('turns extracted entities into de-duplicated tags', async () => {
      await build();
      mockKeClient.enrich.mockReturnValue(
        of(
          keResult({
            namedEntityText: {
              result: { person: ['Alice', ' Alice ', ''], org: ['Acme'] },
              isSuccess: true,
            },
          }),
        ),
      );

      component.runTextEntityExtraction();

      expect(mockTagService.addTag.mock.calls.map((c) => c[1])).toEqual(['Alice', 'Acme']);
      expect(component.keStatus()).toContain('tags updated');
    });

    it('reports when entity extraction found nothing', async () => {
      await build();
      mockKeClient.enrich.mockReturnValue(
        of(keResult({ namedEntityText: { result: {}, isSuccess: true } })),
      );

      component.runTextEntityExtraction();

      expect(mockTagService.addTag).not.toHaveBeenCalled();
      expect(component.keError()).toContain('did not return any text entities');
    });

    it('writes an image description and its entity tags', async () => {
      const updateDocument = vi.fn(() => of(doc()));
      TestBed.overrideProvider(BrowseService, { useValue: { updateDocument } });
      await build();
      mockKeClient.enrich.mockReturnValue(
        of(
          keResult({
            imageDescription: { result: 'a cat', isSuccess: true },
            namedEntityImage: { result: { animal: ['cat'] }, isSuccess: true },
          }),
        ),
      );

      component.runImageEnrichment();

      expect(updateDocument).toHaveBeenCalledWith('doc-1', { 'dc:description': 'a cat' });
      expect(mockTagService.addTag).toHaveBeenCalledWith('doc-1', 'cat');
    });

    it('reports when image enrichment returned neither description nor entities', async () => {
      await build();
      mockKeClient.enrich.mockReturnValue(of(keResult()));

      component.runImageEnrichment();

      expect(component.keError()).toContain('did not return an image description');
    });

    it('explains an unconfigured enrichment service rather than echoing the raw error', async () => {
      await build();
      mockKeClient.enrich.mockReturnValue(
        throwError(() => new Error('No authentication info for calling the Enrichment service')),
      );

      component.runTextSummarization();

      expect(component.keError()).toContain('not configured on this Nuxeo server yet');
      expect(component.keStatus()).toBeNull();
      expect(component.keActionInFlight()).toBeNull();
    });

    it('refuses to start a second enrichment while one is running', async () => {
      await build();
      mockDetailService.fetchBlob.mockReturnValue(
        new Observable<Blob>(() => {
          /* never emits */
        }),
      );

      component.runTextSummarization();
      component.runImageEnrichment();

      expect(component.isKeActionRunning('text-summarization')).toBe(true);
      expect(component.isKeActionRunning('image-enrichment')).toBe(false);
      expect(mockDetailService.fetchBlob).toHaveBeenCalledTimes(1);
    });
  });

  describe('Content Lake ingest', () => {
    const ingestable = (): NuxeoDocument =>
      doc({
        properties: {
          'file:content': { name: 'a.pdf', 'mime-type': 'application/pdf', digest: 'abc123' },
        },
      });

    it('ingests the document and reports the document the server returned', async () => {
      const updated = doc({ title: 'Marked ingested' });
      mockIngestService.markIngested.mockReturnValue(of([updated]));
      await build(ingestable());

      component.ingestToContentLake();

      expect(mockIngestService.startIngest).toHaveBeenCalledWith(['doc-1']);
      expect(mockIngestService.waitUntilComplete).toHaveBeenCalledWith('cmd-1');
      expect(component.doc()?.title).toBe('Marked ingested');
      expect(component.contentLakePresenceVerified()).toBe(true);
      expect(component.contentLakeIngestInFlight()).toBe(false);
      expect(component.contentLakeIngestError()).toBeNull();
    });

    it('records the marker locally when the server could not persist it', async () => {
      mockIngestService.markIngested.mockReturnValue(of([]));
      await build(ingestable());

      component.ingestToContentLake();

      expect(component.contentLakePresenceVerified()).toBe(true);
      expect(component.contentLakeIngestStatus()).toContain('Ingested to Content Lake');
    });

    it('reports an ingest that finished with errors as a failure, not a success', async () => {
      mockIngestService.waitUntilComplete.mockReturnValue(
        of({ commandId: 'cmd-1', state: 'COMPLETED', processed: 1, error: false, errorCount: 3 }),
      );
      await build(ingestable());

      component.ingestToContentLake();

      expect(component.contentLakeIngestError()).toContain('(3 failed)');
      expect(toast.error).toHaveBeenCalledWith(component.contentLakeIngestError());
      expect(component.contentLakeIngestStatus()).toBeNull();
      expect(component.contentLakePresenceVerified()).toBe(false);
      expect(component.contentLakeIngestInFlight()).toBe(false);
    });

    it('surfaces the thrown message when the ingest call itself fails', async () => {
      mockIngestService.startIngest.mockReturnValue(
        throwError(() => new Error('connector missing')),
      );
      await build(ingestable());

      component.ingestToContentLake();

      expect(component.contentLakeIngestError()).toBe('connector missing');
      expect(component.contentLakeIngestInFlight()).toBe(false);
    });

    it('does not ingest a document that has nothing to ingest', async () => {
      await build(doc({ properties: {} }));

      component.ingestToContentLake();

      expect(mockIngestService.startIngest).not.toHaveBeenCalled();
    });
  });
});
