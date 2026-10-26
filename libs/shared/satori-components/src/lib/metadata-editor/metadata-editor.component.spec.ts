import {
  Component,
  Injectable,
  LOCALE_ID,
  provideZonelessChangeDetection,
  signal,
  viewChild,
  type Type,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DateAdapter, NativeDateAdapter } from '@angular/material/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  DirectoryService,
  type DirectoryEntry,
  type L10nDirectoryEntry,
} from '@nuxeo/satori-platform/nuxeo-client';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { CalendarDayAdapter } from '../date-input/calendar-day-adapter.mock';
import { NxsMetadataEditorComponent } from './metadata-editor.component';
import type { NxsEditorDisplay, NxsEditorSection, NxsEditorValues } from './metadata-editor.model';

const NATURE: DirectoryEntry[] = [
  {
    id: 'report',
    label: 'Report',
    displayLabel: 'Report',
    ordering: 0,
    obsolete: 0,
    directoryName: 'nature',
  },
  {
    id: 'invoice',
    label: 'Invoice',
    displayLabel: 'Invoice',
    ordering: 0,
    obsolete: 0,
    directoryName: 'nature',
  },
];

const l10n = (id: string, label: string, parent = ''): L10nDirectoryEntry => ({
  id,
  directoryName: 'l10nsubjects',
  properties: { id, parent, ordering: 0, obsolete: 0, label_en: label },
});

const SUBJECTS = [
  l10n('art', 'Art'),
  l10n('cinema', 'Cinema', 'art'),
  l10n('music', 'Music', 'art'),
];

const DOCUMENT_VALUES: NxsEditorValues = {
  'dc:title': 'Quarterly report',
  'dc:description': 'Figures',
  'dc:nature': 'report',
  'dc:subjects': ['art/cinema'],
  'dc:coverage': null,
  'dc:expired': '2027-01-31T00:00:00.000Z',
  'pol:number': 'AB-12',
  'pol:premium': 10,
  'pol:codes': ['x1'],
  'pol:active': true,
  'pol:scan': { name: 'scan.pdf', length: '12' },
  'pol:holder': { name: 'Ada', email: 'ada@example.com' },
  'pol:contacts': [{ name: 'Bob', phone: '1' }],
};

const POLICY: NxsEditorSection = {
  id: 'policy',
  heading: 'Policy',
  fields: [
    { xpath: 'dc:title', label: 'Duplicate title', definition: { type: 'string' } },
    {
      xpath: 'pol:number',
      label: 'Policy number',
      definition: { type: 'string', required: true, constraints: { pattern: '[A-Z]{2}-\\d+' } },
    },
    {
      xpath: 'pol:premium',
      label: 'Premium',
      definition: {
        type: 'long',
        constraints: { minimum: 0, minimumInclusive: false, maximum: 100 },
      },
    },
    {
      xpath: 'pol:notes',
      label: 'Notes',
      definition: { type: 'string', constraints: { maxLength: 5 } },
      multiline: true,
    },
    {
      xpath: 'pol:codes',
      label: 'Codes',
      definition: { type: 'string[]', constraints: { maxLength: 3 } },
    },
    { xpath: 'pol:active', label: 'Active', definition: { type: 'boolean' } },
    { xpath: 'pol:scan', label: 'Scan', definition: { type: 'blob' } },
    {
      xpath: 'pol:holder',
      label: 'Holder',
      definition: {
        type: 'complex',
        fields: { name: { type: 'string' }, email: { type: 'string', directory: 'emails' } },
      },
    },
    {
      xpath: 'pol:contacts',
      label: 'Contacts',
      definition: {
        type: 'complex[]',
        required: true,
        fields: { name: { type: 'string', required: true }, phone: { type: 'string' } },
      },
    },
  ],
};

const SECOND: NxsEditorSection = {
  id: 'claims',
  heading: 'Claims',
  fields: [
    { xpath: 'cl:ref', label: 'Claim reference', definition: { type: 'string', required: true } },
  ],
};

@Component({
  standalone: true,
  imports: [NxsMetadataEditorComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-metadata-editor
      [sections]="sections()"
      [values]="values()"
      [display]="display()"
      [disabled]="disabled()"
      [dublinCore]="dublinCore()"
      [headingLevel]="3"
      (validChange)="validity.push($event)"
    />
  `,
})
class HostComponent {
  readonly sections = signal<readonly NxsEditorSection[]>([POLICY]);
  readonly values = signal<NxsEditorValues>(DOCUMENT_VALUES);
  readonly display = signal<NxsEditorDisplay>('sections');
  readonly disabled = signal(false);
  readonly dublinCore = signal(true);
  readonly editor = viewChild.required(NxsMetadataEditorComponent);
  readonly validity: boolean[] = [];
}

const CODES_ONLY: NxsEditorSection = {
  id: 'codes',
  heading: null,
  fields: [{ xpath: 'pol:codes', label: 'Codes', definition: { type: 'string[]' } }],
};

@Component({
  standalone: true,
  imports: [NxsMetadataEditorComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-metadata-editor [sections]="sections" [dublinCore]="false" />
    <nxs-metadata-editor [sections]="sections" [dublinCore]="false" />`,
})
class TwoEditorsComponent {
  readonly sections = [CODES_ONLY];
}

/** The text of the labels that name an input, as `getByLabelText` finds it. */
const labelsOf = (input: HTMLInputElement) =>
  [...(input.labels ?? [])].map((label) => label.textContent?.trim());

describe('NxsMetadataEditorComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let element: HTMLElement;
  const directories = {
    getEntries: vi.fn((_: string) => of(NATURE)),
    getAllL10nEntries: vi.fn((_: string) => of(SUBJECTS)),
  };

  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const field = <T extends HTMLElement = HTMLInputElement>(xpath: string): T => {
    const found = element.querySelector<T>(`[data-xpath="${xpath}"]`);
    if (!found) throw new Error(`no field ${xpath}`);
    return (found.tagName === 'NXS-DATE-INPUT' ? found.querySelector('input') : found) as T;
  };
  const type = async (xpath: string, text: string) => {
    const input = field<HTMLInputElement | HTMLTextAreaElement>(xpath);
    input.value = text;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await settle();
  };
  const errors = () =>
    [...element.querySelectorAll('mat-error, .nxs-metadata-editor__error')].map((node) =>
      node.textContent?.trim(),
    );
  const summary = () =>
    element
      .querySelector('[role="alert"] .nxs-metadata-editor__summary-text')
      ?.textContent?.trim() ?? null;

  beforeEach(async () => {
    directories.getEntries.mockClear();
    directories.getAllL10nEntries.mockClear();
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: DirectoryService, useValue: directories },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    element = fixture.nativeElement;
    await settle();
  });

  afterEach(() =>
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove()),
  );

  it('shows the Dublin Core fields with the current values, vocabulary values by label', () => {
    expect(field('dc:title').value).toBe('Quarterly report');
    expect(field<HTMLTextAreaElement>('dc:description').value).toBe('Figures');
    expect(field('dc:nature').querySelector('input')?.value).toBe('Report');
    expect(field('dc:subjects').textContent).toContain('Art/Cinema');
    expect(field('dc:expired').value).not.toBe('');
    const labels = [...element.querySelectorAll('mat-label')].map((node) =>
      node.textContent?.trim(),
    );
    expect(labels.slice(0, 6)).toEqual([
      'Title',
      'Description',
      'Nature',
      'Subjects',
      'Coverage',
      'Expires',
    ]);
  });

  it('loads each vocabulary once, a hierarchical one through its localized entries', () => {
    expect(directories.getEntries.mock.calls.map(([name]) => name).sort()).toEqual([
      'emails',
      'nature',
    ]);
    expect(directories.getAllL10nEntries.mock.calls.map(([name]) => name).sort()).toEqual([
      'l10ncoverage',
      'l10nsubjects',
    ]);
  });

  it('asks once for a directory every row of a repeatable group uses, and again in a new editor', async () => {
    const asked = (directory: string) =>
      directories.getEntries.mock.calls.filter(([name]) => name === directory).length;
    host.sections.set([
      {
        id: 'topics',
        heading: 'Topics',
        fields: [
          {
            xpath: 'tp:rows',
            label: 'Rows',
            definition: {
              type: 'complex[]',
              fields: { topic: { type: 'string', directory: 'topics' } },
            },
          },
        ],
      },
    ]);
    host.values.set({ 'tp:rows': [{ topic: 'report' }, { topic: 'invoice' }, { topic: null }] });
    await settle();
    expect(element.querySelectorAll('nxs-vocabulary-select[data-xpath^="tp:rows/"]')).toHaveLength(
      3,
    );
    field<HTMLFieldSetElement>('tp:rows')
      .querySelector<HTMLButtonElement>('.nxs-metadata-editor__add')
      ?.click();
    await settle();
    expect(element.querySelectorAll('nxs-vocabulary-select[data-xpath^="tp:rows/"]')).toHaveLength(
      4,
    );
    expect(asked('topics')).toBe(1);
    expect(asked('nature')).toBe(1);

    fixture.destroy();
    fixture = TestBed.createComponent(HostComponent);
    element = fixture.nativeElement;
    await settle();
    expect(asked('nature')).toBe(2);
  });

  it('renders a section under a heading at the given level, skipping a field Dublin Core has', () => {
    const heading = element.querySelector('[role="heading"]');
    expect(heading?.textContent?.trim()).toBe('Policy');
    expect(heading?.getAttribute('aria-level')).toBe('3');
    expect(element.querySelector('section')?.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(element.querySelectorAll('[data-xpath="dc:title"]')).toHaveLength(1);
    expect(element.textContent).not.toContain('Duplicate title');
  });

  it('reports nothing changed until the user edits, then only what changed, trimmed', async () => {
    expect(host.editor().dirtyProperties()).toEqual({});
    await type('dc:title', '  New title  ');
    await type('dc:description', '  kept as typed ');
    expect(host.editor().dirtyProperties()).toEqual({
      'dc:title': 'New title',
      'dc:description': '  kept as typed ',
    });
    await type('dc:description', '   ');
    expect(host.editor().dirtyProperties()['dc:description']).toBeNull();
  });

  it('blocks Save on an empty title, announces it, names the field and focuses it', async () => {
    await type('dc:title', '');
    expect(host.editor().validate()).toBe(false);
    await settle();
    expect(summary()).toBe('1 field needs a correction before you can save.');
    expect(errors()).toContain('Title is required.');
    const error = field('dc:title').closest('mat-form-field')?.querySelector('mat-error');
    expect(field('dc:title').getAttribute('aria-required')).toBe('true');
    expect(field('dc:title').getAttribute('aria-describedby')).toContain(error?.id);
    expect(document.activeElement).toBe(field('dc:title'));
  });

  it('checks the schema constraints as the user types, and counts every field in error', async () => {
    await type('pol:number', 'bad');
    await type('pol:premium', '0');
    await type('pol:notes', 'too long');
    expect(errors()).toEqual(
      expect.arrayContaining([
        'Policy number is not in the expected format.',
        'Premium must be more than 0.',
        'Notes must be at most 5 characters.',
      ]),
    );
    expect(host.validity.at(-1)).toBe(false);
    expect(host.editor().validate()).toBe(false);
    await settle();
    expect(summary()).toBe('3 fields need a correction before you can save.');
    await type('pol:number', 'CD-9');
    await type('pol:premium', '100');
    await type('pol:notes', 'ok');
    expect(summary()).toBeNull();
    expect(host.validity.at(-1)).toBe(true);
    expect(host.editor().validate()).toBe(true);
  });

  it('rejects a decimal for a whole-number field and a value past the maximum', async () => {
    await type('pol:premium', '2.5');
    expect(errors()).toContain('Premium must be a whole number.');
    await type('pol:premium', '101');
    expect(errors()).toContain('Premium must be 100 or less.');
  });

  it('says so when a date field holds text that is not a date', async () => {
    await type('dc:expired', 'not a date');
    expect(errors()).toContain(`Enter a date like 12/31/${new Date().getFullYear()}`);
  });

  it('shows a file read-only by its name, and never sends it', () => {
    const scan = field<HTMLElement>('pol:scan');
    expect(scan.textContent).toContain('scan.pdf');
    expect(scan.textContent).not.toContain('[object Object]');
    expect(Object.keys(host.editor().properties())).not.toContain('pol:scan');
  });

  it('edits a complex field through its sub-fields and sends it whole', async () => {
    const holder = field<HTMLFieldSetElement>('pol:holder');
    expect(holder.querySelector('legend')?.textContent?.trim()).toBe('Holder');
    expect(holder.textContent).toContain('Email');
    await type('pol:holder/name', 'Grace');
    expect(host.editor().dirtyProperties()).toEqual({
      'pol:holder': { name: 'Grace', email: 'ada@example.com' },
    });
  });

  it('adds and removes entries of a repeatable group, each named by its position', async () => {
    const contacts = () => field<HTMLFieldSetElement>('pol:contacts');
    const add = () => contacts().querySelector<HTMLButtonElement>('.nxs-metadata-editor__add');
    expect(contacts().querySelectorAll('.nxs-metadata-editor__item')).toHaveLength(1);
    add()?.click();
    await settle();
    const legends = [...contacts().querySelectorAll('.nxs-metadata-editor__item > legend')];
    expect(legends.map((node) => node.textContent?.trim())).toEqual(['Contacts 1', 'Contacts 2']);
    await type('pol:contacts/1/name', 'Cy');
    expect(host.editor().dirtyProperties()['pol:contacts']).toEqual([
      { name: 'Bob', phone: '1' },
      { name: 'Cy', phone: null },
    ]);
    const remove = contacts().querySelectorAll<HTMLButtonElement>('.nxs-metadata-editor__remove');
    expect(remove[0]?.getAttribute('aria-label')).toBe('Remove Contacts 1');
    remove[0]?.click();
    await settle();
    expect(host.editor().dirtyProperties()['pol:contacts']).toEqual([{ name: 'Cy', phone: null }]);
  });

  it('marks an empty required group on Save and focuses its Add button', async () => {
    field<HTMLFieldSetElement>('pol:contacts')
      .querySelector<HTMLButtonElement>('.nxs-metadata-editor__remove')
      ?.click();
    await settle();
    expect(host.editor().validate()).toBe(false);
    await settle();
    const add = field<HTMLFieldSetElement>('pol:contacts').querySelector<HTMLButtonElement>(
      '.nxs-metadata-editor__add',
    );
    expect(errors()).toContain('Contacts is required.');
    expect(add?.getAttribute('aria-describedby')).toBe(
      element.querySelector('.nxs-metadata-editor__error')?.id,
    );
    expect(document.activeElement).toBe(add);
  });

  it('adds a value to a list as a chip, and removes it again', async () => {
    const input = field('pol:codes');
    input.value = 'y2';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await settle();
    expect(host.editor().dirtyProperties()['pol:codes']).toEqual(['x1', 'y2']);
    input.value = 'toolong';
    input.dispatchEvent(new Event('blur'));
    await settle();
    expect(errors()).toContain('One of the values of Codes is not valid.');
    const removeButtons = element.querySelectorAll<HTMLButtonElement>(
      '[data-xpath="pol:codes"] ~ * button, mat-chip-row button',
    );
    const last = [...removeButtons].find(
      (button) => button.getAttribute('aria-label') === 'Remove toolong',
    );
    last?.click();
    await settle();
    expect(host.editor().dirtyProperties()['pol:codes']).toEqual(['x1', 'y2']);
  });

  it('names a list’s typing box by the field’s label, through an id of its own', () => {
    const input = field('pol:codes');
    expect(input.id).toMatch(/^nxs-metadata-editor-\d+-pol:codes-input$/);
    expect(labelsOf(input)).toEqual(['Codes']);
  });

  it('removes a vocabulary value from its chip', async () => {
    const remove = field('dc:subjects').querySelector<HTMLButtonElement>(
      'button[matChipRemove], .mat-mdc-chip-remove',
    );
    expect(remove?.getAttribute('aria-label')).toBe('Remove Art/Cinema');
    remove?.click();
    await settle();
    expect(host.editor().dirtyProperties()).toEqual({ 'dc:subjects': [] });
  });

  it('lists a vocabulary in its panel, filtered by the search box', async () => {
    field<HTMLElement>('dc:nature').querySelector<HTMLInputElement>('input')?.focus();
    await settle();
    const options = () =>
      [...document.querySelectorAll('mat-option')].map((node) => node.textContent?.trim());
    expect(options()).toEqual(['Invoice', 'Report']);
    const search = field<HTMLElement>('dc:nature').querySelector<HTMLInputElement>('input');
    expect(labelsOf(search as HTMLInputElement)).toEqual(['Nature']);
    if (search) {
      search.value = 'rep';
      search.dispatchEvent(new Event('input'));
    }
    await settle();
    expect(options()).toEqual(['Report']);
  });

  it('puts server messages on their fields until the value changes, and hands back the rest', async () => {
    const unplaced = host.editor().showServerErrors({
      'pol:number': 'Already used by another policy',
      'other:field': 'Not on this form',
    });
    await settle();
    expect(unplaced).toEqual(['Not on this form']);
    expect(errors()).toContain('Already used by another policy');
    expect(summary()).toBe('1 field needs a correction before you can save.');
    await type('pol:number', 'ZZ-1');
    expect(errors()).not.toContain('Already used by another policy');
  });

  it('keeps a message that arrives while saving once the form is enabled again, and focuses its field', async () => {
    host.disabled.set(true);
    await settle();
    expect(host.editor().showServerErrors({ 'dc:description': 'Too long.' })).toEqual([]);
    host.disabled.set(false);
    await settle();
    await settle();
    expect(errors()).toContain('Too long.');
    expect(summary()).toBe('1 field needs a correction before you can save.');
    expect(document.activeElement?.getAttribute('data-xpath')).toBe('dc:description');
    expect(host.editor().validate()).toBe(false);
    await type('dc:description', 'Shorter');
    expect(errors()).not.toContain('Too long.');
    expect(host.editor().validate()).toBe(true);
  });

  it('ties a server message on a date or vocabulary field to its input, which takes focus', async () => {
    host.editor().showServerErrors({
      'dc:subjects': 'Not an allowed subject.',
      'dc:expired': 'Must be in the future.',
    });
    await settle();
    await settle();
    const describedBy = (input: Element | null | undefined) =>
      (input?.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => element.querySelector(`[id="${id}"]`)?.textContent?.trim());
    const subjects = field<HTMLElement>('dc:subjects').querySelector('input');
    expect(describedBy(subjects)).toContain('Not an allowed subject.');
    expect(describedBy(field('dc:expired'))).toContain('Must be in the future.');
    expect(element.querySelectorAll('p.nxs-metadata-editor__error')).toHaveLength(0);
    expect(document.activeElement).toBe(subjects);
  });

  it('focuses the text typed into a vocabulary field that already has a chip, not the chip', async () => {
    const subjects = field<HTMLElement>('dc:subjects').querySelector('input') as HTMLInputElement;
    subjects.value = 'unlisted';
    subjects.dispatchEvent(new Event('input'));
    await settle();
    expect(host.editor().validate()).toBe(false);
    await settle();
    expect(field('dc:subjects').querySelector('mat-chip-row')).not.toBeNull();
    expect(document.activeElement).toBe(subjects);
  });

  it('shows a message filed under a complex field on the group, tied to it', async () => {
    host.editor().showServerErrors({ 'pol:holder': 'Holder is not valid.' });
    await settle();
    const group = field<HTMLFieldSetElement>('pol:holder');
    const message = group.querySelector('.nxs-metadata-editor__error');
    expect(message?.textContent?.trim()).toBe('Holder is not valid.');
    expect(group.getAttribute('aria-describedby')).toBe(message?.id);
  });

  it('gives every value for a create, in the shape the server takes', () => {
    expect(host.editor().properties()).toMatchObject({
      'dc:title': 'Quarterly report',
      'dc:coverage': null,
      'dc:expired': '2027-01-31T00:00:00.000Z',
      'pol:premium': 10,
      'pol:active': true,
      'pol:notes': null,
    });
  });

  it('discards what was typed when given a new set of values', async () => {
    await type('dc:title', '');
    host.editor().validate();
    await settle();
    host.values.set({ ...DOCUMENT_VALUES, 'dc:title': 'Reloaded' });
    await settle();
    expect(field('dc:title').value).toBe('Reloaded');
    expect(summary()).toBeNull();
    expect(host.editor().dirtyProperties()).toEqual({});
  });

  it('keeps what was typed when a section is added, and drops a removed one', async () => {
    await type('dc:title', 'Typed');
    host.sections.set([POLICY, SECOND]);
    await settle();
    expect(field('dc:title').value).toBe('Typed');
    expect(element.querySelector('[data-xpath="cl:ref"]')).not.toBeNull();
    host.sections.set([SECOND]);
    await settle();
    expect(element.querySelector('[data-xpath="pol:number"]')).toBeNull();
    expect(Object.keys(host.editor().properties())).not.toContain('pol:number');
  });

  it('shows sections as tabs, opening the one with the first error on Save', async () => {
    host.sections.set([POLICY, SECOND]);
    host.display.set('tabs');
    await settle();
    const tabLabels = [...element.querySelectorAll('[role="tab"]')].map((node) =>
      node.textContent?.trim(),
    );
    expect(tabLabels).toEqual(['Policy', 'Claims']);
    expect(element.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
      'Metadata sections',
    );
    expect(host.editor().validate()).toBe(false);
    await settle();
    await settle();
    await settle();
    expect(element.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim()).toBe(
      'Claims',
    );
    expect(document.activeElement).toBe(field('cl:ref'));
  });

  it('leaves Dublin Core out for a type without it', async () => {
    host.dublinCore.set(false);
    await settle();
    expect(element.querySelector('[data-xpath="dc:nature"]')).toBeNull();
    expect(
      field('dc:title').closest('mat-form-field')?.querySelector('mat-label')?.textContent?.trim(),
    ).toBe('Duplicate title');
  });

  it('turns every control read-only while saving, and back without unlocking the file', async () => {
    host.disabled.set(true);
    await settle();
    expect(field('dc:title').disabled).toBe(true);
    expect(
      field<HTMLInputElement>('pol:active').closest('mat-checkbox')?.querySelector('input')
        ?.disabled,
    ).toBe(true);
    host.disabled.set(false);
    await settle();
    expect(field('dc:title').disabled).toBe(false);
    expect(host.editor().dirtyProperties()).toEqual({});
    expect(Object.keys(host.editor().properties())).not.toContain('pol:scan');
  });

  it('focuses the typing box of an empty required list, in a section with no heading', async () => {
    host.dublinCore.set(false);
    host.sections.set([
      {
        id: 'plain',
        heading: null,
        fields: [
          { xpath: 'x:tags', label: 'Keywords', definition: { type: 'string[]', required: true } },
        ],
      },
    ]);
    await settle();
    expect(element.querySelector('[role="heading"]')).toBeNull();
    expect(element.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);
    expect(host.editor().validate()).toBe(false);
    await settle();
    expect(errors()).toContain('Keywords is required.');
    expect(document.activeElement).toBe(field('x:tags'));
  });

  it('focuses the typing box of an empty required list, in a section with no heading', async () => {
    host.dublinCore.set(false);
    host.sections.set([
      {
        id: 'plain',
        heading: null,
        fields: [
          { xpath: 'x:tags', label: 'Keywords', definition: { type: 'string[]', required: true } },
        ],
      },
    ]);
    await settle();
    expect(element.querySelector('[role="heading"]')).toBeNull();
    expect(element.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);
    expect(host.editor().validate()).toBe(false);
    await settle();
    expect(errors()).toContain('Keywords is required.');
    expect(document.activeElement).toBe(field('x:tags'));
  });

  it('toggles a boolean field with its checkbox', async () => {
    const checkbox = field<HTMLElement>('pol:active').querySelector<HTMLInputElement>('input');
    checkbox?.click();
    await settle();
    expect(host.editor().dirtyProperties()).toEqual({ 'pol:active': false });
  });
});

describe('NxsMetadataEditorComponent, twice on a page', () => {
  it('gives the same list field a different id in each editor, each named by its own label', async () => {
    await TestBed.configureTestingModule({
      imports: [TwoEditorsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        {
          provide: DirectoryService,
          useValue: { getEntries: () => of([]), getAllL10nEntries: () => of([]) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(TwoEditorsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const inputs = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
        'input[data-xpath="pol:codes"]',
      ),
    ];
    expect(inputs.map(labelsOf)).toEqual([['Codes'], ['Codes']]);
    expect(inputs[0].id).not.toBe(inputs[1].id);
    expect(inputs.every((input) => input.labels?.[0]?.htmlFor === input.id)).toBe(true);
  });
});

/** A date library's adapter, as a host might provide one: it writes year first, and reads any text as 1 January 2030. */
@Injectable()
class HostLibraryAdapter extends NativeDateAdapter {
  override parse(): Date | null {
    return new Date(2030, 0, 1);
  }

  override format(date: Date): string {
    const two = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  }
}

@Component({
  standalone: true,
  imports: [NxsMetadataEditorComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-metadata-editor [values]="values" />`,
})
class DatesHostComponent {
  readonly values: NxsEditorValues = { 'dc:title': 'Report' };
  readonly editor = viewChild.required(NxsMetadataEditorComponent);
}

@Component({
  standalone: true,
  imports: [NxsMetadataEditorComponent],
  providers: [{ provide: DateAdapter, useClass: HostLibraryAdapter }],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-metadata-editor [values]="values" />`,
})
class DatesHostWithAdapterComponent extends DatesHostComponent {}

/** A host's change to Material's native adapter that keeps its `Date.parse`. */
@Injectable()
class MondayFirstAdapter extends NativeDateAdapter {
  override getFirstDayOfWeek(): number {
    return 1;
  }
}

@Component({
  standalone: true,
  imports: [NxsMetadataEditorComponent],
  providers: [{ provide: DateAdapter, useClass: MondayFirstAdapter }],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-metadata-editor [values]="values" />`,
})
class DatesHostWithNativeSubclassComponent extends DatesHostComponent {}

describe('NxsMetadataEditorComponent, typed dates', () => {
  let fixture: ComponentFixture<DatesHostComponent>;

  const expires = (): HTMLInputElement =>
    (fixture.nativeElement as HTMLElement).querySelector(
      '[data-xpath="dc:expired"] input',
    ) as HTMLInputElement;

  async function setup(locale: string, host: Type<DatesHostComponent> = DatesHostComponent) {
    await TestBed.configureTestingModule({
      imports: [host],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: LOCALE_ID, useValue: locale },
        {
          provide: DirectoryService,
          useValue: { getEntries: () => of([]), getAllL10nEntries: () => of([]) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(host);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function typeDate(text: string): Promise<unknown> {
    expires().value = text;
    expires().dispatchEvent(new Event('input'));
    expires().dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance.editor().dirtyProperties()['dc:expired'];
  }

  it('reads a typed date day first in French, under a day-first hint', async () => {
    await setup('fr');
    expect(expires().placeholder).toBe('dd/mm/yyyy');
    expect(await typeDate('03/04/2026')).toBe(new Date(2026, 3, 3).toISOString());
  });

  it('reads the same text month first in American English, under a month-first hint', async () => {
    await setup('en-US');
    expect(expires().placeholder).toBe('mm/dd/yyyy');
    expect(await typeDate('03/04/2026')).toBe(new Date(2026, 2, 4).toISOString());
  });

  it('reads as its hint says over a host’s native subclass that keeps Date.parse', async () => {
    await setup('fr', DatesHostWithNativeSubclassComponent);
    expect(expires().placeholder).toBe('dd/mm/yyyy');
    expect(await typeDate('03/04/2026')).toBe(new Date(2026, 3, 3).toISOString());
  });

  it('uses a date adapter the host provides, for the hint and for what is typed', async () => {
    await setup('fr', DatesHostWithAdapterComponent);
    expect(expires().placeholder).toBe('yyyy-mm-dd');
    expect(await typeDate('anything')).toBe(new Date(2030, 0, 1).toISOString());
  });
});

/** A Nuxeo date property: an instant, with a time of day. */
const EXPIRES = '2026-04-03T10:30:00.000Z';

/** A day as `CalendarDayAdapter` writes it, `yyyy-mm-dd`, from a JS date's local fields. */
const written = (date: Date) =>
  [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0'))
    .join('-');

/** A host whose date adapter holds calendar days, not JS dates, as Luxon's holds `DateTime`s. */
@Component({
  standalone: true,
  imports: [NxsMetadataEditorComponent],
  providers: [{ provide: DateAdapter, useClass: CalendarDayAdapter }],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-metadata-editor [values]="values" />`,
})
class CalendarDaysHostComponent {
  readonly values: NxsEditorValues = { 'dc:title': 'Report', 'dc:expired': EXPIRES };
  readonly editor = viewChild.required(NxsMetadataEditorComponent);
}

describe('NxsMetadataEditorComponent, with a host adapter that does not hold JS dates', () => {
  let fixture: ComponentFixture<CalendarDaysHostComponent>;

  const editor = () => fixture.componentInstance.editor();
  const expires = (): HTMLInputElement =>
    (fixture.nativeElement as HTMLElement).querySelector(
      '[data-xpath="dc:expired"] input',
    ) as HTMLInputElement;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CalendarDaysHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        {
          provide: DirectoryService,
          useValue: { getEntries: () => of([]), getAllL10nEntries: () => of([]) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CalendarDaysHostComponent);
    await render();
  });

  it('shows the property’s day, valid, and writes back its instant with its time of day', () => {
    expect(expires().value).toBe(written(new Date(EXPIRES)));
    expect(editor().validate()).toBe(true);
    expect(editor().properties()['dc:expired']).toBe(EXPIRES);
    expect(editor().dirtyProperties()).toEqual({});
  });

  it('writes a typed date as an ISO instant, under the hint the adapter writes', async () => {
    expect(expires().placeholder).toBe('yyyy-mm-dd');
    expires().value = '2027-05-06';
    expires().dispatchEvent(new Event('input'));
    expires().dispatchEvent(new Event('blur'));
    await render();
    expect(editor().validate()).toBe(true);
    expect(editor().dirtyProperties()).toEqual({
      'dc:expired': new Date(2027, 4, 6).toISOString(),
    });
  });

  it('writes a day picked from the calendar as an ISO instant', async () => {
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        'mat-datepicker-toggle button',
      ) as HTMLButtonElement
    ).click();
    await render();
    const fifteenth = [...document.querySelectorAll<HTMLElement>('.mat-calendar-body-cell')].find(
      (cell) => cell.textContent?.trim() === '15',
    );
    expect(fifteenth).toBeDefined();
    fifteenth?.click();
    await render();
    const shown = new Date(EXPIRES);
    const picked = new Date(shown.getFullYear(), shown.getMonth(), 15);
    expect(expires().value).toBe(written(picked));
    expect(editor().dirtyProperties()).toEqual({ 'dc:expired': picked.toISOString() });
  });
});
