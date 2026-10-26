import {
  Component,
  input,
  provideZonelessChangeDetection,
  signal,
  type Type,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  withDisabledInitialNavigation,
} from '@angular/router';
// testTranslateModule() removed - no longer exported in ngx-translate 18
import { Observable, of } from 'rxjs';
import { vi, type Mock } from 'vitest';
import {
  NxsDeletePermissionDialogComponent,
  NxsShareExternalDialogComponent,
  NxsUpdatePermissionDialogComponent,
} from '@nuxeo/satori-platform/components';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import {
  EXTENSION_SLOTS,
  PACKAGED_DOCUMENT_TABS,
  PACKAGED_DOCUMENT_TOOLBAR_ACTIONS,
  provideSatoriExtensions,
} from '@nuxeo/satori-platform/extensions';
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
  type NuxeoAce,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  AiChatService,
  AiFeatureFlagService,
  AiGatewayService,
} from '@agentic-ui/shared/ai-client';
import { DocumentViewerComponent, MAT_TAB_LIST_KEYDOWN_ATTR } from '@nuxeo/satori-platform/ui';

import { DocumentDetailComponent } from './document-detail';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

/**
 * The `toolbar` and `tabs` slots, asserted **against the rendered template**.
 *
 * The sibling spec files stub the template out — `.overrideComponent(… template:
 * '<div></div>')` — which is right for testing the load chain and useless here.
 * The defect this file exists to prevent is exactly a descriptor that resolves
 * and never reaches a screen, so nothing short of the real template can assert it.
 *
 * Every contribution below arrives through `AppConfigService.manifest()`, which
 * is the only route a customer has. Registering into `ExtensionSlotRegistry`
 * directly would prove that the registry works and nothing about Layer 1.
 */

// jsdom implements neither, and the real template pulls in Satori breadcrumbs and
// the Material tab strip, both of which observe their host on construction.
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

const CONTRIBUTED_TAB_MARKER = 'CONTRIBUTED CLAIMS PANEL';

@Component({
  standalone: true,
  selector: 'lib-test-claims-panel',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '<p class="claims">CONTRIBUTED CLAIMS PANEL</p>',
})
class ClaimsPanelComponent {}

@Component({
  standalone: true,
  selector: 'lib-test-claim-view',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '<p class="claim-view">CLAIM VIEW {{ document()?.title }} {{ heading() }}</p>',
})
class ClaimViewComponent {
  readonly document = input<NuxeoDocument | null>(null);
  readonly heading = input('');
}

@Component({
  standalone: true,
  selector: 'lib-test-case-view',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '<p class="case-view">CASE VIEW</p>',
})
class CaseViewComponent {}

/** A customer's permissions panel, registered under the packaged panel's ID. */
@Component({
  standalone: true,
  selector: 'lib-test-custom-permissions',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '<p>CUSTOM PERMISSIONS for {{ documentId() }}</p>',
})
class CustomPermissionsComponent {
  readonly documentId = input('');
  readonly permissionsChanged = input<(() => void) | null>(null);
}

/** The packaged type rule, so these tests exercise the rule a customer is told to write. */
const IS_TYPE_RULE = 'app.rules.isType';

/** Rejects its first load and succeeds after, like a chunk request that failed once. */
let flakyLoads = 0;

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

/** `/config/types/<type>` as Nuxeo answers it; only Claim carries a schema of its own. */
const nuxeoGet = vi.fn((path: string): Observable<unknown> =>
  of(
    path === '/nuxeo/api/v1/config/types/Claim'
      ? {
          name: 'Claim',
          schemas: [
            { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
            {
              name: 'claim',
              '@prefix': 'claim',
              fields: { number: 'string', billedAmount: 'double' },
            },
          ],
        }
      : { schemas: [{ name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } }] },
  ),
);

const mockDetailService = {
  getFullDocument: vi.fn((): Observable<NuxeoDocument> => of(doc())),
  fetchBlob: vi.fn((): Observable<Blob> => of(new Blob(['x'], { type: 'text/plain' }))),
  fetchBlobByXpath: vi.fn((): Observable<Blob> => of(new Blob(['x']))),
  fetchThumbnail: vi.fn((): Observable<Blob> => of(new Blob(['x'], { type: 'image/png' }))),
  fetchPdfRendition: vi.fn((): Observable<Blob> =>
    of(new Blob(['x'], { type: 'application/pdf' })),
  ),
  getAllComments: vi.fn((): Observable<{ entries: unknown[] }> => of({ entries: [] })),
  getVersions: vi.fn((): Observable<unknown[]> => of([])),
  getVersionsDirect: vi.fn((): Observable<NuxeoDocument[]> => of([])),
  getPublishedVersions: vi.fn((): Observable<unknown[]> => of([])),
  getSectionTree: vi.fn((): Observable<unknown[]> => of([])),
  getRunnableWorkflows: vi.fn((): Observable<unknown[]> => of([])),
  getAuditLog: vi.fn((): Observable<Record<string, unknown>> =>
    of({ entries: [], resultsCount: 0 }),
  ),
  getDocumentPermissions: vi.fn((): Observable<NuxeoDocument> => of(doc())),
  exportXml: vi.fn((): Observable<Blob> => of(new Blob(['<xml/>']))),
  exportZip: vi.fn((): Observable<Blob> => of(new Blob(['zip']))),
};

const mockDirectoryService = {
  getEventTypes: vi.fn((): Observable<unknown[]> => of([])),
  getEventCategories: vi.fn((): Observable<unknown[]> => of([])),
  getEntries: vi.fn((): Observable<unknown[]> => of([])),
  getAllL10nEntries: vi.fn((): Observable<unknown[]> => of([])),
};

const manifest = signal<{
  extensionLayers: readonly unknown[];
  featureToggles?: Readonly<Record<string, boolean>>;
}>({ extensionLayers: [] });
/** `AppConfigService.featureToggle`, over the same manifest the slots read. */
const featureToggle = (id: string, fallback: boolean): boolean =>
  manifest().featureToggles?.[id] ?? fallback;

/** A raw comment document, as `getAllComments` returns them. */
function commentEntry(
  uid: string,
  text: string,
  parentId = 'doc-1',
): { uid: string; properties: Record<string, unknown> } {
  return {
    uid,
    properties: {
      'comment:parentId': parentId,
      'comment:text': text,
      'comment:author': 'alice',
      'comment:creationDate': '2026-08-24T10:00:00.000Z',
    },
  };
}

describe('DocumentDetailComponent — rendered Layer 1 slots', () => {
  let fixture: ComponentFixture<DocumentDetailComponent>;

  // jsdom has neither, and the viewer path creates a blob URL for every document.
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:mock/1');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();

  async function render(
    extensions: unknown,
    focused: NuxeoDocument = doc(),
    components: Readonly<Record<string, Type<unknown>>> = {},
  ): Promise<void> {
    manifest.set({ extensionLayers: [extensions] });
    mockDetailService.getFullDocument.mockReturnValue(of(focused));
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      // `testTranslateModule()` is bootstrapped by the app, not the feature: the
      // detail template's `translate` pipes inject `TranslateService`.
      imports: [DocumentDetailComponent, testTranslateModule()],
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
        { provide: DirectoryService, useValue: mockDirectoryService },
        { provide: TaskService, useValue: { getDocumentTasks: vi.fn(() => of([])) } },
        {
          provide: WorkflowService,
          useValue: { getDocumentWorkflows: vi.fn(() => of([])) },
        },
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
          useValue: { nxqlSearch: vi.fn(() => of({ entries: [] })), get: nuxeoGet },
        },
        { provide: CURRENT_USERNAME, useValue: () => 'tester' },
        {
          provide: MatDialog,
          useValue: { open: vi.fn(() => ({ afterClosed: () => of(undefined) })) },
        },
        { provide: AppConfigService, useValue: { manifest, featureToggle } },
        provideSatoriExtensions({
          slots: {
            [EXTENSION_SLOTS.toolbar]: PACKAGED_DOCUMENT_TOOLBAR_ACTIONS,
            [EXTENSION_SLOTS.tabs]: PACKAGED_DOCUMENT_TABS,
          },
          components: {
            'acme.tabs.claims': ClaimsPanelComponent,
            'acme.views.claim': ClaimViewComponent,
            'acme.views.case': CaseViewComponent,
            'acme.views.broken': () => Promise.reject(new Error('chunk failed to load')),
            'acme.views.flaky': () =>
              ++flakyLoads === 1
                ? Promise.reject(new Error('chunk failed to load'))
                : Promise.resolve(ClaimViewComponent),
            ...components,
          },
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DocumentDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

  function actionIds(): string[] {
    return [...fixture.nativeElement.querySelectorAll('[data-action-id]')].map((el) =>
      (el as HTMLElement).getAttribute('data-action-id'),
    ) as string[];
  }

  function tabLabels(): string[] {
    return [...fixture.nativeElement.querySelectorAll('.mat-mdc-tab .mdc-tab__text-label')].map(
      (el) => (el as HTMLElement).textContent?.trim() ?? '',
    );
  }

  /**
   * NXENG-915. The properties sidebar is a `complementary` landmark (`nxs-details-panel` sets the
   * role an `<aside>` used to imply). A complementary landmark with no accessible name is announced
   * only as "complementary", so a screen-reader user navigating by landmark cannot tell what
   * the region is — WCAG 2.1 1.3.1 Info and Relationships, level A.
   *
   * It belongs in this file for the same reason the slot assertions do: the defect is an
   * attribute that never reaches a screen, and only the real template can catch that. The
   * sibling specs stub the template out.
   *
   * The name is asserted to be the static purpose label rather than the document title. A
   * name bound to `fileName()` would be empty while the document loads, reintroducing the
   * violation intermittently, and a landmark whose name changes per document cannot be
   * navigated to reliably.
   */
  describe('the History tab', () => {
    it('creates nxs-document-history on first show, so the page asks for no audit on load', async () => {
      mockDirectoryService.getEventCategories.mockClear();
      await render({});
      const page = fixture.componentInstance;
      expect(page.activeTabId()).toBe('app.tabs.view');
      expect(fixture.nativeElement.querySelector('nxs-document-history')).toBeNull();
      expect(mockDirectoryService.getEventCategories).not.toHaveBeenCalled();

      page.onTabChange(page.detailTabs().findIndex((tab) => tab.id === 'app.tabs.history'));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('nxs-document-history')).not.toBeNull();
      expect(mockDirectoryService.getEventCategories).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessibility', () => {
    it('names the properties sidebar landmark', async () => {
      await render({});

      const panel = fixture.nativeElement.querySelector(
        'nxs-details-panel.properties-panel',
      ) as HTMLElement;
      expect(panel).toBeTruthy();
      expect(panel.getAttribute('role')).toBe('complementary');
      expect(panel.getAttribute('aria-label')).toBe('Document properties');
    });

    it('sets data-satori-tablist-keydown on the detail tablist (NXENG-821)', async () => {
      await render({});

      const tabList = fixture.nativeElement.querySelector(
        'nxs-tabs.detail-tabs .mat-mdc-tab-list[role="tablist"]',
      ) as HTMLElement | null;

      expect(tabList?.getAttribute(MAT_TAB_LIST_KEYDOWN_ATTR)).toBe('true');
    });
  });

  describe('details panel', () => {
    const viewLabels = (): string[] =>
      [...fixture.nativeElement.querySelectorAll('.properties-panel [role="tab"]')].map(
        (el) => (el as HTMLElement).textContent?.trim() ?? '',
      );

    it('offers Comments only on a document with the Commentable facet, as Web UI does', async () => {
      await render({});
      expect(viewLabels()).toEqual(['Properties', 'Activity']);

      await render({}, doc({ facets: ['Commentable'] }));
      expect(viewLabels()).toEqual(['Properties', 'Comments', 'Activity']);
    });

    describe('comments', () => {
      async function showComments(): Promise<HTMLElement | null> {
        fixture.componentInstance.switchPanelSubTab('comments');
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return fixture.nativeElement.querySelector('.properties-panel nxs-comments');
      }

      it('shows the open document’s thread and keeps it for the sentiment analysis', async () => {
        mockDetailService.getAllComments.mockReturnValueOnce(
          of({
            entries: [
              commentEntry('c1', 'top level'),
              commentEntry('r1', 'a reply', 'c1'),
              commentEntry('r2', 'another reply', 'c1'),
            ],
          }),
        );
        await render({}, doc({ facets: ['Commentable'] }));

        const thread = await showComments();

        expect(mockDetailService.getAllComments).toHaveBeenCalledWith('doc-1');
        expect(thread?.textContent).toContain('top level');
        expect(thread?.textContent).toContain('2 replies');
        expect(fixture.componentInstance.comments().map((c) => c.id)).toEqual(['c1', 'r1', 'r2']);
      });

      it('lets a reader without Write comment, as Web UI does', async () => {
        await render(
          {},
          doc({ facets: ['Commentable'], contextParameters: { permissions: ['Read'] } }),
        );

        const thread = await showComments();

        expect(thread?.querySelector('textarea')).not.toBeNull();
      });

      it('shows a sentiment result under the comment it is about', async () => {
        mockDetailService.getAllComments.mockReturnValueOnce(
          of({ entries: [commentEntry('c1', 'great work')] }),
        );
        await render({}, doc({ facets: ['Commentable'] }));
        fixture.componentInstance.aiSentimentMap.set({
          c1: { id: 'c1', sentiment: 'positive', summary: 'Praise for the work' },
        });

        const thread = await showComments();

        const sentiment = thread?.querySelector('.comment-sentiment');
        expect(sentiment?.textContent).toContain('positive');
        expect(sentiment?.textContent).toContain('Praise for the work');
      });
    });

    describe('tags', () => {
      const editor = (): HTMLElement | null =>
        fixture.nativeElement.querySelector('.properties-panel nxs-tag-editor');
      const tagged = (over: Partial<NuxeoDocument> = {}): NuxeoDocument =>
        doc({ facets: ['NXTag'], properties: { 'nxtag:tags': [{ label: 'q3' }] }, ...over });

      it('offers the tag editor in the panel’s Tags field to a user with Write', async () => {
        await render({}, tagged());

        expect(editor()?.closest('dd')).not.toBeNull();
        expect(editor()?.querySelector('input')).not.toBeNull();
        expect(editor()?.textContent).toContain('q3');
      });

      it('shows the tags read-only to a reader, as Web UI does', async () => {
        await render({}, tagged({ contextParameters: { permissions: ['Read'] } }));

        expect(editor()?.querySelector('input')).toBeNull();
        expect(editor()?.textContent).toContain('q3');
      });

      it('shows the tags read-only on a version and on a proxy, whatever the permissions', async () => {
        await render({}, tagged({ isVersion: true }));
        expect(editor()?.querySelector('input')).toBeNull();

        await render({}, tagged({ isProxy: true }));
        expect(editor()?.querySelector('input')).toBeNull();
      });

      it('shows no Tags field on a document without the NXTag facet', async () => {
        await render({}, doc());
        expect(editor()).toBeNull();
      });
    });

    it('lists the collections the document is in, leaving out Favorites (NXSAT-191)', async () => {
      await render(
        {},
        doc({
          contextParameters: {
            permissions: ['Read'],
            collections: [
              { uid: 'fav-1', title: 'My Favorites', type: 'Favorites' },
              { uid: 'col-1', title: 'Project Alpha', type: 'Collection' },
            ],
          },
        }),
      );

      const panel = fixture.nativeElement.querySelector('.detail-properties') as HTMLElement;
      expect(panel.textContent).toContain('Project Alpha');
      expect(panel.textContent).not.toContain('My Favorites');
    });

    it('shows no Collections heading when Favorites is the only membership', async () => {
      await render(
        {},
        doc({
          contextParameters: {
            permissions: ['Read'],
            collections: [{ uid: 'fav-1', title: 'My Favorites', type: 'Favorites' }],
          },
        }),
      );

      const headings = [
        ...fixture.nativeElement.querySelectorAll('.detail-properties [role="heading"]'),
      ].map((el) => (el as HTMLElement).textContent?.trim());
      expect(headings).not.toContain('Collections');
    });

    it('puts focus back on the toggle when the panel closes', async () => {
      await render({});
      document.body.appendChild(fixture.nativeElement);
      try {
        (
          fixture.nativeElement.querySelector(
            '.properties-panel .nxs-details-panel__close',
          ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();
        await fixture.whenStable();

        expect(fixture.nativeElement.querySelector('.properties-panel')).toBeNull();
        expect(document.activeElement).toBe(
          fixture.nativeElement.querySelector('.panel-toggle-btn'),
        );
      } finally {
        fixture.nativeElement.remove();
      }
    });
  });

  /**
   * NXSAT-311. The properties panel hosts the per-type layout, fed the focused document. With
   * no package layout (the index 404s here) it is generated from the type's own schemas, so a
   * Claim shows its `claim` fields and a File, whose schemas the panel already presents, gets
   * nothing added. Seen red on purpose by removing `<lib-document-layout>` from the template.
   */
  describe('per-type layout', () => {
    async function settle(): Promise<void> {
      TestBed.inject(HttpTestingController)
        .match((request) => request.url.endsWith('/agentic-ui-config/layouts.json'))
        .forEach((request) => request.flush('', { status: 404, statusText: 'Not Found' }));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    const layoutIn = (): HTMLElement | null =>
      fixture.nativeElement.querySelector('nxs-details-panel.properties-panel lib-document-layout');

    it('shows a Claim the fields of its own schema, with its values', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await render(
        {},
        doc({ type: 'Claim', properties: { 'claim:number': 'CLM-1', 'claim:billedAmount': 2480 } }),
      );
      await settle();

      const section = layoutIn()?.querySelector('[data-section-id="claim"]');
      expect(section?.querySelector('.document-layout__heading')?.textContent?.trim()).toBe(
        'Claim',
      );
      expect(
        [...(section?.querySelectorAll('[data-field]') ?? [])].map((row) => [
          row.getAttribute('data-field'),
          row.querySelector('.document-layout__value')?.textContent?.trim(),
        ]),
      ).toEqual([
        ['claim:billedAmount', '2,480'],
        ['claim:number', 'CLM-1'],
      ]);
    });

    it('adds nothing to the panel of a File', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await render({}, doc({ type: 'File' }));
      await settle();

      expect(layoutIn()).toBeTruthy();
      expect(layoutIn()?.querySelector('[data-section-id]')).toBeNull();
    });
  });

  describe('toolbar', () => {
    /**
     * The claim: an action that exists **only** in the manifest is a real button
     * in the document-detail header.
     *
     * Seen red on purpose by reverting the header back to its fixed markup —
     * `@for (action of toolbarActions())` replaced by the four hardcoded
     * `<button mat-icon-button>` elements. The assertion failed with
     * `expected [ 'app.toolbar.edit', … ] to contain 'acme.toolbar.archive'`,
     * and with the ids gone entirely it failed on an empty array. That is the
     * state `toolbar` was in before this change: the registry accepted the
     * entry, and nothing on the page read it.
     */
    it('renders an action contributed only by the manifest', async () => {
      await render({
        slots: {
          toolbar: [
            { id: 'acme.toolbar.archive', label: 'Archive', icon: 'inventory_2', order: 5 },
          ],
        },
      });

      expect(actionIds()).toContain('acme.toolbar.archive');
      const button = fixture.nativeElement.querySelector(
        '[data-action-id="acme.toolbar.archive"]',
      ) as HTMLElement;
      expect(button.getAttribute('aria-label')).toBeNull();
      expect(button.querySelector('.cdk-visually-hidden')?.textContent?.trim()).toBe('Archive');
      const icon = button.querySelector('mat-icon');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.getAttribute('data-mat-icon-name')).toBe('inventory_2');
    });

    /** The shipped default is unchanged: the packaged ids are the ones that render. */
    it('renders the packaged actions when the manifest contributes nothing', async () => {
      await render({});

      expect(actionIds()).toContain('app.toolbar.edit');
      expect(actionIds()).toContain('app.toolbar.delete');
      // The write half is inline; Share lives behind the overflow menu, whose
      // content Material only creates when the menu opens.
      expect(actionIds()).not.toContain('app.toolbar.share');
    });

    /**
     * The negative half, and the one that makes the positive assertion mean
     * something: if the header still held fixed markup, `visible: false` would
     * change nothing and the packaged button would still be there.
     */
    it('removes a packaged action when the manifest hides it', async () => {
      await render({ overrides: { 'app.toolbar.edit': { visible: false } } });

      expect(actionIds()).not.toContain('app.toolbar.edit');
      expect(actionIds()).toContain('app.toolbar.delete');
    });

    /** `order` decides the rendered sequence, not the order of the packaged array. */
    it('honours a manifest order against the packaged entries', async () => {
      await render({ overrides: { 'app.toolbar.delete': { order: 1 } } });

      const inline = actionIds();
      expect(inline.indexOf('app.toolbar.delete')).toBeLessThan(inline.indexOf('app.toolbar.edit'));
    });

    /** NXSAT-535 / IBM 2589851771 — overflow menu trigger matches header toolbar icon styling. */
    it('renders the production More actions overflow trigger in .header-actions', async () => {
      await render({});

      const buttons = Array.from(
        fixture.nativeElement.querySelectorAll(
          '.detail-header .header-actions button.mat-mdc-icon-button',
        ),
      ) as HTMLButtonElement[];
      const button = buttons.find(
        (b) => b.querySelector('mat-icon')?.getAttribute('data-mat-icon-name') === 'more_vert',
      );
      expect(button, 'expected header More actions mat-icon-button').toBeTruthy();
      expect(
        button!.querySelector('.cdk-visually-hidden')?.textContent?.trim(),
        'More actions visually hidden accessible name',
      ).toBeTruthy();
      expect(button!.querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('tabs', () => {
    /**
     * The claim: a tab that exists only in the manifest is in the tab strip, and
     * selecting it renders the registered component through
     * `ExtensionOutletComponent`.
     *
     * Seen red on purpose by restoring the five fixed `<mat-tab>` children in
     * place of `@for (tab of detailTabs())`: the label assertion failed with
     * `expected [ 'View', 'Annotations', 'Permissions', 'History', 'Publishing' ]
     * to contain 'Claims'`.
     */
    it('renders a tab contributed only by the manifest and its registered component', async () => {
      await render({
        slots: {
          tabs: [
            { id: 'acme.tabs.claims', label: 'Claims', order: 15, componentId: 'acme.tabs.claims' },
          ],
        },
      });

      expect(tabLabels()).toContain('Claims');

      const claimsTab = [...fixture.nativeElement.querySelectorAll('.mat-mdc-tab')].find((el) =>
        (el as HTMLElement).textContent?.includes('Claims'),
      ) as HTMLElement;
      claimsTab.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain(CONTRIBUTED_TAB_MARKER);
    });

    it('renders the packaged tabs when the manifest contributes nothing', async () => {
      await render({});

      expect(tabLabels()).toEqual(['View', 'Annotations', 'Permissions', 'History', 'Publishing']);
    });

    /** Hiding and reordering a packaged tab — the half fixed markup cannot do. */
    it('hides and reorders packaged tabs from the manifest', async () => {
      await render({
        overrides: {
          'app.tabs.history': { visible: false },
          'app.tabs.publishing': { order: 5, label: 'Where published' },
        },
      });

      expect(tabLabels()).toEqual(['Where published', 'View', 'Annotations', 'Permissions']);
    });
  });

  describe('documentView', () => {
    const claim = (over: Partial<NuxeoDocument> = {}): NuxeoDocument =>
      doc({ uid: 'claim-1', title: 'Claim CLM-42', type: 'Claim', ...over });

    const forType = (id: string, componentId: string, types: string[], order?: number) => ({
      id,
      componentId,
      order,
      rule: { type: IS_TYPE_RULE, parameters: types },
    });

    function viewBody(): HTMLElement {
      const body = fixture.nativeElement.querySelector('.mat-mdc-tab-body-active') as HTMLElement;
      if (!body) throw new Error('no active tab body');
      return body;
    }

    /** Lets a lazy component loader settle and the fallback it triggers render. */
    async function settleLoad(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('renders the packaged viewer for a File when nothing is contributed', async () => {
      await render({});

      expect(viewBody().querySelector('lib-document-viewer')).toBeTruthy();
      expect(viewBody().querySelector('.document-view-outlet')).toBeNull();
    });

    it('renders the packaged note editor for a Note when nothing is contributed', async () => {
      await render(
        {},
        doc({ type: 'Note', properties: { 'note:note': 'hello', 'note:mime_type': 'text/plain' } }),
      );

      expect(viewBody().querySelector('lib-note-editor')).toBeTruthy();
      expect(viewBody().querySelector('lib-document-viewer')).toBeNull();
    });

    /**
     * The claim: a manifest entry, naming a component a Layer 2 library registered, gives one
     * document type its own View. Seen red on purpose
     * by restoring the packaged branch as the whole of `#viewTabContent`.
     */
    it('renders the contributed component for the type its rule names', async () => {
      await render(
        {
          slots: {
            documentView: [forType('acme.documentView.claim', 'acme.views.claim', ['Claim'])],
          },
        },
        claim(),
      );

      expect(viewBody().textContent).toContain('CLAIM VIEW Claim CLM-42');
      expect(viewBody().querySelector('lib-document-viewer')).toBeNull();
      expect(
        viewBody().querySelector('[data-document-view-id="acme.documentView.claim"]'),
      ).toBeTruthy();
    });

    it('keeps the packaged viewer for a type the rule does not name', async () => {
      await render({
        slots: {
          documentView: [forType('acme.documentView.claim', 'acme.views.claim', ['Claim'])],
        },
      });

      expect(viewBody().querySelector('lib-document-viewer')).toBeTruthy();
      expect(viewBody().textContent).not.toContain('CLAIM VIEW');
    });

    it('renders the lowest-order entry when several match', async () => {
      await render(
        {
          slots: {
            documentView: [
              forType('acme.documentView.claim', 'acme.views.claim', ['Claim'], 20),
              forType('acme.documentView.case', 'acme.views.case', ['Claim'], 10),
            ],
          },
        },
        claim(),
      );

      expect(viewBody().textContent).toContain('CASE VIEW');
      expect(viewBody().textContent).not.toContain('CLAIM VIEW');
    });

    it('honours manifest overrides on a documentView entry', async () => {
      const slots = {
        documentView: [
          forType('acme.documentView.claim', 'acme.views.claim', ['Claim'], 20),
          forType('acme.documentView.case', 'acme.views.case', ['Claim'], 10),
        ],
      };

      await render({ slots, overrides: { 'acme.documentView.case': { visible: false } } }, claim());
      expect(viewBody().textContent).toContain('CLAIM VIEW');

      await render(
        {
          slots,
          overrides: {
            'acme.documentView.case': { rule: 'core.false' },
            'acme.documentView.claim': { rule: 'core.false' },
          },
        },
        claim(),
      );
      expect(viewBody().querySelector('lib-document-viewer')).toBeTruthy();
    });

    it('skips an entry whose component is not registered', async () => {
      await render(
        {
          slots: {
            documentView: [
              forType('acme.documentView.missing', 'acme.views.notShippedYet', ['Claim'], 10),
              forType('acme.documentView.claim', 'acme.views.claim', ['Claim'], 20),
            ],
          },
        },
        claim(),
      );

      expect(viewBody().textContent).toContain('CLAIM VIEW');
    });

    it('falls back to the packaged viewer when no registered component matches', async () => {
      await render(
        {
          slots: {
            documentView: [
              forType('acme.documentView.missing', 'acme.views.notShippedYet', ['Claim']),
            ],
          },
        },
        claim(),
      );

      expect(viewBody().querySelector('lib-document-viewer')).toBeTruthy();
    });

    it('falls back to the packaged viewer when the component fails to load', async () => {
      await render(
        {
          slots: {
            documentView: [forType('acme.documentView.broken', 'acme.views.broken', ['Claim'])],
          },
        },
        claim(),
      );
      await settleLoad();

      expect(viewBody().querySelector('lib-document-viewer')).toBeTruthy();
      expect(
        viewBody()
          .querySelector('.document-view-outlet')
          ?.classList.contains('document-view-outlet--unresolved'),
      ).toBe(true);
    });

    it('recovers the contributed view on a refetch after its loader failed once', async () => {
      flakyLoads = 0;
      await render(
        {
          slots: {
            documentView: [forType('acme.documentView.flaky', 'acme.views.flaky', ['Claim'])],
          },
        },
        claim(),
      );
      await settleLoad();
      expect(viewBody().querySelector('lib-document-viewer')).toBeTruthy();

      fixture.componentInstance.doc.set(claim({ title: 'Claim CLM-42 refetched' }));
      await settleLoad();

      expect(flakyLoads).toBe(2);
      expect(viewBody().textContent).toContain('CLAIM VIEW Claim CLM-42 refetched');
      expect(viewBody().querySelector('lib-document-viewer')).toBeNull();
      expect(
        viewBody()
          .querySelector('.document-view-outlet')
          ?.classList.contains('document-view-outlet--unresolved'),
      ).toBe(false);
    });

    it('passes the focused document and static inputs, and keeps the document the host’s', async () => {
      await render(
        {
          slots: {
            documentView: [
              {
                ...forType('acme.documentView.claim', 'acme.views.claim', ['Claim']),
                inputs: { heading: 'Claim summary', document: { title: 'Forged by the manifest' } },
              },
            ],
          },
        },
        claim(),
      );

      expect(viewBody().textContent).toContain('CLAIM VIEW Claim CLM-42 Claim summary');
      expect(viewBody().textContent).not.toContain('Forged by the manifest');
    });

    it('changes only the View tab body', async () => {
      await render(
        {
          slots: {
            documentView: [forType('acme.documentView.claim', 'acme.views.claim', ['Claim'])],
          },
        },
        claim(),
      );

      expect(viewBody().textContent).toContain('CLAIM VIEW');
      expect(tabLabels()).toEqual(['View', 'Annotations', 'Permissions', 'History', 'Publishing']);
      expect(actionIds()).toContain('app.toolbar.edit');
      expect(
        fixture.nativeElement.querySelector('nxs-details-panel.properties-panel'),
      ).toBeTruthy();

      const annotations = [...fixture.nativeElement.querySelectorAll('.mat-mdc-tab')].find((el) =>
        (el as HTMLElement).textContent?.includes('Annotations'),
      ) as HTMLElement;
      annotations.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(viewBody().querySelector('lib-document-viewer')).toBeTruthy();
      expect(viewBody().textContent).not.toContain('CLAIM VIEW');
    });
  });

  describe('permissions tab', () => {
    const withWriteVersion = () =>
      doc({
        contextParameters: {
          permissions: ['Everything'],
          acls: [
            {
              name: 'local',
              aces: [
                {
                  id: 'jdoe:WriteVersion:true:Administrator::',
                  username: 'jdoe',
                  permission: 'WriteVersion',
                  granted: true,
                  externalUser: false,
                  creator: 'Administrator',
                  begin: null,
                  end: null,
                  status: 'effective',
                },
              ],
            },
          ],
        },
      });

    async function openPermissions(): Promise<HTMLElement> {
      const tab = [...fixture.nativeElement.querySelectorAll('.mat-mdc-tab')].find((el) =>
        (el as HTMLElement).textContent?.includes('Permissions'),
      ) as HTMLElement;
      tab.click();
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        fixture.detectChanges();
        await fixture.whenStable();
      }
      const body = fixture.nativeElement.querySelector('.mat-mdc-tab-body-active') as HTMLElement;
      if (!body) throw new Error('no active tab body');
      return body;
    }

    it('renders the library panel, with every permission the ACL holds', async () => {
      mockDetailService.getDocumentPermissions.mockReturnValue(of(withWriteVersion()));
      await render({});

      const body = await openPermissions();

      const panel = body.querySelector('nxs-permissions-panel');
      expect(panel).toBeTruthy();
      expect(panel?.textContent).toContain('Write versions');
      expect(panel?.textContent).toContain('WriteVersion');
      // The external-user section stays the host's.
      expect(body.textContent).toContain('Permissions Assigned to External Users');
    });

    it('renders a component a customer registered under the panel ID instead', async () => {
      mockDetailService.getDocumentPermissions.mockReturnValue(of(withWriteVersion()));
      await render({}, doc(), { 'nxs.components.permissionsPanel': CustomPermissionsComponent });

      const body = await openPermissions();

      expect(body.querySelector('nxs-permissions-panel')).toBeNull();
      expect(body.textContent).toContain('CUSTOM PERMISSIONS for doc-1');
    });

    it('hands the panel a callback that re-reads the external-user shares after a write', async () => {
      mockDetailService.getDocumentPermissions.mockReturnValue(of(withWriteVersion()));
      await render({}, doc(), { 'nxs.components.permissionsPanel': CustomPermissionsComponent });
      await openPermissions();
      const custom = fixture.debugElement.query(By.directive(CustomPermissionsComponent))
        .componentInstance as CustomPermissionsComponent;
      const reads = mockDetailService.getDocumentPermissions.mock.calls.length;

      custom.permissionsChanged()?.();

      expect(mockDetailService.getDocumentPermissions).toHaveBeenCalledTimes(reads + 1);
    });

    describe('external-user shares', () => {
      const share = (email: string, status: NuxeoAce['status'], granted = true): NuxeoAce => ({
        id: `transient/${email}:Read:${granted}:Administrator::1924905600000`,
        username: `transient/${email}`,
        permission: 'Read',
        granted,
        externalUser: true,
        creator: 'Administrator',
        begin: null,
        end: '2030-12-31T00:00:00.000Z',
        status,
      });
      const shared = (canManage = true) =>
        doc({
          contextParameters: {
            permissions: canManage ? ['Everything'] : ['Read'],
            userVisiblePermissions: ['Read', 'ReadWrite'],
            acls: [
              {
                name: 'local',
                aces: [
                  share('effective@example.com', 'effective'),
                  share('pending@example.com', 'pending'),
                  share('archived@example.com', 'archived'),
                  share('denied@example.com', 'effective', false),
                ],
              },
              { name: 'inherited', aces: [share('parent@example.com', 'effective')] },
            ],
          },
        });
      const rows = (body: HTMLElement): string[] =>
        [...body.querySelectorAll('.perm-table tbody tr')].map(
          (row) => (row as HTMLElement).querySelector('td')?.textContent?.trim() ?? '',
        );
      /** The detail screen's own `MatDialog`: its standalone imports shadow the root mock. */
      const spyDialog = (closedWith?: boolean): Mock =>
        vi
          .spyOn(fixture.debugElement.injector.get(MatDialog), 'open')
          .mockReturnValue({ afterClosed: () => of(closedWith) } as never) as unknown as Mock;

      it('lists only the document’s own pending and effective shares, as Web UI does', async () => {
        mockDetailService.getDocumentPermissions.mockReturnValue(of(shared()));
        await render({});

        const body = await openPermissions();

        expect(rows(body)).toEqual(['effective@example.com', 'pending@example.com']);
      });

      it('hides the card when a package turns permissions.externalUsers off', async () => {
        mockDetailService.getDocumentPermissions.mockReturnValue(of(shared()));
        await render({});
        manifest.update((m) => ({ ...m, featureToggles: { 'permissions.externalUsers': false } }));

        const body = await openPermissions();

        expect(body.textContent).not.toContain('Permissions Assigned to External Users');
        expect(body.querySelector('nxs-permissions-panel')).toBeTruthy();
      });

      it('offers a user without WriteSecurity no way to change a share', async () => {
        mockDetailService.getDocumentPermissions.mockReturnValue(of(shared(false)));
        await render({});

        const body = await openPermissions();

        expect(rows(body)).toHaveLength(2);
        expect(body.querySelector('.perm-row-actions')).toBeNull();
        expect(body.querySelector('.perm-action-btn')).toBeNull();
      });

      it('opens the share dialog with the rights the document offers', async () => {
        mockDetailService.getDocumentPermissions.mockReturnValue(of(shared()));
        await render({}, shared());
        const body = await openPermissions();
        const open = spyDialog();

        (body.querySelector('.perm-action-btn') as HTMLButtonElement).click();

        expect(open).toHaveBeenCalledWith(NxsShareExternalDialogComponent, {
          maxWidth: '95vw',
          data: { documentUid: 'doc-1', permissions: ['Read', 'ReadWrite'] },
        });
      });

      it('deletes the one entry, naming the ACL it is on, behind an alert dialog', async () => {
        mockDetailService.getDocumentPermissions.mockReturnValue(of(shared()));
        await render({});
        const body = await openPermissions();
        const open = spyDialog();

        const remove = body.querySelector(
          '.perm-row-actions button:last-child',
        ) as HTMLButtonElement;
        remove.click();

        const [component, config] = open.mock.calls[0];
        expect(component).toBe(NxsDeletePermissionDialogComponent);
        expect(config.role).toBe('alertdialog');
        expect(config.data.acl).toBe('local');
        expect(config.data.ace.id).toBe(
          'transient/effective@example.com:Read:true:Administrator::1924905600000',
        );
      });

      it('re-reads the shares once an update is saved, leaving the toast to the dialog', async () => {
        mockDetailService.getDocumentPermissions.mockReturnValue(of(shared()));
        await render({}, shared());
        const body = await openPermissions();
        const open = spyDialog(true);
        const reads = mockDetailService.getDocumentPermissions.mock.calls.length;

        (body.querySelector('.perm-row-actions button') as HTMLButtonElement).click();

        const [component, config] = open.mock.calls[0];
        expect(component).toBe(NxsUpdatePermissionDialogComponent);
        expect(config.data.permissions).toEqual(['Read', 'ReadWrite']);
        expect(mockDetailService.getDocumentPermissions).toHaveBeenCalledTimes(reads + 1);
      });
    });
  });

  /**
   * Which packaged piece each document type gets, pinned against the rendered template before
   * the type checks moved out of `document-detail.ts`, and run unchanged after. A Note opens on
   * the note editor; every other type, Picture and Video included, opens on the document viewer,
   * which picks its presentation from the loaded content rather than from the type.
   */
  describe('packaged view per document type', () => {
    function viewBody(): HTMLElement {
      const body = fixture.nativeElement.querySelector('.mat-mdc-tab-body-active') as HTMLElement;
      if (!body) throw new Error('no active tab body');
      return body;
    }

    async function openTab(label: string): Promise<void> {
      const tab = [...fixture.nativeElement.querySelectorAll('.mat-mdc-tab')].find((el) =>
        (el as HTMLElement).textContent?.includes(label),
      ) as HTMLElement;
      tab.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    async function settleLoad(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    const note = (): NuxeoDocument =>
      doc({ type: 'Note', properties: { 'note:note': 'hello', 'note:mime_type': 'text/plain' } });

    const propLabels = (): string[] =>
      [
        ...fixture.nativeElement.querySelectorAll(
          'nxs-details-panel.properties-panel .nxs-properties-panel__label',
        ),
      ].map((el) => (el as HTMLElement).textContent?.trim() ?? '');

    /** The document viewer in the selected tab only, so the View tab's viewer cannot answer. */
    const viewerControls = (): boolean | undefined =>
      (
        fixture.debugElement
          .query(By.css('.mat-mdc-tab-body-active'))
          ?.query(By.directive(DocumentViewerComponent))?.componentInstance as
          DocumentViewerComponent | undefined
      )?.showMainFileControls();

    const file = (name: string, mimeType: string) => ({
      'file:content': { name, 'mime-type': mimeType, length: 1 },
    });

    it.each<['lib-note-editor' | 'lib-document-viewer', string, Record<string, unknown>]>([
      ['lib-note-editor', 'Note', { 'note:note': 'hello', 'note:mime_type': 'text/plain' }],
      ['lib-document-viewer', 'File', file('a.pdf', 'application/pdf')],
      ['lib-document-viewer', 'Picture', file('a.png', 'image/png')],
      ['lib-document-viewer', 'Video', file('v.mp4', 'video/mp4')],
      ['lib-document-viewer', 'Audio', file('a.mp3', 'audio/mpeg')],
      ['lib-document-viewer', 'Claim', {}],
    ])('renders %s for a %s', async (expected, type, properties) => {
      await render({}, doc({ type, properties }));

      const other = expected === 'lib-note-editor' ? 'lib-document-viewer' : 'lib-note-editor';
      expect(viewBody().querySelector(expected)).toBeTruthy();
      expect(viewBody().querySelector(other)).toBeNull();
      expect(viewBody().querySelector('.document-view-outlet')).toBeNull();
    });

    it('shows the note format row for a Note only', async () => {
      await render({}, note());
      expect(propLabels()).toContain('Format');

      await render({}, doc({ type: 'File' }));
      expect(propLabels()).not.toContain('Format');
    });

    it('shows the file name only for a document with a stored main file (NXSAT-190)', async () => {
      await render({}, note());
      expect(propLabels()).not.toContain('File name');

      await render({}, doc({ properties: file('a.pdf', 'application/pdf') }));
      expect(propLabels()).toContain('File name');
    });

    it('offers the main-file controls on a File but not on a Note in the Annotations tab', async () => {
      await render({}, doc({ type: 'File' }));
      await openTab('Annotations');
      expect(viewerControls()).toBe(true);

      await render({}, note());
      await openTab('Annotations');
      expect(viewerControls()).toBe(false);
    });

    it('labels the pencil "Edit properties" on a Note and "Edit" elsewhere', async () => {
      await render({}, note());
      expect(actionIds()).toContain('app.toolbar.editProperties');
      expect(actionIds()).not.toContain('app.toolbar.edit');

      await render({}, doc({ type: 'File' }));
      expect(actionIds()).toContain('app.toolbar.edit');
      expect(actionIds()).not.toContain('app.toolbar.editProperties');
    });

    it.each<[string, unknown]>([
      ['app.rules.isType', { type: 'app.rules.isType', parameters: ['Note'] }],
      ['app.rules.isNote', 'app.rules.isNote'],
    ])('lets a contributed view gated by %s replace the Note editor', async (_label, rule) => {
      await render(
        {
          slots: {
            documentView: [
              { id: 'acme.documentView.notes', componentId: 'acme.views.claim', rule },
            ],
          },
        },
        note(),
      );

      expect(viewBody().textContent).toContain('CLAIM VIEW');
      expect(viewBody().querySelector('lib-note-editor')).toBeNull();
      expect(viewBody().querySelector('lib-document-viewer')).toBeNull();
    });

    /** The fallback is the packaged view for the type, not the generic viewer. */
    it('falls back to the Note editor when a contributed Note view fails to load', async () => {
      await render(
        {
          slots: {
            documentView: [
              {
                id: 'acme.documentView.notes',
                componentId: 'acme.views.broken',
                rule: { type: IS_TYPE_RULE, parameters: ['Note'] },
              },
            ],
          },
        },
        note(),
      );
      await settleLoad();

      expect(viewBody().querySelector('lib-note-editor')).toBeTruthy();
      expect(viewBody().querySelector('lib-document-viewer')).toBeNull();
    });
  });
});
