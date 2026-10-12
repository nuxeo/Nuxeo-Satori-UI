import { Component, input, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { EMPTY, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AppConfigService } from '@nuxeo-satori/platform/app-config';
import { provideSatoriExtensions } from '@nuxeo-satori/platform/extensions';
import {
  BrowseService,
  ClipboardTargetService,
  DirectoryService,
  DocumentDetailService,
  SelectionService,
  TagService,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';

import { BrowseComponent } from './browse';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

// jsdom does not implement it; the Satori breadcrumbs and the Material menu both
// observe their host element on construction.
globalThis.ResizeObserver ??= class implements ResizeObserver {
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

/** A complete `NuxeoDocument`, so a fixture states only the fields its test is about. */
function doc(overrides: Partial<NuxeoDocument> & Pick<NuxeoDocument, 'uid'>): NuxeoDocument {
  return {
    title: 'Document',
    type: 'File',
    path: '/default-domain/workspaces/ws-1/document',
    lastModified: '2026-01-01T00:00:00.000Z',
    properties: {},
    ...overrides,
  };
}

const folder = doc({
  uid: 'ws-1',
  title: 'Workspace',
  type: 'Workspace',
  path: '/default-domain/workspaces/ws-1',
  facets: ['Folderish'],
  contextParameters: { permissions: ['Read', 'Write', 'AddChildren', 'Remove'] },
});

type BrowseReturn<K extends keyof BrowseService> = ReturnType<BrowseService[K]>;
type DetailReturn<K extends keyof DocumentDetailService> = ReturnType<DocumentDetailService[K]>;

const emptyAuditLog = {
  entries: [],
  totalSize: 0,
  currentPageSize: 0,
  currentPageIndex: 0,
  numberOfPages: 0,
};

const browse = {
  getByPath: vi.fn((): BrowseReturn<'getByPath'> => of(folder)),
  getBrowseFolderContents: vi.fn((): BrowseReturn<'getBrowseFolderContents'> =>
    of({ folder, entries: [], totalSize: 0 }),
  ),
  getFolderContext: vi.fn((): BrowseReturn<'getFolderContext'> => of(folder)),
  getChildren: vi.fn((): BrowseReturn<'getChildren'> => EMPTY),
  hasChildCollections: vi.fn((): BrowseReturn<'hasChildCollections'> => of(false)),
  getTrashedChildren: vi.fn((): BrowseReturn<'getTrashedChildren'> => EMPTY),
  restoreDocument: vi.fn((): BrowseReturn<'restoreDocument'> => EMPTY),
  startCsvExport: vi.fn((): BrowseReturn<'startCsvExport'> => EMPTY),
  pollAndDownloadCsv: vi.fn((): BrowseReturn<'pollAndDownloadCsv'> => EMPTY),
};

const detail = {
  getFullDocument: vi.fn((): DetailReturn<'getFullDocument'> => EMPTY),
  getDocumentPermissions: vi.fn((): DetailReturn<'getDocumentPermissions'> => EMPTY),
  fetchThumbnail: vi.fn((): DetailReturn<'fetchThumbnail'> => EMPTY),
  getAuditLog: vi.fn((): DetailReturn<'getAuditLog'> => of(emptyAuditLog)),
  trashDocument: vi.fn((): DetailReturn<'trashDocument'> => EMPTY),
  subscribe: vi.fn((): DetailReturn<'subscribe'> => EMPTY),
  unsubscribe: vi.fn((): DetailReturn<'unsubscribe'> => EMPTY),
};

const manifest = signal<{ extensionLayers: readonly unknown[] }>({ extensionLayers: [] });

/**
 * The document list, asserted against the rendered table.
 *
 * `browse.spec.ts` shallow-renders — it stubs the template to `<div></div>` — so
 * it can assert signal state but cannot tell whether the loading, error, empty
 * and populated branches of `browse.html` actually reach the screen. Those four
 * branches are the whole of what a user sees on this page, so they are asserted
 * here through the DOM, driving the controls rather than calling the methods.
 */

/** A customer's permissions panel, registered under the packaged panel's ID. */
@Component({
  standalone: true,
  selector: 'lib-test-custom-permissions',
  template: '<p class="custom-permissions">CUSTOM PERMISSIONS for {{ documentId() }}</p>',
})
class CustomPermissionsComponent {
  readonly documentId = input('');
  readonly permissionsChanged = input<(() => void) | null>(null);
}

describe('BrowseComponent — rendered document list', () => {
  let fixture: ComponentFixture<BrowseComponent>;
  let createdObjectUrls: string[];
  let revokedObjectUrls: string[];
  let originalCreate: typeof URL.createObjectURL;
  let originalRevoke: typeof URL.revokeObjectURL;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem('browse_column_settings');
    browse.getByPath.mockReturnValue(of(folder));
    browse.getBrowseFolderContents.mockReturnValue(of({ folder, entries: [], totalSize: 0 }));
    browse.getFolderContext.mockReturnValue(of(folder));
    browse.hasChildCollections.mockReturnValue(of(false));
    detail.fetchThumbnail.mockReturnValue(EMPTY);
    detail.getAuditLog.mockReturnValue(of(emptyAuditLog));

    createdObjectUrls = [];
    revokedObjectUrls = [];
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    let counter = 0;
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:mock/${counter++}`;
      createdObjectUrls.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedObjectUrls.push(url);
    });
  });

  afterEach(() => {
    fixture?.destroy();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    localStorage.removeItem('browse_column_settings');
    TestBed.resetTestingModule();
  });

  /**
   * `extraProviders` exists for the one test that needs a tab other than the first: a
   * `MatTabBody` only attaches its content portal once the tab animation reports it centred,
   * so without `provideNoopAnimations()` the Permissions tab has a body element and no
   * content. It is opt-in rather than added here for everyone, to keep the other tests in
   * this file rendering exactly as they did.
   */
  async function render(extraProviders: unknown[] = []): Promise<BrowseComponent> {
    manifest.set({ extensionLayers: [] });
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [BrowseComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: BrowseService, useValue: browse },
        { provide: DocumentDetailService, useValue: detail },
        {
          provide: DirectoryService,
          useValue: {
            getEventTypes: vi.fn(() => of([])),
            getEventCategories: vi.fn(() => of([])),
            getEntries: vi.fn(() => of([])),
            getAllL10nEntries: vi.fn(() => of([])),
          },
        },
        { provide: TagService, useValue: { searchTags: vi.fn(() => of([])) } },
        {
          provide: MatDialog,
          useValue: { open: vi.fn(() => ({ afterClosed: () => of(false) })) },
        },
        { provide: AppConfigService, useValue: { manifest } },
        ...extraProviders,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BrowseComponent);
    await settle();
    return fixture.componentInstance;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector) as HTMLElement | null;
  }

  function rowTitles(): string[] {
    return [...fixture.nativeElement.querySelectorAll('.browse-row .doc-title')].map((el) =>
      (el as HTMLElement).textContent?.trim(),
    ) as string[];
  }

  function headerLabels(): string[] {
    return [...fixture.nativeElement.querySelectorAll('.browse-table thead .th-label')].map((el) =>
      (el as HTMLElement).textContent?.trim(),
    ) as string[];
  }

  it('shows the spinner and no rows while the folder request is still pending', async () => {
    browse.getBrowseFolderContents.mockReturnValue(new Subject<never>());

    const component = await render();

    expect(component.loading()).toBe(true);
    expect(query('.browse-loading nxs-spinner')).not.toBeNull();
    expect(rowTitles()).toEqual([]);
  });

  it('renders one row per child, with the title and the result count', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [
          doc({ uid: 'c-1', title: 'Budget.xlsx' }),
          doc({ uid: 'c-2', title: 'Notes.txt' }),
        ],
        totalSize: 2,
      }),
    );

    const component = await render();

    expect(component.loading()).toBe(false);
    expect(rowTitles()).toEqual(['Budget.xlsx', 'Notes.txt']);
    expect(query('.result-count')?.textContent).toContain('2 results');
    expect(query('.browse-empty')).toBeNull();
  });

  it('renders the empty state for a folder the server reports as having no children', async () => {
    const component = await render();

    expect(component.entries()).toEqual([]);
    expect(query('.browse-empty')?.textContent).toContain('This folder is empty');
    expect(query('.browse-table')).toBeNull();
  });

  it('renders a retryable error and stops loading when the folder request fails', async () => {
    browse.getBrowseFolderContents.mockReturnValue(throwError(() => new Error('network down')));

    const component = await render();

    expect(component.loading()).toBe(false);
    expect(component.error()).toBe('Failed to load folder contents.');
    expect(query('.browse-error p')?.textContent).toContain('Failed to load folder contents.');
    expect(query('.browse-loading')).toBeNull();
  });

  it('reloads the folder and clears the error when Retry is pressed', async () => {
    browse.getBrowseFolderContents.mockReturnValueOnce(throwError(() => new Error('network down')));

    const component = await render();
    expect(query('.browse-error')).not.toBeNull();

    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [doc({ uid: 'c-1', title: 'Recovered.pdf' })], totalSize: 1 }),
    );
    const retry = query('.browse-error button') as HTMLButtonElement;
    retry.click();
    await settle();

    expect(component.error()).toBeNull();
    expect(rowTitles()).toEqual(['Recovered.pdf']);
  });

  it('leaves a permission-denied folder load in the retryable error state, not stuck loading', async () => {
    browse.getBrowseFolderContents.mockReturnValue(throwError(() => ({ status: 403 })));

    const component = await render();

    expect(component.loading()).toBe(false);
    expect(component.error()).toBe('Failed to load folder contents.');
    expect(query('.browse-error button')).not.toBeNull();
  });

  it('follows a single-entry root redirect instead of rendering the bootstrap listing', async () => {
    const onlyDomain = doc({ uid: 'dom-1', title: 'Default domain', type: 'Domain', path: '/dom' });
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder: doc({ uid: 'virtual-root', title: 'Root', type: 'Root', path: '/' }),
        entries: [onlyDomain],
        totalSize: 1,
        redirectTo: '/dom',
      }),
    );

    const component = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    component.loadContent();
    await settle();

    expect(navigate).toHaveBeenCalledWith('/browse/dom', { replaceUrl: true });
    expect(component.entries()).toEqual([]);
    expect(component.loading()).toBe(false);
  });

  it('renders a fetched thumbnail as a blob-backed img and revokes it on destroy', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [doc({ uid: 'c-1', title: 'Photo.png' })], totalSize: 1 }),
    );
    detail.fetchThumbnail.mockReturnValue(of(new Blob(['x'], { type: 'image/png' })));

    const component = await render();

    const img = query('.browse-row img.doc-thumb') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(createdObjectUrls[0]);
    expect(Object.keys(component.thumbnailMap())).toEqual(['c-1']);

    fixture.destroy();
    expect(revokedObjectUrls).toContain(createdObjectUrls[0]);
  });

  it('falls back to the type icon when the thumbnail rendition fails', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [doc({ uid: 'c-1', title: 'Broken.png' })], totalSize: 1 }),
    );
    detail.fetchThumbnail.mockReturnValue(throwError(() => ({ status: 404 })));

    const component = await render();

    expect(component.thumbnailMap()).toEqual({});
    expect(query('.browse-row img.doc-thumb')).toBeNull();
    expect(query('.browse-row mat-icon.doc-icon')).not.toBeNull();
  });

  it('navigates into a folder row and to the document view for a file row', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [
          doc({
            uid: 'sub-1',
            title: 'Sub folder',
            type: 'Folder',
            path: '/default-domain/workspaces/ws-1/sub',
            facets: ['Folderish'],
          }),
          doc({ uid: 'file-1', title: 'Readme.md' }),
        ],
        totalSize: 2,
      }),
    );

    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    const rows = fixture.nativeElement.querySelectorAll('.browse-row') as NodeListOf<HTMLElement>;

    rows[0].click();
    expect(navigate).toHaveBeenCalledWith('/browse/default-domain/workspaces/ws-1/sub');

    rows[1].click();
    expect(navigate).toHaveBeenCalledWith('/doc/file-1');
  });

  it('selects a row from its checkbox without navigating away', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [doc({ uid: 'file-1', title: 'Readme.md' })], totalSize: 1 }),
    );

    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    const checkbox = query('.cell-checkbox input[type="checkbox"]') as HTMLInputElement;
    checkbox.click();
    await settle();

    expect(TestBed.inject(SelectionService).selectedIds()).toEqual(new Set(['file-1']));
    expect(TestBed.inject(SelectionService).selectedItems()[0].name).toBe('Readme.md');
    expect(navigate).not.toHaveBeenCalled();
    expect(query('.browse-row')?.classList.contains('browse-row--selected')).toBe(true);
  });

  it('reorders the rendered rows when a column header is clicked, and reverses on a second click', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [
          doc({ uid: 'c-1', title: 'Zebra' }),
          doc({ uid: 'c-2', title: 'apple' }),
          doc({ uid: 'c-3', title: 'Mango' }),
        ],
        totalSize: 3,
      }),
    );

    const component = await render();
    expect(rowTitles()).toEqual(['Zebra', 'apple', 'Mango']);

    const titleHeader = fixture.nativeElement.querySelectorAll(
      '.browse-table thead .sortable-th',
    )[0] as HTMLElement;

    titleHeader.click();
    await settle();
    expect(component.browseSortDir()).toBe('asc');
    expect(rowTitles()).toEqual(['apple', 'Mango', 'Zebra']);

    titleHeader.click();
    await settle();
    expect(component.browseSortDir()).toBe('desc');
    expect(rowTitles()).toEqual(['Zebra', 'Mango', 'apple']);
  });

  it('filters the rendered rows by title and reports the filtered count', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [
          doc({ uid: 'c-1', title: 'Q1 Report' }),
          doc({ uid: 'c-2', title: 'Q2 Report' }),
          doc({ uid: 'c-3', title: 'Invoice' }),
        ],
        totalSize: 3,
      }),
    );

    const component = await render();
    component.filterText.set('report');
    await settle();

    expect(rowTitles()).toEqual(['Q1 Report', 'Q2 Report']);
    expect(query('.result-count')?.textContent).toContain('2 results');
  });

  /** A checkbox in the open column picker, by its visible label. */
  function pickerCheckbox(label: string): HTMLInputElement {
    const option = [
      ...fixture.nativeElement.querySelectorAll('nxs-column-picker mat-checkbox'),
    ].find((el) => (el as HTMLElement).textContent?.trim() === label) as HTMLElement | undefined;
    const input = option?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (!input) throw new Error(`no picker checkbox labelled ${label}`);
    return input;
  }

  function pickerButton(text: string): HTMLButtonElement {
    const button = [...fixture.nativeElement.querySelectorAll('nxs-column-picker button')].find(
      (el) => (el as HTMLElement).textContent?.trim() === text,
    ) as HTMLButtonElement;
    if (!button) throw new Error(`no picker button reading ${text}`);
    return button;
  }

  it('adds a column to the rendered header when the user switches it on in the picker', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [doc({ uid: 'c-1', title: 'Readme.md' })], totalSize: 1 }),
    );

    await render();
    expect(headerLabels()).toEqual(['Title', 'Modified', 'Last Contributor']);

    (query('.gear-btn') as HTMLButtonElement).click();
    await settle();
    expect(query('nxs-column-picker [role="dialog"]')).not.toBeNull();

    pickerCheckbox('Type').click();
    await settle();
    pickerButton('Done').click();
    await settle();

    expect(query('nxs-column-picker')).toBeNull();
    expect(headerLabels()).toEqual(['Title', 'Type', 'Modified', 'Last Contributor']);
    expect(JSON.parse(localStorage.getItem('browse_column_settings') ?? '[]')).toContain('type');
  });

  it('closes the column picker on Escape without applying the pending change', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [doc({ uid: 'c-1', title: 'Readme.md' })], totalSize: 1 }),
    );

    const component = await render();
    (query('.gear-btn') as HTMLButtonElement).click();
    await settle();
    pickerCheckbox('Type').click();
    await settle();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();

    expect(component.columnPanelOpen()).toBe(false);
    expect(headerLabels()).not.toContain('Type');
    expect(localStorage.getItem('browse_column_settings')).toBeNull();
  });

  it('refuses to switch off the Title column, which every row is keyed on', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [doc({ uid: 'c-1', title: 'Readme.md' })], totalSize: 1 }),
    );

    await render();
    (query('.gear-btn') as HTMLButtonElement).click();
    await settle();

    expect(pickerCheckbox('Title').disabled).toBe(true);
    pickerButton('Done').click();
    await settle();
    expect(headerLabels()).toContain('Title');
  });

  it('publishes the browsed folder as the clipboard paste target', async () => {
    const enriched = doc({ ...folder, uid: 'ws-1', title: 'Workspace (enriched)' });
    browse.getFolderContext.mockReturnValue(of(enriched));

    await render();

    expect(browse.getFolderContext).toHaveBeenCalledWith('/default-domain/workspaces/ws-1');
    expect(TestBed.inject(ClipboardTargetService).target()?.title).toBe('Workspace (enriched)');
  });

  it('falls back to the listed folder as clipboard target when the context fetch fails', async () => {
    browse.getFolderContext.mockReturnValue(throwError(() => ({ status: 403 })));

    await render();

    expect(TestBed.inject(ClipboardTargetService).target()?.uid).toBe('ws-1');
  });

  it('clears the clipboard target when the browsed document is not folderish', async () => {
    const file = doc({ uid: 'file-1', title: 'Readme.md', facets: [] });
    browse.getBrowseFolderContents.mockReturnValue(of({ folder: file, entries: [], totalSize: 0 }));
    TestBed.inject(ClipboardTargetService);

    await render();

    expect(TestBed.inject(ClipboardTargetService).target()).toBeNull();
    expect(browse.getFolderContext).not.toHaveBeenCalled();
  });

  it('clears the clipboard target when the browse page is destroyed', async () => {
    await render();
    expect(TestBed.inject(ClipboardTargetService).target()).not.toBeNull();

    fixture.destroy();

    expect(TestBed.inject(ClipboardTargetService).target()).toBeNull();
  });

  /**
   * Seen red on purpose by reverting `[initials]` to `lastContributor(doc)`:
   * `TypeError: Cannot read properties of undefined (reading 'toUpperCase')`
   * thrown from `SatAvatar._displayedInitials` during change detection, which
   * takes down the whole listing rather than one cell.
   */
  it('renders a row whose document has no last contributor instead of throwing', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [doc({ uid: 'c-1', title: 'Imported.pdf', properties: {} })],
        totalSize: 1,
      }),
    );

    const component = await render();

    expect(component.lastContributor(component.entries()[0])).toBe('');
    expect(rowTitles()).toEqual(['Imported.pdf']);
    expect(query('.cell-lastContributor sat-avatar span')?.textContent?.trim()).toBe('?');
  });

  it('uses the contributor initial when the document does have a last contributor', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [
          doc({ uid: 'c-1', title: 'Report.docx', properties: { 'dc:lastContributor': 'jdoe' } }),
        ],
        totalSize: 1,
      }),
    );

    await render();

    expect(query('.cell-lastContributor sat-avatar span')?.textContent?.trim()).toBe('J');
    expect(query('.cell-lastContributor')?.textContent).toContain('jdoe');
  });

  it('does not load activity for the synthetic repository root', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder: doc({ uid: 'virtual-root', title: 'Root', type: 'Root', path: '/' }),
        entries: [],
        totalSize: 0,
      }),
    );

    await render();

    expect(detail.getAuditLog).not.toHaveBeenCalled();
  });

  // ── Header cells must carry text (NXENG-937) ──

  /**
   * Header cells with no text, keyed by class so a failure names the offender.
   *
   * Asserts **text**, not accessible name, because that is what axe's `empty-table-header`
   * requires: its rule definition is `any: ['has-visible-text']`, with none of the
   * `aria-label` / `aria-labelledby` alternatives that `empty-heading` accepts. An
   * `aria-label` on the `<th>` was the first attempt at NXENG-937 and left the violation
   * standing, so checking the accessible name here would pass on the broken markup.
   */
  function unlabelledHeaders(selector: string): string[] {
    return [...fixture.nativeElement.querySelectorAll(`${selector} thead th`)]
      .filter((th) => !(th as HTMLElement).textContent?.trim())
      .map((th) => (th as HTMLElement).className || '<no class>');
  }

  it('gives every document-list header cell text, including the selection and actions columns', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [
          doc({ uid: 'c-1', title: 'Budget.xlsx' }),
          // A collection entry, so the otherwise-hidden actions header renders too.
          doc({ uid: 'c-2', title: 'Q3 Collection', type: 'Collection' }),
        ],
        totalSize: 2,
      }),
    );

    const component = await render();

    expect(component.hasCollectionEntries()).toBe(true);
    expect(query('.browse-table thead th.col-checkbox')).not.toBeNull();
    expect(query('.browse-table thead th.col-actions')).not.toBeNull();
    expect(unlabelledHeaders('.browse-table')).toEqual([]);
  });

  it('gives every local-permissions header cell text, including the actions column', async () => {
    // `Everything` is what makes the actions column render at all, and one granted local ACE
    // is what makes the table render instead of the empty-state message.
    const withLocalAce = doc({
      uid: 'ws-1',
      title: 'Workspace',
      type: 'Workspace',
      path: '/default-domain/workspaces/ws-1',
      facets: ['Folderish'],
      contextParameters: {
        permissions: ['Everything'],
        acls: [
          {
            name: 'local',
            aces: [
              {
                id: 'l-1',
                username: 'members',
                externalUser: false,
                permission: 'Read',
                granted: true,
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
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder: withLocalAce, entries: [], totalSize: 0 }),
    );
    // Selecting the tab makes the component load permissions; the default `EMPTY` stub never
    // emits, which leaves the tab on its spinner branch and renders no table at all.
    detail.getDocumentPermissions.mockReturnValue(of(withLocalAce));

    const component = await render([provideNoopAnimations()]);
    component.activeTabIndex.set(1);
    await settle();

    // The local table is the library panel's now; its actions column is labelled for screen
    // readers only, which still counts as text.
    const localTable = 'nxs-permissions-panel .nxs-permissions-panel__table';
    expect(component.canManageCurrentPermissions()).toBe(true);
    expect(query(localTable)).not.toBeNull();
    expect(unlabelledHeaders(localTable)).toEqual([]);
  });

  it('renders a permissions panel a customer registered under the panel ID instead', async () => {
    const folder = doc({
      uid: 'ws-1',
      title: 'Workspace',
      type: 'Workspace',
      path: '/default-domain/workspaces/ws-1',
      facets: ['Folderish'],
      contextParameters: { permissions: ['Everything'], acls: [{ name: 'local', aces: [] }] },
    });
    browse.getBrowseFolderContents.mockReturnValue(of({ folder, entries: [], totalSize: 0 }));
    detail.getDocumentPermissions.mockReturnValue(of(folder));

    const component = await render([
      provideNoopAnimations(),
      provideSatoriExtensions({
        components: { 'nxs.components.permissionsPanel': CustomPermissionsComponent },
      }),
    ]);
    component.activeTabIndex.set(1);
    await settle();

    expect(query('nxs-permissions-panel')).toBeNull();
    expect(query('.custom-permissions')?.textContent).toContain('CUSTOM PERMISSIONS for ws-1');

    // The panel's writes can change the external-user shares the host reads itself.
    const custom = fixture.debugElement.query(By.directive(CustomPermissionsComponent))
      .componentInstance as CustomPermissionsComponent;
    const reads = detail.getDocumentPermissions.mock.calls.length;
    custom.permissionsChanged()?.();
    expect(detail.getDocumentPermissions).toHaveBeenCalledTimes(reads + 1);
  });
});
