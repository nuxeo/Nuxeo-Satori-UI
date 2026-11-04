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
import {
  NXS_ASSET_FACETS_DRAWER_ID,
  type NxsAssetFacetsAction,
  type NxsFacetGroup,
  type NxsFacetSelection,
} from '@nuxeo/satori-platform/components';
import {
  AssetAggregationService,
  SearchService,
  type AssetAggregations,
} from '@nuxeo/satori-platform/nuxeo-client';
import { testTranslateProviders } from '@agentic-ui/testing/i18n';

import { AssetsDrawerComponent } from './assets-drawer.component';

/**
 * The drawer's side of the facets extraction: what it hands `nxs-asset-facets-drawer`, what it does
 * with what comes back, and that the panel survives a trip to the queue.
 *
 * Both paths are exercised, because they are wired differently and each can break alone: the
 * packaged fallback binds outputs, while a registered replacement is given callbacks as inputs —
 * `lib-extension-outlet` sets inputs only and cannot bind an output. A test that drove the fallback
 * alone would leave the handler inputs — the path every customer component takes — unexercised.
 */

/** Stands in for a customer component registered under the facets ID. */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '<p class="custom-facets">custom facets</p>',
})
class CustomFacetsPanelComponent {
  static lastInstance: CustomFacetsPanelComponent | null = null;
  // Declared inputs, not plain fields: the outlet applies only what
  // `reflectComponentType(type).inputs` reports, so a plain property is never written.
  readonly groups = input<readonly NxsFacetGroup[]>([]);
  readonly optionToggleHandler = input<((selection: NxsFacetSelection) => void) | null>(null);
  readonly actionHandler = input<((action: NxsAssetFacetsAction) => void) | null>(null);
  readonly fullTextChangeHandler = input<((value: string) => void) | null>(null);
  readonly fullTextSubmitHandler = input<((value: string) => void) | null>(null);

  constructor() {
    CustomFacetsPanelComponent.lastInstance = this;
  }
}

describe('AssetsDrawerComponent — the facets panel it renders by ID', () => {
  let fixture: ComponentFixture<AssetsDrawerComponent>;
  let component: AssetsDrawerComponent;
  let aggregations: AssetAggregationService;
  let registry: ExtensionComponentRegistry;
  const navigate = vi.fn();
  const queryParamMap = new BehaviorSubject(convertToParamMap({}));

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const host = (): HTMLElement => el().querySelector('.facets-host') as HTMLElement;
  const groupToggles = (): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll('.nxs-asset-facets-drawer__group-toggle'));
  const toggleNamed = (label: string): HTMLButtonElement => {
    const found = groupToggles().find((b) => (b.textContent ?? '').trim().startsWith(label));
    if (!found) throw new Error(`no group toggle named ${label}`);
    return found;
  };
  const expandedGroups = (): string[] =>
    groupToggles()
      .filter((b) => b.getAttribute('aria-expanded') === 'true')
      .map((b) => (b.textContent ?? '').trim());

  /**
   * `lib-extension-outlet` resolves its component through a promise, so the first round of change
   * detection only ever shows its "Loading…" placeholder — the packaged fallback appears on the
   * round after the microtask queue has drained. Every render here therefore settles the queue and
   * draws again, or a test would assert against a drawer that had not rendered a panel yet.
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
    CustomFacetsPanelComponent.lastInstance = null;
    localStorage.removeItem('assets_drawer_view_mode');

    await TestBed.configureTestingModule({
      imports: [AssetsDrawerComponent],
      providers: [
        provideZonelessChangeDetection(),
        testTranslateProviders(),
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParamMap.asObservable() } },
        { provide: Router, useValue: { navigate, events: of(), url: '/documents' } },
        { provide: MatDialog, useValue: { open: vi.fn(() => ({ afterClosed: () => of(null) })) } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: SearchService, useValue: { getSavedSearches: () => of([]) } },
      ],
    }).compileComponents();

    aggregations = TestBed.inject(AssetAggregationService);
    registry = TestBed.inject(ExtensionComponentRegistry);
    fixture = TestBed.createComponent(AssetsDrawerComponent);
    component = fixture.componentInstance;
    await render();
  });

  it('opens Asset Type on arrival and leaves the other groups closed', () => {
    expect(expandedGroups()).toEqual(['Asset Type']);
  });

  /**
   * The regression Copilot caught on PR #560. Which group is open is the panel's own state, so an
   * `@if (viewMode() === "filter")` around the outlet destroyed the panel on every toggle and the
   * next render reseeded it from `initiallyExpandedGroupIds`. The drawer used to hold the state
   * itself, so it survived; after the extraction it did not.
   *
   * The assertion is both directions: the collapsed group must still be collapsed, and a group the
   * user opened must still be open. Asserting only the first would pass against a panel that came
   * back with everything shut.
   */
  it('keeps which groups are open across a trip to the queue and back', async () => {
    toggleNamed('Asset Type').click();
    await render();
    toggleNamed('Color Profile').click();
    await render();
    expect(expandedGroups()).toEqual(['Color Profile']);

    component.switchToQueueView();
    await render();
    // Not showing, however the drawer achieves it — the claim under test is the state that comes
    // back, not the mechanism, so a drawer that removed the panel would still get this far.
    expect(el().querySelector('lib-assets-queue')).not.toBeNull();
    expect(host()?.hidden ?? true).toBe(true);

    component.switchToFilterView();
    await render();
    expect(expandedGroups()).toEqual(['Color Profile']);
    expect(host()?.hidden).toBe(false);
  });

  it('resolves each group label and marks the ones the server fills as dynamic', async () => {
    aggregations.aggregations.set({
      system_primaryType_agg: { buckets: [{ key: 'Picture', docCount: 3 }] },
    } as unknown as AssetAggregations);
    queryParamMap.next(convertToParamMap({}));
    await render();

    // Asset Type is the one group open on arrival, so it needs no click — clicking would shut it.
    expect(expandedGroups()).toEqual(['Asset Type']);
    const options = Array.from(el().querySelectorAll('.nxs-asset-facets-drawer__option'), (n) =>
      (n.textContent ?? '').trim(),
    );
    expect(options).toEqual(['Picture (3)']);
  });

  /**
   * The count rules, which are the only judgement in the mapping. An absent bucket means the
   * server said nothing for most groups, so claiming zero would be an invention; for the range
   * groups the server only reports a bucket when something falls in it, so absent really is zero.
   */
  it('shows a count only where the server gave one, and zero only where absent means zero', async () => {
    aggregations.aggregations.set({} as AssetAggregations);
    await render();

    toggleNamed('Asset Width').click();
    await render();
    const widths = Array.from(el().querySelectorAll('.nxs-asset-facets-drawer__option'), (n) =>
      (n.textContent ?? '').trim(),
    );
    expect(widths.every((text) => text.endsWith('(0)'))).toBe(true);

    toggleNamed('Asset Width').click();
    toggleNamed('Color Profile').click();
    await render();
    expect(el().querySelectorAll('.nxs-asset-facets-drawer__option')).toHaveLength(0);
  });

  it('runs a search when the packaged panel asks for one, and clears everything on reset', async () => {
    const footer = (text: string): HTMLButtonElement => {
      const found = Array.from(
        el().querySelectorAll<HTMLButtonElement>('.nxs-asset-facets-drawer__actions button'),
      ).find((b) => (b.textContent ?? '').trim() === text);
      if (!found) throw new Error(`no footer button named ${text}`);
      return found;
    };

    component.onSecondarySearchInput('invoices');
    await render();
    expect(component.hasActiveFilters()).toBe(true);

    footer('Reset').click();
    await render();
    expect(component.secondarySearchInput()).toBe('');
    expect(component.hasActiveFilters()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(
      ['/documents'],
      expect.objectContaining({ queryParams: expect.objectContaining({ ecm_fulltext: null }) }),
    );
  });

  /**
   * The outlet path. A registered component is given `optionToggleHandler` and `actionHandler` as
   * inputs; nothing binds its outputs. Calling the handlers has to reach the same drawer methods
   * the fallback's outputs do, or a customer panel would render and then do nothing.
   */
  it('passes working callbacks to a panel registered under the facets ID', async () => {
    registry.register({ [NXS_ASSET_FACETS_DRAWER_ID]: CustomFacetsPanelComponent });
    fixture = TestBed.createComponent(AssetsDrawerComponent);
    component = fixture.componentInstance;
    await render();

    expect(el().querySelector('.custom-facets')).not.toBeNull();
    expect(el().querySelector('nxs-asset-facets-drawer')).toBeNull();

    const panel = CustomFacetsPanelComponent.lastInstance;
    expect(panel).not.toBeNull();
    expect(panel?.groups().map((g) => g.id)).toContain('asset-type');

    panel?.fullTextChangeHandler()?.('invoices');
    await render();
    expect(component.secondarySearchInput()).toBe('invoices');

    // `fullTextSubmitHandler` alone, with no `fullTextChangeHandler` call before it — the shape a
    // panel that buffers edits until Enter has. The drawer used to ignore the submitted value and
    // search whatever the change callback had last stored, so this searched 'invoices'.
    navigate.mockClear();
    panel?.fullTextSubmitHandler()?.('receipts');
    await render();
    expect(component.secondarySearchInput()).toBe('receipts');
    expect(navigate).toHaveBeenCalledWith(
      ['/documents'],
      expect.objectContaining({
        queryParams: expect.objectContaining({ ecm_fulltext: 'receipts' }),
      }),
    );

    panel?.optionToggleHandler()?.({ groupId: 'asset-width', value: 'to_500_px' });
    await render();
    expect(component.filterGroups().find((g) => g.id === 'asset-width')?.options[0].selected).toBe(
      true,
    );

    panel?.actionHandler()?.('search');
    expect(navigate).toHaveBeenCalledWith(['/documents'], expect.anything());

    navigate.mockClear();
    panel?.actionHandler()?.('reset');
    await render();
    expect(component.secondarySearchInput()).toBe('');
    expect(component.filterGroups().find((g) => g.id === 'asset-width')?.options[0].selected).toBe(
      false,
    );
    expect(navigate).toHaveBeenCalled();
  });
});
