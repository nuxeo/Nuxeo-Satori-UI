import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { EMPTY, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AppConfigService } from '@nuxeo-satori/platform/app-config';
import {
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  PACKAGED_ROW_ACTIONS,
  provideSatoriExtensions,
  type ExtensionActionDescriptor,
} from '@nuxeo-satori/platform/extensions';
import {
  BrowseContextService,
  BrowseService,
  DirectoryService,
  DocumentDetailService,
  DocumentImportService,
  TagService,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';
import {
  NxsFolderPickerDialogComponent,
  NxsRenameDialogComponent,
  NxsToastService,
} from '@nuxeo-satori/platform/components';
import { ConfirmDialogComponent } from '@nuxeo-satori/platform/ui';
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

describe('BrowseComponent — row actions', () => {
  let fixture: ComponentFixture<BrowseComponent>;
  let component: BrowseComponent;
  let dialogResult: unknown;
  const dialogOpen = vi.fn();
  const browse = {
    getByPath: vi.fn(() => of(folder)),
    getBrowseFolderContents: vi.fn(() =>
      of({ folder, entries: [report, note, readOnly, subfolder], totalSize: 4 }),
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
  const importService = { importFiles: vi.fn() };

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
        provideHttpClient(),
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
    const resolve = vi.spyOn(
      (component as unknown as { extensions: { resolve: (...args: unknown[]) => unknown } })
        .extensions,
      'resolve',
    );
    resolve.mockReturnValue([custom]);
    run('acme.rowActions.audit', note);
    expect(seen).toEqual(['note']);
  });

  describe('files dropped on the list', () => {
    const scan = new File(['a'], 'scan.pdf');
    const memo = new File(['b'], 'memo.pdf');

    it('accepts a drop where the user may create content, named for the folder', () => {
      const list = fixture.nativeElement.querySelector('nxs-document-list');
      expect(component.canCreateContentHere()).toBe(true);
      expect(list).not.toBeNull();
    });

    it('uploads the dropped files into the folder on screen, one queue entry each', () => {
      importService.importFiles.mockImplementation((_path, _files, options) => {
        options?.onProgress?.({ phase: 'uploading', percent: 75, fileIndex: 1, fileCount: 2 });
        return of([doc({ uid: 'd1' }), doc({ uid: 'd2' })]);
      });
      browse.getBrowseFolderContents.mockClear();

      component.uploadDropped([scan, memo]);

      expect(importService.importFiles).toHaveBeenCalledWith(
        '/default-domain/workspaces/ws-1',
        [scan, memo],
        expect.objectContaining({ onProgress: expect.any(Function) }),
      );
      expect(component.droppedUploads.items().map((item) => item.state)).toEqual(['done', 'done']);
      expect(toast.show).toHaveBeenCalledWith('Created 2 files.');
      expect(browse.getBrowseFolderContents).toHaveBeenCalled();
    });

    it('says a refused upload is refused, and retries only what was not created', () => {
      importService.importFiles.mockImplementationOnce((_path, _files, options) => {
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

      importService.importFiles.mockReturnValueOnce(of([doc({ uid: 'd2' })]));
      component.runDroppedUploads();
      expect(importService.importFiles).toHaveBeenLastCalledWith(
        '/default-domain/workspaces/ws-1',
        [memo],
        expect.anything(),
      );
    });

    it('turns away a second drop while the first still uploads', () => {
      importService.importFiles.mockReturnValue(EMPTY);
      component.uploadDropped([scan]);
      component.uploadDropped([memo]);
      expect(importService.importFiles).toHaveBeenCalledTimes(1);
      expect(toast.show).toHaveBeenCalledWith(
        'Wait for the files being uploaded to finish before dropping more.',
      );
    });

    it('uploads nothing where the user may not create content', () => {
      component.currentDoc.set({
        ...folder,
        contextParameters: { permissions: ['Read'] },
      } as NuxeoDocument);
      component.uploadDropped([scan]);
      expect(importService.importFiles).not.toHaveBeenCalled();
    });
  });
});
