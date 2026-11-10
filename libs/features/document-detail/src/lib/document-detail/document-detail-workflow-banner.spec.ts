import { ComponentFixture, TestBed } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  withDisabledInitialNavigation,
} from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';

import {
  ARenderService,
  BrowseService,
  CURRENT_USERNAME,
  DirectoryService,
  DocumentDetailService,
  NuxeoApiBase,
  TagService,
  TaskService,
  WorkflowService,
  type NuxeoDocument,
  type NuxeoWorkflow,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  AiChatService,
  AiFeatureFlagService,
  AiGatewayService,
} from '@agentic-ui/shared/ai-client';
import {
  PACKAGED_DOCUMENT_TABS,
  PACKAGED_DOCUMENT_TOOLBAR_ACTIONS,
  EXTENSION_SLOTS,
  provideSatoriExtensions,
} from '@nuxeo/satori-platform/extensions';
import { NxsToastService } from '@nuxeo/satori-platform/components';

import { DocumentDetailComponent } from './document-detail';

/**
 * Renders the real `document-detail.html`, not the stub the action specs use, so the
 * workflow banner's loop, its Abandon button and its dismiss button are exercised as
 * the user meets them. Setup mirrors `document-detail.actions.spec.ts`.
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

const empty = (): Observable<{ entries: unknown[] }> => of({ entries: [] });

const mockDetailService = {
  getFullDocument: vi.fn((): Observable<NuxeoDocument> => of(doc())),
  fetchBlob: vi.fn((): Observable<Blob> => of(new Blob(['x']))),
  fetchBlobByXpath: vi.fn((): Observable<Blob> => of(new Blob(['x']))),
  fetchThumbnail: vi.fn((): Observable<Blob> => of(new Blob(['thumb'], { type: 'image/png' }))),
  fetchPdfRendition: vi.fn((): Observable<Blob> => of(new Blob(['pdf']))),
  exportXml: vi.fn((): Observable<Blob> => of(new Blob(['<xml/>']))),
  exportZip: vi.fn((): Observable<Blob> => of(new Blob(['zip']))),
  getAllComments: vi.fn(empty),
  getVersions: vi.fn(empty),
  getVersionsDirect: vi.fn((): Observable<unknown[]> => of([])),
  getPublishedVersions: vi.fn(empty),
  getSectionTree: vi.fn(empty),
  getRunnableWorkflows: vi.fn((): Observable<unknown[]> => of([])),
  getAuditLog: vi.fn((): Observable<{ entries: unknown[]; resultsCount: number }> =>
    of({ entries: [], resultsCount: 0 }),
  ),
  getDocumentPermissions: vi.fn((): Observable<NuxeoDocument> => of(doc())),
  lockDocument: vi.fn((): Observable<unknown> => of({})),
  unlockDocument: vi.fn((): Observable<unknown> => of({})),
  subscribe: vi.fn((): Observable<void> => of(undefined)),
  unsubscribe: vi.fn((): Observable<void> => of(undefined)),
  addToFavorites: vi.fn((): Observable<void> => of(undefined)),
  removeFromFavorites: vi.fn((): Observable<void> => of(undefined)),
  addToCollection: vi.fn((): Observable<void> => of(undefined)),
  uploadAttachment: vi.fn((): Observable<unknown> => of({})),
};

const mockWorkflowService = {
  getDocumentWorkflows: vi.fn((): Observable<NuxeoWorkflow[]> => of([])),
  startWorkflow: vi.fn((): Observable<unknown> => of({})),
  cancelWorkflow: vi.fn((): Observable<void> => of(undefined)),
};

describe('DocumentDetailComponent — workflow banner, rendered', () => {
  let fixture: ComponentFixture<DocumentDetailComponent>;

  beforeEach(async () => {
    vi.clearAllMocks();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:mock/1');
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
    mockDetailService.getFullDocument.mockReturnValue(of(doc()));
    mockWorkflowService.getDocumentWorkflows.mockReturnValue(of([workflow()]));

    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), MatIconTestingModule, DocumentDetailComponent],
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
        {
          // The real template renders child components that read the API base directly.
          provide: NuxeoApiBase,
          useValue: {
            get: vi.fn(() => of({ entries: [] })),
            post: vi.fn(() => of({})),
            put: vi.fn(() => of({})),
            delete: vi.fn(() => of({})),
            nxqlSearch: vi.fn(() => of({ entries: [] })),
          },
        },
        { provide: CURRENT_USERNAME, useValue: () => 'tester' },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: NxsToastService, useValue: { show: vi.fn(), error: vi.fn() } },
        provideSatoriExtensions({
          slots: {
            [EXTENSION_SLOTS.toolbar]: PACKAGED_DOCUMENT_TOOLBAR_ACTIONS,
            [EXTENSION_SLOTS.tabs]: PACKAGED_DOCUMENT_TABS,
          },
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DocumentDetailComponent);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  /** The workflow banners currently in the rendered DOM. */
  function banners(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('sat-banner'));
  }

  it('dismisses a workflow banner from the page, and does not cancel the workflow', async () => {
    expect(banners()).toHaveLength(1);

    const dismiss: HTMLButtonElement = fixture.nativeElement.querySelector(
      'sat-banner button[satBannerDismissButton]',
    );
    dismiss.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(banners()).toHaveLength(0);
    expect(mockWorkflowService.cancelWorkflow).not.toHaveBeenCalled();
  });

  it('still offers Abandon on the banner, which cancels the workflow', async () => {
    const abandon: HTMLButtonElement = Array.from(
      fixture.nativeElement.querySelectorAll('sat-banner button[satBannerAction]'),
    ).find((b) => (b as HTMLElement).textContent?.trim()) as HTMLButtonElement;
    abandon.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockWorkflowService.cancelWorkflow).toHaveBeenCalledWith('wf-1');
  });
});
