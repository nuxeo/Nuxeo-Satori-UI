import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import {
  BrowseService,
  DirectoryService,
  type NuxeoDocument,
  type L10nDirectoryEntry,
} from '@nuxeo/satori-platform/nuxeo-client';
import { NxsToastService } from '@nuxeo/satori-platform/components';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { EditMetadataDialogComponent } from './edit-metadata-dialog';

const entry = (id: string, label: string, parent = ''): L10nDirectoryEntry => ({
  id,
  directoryName: 'l10ncoverage',
  properties: { id, parent, label_en: label, ordering: 0, obsolete: 0 },
});
const subjects = ['art/cinema'];
const data = {
  uid: 'doc-1',
  title: 'Report',
  description: 'Figures',
  nature: '',
  subjects,
  coverage: 'africa/tanzania',
  expires: null,
};

describe('EditMetadataDialogComponent shared pickers', () => {
  let fixture: ComponentFixture<EditMetadataDialogComponent>;
  let component: EditMetadataDialogComponent;
  const close = vi.fn();
  const update = vi.fn();
  const toast = { show: vi.fn(), error: vi.fn() };
  const directories = {
    getEntries: vi.fn(() => of([])),
    getAllL10nEntries: vi.fn((directory: string) =>
      of(
        directory === 'l10nsubjects'
          ? [entry('art', 'Art'), entry('cinema', 'Cinema', 'art')]
          : [
              entry('africa', 'Africa'),
              entry('tanzania', 'Tanzania', 'africa'),
              entry('antarctica', 'Antarctica'),
            ],
      ),
    ),
  };
  const root = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const type = async (selector: string, text: string) => {
    const input = root().querySelector<HTMLInputElement>(selector)!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await settle();
  };
  beforeEach(async () => {
    vi.clearAllMocks();
    update.mockReturnValue(of({ uid: 'doc-1' }));
    await TestBed.configureTestingModule({
      imports: [EditMetadataDialogComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
        { provide: BrowseService, useValue: { updateDocument: update } },
        { provide: DirectoryService, useValue: directories },
      ],
    }).compileComponents();
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    fixture = TestBed.createComponent(EditMetadataDialogComponent);
    component = fixture.componentInstance;
    await settle();
  });
  afterEach(() =>
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove()),
  );
  it('seeds the document values without sharing its subjects array', () => {
    expect(component.title).toBe('Report');
    expect(component.subjects).toEqual(subjects);
    expect(component.subjects).not.toBe(subjects);
    expect(
      root().querySelector<HTMLInputElement>(
        'nxs-vocabulary-select[directory="l10ncoverage"] input',
      )?.value,
    ).toBe('Africa/Tanzania');
    expect(
      [...root().querySelectorAll('mat-label')].map((n) => n.textContent?.trim()),
    ).toHaveLength(6);
  });
  it('stores a selected child as parent/child and sends the same value to Nuxeo', async () => {
    await type('nxs-vocabulary-select[directory="l10ncoverage"] input', '');
    const input = root().querySelector<HTMLInputElement>(
      'nxs-vocabulary-select[directory="l10ncoverage"] input',
    )!;
    input.focus();
    await settle();
    const option = [...document.querySelectorAll<HTMLElement>('mat-option')].find(
      (n) => n.textContent?.trim() === 'Tanzania',
    );
    expect(option).toBeDefined();
    option!.click();
    await settle();
    expect(component.coverage).toBe('africa/tanzania');
    component.save();
    expect(update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ 'dc:coverage': 'africa/tanzania', 'dc:subjects': ['art/cinema'] }),
    );
  });
  it('allows a parent that has no children', async () => {
    root()
      .querySelector<HTMLInputElement>('nxs-vocabulary-select[directory="l10ncoverage"] input')!
      .focus();
    await settle();
    [...document.querySelectorAll<HTMLElement>('mat-option')]
      .find((n) => n.textContent?.trim() === 'Antarctica')!
      .click();
    await settle();
    component.save();
    expect(update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ 'dc:coverage': 'antarctica' }),
    );
  });
  it('blocks saving text that was not chosen from a vocabulary', async () => {
    await type('nxs-vocabulary-select[directory="nature"] input', 'unlisted');
    component.save();
    expect(update).not.toHaveBeenCalled();
  });
  it('blocks malformed and partial dates while preserving the typed text', async () => {
    await type('nxs-date-input input', '31/');
    component.save();
    expect(update).not.toHaveBeenCalled();
    expect(root().querySelector<HTMLInputElement>('nxs-date-input input')!.value).toBe('31/');
    expect(root().querySelector('mat-error')).not.toBeNull();
  });
  it('saves a cleared expiry as null and closes after success', () => {
    component.title = ' Report ';
    component.save();
    expect(update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ 'dc:title': 'Report', 'dc:expired': null }),
    );
    expect(close).toHaveBeenCalledWith({ uid: 'doc-1' });
    expect(component.saving()).toBe(false);
  });
  it('keeps the dialog and entered values after a failed update', () => {
    update.mockReturnValue(throwError(() => ({ status: 500 })));
    component.save();
    expect(component.saving()).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(component.coverage).toBe('africa/tanzania');
  });
  it('stores a newly chosen subject with its parent id', async () => {
    root()
      .querySelector<HTMLButtonElement>(
        'nxs-vocabulary-select[directory="l10nsubjects"] button[matChipRemove]',
      )
      ?.click();
    await settle();
    const input = root().querySelector<HTMLInputElement>(
      'nxs-vocabulary-select[directory="l10nsubjects"] input',
    );
    input?.focus();
    await settle();
    const cinema = [...document.querySelectorAll<HTMLElement>('mat-option')].find(
      (n) => n.textContent?.trim() === 'Cinema',
    );
    expect(cinema).toBeDefined();
    cinema?.click();
    await settle();
    component.save();
    expect(update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ 'dc:subjects': ['art/cinema'] }),
    );
  });
  it('keeps a vocabulary id the current directory no longer contains', async () => {
    component.coverage = 'legacy/retired';
    component.save();
    expect(update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ 'dc:coverage': 'legacy/retired' }),
    );
  });
  it('writes a valid typed expiry as an ISO instant', async () => {
    await type('nxs-date-input input', '12/31/2027');
    component.save();
    expect(update).toHaveBeenCalledWith(
      'doc-1',
      // The picked day at UTC midnight, the same instant in every zone (NXSAT-727).
      expect.objectContaining({ 'dc:expired': '2027-12-31T00:00:00.000Z' }),
    );
  });
  /**
   * NXSAT-727. The dialog's own read path: a stored expiry seeded through `MAT_DIALOG_DATA`, which
   * is what the constructor converts, rather than the helper called directly.
   *
   * Asserted with literals, so they are the right answer in every zone; `vite.config.mts` pins a
   * non-UTC zone, which is what makes them able to fail at all — in UTC, anchoring a day locally
   * and anchoring it in UTC are byte-identical. `20:00Z` is deliberate: it is the following day at
   * +05:30, so reading the instant's local day gives 1 January and the case can tell the two apart.
   */
  it('reads a stored expiry as the day it names in UTC, and writes that day back unchanged', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EditMetadataDialogComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { ...data, expires: '2027-12-31T20:00:00.000Z' } },
        { provide: MatDialogRef, useValue: { close } },
        { provide: BrowseService, useValue: { updateDocument: update } },
        { provide: DirectoryService, useValue: directories },
      ],
    }).compileComponents();
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    const seeded = TestBed.createComponent(EditMetadataDialogComponent);
    seeded.detectChanges();
    await seeded.whenStable();

    const shown = seeded.componentInstance.expires;
    expect([shown?.getFullYear(), shown?.getMonth(), shown?.getDate()]).toEqual([2027, 11, 31]);

    // Untouched, then saved: the day is written back at UTC midnight, not moved.
    seeded.componentInstance.save();
    expect(update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ 'dc:expired': '2027-12-31T00:00:00.000Z' }),
    );
  });

  it('blocks an invalid stored date and an empty title', () => {
    component.expires = new Date('invalid');
    component.save();
    component.expires = null;
    component.title = '   ';
    component.save();
    expect(update).not.toHaveBeenCalled();
  });
  it('does not submit twice while the first request is in flight', () => {
    update.mockReturnValue(new Subject<NuxeoDocument>());
    component.save();
    component.save();
    expect(update).toHaveBeenCalledTimes(1);
    expect(component.saving()).toBe(true);
  });
});
