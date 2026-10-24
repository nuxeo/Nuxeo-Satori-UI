import {
  Component,
  provideZonelessChangeDetection,
  signal,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NxsTabBodyDirective, type NxsTab } from './tab-body.directive';
import { NxsTabsComponent } from './tabs.component';

const TABS: readonly NxsTab[] = [
  { id: 'app.tabs.view', label: 'View', icon: 'visibility' },
  { id: 'app.tabs.permissions', label: 'Permissions' },
  { id: 'acme.tabs.claims', label: 'Claims' },
];

@Component({
  standalone: true,
  imports: [NxsTabsComponent, NxsTabBodyDirective],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-tabs
      [tabs]="tabs()"
      [label]="label()"
      [(selectedIndex)]="index"
      (selectedTabChange)="selected.push($event.id)"
    >
      <ng-template nxsTabBody let-tab>
        @switch (tab.id) {
          @case ('app.tabs.view') {
            <p class="body body--view">Viewer</p>
          }
          @default {
            <p class="body body--other" [attr.data-for]="tab.id">{{ tab.label }} body</p>
          }
        }
      </ng-template>
    </nxs-tabs>
  `,
})
class HostComponent {
  readonly tabs = signal<readonly NxsTab[]>(TABS);
  readonly label = signal('Document views');
  readonly index = signal(0);
  readonly selected: string[] = [];
  readonly bodyTemplate = viewChild(NxsTabBodyDirective);
}

describe('NxsTabsComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const tabs = (): HTMLElement[] => [...el().querySelectorAll<HTMLElement>('[role="tab"]')];
  const activeBody = (): HTMLElement | null => el().querySelector('.mat-mdc-tab-body-active .body');

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
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

  it('renders one tab per entry, in order, each addressable by its ID', () => {
    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual([
      'visibility View',
      'Permissions',
      'Claims',
    ]);
    expect(
      [...el().querySelectorAll('[data-tab-id]')].map((n) => n.getAttribute('data-tab-id')),
    ).toEqual(['app.tabs.view', 'app.tabs.permissions', 'acme.tabs.claims']);
  });

  it('hides tab icons from assistive technology, so a tab is named by its label', () => {
    expect(el().querySelector('.nxs-tabs__icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('names the tab list', () => {
    expect(el().querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
      'Document views',
    );
  });

  it('leaves the tab list unnamed rather than naming it with whitespace', async () => {
    host.label.set('   ');
    await render();
    expect(el().querySelector('[role="tablist"]')?.hasAttribute('aria-label')).toBe(false);
  });

  it('gives the tab list an inline key handler IBM Equal Access can detect', () => {
    const tabList = el().querySelector('[role="tablist"]');
    expect(tabList?.getAttribute('onkeydown')).toBe('void(0)');
    expect(tabList?.getAttribute('data-satori-tablist-keydown')).toBe('true');
  });

  it('keeps an inline key handler that is already on the tab list', async () => {
    const tabList = el().querySelector('[role="tablist"]') as HTMLElement;
    tabList.removeAttribute('data-satori-tablist-keydown');
    tabList.setAttribute('onkeydown', 'return true');
    host.tabs.set(TABS.slice(0, 2));
    await render();
    expect(tabList.getAttribute('onkeydown')).toBe('return true');
    expect(tabList.getAttribute('data-satori-tablist-keydown')).toBe('true');
  });

  it('renders every body from the one template, handing it the tab', () => {
    expect(activeBody()?.classList).toContain('body--view');
  });

  it('selects on click, reports the tab by ID and updates the two-way index', async () => {
    tabs()[2].click();
    await render();
    expect(host.selected).toEqual(['acme.tabs.claims']);
    expect(host.index()).toBe(2);
    expect(activeBody()?.getAttribute('data-for')).toBe('acme.tabs.claims');
  });

  it('follows an index the host sets', async () => {
    host.index.set(1);
    await render();
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(activeBody()?.textContent).toContain('Permissions body');
  });

  it('types the body template context as the tab', () => {
    const directive = host.bodyTemplate();
    expect(directive).toBeInstanceOf(NxsTabBodyDirective);
    expect(
      NxsTabBodyDirective.ngTemplateContextGuard(directive as NxsTabBodyDirective, {
        $implicit: TABS[0],
      }),
    ).toBe(true);
  });

  it('renders no body when the host marks no template', async () => {
    @Component({
      changeDetection: ChangeDetectionStrategy.Eager,
      standalone: true,
      imports: [NxsTabsComponent],
      template: `<nxs-tabs [tabs]="tabs" />`,
    })
    class BareHost {
      readonly tabs = TABS;
    }
    const bare = TestBed.createComponent(BareHost);
    bare.detectChanges();
    await bare.whenStable();
    expect((bare.nativeElement as HTMLElement).querySelectorAll('[role="tab"]').length).toBe(3);
    expect((bare.nativeElement as HTMLElement).querySelector('.body')).toBeNull();
  });
});
