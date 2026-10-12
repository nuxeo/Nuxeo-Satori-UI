import { TestBed } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { EMPTY, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AppConfigService } from '@nuxeo-satori/platform/app-config';
import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  PACKAGED_BROWSE_COLUMNS,
} from '@nuxeo-satori/platform/extensions';
import {
  BrowseService,
  DirectoryService,
  DocumentDetailService,
  SelectionService,
  TagService,
} from '@nuxeo-satori/platform/nuxeo-client';

import { BrowseComponent } from './browse';
import { ALL_COLUMNS } from '../column-settings-dialog/column-settings-dialog';

/**
 * Browse's document-list columns, which moved from the hardcoded `ALL_COLUMNS`
 * const into the `documentList` slot.
 *
 * `documentList` was one of five slot ids that existed while **nothing read them**,
 * and `ExtensionColumnDescriptor` was declared with no producer or consumer —
 * exactly the "registered but dead" surface `AGENTS/12-review-agents.md` says to
 * look for. These specs are what make it not that.
 *
 * The first is the "a customer who changes nothing sees no difference" proof:
 * exact keys in exact order with exact default visibility, against the list
 * transcribed from the const this replaced, not a count.
 */
describe('BrowseComponent — documentList slot', () => {
  const manifest = signal<{ extensionLayers: readonly unknown[] }>({ extensionLayers: [] });

  const stub = {
    browse: {
      getByPath: vi.fn(() => throwError(() => new Error('not connected'))),
      getBrowseFolderContents: vi.fn(() => throwError(() => new Error('not connected'))),
      getFolderContext: vi.fn(() => throwError(() => new Error('not connected'))),
      getChildren: vi.fn(() => throwError(() => new Error('not connected'))),
      getTrashedChildren: vi.fn(() => EMPTY),
      restoreDocument: vi.fn(() => EMPTY),
      startCsvExport: vi.fn(() => EMPTY),
      pollAndDownloadCsv: vi.fn(() => EMPTY),
    },
    detail: {
      getFullDocument: vi.fn(() => EMPTY),
      getDocumentPermissions: vi.fn(() => EMPTY),
      fetchThumbnail: vi.fn(() => EMPTY),
      getAuditLog: vi.fn(() => of({ entries: [], totalSize: 0 })),
    },
    directory: { getEventTypes: vi.fn(() => of([])), getEventCategories: vi.fn(() => of([])) },
    tag: { searchTags: vi.fn(() => of([])) },
    selection: {
      selectedIds: vi.fn(() => new Set<string>()),
      selectedCount: vi.fn(() => 0),
      isSelected: vi.fn(() => false),
      isAllSelected: vi.fn(() => false),
      isIndeterminate: vi.fn(() => false),
      forgetPreviews: vi.fn(),
    },
  };

  /**
   * @param extensions manifest `extensions` block, as a customer would write it
   * @param stored     the user's persisted picker choice, or `null` for untouched
   */
  function render(extensions: unknown = undefined, stored: readonly string[] | null = null) {
    if (stored === null) localStorage.removeItem('browse_column_settings');
    else localStorage.setItem('browse_column_settings', JSON.stringify(stored));

    manifest.set({ extensionLayers: extensions === undefined ? [] : [extensions] });

    TestBed.configureTestingModule({
      imports: [testTranslateModule(), testTranslateModule(), BrowseComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        { provide: BrowseService, useValue: stub.browse },
        { provide: DocumentDetailService, useValue: stub.detail },
        { provide: DirectoryService, useValue: stub.directory },
        { provide: TagService, useValue: stub.tag },
        { provide: SelectionService, useValue: stub.selection },
        { provide: MatDialog, useValue: { open: vi.fn(() => ({ afterClosed: () => of(false) })) } },
        { provide: AppConfigService, useValue: { manifest } },
      ],
    }).overrideComponent(BrowseComponent, { set: { imports: [], template: '<div></div>' } });

    // Mirrors `provide-app-extensions.ts`. Registering here rather than relying on
    // the component is the point: if the app ever stops registering, these specs
    // still pass while the app renders the fallback — so `falls back` below is the
    // spec that would catch it, not this one.
    TestBed.inject(AppExtensionsService).register(
      EXTENSION_SLOTS.documentList,
      PACKAGED_BROWSE_COLUMNS,
    );

    return TestBed.createComponent(BrowseComponent).componentInstance;
  }

  afterEach(() => {
    localStorage.removeItem('browse_column_settings');
    TestBed.resetTestingModule();
  });

  it('reproduces the pre-Layer-1 column set exactly when no manifest overrides it', () => {
    const component = render();

    expect(component.columns().map((c) => c.key)).toEqual(ALL_COLUMNS.map((c) => c.key));
    expect(component.columns().map((c) => c.label)).toEqual(ALL_COLUMNS.map((c) => c.label));
    expect(component.visibleColumns().map((c) => c.key)).toEqual(
      ALL_COLUMNS.filter((c) => c.visible).map((c) => c.key),
    );
  });

  it('lets a manifest hide a column by id', () => {
    // `visible: false` is the *override* vocabulary, per docs/extension-reference.md.
    // `disabled` is a descriptor field honoured through `filterEnabled`, not an
    // override key — the first draft of this spec used it and correctly failed.
    const component = render({
      overrides: { 'app.documentList.lastContributor': { visible: false } },
    });

    expect(component.columns().map((c) => c.key)).not.toContain('lastContributor');
    expect(component.visibleColumns().map((c) => c.key)).toEqual(['title', 'modified']);
  });

  it('lets a manifest relabel a column without changing its key', () => {
    const component = render({
      overrides: { 'app.documentList.lastContributor': { label: 'Last edited by' } },
    });

    const column = component.columns().find((c) => c.key === 'lastContributor');
    expect(column?.label).toBe('Last edited by');
  });

  it('lets a manifest reorder columns', () => {
    const component = render({
      overrides: { 'app.documentList.modified': { order: 5 } },
    });

    expect(component.visibleColumns().map((c) => c.key)).toEqual([
      'modified',
      'title',
      'lastContributor',
    ]);
  });

  it('lets a manifest switch on a column that ships hidden', () => {
    const component = render({
      slots: {
        documentList: [{ id: 'app.documentList.version', hiddenByDefault: false }],
      },
    });

    expect(component.visibleColumns().map((c) => c.key)).toContain('version');
  });

  it("honours the user's own picker over the packaged defaults", () => {
    const component = render(undefined, ['title', 'version']);

    expect(component.visibleColumns().map((c) => c.key)).toEqual(['title', 'version']);
  });

  it('does not let a user preference resurrect a column the manifest removed', () => {
    // The load-bearing precedence case: Layer 1 is a customer decision and a user
    // preference must not undo it, or a customer cannot actually remove a column.
    const component = render({ overrides: { 'app.documentList.version': { visible: false } } }, [
      'title',
      'version',
    ]);

    expect(component.columns().map((c) => c.key)).not.toContain('version');
    expect(component.visibleColumns().map((c) => c.key)).toEqual(['title']);
  });

  it('resets to the manifest defaults, not the packaged const', () => {
    // Reset once read `ALL_COLUMNS`, so a column the manifest hid by default came back the
    // moment a user pressed it. The picker's defaults are the descriptors'.
    const component = render({
      overrides: { 'app.documentList.lastContributor': { visible: false } },
    });

    expect(component.defaultColumnKeys()).toEqual(['title', 'modified']);
  });

  it('offers the picker the descriptors’ labels, so a relabelled column keeps its name', () => {
    const component = render({
      overrides: { 'app.documentList.title': { label: 'Name' } },
    });

    expect(component.pickerColumns().find((c) => c.key === 'title')?.label).toBe('Name');
  });

  it('falls back to the packaged columns when nothing is registered', () => {
    // A bare injector — no APP_INITIALIZER — must still render a usable list rather
    // than a document list with no columns at all.
    manifest.set({ extensionLayers: [] });
    TestBed.configureTestingModule({
      imports: [testTranslateModule(), BrowseComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        { provide: BrowseService, useValue: stub.browse },
        { provide: DocumentDetailService, useValue: stub.detail },
        { provide: DirectoryService, useValue: stub.directory },
        { provide: TagService, useValue: stub.tag },
        { provide: SelectionService, useValue: stub.selection },
        { provide: MatDialog, useValue: { open: vi.fn(() => ({ afterClosed: () => of(false) })) } },
        { provide: AppConfigService, useValue: { manifest } },
      ],
    }).overrideComponent(BrowseComponent, { set: { imports: [], template: '<div></div>' } });

    const component = TestBed.createComponent(BrowseComponent).componentInstance;

    expect(component.columns().map((c) => c.key)).toEqual(ALL_COLUMNS.map((c) => c.key));
  });
});

/**
 * The fallback in `browse.ts` duplicates the packaged descriptor list, because a
 * bare `TestBed` has no registration and an empty column list is a worse failure
 * than a stale duplicate. This is what stops the duplicate drifting: it can only
 * go stale if someone changes one list and not the other, and then this fails.
 */
describe('PACKAGED_BROWSE_COLUMNS parity with the browse fallback', () => {
  it('agrees with ALL_COLUMNS on key, label and default visibility, in order', () => {
    expect(PACKAGED_BROWSE_COLUMNS.map((d) => d.field)).toEqual(ALL_COLUMNS.map((c) => c.key));
    expect(PACKAGED_BROWSE_COLUMNS.map((d) => d.label)).toEqual(ALL_COLUMNS.map((c) => c.label));
    expect(PACKAGED_BROWSE_COLUMNS.map((d) => !d.hiddenByDefault)).toEqual(
      ALL_COLUMNS.map((c) => c.visible),
    );
  });

  it('gives every column a unique id and a strictly ascending order', () => {
    const ids = PACKAGED_BROWSE_COLUMNS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);

    const orders = PACKAGED_BROWSE_COLUMNS.map((d) => d.order ?? Number.MAX_SAFE_INTEGER);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});
