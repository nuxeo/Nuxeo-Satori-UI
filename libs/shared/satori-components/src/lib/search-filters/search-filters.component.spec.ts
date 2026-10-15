import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { Subject, of, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SearchService,
  type SearchAggregations,
  type SearchCollectionOption,
} from '@nuxeo-satori/platform/nuxeo-client';

import { NxsSearchFiltersComponent } from './search-filters.component';
import {
  NXS_EMPTY_SEARCH_FILTERS,
  type NxsFacetLabels,
  type NxsSearchFilters,
} from './search-filters.model';

const AGGREGATIONS: SearchAggregations = {
  dc_modified_agg: {
    buckets: [
      { key: 'last24h', docCount: 3 },
      { key: 'lastWeek', docCount: 0 },
    ],
  },
  dc_creator_agg: {
    buckets: [
      { key: 'Administrator', docCount: 40 },
      { key: 'jdoe', docCount: 2 },
    ],
  },
  dc_nature_agg: { buckets: [{ key: 'contract', docCount: 5 }] },
  common_size_agg: { buckets: [{ key: 'tiny', docCount: 9 }] },
};

@Component({
  standalone: true,
  imports: [NxsSearchFiltersComponent],
  template: `<nxs-search-filters
    [(filters)]="filters"
    [aggregations]="aggregations()"
    [optionLabels]="labels()"
    (filtersReset)="resets = resets + 1"
    (saveAs)="saves = saves + 1"
  />`,
})
class HostComponent {
  readonly filters = signal<NxsSearchFilters>(NXS_EMPTY_SEARCH_FILTERS);
  readonly aggregations = signal<SearchAggregations>(AGGREGATIONS);
  readonly labels = signal<NxsFacetLabels>({});
  resets = 0;
  saves = 0;
}

describe('NxsSearchFiltersComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let getUserCollections: ReturnType<typeof vi.fn>;
  let getTagSuggestions: ReturnType<typeof vi.fn>;

  const el = () => fixture.nativeElement as HTMLElement;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function input(labelText: string): HTMLInputElement {
    const label = [...el().querySelectorAll('label')].find(
      (node) => node.textContent?.trim() === labelText,
    );
    const field = label && el().querySelector<HTMLInputElement>(`#${label.htmlFor}`);
    if (!field) throw new Error(`no box labelled ${labelText}`);
    return field;
  }

  function toggle(title: string): HTMLButtonElement {
    const button = [
      ...el().querySelectorAll<HTMLButtonElement>('.nxs-search-filters__toggle'),
    ].find((node) => node.textContent?.includes(title));
    if (!button) throw new Error(`no group ${title}`);
    return button;
  }

  function checkboxes(title: string): HTMLElement[] {
    const group = el().querySelector(`#${toggle(title).getAttribute('aria-controls')}`);
    return [...(group?.querySelectorAll<HTMLElement>('mat-checkbox') ?? [])];
  }

  /** The chips under a box, by their text, and their remove buttons' names. */
  function chips(labelText: string): { text: string[]; remove: string[] } {
    const field = input(labelText).closest('.nxs-search-filters__field');
    const set = [...(field?.querySelectorAll<HTMLElement>('mat-chip') ?? [])];
    return {
      text: set.map((chip) => (chip.textContent ?? '').replace(/cancel\s*$/, '').trim()),
      remove: set.map((chip) => chip.querySelector('button')?.getAttribute('aria-label') ?? ''),
    };
  }

  function removeChip(labelText: string, index: number): void {
    const field = input(labelText).closest('.nxs-search-filters__field');
    field?.querySelectorAll<HTMLButtonElement>('mat-chip button')[index]?.click();
  }

  const panelOptions = () => [
    ...document.querySelectorAll<HTMLElement>('.nxs-search-filters__panel mat-option'),
  ];

  function type(field: HTMLInputElement, value: string): void {
    field.value = value;
    field.dispatchEvent(new Event('input'));
  }

  /** The options an autocomplete box offers once it is focused and opened. */
  async function openPanel(field: HTMLInputElement): Promise<HTMLElement[]> {
    field.dispatchEvent(new Event('focusin'));
    field.dispatchEvent(new Event('focus'));
    fixture.debugElement
      .queryAll(By.directive(MatAutocompleteTrigger))
      .find((node) => node.nativeElement === field)
      ?.injector.get(MatAutocompleteTrigger)
      .openPanel();
    await render();
    return [...document.querySelectorAll<HTMLElement>('.nxs-search-filters__panel mat-option')];
  }

  beforeEach(async () => {
    getUserCollections = vi.fn((): Observable<SearchCollectionOption[]> =>
      of([
        { id: 'col-1', title: 'Claims', itemCount: 4 },
        { id: 'col-2', title: 'Board', itemCount: 1 },
      ]),
    );
    getTagSuggestions = vi.fn((term: string): Observable<string[]> =>
      of(['annual', 'archive'].filter((tag) => tag.startsWith(term))),
    );
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: SearchService, useValue: { getUserCollections, getTagSuggestions } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
  });

  describe('choices and counts', () => {
    it('lists every modification-date range with the server’s count, Modification Date open', () => {
      expect(toggle('Modification Date').getAttribute('aria-expanded')).toBe('true');
      const ranges = checkboxes('Modification Date').map((node) => node.textContent?.trim());
      expect(ranges).toEqual([
        'Last 24h (3)',
        'Last week (0)',
        'Last month',
        'Last year',
        'More than a year ago',
      ]);
    });

    it('keeps the other groups closed until opened, and says what they control', async () => {
      const nature = toggle('Nature');
      expect(nature.getAttribute('aria-expanded')).toBe('false');
      expect(checkboxes('Nature')).toHaveLength(0);

      nature.click();
      await render();

      expect(nature.getAttribute('aria-expanded')).toBe('true');
      const group = el().querySelector(`#${nature.getAttribute('aria-controls')}`);
      expect(group?.getAttribute('role')).toBe('group');
      expect(group?.getAttribute('aria-labelledby')).toBe(nature.id);
      expect(checkboxes('Nature').map((node) => node.textContent?.trim())).toEqual([
        'contract (5)',
      ]);

      nature.click();
      await render();
      expect(checkboxes('Nature')).toHaveLength(0);
    });

    it('says a terms group has nothing to choose when the server returned no bucket', async () => {
      toggle('Subjects').click();
      await render();
      const group = el().querySelector(`#${toggle('Subjects').getAttribute('aria-controls')}`);
      expect(group?.textContent?.trim()).toBe('No available results');
    });
  });

  describe('changing the filters', () => {
    it('ticks a range and writes it into the filters, and unticks it again', async () => {
      checkboxes('Modification Date')[0].querySelector('input')?.click();
      await render();
      expect(host.filters().modified).toEqual(['last24h']);

      checkboxes('Modification Date')[0].querySelector('input')?.click();
      await render();
      expect(host.filters().modified).toEqual([]);
    });

    it('applies full text on Enter only, and clears it with the named clear button', async () => {
      const box = input('Full Text');
      expect(box.type).toBe('search');
      type(box, '  contract  ');
      await render();
      expect(host.filters().fulltext).toBe('');

      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await render();
      expect(host.filters().fulltext).toBe('contract');

      const clear = el().querySelector<HTMLButtonElement>('.nxs-search-filters__clear');
      expect(clear?.getAttribute('aria-label')).toBe('Clear full text');
      clear?.click();
      await render();
      expect(host.filters().fulltext).toBe('');
      expect(box.value).toBe('');
      expect(el().querySelector('.nxs-search-filters__clear')).toBeNull();
    });

    it('offers the authors the server counted, narrowed by what is typed, and adds several', async () => {
      const box = input('Authors');
      let options = await openPanel(box);
      expect(options.map((node) => node.textContent?.trim())).toEqual([
        'Administrator (40)',
        'jdoe (2)',
      ]);

      type(box, 'JD');
      await render();
      options = panelOptions();
      expect(options.map((node) => node.textContent?.trim())).toEqual(['jdoe (2)']);
      options[0].click();
      await render();
      expect(host.filters().authors).toEqual(['jdoe']);
      expect(box.value).toBe('');

      // A chosen author is not offered again; the next one is added beside it.
      options = await openPanel(box);
      expect(options.map((node) => node.textContent?.trim())).toEqual(['Administrator (40)']);
      options[0].click();
      await render();
      expect(host.filters().authors).toEqual(['jdoe', 'Administrator']);
      expect(chips('Authors')).toEqual({
        text: ['jdoe', 'Administrator'],
        remove: ['Remove jdoe', 'Remove Administrator'],
      });
      // Named apart from the box, which is "Authors".
      const set = input('Authors')
        .closest('.nxs-search-filters__field')
        ?.querySelector('mat-chip-set');
      expect(set?.getAttribute('aria-label')).toBe('Chosen authors');

      removeChip('Authors', 0);
      await render();
      expect(host.filters().authors).toEqual(['Administrator']);
    });

    it('says no author matches when none does', async () => {
      const box = input('Authors');
      type(box, 'nobody');
      const options = await openPanel(box);
      expect(options.map((node) => node.textContent?.trim())).toEqual(['No results found']);
    });

    it('reads the collections once, on the first focus, and shows chosen ones by title', async () => {
      const box = input('Collections');
      let options = await openPanel(box);
      await openPanel(box);
      expect(getUserCollections).toHaveBeenCalledTimes(1);
      expect(options.map((node) => node.textContent?.trim())).toEqual(['Claims (4)', 'Board (1)']);

      type(box, 'boa');
      await render();
      options = panelOptions();
      options[0].click();
      await render();
      expect(host.filters().collections).toEqual(['col-2']);
      expect(box.value).toBe('');
      expect(chips('Collections')).toEqual({ text: ['Board'], remove: ['Remove Board'] });

      options = await openPanel(box);
      expect(options.map((node) => node.textContent?.trim())).toEqual(['Claims (4)']);
      options[0].click();
      await render();
      expect(host.filters().collections).toEqual(['col-2', 'col-1']);

      removeChip('Collections', 1);
      await render();
      expect(host.filters().collections).toEqual(['col-2']);
    });

    it('says the collections are loading, then could not be read', async () => {
      const pending = new Subject<SearchCollectionOption[]>();
      getUserCollections.mockReturnValue(pending.asObservable());
      const box = input('Collections');
      let options = await openPanel(box);
      expect(options.map((node) => node.textContent?.trim())).toEqual(['Loading collections...']);

      pending.error({ status: 500 });
      await render();
      options = panelOptions();
      expect(options.map((node) => node.textContent?.trim())).toEqual([
        'Could not load your collections.',
      ]);
    });

    it('reads the collections again on the next focus after a failure', async () => {
      getUserCollections.mockReturnValueOnce(throwError(() => ({ status: 500 })));
      const box = input('Collections');
      await openPanel(box);
      box.dispatchEvent(new Event('focus'));
      await render();
      expect(getUserCollections).toHaveBeenCalledTimes(2);
    });

    it('suggests tags for what is typed, debounced, and adds the ones chosen', async () => {
      vi.useFakeTimers();
      try {
        const box = input('Tags');
        let options = await openPanel(box);
        expect(options.map((node) => node.textContent?.trim())).toEqual([
          'Please enter 1 or more characters',
        ]);

        type(box, 'a');
        type(box, 'an');
        vi.advanceTimersByTime(250);
        await render();
        expect(getTagSuggestions).toHaveBeenCalledTimes(1);
        expect(getTagSuggestions).toHaveBeenCalledWith('an');
        options = panelOptions();
        expect(options.map((node) => node.textContent?.trim())).toEqual(['annual']);

        options[0].click();
        await render();
        expect(host.filters().tags).toEqual(['annual']);
        expect(box.value).toBe('');

        type(box, 'a');
        vi.advanceTimersByTime(250);
        await render();
        options = panelOptions();
        // `annual` is chosen already, so only `archive` is offered.
        expect(options.map((node) => node.textContent?.trim())).toEqual(['archive']);
        options[0].click();
        await render();
        expect(host.filters().tags).toEqual(['annual', 'archive']);

        type(box, 'zz');
        vi.advanceTimersByTime(250);
        await render();
        options = panelOptions();
        expect(options.map((node) => node.textContent?.trim())).toEqual(['No results for zz']);

        removeChip('Tags', 0);
        await render();
        expect(host.filters().tags).toEqual(['archive']);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('filters set from outside', () => {
    it('shows them, chosen values as chips, and opens the groups that have a selection', async () => {
      host.filters.set({
        ...NXS_EMPTY_SEARCH_FILTERS,
        fulltext: 'invoice',
        authors: ['jdoe', 'asmith'],
        tags: ['q1'],
        nature: ['gone'],
        size: ['tiny'],
      });
      await render();

      expect(input('Full Text').value).toBe('invoice');
      expect(chips('Authors').text).toEqual(['jdoe', 'asmith']);
      expect(chips('Tags').text).toEqual(['q1']);
      expect(chips('Collections').text).toEqual([]);
      expect(getUserCollections).not.toHaveBeenCalled();
      expect(toggle('Nature').getAttribute('aria-expanded')).toBe('true');
      expect(toggle('Size').getAttribute('aria-expanded')).toBe('true');
      // A selected value the server no longer returns is still there, ticked, to be cleared.
      const gone = checkboxes('Nature').find((node) => node.textContent?.trim() === 'gone');
      expect(gone?.querySelector<HTMLInputElement>('input')?.checked).toBe(true);
      expect(checkboxes('Size')[0].querySelector<HTMLInputElement>('input')?.checked).toBe(true);
    });

    it('reads the collections to show chosen ones by title, an unknown one by its id', async () => {
      host.filters.set({ ...NXS_EMPTY_SEARCH_FILTERS, collections: ['col-1', 'col-gone'] });
      await render();
      expect(getUserCollections).toHaveBeenCalledTimes(1);
      expect(chips('Collections').text).toEqual(['Claims', 'col-gone']);
    });
  });

  describe('Reset and Save as', () => {
    function footerButtons(): HTMLButtonElement[] {
      return [...el().querySelectorAll<HTMLButtonElement>('.nxs-search-filters__footer button')];
    }

    it('are disabled with no filter set', () => {
      const [reset, saveAs] = footerButtons();
      expect(reset.textContent?.trim()).toBe('Reset');
      expect(saveAs.textContent?.trim()).toBe('Save As');
      expect(reset.disabled).toBe(true);
      expect(saveAs.disabled).toBe(true);
    });

    it('empty the filters and emit reset, or emit saveAs', async () => {
      host.filters.set({ ...NXS_EMPTY_SEARCH_FILTERS, nature: ['contract'] });
      await render();
      const [reset, saveAs] = footerButtons();

      saveAs.click();
      await render();
      expect(host.saves).toBe(1);
      expect(host.filters().nature).toEqual(['contract']);

      reset.click();
      await render();
      expect(host.resets).toBe(1);
      expect(host.filters()).toEqual(NXS_EMPTY_SEARCH_FILTERS);
    });
  });

  it('shows a choice by its vocabulary label, and filters on the id it was counted under', async () => {
    host.labels.set({ nature: { contract: 'Contrat' } });
    await render();
    toggle('Nature').click();
    await render();

    const choice = checkboxes('Nature')[0];
    expect(choice.textContent).toContain('Contrat');
    expect(choice.textContent).not.toContain('contract');

    choice.querySelector<HTMLInputElement>('input')?.click();
    await render();
    expect(host.filters().nature).toEqual(['contract']);
  });

  it('shows an unlabelled bucket named like an inherited property as its key, not the property', async () => {
    host.labels.set({ nature: {} });
    host.aggregations.set({
      dc_nature_agg: {
        buckets: [
          { key: 'constructor', docCount: 1 },
          { key: 'toString', docCount: 1 },
          { key: '__proto__', docCount: 1 },
        ],
      },
    });
    await render();
    toggle('Nature').click();
    await render();

    const shown = checkboxes('Nature').map((node) =>
      node.textContent?.replace(/\(\d+\)/, '').trim(),
    );
    expect(shown).toEqual(['constructor', 'toString', '__proto__']);
  });
});
