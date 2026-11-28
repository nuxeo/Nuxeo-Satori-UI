import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { EMPTY, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import {
  BrowseService,
  DirectoryService,
  DocumentDetailService,
  TagService,
  type DirectoryEntry,
  type L10nDirectoryEntry,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

import { BrowseComponent } from './browse';

/**
 * The Browse info panel's folder details: Web UI's folder metadata layout shows a folder's
 * description, nature, subjects, coverage and expiry date under its Details, and the info panel
 * showed none of them (the migration tool's lab mode, `tools/studio-migration/README.md`).
 *
 * Asserted through the rendered panel, not the component's state: what was missing was rows on
 * screen, and a computed value no template reads would pass a state assertion.
 */

// jsdom does not implement it; the Satori breadcrumbs and the Material menu both observe their host.
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

function doc(overrides: Partial<NuxeoDocument> & Pick<NuxeoDocument, 'uid'>): NuxeoDocument {
  return {
    title: 'Contracts',
    type: 'Folder',
    path: '/default-domain/workspaces/ws-1/contracts',
    lastModified: '2026-01-01T00:00:00.000Z',
    facets: ['Folderish'],
    contextParameters: { permissions: ['Read'] },
    properties: {},
    ...overrides,
  };
}

function natureEntry(id: string, label: string): DirectoryEntry {
  return { id, label, displayLabel: label, ordering: 0, obsolete: 0, directoryName: 'nature' };
}

/** An l10n entry as Nuxeo serves it: the leaf as its id, its parent apart. */
function l10nEntry(
  directoryName: string,
  id: string,
  label: string,
  parent = '',
): L10nDirectoryEntry {
  return {
    id,
    directoryName,
    properties: { id, parent, ordering: 0, obsolete: 0, label_en: label },
  };
}

const COVERAGE = [
  l10nEntry('l10ncoverage', 'europe', 'Europe'),
  l10nEntry('l10ncoverage', 'france', 'France', 'europe'),
];
const SUBJECTS = [
  l10nEntry('l10nsubjects', 'art', 'Art'),
  l10nEntry('l10nsubjects', 'architecture', 'Architecture', 'art'),
  l10nEntry('l10nsubjects', 'law', 'Law'),
];

/** A folder with every one of the five set, each vocabulary value as Web UI stores it. */
const described = doc({
  uid: 'folder-1',
  properties: {
    'dc:description': 'Signed supplier contracts',
    'dc:nature': 'contract',
    'dc:subjects': ['art/architecture', 'law'],
    'dc:coverage': 'europe/france',
    // 20:00 UTC is already the next day in the suite's zone (+05:30), so a row formatted in the
    // reader's zone instead of UTC names 1 January 2028 here.
    'dc:expired': '2027-12-31T20:00:00.000Z',
  },
});

const browse = {
  getByPath: vi.fn((): ReturnType<BrowseService['getByPath']> => of(described)),
  getBrowseFolderTypes: vi.fn((): ReturnType<BrowseService['getBrowseFolderTypes']> => EMPTY),
  getBrowseFolderContents: vi.fn((): ReturnType<BrowseService['getBrowseFolderContents']> =>
    of({ folder: described, entries: [], totalSize: 0 }),
  ),
  getFolderContext: vi.fn((): ReturnType<BrowseService['getFolderContext']> => of(described)),
  getChildren: vi.fn((): ReturnType<BrowseService['getChildren']> => EMPTY),
  hasChildCollections: vi.fn((): ReturnType<BrowseService['hasChildCollections']> => of(false)),
  getTrashedChildren: vi.fn((): ReturnType<BrowseService['getTrashedChildren']> => EMPTY),
};

const detail = {
  getFullDocument: vi.fn((): ReturnType<DocumentDetailService['getFullDocument']> => EMPTY),
  fetchThumbnail: vi.fn((): ReturnType<DocumentDetailService['fetchThumbnail']> => EMPTY),
  getAuditLog: vi.fn((): ReturnType<DocumentDetailService['getAuditLog']> => EMPTY),
};

const natureVocabulary = (_name: string): ReturnType<DirectoryService['getEntries']> =>
  of([natureEntry('contract', 'Contract'), natureEntry('invoice', 'Invoice')]);
const l10nVocabulary = (name: string): ReturnType<DirectoryService['getAllL10nEntries']> =>
  of(name === 'l10ncoverage' ? COVERAGE : name === 'l10nsubjects' ? SUBJECTS : []);

const directory = {
  getEventTypes: vi.fn((): ReturnType<DirectoryService['getEventTypes']> => of([])),
  getEventCategories: vi.fn((): ReturnType<DirectoryService['getEventCategories']> => of([])),
  getEntries: vi.fn(natureVocabulary),
  getAllL10nEntries: vi.fn(l10nVocabulary),
};

const manifest = signal<{ extensionLayers: readonly unknown[] }>({ extensionLayers: [] });

describe('BrowseComponent — the info panel shows a folder’s details', () => {
  let fixture: ComponentFixture<BrowseComponent>;

  beforeEach(() => {
    vi.clearAllMocks();
    directory.getEntries.mockImplementation(natureVocabulary);
    directory.getAllL10nEntries.mockImplementation(l10nVocabulary);
    serve(described);
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  /** The folder Browse opens. */
  function serve(folder: NuxeoDocument): void {
    browse.getByPath.mockReturnValue(of(folder));
    browse.getFolderContext.mockReturnValue(of(folder));
    browse.getBrowseFolderContents.mockReturnValue(of({ folder, entries: [], totalSize: 0 }));
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Browse on the served folder, its info panel closed as a visit starts. */
  async function render(): Promise<BrowseComponent> {
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
        { provide: DirectoryService, useValue: directory },
        { provide: TagService, useValue: { suggestTags: vi.fn(() => of([])) } },
        { provide: MatDialog, useValue: { open: vi.fn(() => ({ afterClosed: () => of(false) })) } },
        { provide: AppConfigService, useValue: { manifest } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BrowseComponent);
    await settle();
    return fixture.componentInstance;
  }

  /** Browse with its info panel open on the Info view, as the panel toggle opens it. */
  async function openInfoPanel(): Promise<BrowseComponent> {
    const component = await render();
    component.togglePanel();
    await settle();
    // Outlets learn from a promise that their IDs are unregistered, and a vocabulary arrives after
    // the panel has rendered once without it.
    await new Promise((resolve) => setTimeout(resolve));
    await settle();
    return component;
  }

  /** Each row of the panel's Properties section, as its label and its value read. */
  function propertyRows(): Array<[string, string]> {
    const section = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '.details-panel .panel-info-section',
      ),
    ].find(
      (element) =>
        element.querySelector('.panel-section-title')?.textContent?.trim() === 'Properties',
    );
    expect(section, 'the Properties section').toBeDefined();
    return [...(section as HTMLElement).querySelectorAll<HTMLElement>('.panel-info-row')].map(
      (row) => [
        row.querySelector('.info-label')?.textContent?.trim() ?? '',
        row.querySelector('.info-value')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      ],
    );
  }

  const labels = (): string[] => propertyRows().map(([label]) => label);
  const valueOf = (label: string): string | undefined =>
    propertyRows().find(([name]) => name === label)?.[1];
  /** The Subjects row's list items, each as it reads. */
  const subjectItems = (): Array<string | undefined> =>
    [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '.details-panel .panel-info-row ul.info-value li',
      ),
    ].map((item) => item.textContent?.trim());

  it('shows the description, nature, subjects, coverage and expiry date, after the title and type', async () => {
    await openInfoPanel();

    expect(labels()).toEqual([
      'Title',
      'Type',
      'Description',
      'Nature',
      'Subjects',
      'Coverage',
      'Expires',
    ]);
    expect(valueOf('Title')).toBe('Contracts');
    expect(valueOf('Description')).toBe('Signed supplier contracts');
  });

  it('shows nature and coverage by their vocabulary labels, not their stored IDs', async () => {
    await openInfoPanel();

    expect(valueOf('Nature')).toBe('Contract');
    // As the document page's Properties panel labels it: the parent and the child, from the
    // value Web UI stores, `europe/france`.
    expect(valueOf('Coverage')).toBe('Europe/France');
    expect(directory.getEntries.mock.calls).toEqual([['nature']]);
    expect(directory.getAllL10nEntries.mock.calls.map(([name]) => name).sort()).toEqual([
      'l10ncoverage',
      'l10nsubjects',
    ]);
  });

  it('shows the subjects as a list, one item per subject, each by its vocabulary label', async () => {
    await openInfoPanel();

    expect(subjectItems()).toEqual(['Art/Architecture', 'Law']);
  });

  it('shows the expiry date as the calendar day it is stored as, in UTC', async () => {
    await openInfoPanel();

    expect(valueOf('Expires')).toBe('Dec 31, 2027');
  });

  it('keeps the stored ID when a vocabulary cannot be read', async () => {
    directory.getEntries.mockImplementation(() => throwError(() => new Error('500')));
    directory.getAllL10nEntries.mockImplementation(() => throwError(() => new Error('500')));

    await openInfoPanel();

    expect(valueOf('Nature')).toBe('contract');
    expect(valueOf('Coverage')).toBe('europe/france');
    expect(subjectItems()).toEqual(['art/architecture', 'law']);
  });

  it('shows none of the five rows for a folder that has no value in them', async () => {
    serve(
      doc({
        uid: 'folder-2',
        properties: {
          'dc:description': '',
          'dc:nature': null,
          'dc:subjects': [],
          'dc:coverage': '',
          'dc:expired': null,
        },
      }),
    );

    await openInfoPanel();

    expect(labels()).toEqual(['Title', 'Type']);
    // Nothing to label, so no vocabulary is read.
    expect(directory.getEntries).not.toHaveBeenCalled();
    expect(directory.getAllL10nEntries).not.toHaveBeenCalled();
  });

  it('shows only the rows that have a value', async () => {
    serve(
      doc({
        uid: 'folder-3',
        properties: { 'dc:description': 'Only a description', 'dc:subjects': [] },
      }),
    );

    await openInfoPanel();

    expect(labels()).toEqual(['Title', 'Type', 'Description']);
    expect(valueOf('Description')).toBe('Only a description');
  });

  it('does not show them for a document that is not folderish', async () => {
    serve({ ...described, uid: 'file-1', type: 'File', facets: [] });

    await openInfoPanel();

    expect(labels()).toEqual(['Title', 'Type']);
    expect(directory.getEntries).not.toHaveBeenCalled();
  });

  it('reads no vocabulary until the info panel is open, and each one once', async () => {
    const component = await render();
    expect(component.currentDoc()?.uid).toBe('folder-1');
    expect(directory.getEntries).not.toHaveBeenCalled();
    expect(directory.getAllL10nEntries).not.toHaveBeenCalled();

    component.togglePanel();
    await settle();
    expect(directory.getEntries).toHaveBeenCalledTimes(1);
    expect(directory.getAllL10nEntries).toHaveBeenCalledTimes(2);

    component.closePanel();
    await settle();
    component.togglePanel();
    await settle();
    expect(valueOf('Nature')).toBe('Contract');
    expect(directory.getEntries).toHaveBeenCalledTimes(1);
    expect(directory.getAllL10nEntries).toHaveBeenCalledTimes(2);
  });
});
