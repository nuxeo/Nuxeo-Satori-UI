import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject, of, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchService, type SavedSearchOption } from '@nuxeo-satori/platform/nuxeo-client';

import {
  NxsSavedSearchSelectComponent,
  type NxsSavedSearchChoice,
} from './saved-search-select.component';

const SEARCHES: SavedSearchOption[] = [
  { id: 'ss-1', title: 'Contracts this month' },
  { id: 'ss-2', title: 'Board papers' },
];

@Component({
  standalone: true,
  imports: [NxsSavedSearchSelectComponent],
  template: `<nxs-saved-search-select
    [selectedId]="selectedId()"
    [selectedTitle]="selectedTitle()"
    [pageProvider]="pageProvider()"
    [refresh]="refresh()"
    (selectedChange)="chosen.push($event)"
  />`,
})
class HostComponent {
  readonly selectedId = signal('');
  readonly selectedTitle = signal('');
  readonly pageProvider = signal('default_search');
  readonly refresh = signal(0);
  readonly chosen: NxsSavedSearchChoice[] = [];
}

describe('NxsSavedSearchSelectComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let getSavedSearches: ReturnType<typeof vi.fn>;

  const box = () =>
    (fixture.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;
  const options = () =>
    [...document.querySelectorAll<HTMLElement>('mat-option')].map((node) =>
      node.textContent?.trim(),
    );

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function open(): Promise<void> {
    box().dispatchEvent(new Event('focus'));
    fixture.debugElement
      .query(By.directive(MatAutocompleteTrigger))
      .injector.get(MatAutocompleteTrigger)
      .openPanel();
    await render();
  }

  beforeEach(async () => {
    getSavedSearches = vi.fn((): Observable<SavedSearchOption[]> => of(SEARCHES));
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: SearchService, useValue: { getSavedSearches } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
  });

  it('is a labelled box, and reads nothing until it is focused', () => {
    const label = (fixture.nativeElement as HTMLElement).querySelector('label');
    expect(label?.textContent?.trim()).toBe('Saved Searches');
    expect(label?.htmlFor).toBe(box().id);
    expect(box().placeholder).toBe('Search Filters');
    expect(getSavedSearches).not.toHaveBeenCalled();
  });

  it('lists the page provider’s saved searches when opened, reading them once', async () => {
    host.pageProvider.set('assets_search');
    await render();
    await open();
    await open();
    expect(getSavedSearches).toHaveBeenCalledTimes(1);
    expect(getSavedSearches).toHaveBeenCalledWith('assets_search');
    expect(options()).toEqual(['bookmarkContracts this month', 'bookmarkBoard papers']);
  });

  it('says it is loading, then that there are none', async () => {
    const pending = new Subject<SavedSearchOption[]>();
    getSavedSearches.mockReturnValue(pending.asObservable());
    await open();
    expect(options()).toEqual(['Loading saved searches...']);

    pending.next([]);
    pending.complete();
    await render();
    expect(options()).toEqual(['No saved searches']);
  });

  it('narrows the list as the user types, and says when nothing matches', async () => {
    await open();
    box().value = 'BOARD';
    box().dispatchEvent(new Event('input'));
    await render();
    expect(options()).toEqual(['bookmarkBoard papers']);

    box().value = 'nothing like it';
    box().dispatchEvent(new Event('input'));
    await render();
    expect(options()).toEqual(['No matching saved searches']);
  });

  it('emits the search chosen and shows its title', async () => {
    await open();
    document.querySelectorAll<HTMLElement>('mat-option')[1].click();
    await render();
    expect(host.chosen).toEqual([{ id: 'ss-2', title: 'Board papers' }]);
    expect(box().value).toBe('Board papers');
  });

  it('shows the open search’s title, lists everything while it is in the box, and marks it', async () => {
    host.selectedId.set('ss-1');
    host.selectedTitle.set('Contracts this month');
    await render();
    expect(box().value).toBe('Contracts this month');

    await open();
    expect(options()).toHaveLength(2);
    expect(
      document.querySelector('mat-option.nxs-saved-search-select__current')?.textContent?.trim(),
    ).toBe('bookmarkContracts this month');
  });

  it('puts the open search’s title back when the list closes without a choice', async () => {
    host.selectedTitle.set('Contracts this month');
    await render();
    await open();
    box().value = 'Boa';
    box().dispatchEvent(new Event('input'));
    await render();

    fixture.debugElement
      .query(By.directive(MatAutocompleteTrigger))
      .injector.get(MatAutocompleteTrigger)
      .closePanel();
    await render();
    expect(box().value).toBe('Contracts this month');
  });

  it('reads the list again when refresh changes — now if it was read, on the next opening if not', async () => {
    host.refresh.set(1);
    await render();
    expect(getSavedSearches).not.toHaveBeenCalled();

    await open();
    expect(getSavedSearches).toHaveBeenCalledTimes(1);

    getSavedSearches.mockReturnValue(of([...SEARCHES, { id: 'ss-3', title: 'New one' }]));
    host.refresh.set(2);
    await render();
    expect(getSavedSearches).toHaveBeenCalledTimes(2);
    await open();
    expect(options()).toContain('bookmarkNew one');
  });

  it('ignores a choice it does not list', async () => {
    await open();
    const component = fixture.debugElement.query(By.directive(NxsSavedSearchSelectComponent))
      .componentInstance as unknown as { choose(id: string): void };
    component.choose('missing');
    expect(host.chosen).toEqual([]);
  });
});
