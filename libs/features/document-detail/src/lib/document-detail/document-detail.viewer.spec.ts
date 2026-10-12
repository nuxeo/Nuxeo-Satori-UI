import { ComponentFixture, TestBed } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  withDisabledInitialNavigation,
  type ParamMap,
} from '@angular/router';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
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
  type L10nDirectoryEntry,
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
  type ExtensionActionDescriptor,
} from '@nuxeo-satori/platform/extensions';

import { DocumentDetailComponent } from './document-detail';
import { NxsToastService } from '@nuxeo-satori/platform/components';

/**
 * The viewer: storyboards, renditions, the metadata refresh poll and the ARender
 * previewer — plus the packaged toolbar ids whose behaviour is asserted here rather
 * than in `document-detail.actions.spec.ts`.
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

function directoryEntry(id: string, displayLabel: string): DirectoryEntry {
  return { id, label: displayLabel, displayLabel, ordering: 0, obsolete: 0, directoryName: 'd' };
}

function l10nEntry(id: string, label: string, parent = ''): L10nDirectoryEntry {
  return {
    id,
    directoryName: 'l10ncoverage',
    properties: { id, parent, ordering: 0, obsolete: 0, label_en: label },
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

/**
 * A `MatAutocompleteSelectedEvent` carrying just what `selectTag` reads.
 *
 * Built on the real prototype rather than cast from a literal: the class takes a live
 * `MatAutocomplete` and `MatOption` that would have to be rendered to construct.
 */
function tagSelection(value: string, deselect: () => void): MatAutocompleteSelectedEvent {
  return Object.assign(Object.create(MatAutocompleteSelectedEvent.prototype), {
    source: null,
    option: { value, deselect },
  });
}

interface DialogRefLike {
  afterClosed: () => Observable<unknown>;
}

const mockDetailService = {
  getFullDocument: vi.fn((): Observable<NuxeoDocument> => of(doc())),
  fetchBlob: vi.fn((): Observable<Blob> => of(new Blob(['x'], { type: 'text/plain' }))),
  fetchBlobByXpath: vi.fn((): Observable<Blob> => of(new Blob(['thumb'], { type: 'image/jpeg' }))),
  fetchThumbnail: vi.fn((): Observable<Blob> => of(new Blob(['thumb']))),
  fetchPdfRendition: vi.fn((): Observable<Blob> =>
    of(new Blob(['pdf'], { type: 'application/pdf' })),
  ),
  exportXml: vi.fn((): Observable<Blob> => of(new Blob(['<xml/>']))),
  exportZip: vi.fn((): Observable<Blob> => of(new Blob(['zip']))),
  getAllComments: vi.fn((): Observable<{ entries: unknown[] }> => of({ entries: [] })),
  getVersions: vi.fn((): Observable<{ entries: NuxeoDocument[] }> => of({ entries: [] })),
  getPublishedVersions: vi.fn((): Observable<{ entries: NuxeoDocument[] }> => of({ entries: [] })),
  getSectionTree: vi.fn((): Observable<{ entries: NuxeoDocument[] }> => of({ entries: [] })),
  getRunnableWorkflows: vi.fn((): Observable<unknown[]> => of([])),
  getAuditLog: vi.fn((): Observable<{ entries: AuditEntry[]; resultsCount: number }> =>
    of({ entries: [], resultsCount: 0 }),
  ),
  getDocumentPermissions: vi.fn((): Observable<NuxeoDocument> => of(doc())),
  trashDocument: vi.fn((): Observable<void> => of(undefined)),
  addToCollection: vi.fn((): Observable<void> => of(undefined)),
  addToFavorites: vi.fn((): Observable<void> => of(undefined)),
  removeFromFavorites: vi.fn((): Observable<void> => of(undefined)),
  subscribe: vi.fn((): Observable<void> => of(undefined)),
  unsubscribe: vi.fn((): Observable<void> => of(undefined)),
};

const mockDirectoryService = {
  getEventTypes: vi.fn((): Observable<DirectoryEntry[]> => of([])),
  getEventCategories: vi.fn((): Observable<DirectoryEntry[]> => of([])),
  getEntries: vi.fn((): Observable<DirectoryEntry[]> => of([])),
  getAllL10nEntries: vi.fn((): Observable<L10nDirectoryEntry[]> => of([])),
};

const mockARender = {
  isAvailable: vi.fn((): Observable<boolean> => of(false)),
  getPreviewerUrl: vi.fn((): Observable<string | null> => of(null)),
};

const mockTagService = {
  searchTags: vi.fn((): Observable<string[]> => of([])),
  addTag: vi.fn((): Observable<unknown> => of({})),
  removeTag: vi.fn((): Observable<void> => of(undefined)),
};

const mockTaskService = { getDocumentTasks: vi.fn((): Observable<unknown[]> => of([])) };
const mockWorkflowService = {
  getDocumentWorkflows: vi.fn((): Observable<unknown[]> => of([])),
  startWorkflow: vi.fn((): Observable<unknown> => of({})),
  cancelWorkflow: vi.fn((): Observable<void> => of(undefined)),
};

const mockBrowseService = {
  updateDocument: vi.fn((): Observable<NuxeoDocument> => of(doc())),
};

const mockDialog = {
  open: vi.fn((_component: unknown, _config?: { data?: unknown }): DialogRefLike => ({
    afterClosed: () => of(undefined),
  })),
};

describe('DocumentDetailComponent — viewer, renditions and vocabularies', () => {
  let component: DocumentDetailComponent;
  let fixture: ComponentFixture<DocumentDetailComponent>;
  let http: HttpTestingController;
  let toast: { show: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  /** A subject rather than `of`, so a test can navigate to a second document. */
  let routeParams: BehaviorSubject<ParamMap>;

  let seq = 0;
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(
    () => `blob:mock/${(seq += 1)}`,
  );
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();

  async function build(initial: NuxeoDocument = doc()): Promise<void> {
    buildSync(initial);
    await fixture.whenStable();
  }

  /**
   * Same construction without `whenStable`.
   *
   * Every mock here emits synchronously, so `detectChanges` is enough to run `ngOnInit`
   * and the whole load chain. Tests that install fake timers must use this: faking
   * `setTimeout` stalls the scheduler `whenStable` waits on, and the test times out.
   */
  function buildSync(initial: NuxeoDocument = doc()): void {
    mockDetailService.getFullDocument.mockReturnValue(of(initial));
    fixture = TestBed.createComponent(DocumentDetailComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  }

  function offered(id: string): ExtensionActionDescriptor {
    const found = [...component.toolbarActions(), ...component.overflowActions()].find(
      (a) => a.id === id,
    );
    if (!found) {
      throw new Error(`toolbar action "${id}" is not offered for this document`);
    }
    return found;
  }

  function installDefaults(): void {
    mockDetailService.getFullDocument.mockReturnValue(of(doc()));
    mockDetailService.fetchBlob.mockReturnValue(of(new Blob(['x'], { type: 'text/plain' })));
    mockDetailService.fetchBlobByXpath.mockReturnValue(
      of(new Blob(['thumb'], { type: 'image/jpeg' })),
    );
    mockDetailService.fetchPdfRendition.mockReturnValue(
      of(new Blob(['pdf'], { type: 'application/pdf' })),
    );
    mockDetailService.getAllComments.mockReturnValue(of({ entries: [] }));
    mockDetailService.getVersions.mockReturnValue(of({ entries: [] }));
    mockDetailService.getPublishedVersions.mockReturnValue(of({ entries: [] }));
    mockDetailService.getSectionTree.mockReturnValue(of({ entries: [] }));
    mockDetailService.getRunnableWorkflows.mockReturnValue(of([]));
    mockDetailService.getAuditLog.mockReturnValue(of({ entries: [], resultsCount: 0 }));
    mockDetailService.addToCollection.mockReturnValue(of(undefined));
    mockDetailService.addToFavorites.mockReturnValue(of(undefined));
    mockDetailService.removeFromFavorites.mockReturnValue(of(undefined));
    mockDetailService.subscribe.mockReturnValue(of(undefined));
    mockDetailService.unsubscribe.mockReturnValue(of(undefined));
    mockDetailService.trashDocument.mockReturnValue(of(undefined));
    mockDirectoryService.getEntries.mockReturnValue(of([]));
    mockDirectoryService.getAllL10nEntries.mockReturnValue(of([]));
    mockDirectoryService.getEventTypes.mockReturnValue(of([]));
    mockDirectoryService.getEventCategories.mockReturnValue(of([]));
    mockARender.isAvailable.mockReturnValue(of(false));
    mockARender.getPreviewerUrl.mockReturnValue(of(null));
    mockTagService.searchTags.mockReturnValue(of([]));
    mockTagService.addTag.mockReturnValue(of({}));
    mockTaskService.getDocumentTasks.mockReturnValue(of([]));
    mockWorkflowService.getDocumentWorkflows.mockReturnValue(of([]));
    mockBrowseService.updateDocument.mockReturnValue(of(doc()));
    mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(undefined) }));
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    toast = { show: vi.fn(), error: vi.fn() };
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    routeParams = new BehaviorSubject<ParamMap>(convertToParamMap({ uid: 'doc-1' }));
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
            paramMap: routeParams,
            queryParamMap: of(convertToParamMap({})),
            snapshot: { queryParamMap: convertToParamMap({}) },
          },
        },
        { provide: DocumentDetailService, useValue: mockDetailService },
        { provide: BrowseService, useValue: mockBrowseService },
        { provide: DirectoryService, useValue: mockDirectoryService },
        {
          provide: KeClientService,
          useValue: {
            enrich: (): Observable<KeEnrichmentResult> =>
              of({ inProgress: false, generalProcessingErrors: [], raw: null }),
          },
        },
        { provide: TaskService, useValue: mockTaskService },
        { provide: WorkflowService, useValue: mockWorkflowService },
        { provide: ARenderService, useValue: mockARender },
        { provide: TagService, useValue: mockTagService },
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

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('every packaged toolbar id reaches its behaviour', () => {
    it('opens the metadata editor from Edit', async () => {
      await build();
      mockDialog.open.mockClear();

      component.runToolbarAction(offered('app.toolbar.edit'));

      expect(mockDialog.open).toHaveBeenCalledTimes(1);
    });

    it('opens the metadata editor from Edit properties on a Note', async () => {
      await build(doc({ type: 'Note', properties: { 'note:note': 'body' } }));
      mockDialog.open.mockClear();

      component.runToolbarAction(offered('app.toolbar.editProperties'));

      expect(mockDialog.open).toHaveBeenCalledTimes(1);
    });

    it('adds to a collection from Add to collection', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of('col-1') }));

      component.runToolbarAction(offered('app.toolbar.addToCollection'));

      expect(mockDetailService.addToCollection).toHaveBeenCalledWith('doc-1', 'col-1');
    });

    it('trashes the document from Delete', async () => {
      await build();
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(true) }));

      component.runToolbarAction(offered('app.toolbar.delete'));

      expect(mockDetailService.trashDocument).toHaveBeenCalledWith('doc-1');
    });

    it('favourites and unfavourites from the two opposite ids', async () => {
      await build();
      component.runToolbarAction(offered('app.toolbar.addToFavorites'));
      expect(component.isFavorite()).toBe(true);
      await fixture.whenStable();

      component.runToolbarAction(offered('app.toolbar.removeFromFavorites'));
      expect(component.isFavorite()).toBe(false);
    });

    it('unsubscribes from the Unsubscribe id', async () => {
      await build(
        doc({
          contextParameters: { permissions: ['Read'], subscribedNotifications: ['Modification'] },
        }),
      );

      component.runToolbarAction(offered('app.toolbar.unsubscribe'));

      expect(mockDetailService.unsubscribe).toHaveBeenCalledWith('doc-1');
      expect(component.isSubscribed()).toBe(false);
    });

    it('adds to and removes from the clipboard from the two opposite ids', async () => {
      await build();
      component.runToolbarAction(offered('app.toolbar.addToClipboard'));
      expect(component.isInClipboard()).toBe(true);
      await fixture.whenStable();

      component.runToolbarAction(offered('app.toolbar.removeFromClipboard'));
      expect(component.isInClipboard()).toBe(false);
    });

    it('opens the share, export, publish and start-process surfaces', async () => {
      await build(doc({ properties: { 'uid:major_version': 1 } }));

      for (const id of [
        'app.toolbar.share',
        'app.toolbar.export',
        'app.toolbar.publish',
      ] as const) {
        mockDialog.open.mockClear();
        component.runToolbarAction(offered(id));
        expect(mockDialog.open, `${id} opened nothing`).toHaveBeenCalledTimes(1);
      }

      component.runToolbarAction(offered('app.toolbar.startProcess'));
      expect(component.showStartProcessPanel()).toBe(true);
    });
  });

  describe('server storyboard', () => {
    function videoDoc(storyboard: Array<Record<string, unknown>>, uid = 'doc-1'): NuxeoDocument {
      return doc({
        uid,
        type: 'Video',
        properties: {
          'file:content': {
            name: 'v.mp4',
            'mime-type': 'video/mp4',
            length: 100,
            data: '/nuxeo/v',
          },
          'vid:storyboard': storyboard,
          'vid:info': { duration: 42, width: 640, height: 480, format: 'mp4' },
        },
      });
    }

    it('renders one frame per server storyboard entry, in order, with its timecode', async () => {
      await build(
        videoDoc([
          { timecode: 0, comment: 'Opening', content: { viewUrl: '/nuxeo/sb0' } },
          { timecode: 12.5, comment: 'Middle', content: { data: '/nuxeo/sb1' } },
        ]),
      );

      expect(component.storyboard().map((i) => i.timecode)).toEqual([0, 12.5]);
      expect(component.storyboard().map((i) => i.label)).toEqual(['Opening', 'Middle']);
      expect(mockDetailService.fetchBlobByXpath).toHaveBeenCalledWith(
        'doc-1',
        'vid:storyboard/0/content',
      );
    });

    it('also publishes the video dimensions and duration alongside the frames', async () => {
      await build(videoDoc([{ timecode: 0, comment: '', content: { data: '/nuxeo/sb0' } }]));

      expect(component.videoInfo()).toMatchObject({
        duration: 42,
        width: 640,
        height: 480,
        format: 'mp4',
      });
    });

    it('falls back to the stored thumbnail URL when the xpath fetch is rejected', async () => {
      mockDetailService.fetchBlobByXpath.mockReturnValue(throwError(() => new Error('404')));
      await build(
        videoDoc([
          { timecode: 0, comment: 'A', content: { viewUrl: 'http://nuxeo:8080/nuxeo/sb0?x=1' } },
        ]),
      );

      // The absolute server URL is rewritten to the proxied path so the auth
      // interceptor still applies; a bare cross-origin fetch would 401.
      const req = http.expectOne('/nuxeo/sb0?x=1');
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['thumb']));

      expect(component.storyboard()).toHaveLength(1);
    });

    /**
     * `loadBlob` asks for the storyboard, and the `fetchMainBlob` it starts first asks
     * again from `setBlobUrl`. Both saw an empty `storyboard()` because the first
     * request had not answered, so every frame of every video was fetched twice.
     */
    it('fetches each storyboard frame once even though two callers ask for it', async () => {
      mockDetailService.fetchBlobByXpath.mockReturnValue(throwError(() => new Error('404')));
      await build(videoDoc([{ timecode: 0, comment: 'A', content: { viewUrl: '/nuxeo/sb0' } }]));

      expect(http.match('/nuxeo/sb0')).toHaveLength(1);
    });

    /**
     * The same duplicate fetch, reached the other way round. The guard was cleared
     * before the generation was checked, so the *previous* document's frames answering
     * late released the guard belonging to the load now running. `storyboard()` is
     * still empty for the new document, so the next caller — `setBlobUrl`, once the
     * main blob lands — started the fetch the guard exists to prevent.
     */
    it('does not release the guard when the previous document answers late', async () => {
      mockDetailService.fetchBlobByXpath.mockReturnValue(throwError(() => new Error('404')));
      await build(videoDoc([{ timecode: 0, comment: 'A', content: { viewUrl: '/nuxeo/sb-1' } }]));

      const staleFrames = http.match('/nuxeo/sb-1');
      expect(staleFrames).toHaveLength(1);

      // Navigate to a second video whose main blob stays pending, so `setBlobUrl`
      // runs after the first document's frames have answered.
      const secondMainBlob = new Subject<Blob>();
      mockDetailService.fetchBlob.mockReturnValue(secondMainBlob);
      mockDetailService.getFullDocument.mockReturnValue(
        of(videoDoc([{ timecode: 0, comment: 'B', content: { viewUrl: '/nuxeo/sb-2' } }], 'doc-2')),
      );
      routeParams.next(convertToParamMap({ uid: 'doc-2' }));
      await fixture.whenStable();

      expect(http.match('/nuxeo/sb-2')).toHaveLength(1);

      staleFrames[0].flush(new Blob(['thumb']));
      secondMainBlob.next(new Blob(['v'], { type: 'video/mp4' }));
      await fixture.whenStable();

      expect(http.match('/nuxeo/sb-2')).toHaveLength(0);
    });

    it('produces no frames when neither the xpath nor a stored URL yields one', async () => {
      mockDetailService.fetchBlobByXpath.mockReturnValue(throwError(() => new Error('404')));
      await build(videoDoc([{ timecode: 0, comment: '', content: {} }]));

      expect(component.storyboard()).toEqual([]);
    });

    it('drops only the frames that failed and keeps the rest', async () => {
      let call = 0;
      mockDetailService.fetchBlobByXpath.mockImplementation(() => {
        call += 1;
        return call === 1 ? throwError(() => new Error('404')) : of(new Blob(['thumb']));
      });
      await build(
        videoDoc([
          { timecode: 0, comment: 'gone', content: {} },
          { timecode: 5, comment: 'kept', content: { data: '/nuxeo/sb1' } },
        ]),
      );

      expect(component.storyboard().map((i) => i.label)).toEqual(['kept']);
    });
  });

  describe('pdf rendition fallback', () => {
    const officeDoc = (renditions: Array<{ name: string }>): NuxeoDocument =>
      doc({
        properties: {
          'file:content': {
            name: 'report.docx',
            'mime-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            length: 100,
          },
        },
        contextParameters: { permissions: ['Read'], renditions },
      });

    it('shows the PDF rendition of a document the browser cannot render', async () => {
      await build(officeDoc([{ name: 'pdf' }]));

      expect(component.hasPdfRendition()).toBe(true);
      expect(mockDetailService.fetchPdfRendition).toHaveBeenCalledWith('doc-1');
      expect(component.blobUrl()).not.toBeNull();
      expect(component.blobLoading()).toBe(false);
    });

    it('falls back to the server preview when the PDF rendition fails', async () => {
      mockDetailService.fetchPdfRendition.mockReturnValue(throwError(() => new Error('500')));
      const withPreview = officeDoc([{ name: 'pdf' }]);
      withPreview.contextParameters = {
        ...withPreview.contextParameters,
        preview: { url: '/nuxeo/preview/doc-1' },
      };
      await build(withPreview);

      expect(component.blobUrl()).toBeNull();
      expect(component.previewUrl()).not.toBeNull();
      expect(component.blobLoading()).toBe(false);
    });

    it('falls back to the server preview when a text blob cannot be fetched', async () => {
      mockDetailService.fetchBlob.mockReturnValue(throwError(() => new Error('500')));
      await build(
        doc({
          properties: {
            'file:content': { name: 'a.txt', 'mime-type': 'text/plain', length: 10 },
          },
          contextParameters: { permissions: ['Read'], preview: { url: '/nuxeo/preview/doc-1' } },
        }),
      );

      expect(component.previewUrl()).not.toBeNull();
      expect(component.blobLoading()).toBe(false);
    });

    // Category C site 2. `contextParameters.preview.url` is server-supplied, and it is bypassed and
    // loaded into an iframe, so it is constrained to the repository we are already talking to.
    // `//evil.example/x` is the case a `startsWith('/')` same-origin test would have waved through.
    it.each([
      ['javascript:alert(1)', 'a script URL'],
      ['data:text/html,<script>alert(1)</script>', 'a data URL'],
      ['https://evil.example/preview/doc-1', 'a cross-origin URL'],
      ['//evil.example/preview/doc-1', 'a protocol-relative URL'],
    ])('drops %s from the server preview (%s)', async (url) => {
      mockDetailService.fetchBlob.mockReturnValue(throwError(() => new Error('500')));
      await build(
        doc({
          properties: {
            'file:content': { name: 'a.txt', 'mime-type': 'text/plain', length: 10 },
          },
          contextParameters: { permissions: ['Read'], preview: { url } },
        }),
      );

      // Falls through to the viewer's "Preview not available" placeholder.
      expect(component.previewUrl()).toBeNull();
      expect(component.blobLoading()).toBe(false);
    });

    it('keeps an absolute same-origin server preview URL', async () => {
      mockDetailService.fetchBlob.mockReturnValue(throwError(() => new Error('500')));
      await build(
        doc({
          properties: {
            'file:content': { name: 'a.txt', 'mime-type': 'text/plain', length: 10 },
          },
          contextParameters: {
            permissions: ['Read'],
            preview: { url: `${window.location.origin}/nuxeo/preview/doc-1` },
          },
        }),
      );

      expect(component.previewUrl()).not.toBeNull();
    });
  });

  describe('main blob retry', () => {
    it('retries a blob that is not on the server yet and shows it once it arrives', () => {
      vi.useFakeTimers();
      let call = 0;
      mockDetailService.fetchBlob.mockImplementation(() => {
        call += 1;
        return call === 1
          ? throwError(() => new Error('404'))
          : of(new Blob(['ok'], { type: 'image/png' }));
      });
      buildSync(
        doc({
          properties: {
            'file:content': { name: 'a.png', 'mime-type': 'image/png', length: 10 },
          },
        }),
      );

      expect(component.blobUrl()).toBeNull();

      vi.advanceTimersByTime(500);

      // Nuxeo returns the document before the binary is committed on a fresh
      // upload; giving up on the first 404 leaves an empty viewer.
      expect(call).toBe(2);
      expect(component.blobUrl()).not.toBeNull();
      expect(component.blobLoading()).toBe(false);
    });

    it('gives up and falls back to the preview after the retries are exhausted', () => {
      vi.useFakeTimers();
      mockDetailService.fetchBlob.mockReturnValue(throwError(() => new Error('404')));
      buildSync(
        doc({
          properties: { 'file:content': { name: 'a.png', 'mime-type': 'image/png', length: 10 } },
          contextParameters: { permissions: ['Read'], preview: { url: '/nuxeo/preview/doc-1' } },
        }),
      );

      vi.advanceTimersByTime(400 * 10);

      expect(mockDetailService.fetchBlob).toHaveBeenCalledTimes(8);
      expect(component.previewUrl()).not.toBeNull();
      expect(component.blobLoading()).toBe(false);
    });
  });

  describe('metadata refresh poll', () => {
    const rawPicture = (): NuxeoDocument => doc({ type: 'Picture', properties: {} });

    const hydratedPicture = (): NuxeoDocument =>
      doc({
        type: 'Picture',
        properties: {
          'picture:info': { width: 1920, height: 1080, format: 'JPEG', depth: 8, weight: 2048 },
          'picture:views': [
            {
              title: 'FullHD',
              width: 1920,
              height: 1080,
              content: { 'mime-type': 'image/jpeg', length: 500, data: '/nuxeo/fullhd' },
            },
          ],
        },
      });

    it('re-reads a Picture whose derived views have not been generated yet', () => {
      vi.useFakeTimers();
      buildSync(rawPicture());
      expect(component.pictureInfo()).toBeNull();

      mockDetailService.getFullDocument.mockReturnValue(of(hydratedPicture()));
      vi.advanceTimersByTime(600);

      expect(component.pictureInfo()).toMatchObject({ width: 1920, height: 1080 });
      expect(component.pictureViews().map((v) => v.title)).toEqual(['FullHD']);
    });

    it('stops polling once the metadata is complete', () => {
      vi.useFakeTimers();
      buildSync(rawPicture());
      mockDetailService.getFullDocument.mockClear();
      mockDetailService.getFullDocument.mockReturnValue(of(hydratedPicture()));

      vi.advanceTimersByTime(600);
      const afterFirst = mockDetailService.getFullDocument.mock.calls.length;
      vi.advanceTimersByTime(5000);

      expect(afterFirst).toBe(1);
      expect(mockDetailService.getFullDocument.mock.calls.length).toBe(afterFirst);
    });

    it('keeps polling while the metadata is still incomplete, up to the cap', () => {
      vi.useFakeTimers();
      buildSync(rawPicture());
      mockDetailService.getFullDocument.mockClear();
      mockDetailService.getFullDocument.mockReturnValue(of(rawPicture()));

      vi.advanceTimersByTime(600 * 12);

      // Six attempts, then it stops rather than polling for the session's life.
      expect(mockDetailService.getFullDocument).toHaveBeenCalledTimes(6);
    });

    it('stops polling on a transient failure instead of retrying forever', () => {
      vi.useFakeTimers();
      buildSync(rawPicture());
      mockDetailService.getFullDocument.mockClear();
      mockDetailService.getFullDocument.mockReturnValue(throwError(() => new Error('500')));

      vi.advanceTimersByTime(600 * 4);

      expect(mockDetailService.getFullDocument).toHaveBeenCalledTimes(1);
      expect(component.doc()?.type).toBe('Picture');
    });

    it('does not poll a document whose metadata is already complete', () => {
      vi.useFakeTimers();
      buildSync(hydratedPicture());
      mockDetailService.getFullDocument.mockClear();

      vi.advanceTimersByTime(5000);

      expect(mockDetailService.getFullDocument).not.toHaveBeenCalled();
    });

    /**
     * Nuxeo generates `vid:info` and the storyboard for a Video document only. A File holding an
     * MP4 never receives either, so waiting for them would poll six times on every open.
     */
    describe('video metadata, by document type', () => {
      const mp4 = { name: 'v.mp4', 'mime-type': 'video/mp4', length: 100, data: '/nuxeo/v' };
      const info = { duration: 42, width: 640, height: 480, format: 'mp4' };

      it.each<[string, string, boolean, Record<string, unknown>]>([
        ['Video', 'no vid:info', true, {}],
        ['File', 'no vid:info', false, {}],
        ['Video', 'vid:info but no storyboard', true, { 'vid:info': info }],
        ['File', 'vid:info but no storyboard', false, { 'vid:info': info }],
      ])('a %s with %s polls: %s', (type, _label, polls, extra) => {
        vi.useFakeTimers();
        const video = doc({ type, properties: { 'file:content': mp4, ...extra } });
        buildSync(video);
        mockDetailService.getFullDocument.mockClear();
        mockDetailService.getFullDocument.mockReturnValue(of(video));

        vi.advanceTimersByTime(600);

        expect(mockDetailService.getFullDocument.mock.calls.length > 0).toBe(polls);
      });
    });
  });

  describe('ARender previewer', () => {
    it('shows the previewer when the server offers one', async () => {
      mockARender.isAvailable.mockReturnValue(of(true));
      mockARender.getPreviewerUrl.mockReturnValue(of('https://arender/view/doc-1'));
      await build(
        doc({
          properties: {
            'file:content': { name: 'a.pdf', 'mime-type': 'application/pdf', digest: 'd' },
          },
        }),
      );

      expect(mockARender.getPreviewerUrl).toHaveBeenCalledWith('doc-1', 'file:content');
      expect(component.arenderUrl()).not.toBeNull();
      // The iframe is keyed on this so a new URL never reuses a stale session.
      expect(component.arenderReloadId()).toBe(1);
    });

    // The point-of-trust half of the Category C fix. `ARenderService` already refuses a
    // `viewerOrigin` that is not an http(s) origin, so reaching this component with a dangerous URL
    // requires that check to have been bypassed or removed — which is exactly the regression this
    // guards. The URL is about to be handed to `bypassSecurityTrustResourceUrl` and loaded into an
    // iframe, so a `javascript:` value here is script execution in the application's origin.
    it.each([
      ['javascript:alert(1)'],
      ['data:text/html,<script>alert(1)</script>'],
      ['file:///etc/hosts'],
      ['//evil.example/view'],
    ])('refuses to trust a %s previewer URL', async (url) => {
      mockARender.isAvailable.mockReturnValue(of(true));
      mockARender.getPreviewerUrl.mockReturnValue(of(url));
      await build(
        doc({
          properties: {
            'file:content': { name: 'a.pdf', 'mime-type': 'application/pdf', digest: 'd' },
          },
        }),
      );

      // Null is the same state as "ARender is not deployed", which the template already renders as
      // "Annotations are not available" — so failing closed costs the feature, not the page.
      expect(component.arenderUrl()).toBeNull();
      expect(component.arenderReloadId()).toBe(0);
    });

    it('shows no previewer when ARender is not deployed', async () => {
      mockARender.isAvailable.mockReturnValue(of(false));
      await build(
        doc({
          properties: {
            'file:content': { name: 'a.pdf', 'mime-type': 'application/pdf', digest: 'd' },
          },
        }),
      );

      expect(mockARender.getPreviewerUrl).not.toHaveBeenCalled();
      expect(component.arenderUrl()).toBeNull();
    });

    it('shows no previewer when the availability check fails', async () => {
      mockARender.isAvailable.mockReturnValue(throwError(() => new Error('500')));
      await build(
        doc({
          properties: {
            'file:content': { name: 'a.pdf', 'mime-type': 'application/pdf', digest: 'd' },
          },
        }),
      );

      expect(component.arenderUrl()).toBeNull();
      expect(component.arenderReloadId()).toBe(0);
    });

    it('does not ask for a previewer for a Note, which has no blob to annotate', async () => {
      mockARender.isAvailable.mockReturnValue(of(true));
      await build(doc({ type: 'Note', properties: { 'note:note': 'body' } }));

      expect(mockARender.isAvailable).not.toHaveBeenCalled();
      expect(component.arenderUrl()).toBeNull();
    });
  });

  describe('vocabularies', () => {
    it('resolves the document category from the nature vocabulary', async () => {
      mockDirectoryService.getEntries.mockReturnValue(of([directoryEntry('contract', 'Contract')]));
      await build(doc({ properties: { 'dc:nature': 'contract' } }));

      expect(component.documentCategory()).toBe('Contract');
    });

    it('shows no category when the nature vocabulary fails to load', async () => {
      mockDirectoryService.getEntries.mockReturnValue(throwError(() => new Error('500')));
      await build(doc({ properties: { 'dc:nature': 'contract' } }));

      expect(component.natureVocabulary()).toEqual([]);
      expect(component.documentCategory()).toBe('contract');
    });

    it('resolves hierarchical coverage and subject labels', async () => {
      mockDirectoryService.getAllL10nEntries.mockReturnValue(
        of([l10nEntry('europe', 'Europe'), l10nEntry('europe/france', 'France', 'europe')]),
      );
      await build(
        doc({
          properties: { 'dc:coverage': 'europe/france', 'dc:subjects': ['europe'] },
        }),
      );

      expect(component.documentCoverageDisplay()).toContain('France');
      expect(component.documentSubjectsDisplay()).toContain('Europe');
    });

    it('empties both hierarchical vocabularies when the lookup fails', async () => {
      mockDirectoryService.getAllL10nEntries.mockReturnValue(throwError(() => new Error('500')));
      await build(doc({ properties: { 'dc:coverage': 'europe/france' } }));

      expect(component.coverageVocabulary()).toEqual([]);
      expect(component.subjectVocabulary()).toEqual([]);
    });
  });

  describe('tag autocomplete', () => {
    it('offers matching tags the document does not already have', () => {
      vi.useFakeTimers();
      mockTagService.searchTags.mockReturnValue(of(['invoice', 'existing']));
      buildSync(doc({ properties: { 'nxtag:tags': [{ label: 'existing' }] } }));
      component.tagInput = 'in';

      component.onTagSearch('in');
      vi.advanceTimersByTime(300);

      expect(component.tagSearchResults()).toEqual(['invoice']);
      // "in" is not itself a tag, so creating it is offered.
      expect(component.showCreateTagOption()).toBe(true);
    });

    it('does not offer to create a tag that already exists verbatim', () => {
      vi.useFakeTimers();
      mockTagService.searchTags.mockReturnValue(of(['invoice']));
      buildSync();
      component.tagInput = 'invoice';

      component.onTagSearch('invoice');
      vi.advanceTimersByTime(300);

      expect(component.showCreateTagOption()).toBe(false);
    });

    it('offers nothing for an empty term', () => {
      vi.useFakeTimers();
      buildSync();
      component.tagInput = '';

      component.onTagSearch('');
      vi.advanceTimersByTime(300);

      expect(mockTagService.searchTags).not.toHaveBeenCalled();
      expect(component.tagSearchResults()).toEqual([]);
    });

    it('offers nothing when the tag search itself fails', () => {
      vi.useFakeTimers();
      mockTagService.searchTags.mockReturnValue(throwError(() => new Error('500')));
      buildSync();
      component.tagInput = 'in';

      component.onTagSearch('in');
      vi.advanceTimersByTime(300);

      expect(component.tagSearchResults()).toEqual([]);
    });

    it('applies the tag chosen from the autocomplete and clears the input', async () => {
      await build();
      const deselect = vi.fn();

      component.selectTag(tagSelection('invoice', deselect));

      expect(mockTagService.addTag).toHaveBeenCalledWith('doc-1', 'invoice');
      expect(component.tagInput).toBe('');
      expect(deselect).toHaveBeenCalled();
    });

    it('ignores an autocomplete selection with no value', async () => {
      await build();

      component.selectTag(tagSelection('   ', vi.fn()));

      expect(mockTagService.addTag).not.toHaveBeenCalled();
    });

    it('does not add the tag twice when the chip input fires after the autocomplete', async () => {
      await build();
      component.selectTag(tagSelection('invoice', vi.fn()));
      mockTagService.addTag.mockClear();

      const chipInput = { clear: vi.fn() };
      component.addInlineTagFromChip(
        Object.assign(Object.create(null), {
          value: 'invoice',
          chipInput,
          input: document.createElement('input'),
        }),
      );

      expect(mockTagService.addTag).not.toHaveBeenCalled();
      expect(chipInput.clear).toHaveBeenCalled();
    });
  });

  describe('workflow and publication loading failures', () => {
    it('stops the task spinner when the task lookup fails', async () => {
      mockTaskService.getDocumentTasks.mockReturnValue(throwError(() => new Error('500')));
      await build();

      expect(component.documentTasksLoading()).toBe(false);
      expect(component.documentTasks()).toEqual([]);
    });

    it('shows no workflows when the workflow lookup fails', async () => {
      mockWorkflowService.getDocumentWorkflows.mockReturnValue(throwError(() => new Error('500')));
      await build();

      expect(component.documentWorkflows()).toEqual([]);
    });

    it('reports no publications when the publication count fails', async () => {
      mockDetailService.getPublishedVersions.mockReturnValue(throwError(() => new Error('500')));
      await build();

      expect(component.publicationCount()).toBe(0);
      expect(component.publishLoading()).toBe(false);
    });

    it('clears the publishing spinner when the publication list fails on the tab', async () => {
      mockDetailService.getPublishedVersions.mockReturnValue(throwError(() => new Error('500')));
      await build();
      const index = component.detailTabs().findIndex((t) => t.id === 'app.tabs.publishing');

      component.onTabChange(index);

      expect(component.publishLoading()).toBe(false);
    });
  });

  describe('note saving', () => {
    it('stores the body and re-renders markdown on save', async () => {
      const saved = doc({
        type: 'Note',
        properties: { 'note:note': '# New', 'note:mime_type': 'text/markdown' },
      });
      mockBrowseService.updateDocument.mockReturnValue(of(saved));
      await build(
        doc({
          type: 'Note',
          properties: { 'note:note': '# Old', 'note:mime_type': 'text/markdown' },
        }),
      );

      component.saveNote('# New');

      expect(mockBrowseService.updateDocument).toHaveBeenCalledWith(
        'doc-1',
        { 'note:note': '# New', 'note:mime_type': 'text/markdown' },
        { enrichPermissions: true },
      );
      expect(component.noteContent()).toBe('# New');
      expect(component.noteHtml()).not.toBeNull();
      expect(component.noteSaving()).toBe(false);
    });

    it('drops the rendered markdown when the note is saved as plain HTML', async () => {
      mockBrowseService.updateDocument.mockReturnValue(of(doc({ type: 'Note' })));
      await build(
        doc({
          type: 'Note',
          properties: { 'note:note': '<p>old</p>', 'note:mime_type': 'text/html' },
        }),
      );

      component.saveNote('<p>new</p>');

      expect(component.noteHtml()).toBeNull();
      expect(component.noteContent()).toBe('<p>new</p>');
    });

    it('keeps the editor usable when the save fails', async () => {
      mockBrowseService.updateDocument.mockReturnValue(throwError(() => new Error('500')));
      await build(doc({ type: 'Note', properties: { 'note:note': 'body' } }));

      component.saveNote('changed');

      expect(component.noteSaving()).toBe(false);
      expect(toast.error).toHaveBeenCalledWith('Failed to save note');
    });

    it('reports a permission failure distinctly from a generic one', async () => {
      mockBrowseService.updateDocument.mockReturnValue(
        throwError(() => ({ status: 403, error: { message: 'Privilege' } })),
      );
      await build(doc({ type: 'Note', properties: { 'note:note': 'body' } }));

      component.saveNote('changed');

      expect(toast.error).not.toHaveBeenCalledWith('Failed to save note');
      expect(component.noteSaving()).toBe(false);
    });

    it('refuses to save a note the user cannot write', async () => {
      await build(
        doc({
          type: 'Note',
          properties: { 'note:note': 'body' },
          contextParameters: { permissions: ['Read'] },
        }),
      );

      component.saveNote('changed');

      expect(mockBrowseService.updateDocument).not.toHaveBeenCalled();
    });
  });

  describe('picture formats and activity labels', () => {
    it('opens a picture format in a new tab', async () => {
      await build();
      const open = vi.spyOn(window, 'open').mockImplementation(() => null);

      component.downloadPictureFormat('/nuxeo/fullhd.jpg');
      expect(open).toHaveBeenCalledWith('/nuxeo/fullhd.jpg', '_blank');

      open.mockClear();
      component.downloadPictureFormat('');
      expect(open).not.toHaveBeenCalled();
      open.mockRestore();
    });

    it('labels a panel activity entry', async () => {
      mockDirectoryService.getEventTypes.mockReturnValue(
        of([directoryEntry('documentModified', 'Modified')]),
      );
      await build();
      const index = component.detailTabs().findIndex((t) => t.id === 'app.tabs.history');
      component.onTabChange(index);

      expect(component.activityLabel(auditEntry())).toBeTruthy();
    });
  });
});
