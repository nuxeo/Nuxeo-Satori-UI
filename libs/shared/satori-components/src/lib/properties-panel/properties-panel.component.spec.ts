import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { NxsPropertiesPanelComponent, type NxsVocabularyLabel } from './properties-panel.component';
import { nxsInitial, nxsPropertyText } from './property-text';

const FILE: NuxeoDocument = {
  uid: 'f-1',
  path: '/default-domain/workspaces/ws/report',
  type: 'File',
  title: 'Quarterly report',
  state: 'project',
  facets: ['Versionable', 'NXTag', 'Commentable'],
  lastModified: '2026-05-03T10:00:00.000Z',
  properties: {
    'dc:created': '2026-04-01T09:00:00.000Z',
    'dc:modified': '2026-05-03T10:00:00.000Z',
    'dc:expired': '2027-01-31T00:00:00.000Z',
    'dc:creator': 'jdoe',
    'dc:contributors': ['jdoe', 'asmith'],
    'dc:description': 'Figures for Q1',
    'dc:nature': 'report',
    'dc:coverage': 'europe/France',
    'dc:subjects': ['art/cinema', 'sciences/astronomy'],
    'nxtag:tags': [{ label: 'finance' }, 'q1'],
    'file:content': { name: 'report.pdf', length: '10', data: 'https://x/blob' },
  },
  contextParameters: {
    collections: [
      { uid: 'c-1', title: 'Board pack', type: 'Collection' },
      { uid: 'fav', title: 'Favorites', type: 'Favorites' },
    ],
  },
};

@Component({
  standalone: true,
  imports: [NxsPropertiesPanelComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-properties-panel
      [document]="doc()"
      [vocabularyLabel]="labels()"
      [processRunning]="running()"
      [versionLabel]="version()"
      [publications]="publications()"
      [format]="format()"
      [headingLevel]="3"
      (publicationsSelected)="publicationClicks = publicationClicks + 1"
    >
      <section class="host-extra">Attachments</section>
    </nxs-properties-panel>
  `,
})
class HostComponent {
  readonly doc = signal<NuxeoDocument | null>(FILE);
  readonly labels = signal<NxsVocabularyLabel | null>(null);
  readonly running = signal(false);
  readonly version = signal('1.0+');
  readonly publications = signal<number | null>(2);
  readonly format = signal('');
  publicationClicks = 0;
}

@Component({
  standalone: true,
  imports: [NxsPropertiesPanelComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-properties-panel [document]="doc">
      <button nxsVersion type="button" class="version-control">1.0+</button>
      <div nxsTags class="tag-editor">editor</div>
    </nxs-properties-panel>
  `,
})
class ProjectingHostComponent {
  readonly doc = FILE;
}

describe('NxsPropertiesPanelComponent', () => {
  let fixture: ComponentFixture<HostComponent | ProjectingHostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const people = (label: string): string[] =>
    [...(rowValue(label)?.querySelectorAll('.nxs-properties-panel__person > span') ?? [])].map(
      (node) => node.textContent?.trim() ?? '',
    );
  const value = (label: string): string => {
    const node = rowValue(label);
    return node?.classList.contains('nxs-properties-panel__person')
      ? (node.querySelector(':scope > span')?.textContent?.trim() ?? '')
      : (node?.textContent?.trim() ?? '');
  };
  const rowValue = (label: string): HTMLElement | null => {
    const rows = [
      ...el().querySelectorAll<HTMLElement>(
        '.nxs-properties-panel__row, .nxs-properties-panel__field',
      ),
    ];
    const row = rows.find(
      (node) => node.querySelector('.nxs-properties-panel__label')?.textContent?.trim() === label,
    );
    return (row?.querySelector('.nxs-properties-panel__label')?.nextElementSibling ??
      null) as HTMLElement | null;
  };
  const text = (label: string): string => rowValue(label)?.textContent?.trim() ?? '';

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, ProjectingHostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance as HostComponent;
    await render();
  });

  it('renders nothing without a document', async () => {
    host.doc.set(null);
    await render();
    expect(el().querySelector('.nxs-properties-panel__info')).toBeNull();
  });

  it('shows the lifecycle state, dates, creator and contributors', () => {
    expect(text('State')).toBe('project');
    expect(text('Last modified')).toBe('May 3, 2026');
    expect(text('Created')).toBe('April 1, 2026');
    expect(value('By')).toBe('jdoe');
    expect(people('Contributors')).toEqual(['jdoe', 'asmith']);
    expect(el().querySelectorAll('nxs-avatar[aria-hidden="true"]').length).toBe(3);
  });

  it('shows the Dublin Core properties, with the stored IDs when no labels are given', () => {
    expect(text('Title')).toBe('Quarterly report');
    expect(text('File name')).toBe('report.pdf');
    expect(text('Expires')).toBe('January 31, 2027');
    expect(text('Description')).toBe('Figures for Q1');
    expect(text('Nature')).toBe('report');
    expect(text('Coverage')).toBe('europe/France');
    expect(text('Subjects')).toBe('art/cinema, sciences/astronomy');
  });

  /**
   * Expires is a calendar day a user picked, stored at UTC midnight (NXSAT-727), so it reads as
   * that day in every zone. Created and Last modified are instants the server stamped, and belong
   * in the reader's own zone. The two must NOT be formatted alike, so both halves are asserted.
   *
   * Two things are needed for this to be able to fail, and it asserted nothing without both:
   *
   * - **A zone that is not UTC.** In UTC the two formattings agree, and a CI runner is UTC;
   *   `vite.config.mts` pins this suite to `Asia/Calcutta` for that reason. Setting
   *   `process.env.TZ` from inside the case cannot substitute — this project runs
   *   `pool: 'threads'` and Node has read the zone long before the case runs.
   * - **Instants no earlier render in this file used, whose UTC and local days differ.**
   *   `DatePipe` memoises on (value, pattern, timezone, locale), so re-asserting `FILE`'s own
   *   `dc:expired` returned the string computed for the previous render and passed unfixed.
   *   `20:00Z` is the following day at +05:30; `09:00Z`, which `FILE` uses, is not.
   */
  it('shows Expires as the stored day, while the stamped dates stay in the reader’s zone', async () => {
    host.doc.set({
      ...FILE,
      properties: {
        ...FILE.properties,
        // UTC day 31 January; 01:30 on 1 February locally.
        'dc:expired': '2027-01-31T20:00:00.000Z',
        // UTC day 1 April; 01:30 on 2 April locally.
        'dc:created': '2026-04-01T20:00:00.000Z',
      },
    });
    await render();
    // Zone-free: the stored UTC day, whatever zone the suite is pinned to.
    expect(text('Expires')).toBe('January 31, 2027');
    // Deliberately the PINNED zone's day, not the UTC one. Proving a row is formatted in the
    // reader's zone means naming that zone, so this literal moves if the pin moves — which is the
    // point: if it ever reads `April 1, 2026`, Created has been switched to UTC with Expires.
    expect(text('Created')).toBe('April 2, 2026');
  });

  it('labels vocabulary values through the host’s lookup, keeping the ID when it has none', async () => {
    host.labels.set((directory, id) =>
      directory === 'nature' ? 'Report' : directory === 'l10nsubjects' ? '' : `${directory}:${id}`,
    );
    await render();
    expect(text('Nature')).toBe('Report');
    expect(text('Coverage')).toBe('l10ncoverage:europe/France');
    expect(text('Subjects')).toBe('art/cinema, sciences/astronomy');
  });

  it('never prints [object Object] for resolved directory entries, users or blobs', async () => {
    host.doc.set({
      ...FILE,
      properties: {
        ...FILE.properties,
        'dc:nature': {
          'entity-type': 'directoryEntry',
          properties: { id: 'invoice', label: 'Invoice' },
        },
        'dc:creator': {
          'entity-type': 'user',
          id: 'jdoe',
          properties: { firstName: 'Jane', lastName: 'Doe' },
        },
        'dc:contributors': [{ 'entity-type': 'user', id: 'bob', properties: {} }, { weird: true }],
        'dc:subjects': [{ 'entity-type': 'directoryEntry', properties: { id: 'art/cinema' } }],
        'dc:coverage': { unexpected: 1 },
      },
    });
    await render();
    expect(el().textContent).not.toContain('[object Object]');
    expect(text('Nature')).toBe('Invoice');
    expect(value('By')).toBe('Jane Doe');
    expect(people('Contributors')).toEqual(['bob']);
    expect(text('Subjects')).toBe('art/cinema');
    expect(rowValue('Coverage')).toBeNull();
  });

  it('shows a running process only when told', async () => {
    expect(rowValue('Process')).toBeNull();
    host.running.set(true);
    await render();
    expect(text('Process')).toBe('Running');
  });

  it('shows the version text, a dash without one, and a projected control instead', async () => {
    expect(text('Version')).toBe('1.0+');
    host.version.set('');
    await render();
    expect(text('Version')).toBe('—');
    fixture = TestBed.createComponent(ProjectingHostComponent);
    await render();
    expect(rowValue('Version')?.querySelector('.version-control')).not.toBeNull();
  });

  it('offers the publication count as a button, and 0 as plain text', async () => {
    const button = rowValue('Publications')?.querySelector('button');
    expect(button?.textContent?.trim()).toBe('2');
    button?.click();
    expect(host.publicationClicks).toBe(1);
    host.publications.set(0);
    await render();
    expect(rowValue('Publications')?.querySelector('button')).toBeNull();
    expect(text('Publications')).toBe('0');
    host.publications.set(null);
    await render();
    expect(rowValue('Publications')).toBeNull();
  });

  it('shows the note format only when given', async () => {
    expect(rowValue('Format')).toBeNull();
    host.format.set('Markdown');
    await render();
    expect(text('Format')).toBe('Markdown');
  });

  it('shows tags read-only, only on a document with the NXTag facet', async () => {
    expect(
      [...(rowValue('Tags')?.querySelectorAll('nxs-tag') ?? [])].map((n) => n.textContent?.trim()),
    ).toEqual(['finance', 'q1']);
    host.doc.set({ ...FILE, facets: ['Versionable'] });
    await render();
    expect(rowValue('Tags')).toBeNull();
  });

  it('shows a dash for a taggable document with no tags', async () => {
    host.doc.set({
      ...FILE,
      properties: { ...FILE.properties, 'nxtag:tags': [] },
    });
    await render();
    expect(text('Tags')).toBe('—');
  });

  it('puts a projected tag editor in place of the chips', async () => {
    fixture = TestBed.createComponent(ProjectingHostComponent);
    await render();
    expect(rowValue('Tags')?.querySelector('.tag-editor')).not.toBeNull();
  });

  it('renders projected extras after the Dublin Core properties and before collections', () => {
    const extra = el().querySelector('.host-extra') as HTMLElement;
    const subjects = rowValue('Subjects') as HTMLElement;
    const collections = [...el().querySelectorAll('[role="heading"]')].at(-1) as HTMLElement;
    expect(subjects.compareDocumentPosition(extra) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      extra.compareDocumentPosition(collections) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('lists the collections the document is in, leaving out Favorites', () => {
    const headings = [...el().querySelectorAll('[role="heading"]')];
    expect(headings.map((h) => h.textContent?.trim())).toEqual([
      'Indexing properties',
      'Collections',
    ]);
    expect(headings.every((h) => h.getAttribute('aria-level') === '3')).toBe(true);
    const chips = [...el().querySelectorAll('.nxs-properties-panel__chips nxs-tag')].map((n) =>
      n.textContent?.trim(),
    );
    expect(chips).toContain('Board pack');
    expect(chips).not.toContain('Favorites');
  });

  it('hides the file name of a document whose blob is not persisted, and empty rows', async () => {
    host.doc.set({
      ...FILE,
      state: undefined,
      properties: { 'dc:title': 'Empty' },
      contextParameters: {},
    });
    await render();
    for (const label of ['State', 'File name', 'Expires', 'Description', 'Nature', 'By']) {
      expect(rowValue(label)).toBeNull();
    }
    expect(el().querySelectorAll('[role="heading"]').length).toBe(1);
  });
});

describe('nxsPropertyText', () => {
  it('reads strings, numbers and booleans as they are', () => {
    expect(nxsPropertyText('a')).toBe('a');
    expect(nxsPropertyText(3)).toBe('3');
    expect(nxsPropertyText(false)).toBe('false');
    expect(nxsPropertyText(null)).toBe('');
    expect(nxsPropertyText(undefined)).toBe('');
  });

  it('reads objects for the field that names them, and nothing otherwise', () => {
    expect(nxsPropertyText({ properties: { label_en: 'Cinema' } })).toBe('Cinema');
    expect(nxsPropertyText({ title: 'Board pack' })).toBe('Board pack');
    expect(nxsPropertyText({ name: 'a.pdf', length: 3 })).toBe('a.pdf');
    expect(nxsPropertyText({ 'entity-type': 'user', properties: { username: 'u1' } })).toBe('u1');
    expect(nxsPropertyText({ nested: { deep: 1 } })).toBe('');
    expect(nxsPropertyText(Symbol('s'))).toBe('');
  });

  it('joins arrays, skipping what has nothing to show', () => {
    expect(nxsPropertyText(['a', {}, { id: 'b' }])).toBe('a, b');
  });

  it('gives an initial, or ? for a blank name', () => {
    expect(nxsInitial('jdoe')).toBe('J');
    expect(nxsInitial('  ')).toBe('?');
  });
});
