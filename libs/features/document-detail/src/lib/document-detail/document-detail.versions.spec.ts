import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
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

import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { NxsToastService } from '@nuxeo/satori-platform/components';
import {
  EXTENSION_SLOTS,
  PACKAGED_DOCUMENT_TABS,
  PACKAGED_DOCUMENT_TOOLBAR_ACTIONS,
  provideSatoriExtensions,
} from '@nuxeo/satori-platform/extensions';
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
} from '@nuxeo/satori-platform/nuxeo-client';
import { ConfirmDialogComponent } from '@nuxeo/satori-platform/ui';
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
  getVersionsDirect: vi.fn((_uid: string): Observable<NuxeoDocument[]> =>
    of([version(2), version(1)]),
  ),
  getPublishedVersions: vi.fn((_uid: string): Observable<{ entries: unknown[] }> =>
    of({ entries: [] }),
  ),
  unpublishDocument: vi.fn((_uid: string): Observable<unknown> => of(undefined)),
  publishDocument: vi.fn((): Observable<unknown> => of({})),
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

const toast = { show: vi.fn(), error: vi.fn() };

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
        provideHttpClient(withXhr()),
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
        {
          provide: AppConfigService,
          useValue: {
            manifest: signal({ extensionLayers: [] }),
            featureToggle: (_key: string, fallback: boolean) => fallback,
          },
        },
        provideSatoriExtensions({
          slots: {
            [EXTENSION_SLOTS.toolbar]: PACKAGED_DOCUMENT_TOOLBAR_ACTIONS,
            [EXTENSION_SLOTS.tabs]: PACKAGED_DOCUMENT_TABS,
          },
        }),
      ],
    })
      // The real template imports the Material modules, whose own `MatDialog` would otherwise
      // shadow a root-level mock, and the component provides its own `NxsToastService`.
      .overrideProvider(MatDialog, { useValue: mockDialog })
      .overrideProvider(NxsToastService, { useValue: toast })
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

  /** `nxs-manage-versions`' list opens in the overlay container, outside the fixture. */
  async function openVersionsList(): Promise<void> {
    await click('.nxs-manage-versions__trigger');
  }

  function inMenu<T extends HTMLElement = HTMLElement>(selector: string): T | null {
    return document.querySelector(`.nxs-manage-versions__menu ${selector}`) as T | null;
  }

  function versionItem(label: string): HTMLElement | undefined {
    return [...document.querySelectorAll<HTMLElement>('.nxs-manage-versions__version')].find(
      (item) => item.querySelector('.nxs-manage-versions__number')?.textContent?.trim() === label,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    dialogResult = undefined;
    mockDetailService.getVersions.mockReturnValue(of({ entries: [version(2), version(1)] }));
    mockDetailService.getVersionsDirect.mockReturnValue(of([version(2), version(1)]));
    mockDetailService.restoreVersion.mockReturnValue(of(live({ isCheckedOut: false })));
    mockWorkflowService.getDocumentWorkflows.mockImplementation(() => of([]));
  });

  afterEach(() => {
    fixture?.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove());
  });

  describe('the versions list', () => {
    it('opens the version a user clicks, and restores nothing', async () => {
      await render(live());
      await openVersionsList();

      versionItem('0.1')?.click();
      await settle();

      expect(mockDetailService.restoreVersion).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/doc', 'v-0-1']);
    });

    it('lets a user who cannot write open a version too', async () => {
      await render(live({ contextParameters: { permissions: ['Read', 'ReadVersion'] } }));
      await openVersionsList();

      expect(versionItem('0.1')?.tagName).toBe('BUTTON');
      versionItem('0.1')?.click();
      await settle();

      expect(navigate).toHaveBeenCalledWith(['/doc', 'v-0-1']);
    });

    it("lists the live document's versions while a version is open, and leads back to it", async () => {
      await render(version(1));
      await openVersionsList();

      expect(mockDetailService.getVersionsDirect).toHaveBeenCalledWith('doc-live');
      expect(versionItem('0.1')?.getAttribute('aria-checked')).toBe('true');
      expect(versionItem('0.2')?.getAttribute('aria-checked')).toBe('false');

      inMenu('.nxs-manage-versions__latest')?.click();
      await settle();
      expect(navigate).toHaveBeenCalledWith(['/doc', 'doc-live']);
    });
    it('ignores the browseReturn an old adf-hx browse link carries', async () => {
      // The adf-hx browse route is retired, so its return mode is gone: breadcrumbs lead to
      // /browse and moving to a version no longer carries the parameter along.
      await render(live(), { query: { browseReturn: 'adf-hx' } });
      await openVersionsList();

      expect(
        fixture.componentInstance
          .breadcrumbItems()
          .map((item) => ('href' in item ? item.href : undefined)),
      ).toEqual([
        '/browse/default-domain',
        '/browse/default-domain/workspaces',
        '/browse/default-domain/workspaces/ws',
      ]);

      versionItem('0.1')?.click();
      await settle();

      expect(navigate).toHaveBeenCalledWith(['/doc', 'v-0-1']);
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
      const lateList = new Subject<NuxeoDocument[]>();
      await render(live(), { paramMap: route });
      mockDetailService.getVersionsDirect.mockImplementation((uid: string) =>
        uid === 'doc-live' ? lateList : of([]),
      );
      await openVersionsList();
      document.querySelector<HTMLElement>('.cdk-overlay-backdrop')?.click();
      const other = live({ uid: 'doc-other', title: 'Other' });
      mockDetailService.getFullDocument.mockReturnValue(of(other));
      route.next(convertToParamMap({ uid: 'doc-other' }));
      await settle();
      lateList.next([version(2), version(1)]);
      await settle();
      await openVersionsList();

      expect(mockDetailService.getVersionsDirect).toHaveBeenLastCalledWith('doc-other');
      expect(versionItem('0.1')).toBeUndefined();
      expect(inMenu('')?.textContent ?? document.body.textContent).toContain(
        'No previous versions',
      );
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

    it('clears the previous document’s publications when the route moves', async () => {
      // `loadPublishingData()` skips its own fetch while `publishedDocs` is non-empty, so a
      // stale array did not merely show the wrong count: opening the tab left Unpublish bound
      // to the previous document's proxies, and indefinitely so if the new count request failed.
      const route = new BehaviorSubject(convertToParamMap({ uid: 'doc-live' }));
      const proxy = live({ uid: 'proxy-of-live', path: '/sections/a' });
      mockDetailService.getPublishedVersions.mockReturnValue(of({ entries: [proxy] }));
      await render(live(), { paramMap: route });
      expect(fixture.componentInstance.publishedDocs().map((d) => d.uid)).toEqual([
        'proxy-of-live',
      ]);

      // The next document's count never answers, which is the worst case for a stale array.
      mockDetailService.getPublishedVersions.mockReturnValue(new Subject());
      mockDetailService.getFullDocument.mockImplementation((uid) =>
        of(uid === 'v-0-1' ? version(1) : live()),
      );
      route.next(convertToParamMap({ uid: 'v-0-1' }));
      await settle();

      expect(fixture.componentInstance.publishedDocs()).toEqual([]);
      expect(fixture.componentInstance.publishLoading()).toBe(false);
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
      expect(navigate).toHaveBeenCalledWith(['/doc', 'doc-live']);
    });

    it('is read-only even though the permissions enricher reports Write', async () => {
      await render(version(1));
      const component = fixture.componentInstance;

      expect(component.canWriteDoc()).toBe(false);
      expect(component.canManagePermissions()).toBe(false);
      expect(el('[data-action-id="app.toolbar.edit"]')).toBeNull();
      expect(el('button.nxs-manage-versions__create')).toBeNull();
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
      expect(toast.error).toHaveBeenCalledWith('You do not have permission to perform this action');
    });

    it('leaves the live document editable', async () => {
      await render(live());

      expect(el('.version-banner')).toBeNull();
      expect(fixture.componentInstance.canWriteDoc()).toBe(true);
      expect(el('[data-action-id="app.toolbar.edit"]')).toBeTruthy();
    });
  });

  describe('the version on a publication', () => {
    const publication = (): NuxeoDocument =>
      live({
        uid: 'proxy-of-1-0',
        path: '/default-domain/sections/news/contract',
        isProxy: true,
        isCheckedOut: false,
        properties: { 'uid:major_version': 1, 'uid:minor_version': 0 },
      });

    it('reads as a plain tag, as Web UI shows a proxy, with no versions control', async () => {
      await render(publication());

      expect(el('nxs-manage-versions')).toBeNull();
      expect(el('nxs-properties-panel nxs-tag[nxsVersion]')?.textContent?.trim()).toBe('1.0');
    });

    it('keeps the versions control on the live document and on a version', async () => {
      await render(live());
      expect(el('nxs-manage-versions .nxs-manage-versions__trigger')).not.toBeNull();
      expect(el('nxs-properties-panel nxs-tag[nxsVersion]')).toBeNull();

      fixture.destroy();
      await render(version(1));
      expect(el('nxs-manage-versions .nxs-manage-versions__trigger')).not.toBeNull();
      expect(el('nxs-properties-panel nxs-tag[nxsVersion]')).toBeNull();
    });
  });

  describe('publishing a version (register item 49)', () => {
    const publishableVersion = (): NuxeoDocument =>
      version(1, { facets: ['Immutable', 'Versionable', 'Publishable', 'Commentable'] });

    it('offers Publish on a version, as Web UI does, and opens the dialog for that version', async () => {
      await render(publishableVersion());
      const component = fixture.componentInstance;
      const publish = component.toolbarEntries().find((e) => e.id === 'app.toolbar.publish');
      expect(publish, 'Publish is offered').toBeTruthy();
      expect(publish?.disabled).toBe(false);

      component.runToolbarEntry(publish!);
      await settle();

      expect(toast.error).not.toHaveBeenCalled();
      expect(mockDetailService.getVersionsDirect).toHaveBeenCalledWith('doc-live');
      expect(mockDialog.open.mock.calls.at(-1)?.[1]?.data).toMatchObject({ documentUid: 'v-0-1' });
    });

    it('counts a version’s publications through its live document, as Web UI lists them', async () => {
      const proxy = live({ uid: 'proxy-of-1-0', path: '/sections/a', isProxy: true });
      mockDetailService.getPublishedVersions.mockImplementation((uid: string) =>
        of({ entries: uid === 'doc-live' ? [proxy] : [] }),
      );
      await render(publishableVersion());

      expect(mockDetailService.getPublishedVersions).toHaveBeenCalledWith('doc-live');
      expect(mockDetailService.getPublishedVersions).not.toHaveBeenCalledWith('v-0-1');
      expect(fixture.componentInstance.publicationCount()).toBe(1);
    });

    it('does not offer Publish on a version to a user without WriteVersion', async () => {
      await render(
        version(1, {
          facets: ['Immutable', 'Versionable', 'Publishable'],
          contextParameters: { permissions: ['Read', 'Write', 'ReadWrite'] },
        }),
      );
      expect(
        fixture.componentInstance.toolbarEntries().some((e) => e.id === 'app.toolbar.publish'),
      ).toBe(false);
    });
  });

  describe("the Publishing tab's own actions", () => {
    async function openPublishingTab(): Promise<HTMLElement> {
      fixture.componentInstance.goToPublishingTab();
      await settle();
      return fixture.nativeElement as HTMLElement;
    }

    it('offers Publish to a section only on a document the user can publish', async () => {
      await render(live({ facets: ['Versionable', 'Publishable'] }));
      expect((await openPublishingTab()).querySelector('.publish-btn')).not.toBeNull();

      await render(
        live({
          facets: ['Versionable', 'Publishable'],
          contextParameters: { permissions: ['Read', 'Write', 'ReadWrite'] },
        }),
      );
      const tab = await openPublishingTab();
      expect(tab.querySelector('.publish-container'), 'the tab itself renders').not.toBeNull();
      expect(tab.querySelector('.publish-btn')).toBeNull();
    });

    it('offers Unpublish and Republish only on a publication the user holds WriteVersion on', async () => {
      const proxy = (uid: string, permissions: string[]): NuxeoDocument =>
        live({
          uid,
          path: `/sections/${uid}/contract`,
          isProxy: true,
          contextParameters: { permissions },
          properties: { 'uid:major_version': 0, 'uid:minor_version': 1 },
        });
      mockDetailService.getPublishedVersions.mockReturnValue(
        of({ entries: [proxy('own', ['Read', 'WriteVersion']), proxy('other', ['Read'])] }),
      );
      await render(live({ facets: ['Versionable', 'Publishable'] }));

      const rows = Array.from(
        (await openPublishingTab()).querySelectorAll('.publish-table tbody tr'),
      );
      expect(rows).toHaveLength(2);
      const [own, other] = rows;
      expect(own.querySelector('.unpublish-btn')).not.toBeNull();
      // 0.1 published, 0.2 live: an older version, so it can be republished.
      expect(own.querySelector('.republish-btn')).not.toBeNull();
      expect(other.querySelector('.unpublish-btn')).toBeNull();
      expect(other.querySelector('.republish-btn')).toBeNull();
    });

    describe('asks first, in Web UI’s words', () => {
      async function tabWithOwnPublication(): Promise<HTMLElement> {
        mockDetailService.getPublishedVersions.mockReturnValue(
          of({
            entries: [
              live({
                uid: 'own',
                path: '/sections/own/contract',
                isProxy: true,
                contextParameters: { permissions: ['Read', 'WriteVersion'] },
                properties: { 'uid:major_version': 0, 'uid:minor_version': 1 },
              }),
            ],
          }),
        );
        await render(live({ facets: ['Versionable', 'Publishable'] }));
        return openPublishingTab();
      }

      async function press(tab: HTMLElement, selector: string): Promise<HTMLElement> {
        const button = tab.querySelector<HTMLElement>(selector);
        expect(button, `${selector} is offered`).not.toBeNull();
        button!.focus();
        button!.click();
        await settle();
        return button!;
      }

      const asked = () => mockDialog.open.mock.calls.at(-1)?.[1]?.data;

      it('asks before Unpublish; Cancel unpublishes nothing', async () => {
        const tab = await tabWithOwnPublication();
        await press(tab, '.unpublish-btn');

        expect(asked()).toEqual({
          title: 'Unpublish',
          message: 'Are you sure you want to unpublish this document?',
          confirmLabel: 'Unpublish',
        });
        expect(mockDetailService.unpublishDocument).not.toHaveBeenCalled();
        expect(tab.querySelectorAll('.publish-table tbody tr')).toHaveLength(1);
      });

      it('unpublishes once confirmed, and moves focus from the departed button to the heading', async () => {
        const tab = await tabWithOwnPublication();
        dialogResult = true;
        await press(tab, '.unpublish-btn');

        expect(mockDetailService.unpublishDocument).toHaveBeenCalledWith('own');
        expect(tab.querySelector('.publish-table')).toBeNull();
        expect(document.activeElement?.getAttribute('role')).toBe('heading');
        expect(document.activeElement?.textContent?.trim()).toBe('Publication details');
      });

      it('asks before Republish; Cancel republishes nothing', async () => {
        const tab = await tabWithOwnPublication();
        await press(tab, '.republish-btn');

        expect(asked()).toEqual({
          title: 'Republish',
          message:
            'Are you sure you want to erase this publication with the most recent version of the document?',
          confirmLabel: 'Republish',
        });
        expect(mockDetailService.publishDocument).not.toHaveBeenCalled();
      });

      it('asks before Unpublish All; Cancel removes nothing', async () => {
        const tab = await tabWithOwnPublication();
        await press(tab, '.unpublish-all-btn');

        expect(asked()).toEqual({
          title: 'Unpublish All',
          message: 'Are you sure you want to unpublish these documents?',
          confirmLabel: 'Unpublish All',
        });
        expect(mockDetailService.unpublishDocument).not.toHaveBeenCalled();
      });
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

    it('scopes the warning to every change after the restored version, not since the last one', async () => {
      // "changes made since the last version" described only unsaved edits. Restoring 0.1 while
      // 0.2 exists also replaces what 0.2 contributed, so the version named has to be this one.
      dialogResult = false;
      await render(version(1));

      await click('.version-banner-restore');

      const message = mockDialog.open.mock.calls.at(-1)?.[1]?.data as { message: string };
      expect(message.message).toBe(
        "Restoring version 0.1 replaces the document's current content, " +
          'including any changes made after version 0.1.',
      );
      expect(message.message).not.toContain('the last version');
    });

    it('restores on confirmation and returns to the live document', async () => {
      dialogResult = true;
      await render(version(1));

      await click('.version-banner-restore');

      expect(mockDetailService.restoreVersion).toHaveBeenCalledWith('v-0-1');
      expect(toast.show).toHaveBeenCalledWith('Restored to version 0.1');
      expect(toast.error).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/doc', 'doc-live']);
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

      expect(toast.error).toHaveBeenCalledWith(message);
      expect(toast.show).not.toHaveBeenCalled();
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

      expect(el('button.nxs-manage-versions__create')).toBeTruthy();
    });

    it('is not offered to a user with Write but not WriteVersion', async () => {
      await render(
        neverVersioned({
          contextParameters: { permissions: ['Read', 'Write', 'WriteProperties'] },
        }),
      );

      expect(el('button.nxs-manage-versions__create')).toBeNull();
    });

    it('is not offered on a document without the Versionable facet', async () => {
      await render(neverVersioned({ facets: ['Commentable'] }));

      expect(el('button.nxs-manage-versions__create')).toBeNull();
    });

    it('is not offered on a record', async () => {
      // `isRecord` is in Nuxeo's document JSON but not in the `NuxeoDocument` model.
      await render({ ...neverVersioned(), isRecord: true } as NuxeoDocument);

      expect(el('button.nxs-manage-versions__create')).toBeNull();
    });

    it('is offered in the list of a checked-out document only with WriteVersion', async () => {
      await render(live());
      await openVersionsList();
      expect(inMenu('.nxs-manage-versions__create')).toBeTruthy();

      fixture.destroy();
      document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove());
      await render(live({ contextParameters: { permissions: ['Read', 'Write'] } }));
      await openVersionsList();
      expect(versionItem('0.1')).toBeTruthy();
      expect(inMenu('.nxs-manage-versions__create')).toBeNull();
    });
  });
});
