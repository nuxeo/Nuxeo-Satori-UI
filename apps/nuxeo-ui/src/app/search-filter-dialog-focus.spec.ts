import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { of } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { NxsSearchFiltersComponent } from '@nuxeo/satori-platform/components';
import { SearchService } from '@nuxeo/satori-platform/nuxeo-client';

import { appConfig } from './app.config';

describe('Search filter dialog browser focus', () => {
  let fixture: ComponentFixture<NxsSearchFiltersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NxsSearchFiltersComponent, MatIconTestingModule],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    })
      .overrideProvider(SearchService, {
        useValue: { getUserCollections: () => of([]), getTagSuggestions: () => of([]) },
      })
      .compileComponents();
    fixture = TestBed.createComponent(NxsSearchFiltersComponent);
    fixture.componentRef.setInput('layout', 'horizontal');
    await settle();
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }

  function trigger(labelKey: string): HTMLButtonElement {
    const label = TestBed.inject(TranslateService).instant(labelKey);
    return [...fixture.nativeElement.querySelectorAll('.filter-trigger')].find((button) =>
      button.textContent?.trim().startsWith(label),
    ) as HTMLButtonElement;
  }

  it('moves focus into the switched dialog and restores its latest trigger on Escape', async () => {
    window.focus();
    const people = trigger('search.workspace.people');
    people.focus();
    expect(document.hasFocus()).withContext('the browser test document has focus').toBeTrue();
    people.click();
    await settle();
    const firstPanel = document.querySelector<HTMLDialogElement>('.filter-panel');
    expect(firstPanel?.contains(document.activeElement))
      .withContext('initial dialog entry')
      .toBeTrue();
    expect(firstPanel?.hasAttribute('aria-modal')).toBeFalse();

    const coverage = trigger('satori-components.search-filters.coverage');
    // Native pointer activation focuses the newly clicked trigger before Angular handles click.
    coverage.focus();
    expect(document.activeElement).toBe(coverage);
    coverage.click();
    await settle();
    const activePanel = document.querySelector<HTMLDialogElement>('.filter-panel');
    expect(activePanel?.getAttribute('aria-label')).toBe(
      TestBed.inject(TranslateService).instant('satori-components.search-filters.coverage'),
    );
    expect(activePanel?.contains(document.activeElement))
      .withContext('switched dialog entry')
      .toBeTrue();

    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();
    expect(document.querySelector('.filter-panel')).toBeNull();
    expect(document.activeElement).toBe(coverage);
  });
});
