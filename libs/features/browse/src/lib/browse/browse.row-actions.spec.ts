import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { EMPTY, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  PACKAGED_ROW_ACTIONS,
  provideSatoriExtensions,
  type ExtensionActionDescriptor,
} from '@nuxeo/satori-platform/extensions';
import {
  BrowseContextService,
  BrowseService,
  ContentModelService,
  DirectoryService,
  DocumentDetailService,
  DocumentImportService,
  TagService,
  type NuxeoContentModel,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  NxsFolderPickerDialogComponent,
  NxsRenameDialogComponent,
  NxsToastService,
} from '@nuxeo/satori-platform/components';
import { ConfirmDialogComponent } from '@nuxeo/satori-platform/ui';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

import { BrowseComponent } from './browse';

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

const ALL = ['Read', 'Write', 'Remove', 'AddChildren'];

function doc(overrides: Partial<NuxeoDocument> & Pick<NuxeoDocument, 'uid'>): NuxeoDocument {
  return {
    title: overrides.uid,
    type: 'File',
    path: `/default-domain/workspaces/ws-1/${overrides.uid}`,
    lastModified: '2026-01-01T00:00:00.000Z',
    properties: {},
    contextParameters: { permissions: ALL },
    ...overrides,
  } as NuxeoDocument;
}

const folder = doc({
  uid: 'ws-1',
  title: 'Workspace',
  type: 'Workspace',
  path: '/default-domain/workspaces/ws-1',
  facets: ['Folderish'],
});
const report = doc({
  uid: 'report',
  title: 'Report',
  properties: { 'file:content': { name: 'report.pdf', 'mime-type': 'application/pdf' } },
});
const note = doc({ uid: 'note', title: 'Note', type: 'Note' });
const readOnly = doc({
  uid: 'ro',
  title: 'Read only',
  contextParameters: { permissions: ['Read'] },
});
const subfolder = doc({ uid: 'sub', title: 'Sub', type: 'Folder', facets: ['Folderish'] });
/** A section's publication: Nuxeo marks it `Immutable`, and its permissions still list Write. */
const publication = doc({
  uid: 'pub',
  title: 'Published report',
  isProxy: true,
  facets: ['Immutable', 'Versionable', 'Publishable'],
});

describe('BrowseComponent — row actions', () => {
  let fixture: ComponentFixture<BrowseComponent>;
  let component: BrowseComponent;
  let dialogResult: unknown;
  const dialogOpen = vi.fn();
  const browse = {
    getByPath: vi.fn(() => of(folder)),
    // Never resolves on purpose: the folder scan stays pending, so the toolbar filters fall back to
    // the loaded page exactly as they did before cross-folder filtering existed.
    getBrowseFolderTypes: vi.fn((): ReturnType<BrowseService['getBrowseFolderTypes']> => EMPTY),
    getBrowseFolderContents: vi.fn(() =>
      of({ folder, entries: [report, note, readOnly, subfolder, publication], totalSize: 5 }),
    ),
    getFolderContext: vi.fn(() => of(folder)),
    hasChildCollections: vi.fn(() => of(false)),
    copyDocuments: vi.fn(() => of([report])),
    moveDocuments: vi.fn(() => of([report])),
    getTrashedChildren: vi.fn(() => EMPTY),
  };
  const detail = {
    getFullDocument: vi.fn(() => EMPTY),
    getDocumentPermissions: vi.fn(() => EMPTY),
    fetchThumbnail: vi.fn(() => EMPTY),
    fetchBlob: vi.fn(() => of(new Blob(['x']))),
    getAuditLog: vi.fn(() => of({ entries: [], totalSize: 0 })),
    trashDocument: vi.fn(() => of(undefined)),
  };
  const toast = { show: vi.fn(), error: vi.fn() };
  const importService = {
    importFiles: vi.fn<DocumentImportService['importFiles']>(),
    importFilesWithProperties: vi.fn<DocumentImportService['importFilesWithProperties']>(),
  };
  const contentModel = {
    getContentModel: vi.fn<ContentModelService['getContentModel']>(() =>
      of({ doctypes: {}, facets: [], schemas: [] }),
    ),
  };

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    dialogResult = undefined;
    dialogOpen.mockImplementation(() => ({ afterClosed: () => of(dialogResult) }));
    // Both are also provided by the component and the modules it imports, which a root provider
    // would not reach.
    TestBed.overrideProvider(MatDialog, { useValue: { open: dialogOpen } });
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
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
            getEventTypes: () => of([]),
            getEventCategories: () => of([]),
            getEntries: () => of([]),
            getAllL10nEntries: () => of([]),
          },
        },
        { provide: TagService, useValue: { searchTags: () => of([]) } },
        { provide: DocumentImportService, useValue: importService },
        { provide: ContentModelService, useValue: contentModel },
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        provideSatoriExtensions({ slots: { [EXTENSION_SLOTS.rowActions]: PACKAGED_ROW_ACTIONS } }),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BrowseComponent);
    component = fixture.componentInstance;
    await settle();
  });

  afterEach(() => fixture.destroy());

  const menu = (uid: string): string[] =>
    (component.rowMenus()[uid] ?? []).map((entry) => entry.id);
  const run = (id: string, document: NuxeoDocument) =>
    component.onRowAction({ action: { id, label: id }, document });

  it('offers each row the actions its own document allows', () => {
    expect(menu('report')).toEqual([
      'app.rowActions.download',
      'app.rowActions.rename',
      'app.rowActions.copyTo',
      'app.rowActions.moveTo',
      'app.rowActions.delete',
    ]);
    // A Note holds no file; a read-only document can only be copied.
    expect(menu('note')).not.toContain('app.rowActions.download');
    expect(menu('ro')).toEqual(['app.rowActions.copyTo']);
  });

  it('offers no Rename on an Immutable row, as Edit is not offered on one', () => {
    expect(menu('pub')).not.toContain('app.rowActions.rename');
    expect(menu('pub')).toContain('app.rowActions.copyTo');
  });

  it('refuses to rename an Immutable row even when a manifest clears the rule', () => {
    component.renameEntry(publication);
    expect(dialogOpen).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('renders the menu on the row, named for it, and runs the chosen entry', async () => {
    const trigger = fixture.nativeElement.querySelector(
      'tr[data-uid="report"] nxs-action-menu button',
    ) as HTMLButtonElement;
    expect(trigger.getAttribute('aria-label')).toBe('Actions for Report');
    trigger.click();
    await settle();
    (document.querySelector('[data-action-id="app.rowActions.rename"]') as HTMLElement).click();
    expect(dialogOpen).toHaveBeenCalledWith(NxsRenameDialogComponent, {
      data: { documentId: 'report', title: 'Report' },
    });
  });

  it('downloads the row’s file under its own name, and revokes the URL', () => {
    const originals = {
      click: HTMLAnchorElement.prototype.click,
      create: URL.createObjectURL,
      revoke: URL.revokeObjectURL,
    };
    const downloads: string[] = [];
    const revoked: string[] = [];
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    };
    URL.createObjectURL = () => 'blob:report';
    URL.revokeObjectURL = (url: string) => revoked.push(url);
    try {
      run('app.rowActions.download', report);
      expect(detail.fetchBlob).toHaveBeenCalledWith('report', { clientReason: 'download' });
      expect(downloads).toEqual(['report.pdf']);
      expect(revoked).toEqual(['blob:report']);
    } finally {
      HTMLAnchorElement.prototype.click = originals.click;
      URL.createObjectURL = originals.create;
      URL.revokeObjectURL = originals.revoke;
    }
  });

  it('says a refused download is a permission problem', () => {
    detail.fetchBlob.mockReturnValueOnce(throwError(() => ({ status: 403 })));
    run('app.rowActions.download', report);
    expect(toast.error).toHaveBeenCalledWith('You do not have permission to perform this action');
  });

  it('renames, then reloads the folder and the tree', () => {
    const tree = vi.spyOn(TestBed.inject(BrowseContextService), 'requestTreeRefresh');
    dialogResult = { ...report, title: 'Annual report' };
    browse.getBrowseFolderContents.mockClear();
    run('app.rowActions.rename', report);
    expect(toast.show).toHaveBeenCalledWith('Renamed to "Annual report"');
    expect(tree).toHaveBeenCalled();
    expect(browse.getBrowseFolderContents).toHaveBeenCalled();
  });

  it('does nothing when the rename is cancelled', () => {
    browse.getBrowseFolderContents.mockClear();
    run('app.rowActions.rename', report);
    expect(toast.show).not.toHaveBeenCalled();
    expect(browse.getBrowseFolderContents).not.toHaveBeenCalled();
  });

  it('copies to the folder chosen, never offering a folder inside itself', () => {
    dialogResult = { uid: 'dest', path: '/default-domain/workspaces/dest', title: 'Dest' };
    run('app.rowActions.copyTo', subfolder);
    expect(dialogOpen).toHaveBeenCalledWith(NxsFolderPickerDialogComponent, {
      data: {
        heading: 'Copy "Sub" to',
        confirmLabel: 'Copy here',
        initialPath: '/default-domain/workspaces/ws-1',
        excludePath: '/default-domain/workspaces/ws-1/sub',
        currentParentPath: undefined,
      },
    });
    expect(browse.copyDocuments).toHaveBeenCalledWith(['sub'], 'dest');
    expect(toast.show).toHaveBeenCalledWith('Copied "Sub" to Dest');
  });

  it('moves to the folder chosen, not offering the one it is already in', () => {
    dialogResult = { uid: 'dest', path: '/default-domain/workspaces/dest', title: 'Dest' };
    run('app.rowActions.moveTo', report);
    const data = dialogOpen.mock.calls[0][1].data;
    expect(data.currentParentPath).toBe('/default-domain/workspaces/ws-1');
    expect(data.excludePath).toBeUndefined();
    expect(browse.moveDocuments).toHaveBeenCalledWith(['report'], 'dest');
    expect(toast.show).toHaveBeenCalledWith('Moved "Report" to Dest');
  });

  it('says a refused move is refused, and a failed one failed', () => {
    dialogResult = { uid: 'dest', path: '/x', title: 'X' };
    browse.moveDocuments.mockReturnValueOnce(throwError(() => ({ status: 403 })));
    run('app.rowActions.moveTo', report);
    expect(toast.error).toHaveBeenLastCalledWith(
      'You do not have permission to perform this action',
    );

    browse.copyDocuments.mockReturnValueOnce(throwError(() => new Error('down')));
    run('app.rowActions.copyTo', report);
    expect(toast.error).toHaveBeenLastCalledWith('The document could not be copied.');
  });

  it('asks before moving a row to the trash, then trashes it', () => {
    dialogResult = true;
    run('app.rowActions.delete', report);
    expect(dialogOpen.mock.calls[0][0]).toBe(ConfirmDialogComponent);
    expect(detail.trashDocument).toHaveBeenCalledWith('report');
    expect(toast.show).toHaveBeenCalledWith('Moved to trash');
  });

  it('trashes nothing when the confirmation is declined', () => {
    dialogResult = false;
    run('app.rowActions.delete', report);
    expect(detail.trashDocument).not.toHaveBeenCalled();
  });

  it('refuses to trash a Collections folder that still holds collections', () => {
    browse.hasChildCollections.mockReturnValueOnce(of(true));
    run('app.rowActions.delete', doc({ uid: 'cols', type: 'Collections', facets: ['Folderish'] }));
    expect(dialogOpen).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('runs a customer’s own row action with the row’s document in focus', () => {
    const custom: ExtensionActionDescriptor = { id: 'acme.rowActions.audit', label: 'Audit' };
    const seen: (string | undefined)[] = [];
    const registry = TestBed.inject(ExtensionActionRegistry);
    registry.register({
      'acme.rowActions.audit': { execute: (context) => seen.push(context.document?.uid) },
    });
    vi.spyOn(TestBed.inject(ExtensionActionRegistry), 'execute');
    const resolve = vi.spyOn(TestBed.inject(AppExtensionsService), 'resolve');
    resolve.mockReturnValue([custom]);
    run('acme.rowActions.audit', note);
    expect(seen).toEqual(['note']);
  });

  describe('files dropped on the list', () => {
    const scan = new File(['a'], 'scan.pdf', { type: 'application/pdf' });
    const memo = new File(['b'], 'memo.pdf', { type: 'application/pdf' });
    const photo = new File(['c'], 'photo.jpg', { type: 'image/jpeg' });

    /** The folder on screen, read with its allowed subtypes as `getFolderContext` returns it. */
    const allowing = (subtypes: string[]): NuxeoDocument => ({
      ...folder,
      contextParameters: { ...folder.contextParameters, subtypes },
    });
    /** Workspace, Section, Folder and a customer type extending File, as `/config/types` has them. */
    const MODEL: NuxeoContentModel = {
      doctypes: {
        File: { parent: 'Document', schemas: ['common', 'dublincore', 'file', 'files'] },
        RentalContract: { parent: 'File' },
        Folder: { parent: 'Document', facets: ['Folderish'], schemas: ['common', 'dublincore'] },
        Section: {
          parent: 'Folder',
          facets: ['Folderish', 'PublishSpace'],
          schemas: ['file', 'common', 'dublincore'],
        },
      },
      facets: [],
      schemas: [],
    };
    const sentTypes = (): string[] =>
      (importService.importFilesWithProperties.mock.lastCall?.[1] ?? []).map(
        (entry) => entry.docType,
      );

    beforeEach(() => {
      browse.getFolderContext.mockReturnValue(of(allowing(['File', 'Folder', 'Note', 'Picture'])));
      contentModel.getContentModel.mockReturnValue(of(MODEL));
    });

    afterEach(() => {
      browse.getFolderContext.mockReturnValue(of(folder));
      contentModel.getContentModel.mockReturnValue(of({ doctypes: {}, facets: [], schemas: [] }));
    });

    it('accepts a drop where the user may create content, named for the folder', () => {
      const list = fixture.nativeElement.querySelector('nxs-document-list');
      expect(component.canCreateContentHere()).toBe(true);
      expect(list).not.toBeNull();
    });

    it('uploads the dropped files into the folder on screen, each as a type it allows', () => {
      importService.importFilesWithProperties.mockImplementation((_path, _entries, options) => {
        options?.onProgress?.({ phase: 'uploading', percent: 75, fileIndex: 1, fileCount: 2 });
        return of([doc({ uid: 'd1' }), doc({ uid: 'd2' })]);
      });
      browse.getBrowseFolderContents.mockClear();

      component.uploadDropped([scan, photo]);

      expect(browse.getFolderContext).toHaveBeenLastCalledWith('/default-domain/workspaces/ws-1');
      expect(importService.importFilesWithProperties).toHaveBeenCalledWith(
        '/default-domain/workspaces/ws-1',
        [
          { file: scan, docType: 'File', properties: { 'dc:title': 'scan' } },
          { file: photo, docType: 'Picture', properties: { 'dc:title': 'photo' } },
        ],
        expect.objectContaining({ onProgress: expect.any(Function) }),
      );
      // `importFiles` sends File whatever the folder allows.
      expect(importService.importFiles).not.toHaveBeenCalled();
      expect(component.droppedUploads.items().map((item) => item.state)).toEqual(['done', 'done']);
      expect(toast.show).toHaveBeenCalledWith('Created 2 files.');
      expect(browse.getBrowseFolderContents).toHaveBeenCalled();
    });

    it('uploads each file as the File subtype a folder allows, where it allows no File', () => {
      browse.getFolderContext.mockReturnValue(of(allowing(['RentalContract', 'Folder'])));
      importService.importFilesWithProperties.mockReturnValue(of([doc({ uid: 'd1' })]));

      component.uploadDropped([scan, photo]);

      expect(sentTypes()).toEqual(['RentalContract', 'RentalContract']);
    });

    it('refuses a drop on a Section, saying why, and queues nothing', () => {
      browse.getFolderContext.mockReturnValue(of(allowing(['Section'])));

      component.uploadDropped([scan, memo]);

      expect(importService.importFilesWithProperties).not.toHaveBeenCalled();
      expect(importService.importFiles).not.toHaveBeenCalled();
      expect(component.droppedUploads.items()).toEqual([]);
      expect(toast.error).toHaveBeenCalledWith(
        'Files cannot be uploaded to Workspace, because it allows no document type that holds a file.',
      );

      // The retry has nothing to send either.
      component.runDroppedUploads();
      expect(importService.importFilesWithProperties).not.toHaveBeenCalled();
    });

    it('says the types could not be read, not that the folder takes no file, when the content model is refused', () => {
      browse.getFolderContext.mockReturnValue(of(allowing(['RentalContract', 'Folder'])));
      contentModel.getContentModel.mockReturnValue(throwError(() => new Error('500')));

      component.uploadDropped([scan]);

      expect(importService.importFilesWithProperties).not.toHaveBeenCalled();
      expect(component.droppedUploads.items()).toEqual([]);
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Could not load the document types'),
      );
    });

    it('still uploads a stock type the folder allows when the content model is refused', () => {
      contentModel.getContentModel.mockReturnValue(throwError(() => new Error('500')));
      importService.importFilesWithProperties.mockReturnValue(of([doc({ uid: 'd1' })]));

      component.uploadDropped([scan]);

      expect(sentTypes()).toEqual(['File']);
    });

    it("uploads nothing when the folder's types cannot be read, and says so", () => {
      browse.getFolderContext.mockReturnValue(throwError(() => ({ status: 403 })));

      component.uploadDropped([scan]);

      expect(importService.importFilesWithProperties).not.toHaveBeenCalled();
      expect(component.droppedUploads.items()).toEqual([]);
      expect(toast.error).toHaveBeenCalledWith('You do not have permission to perform this action');
    });

    it('says a refused upload is refused, and retries only what was not created, as the same type', () => {
      browse.getFolderContext.mockReturnValue(of(allowing(['RentalContract', 'Folder'])));
      importService.importFilesWithProperties.mockImplementationOnce((_path, _entries, options) => {
        options?.onProgress?.({ phase: 'creating', percent: 50, fileIndex: 0, fileCount: 2 });
        options?.onProgress?.({ phase: 'uploading', percent: 60, fileIndex: 1, fileCount: 2 });
        return throwError(() => ({ status: 403 }));
      });
      component.uploadDropped([scan, memo]);
      expect(toast.error).toHaveBeenCalledWith('You do not have permission to perform this action');
      expect(component.droppedUploads.items().map((item) => item.state)).toEqual([
        'done',
        'failed',
      ]);

      importService.importFilesWithProperties.mockReturnValueOnce(of([doc({ uid: 'd2' })]));
      component.runDroppedUploads();
      expect(importService.importFilesWithProperties).toHaveBeenLastCalledWith(
        '/default-domain/workspaces/ws-1',
        [{ file: memo, docType: 'RentalContract', properties: { 'dc:title': 'memo' } }],
        expect.anything(),
      );
    });

    it('turns away a second drop while the first still uploads', () => {
      importService.importFilesWithProperties.mockReturnValue(EMPTY);
      component.uploadDropped([scan]);
      component.uploadDropped([memo]);
      expect(importService.importFilesWithProperties).toHaveBeenCalledTimes(1);
      expect(toast.show).toHaveBeenCalledWith(
        'Wait for the files being uploaded to finish before dropping more.',
      );
    });

    it("turns away a second drop while the first's folder types are read", () => {
      const context = new Subject<NuxeoDocument>();
      browse.getFolderContext.mockReturnValue(context.asObservable());
      importService.importFilesWithProperties.mockReturnValue(of([doc({ uid: 'd1' })]));

      component.uploadDropped([scan]);
      component.uploadDropped([memo]);
      expect(toast.show).toHaveBeenCalledWith(
        'Wait for the files being uploaded to finish before dropping more.',
      );

      context.next(allowing(['File']));
      context.complete();
      expect(importService.importFilesWithProperties).toHaveBeenCalledTimes(1);
      expect(importService.importFilesWithProperties.mock.lastCall?.[1].map((e) => e.file)).toEqual(
        [scan],
      );

      // Done reading, so the next drop goes ahead.
      browse.getFolderContext.mockReturnValue(of(allowing(['File'])));
      component.uploadDropped([memo]);
      expect(importService.importFilesWithProperties).toHaveBeenCalledTimes(2);
    });

    it('turns away a drop whose types arrive while a retry of an earlier one uploads', () => {
      const report = new File(['d'], 'report.pdf', { type: 'application/pdf' });
      browse.getFolderContext.mockReturnValue(of(allowing(['RentalContract', 'Folder'])));
      importService.importFilesWithProperties.mockReturnValueOnce(
        throwError(() => ({ status: 500 })),
      );
      component.uploadDropped([scan]);
      expect(component.droppedUploads.items().map((item) => item.state)).toEqual(['failed']);

      // A second drop, whose folder's types are still being read when the first is retried.
      const context = new Subject<NuxeoDocument>();
      browse.getFolderContext.mockReturnValue(context.asObservable());
      component.uploadDropped([report]);
      importService.importFilesWithProperties.mockReturnValueOnce(EMPTY);
      component.runDroppedUploads();
      expect(component.droppedUploads.busy()).toBe(true);
      toast.show.mockClear();

      context.next(allowing(['File']));
      context.complete();

      expect(toast.show).toHaveBeenCalledWith(
        'Wait for the files being uploaded to finish before dropping more.',
      );
      // Nothing of the second drop is queued, and the retry keeps its own folder's types.
      expect(component.droppedUploads.items().map((item) => item.file)).toEqual([scan]);
      expect(importService.importFilesWithProperties).toHaveBeenCalledTimes(2);
      expect(sentTypes()).toEqual(['RentalContract']);
    });

    describe('while files of an earlier drop are still pending', () => {
      const report = new File(['d'], 'report.pdf', { type: 'application/pdf' });
      const other = {
        ...folder,
        uid: 'ws-2',
        title: 'Other',
        path: '/default-domain/workspaces/ws-2',
      } as NuxeoDocument;

      /** `scan` dropped on ws-1, which allows only RentalContract, and refused there. */
      function failInFirstFolder(): void {
        browse.getFolderContext.mockReturnValue(of(allowing(['RentalContract', 'Folder'])));
        importService.importFilesWithProperties.mockReturnValueOnce(
          throwError(() => ({ status: 500 })),
        );
        component.uploadDropped([scan]);
        expect(component.droppedUploads.items().map((item) => item.state)).toEqual(['failed']);
        toast.show.mockClear();
      }

      it('turns away a drop on another folder, and retries the file into its own folder, as its type', () => {
        failInFirstFolder();
        component.currentDoc.set(other);
        browse.getFolderContext.mockReturnValue(
          of({ ...other, contextParameters: { subtypes: ['File'] } }),
        );

        component.uploadDropped([report]);

        expect(toast.show).toHaveBeenCalledWith(
          'Retry or remove the files that could not be uploaded before dropping files on another folder.',
        );
        expect(component.droppedUploads.items().map((item) => item.file)).toEqual([scan]);
        expect(importService.importFilesWithProperties).toHaveBeenCalledTimes(1);

        importService.importFilesWithProperties.mockReturnValueOnce(of([doc({ uid: 'd1' })]));
        component.runDroppedUploads();
        expect(importService.importFilesWithProperties).toHaveBeenLastCalledWith(
          '/default-domain/workspaces/ws-1',
          [{ file: scan, docType: 'RentalContract', properties: { 'dc:title': 'scan' } }],
          expect.anything(),
        );
      });

      it('tells apart two folders whose names differ only in case', () => {
        failInFirstFolder();
        const sibling = {
          ...folder,
          uid: 'ws-1-upper',
          title: 'WS-1',
          path: '/default-domain/workspaces/WS-1',
        } as NuxeoDocument;
        component.currentDoc.set(sibling);

        component.uploadDropped([report]);

        expect(toast.show).toHaveBeenCalledWith(
          'Retry or remove the files that could not be uploaded before dropping files on another folder.',
        );
        expect(importService.importFilesWithProperties).toHaveBeenCalledTimes(1);
      });

      it('takes a drop on another folder once the pending file is removed', () => {
        failInFirstFolder();
        component.droppedUploads.remove(component.droppedUploads.items()[0].id);
        component.currentDoc.set(other);
        browse.getFolderContext.mockReturnValue(
          of({ ...other, contextParameters: { subtypes: ['File'] } }),
        );
        importService.importFilesWithProperties.mockReturnValueOnce(of([doc({ uid: 'd2' })]));

        component.uploadDropped([report]);

        expect(importService.importFilesWithProperties).toHaveBeenLastCalledWith(
          '/default-domain/workspaces/ws-2',
          [{ file: report, docType: 'File', properties: { 'dc:title': 'report' } }],
          expect.anything(),
        );
      });

      it('takes the pending file along with a drop on the same folder', () => {
        failInFirstFolder();
        importService.importFilesWithProperties.mockReturnValueOnce(
          of([doc({ uid: 'd1' }), doc({ uid: 'd2' })]),
        );

        component.uploadDropped([report]);

        expect(importService.importFilesWithProperties).toHaveBeenLastCalledWith(
          '/default-domain/workspaces/ws-1',
          [
            expect.objectContaining({ file: scan, docType: 'RentalContract' }),
            expect.objectContaining({ file: report, docType: 'RentalContract' }),
          ],
          expect.anything(),
        );
      });
    });

    it('uploads nothing where the user may not create content', () => {
      component.currentDoc.set({
        ...folder,
        contextParameters: { permissions: ['Read'] },
      } as NuxeoDocument);
      component.uploadDropped([scan]);
      expect(importService.importFilesWithProperties).not.toHaveBeenCalled();
      expect(importService.importFiles).not.toHaveBeenCalled();
    });
  });
});
