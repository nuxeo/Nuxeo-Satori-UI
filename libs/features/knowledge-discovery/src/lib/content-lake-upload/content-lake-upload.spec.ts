import { ComponentFixture, TestBed } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import {
  BrowseService,
  ContentLakeIngestService,
  DocumentImportService,
} from '@nuxeo/satori-platform/nuxeo-client';
import { KdClientService } from '@agentic-ui/shared/kd-client';

import { ContentLakeUploadComponent } from './content-lake-upload';

const mockImportService = {
  getDefaultImportParentPath: vi.fn(() => of('/default-domain')),
  importFiles: vi.fn(() =>
    of([
      {
        uid: 'doc-1',
        title: 'Contract.pdf',
        path: '/default-domain/workspaces/demo/Contract.pdf',
        name: 'Contract.pdf',
        properties: { 'dc:title': 'Contract.pdf' },
      },
    ]),
  ),
};

const mockBrowseService = {
  getByPath: vi.fn(() =>
    of({
      uid: 'folder-1',
      title: 'Domain',
      type: 'Domain',
      path: '/default-domain',
      facets: ['Folderish'],
      properties: {},
      lastModified: '',
    }),
  ),
  getChildren: vi.fn(() =>
    of({
      entries: [
        {
          uid: 'folder-2',
          title: 'Workspaces',
          type: 'WorkspaceRoot',
          path: '/default-domain/workspaces',
          facets: ['Folderish'],
          properties: {},
          lastModified: '',
        },
      ],
    }),
  ),
};

const mockIngestService = {
  startIngest: vi.fn(() => of({ commandId: 'bulk-1' })),
  waitUntilComplete: vi.fn(() =>
    of({ commandId: 'bulk-1', state: 'COMPLETED', processed: 1, error: false, errorCount: 0 }),
  ),
  findDuplicates: vi.fn(() => of([])),
  markIngested: vi.fn(() => of([])),
};

const mockKdClient = {
  listIngestSourceIds: vi.fn(() => of(['source-1'])),
};

const mockRouter = {
  navigateByUrl: vi.fn(() => Promise.resolve(true)),
};

const mockDialogRef = {
  close: vi.fn(),
};

const mockSnackBar = {
  open: vi.fn(),
};

class SelectedFileList implements FileList {
  [index: number]: File;
  readonly length: number;

  constructor(private readonly files: readonly File[]) {
    this.length = files.length;
    files.forEach((file, index) => {
      this[index] = file;
    });
  }

  item(index: number): File | null {
    return this[index] ?? null;
  }

  [Symbol.iterator]() {
    return this.files[Symbol.iterator]();
  }
}

function pathInputEvent(value: string): Event {
  const input = document.createElement('input');
  input.value = value;
  const event = new Event('input');
  input.dispatchEvent(event);
  return event;
}

function fileSelectionEvent(files: readonly File[]): Event {
  const input = document.createElement('input');
  input.type = 'file';
  Object.defineProperty(input, 'files', { value: new SelectedFileList(files) });
  const event = new Event('change');
  input.dispatchEvent(event);
  return event;
}

async function createComponent(): Promise<{
  component: ContentLakeUploadComponent;
  fixture: ComponentFixture<ContentLakeUploadComponent>;
}> {
  await TestBed.configureTestingModule({
    imports: [testTranslateModule(), testTranslateModule(), ContentLakeUploadComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: DocumentImportService, useValue: mockImportService },
      { provide: BrowseService, useValue: mockBrowseService },
      { provide: ContentLakeIngestService, useValue: mockIngestService },
      { provide: KdClientService, useValue: mockKdClient },
      { provide: Router, useValue: mockRouter },
      { provide: MatDialogRef, useValue: mockDialogRef },
      { provide: MatSnackBar, useValue: mockSnackBar },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ContentLakeUploadComponent);
  fixture.detectChanges();
  return { component: fixture.componentInstance, fixture };
}

describe('ContentLakeUploadComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create', async () => {
    const { component } = await createComponent();
    await Promise.resolve();
    expect(component).toBeTruthy();
    expect(component.parentPath()).toBe('/default-domain');
  });

  it('loads subfolder suggestions when the user types /', async () => {
    const { component } = await createComponent();
    await Promise.resolve();

    component.onParentPathUserInput(pathInputEvent('/default-domain/'));
    await Promise.resolve();

    expect(mockBrowseService.getByPath).toHaveBeenCalledWith('/default-domain');
    expect(mockBrowseService.getChildren).toHaveBeenCalled();
    expect(component.filteredFolderOptions()).toHaveLength(1);
    expect(component.filteredFolderOptions()[0].path).toBe('/default-domain/workspaces');
  });

  it('extends the path when a folder suggestion is selected', async () => {
    const { component } = await createComponent();
    await Promise.resolve();

    component.onFolderOptionSelected({
      option: { value: '/default-domain/workspaces' },
    } as never);

    expect(component.parentPath()).toBe('/default-domain/workspaces');
    expect(component.filteredFolderOptions()).toHaveLength(0);
  });

  it('does not reload suggestions after a folder is selected', async () => {
    const { component } = await createComponent();
    await Promise.resolve();
    vi.clearAllMocks();

    component.onFolderOptionSelected({
      option: { value: '/default-domain/workspaces' },
    } as never);
    await Promise.resolve();

    expect(mockBrowseService.getChildren).not.toHaveBeenCalled();
    expect(component.filteredFolderOptions()).toHaveLength(0);
  });

  it('reloads suggestions when typing / after selecting a folder', async () => {
    const { component } = await createComponent();
    await Promise.resolve();

    component.onFolderOptionSelected({
      option: { value: '/default-domain/workspaces' },
    } as never);

    component.onParentPathUserInput(pathInputEvent('/default-domain/workspaces/'));
    await Promise.resolve();

    expect(mockBrowseService.getByPath).toHaveBeenCalledWith('/default-domain/workspaces');
    expect(component.filteredFolderOptions()).toHaveLength(1);
  });

  it('ignores the autocomplete input sync but not the next keystroke', async () => {
    const { component } = await createComponent();
    await Promise.resolve();
    vi.clearAllMocks();

    component.onFolderOptionSelected({
      option: { value: '/default-domain/workspaces' },
    } as never);

    component.onParentPathUserInput(pathInputEvent('/default-domain/workspaces'));
    expect(mockBrowseService.getChildren).not.toHaveBeenCalled();

    component.onParentPathUserInput(pathInputEvent('/default-domain/workspaces/'));
    await Promise.resolve();
    expect(mockBrowseService.getByPath).toHaveBeenCalledWith('/default-domain/workspaces');
  });

  it('uploads to Nuxeo then ingests into Content Lake', async () => {
    const { component } = await createComponent();
    const file = new File(['sample'], 'sample.pdf', { type: 'application/pdf' });
    component.selectedFiles.set([file]);

    component.uploadToContentLake();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockImportService.importFiles).toHaveBeenCalledWith('/default-domain', [file]);
    expect(mockIngestService.startIngest).toHaveBeenCalledWith(['doc-1']);
    expect(mockIngestService.waitUntilComplete).toHaveBeenCalledWith('bulk-1');
    expect(mockIngestService.markIngested).toHaveBeenCalledWith(['doc-1']);
    expect(component.phase()).toBe('complete');
    expect(component.uploadedDocuments()).toHaveLength(1);
    expect(mockSnackBar.open).toHaveBeenCalledWith(
      // Singular, because one document was ingested — the old text said `document(s)` whatever
      // the count, which is the suffix this change removed.
      'Uploaded and ingested 1 document to Content Lake.',
      'OK',
      { duration: 5000 },
    );
    expect(mockDialogRef.close).toHaveBeenCalledWith({
      uploadedDocuments: [expect.objectContaining({ uid: 'doc-1', title: 'Contract.pdf' })],
    });
  });

  it('blocks upload when duplicate Content Lake files are detected', async () => {
    const { component } = await createComponent();
    component.selectedFiles.set([new File(['sample'], 'sample.pdf', { type: 'application/pdf' })]);
    component.duplicateMatches.set([
      {
        fileName: 'sample.pdf',
        existingUid: 'existing-1',
        existingTitle: 'sample.pdf',
        existingPath: '/default-domain/sample.pdf',
      },
    ]);

    component.uploadToContentLake();
    await Promise.resolve();

    expect(component.duplicateMatches()).toHaveLength(1);
    expect(mockImportService.importFiles).not.toHaveBeenCalled();
  });

  it('checks Content Lake using KD source ids when files are selected', async () => {
    const { component } = await createComponent();
    await Promise.resolve();

    component.onFilesSelected(
      fileSelectionEvent([new File(['sample'], 'sample.pdf', { type: 'application/pdf' })]),
    );
    await Promise.resolve();

    expect(mockKdClient.listIngestSourceIds).toHaveBeenCalled();
    expect(mockIngestService.findDuplicates).toHaveBeenCalledWith([expect.any(File)], ['source-1']);
  });

  it('surfaces ingest failures', async () => {
    mockIngestService.waitUntilComplete.mockReturnValueOnce(
      of({ commandId: 'bulk-1', state: 'COMPLETED', processed: 0, error: true, errorCount: 1 }),
    );

    const { component } = await createComponent();
    component.selectedFiles.set([new File(['sample'], 'sample.pdf', { type: 'application/pdf' })]);
    component.uploadToContentLake();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.phase()).toBe('error');
    expect(component.errorMessage()).toContain('errors');
    expect(mockSnackBar.open).toHaveBeenCalledWith(expect.stringContaining('errors'), 'Dismiss', {
      duration: 7000,
    });
    expect(mockDialogRef.close).not.toHaveBeenCalled();
  });

  it('navigates to document detail for uploaded documents', async () => {
    const { component } = await createComponent();
    component.openDocument('doc-1');
    expect(mockDialogRef.close).toHaveBeenCalled();
    expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/doc/doc-1');
  });

  it('closes the dialog when not busy', async () => {
    const { component } = await createComponent();
    component.close();
    expect(mockDialogRef.close).toHaveBeenCalled();
  });
});
