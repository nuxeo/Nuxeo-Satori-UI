import { ComponentFixture, TestBed } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { provideZonelessChangeDetection } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NxsToastService } from '@nuxeo-satori/platform/components';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import {
  BrowseService,
  DirectoryService,
  type DirectoryEntry,
  type L10nDirectoryEntry,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';

import { EditMetadataDialogComponent, type EditMetadataDialogData } from './edit-metadata-dialog';

function l10n(id: string, parent: string, labelEn: string): L10nDirectoryEntry {
  return {
    id,
    directoryName: 'l10ncoverage',
    properties: { id, parent, ordering: 0, obsolete: 0, label_en: labelEn },
  };
}

const coverageEntries: L10nDirectoryEntry[] = [
  l10n('africa', '', 'Africa'),
  l10n('tanzania', 'africa', 'Tanzania'),
];

const subjectEntries: L10nDirectoryEntry[] = [
  l10n('art', '', 'Art'),
  l10n('cinema', 'art', 'Cinema'),
];

const mockDialogRef = { close: vi.fn() };

const mockDirectoryService = {
  getEntries: vi.fn(() => of([])),
  getAllL10nEntries: vi.fn((name: string) =>
    of(name === 'l10nsubjects' ? subjectEntries : coverageEntries),
  ),
};

const mockBrowseService = { updateDocument: vi.fn(() => of({} as NuxeoDocument)) };

const dialogData: EditMetadataDialogData = {
  uid: 'doc-1',
  title: 'Doc',
  description: '',
  nature: '',
  subjects: [],
  coverage: '',
  expires: null,
};

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// NXSAT-192: hierarchical Coverage/Subjects must expose child entries grouped by parent.
describe('EditMetadataDialogComponent (NXSAT-192)', () => {
  let component: EditMetadataDialogComponent;
  let fixture: ComponentFixture<EditMetadataDialogComponent>;

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), testTranslateModule(), EditMetadataDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: DirectoryService, useValue: mockDirectoryService },
        { provide: BrowseService, useValue: mockBrowseService },
      ],
    })
      .overrideComponent(EditMetadataDialogComponent, {
        set: { imports: [], template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EditMetadataDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushAsync();
  });

  it('loads all l10n entries (including children), not just top-level parents', () => {
    expect(mockDirectoryService.getAllL10nEntries).toHaveBeenCalledWith('l10nsubjects');
    expect(mockDirectoryService.getAllL10nEntries).toHaveBeenCalledWith('l10ncoverage');
    expect(component.coverageOptions().map((e) => e.id)).toContain('tanzania');
    expect(component.subjectOptions().map((e) => e.id)).toContain('cinema');
  });

  it('groups subject children under their parent label for the dropdown', () => {
    const groups = component.groupedSubjectOptions();
    expect(groups).toHaveLength(1);
    expect(groups[0].parentLabel).toBe('Art');
    expect(groups[0].entries.map((e) => e.id)).toEqual(['cinema']);
  });

  it('renders the selected child coverage as Parent/Child', () => {
    component.coverage = 'tanzania';
    expect(component.coveragePillLabel('tanzania')).toBe('Africa/Tanzania');
  });
});

function expiresInputEvent(value: string): Event {
  const input = document.createElement('input');
  input.value = value;
  const event = new Event('input');
  Object.defineProperty(event, 'target', { value: input });
  return event;
}

const natureEntries: DirectoryEntry[] = [
  {
    id: 'application-form',
    label: 'Application Form',
    displayLabel: 'Application Form',
    ordering: 1,
    obsolete: 0,
    directoryName: 'nature',
  },
  {
    id: 'contract',
    label: 'Contract',
    displayLabel: 'Contract',
    ordering: 2,
    obsolete: 0,
    directoryName: 'nature',
  },
];

describe('EditMetadataDialogComponent vocabulary pickers and save', () => {
  let component: EditMetadataDialogComponent;
  let fixture: ComponentFixture<EditMetadataDialogComponent>;
  let getEntries: ReturnType<typeof vi.fn<DirectoryService['getEntries']>>;
  let getAllL10nEntries: ReturnType<typeof vi.fn<DirectoryService['getAllL10nEntries']>>;
  let updateDocument: ReturnType<typeof vi.fn<BrowseService['updateDocument']>>;
  let toast: { show: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let close: ReturnType<typeof vi.fn>;

  async function setup(data: EditMetadataDialogData = dialogData): Promise<void> {
    TestBed.resetTestingModule();
    getEntries = vi.fn<DirectoryService['getEntries']>(() => of(natureEntries));
    getAllL10nEntries = vi.fn<DirectoryService['getAllL10nEntries']>((name: string) =>
      of(name === 'l10nsubjects' ? subjectEntries : coverageEntries),
    );
    updateDocument = vi.fn<BrowseService['updateDocument']>(() =>
      of({ uid: 'doc-1', title: 'Saved' } as NuxeoDocument),
    );
    toast = { show: vi.fn(), error: vi.fn() };
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    close = vi.fn();

    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), EditMetadataDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: DirectoryService, useValue: { getEntries, getAllL10nEntries } },
        { provide: BrowseService, useValue: { updateDocument } },
      ],
    })
      .overrideComponent(EditMetadataDialogComponent, {
        set: { imports: [], template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EditMetadataDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushAsync();
  }

  it('seeds the form from the dialog data, copying the subjects array', async () => {
    const subjects = ['cinema'];
    await setup({
      uid: 'doc-9',
      title: 'Invoice',
      description: 'Q1',
      nature: 'contract',
      subjects,
      coverage: 'tanzania',
      expires: '2027-03-04T00:00:00.000Z',
    });

    expect(component.title).toBe('Invoice');
    expect(component.description).toBe('Q1');
    expect(component.nature).toBe('contract');
    expect(component.coverage).toBe('tanzania');
    expect(component.expires?.toISOString()).toBe('2027-03-04T00:00:00.000Z');

    component.removeSubject('cinema');
    expect(component.subjects).toEqual([]);
    expect(subjects).toEqual(['cinema']);
  });

  it('leaves expires null when the document has no expiry', async () => {
    await setup();
    expect(component.expires).toBeNull();
  });

  it('resolves a nature pill to its label, and falls back to the raw id', async () => {
    await setup();

    expect(component.naturePillLabel('application-form')).toBe('Application Form');
    expect(component.naturePillLabel('not-in-vocabulary')).toBe('not-in-vocabulary');
  });

  it('renders a subject pill as Parent/Child', async () => {
    await setup();
    expect(component.subjectPillLabel('cinema')).toBe('Art/Cinema');
  });

  it('clearNature and clearCoverage empty the bound values', async () => {
    await setup();
    component.nature = 'contract';
    component.coverage = 'tanzania';

    component.clearNature();
    component.clearCoverage();

    expect(component.nature).toBe('');
    expect(component.coverage).toBe('');
  });

  it('filters the nature options by the panel search text', async () => {
    await setup();
    component.naturePanelSearch = 'contra';

    expect(component.filteredNatureOptions().map((e) => e.id)).toEqual(['contract']);
  });

  it('refetches nature entries when the panel opens and clears the search when it closes', async () => {
    await setup();
    const callsAfterInit = getEntries.mock.calls.length;
    component.naturePanelSearch = 'stale';

    component.onNaturePanelOpen(true);
    expect(getEntries.mock.calls.length).toBe(callsAfterInit + 1);
    expect(component.natureOptions().map((e) => e.id)).toEqual(['application-form', 'contract']);

    component.onNaturePanelOpen(false);
    expect(component.naturePanelSearch).toBe('');
    expect(getEntries.mock.calls.length).toBe(callsAfterInit + 1);
  });

  it('refetches subjects and coverage on open, and clears their searches on close', async () => {
    await setup();
    const before = getAllL10nEntries.mock.calls.length;

    component.onSubjectsPanelOpen(true);
    component.onCoveragePanelOpen(true);

    expect(getAllL10nEntries.mock.calls.slice(before).map(([name]) => name)).toEqual([
      'l10nsubjects',
      'l10ncoverage',
    ]);
    expect(component.subjectOptions().map((e) => e.id)).toContain('cinema');
    expect(component.coverageOptions().map((e) => e.id)).toContain('tanzania');

    component.subjectsPanelSearch = 'x';
    component.coveragePanelSearch = 'y';
    component.onSubjectsPanelOpen(false);
    component.onCoveragePanelOpen(false);

    expect(component.subjectsPanelSearch).toBe('');
    expect(component.coveragePanelSearch).toBe('');
    expect(getAllL10nEntries.mock.calls.length).toBe(before + 2);
  });

  it('groups coverage children under their parent label', async () => {
    await setup();
    const groups = component.groupedCoverageOptions();

    expect(groups.map((g) => g.parentLabel)).toEqual(['Africa']);
    expect(groups[0].entries.map((e) => e.id)).toEqual(['tanzania']);
  });

  it('flags a malformed expiry typed into the field and clears the flag on a valid pick', async () => {
    await setup();

    component.onExpiresInput(expiresInputEvent('99/99/9999'));

    expect(component.isExpiresValid()).toBe(false);
    expect(component.showExpiresError()).toBe(true);
    expect(component.expiresErrorMatcher.isErrorState()).toBe(true);

    component.onExpiresChange(new Date('2027-01-02T00:00:00.000Z'));

    expect(component.expiresRawText).toBe('');
    expect(component.isExpiresValid()).toBe(true);
    expect(component.showExpiresError()).toBe(false);
  });

  it('tolerates a half-typed date without showing an error', async () => {
    await setup();

    component.onExpiresInput(expiresInputEvent('12/0'));

    expect(component.isExpiresValid()).toBe(true);
    expect(component.showExpiresError()).toBe(false);
  });

  it('keeps the raw text when the datepicker reports an unparseable date', async () => {
    await setup();
    component.onExpiresInput(expiresInputEvent('13/45/2027'));

    component.onExpiresChange(new Date(Number.NaN));

    expect(component.expiresRawText).toBe('13/45/2027');
    expect(component.isExpiresValid()).toBe(false);
  });

  it('saves trimmed title, nulls for empty vocabulary values, and an ISO expiry', async () => {
    await setup();
    component.title = '  Renamed  ';
    component.description = 'A note';
    component.nature = '';
    component.subjects = ['cinema'];
    component.coverage = 'tanzania';
    component.expires = new Date('2027-05-06T00:00:00.000Z');

    component.save();
    await flushAsync();

    expect(updateDocument).toHaveBeenCalledTimes(1);
    const [uid, properties] = updateDocument.mock.calls[0];
    expect(uid).toBe('doc-1');
    expect(properties).toEqual({
      'dc:title': 'Renamed',
      'dc:description': 'A note',
      'dc:nature': null,
      'dc:subjects': ['cinema'],
      'dc:coverage': 'tanzania',
      'dc:expired': '2027-05-06T00:00:00.000Z',
    });
    expect(component.saving()).toBe(false);
    expect(toast.show).toHaveBeenCalledWith('Document updated');
    expect(close).toHaveBeenCalledWith({ uid: 'doc-1', title: 'Saved' });
  });

  it('sends a null expiry when the date was cleared', async () => {
    await setup();
    component.expires = null;

    component.save();
    await flushAsync();

    expect(updateDocument.mock.calls[0][1]).toMatchObject({ 'dc:expired': null });
  });

  it('sends a null expiry when the datepicker parsed a half-typed date to Invalid Date', async () => {
    await setup();
    component.onExpiresInput(expiresInputEvent('12/'));
    component.onExpiresChange(new Date(Number.NaN));

    component.save();
    await flushAsync();

    expect(updateDocument.mock.calls[0][1]).toMatchObject({ 'dc:expired': null });
  });

  it('resets saving and keeps the dialog open when the update fails', async () => {
    await setup();
    updateDocument.mockReturnValue(throwError(() => new Error('500')));

    component.save();
    await flushAsync();

    expect(component.saving()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Failed to update document');
    expect(close).not.toHaveBeenCalled();
  });

  it('does not send a second request while a save is in flight', async () => {
    await setup();
    const inFlight = new Subject<NuxeoDocument>();
    updateDocument.mockReturnValue(inFlight.asObservable());

    component.save();
    component.save();

    expect(updateDocument).toHaveBeenCalledTimes(1);
    expect(component.saving()).toBe(true);

    inFlight.next({ uid: 'doc-1', title: 'Saved' } as NuxeoDocument);
    inFlight.complete();
    await flushAsync();

    expect(component.saving()).toBe(false);
  });

  it('refuses to save while the expiry field holds an invalid date', async () => {
    await setup();
    component.onExpiresInput(expiresInputEvent('99/99/9999'));

    component.save();
    await flushAsync();

    expect(updateDocument).not.toHaveBeenCalled();
    expect(component.saving()).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });
});
