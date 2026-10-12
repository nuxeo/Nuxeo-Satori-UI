import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ElementRef, provideZonelessChangeDetection } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Subject, of, throwError, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import { vi } from 'vitest';

import {
  BrowseService,
  DirectoryService,
  DocumentImportService,
  DOMAIN_CONTAINER_GUIDANCE_KEY,
  RESTRICTED_IMPORT_LOCATION_MESSAGE_KEY,
  type DirectoryEntry,
  type ImportProgress,
  type L10nDirectoryEntry,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';

import { CreateImportDialogComponent } from './create-import-dialog.component';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { NxsToastService } from '@nuxeo-satori/platform/components';

const PARENT_PATH = '/default-domain/workspaces/ws';

const folderDoc: NuxeoDocument = {
  uid: 'ws-1',
  title: 'Demo',
  type: 'Workspace',
  path: '/default-domain/workspaces/demo',
  lastModified: '2026-01-01T00:00:00.000Z',
  properties: {},
  contextParameters: { subtypes: ['File', 'Folder'] },
};

const mockDialogRef = {
  close: vi.fn(),
  updateSize: vi.fn(),
};

/**
 * Typed against the real service, so `mock.calls` carries the actual argument tuple.
 *
 * With a bare `vi.fn(() => of([]))` the parameter list is empty, which made
 * `mock.calls[0][1]` — the entries array these tests assert on — a type error and
 * `undefined` at the type level. No gate type-checked a spec, so it went unnoticed.
 */
const mockImportService = {
  getDefaultImportParentPath: vi.fn<DocumentImportService['getDefaultImportParentPath']>(() =>
    of(PARENT_PATH),
  ),
  stageFileInBatch: vi.fn(),
  createBlobHoldingDocumentReliable: vi.fn(),
  createBlobHoldingDocumentFromBatch: vi.fn(),
  createBlobHoldingDocument: vi.fn(),
  createChildDocument: vi.fn(),
  importFiles: vi.fn<DocumentImportService['importFiles']>(() => of([])),
  importFilesWithProperties: vi.fn<DocumentImportService['importFilesWithProperties']>(() =>
    of([]),
  ),
  importCsvFile: vi.fn<DocumentImportService['importCsvFile']>(() =>
    of('<p>Imported 2 documents</p>'),
  ),
};

const mockBrowseService = {
  getFolderContext: vi.fn<BrowseService['getFolderContext']>(() =>
    of({
      uid: 'ws-1',
      title: 'Workspace',
      type: 'Workspace',
      path: PARENT_PATH,
      lastModified: '',
      properties: {},
      contextParameters: { subtypes: ['File', 'Picture', 'Note'] },
    }),
  ),
  getChildren: vi.fn<BrowseService['getChildren']>(() =>
    of({ entries: [], totalSize: 0, currentPageSize: 0, currentPageIndex: 0, numberOfPages: 0 }),
  ),
};

const mockDirectoryService = {
  getEntries: vi.fn(() => of([])),
  getAllL10nEntries: vi.fn(() => of([])),
};

function pictureType() {
  return { type: 'Picture', label: 'Picture' };
}

function jpegFile(name = 'photo.jpg') {
  return new File(['jpeg-bytes'], name, { type: 'image/jpeg' });
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('CreateImportDialogComponent (NXSAT-173)', () => {
  let component: CreateImportDialogComponent;
  let fixture: ComponentFixture<CreateImportDialogComponent>;

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [CreateImportDialogComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { parentPath: PARENT_PATH } },
        { provide: DocumentImportService, useValue: mockImportService },
        { provide: BrowseService, useValue: mockBrowseService },
        { provide: DirectoryService, useValue: mockDirectoryService },
      ],
    })
      .overrideComponent(CreateImportDialogComponent, {
        set: { imports: [], template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(CreateImportDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushAsync();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('clearNature and clearCoverage remove selected vocabulary values', () => {
    component.nature = 'application-form';
    component.coverage = 'africa-algeria';

    component.clearNature();
    component.clearCoverage();

    expect(component.nature).toBeNull();
    expect(component.coverage).toBeNull();
  });

  it('rejects invalid expiry input while typing', () => {
    component.onExpiresInput({ target: { value: '99/99/9999' } } as unknown as Event);

    expect(component.isExpiresValid()).toBe(false);
  });

  it('allows empty expiry and in-progress mm/dd/yyyy input', () => {
    expect(component.isExpiresValid()).toBe(true);

    component.onExpiresInput({ target: { value: '01/15/' } } as unknown as Event);
    expect(component.isExpiresValid()).toBe(true);
  });

  it('allows partial expiry input even when datepicker parse would fail', () => {
    component.onExpiresInput({ target: { value: '01/15/' } } as unknown as Event);
    component.expiresNgModel = {
      errors: { matDatepickerParse: { text: '01/15/' } },
      invalid: true,
      control: { markAsDirty: vi.fn(), updateValueAndValidity: vi.fn() },
    } as unknown as typeof component.expiresNgModel;

    expect(component.isExpiresValid()).toBe(true);
  });

  it('validates complete mm/dd/yyyy dates deterministically', () => {
    component.onExpiresInput({ target: { value: '02/29/2024' } } as unknown as Event);
    expect(component.isExpiresValid()).toBe(true);

    component.onExpiresInput({ target: { value: '02/29/2023' } } as unknown as Event);
    expect(component.isExpiresValid()).toBe(false);

    component.onExpiresInput({ target: { value: '02/31/2024' } } as unknown as Event);
    expect(component.isExpiresValid()).toBe(false);
  });

  it('reports pending upload before batch staging completes', async () => {
    mockImportService.stageFileInBatch.mockReturnValue(
      timer(20).pipe(map(() => ({ batchId: 'batch-1', fileIndex: 0 }))),
    );

    component.startCreateFromType(pictureType());
    component.docTitle = 'Photo';
    component.onMainFileInputChange({
      target: { files: [jpegFile()], value: '' },
    } as unknown as Event);

    expect(component.mainFileUploadPending()).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(component.mainFileUploadPending()).toBe(false);
  });

  it('stages main file on selection and completes upload progress', async () => {
    mockImportService.stageFileInBatch.mockImplementation((_file, options) => {
      options?.onProgress?.(42);
      options?.onProgress?.(100);
      return of({ batchId: 'batch-1', fileIndex: 0 });
    });

    component.startCreateFromType(pictureType());
    const file = jpegFile();
    component.onMainFileInputChange({
      target: { files: [file], value: '' },
    } as unknown as Event);

    await flushAsync();

    expect(mockImportService.stageFileInBatch).toHaveBeenCalledWith(file, expect.any(Object));
    expect(component.mainFile()).toBe(file);
    expect(component.mainFileUploadComplete()).toBe(true);
    expect(component.mainFileUploadPercent()).toBe(100);
  });

  it('sets contentError when immediate file upload fails', async () => {
    mockImportService.stageFileInBatch.mockReturnValue(
      throwError(() => ({ message: 'Upload failed' })),
    );

    component.startCreateFromType(pictureType());
    component.onMainFileInputChange({
      target: { files: [jpegFile()], value: '' },
    } as unknown as Event);

    await flushAsync();

    expect(component.contentError()).toBe('Upload failed');
    expect(component.error()).toBeNull();
    expect(component.mainFile()).toBeNull();
  });

  it('clearMainFile resets staged upload state', async () => {
    mockImportService.stageFileInBatch.mockReturnValue(of({ batchId: 'batch-1', fileIndex: 0 }));

    component.startCreateFromType(pictureType());
    component.onMainFileInputChange({
      target: { files: [jpegFile()], value: '' },
    } as unknown as Event);
    await flushAsync();

    component.clearMainFile();

    expect(component.mainFile()).toBeNull();
    expect(component.mainFileUploadComplete()).toBe(false);
    expect(component.mainFileUploadPercent()).toBe(0);
  });

  it('createDocument navigates to collection view for Collection type (Web UI parity)', async () => {
    const created: NuxeoDocument = {
      uid: 'col-1',
      title: 'My Collection',
      type: 'Collection',
      path: `${PARENT_PATH}/my-collection`,
      lastModified: '',
      properties: {},
    };
    mockImportService.createChildDocument.mockReturnValue(of(created));

    component.startCreateFromType({
      type: 'Collection',
      label: 'Collection',
    });
    component.docTitle = 'My Collection';
    component.createDocument();
    await flushAsync();

    expect(mockDialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        navigateToUrl: '/collections/col-1',
        refreshed: true,
      }),
    );
    expect(mockDialogRef.close).not.toHaveBeenCalledWith(
      expect.objectContaining({ navigateToUid: 'col-1' }),
    );
  });

  it('createDocument navigates to collection view when API omits type on create response', async () => {
    const created: NuxeoDocument = {
      uid: 'col-minimal',
      title: 'Minimal Collection',
      type: '',
      path: `${PARENT_PATH}/minimal-collection`,
      lastModified: '',
      properties: {},
    };
    mockImportService.createChildDocument.mockReturnValue(of(created));

    component.startCreateFromType({
      type: 'Collection',
      label: 'Collection',
    });
    component.docTitle = 'Minimal Collection';
    component.createDocument();
    await flushAsync();

    expect(mockDialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        navigateToUrl: '/collections/col-minimal',
      }),
    );
    expect(mockDialogRef.close).not.toHaveBeenCalledWith(
      expect.objectContaining({ navigateToUid: 'col-minimal' }),
    );
  });

  it('createDocument uses reliable blob create with staged batch when upload completed', async () => {
    const created: NuxeoDocument = {
      uid: 'doc-1',
      title: 'Photo',
      type: 'Picture',
      path: `${PARENT_PATH}/photo`,
      lastModified: '',
      properties: {},
    };

    mockImportService.stageFileInBatch.mockReturnValue(of({ batchId: 'batch-1', fileIndex: 0 }));
    mockImportService.createBlobHoldingDocumentReliable.mockReturnValue(of(created));

    component.startCreateFromType(pictureType());
    component.docTitle = 'Photo';
    component.onMainFileInputChange({
      target: { files: [jpegFile()], value: '' },
    } as unknown as Event);
    await flushAsync();

    component.createDocument();
    await flushAsync();

    expect(mockImportService.createBlobHoldingDocumentReliable).toHaveBeenCalledWith(
      PARENT_PATH,
      'Photo',
      'Picture',
      expect.any(Object),
      expect.any(File),
      { batchId: 'batch-1', fileIndex: 0 },
      expect.any(Object),
    );
    expect(mockImportService.createBlobHoldingDocument).not.toHaveBeenCalled();
    expect(mockDialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ navigateToUid: 'doc-1', refreshed: true }),
    );
  });

  it('createDocument blocks submit while immediate upload is still pending', async () => {
    mockImportService.stageFileInBatch.mockReturnValue(
      timer(20).pipe(map(() => ({ batchId: 'batch-1', fileIndex: 0 }))),
    );

    component.startCreateFromType(pictureType());
    component.docTitle = 'Photo';
    component.onMainFileInputChange({
      target: { files: [jpegFile()], value: '' },
    } as unknown as Event);

    component.createDocument();
    await flushAsync();

    expect(component.contentError()).toBe('Please wait for the file upload to finish.');
    expect(mockImportService.createBlobHoldingDocumentReliable).not.toHaveBeenCalled();
  });

  it('routes blob create failures to contentError instead of dialog error', async () => {
    mockImportService.stageFileInBatch.mockReturnValue(of({ batchId: 'batch-1', fileIndex: 0 }));
    mockImportService.createBlobHoldingDocumentReliable.mockReturnValue(
      throwError(() => ({ message: 'File was not attached to the document' })),
    );

    component.startCreateFromType(pictureType());
    component.docTitle = 'Photo';
    component.onMainFileInputChange({
      target: { files: [jpegFile()], value: '' },
    } as unknown as Event);
    await flushAsync();

    component.createDocument();
    await flushAsync();

    expect(component.contentError()).toBe('File was not attached to the document');
    expect(component.error()).toBeNull();
    expect(mockDialogRef.close).not.toHaveBeenCalled();
  });

  it('runUpload routes failures to importError instead of dialog error', async () => {
    mockImportService.importFiles.mockReturnValue(throwError(() => ({ message: 'Upload failed' })));

    component.uploadFiles.set([jpegFile('import.pdf')]);
    component.runUpload();
    await flushAsync();

    expect(component.importError()).toBe('Upload failed');
    expect(component.error()).toBeNull();
    expect(mockDialogRef.close).not.toHaveBeenCalled();
  });
});

describe('CreateImportDialogComponent import with properties (NXSAT-185)', () => {
  let component: CreateImportDialogComponent;
  let fixture: ComponentFixture<CreateImportDialogComponent>;

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [CreateImportDialogComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { parentPath: PARENT_PATH } },
        { provide: DocumentImportService, useValue: mockImportService },
        { provide: BrowseService, useValue: mockBrowseService },
        { provide: DirectoryService, useValue: mockDirectoryService },
      ],
    })
      .overrideComponent(CreateImportDialogComponent, {
        set: { imports: [], template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(CreateImportDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushAsync();
  });

  it('startImportProperties opens wizard with inferred Picture type for png', async () => {
    component.uploadFiles.set([jpegFile('photo.png')]);
    component.startImportProperties();

    expect(component.view()).toBe('importProperties');
    expect(component.importEntries()).toHaveLength(1);
    expect(component.importEntries()[0].docType).toBe('Picture');
    expect(component.importDocType()).toBe('Picture');
    expect(component.docTitle).toBe('photo');
  });

  it('close dismisses the dialog from import properties view', async () => {
    component.uploadFiles.set([jpegFile('photo.png')]);
    component.startImportProperties();

    component.close();

    expect(mockDialogRef.close).toHaveBeenCalledWith();
  });

  it('editImportNext advances and marks previous file visited', async () => {
    component.uploadFiles.set([jpegFile('a.png'), jpegFile('b.png')]);
    component.startImportProperties();
    component.docTitle = 'Alpha';

    component.editImportNext();

    expect(component.importFileIndex()).toBe(1);
    expect(component.importEntries()[0].visited).toBe(true);
    expect(component.importEntries()[0].state.title).toBe('Alpha');
    expect(component.docTitle).toBe('b');
  });

  it('editImportPrevious is blocked on the first file', async () => {
    component.uploadFiles.set([jpegFile('a.png'), jpegFile('b.png')]);
    component.startImportProperties();

    expect(component.canEditImportPrevious()).toBe(false);
    component.editImportPrevious();
    expect(component.importFileIndex()).toBe(0);
  });

  it('applyImportToAll copies metadata but preserves each file title (Web UI parity)', async () => {
    component.uploadFiles.set([jpegFile('a.png'), jpegFile('b.png'), jpegFile('c.png')]);
    component.startImportProperties();
    component.docTitle = 'Shared title';
    component.description = 'Shared description';
    component.toggleImportFileChecked(1, false);

    component.applyImportToAll();

    expect(component.importEntries()[0].state.title).toBe('Shared title');
    expect(component.importEntries()[0].state.description).toBe('Shared description');
    expect(component.importEntries()[1].state.title).toBe('b');
    expect(component.importEntries()[2].state.title).toBe('c');
    expect(component.importEntries()[2].state.description).toBe('Shared description');
    expect(component.importFileIndex()).toBe(2);
    expect(component.docTitle).toBe('c');
  });

  it('disables Apply To All once required metadata is filled for the batch', async () => {
    component.uploadFiles.set([jpegFile('a.png'), jpegFile('b.png')]);
    component.startImportProperties();

    expect(component.canApplyImportToAll()).toBe(true);

    component.applyImportToAll();
    expect(component.canApplyImportToAll()).toBe(false);
    expect(component.isImportBatchReadyToCreate()).toBe(true);
  });

  it('disables Apply To All on the last file when form is complete', async () => {
    component.uploadFiles.set([jpegFile('a.png'), jpegFile('b.png')]);
    component.startImportProperties();
    component.editImportNext();

    expect(component.canApplyImportToAll()).toBe(false);
    expect(component.isImportBatchReadyToCreate()).toBe(true);
  });

  it('disables Apply To All when only one file is staged', async () => {
    component.uploadFiles.set([jpegFile('a.png')]);
    component.startImportProperties();

    expect(component.canApplyImportToAll()).toBe(false);
  });

  it('runImportWithProperties sends per-file titles after applyImportToAll', async () => {
    mockImportService.importFilesWithProperties.mockReturnValue(of([]));
    component.uploadFiles.set([jpegFile('a.png'), jpegFile('b.png')]);
    component.startImportProperties();
    component.docTitle = 'Custom first';
    component.description = 'Shared description';
    component.applyImportToAll();
    component.runImportWithProperties();
    await flushAsync();

    const entries = mockImportService.importFilesWithProperties.mock.calls[0][1] as Array<{
      properties: Record<string, unknown>;
    }>;
    expect(entries[0].properties['dc:title']).toBe('Custom first');
    expect(entries[1].properties['dc:title']).toBe('b');
    expect(entries[0].properties['dc:description']).toBe('Shared description');
    expect(entries[1].properties['dc:description']).toBe('Shared description');
  });

  it('runImportWithProperties sends checked entries with metadata', async () => {
    const created: NuxeoDocument = {
      uid: 'doc-import-1',
      title: 'My photo',
      type: 'Picture',
      path: `${PARENT_PATH}/photo`,
      lastModified: '2026-01-01T00:00:00.000Z',
      properties: {},
    };
    mockImportService.importFilesWithProperties.mockReturnValue(of([created]));

    component.uploadFiles.set([jpegFile('photo.png')]);
    component.startImportProperties();
    component.docTitle = 'My photo';
    component.description = 'A picture';
    component.nature = 'article';
    component.importFileIndex.set(0);

    component.runImportWithProperties();
    await flushAsync();

    expect(mockImportService.importFilesWithProperties).toHaveBeenCalledWith(
      PARENT_PATH,
      [
        expect.objectContaining({
          docType: 'Picture',
          properties: expect.objectContaining({
            'dc:title': 'My photo',
            'dc:description': 'A picture',
            'dc:nature': 'article',
          }),
        }),
      ],
      expect.any(Object),
    );
    expect(mockDialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ navigateToUid: 'doc-import-1' }),
    );
  });

  it('excludes unchecked files from runImportWithProperties', async () => {
    mockImportService.importFilesWithProperties.mockReturnValue(of([]));
    component.uploadFiles.set([jpegFile('a.png'), jpegFile('b.png')]);
    component.startImportProperties();
    component.toggleImportFileChecked(1, false);
    component.editImportNext();
    component.runImportWithProperties();
    await flushAsync();

    const entries = mockImportService.importFilesWithProperties.mock.calls[0][1] as unknown[];
    expect(entries).toHaveLength(1);
    expect((entries[0] as { file: File }).file.name).toBe('a.png');
  });

  it('formats staged file sizes for the import cards', () => {
    expect(component.formatFileSize(42875)).toBe('41.87 KB');
    expect(component.formatFileSize(0)).toBe('0 B');
  });

  it('shows metadata fields only when a blob type is selected', async () => {
    component.uploadFiles.set([jpegFile('photo.png')]);
    component.startImportProperties();
    expect(component.showImportBlobMetadataFields()).toBe(true);

    component.importDocType.set('');
    expect(component.showImportBlobMetadataFields()).toBe(false);
    expect(component.canCreateImportWithProperties()).toBe(false);
  });
});

describe('CreateImportDialogComponent CSV', () => {
  let fixture: ComponentFixture<CreateImportDialogComponent>;
  let component: CreateImportDialogComponent;

  async function createDialog(data: { parentPath?: string } = {}): Promise<void> {
    vi.clearAllMocks();
    mockImportService.getDefaultImportParentPath.mockReturnValue(of('/'));
    mockImportService.importCsvFile.mockReturnValue(of('<p>Imported 2 documents</p>'));
    mockBrowseService.getFolderContext.mockReturnValue(of(folderDoc));
    mockBrowseService.getChildren.mockReturnValue(
      of({ entries: [], totalSize: 0, currentPageSize: 0, currentPageIndex: 0, numberOfPages: 0 }),
    );

    await TestBed.configureTestingModule({
      imports: [CreateImportDialogComponent, testTranslateModule(), NoopAnimationsModule],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: DocumentImportService, useValue: mockImportService },
        { provide: BrowseService, useValue: mockBrowseService },
        { provide: DirectoryService, useValue: mockDirectoryService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateImportDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await Promise.resolve();
  }

  it('defaults to repository root when opened without browse context', async () => {
    await createDialog();
    expect(mockImportService.getDefaultImportParentPath).toHaveBeenCalled();
    expect(component.parentPath()).toBe('/');
  });

  it('uses browse parent path when provided', async () => {
    await createDialog({ parentPath: '/default-domain/workspaces/demo' });
    expect(component.parentPath()).toBe('/default-domain/workspaces/demo');
    expect(mockImportService.getDefaultImportParentPath).not.toHaveBeenCalled();
  });

  it('allows CSV import at repository root but blocks file import', async () => {
    await createDialog();
    expect(component.isAtRepositoryRoot()).toBe(true);
    expect(component.csvImportRestricted()).toBe(false);
    expect(component.importRestricted()).toBe(true);
  });

  it('blocks CSV import on the domain container path', async () => {
    await createDialog({ parentPath: '/default-domain' });
    expect(component.csvImportRestricted()).toBe(true);
    expect(component.importRestricted()).toBe(true);
  });

  it('allows file and CSV import inside a workspace', async () => {
    await createDialog({ parentPath: '/default-domain/workspaces/demo' });
    expect(component.csvImportRestricted()).toBe(false);
    expect(component.importRestricted()).toBe(false);
  });

  it('shows staged import cards and action buttons only after files are selected', async () => {
    await createDialog({ parentPath: '/default-domain/workspaces/demo' });
    component.setActiveTab('import');
    fixture.detectChanges();

    let el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.btn-add-properties')).toBeFalsy();
    expect(el.textContent).not.toContain('Add more files');

    component.uploadFiles.set([new File(['x'], 'Console error.png', { type: 'image/png' })]);
    fixture.detectChanges();

    el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Console error.png');
    expect(el.textContent).toContain('Add more files');
    expect(el.querySelector('.btn-add-properties')).toBeTruthy();
    const footerCreate = [...el.querySelectorAll('mat-dialog-actions button')].find(
      (button) => button.textContent?.trim() === 'Create',
    );
    expect(footerCreate).toBeTruthy();
  });

  it('switches to CSV tab and shows Web UI options', async () => {
    await createDialog({ parentPath: '/default-domain/workspaces/demo' });
    component.setActiveTab('csv');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Click to select a csv file or drag it to upload.');
    expect(el.textContent).toContain('Receive the import report by email.');
    expect(el.textContent).toContain('Apply Date, Author and Dublin Core properties.');
  });

  it('clears CSV file when switching to import tab', async () => {
    await createDialog({ parentPath: '/default-domain/workspaces/demo' });
    component.csvFile.set(new File(['name,type'], 'docs.csv', { type: 'text/csv' }));
    component.setActiveTab('import');
    expect(component.csvFile()).toBeNull();
  });

  it('clears upload files when switching to CSV tab', async () => {
    await createDialog({ parentPath: '/default-domain/workspaces/demo' });
    component.uploadFiles.set([new File(['x'], 'a.txt')]);
    component.setActiveTab('csv');
    expect(component.uploadFiles()).toEqual([]);
  });

  it('selects CSV via file input', async () => {
    await createDialog({ parentPath: '/default-domain/workspaces/demo' });
    component.setActiveTab('csv');
    const file = new File(['name,type'], 'docs.csv', { type: 'text/csv' });
    component.onCsvInputChange({ target: { files: [file], value: '' } } as unknown as Event);
    expect(component.csvFile()?.name).toBe('docs.csv');
  });

  it('selects CSV via drag and drop', async () => {
    await createDialog({ parentPath: '/default-domain/workspaces/demo' });
    const file = new File(['name,type'], 'docs.csv', { type: 'text/csv' });
    component.onCsvDrop({
      preventDefault: vi.fn(),
      dataTransfer: { files: [file] },
    } as unknown as DragEvent);
    expect(component.csvFile()?.name).toBe('docs.csv');
  });

  it('rejects non-CSV files from file input', async () => {
    await createDialog({ parentPath: '/default-domain/workspaces/demo' });
    component.onCsvInputChange({
      target: { files: [new File(['x'], 'notes.txt')], value: '' },
    } as unknown as Event);
    expect(component.csvFile()).toBeNull();
    expect(component.error()).toBe('Please select a .csv file.');
  });

  it('rejects non-CSV files from drag and drop', async () => {
    await createDialog({ parentPath: '/default-domain/workspaces/demo' });
    component.onCsvDrop({
      preventDefault: vi.fn(),
      dataTransfer: { files: [new File(['x'], 'notes.txt')] },
    } as unknown as DragEvent);
    expect(component.csvFile()).toBeNull();
    expect(component.error()).toBe('Please select a .csv file.');
  });

  it('runCsvImport calls CSV.Import with toggle values', async () => {
    await createDialog({ parentPath: '/default-domain/workspaces/demo' });
    const file = new File(['name,type'], 'docs.csv', { type: 'text/csv' });
    component.csvFile.set(file);
    component.csvSendReport.set(true);
    component.csvDocumentMode.set(true);

    component.runCsvImport();
    await Promise.resolve();

    expect(mockImportService.importCsvFile).toHaveBeenCalledWith({
      path: '/default-domain/workspaces/demo',
      file,
      sendReport: true,
      documentMode: true,
    });
    expect(component.view()).toBe('success');
    expect(component.successMessage()).toContain('Imported 2 documents');
    expect(component.csvFile()).toBeNull();
  });

  it('does not run CSV import when location is restricted', async () => {
    await createDialog({ parentPath: '/default-domain' });
    component.csvFile.set(new File(['name,type'], 'docs.csv', { type: 'text/csv' }));
    component.runCsvImport();
    await Promise.resolve();
    expect(mockImportService.importCsvFile).not.toHaveBeenCalled();
  });

  it('shows addon message when CSV.Import returns 404', async () => {
    await createDialog({ parentPath: '/default-domain/workspaces/demo' });
    mockImportService.importCsvFile.mockReturnValueOnce(
      throwError(() => ({ status: 404, message: 'Not Found' })),
    );
    component.csvFile.set(new File(['name,type'], 'docs.csv', { type: 'text/csv' }));

    component.runCsvImport();
    await Promise.resolve();

    expect(component.error()).toContain('Nuxeo CSV addon');
    expect(component.view()).toBe('main');
  });

  it('surfaces generic CSV import failures', async () => {
    await createDialog({ parentPath: '/default-domain/workspaces/demo' });
    mockImportService.importCsvFile.mockReturnValueOnce(
      throwError(() => ({ message: 'Invalid CSV format' })),
    );
    component.csvFile.set(new File(['bad'], 'docs.csv', { type: 'text/csv' }));

    component.runCsvImport();
    await Promise.resolve();

    expect(component.error()).toBe('Invalid CSV format');
  });
});

describe('CreateImportDialogComponent domain create (NXSAT-199)', () => {
  let fixture: ComponentFixture<CreateImportDialogComponent>;
  let component: CreateImportDialogComponent;

  const rootFolderDoc: NuxeoDocument = {
    uid: 'root-1',
    title: 'Root',
    type: 'Root',
    path: '/',
    lastModified: '',
    properties: {},
    contextParameters: { subtypes: ['Domain', 'Folder'] },
  };

  async function createDialog(): Promise<void> {
    vi.clearAllMocks();
    mockImportService.getDefaultImportParentPath.mockReturnValue(of('/'));
    mockBrowseService.getFolderContext.mockReturnValue(of(rootFolderDoc));
    mockBrowseService.getChildren.mockReturnValue(
      of({ entries: [], totalSize: 0, currentPageSize: 0, currentPageIndex: 0, numberOfPages: 0 }),
    );

    await TestBed.configureTestingModule({
      imports: [CreateImportDialogComponent, testTranslateModule(), NoopAnimationsModule],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: DocumentImportService, useValue: mockImportService },
        { provide: BrowseService, useValue: mockBrowseService },
        { provide: DirectoryService, useValue: mockDirectoryService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateImportDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await Promise.resolve();
  }

  it('createDocument at repository root delegates Domain create to DocumentImportService', async () => {
    const created: NuxeoDocument = {
      uid: 'domain-1',
      title: 'Test Domain',
      type: 'Domain',
      path: '/Test Domain',
      lastModified: '',
      properties: { 'dc:title': 'Test Domain' },
    };
    mockImportService.createChildDocument.mockReturnValue(of(created));

    await createDialog();
    expect(component.parentPath()).toBe('/');

    component.startCreateFromType({ type: 'Domain', label: 'Domain' });
    component.docTitle = 'Test Domain';
    component.createDocument();
    await Promise.resolve();

    expect(mockImportService.createChildDocument).toHaveBeenCalledWith(
      '/',
      'Test Domain',
      'Domain',
      expect.objectContaining({ 'dc:title': 'Test Domain' }),
    );
    expect(mockDialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        navigateToPath: '/Test Domain',
        navigateToUrl: '/browse/Test%20Domain',
        refreshed: true,
      }),
    );
  });
});

const WS_PATH = '/default-domain/workspaces/demo';

/** An array of `File` already satisfies `FileList` once it carries `item()`. */
function fileList(files: File[]): FileList {
  return Object.assign([...files], { item: (index: number) => files[index] ?? null });
}

/**
 * A text input, not a file input: jsdom refuses a non-empty `value` on `type="file"`, and the
 * assertion that the component clears `value` after reading the selection needs a value to clear.
 */
function inputWith(value: string, files?: File[] | null): HTMLInputElement {
  const input = document.createElement('input');
  input.value = value;
  if (files !== undefined) {
    Object.defineProperty(input, 'files', { value: files === null ? null : fileList(files) });
  }
  return input;
}

function changeEvent(input: HTMLInputElement): Event {
  const event = new Event('change');
  Object.defineProperty(event, 'target', { value: input });
  return event;
}

function keyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, cancelable: true });
}

function folderEntry(path: string, title: string): NuxeoDocument {
  return {
    uid: `uid-${title}`,
    title,
    type: 'Folder',
    path,
    lastModified: '',
    properties: {},
    facets: ['Folderish'],
  };
}

function l10nEntry(
  id: string,
  parent: string,
  labelEn: string,
  extra: { ordering?: number; obsolete?: number } = {},
): L10nDirectoryEntry {
  return {
    id,
    directoryName: 'l10ncoverage',
    properties: {
      id,
      parent,
      ordering: extra.ordering ?? 0,
      obsolete: extra.obsolete ?? 0,
      label_en: labelEn,
    },
  };
}

const natureVocabulary: DirectoryEntry[] = [
  {
    id: 'contract',
    label: 'Contract',
    displayLabel: 'Contract',
    ordering: 1,
    obsolete: 0,
    directoryName: 'nature',
  },
];

const subjectVocabulary: L10nDirectoryEntry[] = [
  l10nEntry('art', '', 'Art'),
  l10nEntry('cinema', 'art', 'Cinema', { ordering: 2 }),
  l10nEntry('painting', 'art', 'Painting', { ordering: 1 }),
  l10nEntry('retired', 'art', 'Retired', { obsolete: 1 }),
];

const coverageVocabulary: L10nDirectoryEntry[] = [
  l10nEntry('africa', '', 'Africa'),
  l10nEntry('tanzania', 'africa', 'Tanzania'),
];

interface LocalMocks {
  getDefaultImportParentPath: ReturnType<
    typeof vi.fn<DocumentImportService['getDefaultImportParentPath']>
  >;
  getFolderContext: ReturnType<typeof vi.fn<BrowseService['getFolderContext']>>;
  getChildren: ReturnType<typeof vi.fn<BrowseService['getChildren']>>;
  getEntries: ReturnType<typeof vi.fn<DirectoryService['getEntries']>>;
  getAllL10nEntries: ReturnType<typeof vi.fn<DirectoryService['getAllL10nEntries']>>;
  createChildDocument: ReturnType<typeof vi.fn<DocumentImportService['createChildDocument']>>;
  createBlobHoldingDocumentReliable: ReturnType<
    typeof vi.fn<DocumentImportService['createBlobHoldingDocumentReliable']>
  >;
  stageFileInBatch: ReturnType<typeof vi.fn<DocumentImportService['stageFileInBatch']>>;
  importFiles: ReturnType<typeof vi.fn<DocumentImportService['importFiles']>>;
  importFilesWithProperties: ReturnType<
    typeof vi.fn<DocumentImportService['importFilesWithProperties']>
  >;
  importCsvFile: ReturnType<typeof vi.fn<DocumentImportService['importCsvFile']>>;
  close: ReturnType<typeof vi.fn>;
  updateSize: ReturnType<typeof vi.fn>;
  toast: { show: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}

describe('CreateImportDialogComponent location, vocabularies and file handling', () => {
  let component: CreateImportDialogComponent;
  let fixture: ComponentFixture<CreateImportDialogComponent>;
  let m: LocalMocks;

  function emptyPage() {
    return { entries: [], totalSize: 0, currentPageSize: 0, currentPageIndex: 0, numberOfPages: 0 };
  }

  function makeMocks(): LocalMocks {
    return {
      getDefaultImportParentPath: vi.fn<DocumentImportService['getDefaultImportParentPath']>(() =>
        of(WS_PATH),
      ),
      getFolderContext: vi.fn<BrowseService['getFolderContext']>(() =>
        of({
          uid: 'ws-1',
          title: 'Demo',
          type: 'Workspace',
          path: WS_PATH,
          lastModified: '',
          properties: {},
          contextParameters: { subtypes: ['File', 'Picture', 'Note', 'Folder'] },
        }),
      ),
      getChildren: vi.fn<BrowseService['getChildren']>(() => of(emptyPage())),
      getEntries: vi.fn<DirectoryService['getEntries']>(() => of(natureVocabulary)),
      getAllL10nEntries: vi.fn<DirectoryService['getAllL10nEntries']>((name: string) =>
        of(name === 'l10nsubjects' ? subjectVocabulary : coverageVocabulary),
      ),
      createChildDocument: vi.fn<DocumentImportService['createChildDocument']>(),
      createBlobHoldingDocumentReliable:
        vi.fn<DocumentImportService['createBlobHoldingDocumentReliable']>(),
      stageFileInBatch: vi.fn<DocumentImportService['stageFileInBatch']>(() =>
        of({ batchId: 'batch-1', fileIndex: 0 }),
      ),
      importFiles: vi.fn<DocumentImportService['importFiles']>(() => of([])),
      importFilesWithProperties: vi.fn<DocumentImportService['importFilesWithProperties']>(() =>
        of([]),
      ),
      importCsvFile: vi.fn<DocumentImportService['importCsvFile']>(() => of('<p>ok</p>')),
      close: vi.fn(),
      updateSize: vi.fn(),
      toast: { show: vi.fn(), error: vi.fn() },
    };
  }

  async function createDialog(
    data: { parentPath?: string | null } = { parentPath: WS_PATH },
    tweak: (mocks: LocalMocks) => void = () => undefined,
  ): Promise<void> {
    TestBed.resetTestingModule();
    m = makeMocks();
    tweak(m);
    TestBed.overrideProvider(NxsToastService, { useValue: m.toast });

    await TestBed.configureTestingModule({
      imports: [CreateImportDialogComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: m.close, updateSize: m.updateSize } },
        {
          provide: DocumentImportService,
          useValue: {
            getDefaultImportParentPath: m.getDefaultImportParentPath,
            createChildDocument: m.createChildDocument,
            createBlobHoldingDocumentReliable: m.createBlobHoldingDocumentReliable,
            stageFileInBatch: m.stageFileInBatch,
            importFiles: m.importFiles,
            importFilesWithProperties: m.importFilesWithProperties,
            importCsvFile: m.importCsvFile,
          },
        },
        {
          provide: BrowseService,
          useValue: { getFolderContext: m.getFolderContext, getChildren: m.getChildren },
        },
        {
          provide: DirectoryService,
          useValue: { getEntries: m.getEntries, getAllL10nEntries: m.getAllL10nEntries },
        },
      ],
    })
      .overrideComponent(CreateImportDialogComponent, {
        set: { imports: [], template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(CreateImportDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushAsync();
  }

  function dragEvent(files: File[] = []): DragEvent {
    const event = new Event('drop', { cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: { files: fileList(files) } });
    return event;
  }

  describe('startup failures', () => {
    it('surfaces a path error and stops the spinner when the default folder cannot be resolved', async () => {
      await createDialog({}, (mocks) => {
        mocks.getDefaultImportParentPath.mockReturnValue(throwError(() => new Error('503')));
      });

      expect(component.pathError()).toBe(
        'Could not resolve a default folder. Open a folder in Browse first.',
      );
      expect(component.resolvingPath()).toBe(false);
      expect(component.parentPath()).toBeNull();
    });

    it('marks directories loaded even when the vocabulary fetch fails, so the form is usable', async () => {
      await createDialog({ parentPath: WS_PATH }, (mocks) => {
        mocks.getEntries.mockReturnValue(throwError(() => new Error('500')));
      });

      expect(component.directoriesLoaded()).toBe(true);
      expect(component.natureEntries()).toEqual([]);
    });

    it('reports a folder-context failure and offers no creatable types', async () => {
      await createDialog({ parentPath: WS_PATH }, (mocks) => {
        mocks.getFolderContext.mockReturnValue(throwError(() => new Error('403')));
      });

      expect(component.typesLoadError()).toBe(
        'Could not load creatable document types for this folder.',
      );
      expect(component.creatableTypes()).toEqual([]);
      expect(component.parentFolderType()).toBeNull();
      expect(component.loadingContext()).toBe(false);
    });

    it('empties the location suggestions when the children fetch fails', async () => {
      await createDialog({ parentPath: WS_PATH }, (mocks) => {
        mocks.getChildren.mockReturnValue(throwError(() => new Error('500')));
      });

      expect(component.locationSuggestions()).toEqual([]);
      expect(component.locationHighlightIndex()).toBe(-1);
      expect(component.loadingLocationSuggestions()).toBe(false);
    });

    it('skips the folder-context call entirely on the restricted domain container', async () => {
      await createDialog({ parentPath: '/default-domain' });

      expect(m.getFolderContext).not.toHaveBeenCalled();
      expect(component.creatableTypes()).toEqual([]);
      expect(component.typesLoadError()).toBeNull();
      expect(component.loadingContext()).toBe(false);
    });

    it('ignores a stale folder-context response when the location changed mid-flight', async () => {
      const slow = new Subject<NuxeoDocument>();
      await createDialog({ parentPath: WS_PATH }, (mocks) => {
        mocks.getFolderContext.mockReturnValueOnce(slow.asObservable());
      });

      component.locationInput = '/default-domain/workspaces/other';
      component.commitLocationInput();
      fixture.detectChanges();
      await flushAsync();

      slow.next({
        uid: 'stale',
        title: 'Stale',
        type: 'Section',
        path: WS_PATH,
        lastModified: '',
        properties: {},
        contextParameters: { subtypes: ['Section'] },
      });

      expect(component.parentFolderType()).toBe('Workspace');
    });
  });

  describe('location picker', () => {
    it('opens the dropdown and lists only folderish children when the input ends with a slash', async () => {
      await createDialog({ parentPath: WS_PATH }, (mocks) => {
        mocks.getChildren.mockReturnValue(
          of({
            ...emptyPage(),
            entries: [
              folderEntry(`${WS_PATH}/alpha`, 'Alpha'),
              {
                uid: 'file-1',
                title: 'note.txt',
                type: 'File',
                path: `${WS_PATH}/note.txt`,
                lastModified: '',
                properties: {},
              },
            ],
          }),
        );
      });

      component.locationInput = `${WS_PATH}/`;
      component.onLocationInput();

      expect(component.locationDropdownOpen()).toBe(true);
      expect(component.locationSuggestions()).toEqual([
        { path: `${WS_PATH}/alpha`, title: 'Alpha' },
      ]);
      expect(component.locationHighlightIndex()).toBe(0);
      expect(m.getChildren).toHaveBeenLastCalledWith(WS_PATH, 50, 0);
    });

    it('closes the dropdown when the input no longer ends with a slash', async () => {
      await createDialog();
      component.locationDropdownOpen.set(true);
      component.locationHighlightIndex.set(3);

      component.locationInput = `${WS_PATH}/al`;
      component.onLocationInput();

      expect(component.locationDropdownOpen()).toBe(false);
      expect(component.locationHighlightIndex()).toBe(-1);
    });

    it('reopens the dropdown on focus only when the input ends with a slash', async () => {
      await createDialog();

      component.locationInput = WS_PATH;
      component.onLocationFocus();
      expect(component.locationDropdownOpen()).toBe(false);

      component.locationInput = `${WS_PATH}/`;
      component.onLocationFocus();
      expect(component.locationDropdownOpen()).toBe(true);
    });

    it('normalises a typed location, stripping trailing slashes and adding the leading one', async () => {
      await createDialog();

      component.locationInput = 'default-domain/workspaces/other///';
      component.commitLocationInput();

      expect(component.parentPath()).toBe('/default-domain/workspaces/other');
      expect(component.locationInput).toBe('/default-domain/workspaces/other');
      expect(component.locationDropdownOpen()).toBe(false);
    });

    it('ignores a blank location rather than resetting the parent to root', async () => {
      await createDialog();

      component.locationInput = '   ';
      component.commitLocationInput();

      expect(component.parentPath()).toBe(WS_PATH);
    });

    it('resolves an empty typed path to the repository root', async () => {
      await createDialog();

      component.selectLocationSuggestion('   ');

      expect(component.parentPath()).toBe('/');
    });

    function withTwoSuggestions(mocks: LocalMocks) {
      mocks.getChildren.mockReturnValue(
        of({
          ...emptyPage(),
          entries: [
            folderEntry(`${WS_PATH}/alpha`, 'Alpha'),
            folderEntry(`${WS_PATH}/beta`, 'Beta'),
          ],
        }),
      );
    }

    async function openDropdown(): Promise<void> {
      component.locationInput = `${WS_PATH}/`;
      component.onLocationInput();
    }

    it('cycles the highlight with the arrow keys and wraps at both ends', async () => {
      await createDialog({ parentPath: WS_PATH }, withTwoSuggestions);
      await openDropdown();

      const down = keyEvent('ArrowDown');
      component.onLocationKeydown(down);
      expect(component.locationHighlightIndex()).toBe(1);
      expect(down.defaultPrevented).toBe(true);

      component.onLocationKeydown(keyEvent('ArrowDown'));
      expect(component.locationHighlightIndex()).toBe(0);

      component.onLocationKeydown(keyEvent('ArrowUp'));
      expect(component.locationHighlightIndex()).toBe(1);

      component.onLocationKeydown(keyEvent('ArrowUp'));
      expect(component.locationHighlightIndex()).toBe(0);
    });

    it('opens the dropdown on ArrowDown when it is closed but the input ends with a slash', async () => {
      await createDialog({ parentPath: WS_PATH }, withTwoSuggestions);
      component.locationInput = `${WS_PATH}/`;

      component.onLocationKeydown(keyEvent('ArrowDown'));

      expect(component.locationDropdownOpen()).toBe(true);
      expect(component.locationSuggestions()).toHaveLength(2);
    });

    it('leaves the highlight alone on ArrowUp while the dropdown is closed', async () => {
      await createDialog({ parentPath: WS_PATH }, withTwoSuggestions);
      const before = component.locationHighlightIndex();
      const up = keyEvent('ArrowUp');

      component.onLocationKeydown(up);

      expect(component.locationHighlightIndex()).toBe(before);
      expect(component.locationDropdownOpen()).toBe(false);
      expect(up.defaultPrevented).toBe(false);
    });

    it('Enter picks the highlighted suggestion as the new parent path', async () => {
      await createDialog({ parentPath: WS_PATH }, withTwoSuggestions);
      await openDropdown();
      component.onLocationKeydown(keyEvent('ArrowDown'));

      component.onLocationKeydown(keyEvent('Enter'));

      expect(component.parentPath()).toBe(`${WS_PATH}/beta`);
      expect(component.locationDropdownOpen()).toBe(false);
    });

    it('Enter commits the typed text when the dropdown is closed', async () => {
      await createDialog();
      component.locationInput = '/default-domain/workspaces/typed';

      component.onLocationKeydown(keyEvent('Enter'));

      expect(component.parentPath()).toBe('/default-domain/workspaces/typed');
    });

    it('Escape closes the dropdown and clears the highlight', async () => {
      await createDialog({ parentPath: WS_PATH }, withTwoSuggestions);
      await openDropdown();
      const escape = keyEvent('Escape');

      component.onLocationKeydown(escape);
      expect(escape.defaultPrevented).toBe(true);

      expect(component.locationDropdownOpen()).toBe(false);
      expect(component.locationHighlightIndex()).toBe(-1);
    });

    it('ignores an unhandled key', async () => {
      await createDialog({ parentPath: WS_PATH }, withTwoSuggestions);
      await openDropdown();

      component.onLocationKeydown(keyEvent('a'));

      expect(component.locationDropdownOpen()).toBe(true);
      expect(component.locationHighlightIndex()).toBe(0);
    });

    it('the document Escape handler closes an open dropdown', async () => {
      await createDialog({ parentPath: WS_PATH }, withTwoSuggestions);
      await openDropdown();

      component.onEscapeKey();

      expect(component.locationDropdownOpen()).toBe(false);
      expect(component.locationHighlightIndex()).toBe(-1);
    });

    it('blur commits the typed location after the click grace period', async () => {
      vi.useFakeTimers();
      try {
        await createDialog();
        component.locationInput = '/default-domain/workspaces/blurred';
        component.locationDropdownOpen.set(true);

        component.onLocationBlur();
        expect(component.parentPath()).toBe(WS_PATH);

        vi.advanceTimersByTime(150);

        expect(component.locationDropdownOpen()).toBe(false);
        expect(component.parentPath()).toBe('/default-domain/workspaces/blurred');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('tab switching', () => {
    it('abandons an in-progress create form and returns to the type grid', async () => {
      await createDialog();
      component.startCreateFromType(pictureType());
      component.docTitle = 'Half typed';

      component.setActiveTab('import');

      expect(component.view()).toBe('main');
      expect(component.selectedDocType()).toBeNull();
      expect(component.docTitle).toBe('');
      expect(component.activeTab()).toBe('import');
    });

    it('clears the staged CSV file when moving to the import tab', async () => {
      await createDialog();
      component.csvFile.set(new File(['a,b'], 'x.csv'));
      component.dragOverCsv.set(true);

      component.setActiveTab('import');

      expect(component.csvFile()).toBeNull();
      expect(component.dragOverCsv()).toBe(false);
    });

    it('clears staged uploads when moving to the CSV tab', async () => {
      await createDialog();
      component.uploadFiles.set([jpegFile()]);
      component.dragOverUpload.set(true);

      component.setActiveTab('csv');

      expect(component.uploadFiles()).toEqual([]);
      expect(component.dragOverUpload()).toBe(false);
    });

    it('clears both staged sets when returning to the create tab', async () => {
      await createDialog();
      component.uploadFiles.set([jpegFile()]);
      component.csvFile.set(new File(['a,b'], 'x.csv'));

      component.setActiveTab('create');

      expect(component.uploadFiles()).toEqual([]);
      expect(component.csvFile()).toBeNull();
    });

    it('does not open the create form for a restricted location', async () => {
      await createDialog({ parentPath: '/default-domain' });

      component.startCreateFromType(pictureType());

      expect(component.view()).toBe('main');
      expect(component.selectedDocType()).toBeNull();
    });

    it('goMain discards both the create form and the import wizard', async () => {
      await createDialog();
      component.uploadFiles.set([jpegFile('a.jpg')]);
      component.startImportProperties();

      component.goMain();

      expect(component.view()).toBe('main');
      expect(component.importEntries()).toEqual([]);
      expect(component.importFileIndex()).toBe(0);
      expect(component.importDocType()).toBe('');
    });
  });

  describe('dialog sizing and location hints', () => {
    it('shrinks the dialog for the success view and restores it on the way back', async () => {
      await createDialog();
      m.updateSize.mockClear();

      component.view.set('success');
      fixture.detectChanges();
      expect(m.updateSize).toHaveBeenLastCalledWith('440px');

      component.view.set('main');
      fixture.detectChanges();
      expect(m.updateSize).toHaveBeenLastCalledWith('960px', '680px');
    });

    it('gives domain-specific guidance when the parent is a Domain', async () => {
      await createDialog({ parentPath: '/my-domain' }, (mocks) => {
        mocks.getFolderContext.mockReturnValue(
          of({
            uid: 'dom-1',
            title: 'My Domain',
            type: 'Domain',
            path: '/my-domain',
            lastModified: '',
            properties: {},
            contextParameters: { subtypes: ['WorkspaceRoot'] },
          }),
        );
      });

      expect(component.importLocationHint()).toBe(DOMAIN_CONTAINER_GUIDANCE_KEY);
      expect(component.locationRestricted()).toBe(true);
    });

    it('gives the generic hint for a non-domain restricted location', async () => {
      await createDialog({ parentPath: '/default-domain' });

      expect(component.importLocationHint()).toBe(RESTRICTED_IMPORT_LOCATION_MESSAGE_KEY);
    });
  });

  describe('vocabulary pickers', () => {
    it('resolves nature, subject and coverage pills, falling back to the raw id', async () => {
      await createDialog();

      expect(component.naturePillLabel('contract')).toBe('Contract');
      expect(component.naturePillLabel('unknown')).toBe('unknown');
      expect(component.subjectPillLabel('cinema')).toBe('Art/Cinema');
      expect(component.subjectPillLabel('art')).toBe('Art');
      expect(component.subjectPillLabel('unknown')).toBe('unknown');
      expect(component.coveragePillLabel('tanzania')).toBe('Africa/Tanzania');
      expect(component.coveragePillLabel('africa')).toBe('Africa');
      expect(component.coveragePillLabel('unknown')).toBe('unknown');
    });

    it('does not double-prefix a label that already carries its parent', async () => {
      await createDialog({ parentPath: WS_PATH }, (mocks) => {
        mocks.getAllL10nEntries.mockImplementation((name: string) =>
          of(
            name === 'l10nsubjects'
              ? [l10nEntry('art', '', 'Art'), l10nEntry('cinema', 'art', 'Art/Cinema')]
              : coverageVocabulary,
          ),
        );
      });

      expect(component.subjectPillLabel('cinema')).toBe('Art/Cinema');
    });

    it('names a missing parent by its id', async () => {
      await createDialog({ parentPath: WS_PATH }, (mocks) => {
        mocks.getAllL10nEntries.mockImplementation((name: string) =>
          of(
            name === 'l10ncoverage'
              ? [l10nEntry('tanzania', 'africa', 'Tanzania')]
              : subjectVocabulary,
          ),
        );
      });

      expect(component.coveragePillLabel('tanzania')).toBe('africa/Tanzania');
      expect(component.coverageDisplayLabel()).toBe('');

      component.coverage = 'tanzania';
      expect(component.coverageDisplayLabel()).toBe('africa/Tanzania');
    });

    it('clears the selected nature and coverage', async () => {
      await createDialog();
      component.nature = 'contract';
      component.coverage = 'tanzania';

      component.clearNature();
      component.clearCoverage();

      expect(component.nature).toBeNull();
      expect(component.coverage).toBeNull();
    });

    it('groups subject children under their parent, ordered, dropping obsolete and parent rows', async () => {
      await createDialog();

      const groups = component.groupedSubjectOptions();

      expect(groups).toHaveLength(1);
      expect(groups[0].parentLabel).toBe('Art');
      expect(groups[0].entries.map((e) => e.id)).toEqual(['painting', 'cinema']);
    });

    it('filters the grouped options by label, id or parent label', async () => {
      await createDialog();

      component.subjectsPanelSearch = 'paint';
      expect(component.groupedSubjectOptions()[0].entries.map((e) => e.id)).toEqual(['painting']);

      component.subjectsPanelSearch = 'cinem';
      expect(component.groupedSubjectOptions()[0].entries.map((e) => e.id)).toEqual(['cinema']);

      component.subjectsPanelSearch = 'art';
      expect(component.groupedSubjectOptions()[0].entries.map((e) => e.id)).toEqual([
        'painting',
        'cinema',
      ]);

      component.subjectsPanelSearch = 'nothing-matches';
      expect(component.groupedSubjectOptions()).toEqual([]);
    });

    it('returns no groups when the vocabulary is empty', async () => {
      await createDialog({ parentPath: WS_PATH }, (mocks) => {
        mocks.getAllL10nEntries.mockReturnValue(of([]));
      });

      expect(component.groupedCoverageOptions()).toEqual([]);
    });

    it('filters the flat nature list by the panel search', async () => {
      await createDialog();

      component.naturePanelSearch = 'contr';
      expect(component.filteredNatureOptions().map((e) => e.id)).toEqual(['contract']);

      component.naturePanelSearch = 'zzz';
      expect(component.filteredNatureOptions()).toEqual([]);
    });

    it('refetches each vocabulary when its panel opens, and only then', async () => {
      await createDialog();
      const natureCalls = m.getEntries.mock.calls.length;
      const l10nCalls = m.getAllL10nEntries.mock.calls.length;

      component.naturePanelSearch = 'stale';
      component.subjectsPanelSearch = 'stale';
      component.coveragePanelSearch = 'stale';

      component.onNaturePanelOpen(false);
      component.onSubjectsPanelOpen(false);
      component.onCoveragePanelOpen(false);
      expect(m.getEntries.mock.calls.length).toBe(natureCalls);
      expect(m.getAllL10nEntries.mock.calls.length).toBe(l10nCalls);
      expect(component.naturePanelSearch).toBe('stale');

      component.onNaturePanelOpen(true);
      component.onSubjectsPanelOpen(true);
      component.onCoveragePanelOpen(true);

      expect(m.getEntries.mock.calls.length).toBe(natureCalls + 1);
      expect(m.getAllL10nEntries.mock.calls.slice(l10nCalls).map(([name]) => name)).toEqual([
        'l10nsubjects',
        'l10ncoverage',
      ]);
      expect(component.naturePanelSearch).toBe('');
      expect(component.subjectsPanelSearch).toBe('');
      expect(component.coveragePanelSearch).toBe('');
      expect(component.natureEntries().map((e) => e.id)).toEqual(['contract']);
    });

    it('addSubject appends once and removeSubject deletes', async () => {
      await createDialog();

      component.addSubject('cinema');
      component.addSubject('cinema');
      component.addSubject('');
      expect(component.subjects).toEqual(['cinema']);

      component.addSubject('painting');
      component.removeSubject('cinema');
      expect(component.subjects).toEqual(['painting']);
    });
  });

  describe('display helpers', () => {
    it('labels each upload progress phase', async () => {
      await createDialog();

      expect(component.uploadProgressLabel({ phase: 'creating', percent: 10 })).toBe(
        'Creating document…',
      );
      expect(
        component.uploadProgressLabel({
          phase: 'uploading',
          percent: 10,
          fileCount: 3,
          fileIndex: 1,
        }),
      ).toBe('Uploading file 2 of 3…');
      expect(component.uploadProgressLabel({ phase: 'uploading', percent: 10 })).toBe('Uploading…');
      expect(
        component.uploadProgressLabel({
          phase: 'uploading',
          percent: 10,
          fileCount: 1,
          fileIndex: 0,
        }),
      ).toBe('Uploading…');
    });

    it('formats file sizes across each unit boundary', async () => {
      await createDialog();

      expect(component.formatFileSize(512)).toBe('512 B');
      expect(component.formatFileSize(2048)).toBe('2.00 KB');
      expect(component.formatFileSize(5 * 1024 * 1024)).toBe('5.00 MB');
      expect(component.formatFileSize(3 * 1024 ** 3)).toBe('3.00 GB');
      expect(component.formatFileSize(-1)).toBe('');
      expect(component.formatFileSize(Number.NaN)).toBe('');
    });

    it('reports the current wizard file name and empty when there is none', async () => {
      await createDialog();
      expect(component.currentImportFileLabel()).toBe('');

      component.uploadFiles.set([jpegFile('a.jpg'), jpegFile('b.jpg')]);
      component.startImportProperties();
      component.selectImportFile(1);

      expect(component.currentImportFileLabel()).toBe('b.jpg');
    });

    it('exposes a content field only for blob-holding types, and flags the missing file', async () => {
      await createDialog();
      expect(component.hasContentField()).toBe(false);
      expect(component.createMissingMainFile()).toBe(false);

      component.startCreateFromType({ type: 'Folder', label: 'Folder' });
      expect(component.hasContentField()).toBe(false);
      expect(component.createMissingMainFile()).toBe(false);

      component.startCreateFromType(pictureType());
      expect(component.hasContentField()).toBe(true);
      expect(component.createMissingMainFile()).toBe(true);

      component.mainFile.set(jpegFile());
      expect(component.createMissingMainFile()).toBe(false);
    });

    it('clicks the hidden import file input when asked to open the picker', async () => {
      await createDialog();
      const input = document.createElement('input');
      const click = vi.spyOn(input, 'click');
      component.importFileInput = new ElementRef(input);

      component.openImportFilePicker();

      expect(click).toHaveBeenCalledTimes(1);
    });
  });

  describe('import wizard navigation', () => {
    it('selectImportFile saves the current form before switching, and ignores a no-op', async () => {
      await createDialog();
      component.uploadFiles.set([jpegFile('a.jpg'), jpegFile('b.jpg')]);
      component.startImportProperties();
      component.docTitle = 'Alpha';

      component.selectImportFile(0);
      expect(component.importEntries()[0].visited).toBe(false);

      component.selectImportFile(1);

      expect(component.importFileIndex()).toBe(1);
      expect(component.importEntries()[0].state.title).toBe('Alpha');
      expect(component.importEntries()[0].visited).toBe(true);
      expect(component.docTitle).toBe('b');
    });

    it('editImportPrevious steps back and reloads that file into the form', async () => {
      await createDialog();
      component.uploadFiles.set([jpegFile('a.jpg'), jpegFile('b.jpg')]);
      component.startImportProperties();
      component.editImportNext();
      component.docTitle = 'Beta';

      component.editImportPrevious();

      expect(component.importFileIndex()).toBe(0);
      expect(component.docTitle).toBe('a');
      expect(component.importEntries()[1].state.title).toBe('Beta');
    });

    it('editImportNext is blocked on the last file', async () => {
      await createDialog();
      component.uploadFiles.set([jpegFile('a.jpg')]);
      component.startImportProperties();

      expect(component.canEditImportNext()).toBe(false);
      component.editImportNext();
      expect(component.importFileIndex()).toBe(0);
    });

    it('applyImportToAll is a no-op when it is not available', async () => {
      await createDialog();
      component.uploadFiles.set([jpegFile('a.jpg')]);
      component.startImportProperties();

      component.applyImportToAll();

      expect(component.importEntries()[0].visited).toBe(false);
    });

    it('startImportProperties refuses a restricted location and an empty selection', async () => {
      await createDialog({ parentPath: '/default-domain' });
      component.uploadFiles.set([jpegFile('a.jpg')]);
      component.startImportProperties();
      expect(component.view()).toBe('main');

      await createDialog();
      component.uploadFiles.set([]);
      component.startImportProperties();
      expect(component.view()).toBe('main');
    });

    it('surfaces the server message when the wizard create fails, without closing the dialog', async () => {
      await createDialog();
      m.importFilesWithProperties.mockReturnValue(
        throwError(() => ({ error: { message: 'Quota exceeded' } })),
      );
      component.uploadFiles.set([jpegFile('a.jpg')]);
      component.startImportProperties();

      component.runImportWithProperties();
      await flushAsync();

      expect(component.importError()).toBe('Quota exceeded');
      expect(component.busy()).toBe(false);
      expect(component.uploadProgress()).toBeNull();
      expect(m.close).not.toHaveBeenCalled();
    });

    it('falls back to a generic message when the wizard failure carries none', async () => {
      await createDialog();
      m.importFilesWithProperties.mockReturnValue(throwError(() => ({})));
      component.uploadFiles.set([jpegFile('a.jpg')]);
      component.startImportProperties();

      component.runImportWithProperties();
      await flushAsync();

      expect(component.importError()).toBe('Create failed');
    });

    it('does not call the API when every staged file is unchecked', async () => {
      await createDialog();
      component.uploadFiles.set([jpegFile('a.jpg')]);
      component.startImportProperties();
      component.toggleImportFileChecked(0, false);

      component.runImportWithProperties();
      await flushAsync();

      expect(m.importFilesWithProperties).not.toHaveBeenCalled();
    });

    it('reports upload progress to the wizard while the batch runs', async () => {
      await createDialog();
      const progress: ImportProgress = {
        phase: 'uploading',
        percent: 42,
        fileIndex: 0,
        fileCount: 1,
      };
      component.uploadFiles.set([jpegFile('a.jpg')]);
      component.startImportProperties();

      let seen: ImportProgress | null = null;
      m.importFilesWithProperties.mockImplementation((_path, _entries, options) => {
        options?.onProgress?.(progress);
        seen = component.uploadProgress();
        return of([]);
      });
      component.runImportWithProperties();
      await flushAsync();

      expect(seen).toEqual(progress);
      expect(component.uploadProgress()).toBeNull();
    });
  });

  describe('create form', () => {
    it('writes the note body and mime type for a Note', async () => {
      await createDialog();
      m.createChildDocument.mockReturnValue(
        of({
          uid: 'note-1',
          title: 'Minutes',
          type: 'Note',
          path: `${WS_PATH}/Minutes`,
          lastModified: '',
          properties: {},
        }),
      );

      component.startCreateFromType({ type: 'Note', label: 'Note' });
      component.docTitle = 'Minutes';
      component.noteFormat = 'text/html';
      component.createDocument();
      await flushAsync();

      const [, , , properties] = m.createChildDocument.mock.calls[0];
      expect(properties['note:note']).toBe('<p></p>');
      expect(properties['note:mime_type']).toBe('text/html');
      expect(m.close).toHaveBeenCalledWith(
        expect.objectContaining({ freshNote: true, navigateToUid: 'note-1' }),
      );
      expect(m.toast.show).toHaveBeenCalledWith('Created Note “Minutes”');
    });

    it('refuses to create a blob type with no file attached', async () => {
      await createDialog();
      component.startCreateFromType(pictureType());
      component.docTitle = 'Photo';

      component.createDocument();

      expect(component.contentError()).toBe('A file is required for this document type.');
      expect(m.createBlobHoldingDocumentReliable).not.toHaveBeenCalled();
      expect(component.busy()).toBe(false);
    });

    it('refuses to create while the attached file is still uploading', async () => {
      await createDialog();
      const stall = new Subject<{ batchId: string; fileIndex: number }>();
      m.stageFileInBatch.mockReturnValue(stall.asObservable());

      component.startCreateFromType(pictureType());
      component.docTitle = 'Photo';
      const input = inputWith('c:/photo.jpg', [jpegFile()]);
      component.onMainFileInputChange(changeEvent(input));
      expect(input.value).toBe('');

      component.createDocument();

      expect(component.contentError()).toBe('Please wait for the file upload to finish.');
      expect(m.createBlobHoldingDocumentReliable).not.toHaveBeenCalled();
      stall.complete();
    });

    it('does nothing without a title or a selected type', async () => {
      await createDialog();

      component.createDocument();
      expect(m.createChildDocument).not.toHaveBeenCalled();

      component.startCreateFromType({ type: 'Folder', label: 'Folder' });
      component.docTitle = '   ';
      component.createDocument();
      expect(m.createChildDocument).not.toHaveBeenCalled();
    });

    it('refuses to create while the expiry field is invalid', async () => {
      await createDialog();
      component.startCreateFromType({ type: 'Folder', label: 'Folder' });
      component.docTitle = 'Reports';
      component.onExpiresInput(changeEvent(inputWith('99/99/9999')));

      expect(component.showExpiresError()).toBe(true);
      component.createDocument();

      expect(m.createChildDocument).not.toHaveBeenCalled();
    });

    it('sends the expiry as an ISO date and clears the raw text once a date parses', async () => {
      await createDialog();
      m.createChildDocument.mockReturnValue(
        of({
          uid: 'folder-1',
          title: 'Reports',
          type: 'Folder',
          path: `${WS_PATH}/Reports`,
          lastModified: '',
          properties: {},
        }),
      );

      component.startCreateFromType({ type: 'Folder', label: 'Folder' });
      component.docTitle = 'Reports';
      component.onExpiresInput(changeEvent(inputWith('12/31/2027')));
      component.onExpiresChange(new Date('2027-12-31T00:00:00.000Z'));
      expect(component.expiresRawText).toBe('');

      component.createDocument();
      await flushAsync();

      const [, , , properties] = m.createChildDocument.mock.calls[0];
      expect(properties['dc:expired']).toBe('2027-12-31T00:00:00.000Z');
    });

    it('keeps the raw text when the datepicker could not parse what was typed', async () => {
      await createDialog();
      component.onExpiresInput(changeEvent(inputWith('12/')));

      component.onExpiresChange(new Date(Number.NaN));

      expect(component.expiresRawText).toBe('12/');
      expect(component.expires && Number.isNaN(component.expires.getTime())).toBe(true);
    });

    it('routes a non-blob create failure to the dialog error, not the content error', async () => {
      await createDialog();
      m.createChildDocument.mockReturnValue(throwError(() => ({ message: 'Name already used' })));

      component.startCreateFromType({ type: 'Folder', label: 'Folder' });
      component.docTitle = 'Reports';
      component.createDocument();
      await flushAsync();

      expect(component.error()).toBe('Name already used');
      expect(component.contentError()).toBeNull();
      expect(component.busy()).toBe(false);
    });

    it('falls back to a generic message when the create failure carries none', async () => {
      await createDialog();
      m.createChildDocument.mockReturnValue(throwError(() => ({})));

      component.startCreateFromType({ type: 'Folder', label: 'Folder' });
      component.docTitle = 'Reports';
      component.createDocument();
      await flushAsync();

      expect(component.error()).toBe('Create failed');
    });
  });

  describe('main file staging', () => {
    it('stages a file dropped onto the content area', async () => {
      await createDialog();
      component.startCreateFromType(pictureType());

      component.onContentDrop(dragEvent([jpegFile('dropped.jpg')]));
      await flushAsync();

      expect(component.mainFile()?.name).toBe('dropped.jpg');
      expect(component.mainFileUploadComplete()).toBe(true);
      expect(component.mainFileUploadPercent()).toBe(100);
      expect(component.dragOverContent()).toBe(false);
    });

    it('ignores a drop that carries no file', async () => {
      await createDialog();
      component.onContentDrop(dragEvent([]));

      expect(component.mainFile()).toBeNull();
      expect(m.stageFileInBatch).not.toHaveBeenCalled();
    });

    it('tracks drag-over state on the content area', async () => {
      await createDialog();

      component.onContentDragOver(dragEvent());
      expect(component.dragOverContent()).toBe(true);

      component.onContentDragLeave(dragEvent());
      expect(component.dragOverContent()).toBe(false);
    });

    it('ignores a file input change with no selection', async () => {
      await createDialog();
      component.onMainFileInputChange(changeEvent(inputWith('x', [])));

      expect(component.mainFile()).toBeNull();
      expect(m.stageFileInBatch).not.toHaveBeenCalled();
    });

    it('clearMainFile discards the staged batch and resets the native input', async () => {
      await createDialog();
      component.startCreateFromType(pictureType());
      component.onContentDrop(dragEvent([jpegFile()]));
      await flushAsync();
      const input = document.createElement('input');
      input.value = 'c:/photo.jpg';
      component.mainFileInput = new ElementRef(input);

      component.clearMainFile();

      expect(component.mainFile()).toBeNull();
      expect(component.mainFileUploading()).toBe(false);
      expect(component.mainFileUploadComplete()).toBe(false);
      expect(component.mainFileUploadPercent()).toBe(0);
      expect(component.contentError()).toBeNull();
      expect(input.value).toBe('');
    });

    it('ignores a stale upload result for a file the user already replaced', async () => {
      await createDialog();
      const first = new Subject<{ batchId: string; fileIndex: number }>();
      m.stageFileInBatch.mockReturnValueOnce(first.asObservable());

      component.startCreateFromType(pictureType());
      component.onContentDrop(dragEvent([jpegFile('first.jpg')]));
      component.onContentDrop(dragEvent([jpegFile('second.jpg')]));
      await flushAsync();

      first.next({ batchId: 'stale-batch', fileIndex: 0 });
      first.complete();

      expect(component.mainFile()?.name).toBe('second.jpg');
      expect(component.mainFileUploadComplete()).toBe(true);
    });

    it('ignores a stale upload failure for a file the user already replaced', async () => {
      await createDialog();
      const first = new Subject<{ batchId: string; fileIndex: number }>();
      m.stageFileInBatch.mockReturnValueOnce(first.asObservable());

      component.startCreateFromType(pictureType());
      component.onContentDrop(dragEvent([jpegFile('first.jpg')]));
      component.onContentDrop(dragEvent([jpegFile('second.jpg')]));
      await flushAsync();

      first.error({ message: 'stale failure' });

      expect(component.contentError()).toBeNull();
      expect(component.mainFile()?.name).toBe('second.jpg');
    });
  });

  describe('multi-file upload tab', () => {
    it('appends files chosen through the input and clears the native value', async () => {
      await createDialog();
      const input = inputWith('c:/a.jpg', [jpegFile('a.jpg'), jpegFile('b.jpg')]);
      component.importError.set('previous failure');

      component.onUploadInputChange(changeEvent(input));

      expect(component.uploadFiles().map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);
      expect(component.importError()).toBeNull();
      expect(input.value).toBe('');
    });

    it('ignores an input change with no files', async () => {
      await createDialog();
      component.onUploadInputChange(changeEvent(inputWith('', null)));

      expect(component.uploadFiles()).toEqual([]);
    });

    it('appends dropped files to the existing selection', async () => {
      await createDialog();
      component.uploadFiles.set([jpegFile('a.jpg')]);

      component.onUploadDrop(dragEvent([jpegFile('b.jpg')]));

      expect(component.uploadFiles().map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);
      expect(component.dragOverUpload()).toBe(false);
    });

    it('ignores an empty drop', async () => {
      await createDialog();
      component.onUploadDrop(dragEvent([]));

      expect(component.uploadFiles()).toEqual([]);
    });

    it('tracks drag-over state on the upload area', async () => {
      await createDialog();

      component.onUploadDragOver(dragEvent());
      expect(component.dragOverUpload()).toBe(true);

      component.onUploadDragLeave(dragEvent());
      expect(component.dragOverUpload()).toBe(false);
    });

    it('removes one staged file by index', async () => {
      await createDialog();
      component.uploadFiles.set([jpegFile('a.jpg'), jpegFile('b.jpg'), jpegFile('c.jpg')]);

      component.removeUploadAt(1);

      expect(component.uploadFiles().map((f) => f.name)).toEqual(['a.jpg', 'c.jpg']);
    });

    it('runUpload closes with the created document id for a single file', async () => {
      await createDialog();
      m.importFiles.mockReturnValue(
        of([
          {
            uid: 'file-1',
            title: 'a',
            type: 'File',
            path: `${WS_PATH}/a`,
            lastModified: '',
            properties: {},
          },
        ]),
      );
      component.uploadFiles.set([jpegFile('a.jpg')]);

      component.runUpload();
      await flushAsync();

      expect(m.importFiles).toHaveBeenCalledWith(
        WS_PATH,
        component.uploadFiles(),
        expect.objectContaining({ onProgress: expect.any(Function) }),
      );
      expect(m.toast.show).toHaveBeenCalledWith('Created 1 file.');
      expect(m.close).toHaveBeenCalledWith({
        refreshed: true,
        path: WS_PATH,
        navigateToUid: 'file-1',
      });
      expect(component.busy()).toBe(false);
    });

    it('runUpload leaves the target undecided when several documents were created', async () => {
      await createDialog();
      const doc = (uid: string): NuxeoDocument => ({
        uid,
        title: uid,
        type: 'File',
        path: `${WS_PATH}/${uid}`,
        lastModified: '',
        properties: {},
      });
      m.importFiles.mockReturnValue(of([doc('f1'), doc('f2')]));
      component.uploadFiles.set([jpegFile('a.jpg'), jpegFile('b.jpg')]);

      component.runUpload();
      await flushAsync();

      expect(m.close).toHaveBeenCalledWith({
        refreshed: true,
        path: WS_PATH,
        navigateToUid: undefined,
      });
    });

    it('runUpload does nothing at a restricted location or with no files', async () => {
      await createDialog({ parentPath: '/default-domain' });
      component.uploadFiles.set([jpegFile('a.jpg')]);
      component.runUpload();
      expect(m.importFiles).not.toHaveBeenCalled();

      await createDialog();
      component.runUpload();
      expect(m.importFiles).not.toHaveBeenCalled();
    });
  });

  describe('CSV tab helpers', () => {
    it('tracks drag-over state on the CSV area', async () => {
      await createDialog();

      component.onCsvDragOver(dragEvent());
      expect(component.dragOverCsv()).toBe(true);

      component.onCsvDragLeave(dragEvent());
      expect(component.dragOverCsv()).toBe(false);
    });

    it('clearCsvFile discards the staged CSV', async () => {
      await createDialog();
      component.csvFile.set(new File(['a,b'], 'x.csv'));

      component.clearCsvFile();

      expect(component.csvFile()).toBeNull();
    });

    it('ignores a CSV input change and a CSV drop with no file', async () => {
      await createDialog();

      component.onCsvInputChange(changeEvent(inputWith('x', [])));
      component.onCsvDrop(dragEvent([]));

      expect(component.csvFile()).toBeNull();
      expect(component.error()).toBeNull();
    });

    it('doneNavigateBrowse closes asking the opener to refresh the current folder', async () => {
      await createDialog();

      component.doneNavigateBrowse();

      expect(m.close).toHaveBeenCalledWith({ refreshed: true, path: WS_PATH });
    });
  });
});
