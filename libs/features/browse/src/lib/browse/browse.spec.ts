import { ComponentFixture, TestBed } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { TranslateService } from '@ngx-translate/core';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { AppConfigService } from '@nuxeo-satori/platform/app-config';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { vi } from 'vitest';
import { EMPTY, of, throwError } from 'rxjs';
import { BrowseComponent } from './browse';
import {
  BrowseService,
  BrowseContextService,
  DocumentDetailService,
  DirectoryService,
  NuxeoAce,
  NuxeoDocument,
  SelectionService,
  TagService,
  CURRENT_USERNAME,
  ADMIN_ACCESS_CHECKS,
  PERMISSION_DENIED_KEY,
} from '@nuxeo-satori/platform/nuxeo-client';
import { trashSelectedDocumentsConfirmData } from '@nuxeo-satori/platform/ui';
import { NxsToastService } from '@nuxeo-satori/platform/components';

/**
 * Each mock is annotated with the real method's return type.
 *
 * Without it, `throwError()` and `EMPTY` infer `Observable<never>`, so every
 * `mockReturnValue(of(...))` in the suite was a type error — invisible, because no gate
 * type-checked a spec file. Tying the mock to the service also means a fixture that has
 * drifted from what `BrowseService` actually returns fails to compile rather than
 * passing against a shape the production code would never receive.
 */
const notConnected = () => throwError(() => new Error('not connected'));

/** A complete `NuxeoDocument`, so a fixture states only the fields its test is about. */
function doc(overrides: Partial<NuxeoDocument> & Pick<NuxeoDocument, 'uid'>): NuxeoDocument {
  return {
    title: 'Document',
    type: 'File',
    path: '/default-domain/workspaces/document',
    lastModified: '2026-01-01T00:00:00.000Z',
    properties: {},
    ...overrides,
  };
}

const mockBrowseService = {
  getByPath: vi.fn((): ReturnType<BrowseService['getByPath']> => notConnected()),
  getBrowseFolderContents: vi.fn((): ReturnType<BrowseService['getBrowseFolderContents']> =>
    notConnected(),
  ),
  getFolderContext: vi.fn((): ReturnType<BrowseService['getFolderContext']> => notConnected()),
  getChildren: vi.fn((): ReturnType<BrowseService['getChildren']> => notConnected()),
  hasChildCollections: vi.fn((): ReturnType<BrowseService['hasChildCollections']> => of(false)),
  getTrashedChildren: vi.fn((): ReturnType<BrowseService['getTrashedChildren']> => EMPTY),
  restoreDocument: vi.fn((): ReturnType<BrowseService['restoreDocument']> => EMPTY),
  startCsvExport: vi.fn((): ReturnType<BrowseService['startCsvExport']> => EMPTY),
  pollAndDownloadCsv: vi.fn((): ReturnType<BrowseService['pollAndDownloadCsv']> => EMPTY),
};

type DetailReturn<K extends keyof DocumentDetailService> = ReturnType<DocumentDetailService[K]>;

const mockDocumentDetailService = {
  getFullDocument: vi.fn((_uid: string): DetailReturn<'getFullDocument'> => EMPTY),
  getDocumentPermissions: vi.fn((): DetailReturn<'getDocumentPermissions'> => EMPTY),
  fetchThumbnail: vi.fn((): DetailReturn<'fetchThumbnail'> => EMPTY),
  getAuditLog: vi.fn((): DetailReturn<'getAuditLog'> =>
    of({ entries: [], totalSize: 0, currentPageSize: 0, currentPageIndex: 0, numberOfPages: 0 }),
  ),
  trashDocument: vi.fn((): DetailReturn<'trashDocument'> => EMPTY),
  exportZip: vi.fn((): DetailReturn<'exportZip'> => EMPTY),
  exportXml: vi.fn((): DetailReturn<'exportXml'> => EMPTY),
  subscribe: vi.fn((): DetailReturn<'subscribe'> => EMPTY),
  unsubscribe: vi.fn((): DetailReturn<'unsubscribe'> => EMPTY),
  blockPermissionInheritance: vi.fn((): DetailReturn<'blockPermissionInheritance'> => EMPTY),
  unblockPermissionInheritance: vi.fn((): DetailReturn<'unblockPermissionInheritance'> => EMPTY),
  sendNotificationEmailForPermission: vi.fn(
    (): DetailReturn<'sendNotificationEmailForPermission'> => EMPTY,
  ),
};

const mockDirectoryService = {
  getEventTypes: vi.fn(() => of([])),
  getEventCategories: vi.fn(() => of([])),
};

const mockTagService = {
  searchTags: vi.fn(() => of([])),
  addTag: vi.fn(() => EMPTY),
  removeTag: vi.fn(() => EMPTY),
};

const mockSelectionService = {
  selectedIds: vi.fn(() => new Set<string>()),
  selectedCount: vi.fn(() => 0),
  isSelected: vi.fn(() => false),
  isAllSelected: vi.fn(() => false),
  isIndeterminate: vi.fn(() => false),
  toggle: vi.fn(),
  selectAll: vi.fn(),
  clear: vi.fn(),
  forgetPreviews: vi.fn(),
  deleteSelected: vi.fn(() => of([])),
};

/**
 * Stubs `AppConfigService` so `AppExtensionsService` — which browse now injects to
 * resolve its `documentList` columns — does not drag `HttpClient` into every spec
 * in this file. Same shape as `selection-topbar.component.spec.ts`, the other slot
 * consumer, and it doubles as the handle a test uses to drive the manifest.
 */
const manifest = signal<{ extensionLayers: readonly unknown[] }>({ extensionLayers: [] });

describe('BrowseComponent', () => {
  let component: BrowseComponent;
  let fixture: ComponentFixture<BrowseComponent>;
  let toast: { show: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let dialogOpenSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    toast = { show: vi.fn(), error: vi.fn() };
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    dialogOpenSpy = vi.fn(() => ({ afterClosed: () => of(false) }));
    vi.clearAllMocks();
    mockDocumentDetailService.getDocumentPermissions.mockReturnValue(EMPTY);
    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), testTranslateModule(), BrowseComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        { provide: BrowseService, useValue: mockBrowseService },
        { provide: DocumentDetailService, useValue: mockDocumentDetailService },
        { provide: DirectoryService, useValue: mockDirectoryService },
        { provide: TagService, useValue: mockTagService },
        { provide: SelectionService, useValue: mockSelectionService },
        { provide: CURRENT_USERNAME, useValue: () => 'jdoe' },
        {
          provide: ADMIN_ACCESS_CHECKS,
          useValue: {
            isAdministrator: () => false,
            isPowerUser: () => false,
            hasAdministrationAccess: () => false,
          },
        },
        { provide: MatDialog, useValue: { open: dialogOpenSpy } },
        { provide: AppConfigService, useValue: { manifest } },
      ],
    })
      // Shallow-render: replace the complex Material/Satori template with a stub.
      // This avoids zone.js-tracked handles from 20+ imported modules that cause
      // the test process to hang in Node 20/Linux CI environments.
      .overrideComponent(BrowseComponent, {
        set: { imports: [], template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BrowseComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('requestContentRefresh reloads folder contents after clipboard copy/move', () => {
    const browseContext = TestBed.inject(BrowseContextService);
    const folder: NuxeoDocument = {
      uid: 'ws-1',
      title: 'Workspace',
      type: 'Workspace',
      path: '/default-domain/workspaces/ws-1',
      lastModified: '',
      properties: {},
      contextParameters: { permissions: ['AddChildren'] },
    };
    mockBrowseService.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [], totalSize: 0 }),
    );
    mockBrowseService.getFolderContext.mockReturnValue(of(folder));

    fixture.detectChanges();
    const callsAfterInit = mockBrowseService.getBrowseFolderContents.mock.calls.length;
    expect(callsAfterInit).toBeGreaterThan(0);

    browseContext.requestContentRefresh();
    fixture.detectChanges();

    expect(mockBrowseService.getBrowseFolderContents.mock.calls.length).toBeGreaterThan(
      callsAfterInit,
    );
  });

  it('notifyClipboardPasteComplete merges pasted documents into current folder listing', () => {
    const browseContext = TestBed.inject(BrowseContextService);
    const folder: NuxeoDocument = {
      uid: 'folder-1',
      title: 'Target Folder',
      type: 'Folder',
      path: '/default-domain/workspaces/folder-1',
      lastModified: '',
      properties: {},
      contextParameters: { permissions: ['AddChildren'] },
    };
    mockBrowseService.getBrowseFolderContents.mockReturnValue(
      of({ folder, entries: [], totalSize: 0 }),
    );
    mockBrowseService.getFolderContext.mockReturnValue(of(folder));

    fixture.detectChanges();
    component.currentDoc.set(folder);
    component.entries.set([]);
    component.totalSize.set(0);

    const pasted: NuxeoDocument = {
      uid: 'copy-1',
      title: 'Copied File',
      type: 'File',
      path: '/default-domain/workspaces/folder-1/copied-file',
      lastModified: '',
      properties: {},
    };

    browseContext.notifyClipboardPasteComplete({
      targetUid: 'folder-1',
      documents: [pasted],
      action: 'copy',
    });
    fixture.detectChanges();

    expect(component.entries().some((entry) => entry.uid === 'copy-1')).toBe(true);
    expect(component.totalSize()).toBe(1);
  });

  it('toggleSelection delegates to SelectionService with doc title (NXSAT-179)', () => {
    const doc: NuxeoDocument = {
      uid: 'doc-1',
      title: 'Quarterly Report',
      type: 'File',
      path: '/workspaces/quarterly-report',
      lastModified: '',
      properties: {},
    };
    component.entries.set([doc]);

    component.toggleSelection('doc-1');

    expect(mockSelectionService.toggle).toHaveBeenCalledWith(
      'doc-1',
      'Quarterly Report',
      null,
      'File',
    );
  });

  it('selectionAriaLabel includes document title for checkbox accessibility', () => {
    const doc: NuxeoDocument = {
      uid: 'doc-1',
      title: 'Quarterly Report',
      type: 'File',
      path: '/workspaces/quarterly-report',
      lastModified: '',
      properties: {},
    };

    expect(component.selectionAriaLabel(doc)).toBe('Select Quarterly Report');
  });

  it('openEditDialog refreshes browse tree after metadata update (NXSAT-164)', () => {
    const browseContext = TestBed.inject(BrowseContextService);
    const refreshSpy = vi.spyOn(browseContext, 'requestTreeRefresh');
    const updated: NuxeoDocument = {
      uid: 'domain-1',
      title: 'Domain Renamed',
      type: 'Domain',
      path: '/default-domain',
      lastModified: '',
      properties: {},
    };
    dialogOpenSpy.mockReturnValue({ afterClosed: () => of(updated) });
    component.currentDoc.set({
      uid: 'domain-1',
      title: 'Domain',
      type: 'Domain',
      path: '/default-domain',
      lastModified: '',
      properties: {},
      contextParameters: { permissions: ['Write'] },
    } as NuxeoDocument);

    component.openEditDialog();

    expect(refreshSpy).toHaveBeenCalled();
  });

  it('breadcrumbs use document title for the current folder segment', () => {
    component.currentDoc.set({
      uid: 'domain-2',
      title: 'Renamed Domain',
      type: 'Domain',
      path: '/Domain 2',
      lastModified: '',
      properties: {},
    });

    expect(component.breadcrumbs()).toEqual([
      { label: 'Root', href: '/browse' },
      { label: 'Renamed Domain' },
    ]);
  });

  it('breadcrumbs do not throw when a path segment contains a literal percent sign', () => {
    component.currentDoc.set({
      uid: 'folder-1',
      title: 'Current Folder',
      type: 'Folder',
      path: '/100% done',
      lastModified: '',
      properties: {},
    });

    expect(() => component.breadcrumbs()).not.toThrow();
    expect(component.breadcrumbs()).toEqual([
      { label: 'Root', href: '/browse' },
      { label: 'Current Folder' },
    ]);
  });

  it('hides breadcrumbs for non-admins viewing another user personal workspace (NXSAT-204)', () => {
    component.currentDoc.set({
      uid: 'ws-other',
      title: 'alice workspace',
      type: 'Workspace',
      path: '/default-domain/UserWorkspaces/alice',
      lastModified: '',
      properties: {},
    });

    expect(component.showBreadcrumbs()).toBe(false);
  });

  it('shows breadcrumbs for non-admins in their own personal workspace (NXSAT-204)', () => {
    component.currentDoc.set({
      uid: 'ws-self',
      title: 'jdoe workspace',
      type: 'Workspace',
      path: '/default-domain/UserWorkspaces/jdoe',
      lastModified: '',
      properties: {},
    });

    expect(component.showBreadcrumbs()).toBe(true);
  });

  it('blocks deleting a Collections folder that still has child collections (NXSAT-204)', () => {
    component.currentDoc.set({
      uid: 'cols-root',
      title: 'Collections',
      type: 'Collections',
      path: '/default-domain/UserWorkspaces/jdoe/Collections',
      lastModified: '',
      properties: {},
      contextParameters: { permissions: ['Everything'] },
    } as NuxeoDocument);
    component.entries.set([
      {
        uid: 'col-1',
        title: 'My Collection',
        type: 'Collection',
        path: '/default-domain/UserWorkspaces/jdoe/Collections/my-collection',
        lastModified: '',
        properties: {},
      },
    ]);

    component.deleteDocument();

    expect(dialogOpenSpy).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      'Remove all collections from this folder before deleting it.',
      { duration: 5000 },
    );
  });

  it('blocks deleting a Collections folder when collections exist but are filtered out of the view', () => {
    component.currentDoc.set({
      uid: 'cols-root',
      title: 'Collections',
      type: 'Collections',
      path: '/default-domain/UserWorkspaces/jdoe/Collections',
      lastModified: '',
      properties: {},
      contextParameters: { permissions: ['Everything'] },
    } as NuxeoDocument);
    component.entries.set([
      {
        uid: 'col-1',
        title: 'My Collection',
        type: 'Collection',
        path: '/default-domain/UserWorkspaces/jdoe/Collections/my-collection',
        lastModified: '',
        properties: {},
      },
    ]);
    component.filterType.set('Folder');

    component.deleteDocument();

    expect(dialogOpenSpy).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      'Remove all collections from this folder before deleting it.',
      { duration: 5000 },
    );
  });

  it('allows deleting a Collections folder when only non-collection children are listed', () => {
    component.currentDoc.set({
      uid: 'cols-root',
      title: 'Collections',
      type: 'Collections',
      path: '/default-domain/UserWorkspaces/jdoe/Collections',
      lastModified: '',
      properties: {},
      contextParameters: { permissions: ['Remove'] },
    } as NuxeoDocument);
    component.entries.set([
      {
        uid: 'folder-1',
        title: 'Notes',
        type: 'Folder',
        path: '/default-domain/UserWorkspaces/jdoe/Collections/notes',
        lastModified: '',
        properties: {},
      },
    ]);

    component.deleteDocument();

    expect(mockBrowseService.hasChildCollections).toHaveBeenCalledWith('cols-root');
    expect(dialogOpenSpy).toHaveBeenCalled();
  });

  it('blocks deleting a Collections folder when child collections exist only on the server (NXSAT-204)', () => {
    mockBrowseService.hasChildCollections.mockReturnValueOnce(of(true));
    component.currentDoc.set({
      uid: 'cols-root',
      title: 'Collections',
      type: 'Collections',
      path: '/default-domain/UserWorkspaces/jdoe/Collections',
      lastModified: '',
      properties: {},
      contextParameters: { permissions: ['Everything'] },
    } as NuxeoDocument);
    component.entries.set([]);

    component.deleteDocument();

    expect(mockBrowseService.hasChildCollections).toHaveBeenCalledWith('cols-root');
    expect(dialogOpenSpy).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      'Remove all collections from this folder before deleting it.',
      { duration: 5000 },
    );
  });

  it('onRowClick opens collection view for Collection documents (Web UI parity)', () => {
    const navigateSpy = vi.spyOn(component['router'], 'navigateByUrl');
    component.onRowClick({
      uid: 'col-1',
      title: 'My Collection',
      type: 'Collection',
      path: '/default-domain/UserWorkspaces/jdoe/Collections/my-collection',
      lastModified: '',
      properties: {},
    });

    expect(navigateSpy).toHaveBeenCalledWith('/collections/col-1');
  });

  it('openEditDialog opens Edit Collection dialog when a single collection is selected', () => {
    const collection: NuxeoDocument = {
      uid: 'col-1',
      title: 'My Collection',
      type: 'Collection',
      path: '/default-domain/UserWorkspaces/jdoe/Collections/my-collection',
      lastModified: '',
      properties: {},
    };
    mockSelectionService.selectedIds.mockReturnValue(new Set(['col-1']));
    mockSelectionService.selectedCount.mockReturnValue(1);
    component.entries.set([collection]);
    mockDocumentDetailService.getFullDocument.mockReturnValue(
      of({
        ...collection,
        contextParameters: { permissions: ['WriteProperties'] },
      } as NuxeoDocument),
    );
    dialogOpenSpy.mockReturnValue({ afterClosed: () => of(undefined) });

    component.openEditDialog();

    expect(mockDocumentDetailService.getFullDocument).toHaveBeenCalledWith('col-1');
    expect(dialogOpenSpy).toHaveBeenCalled();
  });

  it('singleSelectedEntry resolves from unfiltered entries when filters hide the selection', () => {
    const collection: NuxeoDocument = {
      uid: 'col-hidden',
      title: 'Hidden Collection',
      type: 'Collection',
      path: '/default-domain/UserWorkspaces/jdoe/Collections/hidden',
      lastModified: '',
      properties: {},
      contextParameters: { permissions: ['WriteProperties'] },
    };
    mockSelectionService.selectedIds.mockReturnValue(new Set(['col-hidden']));
    mockSelectionService.selectedCount.mockReturnValue(1);
    component.entries.set([collection]);
    component.filterText.set('does-not-match');

    expect(component.filteredEntries()).toHaveLength(0);
    expect(component.singleSelectedEntry()?.uid).toBe('col-hidden');
    expect(component.showHeaderEdit()).toBe(true);
  });

  it('deleteCollectionEntry trashes the collection after confirmation', () => {
    const collection: NuxeoDocument = {
      uid: 'col-2',
      title: 'Archive',
      type: 'Collection',
      path: '/default-domain/UserWorkspaces/jdoe/Collections/archive',
      lastModified: '',
      properties: {},
    };
    mockDocumentDetailService.getFullDocument.mockReturnValue(
      of({
        ...collection,
        contextParameters: { permissions: ['Remove'] },
      } as NuxeoDocument),
    );
    mockDocumentDetailService.trashDocument.mockReturnValue(of({ uid: 'col-2' } as NuxeoDocument));
    dialogOpenSpy.mockReturnValue({ afterClosed: () => of(true) });
    const refreshSpy = vi.spyOn(TestBed.inject(BrowseContextService), 'requestTreeRefresh');
    const loadSpy = vi.spyOn(component, 'loadContent');

    component.deleteCollectionEntry(collection);

    expect(mockDocumentDetailService.trashDocument).toHaveBeenCalledWith('col-2');
    expect(refreshSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalled();
    expect(mockSelectionService.clear).toHaveBeenCalled();
  });

  it('hasCollectionEntryActions hides menu when permissions enricher denies both actions', () => {
    const collection = {
      uid: 'col-3',
      title: 'Read-only',
      type: 'Collection',
      path: '/collections/read-only',
      lastModified: '',
      properties: {},
      contextParameters: { permissions: ['Read'] },
    } as NuxeoDocument;

    expect(component.hasCollectionEntryActions(collection)).toBe(false);
    expect(component.canEditCollectionEntry(collection)).toBe(false);
    expect(component.canDeleteCollectionEntry(collection)).toBe(false);
  });

  it('openEditCollectionDialog shows permission denied when collection load returns 403', () => {
    const collection: NuxeoDocument = {
      uid: 'col-4',
      title: 'Locked',
      type: 'Collection',
      path: '/collections/locked',
      lastModified: '',
      properties: {},
    };
    mockDocumentDetailService.getFullDocument.mockReturnValue(throwError(() => ({ status: 403 })));

    component.openEditCollectionDialog(collection);

    expect(toast.error).toHaveBeenCalledWith(
      TestBed.inject(TranslateService).instant(PERMISSION_DENIED_KEY),
    );
    expect(dialogOpenSpy).not.toHaveBeenCalled();
  });

  it('deleteCollectionEntry shows permission denied when trash returns 403', () => {
    const collection: NuxeoDocument = {
      uid: 'col-5',
      title: 'Archive',
      type: 'Collection',
      path: '/collections/archive',
      lastModified: '',
      properties: {},
    };
    mockDocumentDetailService.getFullDocument.mockReturnValue(
      of({
        ...collection,
        contextParameters: { permissions: ['Remove'] },
      } as NuxeoDocument),
    );
    mockDocumentDetailService.trashDocument.mockReturnValue(throwError(() => ({ status: 403 })));
    dialogOpenSpy.mockReturnValue({ afterClosed: () => of(true) });

    component.deleteCollectionEntry(collection);

    expect(toast.error).toHaveBeenCalledWith(
      TestBed.inject(TranslateService).instant(PERMISSION_DENIED_KEY),
    );
  });

  it('deleteDocument shows permission denied when single-item trash returns 403', () => {
    mockSelectionService.selectedCount.mockReturnValue(0);
    component.currentDoc.set({
      uid: 'file-1',
      title: 'File',
      type: 'File',
      path: '/workspaces/file-1',
      lastModified: '',
      properties: {},
      contextParameters: { permissions: ['Remove'] },
    } as NuxeoDocument);
    mockDocumentDetailService.trashDocument.mockReturnValue(throwError(() => ({ status: 403 })));
    dialogOpenSpy.mockReturnValue({ afterClosed: () => of(true) });

    component.deleteDocument();

    expect(toast.error).toHaveBeenCalledWith(
      TestBed.inject(TranslateService).instant(PERMISSION_DENIED_KEY),
    );
  });

  it('deleteDocument confirms bulk trash for selected children, not the browsed folder', () => {
    mockSelectionService.selectedCount.mockReturnValue(3);
    mockSelectionService.selectedIds.mockReturnValue(new Set(['doc-1', 'doc-2', 'doc-3']));
    mockDocumentDetailService.getFullDocument.mockImplementation((uid: string) =>
      of({
        uid,
        title: uid,
        type: 'File',
        path: `/workspaces/${uid}`,
        lastModified: '',
        properties: {},
        contextParameters: { permissions: ['Remove'] },
      } as NuxeoDocument),
    );
    component.currentDoc.set({
      uid: 'folder-1',
      title: 'Akshitha',
      type: 'Workspace',
      path: '/workspaces/Akshitha',
      lastModified: '',
      properties: {},
      contextParameters: { permissions: ['Everything'] },
    } as NuxeoDocument);

    component.deleteDocument();

    expect(dialogOpenSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        // Resolved through the same service the component uses, so this asserts the BULK shape
        // was chosen for three selected children rather than pinning any English wording — the
        // strings now come from the catalogue and are not this test's subject.
        data: trashSelectedDocumentsConfirmData(3, (key, params) =>
          TestBed.inject(TranslateService).instant(key, params),
        ),
      }),
    );
    expect(mockDocumentDetailService.trashDocument).not.toHaveBeenCalled();
  });

  it('deleteSelectedDocuments reuses listed entries that already include permissions', () => {
    mockSelectionService.selectedCount.mockReturnValue(1);
    mockSelectionService.selectedIds.mockReturnValue(new Set(['doc-1']));
    component.entries.set([
      {
        uid: 'doc-1',
        title: 'File',
        type: 'File',
        path: '/workspaces/doc-1',
        lastModified: '',
        properties: {},
        contextParameters: { permissions: ['Remove'] },
      } as NuxeoDocument,
    ]);
    mockDocumentDetailService.getFullDocument.mockClear();
    mockDocumentDetailService.trashDocument.mockReturnValue(of({ uid: 'doc-1' } as NuxeoDocument));
    dialogOpenSpy.mockReturnValue({ afterClosed: () => of(true) });

    component.deleteDocument();

    expect(mockDocumentDetailService.getFullDocument).not.toHaveBeenCalled();
    expect(mockDocumentDetailService.trashDocument).toHaveBeenCalledWith('doc-1');
  });

  it('deleteSelectedDocuments reports items that could not be loaded', () => {
    mockSelectionService.selectedCount.mockReturnValue(2);
    mockSelectionService.selectedIds.mockReturnValue(new Set(['doc-1', 'doc-2']));
    component.entries.set([
      {
        uid: 'doc-1',
        title: 'File 1',
        type: 'File',
        path: '/workspaces/doc-1',
        lastModified: '',
        properties: {},
        contextParameters: { permissions: ['Remove'] },
      } as NuxeoDocument,
    ]);
    mockDocumentDetailService.getFullDocument.mockImplementation((uid: string) =>
      uid === 'doc-2' ? throwError(() => new Error('not found')) : EMPTY,
    );
    mockDocumentDetailService.trashDocument.mockReturnValue(of({ uid: 'doc-1' } as NuxeoDocument));
    dialogOpenSpy.mockReturnValue({ afterClosed: () => of(true) });

    component.deleteDocument();

    expect(toast.error).toHaveBeenCalledWith('Skipped 1 item that could not be loaded', {
      duration: 5000,
    });
    expect(mockDocumentDetailService.trashDocument).toHaveBeenCalledWith('doc-1');
    expect(toast.show).toHaveBeenCalledWith('Moved to trash');
  });

  it('deleteSelectedDocuments blocks when all selected documents fail to load', () => {
    mockSelectionService.selectedCount.mockReturnValue(2);
    mockSelectionService.selectedIds.mockReturnValue(new Set(['doc-1', 'doc-2']));
    component.entries.set([]);
    mockDocumentDetailService.getFullDocument.mockReturnValue(
      throwError(() => new Error('not found')),
    );
    dialogOpenSpy.mockReturnValue({ afterClosed: () => of(true) });

    component.deleteDocument();

    expect(toast.error).toHaveBeenCalledWith('Failed to load selected documents for deletion', {
      duration: 5000,
    });
    expect(mockDocumentDetailService.trashDocument).not.toHaveBeenCalled();
  });

  it('sendNotificationEmail shows success snackbar (NXSAT-159)', () => {
    mockDocumentDetailService.sendNotificationEmailForPermission.mockReturnValue(
      of(doc({ uid: 'doc-1' })),
    );
    component.currentDoc.set({
      uid: 'doc-1',
      title: 'File',
      type: 'File',
      path: '/file',
      lastModified: '',
      properties: {},
    });

    component.sendNotificationEmail({
      id: 'ace-1',
      username: 'user-readonly01',
      externalUser: false,
      permission: 'Read',
      granted: true,
      creator: null,
      begin: null,
      end: null,
      status: 'effective',
    });

    expect(mockDocumentDetailService.sendNotificationEmailForPermission).toHaveBeenCalledWith(
      'doc-1',
      'ace-1',
    );
    expect(toast.show).toHaveBeenCalledWith('Notification email sent');
  });

  it('sendNotificationEmail shows SMTP guidance on mail failure (NXSAT-159)', () => {
    mockDocumentDetailService.sendNotificationEmailForPermission.mockReturnValue(
      throwError(() => ({ error: { message: 'An error occurred while sending a mail' } })),
    );
    component.currentDoc.set({
      uid: 'doc-1',
      title: 'File',
      type: 'File',
      path: '/file',
      lastModified: '',
      properties: {},
    });

    component.sendNotificationEmail({
      id: 'ace-1',
      username: 'user-readonly01',
      externalUser: false,
      permission: 'Read',
      granted: true,
      creator: null,
      begin: null,
      end: null,
      status: 'effective',
    });

    expect(toast.error).toHaveBeenCalledWith(
      'Notification email could not be sent. Configure outbound mail (SMTP) on the Nuxeo server.',
      { duration: 7000 },
    );
  });

  it('aceTimeFrame shows date-based label when ACL has begin and end', () => {
    const ace: NuxeoAce = {
      id: 'ace-1',
      username: 'members',
      externalUser: false,
      permission: 'Read',
      granted: true,
      creator: 'Administrator',
      begin: '2026-07-01T00:00:00.000Z',
      end: '2026-12-31T23:59:59.000Z',
      status: 'effective',
    };

    expect(component.aceTimeFrame(ace)).not.toBe('Permanent');
    // Both dates present resolves `permissions.time-frame.range`, which separates them rather
    // than joining them with English connectives.
    //
    // The years are pinned to 2026 deliberately. An earlier version left them open, reasoning that
    // `23:59:59Z` lands in the next year east of UTC -- true before `formatAceDateRange` formatted
    // in UTC, and false after. Leaving them open would let the UTC round-trip regress without this
    // test noticing, which is the whole thing that guard exists to prevent.
    expect(component.aceTimeFrame(ace)).toMatch(/^\w{3} \d{2}, 2026 - \w{3} \d{2}, 2026$/);
  });

  it('canManageCurrentPermissions is false for read-only users (NXSAT-162)', () => {
    component.currentDoc.set({
      uid: 'doc-1',
      title: 'File',
      type: 'File',
      path: '/file',
      lastModified: '',
      properties: {},
      contextParameters: { permissions: ['Read'] },
    } as NuxeoDocument);

    expect(component.canManageCurrentPermissions()).toBe(false);
  });

  it('onTabChange loads permissions via getDocumentPermissions', () => {
    const permissionsDoc = doc({
      uid: 'root-uid',
      contextParameters: {
        acls: [{ name: 'local', aces: [] }],
      },
    });
    mockDocumentDetailService.getDocumentPermissions.mockReturnValue(of(permissionsDoc));

    component.currentDoc.set({
      uid: 'root-uid',
      title: 'Root',
      type: 'Root',
      path: '/',
      lastModified: '2026-07-01T00:00:00.000Z',
      properties: {},
      contextParameters: { favorites: { isFavorite: false } },
    } as NuxeoDocument);

    component.onTabChange(1);

    expect(mockDocumentDetailService.getDocumentPermissions).toHaveBeenCalledWith('root-uid');
    expect(component.permissionsLoaded()).toBe(true);
    expect(component.permissionsLoading()).toBe(false);
    expect(component.currentDoc()?.contextParameters?.['favorites']).toEqual({ isFavorite: false });
    expect(component.currentDoc()?.contextParameters?.['acls']).toEqual([
      { name: 'local', aces: [] },
    ]);
  });

  it('retries permissions load after a failed fetch when the tab is reopened', () => {
    mockDocumentDetailService.getDocumentPermissions
      .mockReturnValueOnce(throwError(() => new Error('network error')))
      .mockReturnValueOnce(
        of(
          doc({
            uid: 'root-uid',
            contextParameters: { acls: [{ name: 'local', aces: [] }] },
          }),
        ),
      );

    component.currentDoc.set({
      uid: 'root-uid',
      title: 'Root',
      type: 'Root',
      path: '/',
      lastModified: '2026-07-01T00:00:00.000Z',
      properties: {},
      contextParameters: {},
    } as NuxeoDocument);

    component.onTabChange(1);
    component.onTabChange(0);
    component.onTabChange(1);

    expect(mockDocumentDetailService.getDocumentPermissions).toHaveBeenCalledTimes(2);
    expect(component.permissionsLoaded()).toBe(true);
    expect(component.permissionsLoading()).toBe(false);
  });
});
