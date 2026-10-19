import { Component, input, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ROUTES, Router, provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { EMPTY, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { provideSatoriExtensions } from '@nuxeo/satori-platform/extensions';
import { provideNxsComponents } from '@nuxeo/satori-platform/components';
import {
  BrowseService,
  ClipboardTargetService,
  DirectoryService,
  DocumentDetailService,
  SelectionService,
  TagService,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

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
  getBrowseFolderContents: vi.fn(
    (
      ..._args: Parameters<BrowseService['getBrowseFolderContents']>
    ): BrowseReturn<'getBrowseFolderContents'> => of({ folder, entries: [], totalSize: 0 }),
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

const tag = {
  suggestTags: vi.fn(() => of(['legal'])),
  addTag: vi.fn(() => of(['legal'])),
  removeTag: vi.fn(() => of([] as string[])),
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
    tag.suggestTags.mockReturnValue(of(['legal']));
    tag.addTag.mockReturnValue(of(['legal']));
    tag.removeTag.mockReturnValue(of([]));
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
        { provide: TagService, useValue: tag },
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

  /** The list's tag and avatar outlets learn from a promise that their IDs are unregistered here. */
  async function settleOutlets(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    await settle();
  }

  it('uses the shared tag editor to suggest and save tags in the Browse panel', async () => {
    const component = await render([provideNoopAnimations()]);
    component.panelOpen.set(true);
    component.panelSubTab.set('tags');
    await settle();
    const box = query('nxs-tag-editor input') as HTMLInputElement;
    expect(box).not.toBeNull();
    box.focus();
    box.value = 'leg';
    box.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settle();
    expect(tag.suggestTags).toHaveBeenCalledWith('leg');
    const option = [
      ...document.querySelectorAll<HTMLElement>('.mat-mdc-autocomplete-panel mat-option'),
    ].find((entry) => entry.textContent?.trim() === 'legal');
    expect(option).not.toBeUndefined();
    option?.click();
    await settle();
    expect(tag.addTag).toHaveBeenCalledWith('ws-1', 'legal');
    expect(component.tags()).toEqual(['legal']);
    const remove = query('nxs-tag-editor button[aria-label="Remove tag legal"]');
    expect(remove).not.toBeNull();
    remove?.click();
    await settle();
    expect(tag.removeTag).toHaveBeenCalledWith('ws-1', 'legal');
    expect(component.tags()).toEqual([]);
  });

  it('keeps existing tags after a failed write and permits another attempt', async () => {
    const component = await render([provideNoopAnimations()]);
    component.currentDoc.set({ ...folder, properties: { 'nxtag:tags': ['retained'] } });
    component.panelOpen.set(true);
    component.panelSubTab.set('tags');
    await settle();
    tag.addTag.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    const box = query('nxs-tag-editor input') as HTMLInputElement;
    const choose = async (): Promise<void> => {
      box.focus();
      box.value = 'leg';
      box.dispatchEvent(new Event('input'));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await settle();
      const option = [
        ...document.querySelectorAll<HTMLElement>('.mat-mdc-autocomplete-panel mat-option'),
      ].find((entry) => entry.textContent?.trim() === 'legal');
      expect(option).not.toBeUndefined();
      option?.click();
      await settle();
    };
    await choose();
    expect(component.tags()).toEqual(['retained']);
    tag.addTag.mockReturnValue(of(['retained', 'legal']));
    await choose();
    expect(tag.addTag).toHaveBeenCalledTimes(2);
    expect(component.tags()).toEqual(['retained', 'legal']);
  });

  it('renders tags without editing controls when the browsed document is read-only', async () => {
    const component = await render();
    component.currentDoc.set({
      ...folder,
      properties: { 'nxtag:tags': ['legal'] },
      contextParameters: { permissions: ['Read'] },
    });
    component.panelOpen.set(true);
    component.panelSubTab.set('tags');
    await settle();
    expect(query('nxs-tag-editor')?.textContent).toContain('legal');
    expect(query('nxs-tag-editor input')).toBeNull();
    expect(query('nxs-tag-editor button')).toBeNull();
    expect(tag.suggestTags).not.toHaveBeenCalled();
  });

  function query(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector) as HTMLElement | null;
  }

  const ROW = 'nxs-document-list tr.nxs-document-list__row';

  function rowTitles(): string[] {
    return [...fixture.nativeElement.querySelectorAll(`${ROW} .nxs-document-list__open`)].map(
      (el) => (el as HTMLElement).textContent?.trim(),
    ) as string[];
  }

  /** The column headers, without the selection and actions columns, which have no label of their own. */
  function headerLabels(): string[] {
    return [
      ...fixture.nativeElement.querySelectorAll(
        'nxs-document-list thead th:not(.nxs-document-list__select):not(.nxs-document-list__actions)',
      ),
    ].map((el) => (el as HTMLElement).textContent?.trim()) as string[];
  }

  function sortControl(label: string): HTMLElement {
    const header = [...fixture.nativeElement.querySelectorAll('nxs-document-list thead th')].find(
      (el) => (el as HTMLElement).textContent?.trim() === label,
    ) as HTMLElement | undefined;
    const control = header?.querySelector('.mat-sort-header-container') as HTMLElement | null;
    if (!control) throw new Error(`no sort control on ${label}`);
    return control;
  }

  function lastRequest(): { path: string; page: { currentPageIndex?: number; sort?: unknown } } {
    const [path, , page = {}] = browse.getBrowseFolderContents.mock.calls.at(-1) ?? [''];
    return { path, page };
  }

  it('shows the spinner and no rows while the folder request is still pending', async () => {
    browse.getBrowseFolderContents.mockReturnValue(new Subject<never>());

    const component = await render();

    expect(component.loading()).toBe(true);
    expect(query('nxs-document-list nxs-spinner')).not.toBeNull();
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
    expect(query('nxs-document-list nxs-empty-state')).toBeNull();
    expect(query('nxs-document-list table')?.getAttribute('aria-label')).toBe(
      'Contents of Workspace',
    );
  });

  it('shows no count for a folder Nuxeo did not count, rather than calling a page the total', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [doc({ uid: 'c-1', title: 'Budget.xlsx' })],
        totalSize: -2,
        hasNextPage: true,
      }),
    );

    await render();

    expect(rowTitles()).toEqual(['Budget.xlsx']);
    expect(query('.result-count')).toBeNull();
  });

  it('asks the server for the first page of the folder, in its own order', async () => {
    await render();

    expect(lastRequest()).toEqual({
      path: '/',
      page: { currentPageIndex: 0, sort: [] },
    });
  });

  it('pages on the server: Next asks for page two, Previous for page one', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [doc({ uid: 'c-1', title: 'First page' })],
        totalSize: -2,
        hasNextPage: true,
      }),
    );
    const component = await render();

    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [doc({ uid: 'c-51', title: 'Second page' })],
        totalSize: -2,
        hasNextPage: false,
      }),
    );
    (query('nxs-document-list .nxs-pager__next') as HTMLButtonElement).click();
    await settle();

    expect(lastRequest().page.currentPageIndex).toBe(1);
    expect(component.pageIndex()).toBe(1);
    expect(rowTitles()).toEqual(['Second page']);
    expect(query('nxs-document-list .nxs-pager__range')?.textContent?.trim()).toBe('51–51');

    (query('nxs-document-list .nxs-pager__previous') as HTMLButtonElement).click();
    await settle();
    expect(lastRequest().page.currentPageIndex).toBe(0);
  });

  it('renders the breadcrumbs by their registered ID, falling back to the built-in trail', async () => {
    await render();
    await settleOutlets();

    const trail = query('nxs-breadcrumbs nav');
    expect(trail?.getAttribute('aria-label')).toBe('Breadcrumbs');
    expect([...(trail?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))).toEqual([
      '/browse',
      '/browse/default-domain',
      '/browse/default-domain/workspaces',
    ]);
    expect(trail?.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('Workspace');
  });

  it('renders whatever is registered under the breadcrumbs ID instead', async () => {
    await render([provideNxsComponents()]);

    expect(query('lib-extension-outlet nxs-breadcrumbs nav')?.getAttribute('aria-label')).toBe(
      'Breadcrumbs',
    );
  });

  it('renders the empty state for a folder the server reports as having no children', async () => {
    const component = await render();

    expect(component.entries()).toEqual([]);
    expect(query('nxs-document-list nxs-empty-state')?.textContent).toContain(
      'This folder is empty',
    );
    expect(query('nxs-document-list table')).toBeNull();
  });

  it('renders a retryable error and stops loading when the folder request fails', async () => {
    browse.getBrowseFolderContents.mockReturnValue(throwError(() => new Error('network down')));

    const component = await render();

    expect(component.loading()).toBe(false);
    expect(component.error()).toBe('Failed to load folder contents.');
    expect(query('nxs-error-state')?.getAttribute('data-status')).toBe('500');
    expect(query('nxs-error-state .nxs-error-state__heading')?.textContent).toContain(
      'Failed to load folder contents.',
    );
    expect(query('nxs-error-state button')?.textContent).toContain('Retry');
    expect(query('nxs-document-list nxs-spinner')).toBeNull();
  });

  it('reloads the folder and clears the error when Retry is pressed', async () => {
    browse.getBrowseFolderContents.mockReturnValueOnce(throwError(() => new Error('network down')));

    const component = await render();
    expect(query('nxs-error-state')).not.toBeNull();

    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [doc({ uid: 'c-1', title: 'Recovered.pdf' })], totalSize: 1 }),
    );
    const retry = query('nxs-error-state button') as HTMLButtonElement;
    retry.click();
    await settle();

    expect(component.error()).toBeNull();
    expect(query('nxs-error-state')).toBeNull();
    expect(rowTitles()).toEqual(['Recovered.pdf']);
  });

  it('says a forbidden folder is forbidden, without a Retry that would get the same answer', async () => {
    browse.getBrowseFolderContents.mockReturnValue(throwError(() => ({ status: 403 })));

    const component = await render();

    expect(component.loading()).toBe(false);
    expect(component.errorStatus()).toBe(403);
    expect(query('nxs-error-state')?.getAttribute('data-status')).toBe('403');
    expect(query('nxs-error-state .nxs-error-state__message')?.textContent).toContain(
      'You do not have permission to see this.',
    );
    // A refusal is not a breakage: the host's "Failed to load" heading is for a server error.
    expect(query('nxs-error-state .nxs-error-state__heading')?.textContent?.trim()).toBe(
      'You do not have access',
    );
    expect(query('nxs-error-state button')).toBeNull();
  });

  describe('a folder that cannot be opened, after one that could', () => {
    /** Lets the test navigate: the suite's router has no routes of its own. */
    const anyUrl = { provide: ROUTES, multi: true, useValue: [{ path: '**', children: [] }] };

    function trail(): { links: (string | null)[]; current: string | undefined } {
      const nav = query('nxs-breadcrumbs nav');
      return {
        links: [...(nav?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href')),
        current: nav?.querySelector('[aria-current="page"]')?.textContent?.trim(),
      };
    }

    it('keeps nothing of the folder before: not its title, count, actions or place in the trail', async () => {
      browse.getBrowseFolderContents.mockReturnValue(
        of({ folder, entries: [doc({ uid: 'c-1', title: 'Report.pdf' })], totalSize: 1 }),
      );
      const component = await render([anyUrl]);
      await settleOutlets();
      expect(query('nxs-folder-header .nxs-folder-header__heading')?.textContent?.trim()).toBe(
        'Workspace',
      );
      expect(component.canCreateContentHere()).toBe(true);

      browse.getBrowseFolderContents.mockReturnValue(throwError(() => ({ status: 403 })));
      await TestBed.inject(Router).navigateByUrl(
        '/browse/default-domain/workspaces/Secret%20files',
      );
      await settleOutlets();

      expect(lastRequest().path).toBe('/default-domain/workspaces/Secret files');
      expect(query('nxs-error-state')?.getAttribute('data-status')).toBe('403');
      expect(component.currentDoc()).toBeNull();
      expect(query('nxs-folder-header .nxs-folder-header__heading')).toBeNull();
      expect(component.canCreateContentHere()).toBe(false);
      expect(query('.result-count')).toBeNull();
      expect(rowTitles()).toEqual([]);
      expect(trail()).toEqual({
        links: ['/browse', '/browse/default-domain', '/browse/default-domain/workspaces'],
        current: 'Secret files',
      });
    });

    it('keeps the folder when only another page of it fails', async () => {
      browse.getBrowseFolderContents.mockReturnValue(
        of({
          folder,
          entries: [doc({ uid: 'c-1', title: 'First page' })],
          totalSize: -2,
          hasNextPage: true,
        }),
      );
      const component = await render();
      browse.getBrowseFolderContents.mockReturnValue(throwError(() => ({ status: 500 })));
      (query('nxs-document-list .nxs-pager__next') as HTMLButtonElement).click();
      await settleOutlets();

      expect(lastRequest().page.currentPageIndex).toBe(1);
      expect(query('nxs-error-state')?.getAttribute('data-status')).toBe('500');
      expect(component.currentDoc()).toBe(folder);
      expect(trail().current).toBe('Workspace');
    });
  });

  it('says a folder that no longer exists was not found', async () => {
    browse.getBrowseFolderContents.mockReturnValue(throwError(() => ({ status: 404 })));

    await render();

    expect(query('nxs-error-state')?.getAttribute('data-status')).toBe('404');
    expect(query('nxs-error-state .nxs-error-state__message')?.textContent).toContain(
      'It may have been moved or deleted',
    );
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

    await render();
    await settle();

    // The row's nxs-thumbnail owns the URL: it fetched the rendition, minted the URL and draws it.
    const img = query(`${ROW} nxs-thumbnail img`) as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(createdObjectUrls[0]);
    expect(createdObjectUrls).toHaveLength(1);

    fixture.destroy();
    expect(revokedObjectUrls).toContain(createdObjectUrls[0]);
  });

  it('falls back to the type icon when the thumbnail rendition fails', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [doc({ uid: 'c-1', title: 'Broken.png' })], totalSize: 1 }),
    );
    detail.fetchThumbnail.mockReturnValue(throwError(() => ({ status: 404 })));

    await render();
    await settle();

    expect(createdObjectUrls).toEqual([]);
    expect(query(`${ROW} nxs-thumbnail img`)).toBeNull();
    expect(query(`${ROW} nxs-thumbnail mat-icon.nxs-document-list__icon`)).not.toBeNull();
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
    const rows = fixture.nativeElement.querySelectorAll(ROW) as NodeListOf<HTMLElement>;

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
    const checkbox = query(`${ROW} input[type="checkbox"]`) as HTMLInputElement;
    checkbox.click();
    await settle();

    expect(TestBed.inject(SelectionService).selectedIds()).toEqual(new Set(['file-1']));
    expect(TestBed.inject(SelectionService).selectedItems()[0].name).toBe('Readme.md');
    expect(navigate).not.toHaveBeenCalled();
    expect(query(ROW)?.classList.contains('nxs-document-list__row--selected')).toBe(true);
  });

  it('asks the server for a column’s order and keeps the rows in the order it answers', async () => {
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

    component.goToPage(1);
    await settle();
    sortControl('Title').click();
    await settle();
    // A new order is a new set of pages, so it starts again from the first.
    expect(lastRequest().page).toEqual({
      currentPageIndex: 0,
      sort: [{ sortBy: 'dc:title', sortOrder: 'ASC' }],
    });
    expect(component.listSort()).toEqual({ key: 'title', direction: 'asc' });
    // Whatever the server answered, in the order it answered: the page is never sorted here.
    expect(rowTitles()).toEqual(['Zebra', 'apple', 'Mango']);

    sortControl('Title').click();
    await settle();
    expect(lastRequest().page.sort).toEqual([{ sortBy: 'dc:title', sortOrder: 'DESC' }]);

    sortControl('Last Contributor').click();
    await settle();
    expect(lastRequest().page.sort).toEqual([{ sortBy: 'dc:lastContributor', sortOrder: 'ASC' }]);
  });

  it('keeps a column the server cannot sort by out of the sort controls', async () => {
    localStorage.setItem('browse_column_settings', JSON.stringify(['title', 'type', 'version']));
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [doc({ uid: 'c-1', title: 'Readme.md' })], totalSize: 1 }),
    );

    await render();

    const typeHeader = [
      ...fixture.nativeElement.querySelectorAll('nxs-document-list thead th'),
    ].find((el) => (el as HTMLElement).textContent?.trim() === 'Type') as HTMLElement;
    expect(typeHeader.hasAttribute('aria-sort')).toBe(false);
    expect(typeHeader.querySelector('.mat-sort-header-container')).toBeNull();
    expect(sortControl('Title')).toBeTruthy();
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
   * An empty initial crashes Satori's avatar inside change detection, which takes down the whole
   * listing rather than one cell, so the list passes `?` for a document with no contributor.
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
    await settleOutlets();
    expect(query(`${ROW} nxs-avatar`)?.textContent?.trim()).toBe('?');
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

    await settleOutlets();
    expect(query(`${ROW} nxs-avatar`)?.textContent?.trim()).toBe('J');
    expect(query(`${ROW} .nxs-document-list__person`)?.textContent).toContain('jdoe');
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

    await render();

    expect(query('nxs-document-list thead th.nxs-document-list__select')).not.toBeNull();
    expect(query('nxs-document-list thead th.nxs-document-list__actions')).not.toBeNull();
    expect(unlabelledHeaders('nxs-document-list')).toEqual([]);
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
