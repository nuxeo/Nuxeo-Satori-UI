import { Component, input, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  withDisabledInitialNavigation,
} from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';

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
  CURRENT_USERNAME,
  DirectoryService,
  DocumentDetailService,
  NuxeoApiBase,
  TagService,
  TaskService,
  WorkflowService,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';
import {
  AiChatService,
  AiFeatureFlagService,
  AiGatewayService,
} from '@agentic-ui/shared/ai-client';
import { KeClientService, type KeEnrichmentResult } from '@agentic-ui/shared/ke-client';
import { DocumentViewerComponent, MAT_TAB_LIST_KEYDOWN_ATTR } from '@nuxeo-satori/platform/ui';

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
  template: '<p class="claims">CONTRIBUTED CLAIMS PANEL</p>',
})
class ClaimsPanelComponent {}

@Component({
  standalone: true,
  selector: 'lib-test-claim-view',
  template: '<p class="claim-view">CLAIM VIEW {{ document()?.title }} {{ heading() }}</p>',
})
class ClaimViewComponent {
  readonly document = input<NuxeoDocument | null>(null);
  readonly heading = input('');
}

@Component({
  standalone: true,
  selector: 'lib-test-case-view',
  template: '<p class="case-view">CASE VIEW</p>',
})
class CaseViewComponent {}

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
  getVersions: vi.fn((): Observable<unknown[]> => of([])),
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

const manifest = signal<{ extensionLayers: readonly unknown[] }>({ extensionLayers: [] });

describe('DocumentDetailComponent — rendered Layer 1 slots', () => {
  let fixture: ComponentFixture<DocumentDetailComponent>;

  // jsdom has neither, and the viewer path creates a blob URL for every document.
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:mock/1');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();

  async function render(extensions: unknown, focused: NuxeoDocument = doc()): Promise<void> {
    manifest.set({ extensionLayers: [extensions] });
    mockDetailService.getFullDocument.mockReturnValue(of(focused));
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      // `TranslateModule` is bootstrapped by the app, not the feature: the
      // adf-hx components inside the detail template inject `TranslateService`.
      imports: [DocumentDetailComponent, testTranslateModule()],
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
        { provide: KeClientService, useValue: { enrich: emptyKe } },
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
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        {
          provide: MatDialog,
          useValue: { open: vi.fn(() => ({ afterClosed: () => of(undefined) })) },
        },
        { provide: AppConfigService, useValue: { manifest } },
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
   * NXENG-915. The properties sidebar is an `<aside>`, so it carries an implicit
   * `role="complementary"`. A complementary landmark with no accessible name is announced
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
  describe('accessibility', () => {
    it('names the properties sidebar landmark', async () => {
      await render({});

      const panel = fixture.nativeElement.querySelector('aside.properties-panel') as HTMLElement;
      expect(panel).toBeTruthy();
      expect(panel.getAttribute('aria-label')).toBe('Document properties');
    });

    it('sets data-satori-tablist-keydown on the detail tablist (NXENG-821)', async () => {
      await render({});

      const tabList = fixture.nativeElement.querySelector(
        'mat-tab-group.detail-tabs .mat-mdc-tab-list[role="tablist"]',
      ) as HTMLElement | null;

      expect(tabList?.getAttribute(MAT_TAB_LIST_KEYDOWN_ATTR)).toBe('true');
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
      fixture.nativeElement.querySelector('aside.properties-panel lib-document-layout');

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
      expect(button.getAttribute('aria-label')).toBe('Archive');
      expect(button.textContent).toContain('inventory_2');
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
      expect(fixture.nativeElement.querySelector('aside.properties-panel')).toBeTruthy();

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
      [...fixture.nativeElement.querySelectorAll('aside.properties-panel .prop-label')].map(
        (el) => (el as HTMLElement).textContent?.trim() ?? '',
      );

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
