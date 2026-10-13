import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  ActivatedRoute,
  convertToParamMap,
  type ParamMap,
  provideRouter,
  Router,
  withDisabledInitialNavigation,
} from '@angular/router';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { type MockInstance, vi } from 'vitest';

import { AppConfigService } from '@nuxeo-satori/platform/app-config';
import {
  EXTENSION_SLOTS,
  PACKAGED_DOCUMENT_TABS,
  PACKAGED_DOCUMENT_TOOLBAR_ACTIONS,
  provideSatoriExtensions,
} from '@nuxeo-satori/platform/extensions';
import {
  ARenderService,
  BrowseService,
  ContentLakeIngestService,
  CURRENT_USERNAME,
  DirectoryService,
  DocumentDetailService,
  NuxeoApiBase,
  TagService,
  TaskService,
  WorkflowService,
  type NuxeoDocument,
  type NuxeoWorkflow,
} from '@nuxeo-satori/platform/nuxeo-client';
import { ConfirmDialogComponent } from '@nuxeo-satori/platform/ui';
import {
  AiChatService,
  AiFeatureFlagService,
  AiGatewayService,
} from '@agentic-ui/shared/ai-client';
import { KdClientService } from '@agentic-ui/shared/kd-client';
import { KeClientService, type KeEnrichmentResult } from '@agentic-ui/shared/ke-client';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

import { DocumentDetailComponent } from './document-detail';

/**
 * NXSAT-332 — the versions list, the version view and restore, against the **rendered**
 * template.
 *
 * The defect lived in a template binding — each version's `(click)` was `restoreVersion(v)` —
 * and the sibling specs stub the template out, which is how it went unnoticed: their restore
 * test called the method directly and so asserted the very behaviour that destroyed work.
 * Only a real click can tell "opens" from "restores".
 */

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
};

/** What the server's `permissions` enricher reports to a `ReadWrite` user — on a version too. */
const WRITER = ['Read', 'Write', 'WriteVersion', 'ReadWrite', 'Remove', 'WriteSecurity'];

function live(over: Partial<NuxeoDocument> = {}): NuxeoDocument {
  return {
    uid: 'doc-live',
    title: 'Contract',
    type: 'File',
    path: '/default-domain/workspaces/ws/contract',
    state: 'project',
    lastModified: '2026-10-09T10:00:00.000Z',
    isCheckedOut: true,
    isVersion: false,
    facets: ['Versionable', 'Commentable'],
    properties: { 'uid:major_version': 0, 'uid:minor_version': 2 },
    contextParameters: { permissions: WRITER },
    ...over,
  };
}

function version(minor: number, over: Partial<NuxeoDocument> = {}): NuxeoDocument {
  return live({
    uid: `v-0-${minor}`,
    isCheckedOut: false,
    isVersion: true,
    versionableId: 'doc-live',
    facets: ['Immutable', 'Versionable', 'Commentable'],
    properties: { 'uid:major_version': 0, 'uid:minor_version': minor },
    ...over,
  });
}

const emptyKe = (): Observable<KeEnrichmentResult> =>
  of({ textClassification: { result: '' } } as KeEnrichmentResult);

const mockDetailService = {
  getFullDocument: vi.fn((_uid?: string): Observable<NuxeoDocument> => of(live())),
  fetchBlob: vi.fn((): Observable<Blob> => of(new Blob(['x'], { type: 'text/plain' }))),
  fetchBlobByXpath: vi.fn((): Observable<Blob> => of(new Blob(['x']))),
  fetchThumbnail: vi.fn((): Observable<Blob> => of(new Blob(['x'], { type: 'image/png' }))),
  fetchPdfRendition: vi.fn((): Observable<Blob> =>
    of(new Blob(['x'], { type: 'application/pdf' })),
  ),
  getAllComments: vi.fn((): Observable<{ entries: unknown[] }> => of({ entries: [] })),
  getVersions: vi.fn((_uid: string): Observable<{ entries: NuxeoDocument[] }> =>
    of({ entries: [version(2), version(1)] }),
  ),
  getPublishedVersions: vi.fn((): Observable<{ entries: unknown[] }> => of({ entries: [] })),
  getSectionTree: vi.fn((): Observable<{ entries: unknown[] }> => of({ entries: [] })),
  getRunnableWorkflows: vi.fn((): Observable<unknown[]> => of([])),
  getAuditLog: vi.fn((): Observable<Record<string, unknown>> =>
    of({ entries: [], resultsCount: 0 }),
  ),
  getDocumentPermissions: vi.fn((): Observable<NuxeoDocument> => of(live())),
  restoreVersion: vi.fn((_uid: string): Observable<unknown> => of(live({ isCheckedOut: false }))),
};

let dialogResult: unknown = undefined;
const mockDialog = {
  open: vi.fn((_component: unknown, _config?: { data?: unknown }) => ({
    afterClosed: () => of(dialogResult),
  })),
};

const snack = vi.fn();

const mockWorkflowService = {
  getDocumentWorkflows: vi.fn((_uid: string): Observable<NuxeoWorkflow[]> => of([])),
};

const mockContentLake = {
  startIngest: vi.fn(() => of({ commandId: 'c1' })),
  waitUntilComplete: vi.fn(() => of({})),
  markIngested: vi.fn(() => of([])),
  backfillIngestMarkerIfNeeded: vi.fn(() => of({ doc: null, presentInContentLake: false })),
};

/** A blob Content Lake can ingest, and Knowledge Enrichment can read. */
const PDF = { 'file:content': { name: 'a.pdf', 'mime-type': 'application/pdf', data: '' } };

describe('DocumentDetailComponent — versions (NXSAT-332)', () => {
  let fixture: ComponentFixture<DocumentDetailComponent>;
  let navigate: MockInstance<Router['navigate']>;

  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:mock/1');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();

  async function render(
    focused: NuxeoDocument,
    route: { query?: Record<string, string>; paramMap?: Observable<ParamMap> } = {},
  ): Promise<void> {
    mockDetailService.getFullDocument.mockReturnValue(of(focused));
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [DocumentDetailComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: route.paramMap ?? of(convertToParamMap({ uid: focused.uid })),
            queryParamMap: of(convertToParamMap(route.query ?? {})),
            snapshot: { queryParamMap: convertToParamMap(route.query ?? {}) },
          },
        },
        { provide: DocumentDetailService, useValue: mockDetailService },
        { provide: BrowseService, useValue: { updateDocument: vi.fn(() => of(live())) } },
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
        { provide: TagService, useValue: { searchTags: vi.fn(() => of([])) } },
        {
          provide: AiGatewayService,
          useValue: { summarize: vi.fn(() => of(null)), classify: vi.fn(() => of(null)) },
        },
        { provide: AiChatService, useValue: { openPanel: vi.fn() } },
        { provide: AiFeatureFlagService, useValue: { aiEnabled: signal(false) } },
        {
          provide: NuxeoApiBase,
          useValue: {
            nxqlSearch: vi.fn(() => of({ entries: [] })),
            get: vi.fn(() => of({ schemas: [] })),
          },
        },
        { provide: CURRENT_USERNAME, useValue: () => 'tester' },
        { provide: ContentLakeIngestService, useValue: mockContentLake },
        { provide: KdClientService, useValue: { listIngestSourceIds: vi.fn(() => of([])) } },
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        provideSatoriExtensions({
          slots: {
            [EXTENSION_SLOTS.toolbar]: PACKAGED_DOCUMENT_TOOLBAR_ACTIONS,
            [EXTENSION_SLOTS.tabs]: PACKAGED_DOCUMENT_TABS,
          },
        }),
      ],
    })
      // The real template imports the Material modules, whose own `MatDialog` and
      // `MatSnackBar` would otherwise shadow a root-level mock.
      .overrideProvider(MatDialog, { useValue: mockDialog })
      .overrideProvider(MatSnackBar, { useValue: { open: snack } })
      .compileComponents();

    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(DocumentDetailComponent);
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function el<T extends HTMLElement = HTMLElement>(selector: string): T | null {
    return fixture.nativeElement.querySelector(selector) as T | null;
  }

  async function click(selector: string): Promise<void> {
    const target = el(selector);
    expect(target, `${selector} is rendered`).toBeTruthy();
    target?.click();
    await settle();
  }

  async function openVersionsList(): Promise<void> {
    await click('.version-select');
  }

  function versionItem(label: string): HTMLElement | undefined {
    return [...fixture.nativeElement.querySelectorAll('.version-dropdown-item')].find(
      (item) =>
        (item as HTMLElement).querySelector('.version-dropdown-label')?.textContent?.trim() ===
        label,
    ) as HTMLElement | undefined;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    dialogResult = undefined;
    mockDetailService.getVersions.mockReturnValue(of({ entries: [version(2), version(1)] }));
    mockDetailService.restoreVersion.mockReturnValue(of(live({ isCheckedOut: false })));
    mockWorkflowService.getDocumentWorkflows.mockImplementation(() => of([]));
  });

  afterEach(() => fixture?.destroy());

  describe('the versions list', () => {
    it('opens the version a user clicks, and restores nothing', async () => {
      await render(live());
      await openVersionsList();

      versionItem('0.1')?.click();
      await settle();

      expect(mockDetailService.restoreVersion).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/doc', 'v-0-1'], {});
    });

    it('lets a user who cannot write open a version too', async () => {
      await render(live({ contextParameters: { permissions: ['Read', 'ReadVersion'] } }));
      await openVersionsList();

      expect(versionItem('0.1')?.tagName).toBe('BUTTON');
      versionItem('0.1')?.click();
      await settle();

      expect(navigate).toHaveBeenCalledWith(['/doc', 'v-0-1'], {});
    });

    it("lists the live document's versions while a version is open, and leads back to it", async () => {
      await render(version(1));
      await openVersionsList();

      expect(mockDetailService.getVersions).toHaveBeenCalledWith('doc-live');
      expect(versionItem('0.1')?.getAttribute('aria-current')).toBe('true');
      expect(versionItem('0.2')?.getAttribute('aria-current')).toBeNull();

      await click('.version-dropdown-latest');
      expect(navigate).toHaveBeenCalledWith(['/doc', 'doc-live'], {});
    });
    it('keeps the browse return mode when moving between a document and its versions', async () => {
      await render(live(), { query: { browseReturn: 'adf-hx' } });
      await openVersionsList();

      versionItem('0.1')?.click();
      await settle();

      expect(navigate).toHaveBeenCalledWith(['/doc', 'v-0-1'], {
        queryParams: { browseReturn: 'adf-hx' },
      });
    });

    it('ignores a slower response for a document the route has already left', async () => {
      // Opening a version and going straight back: the version's response arrives last.
      const route = new BehaviorSubject(convertToParamMap({ uid: 'doc-live' }));
      const versionLoad = new Subject<NuxeoDocument>();
      await render(live(), { paramMap: route });
      mockDetailService.getFullDocument.mockImplementation((uid) =>
        uid === 'v-0-1' ? versionLoad : of(live()),
      );
      route.next(convertToParamMap({ uid: 'v-0-1' }));
      route.next(convertToParamMap({ uid: 'doc-live' }));
      await settle();
      versionLoad.next(version(1));
      await settle();

      expect(fixture.componentInstance.doc()?.uid).toBe('doc-live');
      expect(el('.version-banner')).toBeNull();
    });

    it('drops a versions list that arrives after the route moved to another document', async () => {
      const route = new BehaviorSubject(convertToParamMap({ uid: 'doc-live' }));
      const lateList = new Subject<{ entries: NuxeoDocument[] }>();
      await render(live(), { paramMap: route });
      mockDetailService.getVersions.mockReturnValueOnce(lateList);
      await openVersionsList();
      const other = live({ uid: 'doc-other', title: 'Other' });
      mockDetailService.getFullDocument.mockReturnValue(of(other));
      route.next(convertToParamMap({ uid: 'doc-other' }));
      await settle();
      lateList.next({ entries: [version(2), version(1)] });
      await settle();

      expect(fixture.componentInstance.versions()).toEqual([]);
      expect(fixture.componentInstance.versionsLoading()).toBe(false);
    });

    it('drops a permissions refresh for the document the route has left', async () => {
      // Merged late, it would hand the live document's permissions to the version on screen.
      const route = new BehaviorSubject(convertToParamMap({ uid: 'doc-live' }));
      await render(live(), { paramMap: route });
      const late = new Subject<NuxeoDocument>();
      mockDetailService.getDocumentPermissions.mockReturnValueOnce(late);
      fixture.componentInstance['reloadDocumentPermissions']();
      mockDetailService.getFullDocument.mockImplementation((uid) =>
        of(uid === 'v-0-1' ? version(1) : live()),
      );
      route.next(convertToParamMap({ uid: 'v-0-1' }));
      await settle();
      late.next(live({ contextParameters: { permissions: ['Read', 'LateMarker'] } }));
      await settle();

      expect(fixture.componentInstance.doc()?.uid).toBe('v-0-1');
      expect(fixture.componentInstance.doc()?.contextParameters?.['permissions']).not.toContain(
        'LateMarker',
      );
    });

    it('drops comments that arrive after the route moved on', async () => {
      const route = new BehaviorSubject(convertToParamMap({ uid: 'doc-live' }));
      await render(live(), { paramMap: route });
      const late = new Subject<{ entries: unknown[] }>();
      mockDetailService.getAllComments.mockReturnValueOnce(late);
      fixture.componentInstance.loadComments();
      mockDetailService.getFullDocument.mockImplementation((uid) =>
        of(uid === 'v-0-1' ? version(1) : live()),
      );
      route.next(convertToParamMap({ uid: 'v-0-1' }));
      await settle();
      late.next({
        entries: [
          { uid: 'c1', properties: { 'comment:parentId': 'doc-live', 'comment:text': 'live' } },
        ],
      });
      await settle();

      expect(fixture.componentInstance.repliesMap()).toEqual({});
    });

    it("drops the live document's workflows when they arrive after a version opened", async () => {
      const route = new BehaviorSubject(convertToParamMap({ uid: 'doc-live' }));
      const liveWorkflows = new Subject<NuxeoWorkflow[]>();
      mockWorkflowService.getDocumentWorkflows.mockImplementation((uid) =>
        uid === 'doc-live' ? liveWorkflows : of([]),
      );
      await render(live(), { paramMap: route });
      mockDetailService.getFullDocument.mockImplementation((uid) =>
        of(uid === 'v-0-1' ? version(1) : live()),
      );
      route.next(convertToParamMap({ uid: 'v-0-1' }));
      await settle();
      liveWorkflows.next([{ id: 'wf-live', name: 'SerialDocumentReview' } as NuxeoWorkflow]);
      await settle();

      expect(fixture.componentInstance.doc()?.uid).toBe('v-0-1');
      expect(fixture.componentInstance.documentWorkflows()).toEqual([]);
    });
  });

  describe('viewing a version', () => {
    it('names the version in a banner and offers a way back to the latest', async () => {
      await render(version(1));

      expect(el('.version-banner')?.textContent).toContain("You're viewing the 0.1 version.");
      await click('.version-banner-latest');
      expect(navigate).toHaveBeenCalledWith(['/doc', 'doc-live'], {});
    });

    it('is read-only even though the permissions enricher reports Write', async () => {
      await render(version(1));
      const component = fixture.componentInstance;

      expect(component.canWriteDoc()).toBe(false);
      expect(component.canManagePermissions()).toBe(false);
      expect(el('[data-action-id="app.toolbar.edit"]')).toBeNull();
      expect(el('.create-version-btn')).toBeNull();
    });

    it('offers no enrichment that would write back to a version', async () => {
      // Knowledge Enrichment writes `dc:description` / `dc:nature` and tags back to the document.
      await render(live({ properties: { ...live().properties, ...PDF } }));
      expect(el('.ke-action-group')).toBeTruthy();

      fixture.destroy();
      await render(version(1, { properties: { ...version(1).properties, ...PDF } }));
      expect(el('.ke-action-group')).toBeNull();
    });

    it('does not backfill the Content Lake marker on a version, which would be a write', async () => {
      await render(live({ properties: { ...live().properties, ...PDF } }));
      expect(mockContentLake.backfillIngestMarkerIfNeeded).toHaveBeenCalled();

      mockContentLake.backfillIngestMarkerIfNeeded.mockClear();
      fixture.destroy();
      await render(version(1, { properties: { ...version(1).properties, ...PDF } }));
      expect(mockContentLake.backfillIngestMarkerIfNeeded).not.toHaveBeenCalled();
    });

    it('refuses an edit on a version even if a manifest re-enables the action', async () => {
      await render(version(1));

      fixture.componentInstance.openEditDialog();

      expect(mockDialog.open).not.toHaveBeenCalled();
      expect(snack).toHaveBeenCalledWith(
        'You do not have permission to perform this action',
        'OK',
        expect.anything(),
      );
    });

    it('leaves the live document editable', async () => {
      await render(live());

      expect(el('.version-banner')).toBeNull();
      expect(fixture.componentInstance.canWriteDoc()).toBe(true);
      expect(el('[data-action-id="app.toolbar.edit"]')).toBeTruthy();
    });
  });

  describe('restoring a version', () => {
    it('offers Restore to a user with WriteVersion', async () => {
      await render(version(1));

      expect(el('.version-banner-restore')?.textContent).toContain('Restore 0.1');
    });

    it('does not offer Restore without WriteVersion', async () => {
      await render(version(1, { contextParameters: { permissions: ['Read', 'Write'] } }));

      expect(el('.version-banner')).toBeTruthy();
      expect(el('.version-banner-restore')).toBeNull();
    });

    it('asks first, and cancelling restores nothing', async () => {
      dialogResult = false;
      await render(version(1));

      await click('.version-banner-restore');

      expect(mockDialog.open).toHaveBeenCalledWith(
        ConfirmDialogComponent,
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Are you sure?', confirmLabel: 'Restore 0.1' }),
        }),
      );
      expect(mockDetailService.restoreVersion).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('restores on confirmation and returns to the live document', async () => {
      dialogResult = true;
      await render(version(1));

      await click('.version-banner-restore');

      expect(mockDetailService.restoreVersion).toHaveBeenCalledWith('v-0-1');
      expect(snack).toHaveBeenCalledWith('Restored to version 0.1', 'OK', expect.anything());
      expect(navigate).toHaveBeenCalledWith(['/doc', 'doc-live'], {});
    });

    it.each([
      [
        403,
        "You can't restore this version: you don't have permission, or someone else has locked the document.",
      ],
      [
        409,
        "This version can't be restored because of a conflict with the document's current state. Reload the page and try again.",
      ],
      [500, 'Failed to restore version'],
    ])('explains a %i refusal and stays on the version', async (status, message) => {
      dialogResult = true;
      mockDetailService.restoreVersion.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status })),
      );
      await render(version(1));
      mockDetailService.getFullDocument.mockClear();

      await click('.version-banner-restore');

      expect(snack).toHaveBeenCalledWith(message, 'OK', expect.anything());
      expect(navigate).not.toHaveBeenCalled();
      expect(mockDetailService.getFullDocument).not.toHaveBeenCalled();
      expect(fixture.componentInstance.actionInProgress()).toBeNull();
      expect(el('.version-banner-restore')).toBeTruthy();
    });
  });

  describe('Create version', () => {
    const neverVersioned = (over: Partial<NuxeoDocument> = {}): NuxeoDocument =>
      live({ properties: { 'uid:major_version': 0, 'uid:minor_version': 0 }, ...over });

    it('is offered on a versionable document to a user with WriteVersion', async () => {
      await render(neverVersioned());

      expect(el('.create-version-btn')).toBeTruthy();
    });

    it('is not offered to a user with Write but not WriteVersion', async () => {
      await render(
        neverVersioned({
          contextParameters: { permissions: ['Read', 'Write', 'WriteProperties'] },
        }),
      );

      expect(el('.create-version-btn')).toBeNull();
    });

    it('is not offered on a document without the Versionable facet', async () => {
      await render(neverVersioned({ facets: ['Commentable'] }));

      expect(el('.create-version-btn')).toBeNull();
    });

    it('is not offered on a record', async () => {
      // `isRecord` is in Nuxeo's document JSON but not in the `NuxeoDocument` model.
      await render({ ...neverVersioned(), isRecord: true } as NuxeoDocument);

      expect(el('.create-version-btn')).toBeNull();
    });

    it('is offered in the list of a checked-out document only with WriteVersion', async () => {
      await render(live());
      await openVersionsList();
      expect(el('.version-dropdown-create')).toBeTruthy();

      fixture.destroy();
      await render(live({ contextParameters: { permissions: ['Read', 'Write'] } }));
      await openVersionsList();
      expect(el('.version-dropdown-create')).toBeNull();
    });
  });
});
