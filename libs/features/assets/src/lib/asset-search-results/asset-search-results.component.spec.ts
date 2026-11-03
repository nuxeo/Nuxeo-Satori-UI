import {
  ChangeDetectionStrategy,
  Component,
  input,
  provideZonelessChangeDetection,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExtensionComponentRegistry } from '@nuxeo/satori-platform/extensions';
import { NXS_ASSET_GRID_ID, type NxsAssetCard } from '@nuxeo/satori-platform/components';
import {
  AssetService,
  DocumentDetailService,
  SearchService,
  SelectionService,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { testTranslateProviders } from '@agentic-ui/testing/i18n';

import { AssetSearchResultsComponent } from './asset-search-results.component';

/**
 * The screen's side of the grid extraction: what it hands `nxs-asset-grid`, and that what comes
 * back still opens a document and still moves the selection.
 *
 * Both wirings are covered, because they are different code and either can break alone: the
 * packaged fallback binds outputs, while a component registered under the ID is handed callbacks
 * as inputs — `lib-extension-outlet` sets inputs only. Exercising the fallback alone would leave
 * the callback path, which is the one every customer grid takes, untested.
 */

/** Stands in for a customer component registered under the grid ID. */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '<p class="custom-grid">custom grid</p>',
})
class CustomGridComponent {
  static lastInstance: CustomGridComponent | null = null;
  // Declared inputs, not plain fields: the outlet writes only what
  // `reflectComponentType(type).inputs` reports.
  readonly assets = input<readonly NxsAssetCard[]>([]);
  readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
  readonly openHandler = input<((card: NxsAssetCard) => void) | null>(null);
  readonly selectionToggleHandler = input<((id: string) => void) | null>(null);

  constructor() {
    CustomGridComponent.lastInstance = this;
  }
}

function doc(uid: string, title: string, type = 'Picture'): NuxeoDocument {
  return {
    uid,
    title,
    type,
    path: `/default-domain/${uid}`,
    state: 'project',
    lastModified: '2026-01-02T03:04:05.000Z',
    properties: { 'file:content': { 'mime-type': 'image/png' }, 'dc:created': '2026-01-01' },
  } as unknown as NuxeoDocument;
}

describe('AssetSearchResultsComponent — the grid it renders by ID', () => {
  let fixture: ComponentFixture<AssetSearchResultsComponent>;
  let component: AssetSearchResultsComponent;
  let selection: SelectionService;
  let registry: ExtensionComponentRegistry;
  const navigate = vi.fn();
  const searchAssets = vi.fn();
  const queryParamMap = new BehaviorSubject(convertToParamMap({}));

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const cardNames = (): string[] =>
    Array.from(el().querySelectorAll('.nxs-asset-grid__name'), (n) => (n.textContent ?? '').trim());

  /**
   * `lib-extension-outlet` resolves through a promise, so the first round of change detection only
   * shows its placeholder. Every render settles the microtask queue and draws again.
   */
  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    CustomGridComponent.lastInstance = null;
    searchAssets.mockReturnValue(
      of({
        entries: [doc('1', 'Beach.png'), doc('2', 'Mountain.png')],
        aggregations: {},
        resultsCount: 2,
      }),
    );

    await TestBed.configureTestingModule({
      imports: [AssetSearchResultsComponent],
      providers: [
        provideZonelessChangeDetection(),
        testTranslateProviders(),
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParamMap.asObservable() } },
        { provide: Router, useValue: { navigate, events: of(), url: '/documents' } },
        { provide: MatDialog, useValue: { open: vi.fn(() => ({ afterClosed: () => of(null) })) } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: AssetService, useValue: { searchAssets } },
        { provide: SearchService, useValue: { getSavedSearches: () => of([]) } },
        { provide: DocumentDetailService, useValue: { fetchThumbnail: () => of(null) } },
      ],
    }).compileComponents();

    selection = TestBed.inject(SelectionService);
    registry = TestBed.inject(ExtensionComponentRegistry);
    fixture = TestBed.createComponent(AssetSearchResultsComponent);
    component = fixture.componentInstance;
    component.viewMode.set('grid');
    await render();
  });

  it('turns each result into a card the grid can draw', async () => {
    expect(cardNames()).toEqual(['Beach.png', 'Mountain.png']);
  });

  it('opens the document when a card name is pressed', async () => {
    const first = el().querySelector<HTMLButtonElement>('.nxs-asset-grid__name');
    first?.click();
    await render();
    expect(navigate).toHaveBeenCalledWith(['/doc', '1']);
  });

  it('moves the selection when a card checkbox is ticked', async () => {
    const checkbox = el().querySelector<HTMLInputElement>(
      '.nxs-asset-grid__select input[type="checkbox"]',
    );
    checkbox?.click();
    await render();
    expect([...selection.selectedIds()]).toEqual(['1']);
    expect(selection.selectedLabels().get('1')).toBe('Beach.png');
  });

  /**
   * The outlet path. A registered grid is handed `openHandler` and `selectionToggleHandler` as
   * inputs; nothing binds its outputs. Both have to reach the same methods the fallback's outputs
   * do, or a customer grid would render its cards and then do nothing when they are pressed.
   */
  it('passes working callbacks and the current selection to a grid registered under the ID', async () => {
    registry.register({ [NXS_ASSET_GRID_ID]: CustomGridComponent });
    fixture = TestBed.createComponent(AssetSearchResultsComponent);
    component = fixture.componentInstance;
    component.viewMode.set('grid');
    await render();

    expect(el().querySelector('.custom-grid')).not.toBeNull();
    expect(el().querySelector('nxs-asset-grid')).toBeNull();

    const grid = CustomGridComponent.lastInstance;
    expect(grid?.assets().map((card) => card.name)).toEqual(['Beach.png', 'Mountain.png']);
    expect(grid?.assets().every((card) => card.thumbnailUrl === null)).toBe(true);

    grid?.selectionToggleHandler()?.('2');
    await render();
    expect([...selection.selectedIds()]).toEqual(['2']);
    expect(grid?.selectedIds().has('2')).toBe(true);

    grid?.openHandler()?.({
      id: '2',
      name: 'Mountain.png',
      type: 'Picture',
      icon: 'image',
      thumbnailUrl: null,
    });
    expect(navigate).toHaveBeenCalledWith(['/doc', '2']);
  });
});
