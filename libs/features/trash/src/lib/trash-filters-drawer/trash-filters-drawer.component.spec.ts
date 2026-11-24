import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  DocumentDetailService,
  TrashFilterService,
  TrashService,
} from '@nuxeo/satori-platform/nuxeo-client';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { TrashFiltersDrawerComponent } from './trash-filters-drawer.component';

describe('TrashFiltersDrawerComponent results', () => {
  async function render(total: number): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [TrashFiltersDrawerComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: Router, useValue: { url: '/trash', navigateByUrl: vi.fn() } },
        {
          provide: TrashService,
          useValue: {
            searchTrash: () => of({ entries: [] }),
            getSavedSearches: () => of([]),
          },
        },
        {
          provide: DocumentDetailService,
          useValue: { fetchThumbnail: () => throwError(() => ({ status: 404 })) },
        },
      ],
    }).compileComponents();
    const filters = TestBed.inject(TrashFilterService);
    filters.layoutMode.set('results');
    filters.results.set([{ uid: 'uid-1', title: 'Note 1', type: 'Note' }]);
    filters.totalResults.set(total);
    const fixture = TestBed.createComponent(TrashFiltersDrawerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('counts the results the page reports', async () => {
    const element = await render(12);
    expect(element.querySelector('.drawer-results-count')?.textContent).toContain('12');
    expect(element.querySelector('.drawer-result-title')?.textContent).toContain('Note 1');
  });

  it('shows no count when the server did not count them', async () => {
    const element = await render(-1);
    expect(element.querySelector('.drawer-results-count')).toBeNull();
    expect(element.querySelector('.drawer-result-title')?.textContent).toContain('Note 1');
  });
});
