import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NxsAssetGridComponent, type NxsAssetCard } from './asset-grid.component';

@Component({
  standalone: true,
  imports: [NxsAssetGridComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-asset-grid
      [assets]="assets()"
      [selectedIds]="selectedIds()"
      [selectable]="selectable()"
      [label]="label()"
      (assetOpen)="opened.push($event.id)"
      (selectionToggle)="toggled.push($event)"
    />
  `,
})
class HostComponent {
  readonly assets = signal<readonly NxsAssetCard[]>([]);
  readonly selectedIds = signal<ReadonlySet<string> | readonly string[]>([]);
  readonly selectable = signal(true);
  readonly label = signal('');
  readonly opened: string[] = [];
  readonly toggled: string[] = [];
}

/** The outlet path: callbacks as inputs, because an outlet cannot bind an output. */
@Component({
  standalone: true,
  imports: [NxsAssetGridComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-asset-grid [assets]="assets()" [openHandler]="open" [selectionToggleHandler]="toggle" />
  `,
})
class HandlerHostComponent {
  readonly assets = signal<readonly NxsAssetCard[]>([]);
  readonly opened: string[] = [];
  readonly toggled: string[] = [];
  readonly open = (asset: NxsAssetCard): void => {
    this.opened.push(asset.id);
  };
  readonly toggle = (id: string): void => {
    this.toggled.push(id);
  };
}

const card = (id: string, overrides: Partial<NxsAssetCard> = {}): NxsAssetCard => ({
  id,
  name: `Asset ${id}`,
  type: 'Picture',
  icon: 'file',
  thumbnailUrl: `blob:${id}`,
  ...overrides,
});

describe('NxsAssetGridComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const grid = (): HTMLElement | null => el().querySelector('.nxs-asset-grid__grid');
  const cards = (): HTMLElement[] => Array.from(el().querySelectorAll('.nxs-asset-grid__card'));
  const names = (): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll('.nxs-asset-grid__name'));
  const checkboxes = (): HTMLInputElement[] =>
    Array.from(el().querySelectorAll('.nxs-asset-grid__select input[type="checkbox"]'));

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

  it('renders nothing when there are no assets, leaving the empty state to the host', () => {
    expect(grid()).toBeNull();
  });

  it('draws one card per asset, in the order given', async () => {
    host.assets.set([card('a'), card('b'), card('c')]);
    await render();
    expect(cards()).toHaveLength(3);
    expect(names().map((b) => b.textContent?.trim())).toEqual(['Asset a', 'Asset b', 'Asset c']);
  });

  it('names the grid "Assets" until a label is given', async () => {
    host.assets.set([card('a')]);
    await render();
    expect(grid()?.getAttribute('aria-label')).toBe('Assets');

    host.label.set('Search results');
    await render();
    expect(grid()?.getAttribute('aria-label')).toBe('Search results');
  });

  it('is a list of list items, so a screen reader can count them', async () => {
    host.assets.set([card('a'), card('b')]);
    await render();
    expect(grid()?.getAttribute('role')).toBe('list');
    expect(cards().map((c) => c.getAttribute('role'))).toEqual(['listitem', 'listitem']);
  });

  it('shows the thumbnail when there is one, and the type icon when there is not', async () => {
    host.assets.set([card('a'), card('b', { thumbnailUrl: null, icon: 'folder' })]);
    await render();
    const images = el().querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('src')).toBe('blob:a');
    // Decorative: the name button beside it already says which document this is.
    expect(images[0].getAttribute('alt')).toBe('');
    expect(cards()[1].querySelector('.nxs-asset-grid__icon')).not.toBeNull();
  });

  it('shows the document type as a translated pill', async () => {
    host.assets.set([card('a', { type: 'Picture' })]);
    await render();
    expect(el().querySelector('.nxs-asset-grid__type')?.textContent?.trim()).toBe('Picture');
  });

  it('marks the selected cards, taking the selection as a Set', async () => {
    host.assets.set([card('a'), card('b')]);
    host.selectedIds.set(new Set(['b']));
    await render();
    expect(cards().map((c) => c.classList.contains('nxs-asset-grid__card--selected'))).toEqual([
      false,
      true,
    ]);
    expect(checkboxes().map((c) => c.checked)).toEqual([false, true]);
  });

  it('takes the selection as a list too', async () => {
    host.assets.set([card('a'), card('b')]);
    host.selectedIds.set(['a']);
    await render();
    expect(checkboxes().map((c) => c.checked)).toEqual([true, false]);
  });

  it('offers no checkbox when it is not selectable', async () => {
    host.assets.set([card('a')]);
    host.selectable.set(false);
    await render();
    expect(checkboxes()).toHaveLength(0);
    expect(names()).toHaveLength(1);
  });

  it('asks the host to open the asset whose name was pressed', async () => {
    host.assets.set([card('a'), card('b')]);
    await render();
    names()[1].click();
    names()[0].click();
    expect(host.opened).toEqual(['b', 'a']);
  });

  it('asks the host to flip the selection of the card that was ticked', async () => {
    host.assets.set([card('a'), card('b')]);
    await render();
    checkboxes()[1].click();
    await render();
    expect(host.toggled).toEqual(['b']);
  });

  it('does not open the asset when its checkbox is ticked', async () => {
    host.assets.set([card('a')]);
    await render();
    checkboxes()[0].click();
    await render();
    expect(host.opened).toEqual([]);
  });

  // The name has to land on the inner `<input>` — that is the element with the checkbox role. A
  // name on the `mat-checkbox` host does not reach it, which is what `[attr.aria-label]` would do.
  it('names each checkbox after its document, on the input itself', async () => {
    host.assets.set([card('a', { name: 'Quarterly report.png' })]);
    await render();
    expect(checkboxes()[0].getAttribute('aria-label')).toBe('Select Quarterly report.png');
  });

  // `lib-extension-outlet` sets inputs and cannot bind an output, so a host that renders the grid
  // through its ID passes callbacks instead. Both paths have to carry the same two facts.
  it('calls the handler inputs as well, for a host rendering it through an outlet', async () => {
    const handlerFixture = TestBed.createComponent(HandlerHostComponent);
    const handlerHost = handlerFixture.componentInstance;
    handlerHost.assets.set([card('a')]);
    handlerFixture.detectChanges();
    await handlerFixture.whenStable();

    const root = handlerFixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('.nxs-asset-grid__name')?.click();
    root.querySelector<HTMLInputElement>('.nxs-asset-grid__select input')?.click();
    handlerFixture.detectChanges();
    await handlerFixture.whenStable();

    expect(handlerHost.opened).toEqual(['a']);
    expect(handlerHost.toggled).toEqual(['a']);
  });
});
