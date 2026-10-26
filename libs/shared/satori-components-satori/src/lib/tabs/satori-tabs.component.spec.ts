import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import type { NxsTab } from '@nuxeo/satori-platform/components';

import { NxsSatoriTabsComponent } from './satori-tabs.component';

const TABS: readonly NxsTab[] = [
  { id: 'app.tabs.view', label: 'View', icon: 'visibility' },
  { id: 'app.tabs.permissions', label: 'Permissions' },
  { id: 'acme.tabs.claims', label: 'Claims' },
];

@Component({
  standalone: true,
  imports: [NxsSatoriTabsComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <ng-template #body let-tab>
      <p class="body" [attr.data-for]="tab.id">{{ tab.label }} body</p>
    </ng-template>
    <nxs-satori-tabs
      [tabs]="tabs()"
      [label]="label()"
      [selectedIndex]="index()"
      [body]="withBody() ? body : null"
      [selectHandler]="handler"
    />
  `,
})
class HostComponent {
  readonly tabs = signal<readonly NxsTab[]>(TABS);
  readonly label = signal('Document views');
  readonly index = signal(0);
  readonly withBody = signal(true);
  readonly calls: [string, number][] = [];
  readonly handler = (tab: NxsTab, index: number) => this.calls.push([tab.id, index]);
}

describe('NxsSatoriTabsComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const tabs = (): HTMLAnchorElement[] => [
    ...el().querySelectorAll<HTMLAnchorElement>('a[satNavigationTab]'),
  ];
  const panel = (): HTMLElement | null => el().querySelector('[role="tabpanel"]');
  const key = (target: HTMLElement, name: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, MatIconTestingModule],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  it("renders the strip on Satori's sat-navigation-tabs, one tab per entry, addressable by ID", () => {
    const strip = el().querySelector('sat-navigation-tabs');
    expect(strip?.getAttribute('role')).toBe('tablist');
    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual(['View', 'Permissions', 'Claims']);
    expect(tabs().map((tab) => tab.getAttribute('data-tab-id'))).toEqual(TABS.map((t) => t.id));
    expect(tabs().every((tab) => tab.getAttribute('role') === 'tab')).toBe(true);
  });

  it('names the tab list from the label, and leaves it unnamed when the label is blank', async () => {
    const strip = () => el().querySelector('sat-navigation-tabs');
    expect(strip()?.getAttribute('aria-label')).toBe('Document views');
    host.label.set('   ');
    await render();
    expect(strip()?.hasAttribute('aria-label')).toBe(false);
  });

  it('hides tab icons from assistive technology, so a tab is named by its label', () => {
    expect(tabs()[0].querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders the selected tab body as the tabpanel its tab names and controls', () => {
    expect(panel()?.querySelector('.body')?.getAttribute('data-for')).toBe('app.tabs.view');
    expect(panel()?.getAttribute('aria-labelledby')).toBe(tabs()[0].id);
    expect(tabs()[0].getAttribute('aria-controls')).toBe(panel()?.id);
    expect(tabs()[1].hasAttribute('aria-controls')).toBe(false);
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs()[1].getAttribute('aria-selected')).toBe('false');
  });

  it('selects on click, shows that body and calls the select handler', async () => {
    tabs()[2].click();
    await render();
    expect(panel()?.querySelector('.body')?.getAttribute('data-for')).toBe('acme.tabs.claims');
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true');
    expect(host.calls).toEqual([['acme.tabs.claims', 2]]);
  });

  // An anchor with no `href` does not turn Enter into a click, and Satori adds no key handling
  // beyond moving focus.
  it('selects the focused tab on Enter and on Space, without scrolling the page on Space', async () => {
    key(tabs()[1], 'Enter');
    await render();
    expect(panel()?.querySelector('.body')?.getAttribute('data-for')).toBe('app.tabs.permissions');

    const space = key(tabs()[2], ' ');
    await render();
    expect(space.defaultPrevented).toBe(true);
    expect(panel()?.querySelector('.body')?.getAttribute('data-for')).toBe('acme.tabs.claims');
    expect(host.calls).toEqual([
      ['app.tabs.permissions', 1],
      ['acme.tabs.claims', 2],
    ]);
  });

  it('follows an index the host sets, and reports that change too, as Material does', async () => {
    host.index.set(1);
    await render();
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(panel()?.textContent).toContain('Permissions body');
    expect(host.calls).toEqual([['app.tabs.permissions', 1]]);
  });

  it('does not report the first selection', () => {
    expect(host.calls).toEqual([]);
  });

  it('selects the last tab for an index past it, as Material does', async () => {
    host.index.set(7);
    await render();
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true');
    expect(panel()?.textContent).toContain('Claims body');
  });

  // Satori puts the tab stop on its first tab once, as it starts.
  it('makes the selected tab the only tab stop, also when it is not the first', async () => {
    host.index.set(2);
    await render();
    expect(tabs().map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
  });

  // Satori claims its first tab as the stop as it starts, so a strip that starts on another tab —
  // a page opened on History, say — has to win over that.
  it('makes the selected tab the tab stop when the strip starts on a tab other than the first', async () => {
    const started = TestBed.createComponent(HostComponent);
    started.componentInstance.index.set(2);
    started.detectChanges();
    await started.whenStable();
    started.detectChanges();
    const stops = [
      ...(started.nativeElement as HTMLElement).querySelectorAll('a[satNavigationTab]'),
    ].map((tab) => tab.getAttribute('tabindex'));
    expect(stops).toEqual(['-1', '-1', '0']);
  });

  it('keeps a tab stop when the tab list changes under the selection', async () => {
    host.tabs.set([{ id: 'acme.tabs.audit', label: 'Audit' }, ...TABS.slice(1)]);
    await render();
    expect(tabs().map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('moves focus between tabs with the arrow keys, through Satori', async () => {
    tabs()[0].focus();
    key(tabs()[0], 'ArrowRight');
    await render();
    expect(document.activeElement).toBe(tabs()[1]);
  });

  it('starts a body afresh each time its tab is shown', async () => {
    const first = panel()?.querySelector('.body');
    tabs()[1].click();
    await render();
    tabs()[0].click();
    await render();
    expect(panel()?.querySelector('.body')).not.toBe(first);
  });

  it('renders an empty panel when there is no body template', async () => {
    host.withBody.set(false);
    await render();
    expect(panel()).not.toBeNull();
    expect(panel()?.querySelector('.body')).toBeNull();
  });

  it('renders no panel when there are no tabs', async () => {
    host.tabs.set([]);
    await render();
    expect(tabs()).toEqual([]);
    expect(panel()).toBeNull();
  });
});
