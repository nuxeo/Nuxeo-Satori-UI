import { ComponentFixture, TestBed } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import {
  ActivatedRoute,
  convertToParamMap,
  type ParamMap,
  provideRouter,
  Router,
  withDisabledInitialNavigation,
} from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { PageEvent } from '@angular/material/paginator';
import { Sort } from '@angular/material/sort';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import {
  ARenderService,
  type AuditEntry,
  BrowseService,
  CURRENT_USERNAME,
  DirectoryService,
  DocumentDetailService,
  NuxeoApiBase,
  TagService,
  TaskService,
  WorkflowService,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  AiChatService,
  AiFeatureFlagService,
  AiGatewayService,
} from '@agentic-ui/shared/ai-client';
import { KeClientService, type KeEnrichmentResult } from '@agentic-ui/shared/ke-client';
import {
  EXTENSION_SLOTS,
  PACKAGED_DOCUMENT_TABS,
  provideSatoriExtensions,
} from '@nuxeo/satori-platform/extensions';

import { DocumentDetailComponent } from './document-detail';
import { NxsToastService } from '@nuxeo/satori-platform/components';

/**
 * The load chain, actually running.
 *
 * ## Why this is a second spec file rather than more tests in `document-detail.spec.ts`
 *
 * That file stubs `getFullDocument` with a deliberately **never-emitting** Observable, and says
 * so: it keeps `loadDocument`'s subscription in flight so the cascade of follow-up calls never
 * fires, which is what lets its focused tests avoid stubbing every downstream service.
 *
 * That is a reasonable choice for those tests and a large blind spot for coverage: essentially
 * everything reachable from `loadDocument` — `loadBlob` and its dispatch table, the picture and
 * video paths, storyboards, permissions, audit, comments, publishing — is unreachable while the
 * document never arrives. `document-detail.ts` sat at 27.9%.
 *
 * So this file pays the cost the other one avoids: a fully-wired service surface where
 * `getFullDocument` emits whatever the test asks for. Changing the existing file's stub instead
 * would have silently altered the twenty tests that depend on the cascade NOT running.
 */

/**
 * Base document. Every field the component reads is present, so a test overrides intent only.
 *
 * Deliberately NOT `as NuxeoDocument`: the first version ended with that cast and it let a
 * fixture through with `path: undefined`, which crashed `BrowseContextService.setFromDocument`
 * as an unhandled error. `path` is a required `string` on the model — the server always sends
 * one — so the fixture was invalid, not the component. Without the cast, TypeScript says so.
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

/** A `file:content` blob descriptor of a given mime type. */
function fileContent(mimeType: string, name = 'file.bin'): Record<string, unknown> {
  return { name, 'mime-type': mimeType, length: 1234, data: `/nuxeo/blob/${name}` };
}

const emptyKe = (): Observable<KeEnrichmentResult> =>
  of({ textClassification: { result: '' } } as KeEnrichmentResult);

const mockDetailService = {
  getFullDocument: vi.fn((): Observable<NuxeoDocument> => of(doc())),
  fetchBlob: vi.fn((): Observable<Blob> => of(new Blob(['x'], { type: 'text/plain' }))),
  fetchBlobByXpath: vi.fn((): Observable<Blob> => of(new Blob(['x']))),
  fetchThumbnail: vi.fn((): Observable<Blob> => of(new Blob(['x'], { type: 'image/png' }))),
  fetchPdfRendition: vi.fn((): Observable<Blob> =>
    of(new Blob(['x'], { type: 'application/pdf' })),
  ),
  getAllComments: vi.fn((): Observable<{ entries: unknown[] }> => of({ entries: [] })),
  createComment: vi.fn((): Observable<unknown> => of({})),
  createReply: vi.fn((): Observable<unknown> => of({})),
  updateComment: vi.fn((): Observable<unknown> => of({})),
  deleteComment: vi.fn((): Observable<void> => of(undefined)),
  getVersions: vi.fn((): Observable<unknown[]> => of([])),
  getVersionsDirect: vi.fn((): Observable<NuxeoDocument[]> => of([])),
  getPublishedVersions: vi.fn((): Observable<unknown[]> => of([])),
  getSectionTree: vi.fn((): Observable<unknown[]> => of([])),
  getRunnableWorkflows: vi.fn((): Observable<unknown[]> => of([])),
  publishDocument: vi.fn((): Observable<unknown> => of({})),
  unpublishDocument: vi.fn((): Observable<void> => of(undefined)),
  restoreVersion: vi.fn((): Observable<unknown> => of({})),
  lockDocument: vi.fn((): Observable<unknown> => of({})),
  unlockDocument: vi.fn((): Observable<unknown> => of({})),
  subscribe: vi.fn((): Observable<void> => of(undefined)),
  unsubscribe: vi.fn((): Observable<void> => of(undefined)),
  addToFavorites: vi.fn((): Observable<void> => of(undefined)),
  removeFromFavorites: vi.fn((): Observable<void> => of(undefined)),
  addToCollection: vi.fn((): Observable<void> => of(undefined)),
  uploadAttachment: vi.fn((): Observable<unknown> => of({})),
  blockPermissionInheritance: vi.fn((): Observable<void> => of(undefined)),
  unblockPermissionInheritance: vi.fn((): Observable<void> => of(undefined)),
  sendNotificationEmailForPermission: vi.fn((): Observable<unknown> => of({})),
  exportXml: vi.fn((): Observable<Blob> => of(new Blob(['<xml/>']))),
  exportZip: vi.fn((): Observable<Blob> => of(new Blob(['zip']))),
  getAuditLog: vi.fn((): Observable<Record<string, unknown>> =>
    of({ entries: [], resultsCount: 0 }),
  ),
  trashDocument: vi.fn((): Observable<void> => of(undefined)),
  restoreFromTrash: vi.fn((): Observable<void> => of(undefined)),
  getDocumentPermissions: vi.fn((): Observable<NuxeoDocument> => of(doc())),
  permanentlyDelete: vi.fn((): Observable<void> => of(undefined)),
};

const mockBrowseService = {
  updateDocument: vi.fn((): Observable<NuxeoDocument> => of(doc())),
};

const mockDirectoryService = {
  getEventTypes: vi.fn((): Observable<unknown[]> => of([])),
  getEventCategories: vi.fn((): Observable<unknown[]> => of([])),
  getEntries: vi.fn((): Observable<unknown[]> => of([])),
  getAllL10nEntries: vi.fn((): Observable<unknown[]> => of([])),
};

const mockTaskService = { getDocumentTasks: vi.fn((): Observable<unknown[]> => of([])) };
const mockWorkflowService = {
  getDocumentWorkflows: vi.fn((): Observable<unknown[]> => of([])),
  startWorkflow: vi.fn((): Observable<unknown> => of({})),
  cancelWorkflow: vi.fn((): Observable<void> => of(undefined)),
};
const mockARenderService = {
  isAvailable: vi.fn((): Observable<boolean> => of(false)),
  getPreviewerUrl: vi.fn((): Observable<string | null> => of(null)),
};
const mockTagService = {
  addTag: vi.fn((): Observable<string[]> => of([])),
  removeTag: vi.fn((): Observable<string[]> => of([])),
  searchTags: vi.fn((): Observable<unknown[]> => of([])),
};
const mockAiGateway = {
  summarize: vi.fn((): Observable<unknown> => of(null)),
  suggestTags: vi.fn((): Observable<{ tags: string[] }> => of({ tags: [] })),
  classify: vi.fn((): Observable<unknown> => of(null)),
  findSimilar: vi.fn((): Observable<{ documents: unknown[] }> => of({ documents: [] })),
  analyzeSentiment: vi.fn((): Observable<{ sentiments: unknown[]; threadSummary: string | null }> =>
    of({ sentiments: [], threadSummary: null }),
  ),
};
const mockNuxeoApi = {
  nxqlSearch: vi.fn((): Observable<{ entries: unknown[] }> => of({ entries: [] })),
};
const mockDialog = {
  open: vi.fn((..._args: unknown[]): { afterClosed: () => Observable<unknown> } => ({
    afterClosed: () => of(undefined),
  })),
};

describe('DocumentDetailComponent — load chain', () => {
  let component: DocumentDetailComponent;
  let fixture: ComponentFixture<DocumentDetailComponent>;
  let router: Router;
  let toast: { show: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let routeParams: BehaviorSubject<ParamMap>;

  /**
   * jsdom provides neither `URL.createObjectURL` nor `revokeObjectURL`, and this component
   * creates blob URLs for every previewable document. Left unstubbed the viewer paths throw
   * `TypeError` as *unhandled* errors, which Vitest flags as possible false positives — tests
   * pass while the code under them blows up.
   *
   * Installed once at describe scope and never restored: TestBed's fixture cleanup runs after an
   * `afterEach` hook, so restoring `undefined` makes destruction throw.
   */
  const created: string[] = [];
  const revoked: string[] = [];
  let seq = 0;
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => {
    const url = `blob:mock/${(seq += 1)}`;
    created.push(url);
    return url;
  });
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn((u: string) => {
    revoked.push(u);
  });

  async function build(initial: NuxeoDocument = doc()): Promise<void> {
    mockDetailService.getFullDocument.mockReturnValue(of(initial));
    fixture = TestBed.createComponent(DocumentDetailComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    await fixture.whenStable();
  }

  /** `rendered` keeps the real template, for a test that asserts what the page shows. */
  async function configure({ rendered = false } = {}): Promise<void> {
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    const bed = TestBed.configureTestingModule({
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
        { provide: KeClientService, useValue: { enrich: emptyKe } },
        { provide: TaskService, useValue: mockTaskService },
        { provide: WorkflowService, useValue: mockWorkflowService },
        { provide: ARenderService, useValue: mockARenderService },
        { provide: TagService, useValue: mockTagService },
        { provide: AiGatewayService, useValue: mockAiGateway },
        { provide: AiChatService, useValue: { openPanel: vi.fn() } },
        { provide: AiFeatureFlagService, useValue: { aiEnabled: signal(false) } },
        { provide: NuxeoApiBase, useValue: mockNuxeoApi },
        { provide: CURRENT_USERNAME, useValue: () => 'tester' },
        { provide: MatDialog, useValue: mockDialog },
        // The tab strip is resolved from Layer 1 now, and `onTabChange` keys its
        // lazy loads off the resolved id rather than a literal index. Without the
        // registration the slot is empty and every tab index addresses nothing.
        provideSatoriExtensions({
          slots: { [EXTENSION_SLOTS.tabs]: PACKAGED_DOCUMENT_TABS },
        }),
      ],
    });
    if (!rendered) {
      bed.overrideComponent(DocumentDetailComponent, {
        set: { imports: [], template: '<div></div>' },
      });
    }
    await bed.compileComponents();
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    created.length = 0;
    revoked.length = 0;
    toast = { show: vi.fn(), error: vi.fn() };
    routeParams = new BehaviorSubject<ParamMap>(convertToParamMap({ uid: 'doc-1' }));

    // `clearAllMocks` clears call history but NOT implementations installed with
    // `mockReturnValue`, so anything a test overrides must be restored explicitly here or it
    // leaks into every later test.
    mockDetailService.getFullDocument.mockReturnValue(of(doc()));
    mockDetailService.fetchBlob.mockReturnValue(of(new Blob(['x'], { type: 'text/plain' })));
    mockDetailService.fetchThumbnail.mockReturnValue(of(new Blob(['x'], { type: 'image/png' })));
    mockDetailService.getAllComments.mockReturnValue(of({ entries: [] }));
    mockARenderService.isAvailable.mockReturnValue(of(false));
    mockARenderService.getPreviewerUrl.mockReturnValue(of(null));
    mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(undefined) }));

    await configure();
  });

  describe('loadDocument', () => {
    it('publishes the document and clears the loading flag', async () => {
      await build(doc({ title: 'Loaded' }));

      expect(mockDetailService.getFullDocument).toHaveBeenCalledWith('doc-1');
      expect(component.doc()?.title).toBe('Loaded');
      expect(component.loading()).toBe(false);
      expect(component.error()).toBeNull();
    });

    it('sets an error message and stops loading when the fetch fails', async () => {
      mockDetailService.getFullDocument.mockReturnValue(throwError(() => new Error('403')));

      fixture = TestBed.createComponent(DocumentDetailComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();

      expect(component.error()).toBe('Failed to load document.');
      expect(component.errorStatus()).toBe(500);
      expect(component.loading()).toBe(false);
      expect(component.doc()).toBeNull();
    });

    it('renders a missing document as the 404 state, the page heading, with Go Back', async () => {
      mockDetailService.getFullDocument.mockReturnValue(throwError(() => ({ status: 404 })));
      TestBed.resetTestingModule();
      await configure({ rendered: true });

      fixture = TestBed.createComponent(DocumentDetailComponent);
      component = fixture.componentInstance;
      await fixture.whenStable();
      fixture.detectChanges();

      const state = (fixture.nativeElement as HTMLElement).querySelector('nxs-error-state');
      expect(component.errorStatus()).toBe(404);
      expect(state?.getAttribute('data-status')).toBe('404');
      expect(state?.querySelector('h1')?.textContent?.trim()).toBe('Failed to load document.');
      expect(state?.querySelector('.nxs-error-state__message')?.textContent).toContain(
        'It may have been moved or deleted',
      );
      expect(state?.querySelector('button')?.textContent).toContain('Go Back');
    });

    /**
     * A folderish document is not a detail surface — the component redirects to browse instead
     * of rendering. Asserted because the early `return` also skips `doc.set()`, so getting this
     * wrong shows an empty detail page rather than the folder's contents.
     */
    it('redirects a folderish document to the browse surface and does not render it', async () => {
      const spy = vi.spyOn(Router.prototype, 'navigateByUrl');
      await build(doc({ type: 'Folder', path: '/default-domain/workspaces/ws' }));

      expect(spy).toHaveBeenCalledWith(expect.stringContaining('/browse'), { replaceUrl: true });
      expect(component.doc()).toBeNull();
      spy.mockRestore();
    });

    it('does not redirect a Collection, which has its own detail surface', async () => {
      const spy = vi.spyOn(Router.prototype, 'navigateByUrl');
      await build(doc({ type: 'Collection' }));

      expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('/browse'), expect.anything());
      spy.mockRestore();
    });

    /**
     * The page is reused across `:uid` changes, so a read for the document the user has left can
     * land after the one they moved to. Applied, it would put the old document's lock state on the
     * toolbar while `toggleLock()` targets the new uid: Unlock sent to a document nobody locked.
     */
    describe('a read that lands after the route has moved on', () => {
      async function openThenLeave(
        left: Observable<NuxeoDocument>,
        next: Observable<NuxeoDocument>,
      ) {
        mockDetailService.getFullDocument.mockReturnValueOnce(left).mockReturnValueOnce(next);
        fixture = TestBed.createComponent(DocumentDetailComponent);
        component = fixture.componentInstance;
        await fixture.whenStable();
        routeParams.next(convertToParamMap({ uid: 'doc-2' }));
        await fixture.whenStable();
      }

      it('is dropped, so the toolbar and the lock action describe the current document', async () => {
        const left = new Subject<NuxeoDocument>();
        await openThenLeave(left, of(doc({ uid: 'doc-2' })));

        left.next(doc({ lockOwner: 'alice', lockCreated: '2026-08-24T10:00:00.000Z' }));
        await fixture.whenStable();

        expect(component.doc()?.uid).toBe('doc-2');
        expect(component.isLocked()).toBe(false);
        expect(component.lockOwner()).toBeNull();

        component.toggleLock();

        expect(mockDetailService.unlockDocument).not.toHaveBeenCalled();
        expect(mockDetailService.lockDocument).toHaveBeenCalledWith('doc-2');
      });

      it('does not report its failure on the current document', async () => {
        const left = new Subject<NuxeoDocument>();
        const current = new Subject<NuxeoDocument>();
        await openThenLeave(left, current);

        left.error(new Error('403'));
        await fixture.whenStable();

        expect(component.error()).toBeNull();
        expect(component.loading()).toBe(true);
      });

      it('does not redirect away from the current document when it was folderish', async () => {
        const spy = vi.spyOn(Router.prototype, 'navigateByUrl');
        const left = new Subject<NuxeoDocument>();
        await openThenLeave(left, of(doc({ uid: 'doc-2' })));

        left.next(doc({ type: 'Folder', path: '/default-domain/workspaces/ws' }));
        await fixture.whenStable();

        expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('/browse'), expect.anything());
        expect(component.doc()?.uid).toBe('doc-2');
        spy.mockRestore();
      });
    });
  });

  /**
   * `loadBlob` is a dispatch table on the document's own properties, and each arm sets up a
   * different viewer. Driven through a real document load rather than by calling the private
   * method, so the dispatch is exercised the way it actually runs.
   */
  describe('loadBlob dispatch', () => {
    it('renders a plain-text note without fetching a blob', async () => {
      await build(
        doc({
          type: 'Note',
          properties: { 'note:note': '<p>hello</p>', 'note:mime_type': 'text/html' },
        }),
      );

      expect(component.noteContent()).toBe('<p>hello</p>');
      expect(component.blobLoading()).toBe(false);
      // The note text is already in the document; fetching a blob for it would be a wasted
      // round trip on every note open.
      expect(mockDetailService.fetchBlob).not.toHaveBeenCalled();
    });

    it('renders a markdown note through the sanitiser', async () => {
      await build(
        doc({
          type: 'Note',
          properties: {
            'note:note': '# Title\n\n[link](https://example.com)',
            'note:mime_type': 'text/markdown',
          },
        }),
      );

      expect(component.noteContent()).toContain('# Title');
      // Markdown is rendered to HTML and must arrive sanitised — the raw render is never
      // trusted directly.
      expect(component.noteHtml()).not.toBeNull();
      expect(component.blobLoading()).toBe(false);
    });

    it('treats an empty-string note as a note, not as a missing one', async () => {
      // The guard is `!== undefined && !== null`, deliberately not a truthiness check: an
      // empty note is a real note and must not fall through to the blob paths.
      await build(doc({ type: 'Note', properties: { 'note:note': '' } }));

      expect(component.noteContent()).toBe('');
      expect(mockDetailService.fetchBlob).not.toHaveBeenCalled();
    });

    it('fetches the main blob for a PDF', async () => {
      await build(doc({ properties: { 'file:content': fileContent('application/pdf', 'a.pdf') } }));
      expect(mockDetailService.fetchBlob).toHaveBeenCalledWith('doc-1');
    });

    it('fetches the main blob for an image', async () => {
      await build(doc({ properties: { 'file:content': fileContent('image/png', 'a.png') } }));
      expect(mockDetailService.fetchBlob).toHaveBeenCalledWith('doc-1');
    });

    it('fetches the main blob for audio', async () => {
      await build(doc({ properties: { 'file:content': fileContent('audio/mpeg', 'a.mp3') } }));
      expect(mockDetailService.fetchBlob).toHaveBeenCalledWith('doc-1');
    });

    it('fetches text content and exposes it for the text viewer', async () => {
      mockDetailService.fetchBlob.mockReturnValue(
        of(new Blob(['line one'], { type: 'text/plain' })),
      );
      await build(doc({ properties: { 'file:content': fileContent('text/plain', 'a.txt') } }));

      expect(mockDetailService.fetchBlob).toHaveBeenCalledWith('doc-1');
    });

    it('fetches JSON content through the text path', async () => {
      await build(
        doc({ properties: { 'file:content': fileContent('application/json', 'a.json') } }),
      );
      expect(mockDetailService.fetchBlob).toHaveBeenCalledWith('doc-1');
    });

    it('fetches the main blob for a Picture with no file:content', async () => {
      await build(doc({ type: 'Picture', properties: {} }));
      expect(mockDetailService.fetchBlob).toHaveBeenCalled();
    });

    /**
     * Every container type is folderish, and a folderish document with a path is redirected to
     * browse before `loadBlob` runs, so these use an empty path: it is the only way the branch is
     * reached. With a path this test passed without ever getting there.
     */
    it.each(['Folder', 'Workspace', 'Domain', 'Section', 'OrderedFolder'])(
      'does not attempt a preview for a %s with no content',
      async (type) => {
        await build(
          doc({
            type,
            path: '',
            properties: {},
            contextParameters: { preview: { url: '/nuxeo/preview/x' } },
          }),
        );

        expect(component.doc()?.type).toBe(type);
        expect(component.blobLoading()).toBe(false);
        expect(component.previewUrl()).toBeNull();
        expect(mockDetailService.fetchBlob).not.toHaveBeenCalled();
      },
    );

    it('falls back to a preview for a non-container type with no content', async () => {
      await build(
        doc({
          type: 'File',
          properties: {},
          contextParameters: { preview: { url: '/nuxeo/preview/x' } },
        }),
      );
      // The fallback path runs rather than leaving the viewer stuck loading.
      expect(component.blobLoading()).toBe(false);
      expect(component.previewUrl()).not.toBeNull();
    });

    it('fetches a Picture main file as a blob, not as text, whatever its mime type', async () => {
      mockDetailService.fetchBlob.mockReturnValue(
        of(new Blob(['line one'], { type: 'text/plain' })),
      );
      await build(
        doc({
          type: 'Picture',
          properties: { 'file:content': fileContent('text/plain', 'a.txt') },
        }),
      );
      await fixture.whenStable();

      expect(component.blobUrl()).not.toBeNull();
      expect(component.noteContent()).toBeNull();
    });

    it('reads a text main file as text on a File', async () => {
      mockDetailService.fetchBlob.mockReturnValue(
        of(new Blob(['line one'], { type: 'text/plain' })),
      );
      await build(doc({ properties: { 'file:content': fileContent('text/plain', 'a.txt') } }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(component.noteContent()).toBe('line one');
      expect(component.blobUrl()).toBeNull();
    });

    it('fetches a Picture main file rather than its PDF rendition', async () => {
      await build(
        doc({
          type: 'Picture',
          properties: { 'file:content': fileContent('application/postscript', 'a.eps') },
          contextParameters: { renditions: [{ name: 'pdf' }] },
        }),
      );

      expect(mockDetailService.fetchBlob).toHaveBeenCalledWith('doc-1');
      expect(mockDetailService.fetchPdfRendition).not.toHaveBeenCalled();
    });

    it('shows the PDF rendition of a custom type with an unpreviewable main file', async () => {
      await build(
        doc({
          type: 'Claim',
          properties: { 'file:content': fileContent('application/postscript', 'a.eps') },
          contextParameters: { renditions: [{ name: 'pdf' }] },
        }),
      );

      expect(mockDetailService.fetchPdfRendition).toHaveBeenCalledWith('doc-1');
      expect(mockDetailService.fetchBlob).not.toHaveBeenCalled();
    });

    it('extracts picture metadata when picture:views are present', async () => {
      await build(
        doc({
          type: 'Picture',
          properties: {
            'picture:views': [
              {
                title: 'Original',
                width: 1920,
                height: 1080,
                content: { 'mime-type': 'image/jpeg', length: 500000, data: '/nuxeo/x.jpg' },
              },
              {
                title: 'Thumbnail',
                width: 100,
                height: 100,
                content: { 'mime-type': 'image/jpeg', length: 5000, data: '/nuxeo/t.jpg' },
              },
            ],
          },
        }),
      );

      expect(component.doc()?.type).toBe('Picture');
    });

    it('takes the video path when transcoded videos are present', async () => {
      await build(
        doc({
          type: 'Video',
          properties: {
            'vid:transcodedVideos': [
              {
                name: 'MP4 480p',
                content: { 'mime-type': 'video/mp4', data: '/nuxeo/v480.mp4', length: 1000 },
              },
            ],
            'vid:info': { duration: 12.5, width: 640, height: 480, format: 'mp4' },
          },
        }),
      );

      expect(component.doc()?.type).toBe('Video');
    });

    it('takes the video path for a video mime on file:content', async () => {
      await build(
        doc({ type: 'Video', properties: { 'file:content': fileContent('video/mp4', 'v.mp4') } }),
      );
      expect(mockDetailService.fetchBlob).toHaveBeenCalled();
    });
  });

  describe('per-type decisions outside the viewer', () => {
    it.each<[string, string, boolean]>([
      ['Picture', 'application/octet-stream', true],
      ['File', 'image/png', true],
      ['File', 'application/pdf', false],
      ['Claim', 'application/octet-stream', false],
    ])('offers image enrichment on a %s holding %s: %s', async (type, mime, expected) => {
      await build(doc({ type, properties: { 'file:content': fileContent(mime, 'f.bin') } }));

      expect(component.supportsImageKnowledgeEnrichment()).toBe(expected);
    });

    describe('focusing the editor of a note just created', () => {
      afterEach(() => history.replaceState(null, ''));

      it('focuses the note editor when the new document is a Note', async () => {
        history.replaceState({ freshNote: true }, '');
        await build(doc({ type: 'Note', properties: { 'note:note': '' } }));

        expect(component.focusNoteEditor()).toBe(true);
      });

      it('does not focus anything when the new document is not a Note', async () => {
        history.replaceState({ freshNote: true }, '');
        await build(doc({ type: 'File' }));

        expect(component.focusNoteEditor()).toBe(false);
      });
    });
  });

  describe('blob URL lifecycle', () => {
    it('revokes the blob URLs it created when the component is destroyed', async () => {
      await build(doc({ properties: { 'file:content': fileContent('image/png', 'a.png') } }));

      const outstanding = [...created];
      // If the viewer never produced a blob URL there is nothing to assert about revocation,
      // and that itself would mean the image path did not run.
      expect(outstanding.length, 'the image path created no blob URL').toBeGreaterThan(0);

      fixture.destroy();

      for (const url of outstanding) {
        expect(revoked, `blob ${url} survived destruction`).toContain(url);
      }
    });
  });

  describe('action states', () => {
    it('reflects a locked document', async () => {
      await build(
        doc({
          properties: { 'uid:major_version': 1 },
          contextParameters: { permissions: ['Read'], lock: null },
        }),
      );
      expect(component.doc()).not.toBeNull();
    });

    it('releases the in-progress flag when locking fails', async () => {
      await build();
      mockDetailService.lockDocument.mockReturnValue(throwError(() => new Error('denied')));
      component.actionInProgress.set(null);

      component.toggleLock();

      // A stuck flag disables the action permanently for the life of the component.
      expect(component.actionInProgress()).toBeNull();
    });

    it('releases the in-progress flag when favouriting fails', async () => {
      await build();
      mockDetailService.addToFavorites.mockReturnValue(throwError(() => new Error('boom')));
      component.actionInProgress.set(null);
      component.isFavorite.set(false);

      component.toggleFavorite();

      expect(component.actionInProgress()).toBeNull();
    });
  });
  describe('trash and permanent delete', () => {
    it('trashes after confirmation and navigates away', async () => {
      await build();
      mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });
      mockDetailService.trashDocument.mockReturnValue(of(undefined));

      component.trashDocument();

      expect(mockDetailService.trashDocument).toHaveBeenCalledWith('doc-1');
      expect(component.actionInProgress()).toBeNull();
    });

    it('does not trash when the confirmation is dismissed', async () => {
      await build();
      mockDialog.open.mockReturnValue({ afterClosed: () => of(false) });

      component.trashDocument();

      expect(mockDetailService.trashDocument).not.toHaveBeenCalled();
    });

    it('releases the in-progress flag when trashing fails', async () => {
      await build();
      mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });
      mockDetailService.trashDocument.mockReturnValue(throwError(() => new Error('denied')));

      component.trashDocument();

      expect(component.actionInProgress()).toBeNull();
    });

    it('refuses to trash without the Remove permission', async () => {
      await build(doc({ contextParameters: { permissions: ['Read'] } }));
      mockDialog.open.mockClear();

      component.trashDocument();

      // Hiding the action is not the control — the permission check is. It must refuse before
      // even opening the confirmation.
      expect(mockDialog.open).not.toHaveBeenCalled();
      expect(mockDetailService.trashDocument).not.toHaveBeenCalled();
    });

    it('restores from trash and reloads the document', async () => {
      await build();
      mockDetailService.restoreFromTrash.mockReturnValue(of(undefined));
      mockDetailService.getFullDocument.mockClear();

      component.restoreFromTrash();

      expect(mockDetailService.restoreFromTrash).toHaveBeenCalledWith('doc-1');
      expect(mockDetailService.getFullDocument).toHaveBeenCalled();
      expect(component.actionInProgress()).toBeNull();
    });

    it('releases the in-progress flag when restore fails', async () => {
      await build();
      mockDetailService.restoreFromTrash.mockReturnValue(throwError(() => new Error('nope')));

      component.restoreFromTrash();

      expect(component.actionInProgress()).toBeNull();
    });

    it('permanently deletes after confirmation', async () => {
      await build();
      mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });
      mockDetailService.permanentlyDelete.mockReturnValue(of(undefined));

      component.permanentlyDelete();

      expect(mockDetailService.permanentlyDelete).toHaveBeenCalledWith('doc-1');
      expect(component.actionInProgress()).toBeNull();
    });

    it('releases the in-progress flag when permanent delete fails', async () => {
      await build();
      mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });
      mockDetailService.permanentlyDelete.mockReturnValue(throwError(() => new Error('denied')));

      component.permanentlyDelete();

      expect(component.actionInProgress()).toBeNull();
    });
  });

  describe('tags', () => {
    it('keeps the document in step with the tags the tag editor saved', async () => {
      await build(doc({ properties: { 'nxtag:tags': [{ label: 'old', username: 'jdoe' }] } }));

      component.setTags(['old', 'q3report']);

      expect(component.doc()?.properties['nxtag:tags']).toEqual([
        { label: 'old' },
        { label: 'q3report' },
      ]);
      expect(component.tags()).toEqual(['old', 'q3report']);
    });

    it('lets a user with Write tag the document itself, as Web UI does', async () => {
      await build(doc({ contextParameters: { permissions: ['Read', 'Write'] } }));
      expect(component.canTag()).toBe(true);
    });

    it('does not let a user tag without Write, even with WriteProperties', async () => {
      await build(doc({ contextParameters: { permissions: ['Read', 'WriteProperties'] } }));
      expect(component.canTag()).toBe(false);
    });

    it('does not let anyone tag a version or a proxy', async () => {
      await build(doc({ isVersion: true, contextParameters: { permissions: ['Read', 'Write'] } }));
      expect(component.canTag()).toBe(false);

      await build(doc({ isProxy: true, contextParameters: { permissions: ['Read', 'Write'] } }));
      expect(component.canTag()).toBe(false);
    });
  });

  describe('permissions tab', () => {
    it('merges refreshed permissions into the document already on screen', async () => {
      await build();
      const refreshed = doc({ contextParameters: { permissions: ['Read'] } });
      mockDetailService.getDocumentPermissions.mockReturnValue(of(refreshed));

      component.onTabChange(2);

      expect(mockDetailService.getDocumentPermissions).toHaveBeenCalledWith('doc-1');
      expect(component.permissionsLoading()).toBe(false);
    });

    it('clears the loading flag and warns when the refresh fails', async () => {
      await build();
      mockDetailService.getDocumentPermissions.mockReturnValue(throwError(() => new Error('403')));

      component.onTabChange(2);

      expect(component.permissionsLoading()).toBe(false);
    });
  });
});
