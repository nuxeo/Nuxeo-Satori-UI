import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DirectoryService,
  type DirectoryEntry,
  type L10nDirectoryEntry,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsVocabularySelectComponent } from './vocabulary-select.component';

const flat = (id: string, label: string, ordering = 0): DirectoryEntry => ({
  id,
  label,
  displayLabel: label,
  ordering,
  obsolete: 0,
  directoryName: 'nature',
});
const NATURE = [flat('invoice', 'Invoice'), flat('contract', 'Contract'), flat('memo', 'Memo')];

const l10n = (id: string, parent: string, label: string, ordering = 0): L10nDirectoryEntry => ({
  id,
  directoryName: 'l10ncoverage',
  properties: { id, parent, ordering, obsolete: 0, label_en: label },
});
/** As the server holds `l10ncoverage`: bare ids, each child naming its parent. */
const COVERAGE = [
  l10n('europe', '', 'Europe'),
  l10n('africa', '', 'Africa'),
  l10n('antarctica', '', 'Antarctica'),
  l10n('France', 'europe', 'France'),
  l10n('Spain', 'europe', 'Spain'),
  l10n('Kenya', 'africa', 'Kenya'),
  l10n('Georgia', 'asia', 'Georgia'),
  l10n('asia', '', 'Asia'),
  l10n('Georgia', 'north-america', 'Georgia'),
  l10n('north-america', '', 'North America'),
];

@Component({
  standalone: true,
  imports: [NxsVocabularySelectComponent, ReactiveFormsModule],
  template: `
    @if (multiple()) {
      <nxs-vocabulary-select
        label="Coverage"
        multiple
        [directory]="directory()"
        [formControl]="many"
      />
    } @else {
      <nxs-vocabulary-select label="Nature" [directory]="directory()" [formControl]="one" />
    }
  `,
})
class HostComponent {
  readonly directory = signal('nature');
  readonly multiple = signal(false);
  readonly one = new FormControl<string | null>(null, Validators.required);
  readonly many = new FormControl<readonly string[]>([]);
}

@Component({
  standalone: true,
  imports: [NxsVocabularySelectComponent],
  template: `<nxs-vocabulary-select label="Nature" directory="nature" />
    <nxs-vocabulary-select label="Coverage" directory="l10ncoverage" multiple />
    <nxs-vocabulary-select label="Subjects" directory="l10nsubjects" multiple />`,
})
class ThreeFieldsComponent {}

/** Each input with the text of the labels that name it, as `getByLabelText` finds it. */
const labelledInputs = (root: HTMLElement) =>
  [...root.querySelectorAll('input')].map((input) => ({
    id: input.id,
    labels: [...(input.labels ?? [])].map((label) => label.textContent?.trim()),
  }));

describe('NxsVocabularySelectComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let directories: {
    getEntries: ReturnType<typeof vi.fn>;
    getAllL10nEntries: ReturnType<typeof vi.fn>;
  };

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const input = (): HTMLInputElement => root().querySelector('input') as HTMLInputElement;
  const options = (): string[] =>
    [...document.querySelectorAll('mat-option')].map((option) => option.textContent?.trim() ?? '');
  const option = (id: string): HTMLElement =>
    document.querySelector(`mat-option[data-entry="${id}"]`) as HTMLElement;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function focus(): Promise<void> {
    if (document.activeElement === input()) input().dispatchEvent(new Event('focus'));
    else input().focus();
    await render();
  }

  async function type(value: string): Promise<void> {
    await focus();
    input().value = value;
    input().dispatchEvent(new Event('input'));
    await render();
  }

  beforeEach(async () => {
    directories = {
      getEntries: vi.fn(() => of(NATURE)),
      getAllL10nEntries: vi.fn(() => of(COVERAGE)),
    };
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DirectoryService, useValue: directories },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  it('is named by its label, through an id of its own', () => {
    expect(labelledInputs(root())).toEqual([
      { id: expect.stringMatching(/^nxs-vocabulary-select-\d+$/), labels: ['Nature'] },
    ]);
  });

  it('lists the whole vocabulary on focus, sorted by label', async () => {
    await focus();
    expect(directories.getEntries).toHaveBeenCalledExactlyOnceWith('nature');
    expect(options()).toEqual(['Contract', 'Invoice', 'Memo']);
  });

  it('narrows the list as the user types', async () => {
    await type('in');
    expect(options()).toEqual(['Invoice']);
  });

  it('returns the id chosen and shows its label', async () => {
    await focus();
    option('contract').click();
    await render();
    expect(host.one.value).toBe('contract');
    expect(input().value).toBe('Contract');
    expect(host.one.valid).toBe(true);
  });

  it('shows the label of an id the form already holds once the entries arrive', async () => {
    host.one.setValue('memo');
    await render();
    expect(input().value).toBe('Memo');
  });

  it('keeps an id the vocabulary no longer has, shown as it is', async () => {
    host.one.setValue('retired');
    await render();
    expect(input().value).toBe('retired');
    expect(host.one.value).toBe('retired');
  });

  it('clears the choice when the user edits the text, and the half-typed text is an error', async () => {
    await focus();
    option('memo').click();
    await render();
    await type('Mem');
    expect(host.one.value).toBeNull();
    expect(host.one.hasError('nxsChooseFromList')).toBe(true);
    expect(input().value).toBe('Mem');
    input().dispatchEvent(new Event('blur'));
    await render();
    expect(root().querySelector('mat-error')?.textContent?.trim()).toBe(
      'Choose an entry from the list',
    );
  });

  it('clears unmatched text when the form resets an already null value', async () => {
    await type('unlisted');
    expect(host.one.value).toBeNull();
    expect(host.one.hasError('nxsChooseFromList')).toBe(true);
    host.one.reset(null);
    await render();
    expect(input().value).toBe('');
    expect(host.one.hasError('nxsChooseFromList')).toBe(false);
  });

  it('says it could not load the list, and tries again each time the field is focused', async () => {
    const failure = () => throwError(() => ({ status: 500 }));
    directories.getEntries.mockReturnValueOnce(failure()).mockReturnValueOnce(failure());
    host.directory.set('subtopic');
    await render();
    await focus();
    expect(directories.getEntries).toHaveBeenCalledTimes(3);
    expect(options()).toEqual(['Could not load the list. Open it again to try again.']);
    input().blur();
    await focus();
    expect(directories.getEntries).toHaveBeenCalledTimes(4);
    expect(directories.getEntries).toHaveBeenLastCalledWith('subtopic');
    expect(options()).toEqual(['Contract', 'Invoice', 'Memo']);
  });

  it('shows the required error once the user has left the field empty', async () => {
    input().dispatchEvent(new Event('blur'));
    await render();
    expect(root().querySelector('mat-error')?.textContent?.trim()).toBe('Required');
  });

  describe('a hierarchical vocabulary, several entries', () => {
    beforeEach(async () => {
      host.multiple.set(true);
      host.directory.set('l10ncoverage');
      await render();
    });

    const chips = (): string[] =>
      [...root().querySelectorAll('mat-chip-row')].map(
        (chip) => chip.querySelector('.mat-mdc-chip-action-label')?.textContent?.trim() ?? '',
      );

    it('names the chip input by its label, through an id of its own', () => {
      expect(labelledInputs(root())).toEqual([
        { id: expect.stringMatching(/^nxs-vocabulary-select-\d+$/), labels: ['Coverage'] },
      ]);
    });

    it('lists children under their parents, and a parent with no children as itself', async () => {
      await focus();
      expect(directories.getAllL10nEntries).toHaveBeenCalledWith('l10ncoverage');
      const groups = [...document.querySelectorAll('mat-optgroup')].map((group) => ({
        label: group.querySelector('.mat-mdc-optgroup-label')?.textContent?.trim(),
        options: [...group.querySelectorAll('mat-option')].map((o) => o.textContent?.trim()),
      }));
      expect(groups).toEqual([
        { label: 'Africa', options: ['Kenya'] },
        { label: 'Asia', options: ['Georgia'] },
        { label: 'Europe', options: ['France', 'Spain'] },
        { label: 'North America', options: ['Georgia'] },
      ]);
      expect(option('antarctica')?.closest('mat-optgroup')).toBeNull();
    });

    it('stores each child as parent/id, as Web UI does, on a chip reading Parent/Child', async () => {
      await focus();
      option('europe/France').click();
      await render();
      await type('ken');
      option('africa/Kenya').click();
      await render();
      await type('ant');
      option('antarctica').click();
      await render();
      expect(host.many.value).toEqual(['europe/France', 'africa/Kenya', 'antarctica']);
      expect(chips()).toEqual(['Europe/France', 'Africa/Kenya', 'Antarctica']);
    });

    it('orders siblings, standalone entries and parent groups by configured order before labels', async () => {
      const entries = [
        l10n('africa', '', 'Africa', 20),
        l10n('antarctica', '', 'Antarctica', 20),
        l10n('australia', '', 'Australia', 10),
        l10n('europe', '', 'Europe', 10),
        l10n('France', 'europe', 'France', 20),
        l10n('Kenya', 'africa', 'Kenya', 0),
        l10n('Spain', 'europe', 'Spain', 10),
      ];
      const original = [...entries];
      directories.getAllL10nEntries.mockReturnValue(of(entries));
      host.directory.set('l10nsubjects');
      await render();
      await focus();
      expect(options()).toEqual(['Australia', 'Antarctica', 'Spain', 'France', 'Kenya']);
      expect(
        [...document.querySelectorAll('.mat-mdc-optgroup-label')].map((label) =>
          label.textContent?.trim(),
        ),
      ).toEqual(['Europe', 'Africa']);
      await type('eur');
      expect(options()).toEqual(['Spain', 'France']);
      option('europe/Spain').click();
      await render();
      expect(host.many.value).toEqual(['europe/Spain']);
      expect(chips()).toEqual(['Europe/Spain']);
      expect(entries).toEqual(original);
    });

    it('uses labels to break equal ordering values for children and standalone entries', async () => {
      directories.getAllL10nEntries.mockReturnValue(
        of([
          l10n('europe', '', 'Europe'),
          l10n('australia', '', 'Australia'),
          l10n('antarctica', '', 'Antarctica'),
          l10n('Spain', 'europe', 'Spain'),
          l10n('France', 'europe', 'France'),
        ]),
      );
      host.directory.set('l10nsubjects');
      await render();
      await focus();
      expect(options()).toEqual(['Antarctica', 'Australia', 'France', 'Spain']);
    });

    it('stops offering an entry once chosen', async () => {
      host.many.setValue(['europe/France']);
      await render();
      await type('eur');
      expect(options()).toEqual(['Spain']);
    });

    it('keeps two children of one name apart by their parents', async () => {
      await type('georgia');
      option('north-america/Georgia').click();
      await render();
      expect(host.many.value).toEqual(['north-america/Georgia']);
      expect(chips()).toEqual(['North America/Georgia']);
    });

    it('shows a value Web UI stored with the labels of its parent and child', async () => {
      host.many.setValue(['europe/France']);
      await render();
      expect(chips()).toEqual(['Europe/France']);
    });

    it('removes a chip with its named button', async () => {
      host.many.setValue(['europe/France', 'europe/Spain']);
      await render();
      const remove = root().querySelector<HTMLButtonElement>(
        'mat-chip-row[data-entry="europe/France"] button[matChipRemove]',
      );
      expect(remove?.getAttribute('aria-label')).toBe('Remove Europe/France');
      remove?.click();
      await render();
      expect(host.many.value).toEqual(['europe/Spain']);
    });

    it('finds a child by its parent’s name', async () => {
      await type('afr');
      expect(options()).toEqual(['Kenya']);
    });
  });
});

describe('NxsVocabularySelectComponent, several in a form', () => {
  it('gives each field its own id, in either mode, so each label names its own input', async () => {
    await TestBed.configureTestingModule({
      imports: [ThreeFieldsComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: DirectoryService,
          useValue: { getEntries: () => of(NATURE), getAllL10nEntries: () => of(COVERAGE) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ThreeFieldsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const fields = labelledInputs(fixture.nativeElement as HTMLElement);
    expect(fields.map(({ labels }) => labels)).toEqual([['Nature'], ['Coverage'], ['Subjects']]);
    expect(new Set(fields.map(({ id }) => id)).size).toBe(3);
  });
});
