import {
  Component,
  input,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
  type TemplateRef,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ROUTES, Router, provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { EMPTY, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { provideSatoriExtensions } from '@nuxeo/satori-platform/extensions';
import {
  NXS_PRIMITIVE_IDS,
  provideNxsComponents,
  type NxsCardInputs,
} from '@nuxeo/satori-platform/components';
import {
  BrowseService,
  ClipboardTargetService,
  DirectoryService,
  DocumentDetailService,
  BrowseContextService,
  SelectionService,
  TagService,
  type AuditEntry,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

import { BrowseComponent, FILTER_DEBOUNCE_MS } from './browse';
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
  // Never resolves on purpose, so the type dropdown falls back to the types on the loaded page
  // unless a spec says otherwise.
  //
  // Parameters declared, not just the return type: a zero-arg mock makes `mock.calls` an empty
  // tuple, so a spec cannot assert which path it was asked for — `spec-types` rejects the index
  // even though Vitest runs it happily.
  getBrowseFolderTypes: vi.fn(
    (_nuxeoPath: string, _maxDocuments?: number): BrowseReturn<'getBrowseFolderTypes'> => EMPTY,
  ),
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

/** A customer's tag, registered under `nxs.primitives.tag`. */
@Component({
  standalone: true,
  selector: 'lib-test-acme-tag',
  template: '<span class="acme-tag" [attr.data-color]="color()">{{ label() }}</span>',
})
class AcmeTagComponent {
  readonly label = input('');
  readonly color = input('');
}

/** A customer's avatar, registered under `nxs.primitives.avatar`. */
@Component({
  standalone: true,
  selector: 'lib-test-acme-avatar',
  template: '<span class="acme-avatar" [attr.data-size]="size()">{{ initials() }}</span>',
})
class AcmeAvatarComponent {
  readonly initials = input('');
  readonly size = input('');
}

/** A customer's permissions panel, registered under the packaged panel's ID. */
@Component({
  standalone: true,
  selector: 'lib-test-custom-permissions',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '<p class="custom-permissions">CUSTOM PERMISSIONS for {{ documentId() }}</p>',
})
class CustomPermissionsComponent {
  readonly documentId = input('');
  readonly permissionsChanged = input<(() => void) | null>(null);
}

/** A card registered under the packaged card's ID, which shows what browse passed it. */
@Component({
  standalone: true,
  selector: 'lib-test-probe-card',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [NgTemplateOutlet],
  template: `
    <p class="probe-heading">{{ heading() }}</p>
    <p class="probe-subheading">{{ subheading() }}</p>
    <p class="probe-selected">{{ selected() }}</p>
    <p class="probe-selection-label">{{ selectionLabel() }}</p>
    <div class="probe-media"><ng-container [ngTemplateOutlet]="media()" /></div>
    <div class="probe-header-action"><ng-container [ngTemplateOutlet]="headerAction()" /></div>
  `,
})
class ProbeCardComponent implements NxsCardInputs {
  readonly heading = input('');
  readonly subheading = input('');
  readonly selected = input(false, { transform: (value: unknown) => value === true });
  readonly selectionLabel = input('');
  readonly selectionHandler = input<((selected: boolean) => void) | null>(null);
  readonly openHandler = input<(() => void) | null>(null);
  readonly media = input<TemplateRef<unknown> | null>(null);
  readonly headerAction = input<TemplateRef<unknown> | null>(null);
  readonly actions = input<TemplateRef<unknown> | null>(null);
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
        provideHttpClient(withXhr()),
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

  /**
   * Let a changed filter's debounce elapse, then render what the reload produced.
   *
   * Two things in order, and the order is the whole point.
   *
   * **Change detection first.** The effect that starts the debounce has not run at the moment a
   * filter signal is written — measured: `filtering()` is still false immediately after the write
   * and true one macrotask later — so the timer does not exist yet. This used to sleep straight
   * away, which spent the budget on a timer that had not started: fine on a host where the effect
   * ran in ~2ms, and a `windows-gate` failure on a loaded CI runner, where the reload landed after
   * the sleep had already elapsed and the rows were still the unfiltered ones.
   *
   * **Then wait for the reload itself, not for a duration.** A fixed sleep is a guess about how
   * fast the runner is; waiting until the request has actually been issued is not. The deadline is
   * only there so a genuine failure reports as an assertion rather than hanging.
   */
  async function settleFilter(): Promise<void> {
    await settle();
    await waitForFolderRequest();
  }

  /**
   * Wait until the component issues another folder request, whatever timer it is on, and **fail**
   * if it never does.
   *
   * Used for both of the component's own timers — the filter debounce and the paste's deferred
   * reload — so neither test has to name a duration.
   *
   * The assertion is the load-bearing half, not the loop. A waiter that merely stopped at its
   * deadline turned "the reload never happened" into a pass for every test whose expectation is
   * that something did *not* change — `keeps a pasted row through the paste's own deferred reload`
   * asserts the row is still there, which is trivially true if no reload ever ran. That is the
   * same vacuity as a fixed sleep, just better disguised, so the waiter states what it waited for.
   */
  async function waitForFolderRequest(deadlineMs = 4000): Promise<void> {
    const before = browse.getBrowseFolderContents.mock.calls.length;
    const deadline = Date.now() + deadlineMs;
    while (browse.getBrowseFolderContents.mock.calls.length === before && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(browse.getBrowseFolderContents.mock.calls.length).toBeGreaterThan(before);
    await settle();
  }

  /**
   * Let the debounce window pass **without** expecting a reload.
   *
   * For the cases that assert nothing was asked for, where waiting on a request that must never
   * arrive would only ever time out. Same leading `settle()`, for the same reason.
   */
  async function settleFilterWindow(): Promise<void> {
    await settle();
    await new Promise((resolve) => setTimeout(resolve, FILTER_DEBOUNCE_MS + 150));
    await settle();
  }

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

  /**
   * The defect, and the reason the filters moved to the server: a filter sifted only the rows
   * already fetched, so a document further down the folder could not be found by typing its exact
   * title. Measured against a live Nuxeo on `/default-domain/workspaces` — 66 children, 50
   * rendered — "Project Reports" gave "0 results" while sitting in the folder.
   */
  it('finds a document that is in the folder but not on the loaded page', async () => {
    const onPage = [doc({ uid: 'c-1', title: 'Q1 Report' }), doc({ uid: 'c-2', title: 'Invoice' })];
    const offPage = doc({ uid: 'c-99', title: 'Project Reports' });
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: onPage, totalSize: -1, hasNextPage: true }),
    );

    const component = await render();
    expect(rowTitles()).toEqual(['Q1 Report', 'Invoice']);

    // The server answers the filtered query with the match, and with a real count of it.
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [offPage], totalSize: 1, hasNextPage: false, serverFiltered: true }),
    );
    component.filterText.set('project reports');
    await settleFilter();

    expect(rowTitles()).toEqual(['Project Reports']);
    expect(query('.result-count')?.textContent).toContain('1 result');
    // From the server, so the pager describes the filtered listing rather than the unfiltered one.
    expect(component.listHasNextPage()).toBe(false);
    expect(component.listTotalSize()).toBe(1);
  });

  it('sends the filters to the server, from the first page', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [], totalSize: 0, serverFiltered: true }),
    );
    const component = await render();
    component.goToPage(2);
    await settle();
    expect(lastRequest().page.currentPageIndex).toBe(2);

    component.filterText.set('report');
    component.filterType.set('File');
    component.filterContributor.set('alice');
    component.filterModifiedFrom.set(new Date(Date.UTC(2026, 9, 21)));
    await settleFilter();

    const [, , page, filters] = browse.getBrowseFolderContents.mock.calls.at(-1) ?? [];
    expect(filters).toEqual({
      text: 'report',
      type: 'File',
      contributor: 'alice',
      modifiedFrom: new Date(Date.UTC(2026, 9, 21)),
      modifiedTo: null,
    });
    // Page three of one filter is not page three of the next.
    expect(page?.currentPageIndex).toBe(0);
    expect(component.pageIndex()).toBe(0);
  });

  /**
   * One request for a burst of keystrokes. `switchMap` in the loader is what makes a superseded
   * answer *harmless*; the debounce is what stops sixteen being asked for in the first place.
   */
  it('asks once for a burst of typing, not once per keystroke', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [], totalSize: 0, serverFiltered: true }),
    );
    const component = await render();
    browse.getBrowseFolderContents.mockClear();

    for (const text of ['r', 're', 'rep', 'repo', 'repor', 'report']) {
      component.filterText.set(text);
      await settle();
    }
    // Nothing yet: the debounce has not elapsed.
    expect(browse.getBrowseFolderContents).not.toHaveBeenCalled();

    await settleFilter();
    expect(browse.getBrowseFolderContents).toHaveBeenCalledTimes(1);
    expect(browse.getBrowseFolderContents.mock.calls.at(-1)?.[3]?.text).toBe('report');
  });

  /**
   * The rows being replaced stay on screen while the new ones are fetched. `loading` makes the
   * document list draw its own loading state *instead of* the table, which at a 250ms debounce
   * against a ~30ms query is a spinner flashing over every pause in typing.
   */
  it('keeps the rows on screen while a changed filter is being applied', async () => {
    const rows = [doc({ uid: 'c-1', title: 'Q1 Report' }), doc({ uid: 'c-2', title: 'Invoice' })];
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: rows, totalSize: 2, serverFiltered: true }),
    );
    const component = await render();

    const pending = new Subject<never>();
    browse.getBrowseFolderContents.mockReturnValue(pending);
    component.filterText.set('report');
    await settleFilter();

    expect(component.loading()).toBe(false);
    expect(component.filtering()).toBe(true);
    expect(rowTitles()).toEqual(['Q1 Report', 'Invoice']);
    expect(query('.filter-progress')).not.toBeNull();
  });

  it('withdraws the progress indicator once the filtered listing lands', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [], totalSize: 0, serverFiltered: true }),
    );
    const component = await render();
    component.filterText.set('report');
    await settleFilter();

    expect(component.filtering()).toBe(false);
    expect(query('.filter-progress')).toBeNull();
  });

  it('stops filtering, rather than hanging on it, when the filtered request fails', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [], totalSize: 0, serverFiltered: true }),
    );
    const component = await render();

    browse.getBrowseFolderContents.mockReturnValue(throwError(() => new Error('nope')));
    component.filterText.set('report');
    await settleFilter();

    expect(component.filtering()).toBe(false);
    expect(query('.filter-progress')).toBeNull();
    expect(component.error()).not.toBeNull();
  });

  /**
   * A listing the server could not filter — the repository root, whose `tree_children` view no
   * query reproduces — still narrows what it was handed, and must not offer its next page: that
   * page belongs to the unfiltered listing, which is what once left the control enabled beside
   * zero filtered rows.
   */
  it('narrows a listing the server did not filter, and withholds its pager', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [
          doc({ uid: 'c-1', title: 'Q1 Report' }),
          doc({ uid: 'c-2', title: 'Q2 Report' }),
          doc({ uid: 'c-3', title: 'Invoice' }),
        ],
        totalSize: -1,
        hasNextPage: true,
        serverFiltered: false,
      }),
    );

    const component = await render();
    component.filterText.set('report');
    await settleFilter();

    expect(rowTitles()).toEqual(['Q1 Report', 'Q2 Report']);
    expect(query('.result-count')?.textContent).toContain('2 results');
    expect(component.listHasNextPage()).toBe(false);
    expect(component.listTotalSize()).toBe(2);
    expect(component.listPageIndex()).toBe(0);
  });

  it('keeps the server’s own count and pager for a listing it did filter', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [doc({ uid: 'c-1', title: 'Q1 Report' })],
        totalSize: 66,
        hasNextPage: true,
        serverFiltered: true,
      }),
    );

    const component = await render();
    component.filterText.set('report');
    await settleFilter();

    // Not `filteredEntries().length`: the server counted every match, across pages.
    expect(component.listTotalSize()).toBe(66);
    expect(component.listHasNextPage()).toBe(true);
    expect(query('.result-count')?.textContent).toContain('66 results');
  });

  // ── The type dropdown, whose options cannot come from the filtered rows ──

  it('collects the folder’s types when the dropdown opens, and offers them with the page’s', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [doc({ uid: 'c-1', title: 'Q1', type: 'File' })], totalSize: 1 }),
    );
    browse.getBrowseFolderTypes.mockReturnValue(of(['Note', 'Workspace']));

    const component = await render();
    // Before it is opened: only what the page shows.
    expect(component.distinctTypes()).toEqual(['File']);

    component.loadFolderTypes();
    await settle();

    // The union, so the list is never narrower than the rows on screen.
    expect(component.distinctTypes()).toEqual(['File', 'Note', 'Workspace']);
    expect(browse.getBrowseFolderTypes.mock.calls.at(-1)?.[0]).toBe(component.browsePath());
  });

  /**
   * The reason the types are their own request. The rows are filtered now, so under a type filter
   * `entries()` holds that one type — options built from them would collapse to the type already
   * chosen and leave no other to pick, including no way back to All types.
   */
  it('does not collapse the dropdown to the type already filtered for', async () => {
    browse.getBrowseFolderTypes.mockReturnValue(of(['File', 'Note', 'Workspace']));
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [doc({ uid: 'c-1', title: 'Q1', type: 'File' })], totalSize: 1 }),
    );

    const component = await render();
    component.loadFolderTypes();
    await settle();

    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [doc({ uid: 'c-2', title: 'A note', type: 'Note' })],
        totalSize: 1,
        serverFiltered: true,
      }),
    );
    component.filterType.set('Note');
    await settleFilter();

    expect(rowTitles()).toEqual(['A note']);
    expect(component.distinctTypes()).toEqual(['File', 'Note', 'Workspace']);
  });

  it('collects the types once per folder, however often the dropdown is opened', async () => {
    browse.getBrowseFolderTypes.mockReturnValue(of(['File']));
    const component = await render();

    component.loadFolderTypes();
    await settle();
    const calls = browse.getBrowseFolderTypes.mock.calls.length;
    component.loadFolderTypes();
    component.loadFolderTypes();
    await settle();

    expect(browse.getBrowseFolderTypes.mock.calls.length).toBe(calls);
  });

  /**
   * A collected answer must not land after the thing it describes has changed.
   *
   * The types are cached per folder and the in-flight guard compares the path — which cannot tell
   * "another folder" from "the same folder, invalidated since". The scan this replaced carried a
   * generation counter for precisely that, and dropping the scan dropped the counter with it.
   */
  it('ignores collected types that a content change has already superseded', async () => {
    const pending = new Subject<string[]>();
    browse.getBrowseFolderTypes.mockReturnValue(pending);
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [doc({ uid: 'c-1', title: 'Q1', type: 'File' })],
        totalSize: 1,
      }),
    );
    const component = await render();

    component.loadFolderTypes();
    await settle();

    // The folder's contents change while the request is still in flight.
    TestBed.inject(BrowseContextService).requestContentRefresh();
    await settle();

    // The pre-change answer arrives.
    pending.next(['Note', 'Workspace']);
    pending.complete();
    await settle();

    // It describes the folder as it was before the change, so only the page's own types remain.
    expect(component.distinctTypes()).toEqual(['File']);
  });

  it('collects them again after the folder’s contents change', async () => {
    browse.getBrowseFolderTypes.mockReturnValue(of(['File']));
    browse.getBrowseFolderContents.mockReturnValue(of({ folder, entries: [], totalSize: 0 }));
    const component = await render();
    component.loadFolderTypes();
    await settle();
    const calls = browse.getBrowseFolderTypes.mock.calls.length;

    // What a rename, a trash, an upload or an import all go through.
    TestBed.inject(BrowseContextService).requestContentRefresh();
    await settle();
    component.loadFolderTypes();
    await settle();

    expect(browse.getBrowseFolderTypes.mock.calls.length).toBeGreaterThan(calls);
  });

  /**
   * Nothing on screen depends on the collected types, so a failure is not an error state: the
   * dropdown falls back to the types on the page, which is what it offered before any of this.
   * Opening it again retries.
   */
  it('falls back to the page’s types when collecting them fails, and retries on re-open', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [doc({ uid: 'c-1', title: 'Q1', type: 'File' })], totalSize: 1 }),
    );
    browse.getBrowseFolderTypes.mockReturnValue(throwError(() => new Error('nope')));

    const component = await render();
    component.loadFolderTypes();
    await settle();

    expect(component.distinctTypes()).toEqual(['File']);
    expect(component.error()).toBeNull();

    browse.getBrowseFolderTypes.mockReturnValue(of(['Note']));
    component.loadFolderTypes();
    await settle();

    expect(component.distinctTypes()).toEqual(['File', 'Note']);
  });

  // ── Optimistic paste rows, the only rows a filtered listing holds unjudged ──

  it('shows a freshly pasted document to an active filter', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [], totalSize: 0, serverFiltered: true }),
    );
    const component = await render();
    component.filterText.set('pasted');
    await settleFilter();

    const context = TestBed.inject(BrowseContextService);
    context.notifyClipboardPasteComplete({
      targetUid: folder.uid,
      action: 'copy',
      documents: [doc({ uid: 'p-1', title: 'Pasted Report' })],
    });
    await settle();

    // `@children` is eventually consistent, so the row exists only in `entries()` — but it matches.
    expect(rowTitles()).toEqual(['Pasted Report']);
  });

  /**
   * The server judged its own rows; the optimistic paste row has been judged by nobody, so it is
   * the one row the filtered listing checks here. Without that, pasting into a filtered folder put
   * a document that does not match the filter straight into the filtered rows.
   */
  it('keeps a pasted document that does not match the filter out of the rows', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [doc({ uid: 'c-1', title: 'Q1 Report' })],
        totalSize: 1,
        serverFiltered: true,
      }),
    );
    const component = await render();
    component.filterText.set('report');
    await settleFilter();
    expect(rowTitles()).toEqual(['Q1 Report']);

    TestBed.inject(BrowseContextService).notifyClipboardPasteComplete({
      targetUid: folder.uid,
      action: 'copy',
      documents: [doc({ uid: 'p-1', title: 'Invoice' })],
    });
    await settle();

    expect(rowTitles()).toEqual(['Q1 Report']);
    // And the count agrees with the rows. It used to say "2 results" beside the one row, because
    // the paste raised the total while `filteredEntries` correctly left the document out.
    expect(query('.result-count')?.textContent).toContain('1 result');
    expect(component.listTotalSize()).toBe(1);

    // Every filtered refresh used to add it again: the query never returns its uid, so nothing
    // cleared it from the pending map that the total was derived from.
    component.loadContent();
    await settle();
    expect(rowTitles()).toEqual(['Q1 Report']);
    expect(component.listTotalSize()).toBe(1);
  });

  /**
   * The progress indicator must not survive the request it describes being superseded.
   *
   * `filtering` is raised the moment a filter changes and lowered when the listing lands, and the
   * loader drops a payload whose path or page no longer matches *before* lowering it — so the
   * question is whether any interleaving can leave the indicator spinning for ever. These are the
   * two that replace a filter reload mid-flight.
   */
  it('stops the progress indicator when a page change supersedes a filter reload', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [], totalSize: 0, hasNextPage: true, serverFiltered: true }),
    );
    const component = await render();

    component.filterText.set('report');
    // Mid-debounce, so the filter reload is replaced before it is even issued.
    component.goToPage(1);
    await settleFilter();

    expect(component.filtering()).toBe(false);
    expect(query('.filter-progress')).toBeNull();
  });

  it('stops it when the folder changes under a filter reload', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [], totalSize: 0, serverFiltered: true }),
    );
    const component = await render([
      { provide: ROUTES, multi: true, useValue: [{ path: '**', children: [] }] },
    ]);

    component.filterText.set('report');
    // Let the effect raise it first. Without this the navigation clears the filter before the
    // effect has run, so `filtering` is never true and the assertion below proves nothing — which
    // is what this test did on its first attempt.
    await settle();
    expect(component.filtering()).toBe(true);

    await TestBed.inject(Router).navigateByUrl('/browse/default-domain/workspaces/other');
    await settleFilter();

    expect(component.filtering()).toBe(false);
    expect(query('.filter-progress')).toBeNull();
  });

  /**
   * A selection must not outlive the rows it was made from.
   *
   * Every selection helper resolves an id against `entries()`, and a filtered reload replaces
   * those wholesale, so a selection the new rows do not contain became a count with nothing behind
   * it. The two header controls then disagreed about what was selected: Delete vanished, while Edit
   * stayed enabled and fell through to the *folder* — so clicking it edited something other than
   * the row the user had picked.
   */
  /**
   * The one case where a header control follows the selection rather than the folder.
   *
   * `openEditDialog()` edits the **current folder** for every selection except a single selected
   * Collection, which gets its own dialog. So an unresolvable selection matters here and nowhere
   * else: lose the collection from `entries()` and Edit silently becomes the folder's. This pins
   * both halves — that it follows a selected collection, and that clearing the selection on a
   * filter change leaves Edit meaning the folder because nothing is selected, not because the
   * collection went missing.
   */
  it('keeps header Edit on a selected collection, and on the folder once it is deselected', async () => {
    const collection = doc({
      uid: 'col-1',
      title: 'My Collection',
      type: 'Collection',
      facets: ['Collection'],
    });
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [collection], totalSize: 1, serverFiltered: true }),
    );
    const component = await render();

    component.onListSelectionChange(['col-1']);
    await settle();
    expect(component.singleSelectedEntry()?.uid).toBe('col-1');

    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [doc({ uid: 'c-9', title: 'Invoice' })],
        totalSize: 1,
        serverFiltered: true,
      }),
    );
    component.filterText.set('invoice');
    await settleFilter();

    // Nothing selected, so Edit is the folder's — and `singleSelectedEntry()` is null because the
    // selection went, not because a still-selected collection could not be found.
    expect(TestBed.inject(SelectionService).selectedCount()).toBe(0);
    expect(component.singleSelectedEntry()).toBeNull();
    expect(component.showHeaderEdit()).toBe(component.canWriteCurrentDoc());
  });

  it('clears a selection the filtered rows no longer contain', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [doc({ uid: 'c-1', title: 'Q1 Report' })],
        totalSize: 1,
        serverFiltered: true,
      }),
    );
    const component = await render();
    const selection = TestBed.inject(SelectionService);

    component.onListSelectionChange(['c-1']);
    await settle();
    expect(component.singleSelectedEntry()?.uid).toBe('c-1');
    expect(selection.selectedCount()).toBe(1);

    // A filter whose answer does not contain the selected row.
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [doc({ uid: 'c-2', title: 'Invoice' })],
        totalSize: 1,
        serverFiltered: true,
      }),
    );
    component.filterText.set('invoice');
    await settleFilter();

    expect(selection.selectedCount()).toBe(0);
    expect(component.singleSelectedEntry()).toBeNull();
    // With nothing selected both controls describe the folder, which is consistent — rather than
    // Delete hidden on an empty resolution while Edit silently retargets to the folder.
    expect(component.showHeaderEdit()).toBe(component.canWriteCurrentDoc());
    expect(component.showHeaderDelete()).toBe(component.canRemoveCurrentDoc());
  });

  /**
   * A non-matching paste must not poison the count for the pastes after it.
   *
   * The total is only adjusted while it is a complete count of the listing, and that test used to
   * be made against the raw entry count. A hidden optimistic row joins `entries()` while being
   * left out of both the rows and the total, so the two counts diverged by one and never met
   * again — and the next paste, one the filter *does* match, could then never raise the total.
   */
  it('still counts a matching paste after a non-matching one', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder,
        entries: [doc({ uid: 'c-1', title: 'Q1 Report' })],
        totalSize: 1,
        serverFiltered: true,
      }),
    );
    const component = await render();
    component.filterText.set('report');
    await settleFilter();
    const context = TestBed.inject(BrowseContextService);

    // First paste: excluded by the filter, so neither a row nor part of the count.
    context.notifyClipboardPasteComplete({
      targetUid: folder.uid,
      action: 'copy',
      documents: [doc({ uid: 'p-1', title: 'Invoice' })],
    });
    await settle();
    expect(rowTitles()).toEqual(['Q1 Report']);
    expect(component.listTotalSize()).toBe(1);

    // Second paste: matches, so it is both.
    context.notifyClipboardPasteComplete({
      targetUid: folder.uid,
      action: 'copy',
      documents: [doc({ uid: 'p-2', title: 'Q2 Report' })],
    });
    await settle();

    expect(rowTitles()).toEqual(['Q1 Report', 'Q2 Report']);
    expect(component.listTotalSize()).toBe(2);
    expect(query('.result-count')?.textContent).toContain('2 results');
  });

  /**
   * The other half of carrying optimistic rows under a server-side filter: retracting them.
   *
   * A pending copy keeps the title it was pasted under, and a filtered query never returns the uid
   * of a document the filter excludes — so renaming a pasted row out of the filter, moving it or
   * trashing it left the stale copy on screen for ever, re-appended by every reload. Any mutation
   * now drops the optimistic rows, and only the paste's own deferred reload keeps them.
   *
   * `restoreDocument` stands in for the mutations generally: it is the one that reaches
   * `reloadAfterContentChange()` without going through a dialog, and that method is where every
   * in-page mutation converges.
   */
  it('drops a pasted row once any other mutation has made it stale', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [], totalSize: 0, serverFiltered: true }),
    );
    browse.restoreDocument.mockReturnValue(of(doc({ uid: 'r-1', title: 'Restored' })));
    const component = await render();
    component.filterText.set('report');
    await settleFilter();

    TestBed.inject(BrowseContextService).notifyClipboardPasteComplete({
      targetUid: folder.uid,
      action: 'copy',
      documents: [doc({ uid: 'p-1', title: 'Pasted Report' })],
    });
    await settle();
    expect(rowTitles()).toEqual(['Pasted Report']);
    expect(component.listTotalSize()).toBe(1);

    // The server still answers the filter with nothing, as it would for a document renamed out of
    // the filter or trashed. The optimistic copy's own title matches, which is what used to keep
    // it visible for ever.
    component.restoreDocument(doc({ uid: 'r-1', title: 'Restored' }));
    await settle();

    expect(rowTitles()).toEqual([]);
    expect(component.listTotalSize()).toBe(0);
  });

  /**
   * The bridge the retraction above must not cut.
   *
   * A paste schedules its own reload 1.5s later, and that reload is the one the optimistic rows are
   * waiting for — it clears each one the server has caught up with. Without the explicit opt-out it
   * would discard the ones the server has *not* caught up with as well, so a pasted document would
   * appear and then vanish a second and a half later. The wait is real because the timer is.
   */
  it('keeps a pasted row through the paste’s own deferred reload', async () => {
    // The server never lists it, which is the case the optimistic row exists for.
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [], totalSize: 0, serverFiltered: true }),
    );
    const component = await render();
    component.filterText.set('report');
    await settleFilter();

    TestBed.inject(BrowseContextService).notifyClipboardPasteComplete({
      targetUid: folder.uid,
      action: 'copy',
      documents: [doc({ uid: 'p-1', title: 'Pasted Report' })],
    });
    await settle();
    expect(rowTitles()).toEqual(['Pasted Report']);

    // Until the deferred reload actually goes out, rather than for a guessed 1800ms: the timer
    // starts when the paste effect runs, not when the paste is notified, so a fixed sleep measures
    // from the wrong moment — which is what made the filter tests fail on a loaded Windows runner.
    await waitForFolderRequest();

    expect(rowTitles()).toEqual(['Pasted Report']);
    expect(component.listTotalSize()).toBe(1);
  });

  /** The same retraction for a change made outside this page, which reaches it as a refresh tick. */
  it('drops a pasted row when something outside the page changes the folder', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [], totalSize: 0, serverFiltered: true }),
    );
    const component = await render();
    component.filterText.set('report');
    await settleFilter();

    TestBed.inject(BrowseContextService).notifyClipboardPasteComplete({
      targetUid: folder.uid,
      action: 'copy',
      documents: [doc({ uid: 'p-1', title: 'Pasted Report' })],
    });
    await settle();
    expect(rowTitles()).toEqual(['Pasted Report']);

    TestBed.inject(BrowseContextService).requestContentRefresh();
    await settle();

    expect(rowTitles()).toEqual([]);
  });

  it('does not re-judge the rows the server filtered', async () => {
    const matched = doc({ uid: 'c-1', title: 'DİYARBAKIR' });
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [matched], totalSize: 1, serverFiltered: true }),
    );

    const component = await render();
    // A term the server matched that `toLowerCase().includes()` does not: the dotted capital İ
    // lower-cases to a two-code-point sequence in JS, so this substring is absent from the result.
    component.filterText.set('diyarbakir');
    await settleFilter();

    expect(rowTitles()).toEqual(['DİYARBAKIR']);
  });

  it('does not ask twice when a folder change clears the filters', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [], totalSize: 0, serverFiltered: true }),
    );
    const component = await render([
      { provide: ROUTES, multi: true, useValue: [{ path: '**', children: [] }] },
    ]);
    component.filterText.set('report');
    await settleFilter();
    browse.getBrowseFolderContents.mockClear();

    await TestBed.inject(Router).navigateByUrl('/browse/default-domain/workspaces/other');
    await settle();
    expect(component.filterText()).toBe('');
    const afterNavigation = browse.getBrowseFolderContents.mock.calls.length;

    // The navigation's own load already carried the cleared filters; clearing them must not ask
    // for the same listing again once the debounce elapses. The window is waited out rather than
    // waited *on*, since the whole assertion is that no request arrives.
    await settleFilterWindow();
    expect(browse.getBrowseFolderContents.mock.calls.length).toBe(afterNavigation);
  });

  it('offers one control that clears both ends of the Modified range', async () => {
    browse.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [doc({ uid: 'c-1', title: 'Q1 Report' })], totalSize: 1 }),
    );

    const component = await render();
    expect(query('.filter-clear-btn--standalone')).toBeNull();

    component.filterModifiedFrom.set(new Date('2026-10-21T00:00:00Z'));
    component.filterModifiedTo.set(new Date('2026-10-29T00:00:00Z'));
    await settle();

    const clear = query('.filter-clear-btn--standalone') as HTMLButtonElement | null;
    expect(clear).not.toBeNull();
    expect(clear?.getAttribute('aria-label')).toBe('Clear the modified date range');

    clear!.click();
    await settle();

    expect(component.filterModifiedFrom()).toBeNull();
    expect(component.filterModifiedTo()).toBeNull();
    // And it withdraws once there is nothing to clear.
    expect(query('.filter-clear-btn--standalone')).toBeNull();
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

  /**
   * NXSAT-652. The details panel's avatars and tags render by their `nxs.primitives.*` ID, so a
   * component registered under one replaces every use; with nothing registered, the `nxs-`
   * element renders instead. Seen red on purpose by restoring `<sat-avatar>` in the info panel.
   */
  describe('nxs.primitives.* in the details panel', () => {
    const described = doc({
      ...folder,
      properties: {
        'dc:creator': 'alice',
        'dc:lastContributor': 'bob',
        'nxtag:tags': [{ label: 'urgent' }, 'q3'],
      },
    });
    const overrides = provideSatoriExtensions({
      components: {
        [NXS_PRIMITIVE_IDS.avatar]: AcmeAvatarComponent,
        [NXS_PRIMITIVE_IDS.tag]: AcmeTagComponent,
      },
    });
    const texts = (selector: string): string[] =>
      [...fixture.nativeElement.querySelectorAll(selector)].map(
        (el) => (el as HTMLElement).textContent?.trim() ?? '',
      );

    beforeEach(() => {
      browse.getByPath.mockReturnValue(of(described));
      browse.getFolderContext.mockReturnValue(of(described));
      browse.getBrowseFolderContents.mockReturnValue(
        of({ folder: described, entries: [], totalSize: 0 }),
      );
    });

    async function openPanel(
      tab: 'info' | 'tags' | 'activity',
      providers: unknown[],
    ): Promise<BrowseComponent> {
      const component = await render(providers);
      component.panelOpen.set(true);
      component.panelSubTab.set(tab);
      await settleOutlets();
      return component;
    }

    it('renders the creator and contributor avatars through nxs.primitives.avatar', async () => {
      await openPanel('info', [overrides]);

      expect(texts('.details-panel .avatar-value .acme-avatar')).toEqual(['alice', 'bob']);
      expect(query('.details-panel .avatar-value nxs-avatar')).toBeNull();
    });

    it('renders the tags in the shared tag editor, which does not take nxs.primitives.tag', async () => {
      await openPanel('tags', [overrides]);

      expect(texts('.details-panel nxs-tag-editor mat-chip-row')).toEqual(['urgent', 'q3']);
      expect(texts('.details-panel .acme-tag')).toEqual([]);
    });

    it('renders the activity avatars through nxs.primitives.avatar', async () => {
      const component = await openPanel('activity', [overrides]);
      component.activityLoading.set(false);
      component.activityEntries.set([
        { id: 1, principalName: 'carol', eventId: 'documentModified' } as AuditEntry,
      ]);
      await settle();

      const avatar = query('.details-panel .activity-item .acme-avatar');
      expect(avatar?.textContent?.trim()).toBe('carol');
      expect(avatar?.dataset['size']).toBe('28');
    });

    it('falls back to the nxs- elements when nothing is registered under the IDs', async () => {
      await openPanel('info', []);

      expect(texts('.details-panel .avatar-value nxs-avatar.nxs-avatar')).toEqual(['A', 'B']);

      fixture.componentInstance.panelSubTab.set('tags');
      await settleOutlets();
      expect(texts('.details-panel nxs-tag-editor mat-chip-row')).toEqual(['urgent', 'q3']);
    });

    it('renders a trashed child type through nxs.primitives.tag', async () => {
      browse.getTrashedChildren.mockReturnValue(
        of({ folder: described, entries: [doc({ uid: 'trash-1', title: 'Old', type: 'File' })] }),
      );

      const component = await render([provideNoopAnimations(), overrides]);
      component.onTabChange(3);
      await settleOutlets();

      expect(texts('.browse-table .acme-tag')).toEqual(['File']);
      expect(query('.browse-table nxs-tag')).toBeNull();
    });
  });
  /**
   * The card view renders each document's card by `nxs.primitives.card`, so whatever is registered
   * under it — the library's card, a customer's, Satori's later — is what the user sees.
   */
  describe('card view', () => {
    const entries = [
      doc({ uid: 'file-1', title: 'Readme.md', type: 'File' }),
      doc({
        uid: 'sub-1',
        title: 'Sub',
        type: 'Folder',
        path: '/default-domain/workspaces/ws-1/sub',
        facets: ['Folderish'],
      }),
      doc({
        uid: 'coll-1',
        title: 'Q3 claims',
        type: 'Collection',
        facets: ['Collection'],
        contextParameters: { permissions: ['Read', 'Write', 'Remove'] },
      }),
    ];

    async function renderCards(extraProviders: unknown[] = []): Promise<void> {
      browse.getBrowseFolderContents.mockReturnValue(of({ folder, entries, totalSize: 3 }));
      await render(extraProviders);
      (query('button[aria-label="Card view"]') as HTMLButtonElement).click();
      await settleOutlets();
    }

    /**
     * The card view reads `filteredEntries()`, the same source as the list, so a filter whose only
     * match is beyond the loaded page reaches it too. Asserted rather than reasoned about, because
     * the last review asked whether a filtered card view could come out blank.
     */
    it('renders the filtered set, off-page documents included', async () => {
      const page = [doc({ uid: 'c-1', title: 'Q1 Report' })];
      browse.getBrowseFolderContents.mockReturnValue(
        of({ folder, entries: page, totalSize: -1, hasNextPage: true }),
      );

      await render([provideNxsComponents()]);
      (query('button[aria-label="Card view"]') as HTMLButtonElement).click();
      await settleOutlets();
      expect(fixture.nativeElement.querySelectorAll('.card-grid nxs-card').length).toBe(1);

      // The server answers the filter with a document that was never on the loaded page.
      browse.getBrowseFolderContents.mockReturnValue(
        of({
          folder,
          entries: [doc({ uid: 'c-99', title: 'Project Reports' })],
          totalSize: 1,
          serverFiltered: true,
        }),
      );
      fixture.componentInstance.filterText.set('project');
      await settleFilter();
      await settleOutlets();

      const cards = fixture.nativeElement.querySelectorAll('.card-grid nxs-card');
      expect(cards.length).toBe(1);
      expect(cards[0].textContent).toContain('Project Reports');
    });

    // The heading is the name of the control that opens the card, so it is never blank.
    it('names an untitled document by its path, on the card and on its checkbox', async () => {
      browse.getBrowseFolderContents.mockReturnValue(
        of({
          folder,
          entries: [
            doc({ uid: 'untitled-1', title: '  ', path: '/default-domain/workspaces/ws-1/x' }),
          ],
          totalSize: 1,
        }),
      );
      await render([provideNxsComponents()]);
      (query('button[aria-label="Card view"]') as HTMLButtonElement).click();
      await settleOutlets();

      const card = query('.card-grid nxs-card') as HTMLElement;
      expect(card.querySelector('button.nxs-card__open')?.textContent?.trim()).toBe(
        '/default-domain/workspaces/ws-1/x',
      );
      expect(card.querySelector('mat-checkbox input')?.getAttribute('aria-label')).toBe(
        'Select /default-domain/workspaces/ws-1/x',
      );
    });

    it('renders every card by its registered ID, with what browse passes it', async () => {
      await renderCards([
        provideNxsComponents(),
        provideSatoriExtensions({ components: { [NXS_PRIMITIVE_IDS.card]: ProbeCardComponent } }),
      ]);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');

      const probes = fixture.nativeElement.querySelectorAll(
        '.card-grid lib-extension-outlet lib-test-probe-card',
      ) as NodeListOf<HTMLElement>;
      expect(probes).toHaveLength(3);
      expect(query('nxs-card')).toBeNull();
      const text = (selector: string) =>
        [...probes].map((probe) => probe.querySelector(selector)?.textContent?.trim());
      expect(text('.probe-heading')).toEqual(['Readme.md', 'Sub', 'Q3 claims']);
      expect(text('.probe-subheading')).toEqual(['File', 'Folder', 'Collection']);
      expect(text('.probe-selection-label')).toEqual([
        'Select Readme.md',
        'Select Sub',
        'Select Q3 claims',
      ]);
      expect(text('.probe-selected')).toEqual(['false', 'false', 'false']);
      // The templates render where browse declared them, so they read browse's own document.
      expect(probes[0].querySelector('.probe-media nxs-thumbnail mat-icon')).not.toBeNull();
      expect(probes[0].querySelector('.probe-header-action button')).toBeNull();
      expect(
        probes[2]
          .querySelector('.probe-header-action button[mat-icon-button]')
          ?.getAttribute('aria-label'),
      ).toBe('Collection actions');

      const [file, sub] = fixture.debugElement
        .queryAll(By.directive(ProbeCardComponent))
        .map((probe) => probe.componentInstance as ProbeCardComponent);
      file.openHandler()?.();
      expect(navigate).toHaveBeenCalledWith('/doc/file-1');
      sub.openHandler()?.();
      expect(navigate).toHaveBeenCalledWith('/browse/default-domain/workspaces/ws-1/sub');

      file.selectionHandler()?.(true);
      await settle();
      expect(TestBed.inject(SelectionService).selectedIds()).toEqual(new Set(['file-1']));
      expect(text('.probe-selected')).toEqual(['true', 'false', 'false']);
    });

    it('renders the library card through the outlet, with no fallback beside it', async () => {
      await renderCards([provideNxsComponents()]);

      const cards = fixture.nativeElement.querySelectorAll(
        '.card-grid nxs-card',
      ) as NodeListOf<HTMLElement>;
      expect(cards).toHaveLength(3);
      expect(
        fixture.nativeElement.querySelectorAll('.card-grid lib-extension-outlet nxs-card'),
      ).toHaveLength(3);
      expect(cards[0].querySelector('button.nxs-card__open')?.textContent?.trim()).toBe(
        'Readme.md',
      );
      expect(cards[0].querySelector('.nxs-card__media nxs-thumbnail')).not.toBeNull();
      expect(cards[2].querySelector('.nxs-card__header-action button')).not.toBeNull();
    });

    it('falls back to the built-in card when nothing is registered under the ID', async () => {
      await renderCards();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');

      const cards = fixture.nativeElement.querySelectorAll(
        '.card-grid nxs-card',
      ) as NodeListOf<HTMLElement>;
      expect(cards).toHaveLength(3);
      expect(query('.card-grid lib-extension-outlet nxs-card')).toBeNull();
      cards[0].querySelector<HTMLElement>('button.nxs-card__open')?.click();
      expect(navigate).toHaveBeenCalledWith('/doc/file-1');
      cards[0].querySelector<HTMLInputElement>('.nxs-card__select input')?.click();
      await settle();
      expect(TestBed.inject(SelectionService).selectedIds()).toEqual(new Set(['file-1']));
      expect(cards[0].classList).toContain('nxs-card--selected');
    });
  });
});
