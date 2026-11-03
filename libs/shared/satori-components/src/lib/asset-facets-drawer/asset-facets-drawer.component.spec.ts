import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  NxsAssetFacetsDrawerComponent,
  type NxsAssetFacetsAction,
  type NxsFacetGroup,
  type NxsFacetSelection,
} from './asset-facets-drawer.component';

@Component({
  standalone: true,
  imports: [NxsAssetFacetsDrawerComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-asset-facets-drawer
      [groups]="groups()"
      [fullText]="fullText()"
      [autoSearch]="autoSearch()"
      [canSaveAs]="canSaveAs()"
      [label]="label()"
      [initiallyExpandedGroupIds]="initiallyExpanded()"
      (fullTextChange)="typed.push($event)"
      (fullTextSubmit)="submitted.push($event)"
      (optionToggle)="toggled.push($event)"
      (autoSearchChange)="autoChanges.push($event)"
      (action)="actions.push($event)"
    />
  `,
})
class HostComponent {
  readonly groups = signal<readonly NxsFacetGroup[]>([]);
  readonly fullText = signal('');
  readonly autoSearch = signal(true);
  readonly canSaveAs = signal(false);
  readonly label = signal('');
  readonly initiallyExpanded = signal<readonly string[]>([]);
  readonly typed: string[] = [];
  readonly submitted: string[] = [];
  readonly toggled: NxsFacetSelection[] = [];
  readonly autoChanges: boolean[] = [];
  readonly actions: NxsAssetFacetsAction[] = [];
}

/** Two panels on one page: an outlet renders one while a screen keeps its own. */
@Component({
  standalone: true,
  imports: [NxsAssetFacetsDrawerComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-asset-facets-drawer [groups]="groups()" [initiallyExpandedGroupIds]="['type']" />
    <nxs-asset-facets-drawer [groups]="groups()" [initiallyExpandedGroupIds]="['type']" />
  `,
})
class TwinHostComponent {
  readonly groups = signal<readonly NxsFacetGroup[]>([]);
}

/** The outlet path: callbacks as inputs, because an outlet cannot bind an output. */
@Component({
  standalone: true,
  imports: [NxsAssetFacetsDrawerComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-asset-facets-drawer
      [groups]="groups()"
      [initiallyExpandedGroupIds]="['type']"
      [optionToggleHandler]="toggle"
      [actionHandler]="act"
    />
  `,
})
class HandlerHostComponent {
  readonly groups = signal<readonly NxsFacetGroup[]>([]);
  readonly toggled: NxsFacetSelection[] = [];
  readonly actions: NxsAssetFacetsAction[] = [];
  readonly toggle = (selection: NxsFacetSelection): void => {
    this.toggled.push(selection);
  };
  readonly act = (action: NxsAssetFacetsAction): void => {
    this.actions.push(action);
  };
}

const group = (id: string, overrides: Partial<NxsFacetGroup> = {}): NxsFacetGroup => ({
  id,
  label: `Group ${id}`,
  dynamic: true,
  options: [
    { value: `${id}-a`, label: `Choice A`, selected: false, count: 12 },
    { value: `${id}-b`, label: `Choice B`, selected: true, count: null },
  ],
  ...overrides,
});

describe('NxsAssetFacetsDrawerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const panel = (): HTMLElement | null => el().querySelector('.nxs-asset-facets-drawer__panel');
  const input = (): HTMLInputElement =>
    el().querySelector('.nxs-asset-facets-drawer__input') as HTMLInputElement;
  const clear = (): HTMLButtonElement | null =>
    el().querySelector('.nxs-asset-facets-drawer__clear');
  const toggles = (): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll('.nxs-asset-facets-drawer__group-toggle'));
  const options = (): HTMLInputElement[] =>
    Array.from(el().querySelectorAll('.nxs-asset-facets-drawer__option input[type="checkbox"]'));
  const optionLabels = (): string[] =>
    Array.from(el().querySelectorAll('.nxs-asset-facets-drawer__option'), (n) =>
      (n.textContent ?? '').trim(),
    );
  const buttonNamed = (text: string): HTMLButtonElement | undefined =>
    Array.from(
      el().querySelectorAll<HTMLButtonElement>('.nxs-asset-facets-drawer__actions button'),
    ).find((b) => (b.textContent ?? '').trim() === text);

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  it('names the panel "Asset filters" until a label is given', async () => {
    expect(panel()?.getAttribute('aria-label')).toBe('Asset filters');
    host.label.set('Narrow these assets');
    await render();
    expect(panel()?.getAttribute('aria-label')).toBe('Narrow these assets');
  });

  it('starts with only the groups the host named open', async () => {
    host.groups.set([group('type'), group('format')]);
    host.initiallyExpanded.set(['type']);
    await render();
    expect(toggles().map((t) => t.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
    expect(options()).toHaveLength(2);
  });

  it('opens and closes a group, and keeps every group closed once the last is collapsed', async () => {
    host.groups.set([group('type')]);
    host.initiallyExpanded.set(['type']);
    await render();
    expect(options()).toHaveLength(2);

    toggles()[0].click();
    await render();
    expect(options()).toHaveLength(0);
    expect(toggles()[0].getAttribute('aria-expanded')).toBe('false');

    toggles()[0].click();
    await render();
    expect(options()).toHaveLength(2);
  });

  it('points each toggle at the region it controls', async () => {
    host.groups.set([group('type')]);
    host.initiallyExpanded.set(['type']);
    await render();
    const controls = toggles()[0].getAttribute('aria-controls');
    expect(controls).toMatch(/-group-type$/);
    expect(el().querySelector(`#${controls}`)).not.toBeNull();
  });

  it('shows a count only where the server gave one', async () => {
    host.groups.set([group('type')]);
    host.initiallyExpanded.set(['type']);
    await render();
    expect(optionLabels()).toEqual(['Choice A (12)', 'Choice B']);
  });

  it('shows the checked state the host gave each choice', async () => {
    host.groups.set([group('type')]);
    host.initiallyExpanded.set(['type']);
    await render();
    expect(options().map((o) => o.checked)).toEqual([false, true]);
  });

  it('reports a flipped choice with its group', async () => {
    host.groups.set([group('type')]);
    host.initiallyExpanded.set(['type']);
    await render();
    options()[0].click();
    await render();
    expect(host.toggled).toEqual([{ groupId: 'type', value: 'type-a' }]);
  });

  it('says so when a dynamic group came back empty, and nothing when a fixed one has not loaded', async () => {
    host.groups.set([
      group('dyn', { options: [], dynamic: true }),
      group('fixed', { options: [], dynamic: false }),
    ]);
    host.initiallyExpanded.set(['dyn', 'fixed']);
    await render();
    const notes = el().querySelectorAll('.nxs-asset-facets-drawer__no-results');
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent?.trim()).toBe('No available results');
  });

  it('shows what the host put in the box, and follows a later change to it', async () => {
    host.fullText.set('invoice');
    await render();
    expect(input().value).toBe('invoice');

    host.fullText.set('contract');
    await render();
    expect(input().value).toBe('contract');
  });

  it('reports typing without waiting for the host to echo it back', async () => {
    input().value = 'draft';
    input().dispatchEvent(new Event('input'));
    await render();
    expect(host.typed).toEqual(['draft']);
    expect(input().value).toBe('draft');
  });

  it('submits the trimmed text on Enter', async () => {
    input().value = '  invoice  ';
    input().dispatchEvent(new Event('input'));
    await render();
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await render();
    expect(host.submitted).toEqual(['invoice']);
  });

  it('offers Clear only when there is text, and clearing searches again', async () => {
    expect(clear()).toBeNull();

    input().value = 'invoice';
    input().dispatchEvent(new Event('input'));
    await render();
    expect(clear()).not.toBeNull();

    clear()?.click();
    await render();
    expect(host.typed).toEqual(['invoice', '']);
    expect(host.submitted).toEqual(['']);
    expect(clear()).toBeNull();
  });

  it('treats whitespace alone as no text', async () => {
    input().value = '   ';
    input().dispatchEvent(new Event('input'));
    await render();
    expect(clear()).toBeNull();
  });

  it('offers Search only while auto search is off', async () => {
    expect(buttonNamed('Search')).toBeUndefined();
    host.autoSearch.set(false);
    await render();
    expect(buttonNamed('Search')).toBeDefined();
    buttonNamed('Search')?.click();
    expect(host.actions).toEqual(['search']);
  });

  it('reports the auto-search switch moving', async () => {
    const slide = el().querySelector('mat-slide-toggle button') as HTMLButtonElement | null;
    slide?.click();
    await render();
    expect(host.autoChanges).toEqual([false]);
  });

  it('enables Save as only when something is filtered', async () => {
    expect(buttonNamed('Save as')?.disabled).toBe(true);
    host.canSaveAs.set(true);
    await render();
    expect(buttonNamed('Save as')?.disabled).toBe(false);
    buttonNamed('Save as')?.click();
    expect(host.actions).toEqual(['save-as']);
  });

  it('reports Reset', () => {
    buttonNamed('Reset')?.click();
    expect(host.actions).toEqual(['reset']);
  });

  // `lib-extension-outlet` sets inputs and cannot bind an output, so a host that renders the panel
  // through its ID passes callbacks instead. Both paths carry the same facts.
  it('calls the handler inputs as well, for a host rendering it through an outlet', async () => {
    const handlerFixture = TestBed.createComponent(HandlerHostComponent);
    const handlerHost = handlerFixture.componentInstance;
    handlerHost.groups.set([group('type')]);
    handlerFixture.detectChanges();
    await handlerFixture.whenStable();

    const root = handlerFixture.nativeElement as HTMLElement;
    root.querySelector<HTMLInputElement>('.nxs-asset-facets-drawer__option input')?.click();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.nxs-asset-facets-drawer__actions button'))
      .find((b) => (b.textContent ?? '').trim() === 'Reset')
      ?.click();
    handlerFixture.detectChanges();
    await handlerFixture.whenStable();

    expect(handlerHost.toggled).toEqual([{ groupId: 'type', value: 'type-a' }]);
    expect(handlerHost.actions).toEqual(['reset']);
  });

  // Two panels can share a page — an outlet renders one while a screen keeps its own. Hardcoded
  // `id`s would make the second panel's label point at the first panel's input, so the second box
  // would have no accessible name and clicking its label would focus the wrong field.
  it('numbers its element ids per instance, so two panels on a page stay separate', async () => {
    const twins = TestBed.createComponent(TwinHostComponent);
    twins.componentInstance.groups.set([group('type')]);
    twins.detectChanges();
    await twins.whenStable();
    const root = twins.nativeElement as HTMLElement;

    const ids = (selector: string): string[] =>
      Array.from(root.querySelectorAll(selector), (n) => n.id);
    const inputs = ids('.nxs-asset-facets-drawer__input');
    const regions = ids('.nxs-asset-facets-drawer__options');
    const autoLabels = ids('.nxs-asset-facets-drawer__auto-label');

    expect(new Set([...inputs, ...regions, ...autoLabels]).size).toBe(6);

    // Every reference resolves to its own panel's element, not the first one's.
    Array.from(root.querySelectorAll('nxs-asset-facets-drawer')).forEach((panel, index) => {
      expect(
        panel.querySelector('.nxs-asset-facets-drawer__group-title')?.getAttribute('for'),
      ).toBe(inputs[index]);
      expect(
        panel
          .querySelector('.nxs-asset-facets-drawer__group-toggle')
          ?.getAttribute('aria-controls'),
      ).toBe(regions[index]);
      // The `switch` role is the inner button, which is where Material forwards the name.
      expect(panel.querySelector('button[role="switch"]')?.getAttribute('aria-labelledby')).toBe(
        autoLabels[index],
      );
    });
  });
});
