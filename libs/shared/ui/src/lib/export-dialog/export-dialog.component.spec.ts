import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, Subject } from 'rxjs';
import { type Mock, vi } from 'vitest';

import {
  ExportDialogComponent,
  type ExportDialogData,
  type ExportType,
} from './export-dialog.component';

/**
 * Browse, the record page and collections open this dialog to download a document as one of four
 * renditions. The page supplies the download; the dialog names the file, saves it through a blob
 * URL it revokes, and closes once the file is saved.
 */
describe('ExportDialogComponent', () => {
  let fixture: ComponentFixture<ExportDialogComponent>;
  let close: ReturnType<typeof vi.fn>;
  let exportFn: Mock<(type: ExportType, uid: string) => Observable<Blob>>;
  let downloads: Subject<Blob>[];
  let saved: { href: string; download: string }[];
  let revoked: string[];

  beforeEach(async () => {
    close = vi.fn();
    downloads = [];
    exportFn = vi.fn((_type: ExportType, _uid: string): Observable<Blob> => {
      const download = new Subject<Blob>();
      downloads.push(download);
      return download;
    });
    saved = [];
    revoked = [];
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:export-1'),
      revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push({ href: this.href, download: this.download });
    });

    await TestBed.configureTestingModule({
      imports: [ExportDialogComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            documentUid: 'doc-1',
            documentTitle: 'Q3 report',
            exportFn,
          } satisfies ExportDialogData,
        },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ExportDialogComponent);
    await settle();
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
    Object.assign(URL, { createObjectURL: undefined, revokeObjectURL: undefined });
  });

  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const options = (): HTMLButtonElement[] => [
    ...fixture.nativeElement.querySelectorAll('button.export-option'),
  ];
  const option = (label: string): HTMLButtonElement => {
    const found = options().find((b) => b.textContent?.trim() === label);
    if (!found) throw new Error(`no "${label}" option`);
    return found;
  };
  const cancel = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('mat-dialog-actions button');
  const file = () => new Blob(['%PDF-1.7'], { type: 'application/pdf' });

  it('offers the four renditions, by name', () => {
    expect(fixture.nativeElement.querySelector('h2').textContent.trim()).toBe('Export');
    expect(options().map((b) => b.textContent?.trim())).toEqual([
      'Thumbnail',
      'PDF',
      'ZIP Export',
      'XML Export',
    ]);
  });

  it('asks the page for the chosen rendition of this document', async () => {
    option('PDF').click();
    await settle();

    expect(exportFn).toHaveBeenCalledWith('pdf', 'doc-1');
  });

  it.each([
    ['Thumbnail', 'thumbnail', 'Q3 report.png'],
    ['PDF', 'pdf', 'Q3 report.pdf'],
    ['ZIP Export', 'zip', 'Q3 report.zip'],
    ['XML Export', 'xml', 'Q3 report.xml'],
  ] as const)(
    'saves the %s rendition as the document title with its extension',
    async (label, type, filename) => {
      option(label).click();
      await settle();
      expect(exportFn).toHaveBeenCalledWith(type, 'doc-1');

      downloads[0].next(file());
      await settle();

      expect(saved).toEqual([{ href: 'blob:export-1', download: filename }]);
    },
  );

  it('revokes the blob URL once the file is saved, and closes with true', async () => {
    option('ZIP Export').click();
    await settle();

    downloads[0].next(file());
    await settle();

    expect(revoked).toEqual(['blob:export-1']);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('disables every option and Cancel while a rendition downloads, spinning on the chosen one', async () => {
    option('PDF').click();
    await settle();

    expect(options().every((b) => b.disabled)).toBe(true);
    expect(cancel().disabled).toBe(true);
    expect(option('PDF').querySelector('mat-spinner')).not.toBeNull();
    expect(option('ZIP Export').querySelector('mat-spinner')).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it('starts one download at a time, however often an option is chosen', async () => {
    fixture.componentInstance.onExport('pdf');
    fixture.componentInstance.onExport('zip');
    await settle();

    expect(exportFn).toHaveBeenCalledTimes(1);
    expect(exportFn).toHaveBeenCalledWith('pdf', 'doc-1');
  });

  it('stays open with every option enabled again when the download fails, so it can be retried', async () => {
    option('PDF').click();
    await settle();

    downloads[0].error(new Error('no converter'));
    await settle();

    expect(close).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(options().every((b) => !b.disabled)).toBe(true);
    expect(cancel().disabled).toBe(false);

    option('ZIP Export').click();
    await settle();
    expect(exportFn).toHaveBeenLastCalledWith('zip', 'doc-1');
  });
});
