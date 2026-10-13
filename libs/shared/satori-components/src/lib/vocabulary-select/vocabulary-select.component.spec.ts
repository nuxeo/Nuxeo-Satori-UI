import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DirectoryService,
  type DirectoryEntry,
  type L10nDirectoryEntry,
} from '@nuxeo-satori/platform/nuxeo-client';

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

const l10n = (id: string, parent: string, label: string): L10nDirectoryEntry => ({
  id,
  directoryName: 'l10ncoverage',
  properties: { id, parent, ordering: 0, obsolete: 0, label_en: label },
});
const COVERAGE = [
  l10n('europe', '', 'Europe'),
  l10n('africa', '', 'Africa'),
  l10n('europe/France', 'europe', 'France'),
  l10n('europe/Spain', 'europe', 'Spain'),
  l10n('africa/Kenya', 'africa', 'Kenya'),
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

    it('lists children under their parents', async () => {
      await focus();
      expect(directories.getAllL10nEntries).toHaveBeenCalledWith('l10ncoverage');
      const groups = [...document.querySelectorAll('mat-optgroup')].map((group) => ({
        label: group.querySelector('.mat-mdc-optgroup-label')?.textContent?.trim(),
        options: [...group.querySelectorAll('mat-option')].map((o) => o.textContent?.trim()),
      }));
      expect(groups).toEqual([
        { label: 'Africa', options: ['Kenya'] },
        { label: 'Europe', options: ['France', 'Spain'] },
      ]);
    });

    it('adds each choice as a chip reading Parent/Child, and stops offering it', async () => {
      await focus();
      option('europe/France').click();
      await render();
      await type('ken');
      option('africa/Kenya').click();
      await render();
      await type('e');
      expect(host.many.value).toEqual(['europe/France', 'africa/Kenya']);
      expect(chips()).toEqual(['Europe/France', 'Africa/Kenya']);
      expect(options()).toEqual(['Spain']);
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
